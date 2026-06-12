"""
WhatsApp inbound webhook — receives messages patients send to the clinic number.

Flow:
  1. Patient replies to a WhatsApp confirmation/reminder, or messages directly.
  2. Twilio POSTs the message to /whatsapp/webhook (form-encoded).
  3. We look up the sender's phone in our lead DB.
  4. We build a context-aware prompt (appointment info, KB, lead history).
  5. OpenAI gpt-4o-mini generates a reply in the patient's language.
  6. We store both messages in WhatsAppMessage log.
  7. We return a TwiML <Response><Message> so Twilio delivers the reply.

Configure in Twilio Console:
  Messaging → WhatsApp Senders → <your number> → Webhook URL:
  https://yourbackend.com/whatsapp/webhook   (HTTP POST)
"""

import logging
import os
from datetime import datetime

import openai
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from core.database import get_db
from models.models.appointment import Appointment
from models.models.knowledge_base import KBItem, KBSection
from models.models.lead import Lead, LeadStatus
from models.models.settings import ClinicSettings
from models.models.whatsapp_log import WhatsAppMessage

logger = logging.getLogger("whatsapp")

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp"])

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# Maximum conversation turns to inject for context
MAX_HISTORY_TURNS = 6


# ── Twilio webhook ────────────────────────────────────────────────────────────


@router.post("/webhook")
async def whatsapp_webhook(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Receive inbound WhatsApp message from Twilio and reply via TwiML.
    Twilio sends form-encoded data, not JSON.
    """
    form = await request.form()

    from_raw: str = str(form.get("From", ""))  # e.g. "whatsapp:+919876543210"
    body: str = str(form.get("Body", "")).strip()
    wa_sid: str = str(form.get("MessageSid", ""))

    # Clean phone — strip "whatsapp:" prefix
    phone = from_raw.replace("whatsapp:", "").strip()

    if not phone or not body:
        return _twiml("")

    logger.info("Inbound WhatsApp from %s: %s", phone, body[:80])

    # Look up lead by phone (last 10 digits for robustness)
    lead = _find_lead_by_phone(phone, db)

    # Store inbound message
    _save_message(db, lead.id if lead else None, phone, "inbound", body, wa_sid)

    # Handle cancel/reschedule intents directly — override AI for confirmed actions
    action_reply = await _handle_appointment_action(body, lead, db)
    if action_reply:
        _save_message(db, lead.id if lead else None, phone, "outbound", action_reply)
        return _twiml(action_reply)

    # Generate AI reply for everything else
    reply = await _generate_reply(phone, body, lead, db)

    # Store outbound reply
    _save_message(db, lead.id if lead else None, phone, "outbound", reply)

    # If AI detected appointment intent, update lead status
    if lead and _is_booking_intent(body):
        if lead.status in (
            LeadStatus.interested,
            LeadStatus.callback_requested,
            LeadStatus.no_answer,
        ):
            lead.status = LeadStatus.interested
            db.commit()

    return _twiml(reply)


# ── History endpoint (for admin UI) ──────────────────────────────────────────


@router.get("/history/{lead_id}")
def whatsapp_history(lead_id: int, db: Session = Depends(get_db)):
    """Return WhatsApp conversation history for a lead."""
    msgs = (
        db.query(WhatsAppMessage)
        .filter(WhatsAppMessage.lead_id == lead_id)
        .order_by(WhatsAppMessage.created_at.asc())
        .all()
    )
    return [
        {
            "id": m.id,
            "direction": m.direction,
            "body": m.body,
            "created_at": m.created_at,
        }
        for m in msgs
    ]


# ── AI reply generation ───────────────────────────────────────────────────────


async def _generate_reply(phone: str, message: str, lead: Lead | None, db: Session) -> str:
    """
    Build context and call OpenAI gpt-4o-mini to generate a WhatsApp reply.
    Falls back to a static message if AI call fails.
    """
    if not OPENAI_API_KEY:
        return _fallback_reply(lead)

    system_prompt = _build_whatsapp_prompt(lead, db)
    history = _get_conversation_history(phone, db)

    messages: list[dict] = [{"role": "system", "content": system_prompt}]

    # Inject last N turns of conversation history
    for h in history[-MAX_HISTORY_TURNS:]:
        role = "user" if h.direction == "inbound" else "assistant"
        messages.append({"role": role, "content": h.body})

    # Current message
    messages.append({"role": "user", "content": message})

    try:
        client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)
        resp = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,  # type: ignore[arg-type]
            max_tokens=350,
            temperature=0.6,
        )
        reply = resp.choices[0].message.content or ""
        return reply.strip()
    except Exception as e:
        logger.error("OpenAI WhatsApp reply failed: %s", e)
        return _fallback_reply(lead)


def _build_whatsapp_prompt(lead: Lead | None, db: Session) -> str:
    clinic = db.query(ClinicSettings).first()
    clinic_name = clinic.clinic_name if clinic else "Our Clinic"
    doctor_name = clinic.doctor_name if clinic else "Our Team"

    # Get upcoming appointment if any
    appt_info = ""
    if lead:
        upcoming = (
            db.query(Appointment)
            .filter(
                Appointment.lead_id == lead.id,
                Appointment.status.in_(["booked", "confirmed"]),
                Appointment.appointment_date >= datetime.utcnow(),
            )
            .order_by(Appointment.appointment_date)
            .first()
        )
        if upcoming:
            appt_info = (
                f"\nPatient has an upcoming appointment on "
                f"{upcoming.appointment_date.strftime('%d %b %Y at %I:%M %p')} "
                f"({upcoming.appointment_type})."
            )

    lead_info = ""
    if lead:
        lead_info = (
            f"\nPatient name: {lead.full_name or 'Unknown'}"
            f"\nInquiry: {lead.inquiry_type or 'General'}"
            f"\nStatus: {lead.status}"
            f"{appt_info}"
        )

    # Inject a few FAQ KB items
    faqs = _get_faq_items(db)
    faq_block = ""
    if faqs:
        faq_block = "\n\nFrequently asked questions:\n" + "\n".join(
            f"Q: {f['q']}\nA: {f['a']}" for f in faqs
        )

    return f"""You are the WhatsApp assistant for {clinic_name} ({doctor_name}).

Your job is to respond warmly and helpfully to messages on WhatsApp.
- Respond in the SAME LANGUAGE the person uses (Hindi, Marathi, or English).
- Keep replies SHORT — 2-4 sentences max. WhatsApp is informal.
- For appointment booking requests: ask for preferred date, time, and whether online or in-person.
- For reschedule/cancel requests: confirm you'll pass this to the team.
- NEVER quote specific fees — say "fees ke liye team se poochh lein".
{lead_info}
{faq_block}"""


def _get_faq_items(db: Session) -> list[dict]:
    section = db.query(KBSection).filter(KBSection.slug == "faqs").first()
    if not section:
        return []
    items = (
        db.query(KBItem)
        .filter(KBItem.section_id == section.id, KBItem.is_active == True)
        .order_by(KBItem.sort_order)
        .limit(4)
        .all()
    )
    return [{"q": i.question, "a": i.answer} for i in items]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _find_lead_by_phone(phone: str, db: Session) -> Lead | None:
    # Try last 10 digits match (handles +91 prefix differences)
    suffix = phone.lstrip("+").lstrip("91")[-10:]
    return (
        db.query(Lead)
        .filter(Lead.phone.like(f"%{suffix}"))
        .filter(Lead.is_duplicate == False)
        .order_by(Lead.created_at.desc())
        .first()
    )


def _get_conversation_history(phone: str, db: Session) -> list[WhatsAppMessage]:
    suffix = phone.lstrip("+").lstrip("91")[-10:]
    return (
        db.query(WhatsAppMessage)
        .filter(WhatsAppMessage.phone.like(f"%{suffix}"))
        .order_by(WhatsAppMessage.created_at.asc())
        .limit(20)
        .all()
    )


def _save_message(
    db: Session,
    lead_id: int | None,
    phone: str,
    direction: str,
    body: str,
    wa_message_id: str = "",
) -> None:
    db.add(
        WhatsAppMessage(
            lead_id=lead_id,
            phone=phone,
            direction=direction,
            body=body,
            wa_message_id=wa_message_id or None,
        )
    )
    db.commit()


def _is_booking_intent(message: str) -> bool:
    keywords = [
        "appointment",
        "book",
        "consult",
        "appoint",
        "appointment chahiye",
        "book karna",
        "milna hai",
        "time dedo",
        "slot",
        "date",
        "time",
    ]
    lower = message.lower()
    return any(k in lower for k in keywords)


def _is_cancel_intent(message: str) -> bool:
    keywords = [
        "cancel",
        "cancellation",
        "nahi aana",
        "nahi aaunga",
        "nahi aaungi",
        "appointment cancel",
        "cancel karna",
        "cancel kar do",
        "cancel karo",
        "नहीं आना",
        "cancel chahiye",
        "rद्द",
        "रद्द",
    ]
    lower = message.lower()
    return any(k in lower for k in keywords)


def _is_reschedule_intent(message: str) -> bool:
    keywords = [
        "reschedule",
        "change date",
        "change time",
        "new time",
        "new date",
        "reschedule karna",
        "date badalna",
        "time badalna",
        "alag time",
        "postpone",
        "shift karna",
        "dusra time",
        "दूसरा टाइम",
        "बदलना",
    ]
    lower = message.lower()
    return any(k in lower for k in keywords)


def _get_upcoming_appointment(lead: Lead, db: Session) -> Appointment | None:
    return (
        db.query(Appointment)
        .filter(
            Appointment.lead_id == lead.id,
            Appointment.status.in_(["booked", "confirmed"]),
            Appointment.appointment_date >= datetime.utcnow(),
        )
        .order_by(Appointment.appointment_date)
        .first()
    )


async def _handle_appointment_action(message: str, lead: Lead | None, db: Session) -> str | None:
    """
    If message is a clear cancel or reschedule request and the patient has an
    upcoming appointment, act on it and return a confirmation reply.
    Returns None if no action is taken (falls through to AI).
    """
    if not lead:
        return None

    appt = _get_upcoming_appointment(lead, db)
    first_name = (lead.full_name or "").split()[0] or "ji"

    if _is_cancel_intent(message) and appt:
        from services.calendar_service import delete_calendar_event

        cal_event_id = appt.calendar_event_id
        appt.status = "cancelled"
        appt.cancellation_reason = "Cancelled by patient via WhatsApp"
        db.commit()

        if cal_event_id:
            try:
                delete_calendar_event(cal_event_id, db)
            except Exception:
                pass

        date_str = appt.appointment_date.strftime("%d %b %Y at %I:%M %p")
        return (
            f"Namaste {first_name} ji 🙏\n\n"
            f"Aapki appointment {date_str} cancel ho gayi hai.\n\n"
            "Naya appointment book karne ke liye is number par WhatsApp karein.\n\n"
            "— Our Team"
        )

    if _is_reschedule_intent(message) and appt:
        appt.notes = (appt.notes or "") + "\n[Reschedule requested via WhatsApp]"
        db.commit()

        date_str = appt.appointment_date.strftime("%d %b %Y at %I:%M %p")
        return (
            f"Namaste {first_name} ji 🙏\n\n"
            f"Aapki request note ho gayi hai — aap {date_str} ki appointment reschedule karna chahte hain.\n\n"
            "Apna preferred naya date aur time is message par reply karein. "
            "Hamari team jald confirm karegi. 😊\n\n"
            "— Our Team"
        )

    return None


def _fallback_reply(lead: Lead | None) -> str:
    name = (lead.full_name or "").split()[0] if lead and lead.full_name else "ji"
    return (
        f"Namaste {name} ji! 🙏 Aapka swagat hai. "
        "Appointment book karne ya kisi bhi inquiry ke liye please hume call karein "
        "ya yahan message karein. Hamari team aapki madad karegi. 😊"
    )


def _twiml(message: str) -> Response:
    # Escape XML special characters
    safe = message.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    xml = (
        f"""<?xml version="1.0" encoding="UTF-8"?><Response><Message>{safe}</Message></Response>"""
    )
    return Response(content=xml, media_type="text/xml")
