from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Enum, ForeignKey
from sqlalchemy.sql import func
import enum
from .base import Base


class LeadStatus(str, enum.Enum):
    new = "new"
    call_scheduled = "call_scheduled"
    calling = "calling"
    interested = "interested"
    appointment_booked = "appointment_booked"
    not_interested = "not_interested"
    no_answer = "no_answer"
    callback_requested = "callback_requested"
    duplicate = "duplicate"
    failed = "failed"


class CallOutcome(str, enum.Enum):
    interested = "interested"
    appointment_booked = "appointment_booked"
    not_interested = "not_interested"
    no_answer = "no_answer"
    callback_requested = "callback_requested"
    failed = "failed"
    escalated = "escalated"


class LeadUpload(Base):
    """Tracks each CSV file uploaded."""
    __tablename__ = "lead_upload"

    id = Column(Integer, primary_key=True)
    file_name = Column(String(255), nullable=False)
    total_rows = Column(Integer, default=0)
    imported = Column(Integer, default=0)
    duplicates = Column(Integer, default=0)
    failed = Column(Integer, default=0)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())


class Lead(Base):
    __tablename__ = "lead"

    id = Column(Integer, primary_key=True, index=True)
    upload_id = Column(Integer, nullable=True, index=True)

    # Multi-tenant: which client and campaign this lead belongs to
    client_id = Column(Integer, ForeignKey("client.id", ondelete="SET NULL"), nullable=True, index=True)
    campaign_id = Column(Integer, ForeignKey("campaign.id", ondelete="SET NULL"), nullable=True, index=True)

    # Where this lead came from
    source_platform = Column(String(50), nullable=True, index=True)  # meta_lead_ads / meta_whatsapp / hubspot / manual / csv

    # Contact info
    full_name = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=False, index=True)
    email = Column(String(255), nullable=True)
    city = Column(String(100), nullable=True)

    # Facebook form fields
    fb_lead_id = Column(String(100), nullable=True, unique=True, index=True)
    ad_name = Column(String(255), nullable=True)
    campaign_name = Column(String(255), nullable=True)
    platform = Column(String(20), nullable=True)          # fb / ig
    form_name = Column(String(255), nullable=True)
    inquiry_type = Column(String(100), nullable=True)     # what_kind_of_fertility_support
    problem_description = Column(Text, nullable=True)     # describe_the_problem
    tests_done = Column(String(100), nullable=True)       # have_you_done_fertility_tests
    is_working_professional = Column(String(10), nullable=True)
    fb_created_time = Column(DateTime(timezone=True), nullable=True)

    # Duplicate handling
    is_duplicate = Column(Boolean, default=False)
    merged_with_lead_id = Column(Integer, nullable=True)  # if merged due to diff inquiry
    second_inquiry_type = Column(String(100), nullable=True)
    second_problem_description = Column(Text, nullable=True)

    consultation_type = Column(String(20), default="online")   # online / in_person

    # Human caller assignment
    assigned_to_human = Column(Boolean, default=False)
    assigned_at = Column(DateTime(timezone=True), nullable=True)

    # Status
    status = Column(String(50), default=LeadStatus.new)
    call_outcome = Column(String(50), nullable=True)
    call_language = Column(String(20), nullable=True)     # hindi / marathi / english
    call_count = Column(Integer, default=0)
    last_called_at = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)

    # Generic dedup key for non-Meta sources (hubspot_<id>, gads_<id>, klav_<id>)
    external_id = Column(String(150), nullable=True, unique=True, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
