from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from .base import Base


class SystemLog(Base):
    """General system activity logs."""
    __tablename__ = "system_log"

    id = Column(Integer, primary_key=True)
    level = Column(String(20), nullable=True)             # info / warning / error
    action = Column(String(100), nullable=True)
    message = Column(Text, nullable=True)
    admin_id = Column(Integer, nullable=True)
    ip_address = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AdminLoginLog(Base):
    """Tracks every admin login attempt."""
    __tablename__ = "admin_login_log"

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, nullable=True, index=True)
    email = Column(String(255), nullable=True)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(Text, nullable=True)
    success = Column(Boolean, default=False)
    failure_reason = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WebhookLog(Base):
    """Logs incoming webhooks (Vapi, Twilio, Meta future)."""
    __tablename__ = "webhook_log"

    id = Column(Integer, primary_key=True)
    source = Column(String(50), nullable=True)            # vapi / twilio / meta
    event_type = Column(String(100), nullable=True)
    payload = Column(Text, nullable=True)
    status = Column(String(30), nullable=True)            # received / processed / failed
    error = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class OtpVerification(Base):
    """OTP for admin login (future use)."""
    __tablename__ = "otp_verification"

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, nullable=True, index=True)
    phone = Column(String(20), nullable=True)
    otp_hash = Column(String(255), nullable=True)
    is_used = Column(Boolean, default=False)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Notification(Base):
    """In-app notifications for admin dashboard."""
    __tablename__ = "notification"

    id = Column(Integer, primary_key=True)
    admin_id = Column(Integer, nullable=True, index=True)
    title = Column(String(255), nullable=True)
    message = Column(Text, nullable=True)
    type = Column(String(50), nullable=True)              # lead / call / appointment / system
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
