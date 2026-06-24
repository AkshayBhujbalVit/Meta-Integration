import enum

from sqlalchemy import Boolean, Column, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.sql import func

from .base import Base


class CampaignStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    paused = "paused"
    completed = "completed"


class Campaign(Base):
    """A calling campaign under a specific client."""

    __tablename__ = "campaign"

    id = Column(Integer, primary_key=True, index=True)
    client_id = Column(Integer, ForeignKey("client.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(30), default=CampaignStatus.draft)

    # Agent configuration for this campaign
    agent_name = Column(String(100), nullable=True, default="AI Calling Assistant")
    agent_prompt = Column(Text, nullable=True)          # full system prompt for the AI
    language_default = Column(String(20), default="hindi")
    agent_voice = Column(String(30), default="alloy")   # alloy/echo/onyx/nova/shimmer

    # Calling schedule
    call_start_time = Column(String(10), default="09:00")
    call_end_time = Column(String(10), default="20:00")
    max_retries = Column(Integer, default=3)
    retry_gap_hours = Column(Integer, default=24)

    # Caller phone number for outbound calls
    caller_phone_number = Column(String(30), nullable=True)

    # Which platform(s) feed leads into this campaign
    # Comma-separated: meta_lead_ads, meta_whatsapp, hubspot, manual, csv
    lead_sources = Column(String(255), nullable=True)

    # Meta — which form/ad set feeds this campaign
    meta_form_id = Column(String(100), nullable=True, index=True)
    meta_form_name = Column(String(255), nullable=True)
    meta_ad_name = Column(String(255), nullable=True)

    # HubSpot — filter leads by HubSpot list/workflow ID
    hubspot_list_id = Column(String(100), nullable=True)

    # Google Ads — Lead Form Asset IDs
    google_form_id = Column(String(100), nullable=True)
    google_campaign_id = Column(String(100), nullable=True)

    # Klaviyo — list or segment name
    klaviyo_list_id = Column(String(100), nullable=True)

    # Website Form — freeform ID baked into that form's embed snippet (data-form-id)
    website_form_id = Column(String(100), nullable=True)

    # Stats (denormalized for quick display)
    total_leads = Column(Integer, default=0)
    calls_made = Column(Integer, default=0)
    booked = Column(Integer, default=0)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
