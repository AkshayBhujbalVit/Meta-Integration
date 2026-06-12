import os
import re
from datetime import datetime, timedelta
from datetime import time as dt_time

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from models.models.appointment import Appointment
from models.models.call import CallLog
from models.models.lead import Lead, LeadStatus
from models.models.settings import CallingConfig, ClinicSettings
from services.calling_service import build_system_prompt, trigger_call

router = APIRouter(prefix="/calling", tags=["Calling"])


def _verify_internal_token(x_internal_token: str | None = Header(default=None)):
    """Shared-secret guard for internal agent→backend endpoints."""
    secret = os.getenv("INTERNAL_API_SECRET", "")
    if not secret:
        return  # not configured — allow (dev fallback; set INTERNAL_API_SECRET in prod)
    if x_internal_token != secret:
        raise HTTPException(status_code=401, detail="Invalid or missing internal token")


def _parse_clinic_windows(timings: str) -> list[tuple[dt_time, dt_time]]:
    """
    Parse clinic timings string into (start, end) time pairs.
    Handles: "Mon-Sat: 10:00 AM–1:00 PM and 5:00 PM–8:00 PM"
    Returns e.g. [(time(10,0), time(13,0)), (time(17,0), time(20,0))]
    """
    windows = []
    # Find all time ranges like "10:00 AM–1:00 PM" or "5:00 PM - 8:00 PM"
    pattern = r"(\d{1,2}(?::\d{2})?\s*[AP]M)\s*(?:–|—|\-|to)\s*(\d{1,2}(?::\d{2})?\s*[AP]M)"
    for start_str, end_str in re.findall(pattern, timings, re.IGNORECASE):
        try:

            def _parse(t: str) -> dt_time:
                t = t.strip()
                fmt = "%I:%M %p" if ":" in t else "%I %p"
                return datetime.strptime(t.upper(), fmt).time()

            windows.append((_parse(start_str), _parse(end_str)))
        except ValueError:
            continue
    return windows


def _within_clinic_hours(slot: datetime, db: Session) -> bool:
    """Return True if slot falls within any clinic time window (Mon–Sat)."""
    if slot.weekday() == 6:  # Sunday
        return False
    clinic = db.query(ClinicSettings).first()
    timings_str = clinic.timings if clinic and clinic.timings else ""
    windows = _parse_clinic_windows(timings_str) if timings_str else []
    # Fallback: assume 10–13 and 17–20 if parsing fails
    if not windows:
        windows = [(dt_time(10, 0), dt_time(13, 0)), (dt_time(17, 0), dt_time(20, 0))]
    t = slot.time()
    return any(start <= t < end for start, end in windows)


# ── Available slot checker ────────────────────────────────────────────────────


@router.get("/check-slot")
def check_specific_slot(
    requested_datetime: str,
    db: Session = Depends(get_db),
):
    """
    Check if a specific date+time slot is available.
    If booked → return next 2 available alternatives (freed slots first).

    requested_datetime: ISO format e.g. "2026-06-03T15:00:00"
    """
    try:
        requested = datetime.fromisoformat(requested_datetime)
    except ValueError:
        return {"available": False, "message": "Invalid datetime format", "alternatives": []}

    # Round to nearest 30-min slot
    def _round30(dt: datetime) -> datetime:
        m = (dt.minute // 30) * 30
        return dt.replace(minute=m, second=0, microsecond=0)

    slot = _round30(requested)

    # Check clinic hours FIRST — reject if outside working windows
    if not _within_clinic_hours(slot, db):
        alts_resp = get_available_slots(days_ahead=7, db=db)
        alts = alts_resp.get("slots", [])[:3]
        clinic = db.query(ClinicSettings).first()
        timings_str = (
            clinic.timings if clinic and clinic.timings else "10:00 AM–1:00 PM and 5:00 PM–8:00 PM"
        )
        return {
            "available": False,
            "slot": None,
            "message": (
                f"Us waqt clinic band hoti hai. "
                f"Clinic timings: {timings_str}. "
                f"Yeh slots available hain: {', '.join(a['label'] for a in alts)}"
            ),
            "alternatives": alts,
        }

    # Check if this slot is taken
    conflict = (
        db.query(Appointment)
        .filter(
            Appointment.status.in_(["booked", "confirmed"]),
            Appointment.appointment_date >= slot,
            Appointment.appointment_date < slot + timedelta(minutes=30),
        )
        .first()
    )

    if not conflict:
        # Slot is free — check if it's a freed slot (bonus info)
        freed = (
            db.query(Appointment)
            .filter(
                Appointment.status == "cancelled",
                Appointment.appointment_date >= slot,
                Appointment.appointment_date < slot + timedelta(minutes=30),
            )
            .first()
        )
        label = slot.strftime("%A, %d %b %I:%M %p").lstrip("0")
        return {
            "available": True,
            "slot": {"datetime": slot.isoformat(), "label": label, "is_freed_slot": bool(freed)},
            "message": f"Slot available hai: {label}",
            "alternatives": [],
        }

    # Slot is taken — find 2 alternatives from get_available_slots
    alts_resp = get_available_slots(days_ahead=7, db=db)
    alts = alts_resp.get("slots", [])[:2]
    alt_labels = ", ".join(a["label"] for a in alts)
    req_label = slot.strftime("%I:%M %p").lstrip("0") + " " + slot.strftime("%d %b")

    return {
        "available": False,
        "slot": None,
        "message": (
            f"{req_label} already booked hai. " f"Yeh alternatives available hain: {alt_labels}"
        ),
        "alternatives": alts,
    }


@router.get("/available-slots")
def get_available_slots(
    days_ahead: int = 7,
    db: Session = Depends(get_db),
):
    """
    Returns the next 3 available appointment slots.

    Priority:
      1. Slots freed by recent cancellations / reschedules (patient deserves that time back)
      2. Next available slots in chronological order

    Respects:
      - Clinic working hours (Mon–Sat, 09:00–19:00 by default; reads CallingConfig)
      - Existing booked / confirmed appointments (won't double-book)
      - Minimum 1-hour notice (won't offer a slot that starts in <60 min)

    When a real calendar is connected (Google / Outlook), replace the DB check
    with a calendar API call — the rest of the logic stays the same.
    """
    now = datetime.now()

    # Parse clinic time windows from ClinicSettings
    clinic = db.query(ClinicSettings).first()
    timings_str = clinic.timings if clinic and clinic.timings else ""
    windows = _parse_clinic_windows(timings_str) if timings_str else []
    if not windows:
        windows = [(dt_time(10, 0), dt_time(13, 0)), (dt_time(17, 0), dt_time(20, 0))]

    # ── Generate candidate 30-min slots for the next N days ──────────────────
    candidates: list[datetime] = []
    for offset in range(days_ahead):
        day = (now + timedelta(days=offset)).date()
        if day.weekday() == 6:  # Skip Sundays
            continue
        for win_start, win_end in windows:
            slot = datetime.combine(day, win_start)
            end = datetime.combine(day, win_end)
            while slot < end:
                if slot > now + timedelta(hours=1):  # at least 1h notice
                    candidates.append(slot)
                slot += timedelta(minutes=30)

    # ── Get all booked slots (can't offer these) ──────────────────────────────
    booked_raw = (
        db.query(Appointment)
        .filter(
            Appointment.status.in_(["booked", "confirmed"]),
            Appointment.appointment_date >= now,
        )
        .all()
    )

    # Round to nearest 30-min for matching
    def _round30(dt: datetime) -> str:
        m = (dt.minute // 30) * 30
        return dt.replace(minute=m, second=0, microsecond=0).strftime("%Y-%m-%d %H:%M")

    booked_keys = {_round30(a.appointment_date) for a in booked_raw}

    # ── Get freed slots (cancelled — give these FIRST priority) ──────────────
    freed_raw = (
        db.query(Appointment)
        .filter(
            Appointment.status == "cancelled",
            Appointment.appointment_date >= now,
        )
        .all()
    )
    freed_keys = {_round30(a.appointment_date) for a in freed_raw}

    # ── Sort into priority buckets ────────────────────────────────────────────
    freed_available: list[datetime] = []
    normal_available: list[datetime] = []

    for slot in candidates:
        key = _round30(slot)
        if key in booked_keys:
            continue  # already taken
        if key in freed_keys:
            freed_available.append(slot)  # freed slot — top priority
        else:
            normal_available.append(slot)

    # Freed first, then normal, take top 3
    top3 = (freed_available + normal_available)[:3]

    if not top3:
        return {
            "available": False,
            "slots": [],
            "message": "Abhi koi appointment slot available nahi hai. Kuch din baad try karein.",
        }

    # ── Format slots in human-friendly labels ─────────────────────────────────
    formatted = []
    for slot in top3:
        is_today = slot.date() == now.date()
        is_tomorrow = slot.date() == (now + timedelta(days=1)).date()

        if is_today:
            day_label = "Aaj"
        elif is_tomorrow:
            day_label = "Kal"
        else:
            # "Shukravaar, 6 Jun" style
            day_label = (
                slot.strftime("%A, %-d %b") if os.name != "nt" else slot.strftime("%A, %d %b")
            )

        # "5:00 PM" → drop leading zero
        time_label = slot.strftime("%I:%M %p").lstrip("0")
        is_freed = _round30(slot) in freed_keys

        formatted.append(
            {
                "datetime": slot.isoformat(),
                "label": f"{day_label} {time_label}",
                "day": day_label,
                "time": time_label,
                "is_freed_slot": is_freed,
            }
        )

    slot_labels = ", ".join(s["label"] for s in formatted)
    has_freed = any(s["is_freed_slot"] for s in formatted)
    note = " (pehla slot recently free hua hai)" if has_freed else ""

    return {
        "available": True,
        "slots": formatted,
        "message": f"Available slots{note}: {slot_labels}",
    }


@router.get("/preview-voice/{voice}")
async def preview_voice(voice: str, _=Depends(get_current_admin)):
    """Generate a short Hindi TTS sample for the given voice so admins can preview before selecting."""
    import openai
    from fastapi.responses import Response

    allowed_voices = {
        "alloy",
        "echo",
        "fable",
        "onyx",
        "nova",
        "shimmer",
        "ash",
        "coral",
        "sage",
        "verse",
        "ballad",
    }
    if voice not in allowed_voices:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Invalid voice")

    sample = (
        "Namaste! Main Dr. Sonal Gupta clinic ki AI calling assistant hoon. "
        "Kya main aapki madad kar sakti hoon?"
    )

    client = openai.AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY", ""))
    try:
        resp = await client.audio.speech.create(
            model="tts-1",
            voice=voice,  # type: ignore[arg-type]
            input=sample,
            response_format="mp3",
        )
        audio = await resp.aread()
        return Response(content=audio, media_type="audio/mpeg")
    except Exception as e:
        from fastapi import HTTPException

        raise HTTPException(status_code=500, detail=f"Voice preview failed: {e}") from e


@router.get("/agent-config")
def agent_config(db: Session = Depends(get_db)):
    """Internal endpoint — agent.py reads voice + model settings from here."""
    cfg = db.query(CallingConfig).first()
    return {
        "voice": cfg.agent_voice if cfg and cfg.agent_voice else "alloy",
        "model": os.getenv("OPENAI_MODEL", "gpt-realtime"),
    }


class InternalBookRequest(BaseModel):
    lead_id: int
    appointment_datetime: str  # ISO 8601 e.g. "2026-06-02T18:00:00"
    appointment_type: str = "online"  # online / in_clinic
    notes: str = ""


@router.post("/internal/book-appointment")
def internal_book_appointment(
    body: InternalBookRequest, db: Session = Depends(get_db), _=Depends(_verify_internal_token)
):
    """Internal endpoint — called by agent.py during a live call to book an appointment."""
    from models.models.appointment import Appointment

    lead = db.query(Lead).filter(Lead.id == body.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    try:
        appt_date = datetime.fromisoformat(body.appointment_datetime)
    except ValueError as e:
        raise HTTPException(status_code=400, detail="Invalid datetime format. Use ISO 8601.") from e

    appt = Appointment(
        lead_id=lead.id,
        patient_name=lead.full_name,
        phone=lead.phone,
        appointment_date=appt_date,
        appointment_type=body.appointment_type,
        inquiry_type=lead.inquiry_type,
        notes=body.notes or None,
        status="booked",
    )
    db.add(appt)
    lead.status = LeadStatus.appointment_booked
    db.commit()
    db.refresh(appt)

    return {
        "appointment_id": appt.id,
        "appointment_date": appt.appointment_date.isoformat(),
        "appointment_type": appt.appointment_type,
        "patient_name": appt.patient_name,
        "status": "booked",
    }


@router.get("/call/{lead_id}/preview")
def preview_prompt(lead_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    prompt = build_system_prompt(lead, db)
    return {"lead_id": lead_id, "prompt_length": len(prompt), "prompt": prompt}


@router.post("/call/{lead_id}")
async def trigger(lead_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    if lead.status == LeadStatus.calling:
        raise HTTPException(status_code=400, detail="Call already in progress for this lead")

    try:
        result = await trigger_call(lead, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger call: {str(e)}") from e

    return result


@router.get("/logs")
def all_call_logs(
    limit: int = 100,
    offset: int = 0,
    outcome: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    """All call logs with lead info — for the Calls page."""
    q = db.query(CallLog).order_by(CallLog.created_at.desc())
    if outcome:
        q = q.filter(CallLog.outcome == outcome)
    total = q.count()
    logs = q.offset(offset).limit(limit).all()

    result = []
    for log in logs:
        lead = db.query(Lead).filter(Lead.id == log.lead_id).first()
        result.append(
            {
                "id": log.id,
                "lead_id": log.lead_id,
                "lead_name": lead.full_name if lead else "",
                "phone": log.phone,
                "attempt_number": log.attempt_number,
                "status": log.status,
                "outcome": log.outcome,
                "language_used": log.language_used,
                "duration_seconds": log.duration_seconds,
                "summary": log.summary,
                "transcript": log.transcript,
                "recording_url": log.recording_url,
                "started_at": log.started_at,
                "ended_at": log.ended_at,
            }
        )
    return {"total": total, "logs": result}


@router.get("/call/{lead_id}/history")
def call_history(lead_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    logs = (
        db.query(CallLog)
        .filter(CallLog.lead_id == lead_id)
        .order_by(CallLog.created_at.desc())
        .all()
    )
    return [
        {
            "id": log.id,
            "call_id": log.vapi_call_id,
            "attempt_number": log.attempt_number,
            "status": log.status,
            "outcome": log.outcome,
            "language_used": log.language_used,
            "duration_seconds": log.duration_seconds,
            "summary": log.summary,
            "transcript": log.transcript,
            "recording_url": log.recording_url,
            "started_at": log.started_at,
            "ended_at": log.ended_at,
        }
        for log in logs
    ]


class BatchCallRequest(BaseModel):
    lead_ids: list[int] | None = None  # if None → call all "new" leads


@router.post("/batch")
async def batch_call(
    body: BatchCallRequest,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    """
    Sequential calling queue — marks all eligible leads as call_scheduled,
    then triggers only the first call. Each subsequent lead is auto-triggered
    by the livekit-event webhook when the previous call ends.
    """
    skip_statuses = {
        LeadStatus.calling,
        LeadStatus.call_scheduled,
        LeadStatus.appointment_booked,
        LeadStatus.not_interested,
    }

    if body.lead_ids:
        leads = db.query(Lead).filter(Lead.id.in_(body.lead_ids)).all()
    else:
        leads = db.query(Lead).filter(Lead.status == LeadStatus.new).all()

    if not leads:
        return {"triggered": 0, "queued": 0, "skipped": 0}

    eligible = [lead for lead in leads if lead.status not in skip_statuses]
    skipped = len(leads) - len(eligible)

    if not eligible:
        return {"triggered": 0, "queued": 0, "skipped": skipped}

    # Sort by ID so calls go in import order
    eligible.sort(key=lambda lead: lead.id)

    # Mark ALL as call_scheduled (queued)
    for lead in eligible:
        lead.status = LeadStatus.call_scheduled
    db.commit()

    # Trigger only the first one — the rest fire automatically via livekit-event
    first = eligible[0]
    try:
        r = await trigger_call(first, db)
        return {
            "triggered": 1,
            "queued": len(eligible) - 1,
            "skipped": skipped,
            "first_call": {"lead_id": first.id, "name": first.full_name, **r},
        }
    except Exception as e:
        first.status = LeadStatus.new
        db.commit()
        raise HTTPException(status_code=500, detail=f"Failed to start first call: {e}") from e


class LiveKitEvent(BaseModel):
    room_name: str
    event: str
    transcript: str | None = None
    summary: str | None = None
    duration_seconds: int | None = None
    language_used: str | None = None
    recording_url: str | None = None
    outcome: str | None = None


@router.post("/livekit-event")
async def livekit_event(
    body: LiveKitEvent, db: Session = Depends(get_db), _=Depends(_verify_internal_token)
):
    """
    Receives call completion events from agent.py when a LiveKit session ends.
    room_name is stored as vapi_call_id in CallLog (provider-neutral field).
    """
    call_log = db.query(CallLog).filter(CallLog.vapi_call_id == body.room_name).first()
    if not call_log:
        return {"status": "ignored", "reason": "call not found"}

    lead = db.query(Lead).filter(Lead.id == call_log.lead_id).first()

    if body.event == "call_ended":
        call_log.status = "completed"
        call_log.ended_at = datetime.utcnow()
        if body.transcript:
            call_log.transcript = body.transcript
        if body.summary:
            call_log.summary = body.summary
        if body.duration_seconds:
            call_log.duration_seconds = body.duration_seconds
        if body.language_used:
            call_log.language_used = body.language_used
        if body.recording_url:
            call_log.recording_url = body.recording_url

        # Use explicit outcome from agent if provided, else parse from transcript
        outcome = (
            body.outcome
            if body.outcome
            else _parse_outcome(body.summary or "", body.transcript or "")
        )
        call_log.outcome = outcome

        if lead:
            status_map = {
                "appointment_booked": LeadStatus.appointment_booked,
                "interested": LeadStatus.interested,
                "not_interested": LeadStatus.not_interested,
                "callback_requested": LeadStatus.callback_requested,
                "no_answer": LeadStatus.no_answer,
            }
            new_status = status_map.get(outcome)
            if new_status:
                lead.status = new_status
            elif outcome in ("completed", ""):
                # Had a real conversation — mark as interested (not no_answer)
                lead.status = LeadStatus.interested
            lead.call_outcome = outcome

        db.commit()

        # Auto-trigger next lead in the call_scheduled queue
        next_lead = (
            db.query(Lead)
            .filter(Lead.status == LeadStatus.call_scheduled)
            .order_by(Lead.id)
            .first()
        )
        if next_lead:
            try:
                await trigger_call(next_lead, db)
            except Exception as e:
                import logging

                logging.getLogger("calling").warning(
                    "Auto-trigger failed for lead %s: %s", next_lead.id, e
                )

    return {"status": "ok"}


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    """
    Universal webhook endpoint — handles callbacks from Vapi, Bland, Retell, or custom.
    All providers should POST call completion data here.
    """
    payload = await request.json()

    # Normalize across providers
    call_id = (
        payload.get("call", {}).get("id")
        or payload.get("message", {}).get("call", {}).get("id")
        or payload.get("callId")
        or payload.get("call_id")
        or payload.get("id")
    )

    if not call_id:
        return {"status": "ignored", "reason": "no call id"}

    call_log = db.query(CallLog).filter(CallLog.vapi_call_id == call_id).first()
    if not call_log:
        return {"status": "ignored", "reason": "call not found"}

    lead = db.query(Lead).filter(Lead.id == call_log.lead_id).first()

    # Normalize event type across providers
    msg = payload.get("message", payload)
    event_type = msg.get("type") or payload.get("event") or payload.get("status") or ""

    # Call completed
    if event_type in ("end-of-call-report", "call_ended", "completed", "ended"):
        call_data = msg.get("call", payload)
        transcript = (
            msg.get("transcript")
            or payload.get("transcript")
            or payload.get("concatenated_transcript")
            or ""
        )
        summary = (
            msg.get("summary")
            or payload.get("summary")
            or payload.get("call_analysis", {}).get("call_summary")
            or ""
        )
        duration = call_data.get("duration") or payload.get("duration_ms", 0) // 1000 or 0
        ended_at_str = call_data.get("endedAt") or payload.get("end_timestamp")
        language = msg.get("languageDetected") or payload.get("language")

        recording_url = (
            msg.get("artifact", {}).get("recordingUrl")
            or call_data.get("recordingUrl")
            or payload.get("recording_url")
            or payload.get("recordingUrl")
        )

        call_log.transcript = transcript
        call_log.summary = summary
        call_log.recording_url = recording_url
        call_log.status = "completed"
        if language:
            call_log.language_used = language
        if duration:
            call_log.duration_seconds = int(duration)
        if ended_at_str:
            try:
                if isinstance(ended_at_str, int | float):
                    call_log.ended_at = datetime.utcfromtimestamp(ended_at_str / 1000)
                else:
                    call_log.ended_at = datetime.fromisoformat(
                        str(ended_at_str).replace("Z", "+00:00")
                    )
            except Exception:
                pass

        outcome = _parse_outcome(summary, transcript)
        call_log.outcome = outcome

        if lead:
            status_map = {
                "appointment_booked": LeadStatus.appointment_booked,
                "interested": LeadStatus.interested,
                "not_interested": LeadStatus.not_interested,
                "callback_requested": LeadStatus.callback_requested,
                "no_answer": LeadStatus.no_answer,
            }
            lead.status = status_map.get(outcome, LeadStatus.no_answer)
            lead.call_outcome = outcome

        db.commit()

    elif event_type in ("status-update", "no-answer", "busy", "failed", "voicemail"):
        call_log.status = event_type.replace("-", "_")
        if lead:
            lead.status = LeadStatus.no_answer
        db.commit()

    return {"status": "ok"}


# ── Inbound call endpoints (called by agent.py for inbound SIP calls) ────────


@router.get("/inbound-context")
def inbound_context(phone: str, db: Session = Depends(get_db), _=Depends(_verify_internal_token)):
    """
    Called by agent.py at the start of an inbound call.
    Looks up the caller's phone in the lead database and returns a
    personalised system prompt + lead_id so the agent can book appointments.
    """
    from services.calling_service import build_inbound_prompt

    # Normalise: strip +91 prefix and take last 10 digits for matching
    clean = phone.lstrip("+").lstrip("91")
    if len(clean) > 10:
        clean = clean[-10:]

    lead = (
        db.query(Lead)
        .filter(
            Lead.phone.like(f"%{clean}"),
            Lead.status != LeadStatus.not_interested,
            Lead.is_duplicate == False,
        )
        .order_by(Lead.created_at.desc())
        .first()
    )

    if lead:
        instructions = build_inbound_prompt(lead, db)
        return {
            "lead_id": lead.id,
            "instructions": instructions,
            "is_returning": True,
            "patient_name": lead.full_name,
        }

    from services.calling_service import DEFAULT_INBOUND_INSTRUCTIONS

    return {
        "lead_id": 0,
        "instructions": DEFAULT_INBOUND_INSTRUCTIONS,
        "is_returning": False,
        "patient_name": None,
    }


class InboundEventBody(BaseModel):
    room_name: str
    caller_phone: str
    lead_id: int | None = None
    transcript: str | None = None
    duration_seconds: int | None = None
    recording_url: str | None = None


@router.post("/inbound-event")
async def inbound_event(
    body: InboundEventBody, db: Session = Depends(get_db), _=Depends(_verify_internal_token)
):
    """
    Called by agent.py when an inbound call ends.
    Creates a CallLog entry and updates lead status if applicable.
    """
    lead = None
    if body.lead_id:
        lead = db.query(Lead).filter(Lead.id == body.lead_id).first()
    if not lead and body.caller_phone:
        clean = body.caller_phone.lstrip("+").lstrip("91")[-10:]
        lead = db.query(Lead).filter(Lead.phone.like(f"%{clean}")).first()

    outcome = _parse_outcome("", body.transcript or "")

    call_log = CallLog(
        lead_id=lead.id if lead else 0,
        vapi_call_id=body.room_name,
        vapi_assistant_id="livekit-inbound",
        phone=body.caller_phone,
        status="completed",
        outcome=outcome,
        transcript=body.transcript or "",
        duration_seconds=body.duration_seconds or 0,
        recording_url=body.recording_url or None,
        direction="inbound",
        started_at=datetime.utcnow(),
        ended_at=datetime.utcnow(),
    )
    db.add(call_log)

    if lead:
        lead.last_called_at = datetime.utcnow()
        if outcome == "appointment_booked":
            lead.status = LeadStatus.appointment_booked
        elif outcome == "interested" and lead.status not in (LeadStatus.appointment_booked,):
            lead.status = LeadStatus.interested

    db.commit()
    return {"status": "ok", "outcome": outcome}


def _parse_outcome(summary: str, transcript: str) -> str:
    text = (summary + " " + transcript).lower()

    # Appointment booked (English + Hindi)
    if any(
        kw in text
        for kw in [
            "appointment booked",
            "booking confirmed",
            "slot confirmed",
            "appointment confirmed",
            "appointment book",
            "book kar",
            "slot book",
            "appoint",
        ]
    ):
        return "appointment_booked"

    # Callback requested (English + Hindi) — check BEFORE interested
    if any(
        kw in text
        for kw in [
            "call back",
            "callback",
            "call later",
            "baad mein call",
            "baad mein baat",
            "abhi busy",
            "thodi der mein",
            "kal call",
            "shaam ko call",
            "dobaara call",
        ]
    ):
        return "callback_requested"

    # Not interested (English + Hindi)
    if any(
        kw in text
        for kw in [
            "not interested",
            "don't want",
            "nahi chahiye",
            "no interest",
            "nahi chahti",
            "interest nahi",
            "zaroorat nahi",
            "nahi lena",
            "mat karo",
            "band karo",
            "dobara mat",
        ]
    ):
        return "not_interested"

    # Interested (English + Hindi)
    if any(
        kw in text
        for kw in [
            "interested",
            "wants to consult",
            "agreed",
            "will consult",
            "haan",
            "bilkul",
            "zaroor",
            "sahi hai",
            "theek hai",
            "consult karna",
            "baat karni",
            "doctor se milna",
            "online consult",
            "yes",
            "ok",
            "okay",
        ]
    ):
        return "interested"

    # No answer
    if any(kw in text for kw in ["no answer", "voicemail", "not reachable", "phone off"]):
        return "no_answer"

    return "completed"
