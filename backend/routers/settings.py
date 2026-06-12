from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from core.encryption import encrypt
from models.models.settings import CalendarConfig, CallingConfig, ClinicSettings, MessagingConfig
from services.calendar_service import test_calendar_connection
from services.calling_service import DEFAULT_INSTRUCTIONS

router = APIRouter(prefix="/settings", tags=["Settings"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class ClinicSettingsUpdate(BaseModel):
    clinic_name: str | None = None
    doctor_name: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    city: str | None = None
    website: str | None = None
    timings: str | None = None


class CallingConfigUpdate(BaseModel):
    # Agent identity
    agent_name: str | None = None
    agent_voice: str | None = None  # alloy/echo/onyx/nova/shimmer/ash/coral/sage/verse
    # AI calling provider — vapi / bland / retell / bolna / sarvam / custom
    provider: str | None = None
    api_key: str | None = None
    agent_id: str | None = None  # Vapi: assistant_id | Bland/Retell: agent_id
    # LLM + voice
    llm_model: str | None = None
    voice_provider: str | None = None
    voice_id: str | None = None
    # Prompt + language
    system_prompt: str | None = None
    language_default: str | None = None
    # Call schedule
    call_start_time: str | None = None
    call_end_time: str | None = None
    max_retries: int | None = None
    retry_gap_hours: int | None = None
    # Phone number provider — twilio / plivo / exotel / vonage / airtel / msg91 / custom
    phone_provider: str | None = None
    # Outbound phone number ID (imported into the AI provider)
    phone_number_id: str | None = None
    # Auto-start calling after CSV upload
    auto_call_on_upload: bool | None = None
    # Custom provider fields
    webhook_url: str | None = None
    webhook_headers: str | None = None  # JSON string


class CalendarConfigUpdate(BaseModel):
    calendar_provider: str | None = None  # google / caldav / local
    calendar_id: str | None = None
    credentials_json: str | None = None
    is_active: bool | None = None
    # CalDav fields
    caldav_url: str | None = None
    caldav_username: str | None = None
    caldav_password: str | None = None  # stored encrypted


class CalendarTestRequest(BaseModel):
    credentials_json: str
    calendar_id: str | None = "primary"


class CalDavTestRequest(BaseModel):
    url: str
    username: str
    password: str


class MessagingConfigUpdate(BaseModel):
    # Provider — twilio / msg91 / fast2sms / custom
    provider: str | None = None
    api_key: str | None = None  # Twilio: account_sid | MSG91: api_key | etc.
    api_secret: str | None = None  # Twilio: auth_token (others may leave blank)
    from_number: str | None = None  # SMS sender number
    whatsapp_number: str | None = None  # WhatsApp sender (may differ from SMS)
    is_whatsapp_enabled: bool | None = None
    is_sms_enabled: bool | None = None
    # Custom webhook fields
    webhook_url: str | None = None
    webhook_headers: str | None = None  # JSON string
    # Separate WhatsApp provider — null = same as SMS provider above
    whatsapp_provider: str | None = None
    whatsapp_api_key: str | None = None
    whatsapp_api_secret: str | None = None


# ── Clinic settings ───────────────────────────────────────────────────────────


@router.get("/clinic")
def get_clinic_settings(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    s = db.query(ClinicSettings).first()
    if not s:
        raise HTTPException(status_code=404, detail="Clinic settings not found")
    return {
        "clinic_name": s.clinic_name,
        "doctor_name": s.doctor_name,
        "phone": s.phone,
        "email": s.email,
        "address": s.address,
        "city": s.city,
        "website": s.website,
        "timings": s.timings,
    }


@router.patch("/clinic")
def update_clinic_settings(
    body: ClinicSettingsUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    s = db.query(ClinicSettings).first()
    if not s:
        raise HTTPException(status_code=404, detail="Clinic settings not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(s, field, value)

    db.commit()
    return {"message": "Clinic settings updated"}


# ── Calling config ────────────────────────────────────────────────────────────


@router.get("/calling")
def get_calling_config(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    c = db.query(CallingConfig).first()
    if not c:
        raise HTTPException(status_code=404, detail="Calling config not found")
    return {
        "agent_name": c.agent_name,
        "agent_voice": c.agent_voice or "alloy",
        "provider": c.provider,
        "agent_id": c.agent_id,
        "api_key_set": bool(c.api_key),
        "llm_model": c.llm_model,
        "voice_provider": c.voice_provider,
        "voice_id": c.voice_id,
        "system_prompt": c.system_prompt,
        "language_default": c.language_default,
        "call_start_time": c.call_start_time,
        "call_end_time": c.call_end_time,
        "max_retries": c.max_retries,
        "retry_gap_hours": c.retry_gap_hours,
        "phone_provider": c.phone_provider,
        "phone_number_id": c.phone_number_id,
        "auto_call_on_upload": c.auto_call_on_upload,
        "default_system_prompt": DEFAULT_INSTRUCTIONS,
        "webhook_url": c.webhook_url,
        "webhook_headers": c.webhook_headers,
        "is_active": c.is_active,
        "supported_providers": ["livekit", "bland", "retell", "custom"],
    }


@router.patch("/calling")
def update_calling_config(
    body: CallingConfigUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    c = db.query(CallingConfig).first()
    if not c:
        raise HTTPException(status_code=404, detail="Calling config not found")

    valid_providers = {"vapi", "bland", "retell", "bolna", "sarvam", "exotel", "plivo", "custom"}
    if body.provider and body.provider not in valid_providers:
        raise HTTPException(
            status_code=400, detail=f"provider must be one of: {', '.join(sorted(valid_providers))}"
        )

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(c, field, value)

    db.commit()
    return {"message": f"Calling config updated (provider: {c.provider})"}


# ── Calling credentials (encrypted at rest) ───────────────────────────────────


class CallingCredentialsUpdate(BaseModel):
    livekit_url: str | None = None
    livekit_api_key: str | None = None
    livekit_api_secret: str | None = None
    livekit_sip_trunk_id: str | None = None
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None
    inbound_phone_number: str | None = None
    # VoBiz SIP trunk
    vobiz_auth_id: str | None = None
    vobiz_auth_token: str | None = None
    vobiz_phone_number: str | None = None
    vobiz_sip_domain: str | None = None
    vobiz_sip_username: str | None = None
    vobiz_sip_password: str | None = None


@router.get("/calling/credentials")
def get_calling_credentials(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    c = db.query(CallingConfig).first()
    if not c:
        raise HTTPException(status_code=404, detail="Calling config not found")
    return {
        "livekit_url": c.livekit_url or "",
        "livekit_api_key_set": bool(c.livekit_api_key),
        "livekit_api_secret_set": bool(c.livekit_api_secret),
        "livekit_sip_trunk_id": c.livekit_sip_trunk_id or "",
        "twilio_account_sid_set": bool(c.twilio_account_sid),
        "twilio_auth_token_set": bool(c.twilio_auth_token),
        "twilio_from_number": c.twilio_from_number or "",
        "inbound_phone_number": c.inbound_phone_number or "",
        # VoBiz
        "vobiz_auth_id_set": bool(c.vobiz_auth_id),
        "vobiz_auth_token_set": bool(c.vobiz_auth_token),
        "vobiz_phone_number": c.vobiz_phone_number or "",
        "vobiz_sip_domain": c.vobiz_sip_domain or "",
        "vobiz_sip_username_set": bool(c.vobiz_sip_username),
        "vobiz_sip_password_set": bool(c.vobiz_sip_password),
    }


@router.patch("/calling/credentials")
def update_calling_credentials(
    body: CallingCredentialsUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    c = db.query(CallingConfig).first()
    if not c:
        raise HTTPException(status_code=404, detail="Calling config not found")

    if body.livekit_url is not None:
        c.livekit_url = body.livekit_url
    if body.livekit_api_key:
        c.livekit_api_key = encrypt(body.livekit_api_key)
    if body.livekit_api_secret:
        c.livekit_api_secret = encrypt(body.livekit_api_secret)
    if body.livekit_sip_trunk_id is not None:
        c.livekit_sip_trunk_id = body.livekit_sip_trunk_id
    if body.twilio_account_sid:
        c.twilio_account_sid = encrypt(body.twilio_account_sid)
    if body.twilio_auth_token:
        c.twilio_auth_token = encrypt(body.twilio_auth_token)
    if body.twilio_from_number is not None:
        c.twilio_from_number = body.twilio_from_number
    if body.inbound_phone_number is not None:
        c.inbound_phone_number = body.inbound_phone_number

    # VoBiz credentials
    if body.vobiz_auth_id:
        c.vobiz_auth_id = encrypt(body.vobiz_auth_id)
    if body.vobiz_auth_token:
        c.vobiz_auth_token = encrypt(body.vobiz_auth_token)
    if body.vobiz_phone_number is not None:
        c.vobiz_phone_number = body.vobiz_phone_number
    if body.vobiz_sip_domain is not None:
        c.vobiz_sip_domain = body.vobiz_sip_domain
    if body.vobiz_sip_username:
        c.vobiz_sip_username = encrypt(body.vobiz_sip_username)
    if body.vobiz_sip_password:
        c.vobiz_sip_password = encrypt(body.vobiz_sip_password)

    db.commit()
    return {"message": "Calling credentials updated and encrypted"}


# ── Calendar config ───────────────────────────────────────────────────────────


@router.get("/calendar")
def get_calendar_config(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    c = db.query(CalendarConfig).first()
    if not c:
        return {
            "calendar_provider": "google",
            "calendar_id": "primary",
            "credentials_set": False,
            "is_active": False,
            "caldav_url": "",
            "caldav_username": "",
            "caldav_password_set": False,
        }
    return {
        "calendar_provider": getattr(c, "calendar_provider", None) or "google",
        "calendar_id": c.calendar_id or "primary",
        "credentials_set": bool(c.credentials_json),
        "is_active": c.is_active,
        "caldav_url": getattr(c, "caldav_url", None) or "",
        "caldav_username": getattr(c, "caldav_username", None) or "",
        "caldav_password_set": bool(getattr(c, "caldav_password", None)),
    }


@router.patch("/calendar")
def update_calendar_config(
    body: CalendarConfigUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    c = db.query(CalendarConfig).first()
    if not c:
        c = CalendarConfig()
        db.add(c)

    if body.calendar_provider is not None:
        c.calendar_provider = body.calendar_provider
    if body.calendar_id is not None:
        c.calendar_id = body.calendar_id
    if body.credentials_json is not None:
        c.credentials_json = encrypt(body.credentials_json)
    if body.is_active is not None:
        c.is_active = body.is_active
    if body.caldav_url is not None:
        c.caldav_url = body.caldav_url
    if body.caldav_username is not None:
        c.caldav_username = body.caldav_username
    if body.caldav_password:
        c.caldav_password = encrypt(body.caldav_password)

    db.commit()
    return {"message": "Calendar config updated", "is_active": c.is_active}


@router.post("/calendar/test")
def test_calendar_config(
    body: CalendarTestRequest,
    _=Depends(get_current_admin),
):
    result = test_calendar_connection(body.credentials_json, body.calendar_id or "primary")
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"message": f"Connected to: {result['calendar_name']}"}


@router.post("/calendar/test-caldav")
def test_caldav_config(
    body: CalDavTestRequest,
    _=Depends(get_current_admin),
):
    from services.calendar_service import test_caldav_connection

    result = test_caldav_connection(body.url, body.username, body.password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    names = ", ".join(result.get("calendar_names", []))
    return {"message": f"Connected! Calendars found: {names}"}


# ── Messaging config ──────────────────────────────────────────────────────────


@router.get("/messaging")
def get_messaging_config(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    m = db.query(MessagingConfig).first()
    if not m:
        raise HTTPException(status_code=404, detail="Messaging config not found")
    return {
        "provider": m.provider,
        "api_key_set": bool(m.api_key),
        "api_secret_set": bool(m.api_secret),
        "from_number": m.from_number,
        "whatsapp_number": m.whatsapp_number,
        "is_whatsapp_enabled": m.is_whatsapp_enabled,
        "is_sms_enabled": m.is_sms_enabled,
        "webhook_url": m.webhook_url,
        "webhook_headers": m.webhook_headers,
        "whatsapp_provider": m.whatsapp_provider,
        "whatsapp_api_key_set": bool(m.whatsapp_api_key),
        "whatsapp_api_secret_set": bool(m.whatsapp_api_secret),
        "is_active": m.is_active,
        "supported_providers": ["twilio", "msg91", "fast2sms", "custom"],
    }


@router.patch("/messaging")
def update_messaging_config(
    body: MessagingConfigUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    m = db.query(MessagingConfig).first()
    if not m:
        raise HTTPException(status_code=404, detail="Messaging config not found")

    if body.provider and body.provider not in ("twilio", "msg91", "fast2sms", "custom"):
        raise HTTPException(
            status_code=400, detail="provider must be one of: twilio, msg91, fast2sms, custom"
        )

    data = body.model_dump(exclude_none=True)

    # Encrypt sensitive fields before saving
    if "api_key" in data and data["api_key"]:
        data["api_key"] = encrypt(data["api_key"])
    if "api_secret" in data and data["api_secret"]:
        data["api_secret"] = encrypt(data["api_secret"])
    if "whatsapp_api_key" in data and data["whatsapp_api_key"]:
        data["whatsapp_api_key"] = encrypt(data["whatsapp_api_key"])
    if "whatsapp_api_secret" in data and data["whatsapp_api_secret"]:
        data["whatsapp_api_secret"] = encrypt(data["whatsapp_api_secret"])

    for field, value in data.items():
        setattr(m, field, value)

    db.commit()
    return {"message": f"Messaging config updated (provider: {m.provider})"}
