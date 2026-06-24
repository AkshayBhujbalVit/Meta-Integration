from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from .base import Base


class PlatformIntegration(Base):
    """One row per marketing platform — stores platform-level credentials and webhook token."""

    __tablename__ = "platform_integration"

    id = Column(Integer, primary_key=True)
    source = Column(String(50), nullable=False, unique=True, index=True)
    # hubspot / google / klaviyo / meta

    webhook_token = Column(String(36), nullable=True, unique=True, index=True)

    # Meta Lead Ads
    meta_page_id = Column(String(100), nullable=True)
    meta_page_name = Column(String(255), nullable=True)
    meta_access_token = Column(Text, nullable=True)  # encrypted

    # HubSpot
    hubspot_portal_id = Column(String(50), nullable=True)
    hubspot_api_key = Column(Text, nullable=True)         # encrypted — Private App token or OAuth access token
    hubspot_refresh_token = Column(Text, nullable=True)   # encrypted — OAuth refresh token (long-lived)
    hubspot_client_secret = Column(Text, nullable=True)   # encrypted — for webhook signature verification

    # Google Ads
    google_customer_id = Column(String(50), nullable=True)

    # Klaviyo
    klaviyo_account_id = Column(String(50), nullable=True)
    klaviyo_api_key = Column(Text, nullable=True)  # encrypted

    # Meta Ads — long-lived user token + selected ad account (for Campaign/Ad Set sync,
    # separate from meta_access_token above which is the Page token used for lead fetching)
    meta_user_access_token = Column(Text, nullable=True)  # encrypted
    meta_ad_account_id = Column(String(50), nullable=True)

    is_paused = Column(Boolean, default=False)  # admin kill-switch — stops auto-calling for this source

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
