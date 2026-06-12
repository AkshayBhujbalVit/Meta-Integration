from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from .base import Base


class CalendarConfig(Base):
    """Calendar integration config — Google, CalDav, or local-only."""

    __tablename__ = "calendar_config"

    id = Column(Integer, primary_key=True, index=True)

    # Which provider to use
    calendar_provider = Column(String(30), default="google")  # google / caldav / local

    # Shared
    calendar_id = Column(String(255), nullable=True, default="primary")
    is_active = Column(Boolean, default=False)

    # Google Calendar — service account JSON
    credentials_json = Column(Text, nullable=True)

    # CalDav — covers Apple iCloud, Outlook 365, Nextcloud, Fastmail, etc.
    caldav_url = Column(String(500), nullable=True)  # e.g. https://caldav.icloud.com
    caldav_username = Column(String(255), nullable=True)
    caldav_password = Column(Text, nullable=True)  # encrypted

    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class ClinicSettings(Base):
    """General clinic info and configuration."""

    __tablename__ = "clinic_settings"

    id = Column(Integer, primary_key=True, index=True)
    clinic_name = Column(String(255), nullable=True)
    doctor_name = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=True)
    email = Column(String(255), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(100), nullable=True)
    website = Column(String(255), nullable=True)
    timings = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class CallingConfig(Base):
    """Pluggable AI calling provider — Vapi, Bland AI, Retell AI, or custom webhook."""

    __tablename__ = "calling_config"

    id = Column(Integer, primary_key=True, index=True)

    # Which provider to use
    provider = Column(String(30), default="vapi")  # vapi / bland / retell / custom

    # Agent identity
    agent_name = Column(String(100), nullable=True, default="AI Calling Assistant")

    # Generic credentials
    api_key = Column(String(255), nullable=True)  # API key / auth token for the provider
    agent_id = Column(String(100), nullable=True)  # Vapi: assistant_id | Bland/Retell: agent_id

    # LLM model
    llm_model = Column(String(50), nullable=True, default="gpt-4o")

    # Voice settings
    voice_provider = Column(String(30), nullable=True, default="11labs")
    voice_id = Column(String(100), nullable=True)

    # Base system prompt (gets merged with dynamic KB prompt at call time)
    system_prompt = Column(Text, nullable=True)

    # Call scheduling rules
    language_default = Column(String(20), default="hindi")
    call_start_time = Column(String(10), default="09:00")  # don't call before
    call_end_time = Column(String(10), default="20:00")  # don't call after
    max_retries = Column(Integer, default=3)
    retry_gap_hours = Column(Integer, default=24)

    # Phone number provider — the telephony company providing the India calling number
    phone_provider = Column(
        String(30), nullable=True
    )  # twilio / plivo / exotel / vonage / airtel / msg91 / custom

    # Vapi outbound phone number (Vapi phoneNumberId — the "from" number for outbound calls)
    phone_number_id = Column(String(100), nullable=True)

    # Auto-start calling after CSV upload
    auto_call_on_upload = Column(Boolean, default=False)

    # Voice settings for the AI agent
    agent_voice = Column(
        String(30), default="alloy"
    )  # alloy/echo/onyx/nova/shimmer/ash/coral/sage/verse

    # Custom webhook (provider = "custom")
    webhook_url = Column(String(500), nullable=True)
    webhook_headers = Column(Text, nullable=True)  # JSON string of extra headers

    # LiveKit credentials — stored encrypted at rest
    livekit_url = Column(Text, nullable=True)
    livekit_api_key = Column(Text, nullable=True)  # encrypted
    livekit_api_secret = Column(Text, nullable=True)  # encrypted
    livekit_sip_trunk_id = Column(String(100), nullable=True)

    # Twilio credentials (SIP trunk for outbound calls) — stored encrypted at rest
    twilio_account_sid = Column(Text, nullable=True)  # encrypted
    twilio_auth_token = Column(Text, nullable=True)  # encrypted
    twilio_from_number = Column(String(30), nullable=True)

    # Inbound SIP — separate trunk for receiving calls (optional)
    inbound_sip_trunk_id = Column(String(100), nullable=True)
    inbound_phone_number = Column(String(30), nullable=True)  # display only

    # VoBiz credentials — SIP trunk provider (130+ countries), stored encrypted at rest
    # Get from console.vobiz.ai → SIP Trunk settings
    vobiz_auth_id = Column(Text, nullable=True)  # encrypted — X-Auth-ID REST API header
    vobiz_auth_token = Column(Text, nullable=True)  # encrypted — X-Auth-Token REST API header
    vobiz_phone_number = Column(String(30), nullable=True)  # caller ID / inbound number
    vobiz_sip_domain = Column(String(255), nullable=True)  # <your-domain>.sip.vobiz.ai
    vobiz_sip_username = Column(Text, nullable=True)  # encrypted — SIP trunk username
    vobiz_sip_password = Column(Text, nullable=True)  # encrypted — SIP trunk password

    is_active = Column(Boolean, default=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class MessagingConfig(Base):
    """Pluggable messaging provider — Twilio, MSG91, Fast2SMS, or custom webhook."""

    __tablename__ = "messaging_config"

    id = Column(Integer, primary_key=True, index=True)

    # Which provider to use
    provider = Column(String(30), default="twilio")  # twilio / msg91 / fast2sms / custom

    # Generic credentials
    api_key = Column(String(255), nullable=True)  # Twilio: account_sid | MSG91/Fast2SMS: api_key
    api_secret = Column(String(255), nullable=True)  # Twilio: auth_token  | others: leave blank

    # Sender numbers
    from_number = Column(String(30), nullable=True)  # SMS sender number
    whatsapp_number = Column(String(30), nullable=True)  # WhatsApp sender (may differ from SMS)

    # Custom webhook (provider = "custom")
    webhook_url = Column(String(500), nullable=True)
    webhook_headers = Column(Text, nullable=True)  # JSON string of extra headers

    # Optional separate WhatsApp provider — null = use same as SMS provider above
    whatsapp_provider = Column(String(30), nullable=True)
    whatsapp_api_key = Column(Text, nullable=True)  # encrypted — null = use api_key
    whatsapp_api_secret = Column(Text, nullable=True)  # encrypted — null = use api_secret

    # Feature flags
    is_whatsapp_enabled = Column(Boolean, default=True)
    is_sms_enabled = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
