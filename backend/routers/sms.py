from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from models.models.lead import Lead
from models.models.appointment import Appointment
from models.models.sms import SMSLog
from services.messaging_service import (
    send_appointment_confirmation,
    send_appointment_reminder,
    send_appointment_cancellation,
    send_interested_followup,
    send_message,
)

router = APIRouter(prefix="/sms", tags=["SMS / WhatsApp"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CustomMessageBody(BaseModel):
    lead_id: int
    message: str
    language: Optional[str] = "hindi"
    sms_type: Optional[str] = "custom"


# ── Send by appointment ───────────────────────────────────────────────────────

@router.post("/confirmation/{appointment_id}")
def send_confirmation(
    appointment_id: int,
    language: Optional[str] = "hindi",
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    appt, lead = _get_appt_lead(appointment_id, db)
    try:
        result = send_appointment_confirmation(lead, appt, language, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.post("/reminder/{appointment_id}")
def send_reminder(
    appointment_id: int,
    language: Optional[str] = "hindi",
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    appt, lead = _get_appt_lead(appointment_id, db)
    try:
        result = send_appointment_reminder(lead, appt, language, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.post("/cancellation/{appointment_id}")
def send_cancellation(
    appointment_id: int,
    language: Optional[str] = "hindi",
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    appt, lead = _get_appt_lead(appointment_id, db)
    try:
        result = send_appointment_cancellation(lead, appt, language, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


# ── Follow-up for interested leads ────────────────────────────────────────────

@router.post("/followup/{lead_id}")
def send_followup(
    lead_id: int,
    language: Optional[str] = "hindi",
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    try:
        result = send_interested_followup(lead, language, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


# ── Custom message ────────────────────────────────────────────────────────────

@router.post("/custom")
def send_custom(body: CustomMessageBody, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    lead = db.query(Lead).filter(Lead.id == body.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    try:
        result = send_message(
            phone=lead.phone,
            message=body.message,
            lead_id=lead.id,
            sms_type=body.sms_type or "custom",
            language=body.language or "hindi",
            db=db,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


# ── SMS log history ───────────────────────────────────────────────────────────

@router.get("/history/{lead_id}")
def sms_history(lead_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    logs = (
        db.query(SMSLog)
        .filter(SMSLog.lead_id == lead_id)
        .order_by(SMSLog.sent_at.desc())
        .all()
    )
    return [
        {
            "id": l.id,
            "sms_type": l.sms_type,
            "language": l.language,
            "status": l.status,
            "twilio_sid": l.twilio_sid,
            "sent_at": l.sent_at,
            "message": l.message,
        }
        for l in logs
    ]


# ── Helper ────────────────────────────────────────────────────────────────────

def _get_appt_lead(appointment_id: int, db: Session):
    appt = db.query(Appointment).filter(Appointment.id == appointment_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    lead = db.query(Lead).filter(Lead.id == appt.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found for this appointment")
    return appt, lead
