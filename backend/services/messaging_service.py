"""
Messaging service — pluggable WhatsApp + SMS provider.

Supported providers:
  twilio     — Twilio (international)
  msg91      — MSG91 (India)
  fast2sms   — Fast2SMS (India, SMS only)
  custom     — Any HTTP webhook (admin-configured URL + headers)

Provider is selected from messaging_config.provider in DB.
WhatsApp is attempted first; falls back to SMS if WhatsApp fails or is disabled.
"""

import json
import os
from datetime import datetime

from sqlalchemy.orm import Session

from core.encryption import decrypt
from core.http_client import sync_client
from core.security import create_appointment_token
from models.models.settings import MessagingConfig
from models.models.sms import SMSLog

# ── Message templates ─────────────────────────────────────────────────────────

TEMPLATES = {
    "confirmation": {
        "hindi": (
            "🙏 नमस्ते {name} जी!\n\n"
            "आपकी our team के साथ consultation confirm हो गई है।\n\n"
            "📅 तारीख: {date}\n"
            "🕐 समय: {time}\n"
            "💻 प्रकार: {type}\n\n"
            "{extra}"
            "❌ Cancel: {cancel_url}\n"
            "🔄 Reschedule: {reschedule_url}\n\n"
            "किसी भी सवाल के लिए हमें इसी नंबर पर WhatsApp करें।\n\n"
            "— Our Team"
        ),
        "marathi": (
            "🙏 नमस्ते {name} जी!\n\n"
            "our team यांच्याशी तुमची consultation confirm झाली आहे।\n\n"
            "📅 तारीख: {date}\n"
            "🕐 वेळ: {time}\n"
            "💻 प्रकार: {type}\n\n"
            "{extra}"
            "❌ Cancel: {cancel_url}\n"
            "🔄 Reschedule: {reschedule_url}\n\n"
            "कोणत्याही प्रश्नासाठी या नंबरवर WhatsApp करा।\n\n"
            "— Our Team"
        ),
        "english": (
            "🙏 Hello {name}!\n\n"
            "Your consultation with our team is confirmed.\n\n"
            "📅 Date: {date}\n"
            "🕐 Time: {time}\n"
            "💻 Type: {type}\n\n"
            "{extra}"
            "❌ Cancel: {cancel_url}\n"
            "🔄 Reschedule: {reschedule_url}\n\n"
            "WhatsApp us on this number for any queries.\n\n"
            "— Our Team"
        ),
    },
    "reminder": {
        "hindi": (
            "🔔 नमस्ते {name} जी!\n\n"
            "याद दिलाना चाहते हैं — our team के साथ कल आपकी consultation है।\n\n"
            "📅 तारीख: {date}\n"
            "🕐 समय: {time}\n"
            "💻 प्रकार: {type}\n\n"
            "{extra}"
            "कोई बदलाव हो तो हमें बताएं।\n\n"
            "— Our Team"
        ),
        "marathi": (
            "🔔 नमस्ते {name} जी!\n\n"
            "आठवण: our team यांच्याशी उद्या consultation आहे।\n\n"
            "📅 तारीख: {date}\n"
            "🕐 वेळ: {time}\n"
            "💻 प्रकार: {type}\n\n"
            "{extra}"
            "काही बदल असल्यास आम्हाला सांगा।\n\n"
            "— Our Team"
        ),
        "english": (
            "🔔 Hello {name}!\n\n"
            "Reminder: Your consultation with our team is tomorrow.\n\n"
            "📅 Date: {date}\n"
            "🕐 Time: {time}\n"
            "💻 Type: {type}\n\n"
            "{extra}"
            "Let us know if you need to reschedule.\n\n"
            "— Our Team"
        ),
    },
    "cancellation": {
        "hindi": (
            "नमस्ते {name} जी।\n\n"
            "आपकी {date} की consultation cancel हो गई है।\n\n"
            "नई appointment book करने के लिए हमें इसी नंबर पर WhatsApp करें।\n\n"
            "— Our Team"
        ),
        "marathi": (
            "नमस्ते {name} जी।\n\n"
            "तुमची {date} ची consultation cancel झाली आहे।\n\n"
            "नवीन appointment बुक करण्यासाठी या नंबरवर WhatsApp करा।\n\n"
            "— Our Team"
        ),
        "english": (
            "Hello {name}.\n\n"
            "Your consultation on {date} has been cancelled.\n\n"
            "Please WhatsApp us on this number to reschedule.\n\n"
            "— Our Team"
        ),
    },
    "interested_followup": {
        "hindi": (
            "🙏 नमस्ते {name} जी!\n\n"
            "Our Team से बात करके अच्छा लगा।\n\n"
            "Consultation book करने के लिए तैयार हों तो हमें इसी नंबर पर WhatsApp करें।\n\n"
            "— Our Team"
        ),
        "marathi": (
            "🙏 नमस्ते {name} जी!\n\n"
            "Our Team शी बोलणे चांगले वाटले।\n\n"
            "Consultation बुक करायची असेल तर या नंबरवर WhatsApp करा।\n\n"
            "— Our Team"
        ),
        "english": (
            "🙏 Hello {name}!\n\n"
            "Thank you for speaking with Our Team.\n\n"
            "Whenever you are ready to book, just WhatsApp us on this number.\n\n"
            "— Our Team"
        ),
    },
}


def get_template(sms_type: str, language: str) -> str:
    lang = (language or "hindi").lower()
    if lang not in ("hindi", "marathi", "english"):
        lang = "hindi"
    return TEMPLATES.get(sms_type, {}).get(lang, "")


def _type_label(appointment_type: str | None) -> str:
    if not appointment_type:
        return "Consultation"
    return (
        "Online (Video Call)" if "online" in (appointment_type or "").lower() else "In-Clinic Visit"
    )


def _extra_line(appointment_type: str | None) -> str:
    is_online = "online" in (appointment_type or "").lower()
    if is_online:
        return "📹 Video call link clinic team WhatsApp par bhejenge.\n"
    return "📍 Clinic address ke liye hume WhatsApp karo.\n"


def _fmt_date(dt: datetime) -> str:
    return dt.strftime("%d %b %Y")


def _fmt_time(dt: datetime) -> str:
    return dt.strftime("%I:%M %p")


# ── Core send ─────────────────────────────────────────────────────────────────


def send_message(
    phone: str,
    message: str,
    lead_id: int,
    sms_type: str,
    language: str,
    db: Session,
) -> dict:
    cfg = db.query(MessagingConfig).filter(MessagingConfig.is_active == True).first()
    if not cfg:
        raise ValueError("Messaging provider is not configured in settings")

    provider = (cfg.provider or "twilio").lower()
    sid = None
    channel = None
    error_log = []

    # Try WhatsApp first
    if cfg.is_whatsapp_enabled:
        whatsapp_from = cfg.whatsapp_number or cfg.from_number
        try:
            sid = _send_whatsapp(provider, cfg, phone, message, whatsapp_from)
            channel = "whatsapp"
        except Exception as e:
            error_log.append(f"WhatsApp failed ({provider}): {e}")

    # Fallback to SMS
    if not sid and cfg.is_sms_enabled:
        try:
            sid = _send_sms(provider, cfg, phone, message)
            channel = "sms"
        except Exception as e:
            error_log.append(f"SMS failed ({provider}): {e}")

    if not sid:
        _save_log(db, lead_id, phone, message, language, sms_type, None, "failed")
        raise ValueError(f"All send attempts failed: {'; '.join(error_log)}")

    _save_log(db, lead_id, phone, message, language, sms_type, sid, "sent")
    return {"sid": sid, "channel": channel, "provider": provider, "status": "sent"}


# ── Provider dispatch ─────────────────────────────────────────────────────────


def _send_whatsapp(
    provider: str, cfg: MessagingConfig, phone: str, message: str, from_num: str
) -> str:
    wa_provider = cfg.whatsapp_provider or provider
    wa_from = cfg.whatsapp_number or from_num
    if wa_provider == "twilio":
        wa_key = (decrypt(cfg.whatsapp_api_key) if cfg.whatsapp_api_key else None) or decrypt(
            cfg.api_key
        )
        wa_secret = (
            decrypt(cfg.whatsapp_api_secret) if cfg.whatsapp_api_secret else None
        ) or decrypt(cfg.api_secret)
        from twilio.rest import Client

        msg = Client(wa_key, wa_secret).messages.create(
            from_=f"whatsapp:{wa_from}", to=f"whatsapp:{phone}", body=message
        )
        return msg.sid
    elif wa_provider == "msg91":
        return _msg91_whatsapp(cfg, phone, message)
    elif wa_provider == "custom":
        return _custom_webhook(cfg, phone, message, channel="whatsapp")
    else:
        raise ValueError(f"Provider '{wa_provider}' does not support WhatsApp")


def _send_sms(provider: str, cfg: MessagingConfig, phone: str, message: str) -> str:
    if provider == "twilio":
        return _twilio_send(cfg, cfg.from_number, phone, message)
    elif provider == "msg91":
        return _msg91_sms(cfg, phone, message)
    elif provider == "fast2sms":
        return _fast2sms_send(cfg, phone, message)
    elif provider == "custom":
        return _custom_webhook(cfg, phone, message, channel="sms")
    else:
        raise ValueError(f"Unknown provider: {provider}")


# ── Twilio ────────────────────────────────────────────────────────────────────


def _twilio_send(cfg: MessagingConfig, from_: str, to: str, body: str) -> str:
    from twilio.rest import Client

    client = Client(decrypt(cfg.api_key), decrypt(cfg.api_secret))
    msg = client.messages.create(from_=from_, to=to, body=body)
    return msg.sid


# ── MSG91 ─────────────────────────────────────────────────────────────────────


def _msg91_sms(cfg: MessagingConfig, phone: str, message: str) -> str:
    # Strip +91 prefix — MSG91 needs 10-digit mobile
    mobile = phone.lstrip("+")
    resp = sync_client().post(
        "https://api.msg91.com/api/v5/flow/",
        headers={"authkey": decrypt(cfg.api_key), "Content-Type": "application/json"},
        json={
            "flow_id": "",  # set up flow in MSG91 dashboard
            "sender": cfg.from_number or "TEAM",
            "mobiles": mobile,
            "body": message,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("request_id") or data.get("message") or "sent"


def _msg91_whatsapp(cfg: MessagingConfig, phone: str, message: str) -> str:
    mobile = phone.lstrip("+")
    resp = sync_client().post(
        "https://api.msg91.com/api/v5/whatsapp/whatsappmessage/",
        headers={"authkey": decrypt(cfg.api_key), "Content-Type": "application/json"},
        json={
            "integrated_number": cfg.whatsapp_number or cfg.from_number,
            "content_type": "template",
            "payload": {
                "to": mobile,
                "type": "text",
                "text": {"body": message},
            },
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("request_id") or data.get("message") or "sent"


# ── Fast2SMS (SMS only) ───────────────────────────────────────────────────────


def _fast2sms_send(cfg: MessagingConfig, phone: str, message: str) -> str:
    # Fast2SMS needs 10-digit number
    mobile = phone[-10:] if len(phone) >= 10 else phone
    resp = sync_client().post(
        "https://www.fast2sms.com/dev/bulkV2",
        headers={"authorization": decrypt(cfg.api_key)},
        params={
            "route": "q",
            "message": message,
            "language": "unicode",
            "flash": 0,
            "numbers": mobile,
        },
        timeout=15,
    )
    resp.raise_for_status()
    data = resp.json()
    if not data.get("return"):
        raise ValueError(data.get("message", "Fast2SMS error"))
    return data.get("request_id") or "sent"


# ── Custom webhook ────────────────────────────────────────────────────────────


def _custom_webhook(cfg: MessagingConfig, phone: str, message: str, channel: str) -> str:
    if not cfg.webhook_url:
        raise ValueError("Custom webhook URL is not configured")

    headers = {"Content-Type": "application/json"}
    if cfg.webhook_headers:
        try:
            extra = json.loads(cfg.webhook_headers)
            headers.update(extra)
        except Exception:
            pass

    payload = {
        "to": phone,
        "message": message,
        "channel": channel,
        "from": cfg.whatsapp_number if channel == "whatsapp" else cfg.from_number,
    }

    resp = sync_client().post(cfg.webhook_url, headers=headers, json=payload, timeout=15)
    resp.raise_for_status()
    try:
        data = resp.json()
        return data.get("id") or data.get("sid") or data.get("message_id") or "sent"
    except Exception:
        return "sent"


# ── DB log ────────────────────────────────────────────────────────────────────


def _save_log(db, lead_id, phone, message, language, sms_type, sid, status):
    db.add(
        SMSLog(
            lead_id=lead_id,
            phone=phone,
            message=message,
            language=language,
            sms_type=sms_type,
            twilio_sid=sid,
            status=status,
        )
    )
    db.commit()


# ── High-level helpers ────────────────────────────────────────────────────────


def send_appointment_confirmation(lead, appointment, language: str, db: Session) -> dict:
    base_url = os.getenv("BACKEND_PUBLIC_URL", "http://localhost:8009")
    cancel_token = create_appointment_token(appointment.id, "cancel")
    reschedule_token = create_appointment_token(appointment.id, "reschedule")
    cancel_url = f"{base_url}/appointments/action?token={cancel_token}"
    reschedule_url = f"{base_url}/appointments/action?token={reschedule_token}"

    template = get_template("confirmation", language)
    message = template.format(
        name=(lead.full_name or "Patient").split()[0],
        date=_fmt_date(appointment.appointment_date),
        time=_fmt_time(appointment.appointment_date),
        type=_type_label(appointment.appointment_type),
        extra=_extra_line(appointment.appointment_type),
        cancel_url=cancel_url,
        reschedule_url=reschedule_url,
    )
    return send_message(lead.phone, message, lead.id, "confirmation", language, db)


def send_appointment_reminder(lead, appointment, language: str, db: Session) -> dict:
    template = get_template("reminder", language)
    message = template.format(
        name=(lead.full_name or "Patient").split()[0],
        date=_fmt_date(appointment.appointment_date),
        time=_fmt_time(appointment.appointment_date),
        type=_type_label(appointment.appointment_type),
        extra=_extra_line(appointment.appointment_type),
    )
    return send_message(lead.phone, message, lead.id, "reminder", language, db)


def send_appointment_cancellation(lead, appointment, language: str, db: Session) -> dict:
    template = get_template("cancellation", language)
    message = template.format(
        name=(lead.full_name or "Patient").split()[0],
        date=_fmt_date(appointment.appointment_date),
    )
    return send_message(lead.phone, message, lead.id, "cancellation", language, db)


def send_interested_followup(lead, language: str, db: Session) -> dict:
    template = get_template("interested_followup", language)
    message = template.format(name=(lead.full_name or "Patient").split()[0])
    return send_message(lead.phone, message, lead.id, "interested_followup", language, db)
