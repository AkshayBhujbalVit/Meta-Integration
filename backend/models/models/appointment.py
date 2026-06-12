from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from .base import Base


class Appointment(Base):
    __tablename__ = "appointment"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, nullable=False, index=True)

    patient_name = Column(String(255), nullable=True)
    phone = Column(String(20), nullable=False)
    appointment_date = Column(DateTime(timezone=True), nullable=False)
    appointment_type = Column(String(100), nullable=True)  # online / in-clinic
    inquiry_type = Column(String(100), nullable=True)

    status = Column(
        String(30), default="booked"
    )  # booked / confirmed / cancelled / completed / no_show
    notes = Column(Text, nullable=True)
    cancellation_reason = Column(Text, nullable=True)

    # Calendar integration (future)
    calendar_event_id = Column(String(255), nullable=True)

    booked_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
