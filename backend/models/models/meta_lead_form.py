from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from .base import Base


class MetaLeadForm(Base):
    """
    Synced from the connected Meta Page's Lead Forms — this is the actual routing key
    our webhook flow uses (Campaign.meta_form_id), unlike Campaigns/Ad Sets which are
    read-only visibility. Toggling ai_enabled links/creates an internal Campaign.
    """

    __tablename__ = "meta_lead_form"

    id = Column(Integer, primary_key=True)
    external_id = Column(String(50), nullable=False, unique=True, index=True)  # == Campaign.meta_form_id

    # Which tenant this synced form belongs to. NULL = synced under the
    # platform-level (super-admin) Meta connection rather than a client's own.
    client_id = Column(Integer, ForeignKey("client.id", ondelete="CASCADE"), nullable=True, index=True)

    page_id = Column(String(50), nullable=True)
    name = Column(String(255), nullable=True)
    status = Column(String(30), nullable=True)
    leads_count = Column(Integer, nullable=True)

    ai_enabled = Column(Boolean, default=False)
    linked_campaign_id = Column(Integer, ForeignKey("campaign.id", ondelete="SET NULL"), nullable=True)

    synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
