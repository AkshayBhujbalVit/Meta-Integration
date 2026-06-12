"""
LiveKit outbound call service.

Dispatches an outbound SIP phone call via LiveKit:
  1. Creates a unique room name for this call
  2. Encodes the per-lead system prompt as room metadata
     (agent.py reads this metadata and passes it to Gemini Live)
  3. Creates a LiveKit SIP participant to dial the patient's phone number
     using the configured Twilio SIP trunk

The agent.py process is always running and picks up the room automatically.
"""

import logging
import os
import uuid
from datetime import datetime

from livekit import api as livekit_api
from sqlalchemy.orm import Session

from core.encryption import decrypt
from models.models.lead import Lead, LeadStatus
from models.models.call import CallLog
from models.models.settings import CallingConfig

logger = logging.getLogger("livekit_service")


def _resolve_livekit_creds(cfg: CallingConfig | None) -> tuple[str, str, str, str]:
    """Return (url, api_key, api_secret, sip_trunk_id) from DB (decrypted) with env fallback."""
    lk_url        = (decrypt(cfg.livekit_url)        if cfg and cfg.livekit_url        else None) or os.getenv("LIVEKIT_URL", "")
    lk_api_key    = (decrypt(cfg.livekit_api_key)    if cfg and cfg.livekit_api_key    else None) or os.getenv("LIVEKIT_API_KEY", "")
    lk_api_secret = (decrypt(cfg.livekit_api_secret) if cfg and cfg.livekit_api_secret else None) or os.getenv("LIVEKIT_API_SECRET", "")
    sip_trunk_id  = (cfg.livekit_sip_trunk_id        if cfg and cfg.livekit_sip_trunk_id else None) or os.getenv("LIVEKIT_SIP_TRUNK_ID", "")
    return lk_url, lk_api_key, lk_api_secret, sip_trunk_id


async def trigger_livekit_call(
    lead: Lead,
    system_prompt: str,
    db: Session,
) -> dict:
    """
    Dispatch an outbound call to lead.phone via LiveKit SIP.
    Credentials are read from DB (encrypted) first, then fall back to .env.
    """
    cfg = db.query(CallingConfig).filter(CallingConfig.is_active == True).first()
    lk_url, lk_api_key, lk_api_secret, sip_trunk_id = _resolve_livekit_creds(cfg)

    if not lk_api_key:
        raise ValueError("LiveKit API key is not configured. Add it in Settings → Calling Provider → Credentials.")
    if not sip_trunk_id:
        raise ValueError("LiveKit SIP Trunk ID is not configured. Add it in Settings → Calling Provider → Credentials.")

    # Each call gets its own room — name is used to match the CallLog in the webhook
    room_name = f"call-{lead.id}-{uuid.uuid4().hex[:8]}"

    client = livekit_api.LiveKitAPI(url=lk_url, api_key=lk_api_key, api_secret=lk_api_secret)

    # Create the room, embedding the per-lead prompt as metadata.
    # agent.py reads this metadata and sends it to Gemini Live as instructions.
    await client.room.create_room(
        livekit_api.CreateRoomRequest(
            name=room_name,
            metadata=system_prompt,
            empty_timeout=300,   # auto-close room if no participants for 5 min
            max_participants=10,
        )
    )
    logger.info("Created LiveKit room: %s for lead %s", room_name, lead.id)

    # Explicitly dispatch the AI agent to this room.
    # Required in LiveKit Agents v1.x — without this the agent sits idle
    # even though it's connected to LiveKit Cloud.
    try:
        await client.agent.create_dispatch(
            livekit_api.CreateAgentDispatchRequest(
                room=room_name,
                agent_name="",        # "" = dispatch to any registered worker
                metadata=system_prompt,
            )
        )
        logger.info("Agent dispatched to room: %s", room_name)
    except Exception as dispatch_err:
        logger.warning("Agent dispatch call failed (will try auto-dispatch): %s", dispatch_err)

    # Dial the patient's phone number via SIP trunk
    phone_number = lead.phone
    if not phone_number.startswith("+"):
        phone_number = f"+{phone_number}"

    sip_request = livekit_api.CreateSIPParticipantRequest(
        sip_trunk_id=sip_trunk_id,
        sip_call_to=phone_number,
        room_name=room_name,
        participant_identity=f"patient-{lead.id}",
        participant_name=lead.full_name or "Patient",
    )
    sip_participant = await client.sip.create_sip_participant(sip_request)
    logger.info("SIP dial initiated for %s in room %s", phone_number, room_name)

    # Record the call in the DB
    attempt = db.query(CallLog).filter(CallLog.lead_id == lead.id).count() + 1
    call_log = CallLog(
        lead_id=lead.id,
        vapi_call_id=room_name,          # reuse field — stores LiveKit room name
        vapi_assistant_id="livekit-gemini",
        phone=lead.phone,
        status="initiated",
        attempt_number=attempt,
        started_at=datetime.utcnow(),
    )
    db.add(call_log)

    lead.status = LeadStatus.calling
    lead.call_count = (lead.call_count or 0) + 1
    lead.last_called_at = datetime.utcnow()
    db.commit()

    return {
        "call_id": room_name,
        "provider": "livekit",
        "attempt": attempt,
        "status": "initiated",
    }
