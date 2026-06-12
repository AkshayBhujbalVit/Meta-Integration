"""
Twilio service — WhatsApp (preferred) and plain SMS.
All messages are attempted via WhatsApp first; falls back to SMS if WhatsApp fails.
"""

from datetime import datetime
from twilio.rest import Client
from twilio.base.exceptions import TwilioRestException
from sqlalchemy.orm import Session

from core.encryption import decrypt
from models.models.settings import MessagingConfig
from models.models.sms import SMSLog


# ── Message templates ─────────────────────────────────────────────────────────

TEMPLATES = {
    "confirmation": {
        "hindi": (
            "🙏 नमस्ते {name} जी!\n\n"
            "आपकी Dr. Sonal Gupta के साथ consultation confirm हो गई है।\n\n"
            "📅 तारीख: {date}\n"
            "🕐 समय: {time}\n"
            "💻 प्रकार: {type}\n\n"
            "{extra}"
            "किसी भी सवाल के लिए हमें इसी नंबर पर WhatsApp करें।\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
        "marathi": (
            "🙏 नमस्ते {name} जी!\n\n"
            "Dr. Sonal Gupta यांच्याशी तुमची consultation confirm झाली आहे।\n\n"
            "📅 तारीख: {date}\n"
            "🕐 वेळ: {time}\n"
            "💻 प्रकार: {type}\n\n"
            "{extra}"
            "कोणत्याही प्रश्नासाठी या नंबरवर WhatsApp करा।\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
        "english": (
            "🙏 Hello {name}!\n\n"
            "Your consultation with Dr. Sonal Gupta is confirmed.\n\n"
            "📅 Date: {date}\n"
            "🕐 Time: {time}\n"
            "💻 Type: {type}\n\n"
            "{extra}"
            "WhatsApp us on this number for any queries.\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
    },
    "reminder": {
        "hindi": (
            "🔔 नमस्ते {name} जी!\n\n"
            "याद दिलाना चाहते हैं — Dr. Sonal Gupta के साथ आपकी consultation कल है।\n\n"
            "📅 तारीख: {date}\n"
            "🕐 समय: {time}\n"
            "💻 प्रकार: {type}\n\n"
            "{extra}"
            "कोई बदलाव हो तो हमें बताएं।\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
        "marathi": (
            "🔔 नमस्ते {name} जी!\n\n"
            "आठवण: Dr. Sonal Gupta यांच्याशी उद्या consultation आहे।\n\n"
            "📅 तारीख: {date}\n"
            "🕐 वेळ: {time}\n"
            "💻 प्रकार: {type}\n\n"
            "{extra}"
            "काही बदल असल्यास आम्हाला सांगा।\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
        "english": (
            "🔔 Hello {name}!\n\n"
            "Reminder: Your consultation with Dr. Sonal Gupta is tomorrow.\n\n"
            "📅 Date: {date}\n"
            "🕐 Time: {time}\n"
            "💻 Type: {type}\n\n"
            "{extra}"
            "Let us know if you need to reschedule.\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
    },
    "cancellation": {
        "hindi": (
            "नमस्ते {name} जी।\n\n"
            "आपकी {date} की consultation cancel हो गई है।\n\n"
            "नई appointment book करने के लिए हमें इसी नंबर पर WhatsApp करें।\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
        "marathi": (
            "नमस्ते {name} जी।\n\n"
            "तुमची {date} ची consultation cancel झाली आहे।\n\n"
            "नवीन appointment बुक करण्यासाठी या नंबरवर WhatsApp करा।\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
        "english": (
            "Hello {name}.\n\n"
            "Your consultation on {date} has been cancelled.\n\n"
            "Please WhatsApp us on this number to reschedule.\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
    },
    "interested_followup": {
        "hindi": (
            "🙏 नमस्ते {name} जी!\n\n"
            "Dr. Sonal Gupta Clinic से बात करके अच्छा लगा।\n\n"
            "आप consultation book करने के लिए तैयार हों तो हमें इसी नंबर पर WhatsApp करें — हम आपकी appointment fix कर देंगे।\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
        "marathi": (
            "🙏 नमस्ते {name} जी!\n\n"
            "Dr. Sonal Gupta Clinic शी बोलणे चांगले वाटले।\n\n"
            "Consultation बुक करायची असेल तर या नंबरवर WhatsApp करा।\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
        "english": (
            "🙏 Hello {name}!\n\n"
            "Thank you for speaking with Dr. Sonal Gupta Clinic.\n\n"
            "Whenever you are ready to book a consultation, just WhatsApp us on this number.\n\n"
            "— Dr. Sonal Gupta Clinic"
        ),
    },
}


def _get_template(sms_type: str, language: str) -> str:
    lang = language.lower() if language else "hindi"
    if lang not in ("hindi", "marathi", "english"):
        lang = "hindi"
    return TEMPLATES.get(sms_type, {}).get(lang, "")


def _extra_line(appointment_type: str | None, is_online: bool) -> str:
    if is_online:
        return "📹 Video call link clinic team WhatsApp par bhejenge.\n"
    return "📍 Clinic address ke liye hume WhatsApp karo.\n"


def _format_date(dt: datetime) -> str:
    return dt.strftime("%d %b %Y")


def _format_time(dt: datetime) -> str:
    return dt.strftime("%I:%M %p")


def _type_label(appointment_type: str | None) -> str:
    if not appointment_type:
        return "Consultation"
    return "Online (Video Call)" if "online" in (appointment_type or "").lower() else "In-Clinic Visit"


# ── Core send function ────────────────────────────────────────────────────────

def send_message(
    phone: str,
    message: str,
    lead_id: int,
    sms_type: str,
    language: str,
    db: Session,
    prefer_whatsapp: bool = True,
) -> dict:
    twilio_cfg = db.query(MessagingConfig).filter(MessagingConfig.is_active == True).first()
    if not twilio_cfg or not twilio_cfg.api_key or not twilio_cfg.api_secret or not twilio_cfg.from_number:
        raise ValueError("Twilio credentials are not configured in Settings → Messaging Provider")

    account_sid = decrypt(twilio_cfg.api_key)
    auth_token  = decrypt(twilio_cfg.api_secret)
    from_number = twilio_cfg.whatsapp_number or twilio_cfg.from_number

    client = Client(account_sid, auth_token)
    sid = None
    channel = None
    error = None

    if prefer_whatsapp:
        try:
            msg = client.messages.create(
                from_=f"whatsapp:{from_number}",
                to=f"whatsapp:{phone}",
                body=message,
            )
            sid = msg.sid
            channel = "whatsapp"
        except TwilioRestException as e:
            error = str(e)

    # Fallback to plain SMS
    if not sid:
        try:
            msg = client.messages.create(
                from_=twilio_cfg.from_number or from_number,
                to=phone,
                body=message,
            )
            sid = msg.sid
            channel = "sms"
        except TwilioRestException as e:
            # Log failure and raise
            _save_log(db, lead_id, phone, message, language, sms_type, None, "failed")
            raise ValueError(f"Failed to send message: {e}")

    _save_log(db, lead_id, phone, message, language, sms_type, sid, "sent")
    return {"sid": sid, "channel": channel, "status": "sent"}


def _save_log(
    db: Session,
    lead_id: int,
    phone: str,
    message: str,
    language: str,
    sms_type: str,
    twilio_sid: str | None,
    status: str,
):
    log = SMSLog(
        lead_id=lead_id,
        phone=phone,
        message=message,
        language=language,
        sms_type=sms_type,
        twilio_sid=twilio_sid,
        status=status,
    )
    db.add(log)
    db.commit()


# ── High-level helpers ────────────────────────────────────────────────────────

def send_appointment_confirmation(lead, appointment, language: str, db: Session) -> dict:
    template = _get_template("confirmation", language)
    is_online = "online" in (appointment.appointment_type or "").lower()
    message = template.format(
        name=(lead.full_name or "Patient").split()[0],
        date=_format_date(appointment.appointment_date),
        time=_format_time(appointment.appointment_date),
        type=_type_label(appointment.appointment_type),
        extra=_extra_line(appointment.appointment_type, is_online),
    )
    return send_message(lead.phone, message, lead.id, "confirmation", language, db)


def send_appointment_reminder(lead, appointment, language: str, db: Session) -> dict:
    template = _get_template("reminder", language)
    is_online = "online" in (appointment.appointment_type or "").lower()
    message = template.format(
        name=(lead.full_name or "Patient").split()[0],
        date=_format_date(appointment.appointment_date),
        time=_format_time(appointment.appointment_date),
        type=_type_label(appointment.appointment_type),
        extra=_extra_line(appointment.appointment_type, is_online),
    )
    return send_message(lead.phone, message, lead.id, "reminder", language, db)


def send_appointment_cancellation(lead, appointment, language: str, db: Session) -> dict:
    template = _get_template("cancellation", language)
    message = template.format(
        name=(lead.full_name or "Patient").split()[0],
        date=_format_date(appointment.appointment_date),
    )
    return send_message(lead.phone, message, lead.id, "cancellation", language, db)


def send_interested_followup(lead, language: str, db: Session) -> dict:
    template = _get_template("interested_followup", language)
    message = template.format(
        name=(lead.full_name or "Patient").split()[0],
    )
    return send_message(lead.phone, message, lead.id, "interested_followup", language, db)
