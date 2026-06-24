from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func

from .base import Base


class Client(Base):
    """A business that Vidushi Infotech serves — clinic, realty, insurance, etc."""

    __tablename__ = "client"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    business_type = Column(String(100), nullable=True)
    phone = Column(String(30), nullable=True)
    email = Column(String(255), nullable=True)
    website = Column(String(255), nullable=True)
    address = Column(Text, nullable=True)
    city = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)

    # Unique token embedded in webhook URLs so platforms can identify this client
    # e.g. POST /webhooks/hubspot/<webhook_token>
    webhook_token = Column(String(36), nullable=True, unique=True, index=True)

    # Meta Lead Ads integration
    meta_page_id = Column(String(100), nullable=True, index=True)
    meta_page_name = Column(String(255), nullable=True)
    meta_access_token = Column(Text, nullable=True)   # encrypted

    # HubSpot CRM integration
    hubspot_portal_id = Column(String(50), nullable=True)
    hubspot_api_key = Column(Text, nullable=True)          # encrypted (private app token)
    hubspot_client_secret = Column(Text, nullable=True)    # encrypted (for webhook signature)

    # Google Ads integration
    google_ads_customer_id = Column(String(50), nullable=True)
    google_ads_refresh_token = Column(Text, nullable=True) # encrypted

    # Klaviyo integration
    klaviyo_account_id = Column(String(50), nullable=True)
    klaviyo_api_key = Column(Text, nullable=True)          # encrypted (private key for webhook verify)

    # Per-client channel config (stored as JSONB; sensitive fields Fernet-encrypted inside)
    calling_config = Column(JSONB, nullable=True)    # {provider, account_sid, auth_token_enc, from_number, sip_trunk_id}
    sms_config = Column(JSONB, nullable=True)         # {provider, from_number, api_key_enc, sender_id}
    whatsapp_config = Column(JSONB, nullable=True)    # {provider, phone_number_id, access_token_enc, business_account_id}

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
