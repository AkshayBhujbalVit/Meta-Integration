from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from core.security import decode_appointment_token
from models.models.appointment import Appointment
from models.models.lead import Lead, LeadStatus
from services.calendar_service import (
    create_calendar_event,
    delete_calendar_event,
    update_calendar_event,
)
from services.messaging_service import (
    send_appointment_cancellation,
    send_appointment_confirmation,
)

router = APIRouter(prefix="/appointments", tags=["Appointments"])


# ── Schemas ───────────────────────────────────────────────────────────────────


class AppointmentCreate(BaseModel):
    lead_id: int
    appointment_date: datetime
    appointment_type: str | None = None  # online / in_clinic
    inquiry_type: str | None = None
    notes: str | None = None
    language: str | None = "hindi"  # for confirmation message


class AppointmentUpdate(BaseModel):
    appointment_date: datetime | None = None
    appointment_type: str | None = None
    status: str | None = None
    notes: str | None = None
    cancellation_reason: str | None = None


# ── Book appointment ──────────────────────────────────────────────────────────


@router.post("/", status_code=201)
def book_appointment(
    body: AppointmentCreate, db: Session = Depends(get_db), _=Depends(get_current_admin)
):
    lead = db.query(Lead).filter(Lead.id == body.lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    appt = Appointment(
        lead_id=lead.id,
        patient_name=lead.full_name,
        phone=lead.phone,
        appointment_date=body.appointment_date,
        appointment_type=body.appointment_type or lead.consultation_type,
        inquiry_type=body.inquiry_type or lead.inquiry_type,
        notes=body.notes,
        status="booked",
    )
    db.add(appt)

    lead.status = LeadStatus.appointment_booked
    db.commit()
    db.refresh(appt)

    # Sync to Google Calendar
    cal_status = "not_configured"
    try:
        event_id = create_calendar_event(appt, db)
        if event_id:
            appt.calendar_event_id = event_id
            db.commit()
            cal_status = "synced"
    except Exception as e:
        cal_status = f"failed: {str(e)}"

    # Send WhatsApp confirmation
    try:
        language = body.language or lead.call_language or "hindi"
        send_appointment_confirmation(lead, appt, language, db)
        msg_status = "sent"
    except Exception as e:
        msg_status = f"failed: {str(e)}"

    return {
        "appointment_id": appt.id,
        "lead_id": lead.id,
        "appointment_date": appt.appointment_date,
        "appointment_type": appt.appointment_type,
        "status": appt.status,
        "calendar_sync": cal_status,
        "confirmation_message": msg_status,
    }


# ── List appointments ─────────────────────────────────────────────────────────


@router.get("/")
def list_appointments(
    status: str | None = None,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    q = db.query(Appointment)
    if status:
        q = q.filter(Appointment.status == status)
    appts = q.order_by(Appointment.appointment_date).all()
    return [_appt_dict(a) for a in appts]


@router.get("/lead/{lead_id}")
def appointments_for_lead(
    lead_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)
):
    appts = (
        db.query(Appointment)
        .filter(Appointment.lead_id == lead_id)
        .order_by(Appointment.appointment_date.desc())
        .all()
    )
    return [_appt_dict(a) for a in appts]


@router.get("/{appt_id}")
def get_appointment(appt_id: int, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    return _appt_dict(appt)


# ── Update appointment ────────────────────────────────────────────────────────


@router.patch("/{appt_id}")
def update_appointment(
    appt_id: int,
    body: AppointmentUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")

    rescheduled = (
        body.appointment_date is not None and body.appointment_date != appt.appointment_date
    )

    if body.appointment_date is not None:
        appt.appointment_date = body.appointment_date
    if body.appointment_type is not None:
        appt.appointment_type = body.appointment_type
    if body.status is not None:
        appt.status = body.status
    if body.notes is not None:
        appt.notes = body.notes
    if body.cancellation_reason is not None:
        appt.cancellation_reason = body.cancellation_reason

    db.commit()

    # Update calendar event if appointment was rescheduled
    if rescheduled and appt.calendar_event_id:
        try:
            update_calendar_event(appt.calendar_event_id, appt, db)
        except Exception:
            pass

    return {"message": "Updated", "appointment": _appt_dict(appt)}


# ── Cancel appointment ────────────────────────────────────────────────────────


@router.post("/{appt_id}/cancel")
def cancel_appointment(
    appt_id: int,
    reason: str | None = None,
    language: str | None = "hindi",
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    if appt.status == "cancelled":
        raise HTTPException(status_code=400, detail="Already cancelled")

    cal_event_id = appt.calendar_event_id
    appt.status = "cancelled"
    appt.cancellation_reason = reason
    db.commit()

    # Remove from Google Calendar
    if cal_event_id:
        try:
            delete_calendar_event(cal_event_id, db)
        except Exception:
            pass

    lead = db.query(Lead).filter(Lead.id == appt.lead_id).first()
    msg_status = "not_sent"
    if lead:
        try:
            send_appointment_cancellation(lead, appt, language or "hindi", db)
            msg_status = "sent"
        except Exception as e:
            msg_status = f"failed: {str(e)}"

    return {"message": "Appointment cancelled", "cancellation_message": msg_status}


# ── Public self-service cancel/reschedule (patient link, no auth) ─────────────


@router.get("/action", response_class=HTMLResponse)
def appointment_action(token: str, db: Session = Depends(get_db)):
    """
    Patient-facing endpoint — linked from WhatsApp/SMS confirmation message.
    Validates the signed JWT, performs the action, returns a friendly HTML page.
    """
    data = decode_appointment_token(token)
    if not data:
        return _html_page(
            "⚠️ Link Expired",
            "This link has expired or is invalid. Please contact the clinic directly.",
            error=True,
        )

    appt = db.query(Appointment).filter(Appointment.id == data["appt_id"]).first()
    if not appt:
        return _html_page(
            "⚠️ Not Found", "Appointment not found. Please contact the clinic.", error=True
        )

    action = data.get("action", "")

    if action == "cancel":
        if appt.status == "cancelled":
            return _html_page("Already Cancelled", "This appointment was already cancelled.")
        cal_event_id = appt.calendar_event_id
        appt.status = "cancelled"
        appt.cancellation_reason = "Cancelled by patient via link"
        db.commit()
        if cal_event_id:
            try:
                delete_calendar_event(cal_event_id, db)
            except Exception:
                pass
        lead = db.query(Lead).filter(Lead.id == appt.lead_id).first()
        if lead:
            try:
                send_appointment_cancellation(lead, appt, "hindi", db)
            except Exception:
                pass
        return _html_page(
            "✅ Appointment Cancelled",
            f"Your appointment on {appt.appointment_date.strftime('%d %b %Y at %I:%M %p')} has been cancelled.<br><br>"
            "To book a new appointment, please WhatsApp or call the clinic.",
        )

    if action == "reschedule":
        appt.notes = (appt.notes or "") + "\n[Reschedule requested by patient via link]"
        db.commit()
        return _html_page(
            "🔄 Reschedule Requested",
            f"We've noted that you'd like to reschedule your appointment on "
            f"{appt.appointment_date.strftime('%d %b %Y at %I:%M %p')}.<br><br>"
            "Please WhatsApp or call the clinic with your preferred new date and time. "
            "Our team will confirm the new slot within a few hours.",
        )

    return _html_page("⚠️ Unknown Action", "This link is not valid.", error=True)


def _html_page(title: str, body: str, error: bool = False) -> str:
    color = "#e53e3e" if error else "#6d28d9"
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{title}</title>
  <style>
    body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           background: #f5f5f5; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; }}
    .card {{ background: white; border-radius: 16px; padding: 40px 32px;
             max-width: 480px; width: 90%; box-shadow: 0 4px 24px rgba(0,0,0,.08); text-align: center; }}
    h1 {{ color: {color}; font-size: 1.4rem; margin: 0 0 16px; }}
    p {{ color: #555; line-height: 1.6; margin: 0; }}
    .footer {{ margin-top: 24px; font-size: .8rem; color: #aaa; }}
  </style>
</head>
<body>
  <div class="card">
    <h1>{title}</h1>
    <p>{body}</p>
    <div class="footer">Dr. Sonal Gupta Clinic</div>
  </div>
</body>
</html>"""


# ── Helper ────────────────────────────────────────────────────────────────────


def _appt_dict(a: Appointment) -> dict:
    return {
        "id": a.id,
        "lead_id": a.lead_id,
        "patient_name": a.patient_name,
        "phone": a.phone,
        "appointment_date": a.appointment_date,
        "appointment_type": a.appointment_type,
        "inquiry_type": a.inquiry_type,
        "status": a.status,
        "notes": a.notes,
        "cancellation_reason": a.cancellation_reason,
        "calendar_event_id": a.calendar_event_id,
        "booked_at": a.booked_at,
    }
