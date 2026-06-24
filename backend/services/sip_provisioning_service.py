"""
Switches which telephony provider's LiveKit SIP trunk is active for calling.

Saving credentials in Settings only stores them — it does not touch any live
infrastructure. activate_provider() is what actually points trigger_livekit_call()
(see livekit_service.py) and inbound dispatch at a given provider's trunk.

Switching providers is non-destructive: each provider keeps its own trunk IDs
(twilio_outbound_trunk_id / vobiz_outbound_trunk_id, etc). Activating a provider
only changes which set of IDs is mirrored into the "active" pointer fields
(livekit_sip_trunk_id / inbound_sip_trunk_id / livekit_dispatch_rule_id) — it
never deletes another provider's trunk, so switching back and forth is instant.

VoBiz's own trunk is auto-provisioned: the first Activate creates it, every
later Activate updates it in place to match whatever credentials are currently
saved (so a new VoBiz number/account takes effect without manual cleanup).
Twilio's trunk is built by hand in the LiveKit console (this app doesn't
automate Twilio's side), so its IDs are just pasted in and reused as-is.
"""

import logging

from livekit import api as livekit_api
from sqlalchemy.orm import Session

from core.encryption import decrypt
from core.http_client import async_client
from models.models.settings import CallingConfig
from services.livekit_service import _resolve_livekit_creds

logger = logging.getLogger("sip_provisioning_service")

VOBIZ_API_BASE = "https://api.vobiz.ai/api/v1"


async def activate_provider(db: Session, provider: str) -> dict:
    """provider: "vobiz" | "twilio" | "" (deactivate — calling goes idle)."""
    cfg = db.query(CallingConfig).filter(CallingConfig.is_active == True).first()
    if not cfg:
        raise ValueError("Calling config not found")

    if not provider:
        cfg.phone_provider = None
        cfg.livekit_sip_trunk_id = None
        cfg.inbound_sip_trunk_id = None
        cfg.livekit_dispatch_rule_id = None
        db.commit()
        return {
            "message": "Calling deactivated — no provider is active, outbound/inbound calls will fail until you activate one"
        }

    if provider == "vobiz":
        return await _activate_vobiz(db, cfg)
    if provider == "twilio":
        return _activate_twilio(db, cfg)
    raise ValueError(f"Activation not supported for provider: {provider}")


def _activate_twilio(db: Session, cfg: CallingConfig) -> dict:
    if not cfg.twilio_outbound_trunk_id:
        raise ValueError(
            "Missing Twilio LiveKit Outbound Trunk ID. Paste the trunk ID from your "
            "LiveKit Cloud SIP setup into the Twilio form first."
        )
    cfg.livekit_sip_trunk_id = cfg.twilio_outbound_trunk_id
    cfg.inbound_sip_trunk_id = cfg.twilio_inbound_trunk_id
    cfg.livekit_dispatch_rule_id = cfg.twilio_dispatch_rule_id
    cfg.phone_provider = "twilio"
    db.commit()
    return {"message": "Twilio activated — calls now route through your Twilio number"}


async def _activate_vobiz(db: Session, cfg: CallingConfig) -> dict:
    vobiz_auth_id = decrypt(cfg.vobiz_auth_id) if cfg.vobiz_auth_id else None
    vobiz_auth_token = decrypt(cfg.vobiz_auth_token) if cfg.vobiz_auth_token else None
    vobiz_sip_username = decrypt(cfg.vobiz_sip_username) if cfg.vobiz_sip_username else None
    vobiz_sip_password = decrypt(cfg.vobiz_sip_password) if cfg.vobiz_sip_password else None

    # Only these are needed to make outbound calls work — Auth ID/Token/Trunk ID/SIP URI
    # are solely for the optional step below that auto-points VoBiz's inbound routing
    # at LiveKit, and are not required to activate VoBiz at all.
    required = {
        "VoBiz SIP Domain": cfg.vobiz_sip_domain,
        "VoBiz SIP Username": vobiz_sip_username,
        "VoBiz SIP Password": vobiz_sip_password,
        "VoBiz Phone Number": cfg.vobiz_phone_number,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")

    lk_url, lk_api_key, lk_api_secret, _ = _resolve_livekit_creds(cfg)
    if not lk_api_key:
        raise ValueError(
            "LiveKit API key is not configured. Add it in Settings → Calling Provider."
        )

    client = livekit_api.LiveKitAPI(url=lk_url, api_key=lk_api_key, api_secret=lk_api_secret)

    outbound_info = livekit_api.SIPOutboundTrunkInfo(
        name="VoBiz Trunk",
        address=cfg.vobiz_sip_domain,
        auth_username=vobiz_sip_username,
        auth_password=vobiz_sip_password,
        numbers=[cfg.vobiz_phone_number],
    )
    if cfg.vobiz_outbound_trunk_id:
        outbound = await client.sip.update_sip_outbound_trunk(
            cfg.vobiz_outbound_trunk_id, outbound_info
        )
    else:
        outbound = await client.sip.create_sip_outbound_trunk(
            livekit_api.CreateSIPOutboundTrunkRequest(trunk=outbound_info)
        )
        cfg.vobiz_outbound_trunk_id = outbound.sip_trunk_id

    inbound_info = livekit_api.SIPInboundTrunkInfo(
        name="VoBiz Inbound",
        numbers=[cfg.vobiz_phone_number],
        allowed_addresses=["0.0.0.0/0"],
    )
    if cfg.vobiz_inbound_trunk_id:
        inbound = await client.sip.update_sip_inbound_trunk(
            cfg.vobiz_inbound_trunk_id, inbound_info
        )
    else:
        inbound = await client.sip.create_sip_inbound_trunk(
            livekit_api.CreateSIPInboundTrunkRequest(trunk=inbound_info)
        )
        cfg.vobiz_inbound_trunk_id = inbound.sip_trunk_id

    if not cfg.vobiz_dispatch_rule_id:
        rule = await client.sip.create_sip_dispatch_rule(
            livekit_api.CreateSIPDispatchRuleRequest(
                trunk_ids=[cfg.vobiz_inbound_trunk_id],
                name="VoBiz Inbound Rule",
                rule=livekit_api.SIPDispatchRule(
                    dispatch_rule_individual=livekit_api.SIPDispatchRuleIndividual(
                        room_prefix="inbound-"
                    )
                ),
            )
        )
        cfg.vobiz_dispatch_rule_id = rule.sip_dispatch_rule_id

    # Point VoBiz's inbound routing at this LiveKit project's SIP URI — optional
    # (only possible with Auth ID/Token/Trunk ID/SIP URI all present), idempotent,
    # safe to repeat on every activation in case credentials changed.
    sip_uri = None
    vobiz_warning = None
    inbound_routing_inputs = {
        "VoBiz Auth ID": vobiz_auth_id,
        "VoBiz Auth Token": vobiz_auth_token,
        "VoBiz Trunk ID": cfg.vobiz_trunk_id,
        "LiveKit SIP URI": cfg.livekit_sip_uri,
    }
    missing_inbound = [name for name, value in inbound_routing_inputs.items() if not value]
    if missing_inbound:
        vobiz_warning = (
            f"Outbound calling is active. Inbound routing was NOT auto-configured "
            f"(missing: {', '.join(missing_inbound)}) — add them and Activate again, "
            f"or set the trunk's inbound destination manually in console.vobiz.ai."
        )
    else:
        sip_uri = cfg.livekit_sip_uri.removeprefix("sip:")
        async with async_client(timeout=10) as http:
            try:
                resp = await http.patch(
                    f"{VOBIZ_API_BASE}/Account/{vobiz_auth_id}/trunks/{cfg.vobiz_trunk_id}",
                    json={"inbound_destination": sip_uri},
                    headers={"X-Auth-ID": vobiz_auth_id, "X-Auth-Token": vobiz_auth_token},
                )
                resp.raise_for_status()
            except Exception as e:
                vobiz_warning = (
                    f"LiveKit trunk synced, but updating VoBiz inbound routing failed: {e}"
                )
                logger.warning(vobiz_warning)

    cfg.livekit_sip_trunk_id = cfg.vobiz_outbound_trunk_id
    cfg.inbound_sip_trunk_id = cfg.vobiz_inbound_trunk_id
    cfg.livekit_dispatch_rule_id = cfg.vobiz_dispatch_rule_id
    cfg.phone_provider = "vobiz"
    db.commit()

    result = {
        "message": "VoBiz activated — calls now route through your VoBiz number",
        "outbound_trunk_id": cfg.vobiz_outbound_trunk_id,
        "inbound_trunk_id": cfg.vobiz_inbound_trunk_id,
        "dispatch_rule_id": cfg.vobiz_dispatch_rule_id,
        "sip_uri": sip_uri,
    }
    if vobiz_warning:
        result["warning"] = vobiz_warning
    return result
