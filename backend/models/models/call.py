from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Float
from sqlalchemy.sql import func
from .base import Base


class CallLog(Base):
    __tablename__ = "call_log"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, nullable=False, index=True)

    # Vapi details
    vapi_call_id = Column(String(100), nullable=True, unique=True)
    vapi_assistant_id = Column(String(100), nullable=True)

    # Call info
    phone = Column(String(20), nullable=False)
    language_used = Column(String(20), nullable=True)     # hindi / marathi / english
    duration_seconds = Column(Integer, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    ended_at = Column(DateTime(timezone=True), nullable=True)

    # Outcome
    status = Column(String(50), nullable=True)            # completed / no_answer / failed
    outcome = Column(String(50), nullable=True)           # interested / booked / not_interested
    summary = Column(Text, nullable=True)
    transcript = Column(Text, nullable=True)
    recording_url = Column(String(500), nullable=True)

    # Retry
    attempt_number = Column(Integer, default=1)

    # Call direction — outbound (we call patient) or inbound (patient calls us)
    direction = Column(String(10), default="outbound")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
