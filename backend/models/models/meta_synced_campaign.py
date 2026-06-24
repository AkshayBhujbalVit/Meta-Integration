from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.sql import func

from .base import Base


class MetaSyncedCampaign(Base):
    """
    Read-only mirror of the connected Meta Ad Account's Campaigns and Ad Sets.
    Synced on demand via POST /integrations/meta/sync — never written back to Meta.
    """

    __tablename__ = "meta_synced_campaign"

    id = Column(Integer, primary_key=True)
    external_id = Column(String(50), nullable=False, unique=True, index=True)  # Meta campaign or ad set ID

    level = Column(String(10), nullable=False)  # 'campaign' | 'adset'
    parent_external_id = Column(String(50), nullable=True, index=True)  # owning campaign's external_id, for ad sets

    name = Column(String(255), nullable=True)
    status = Column(String(30), nullable=True)  # Meta's own ACTIVE/PAUSED/ARCHIVED — read-only mirror
    objective = Column(String(50), nullable=True)
    ad_account_id = Column(String(50), nullable=True)

    synced_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
