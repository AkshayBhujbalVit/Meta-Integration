from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from .base import Base


class WhatsAppMessage(Base):
    """Stores inbound and outbound WhatsApp messages for conversation history."""
    __tablename__ = "whatsapp_message"

    id = Column(Integer, primary_key=True, index=True)
    lead_id = Column(Integer, nullable=True, index=True)  # null if unknown caller
    phone = Column(String(20), nullable=False, index=True)

    direction = Column(String(10), nullable=False)   # inbound / outbound
    body = Column(Text, nullable=False)
    wa_message_id = Column(String(100), nullable=True)   # Twilio message SID

    created_at = Column(DateTime(timezone=True), server_default=func.now())
