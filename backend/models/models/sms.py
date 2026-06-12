from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func
from .base import Base


class SMSLog(Base):
    __tablename__ = "sms_log"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, nullable=False, index=True)

    phone = Column(String(20), nullable=False)
    message = Column(Text, nullable=False)
    language = Column(String(20), nullable=True)          # hindi / marathi / english
    sms_type = Column(String(50), nullable=True)          # confirmation / cancellation / reminder
    twilio_sid = Column(String(100), nullable=True)
    status = Column(String(30), nullable=True)            # sent / delivered / failed
    sent_at = Column(DateTime(timezone=True), server_default=func.now())
