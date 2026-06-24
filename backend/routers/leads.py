import os
import shutil

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel as PydanticModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from core.config import UPLOAD_DIR
from core.database import get_db
from core.dependencies import get_current_admin
from models.models.admin import Admin
from models.models.appointment import Appointment
from models.models.call import CallLog
from models.models.campaign import Campaign
from models.models.client import Client
from models.models.lead import Lead, LeadStatus, LeadUpload
from models.models.settings import CallingConfig
from models.models.sms import SMSLog
from services.calling_service import trigger_call, within_calling_hours
from services.csv_parser import parse_and_import_csv

router = APIRouter(prefix="/leads", tags=["Leads"])

# ── City normalisation ────────────────────────────────────────────────────────
_CITY_ALIASES: dict[str, str] = {
    "poona": "Pune",
    "puna": "Pune",
    "pune": "Pune",
    "bombay": "Mumbai",
    "mumbai": "Mumbai",
    "calcutta": "Kolkata",
    "kolkata": "Kolkata",
    "madras": "Chennai",
    "chennai": "Chennai",
    "bangalore": "Bengaluru",
    "bengaluru": "Bengaluru",
    "bengalore": "Bengaluru",
    "new delhi": "New Delhi",
    "delhi": "Delhi",
    "hyderabad": "Hyderabad",
    "hyd": "Hyderabad",
    "agra": "Agra",
    "nagpur": "Nagpur",
    "nashik": "Nashik",
    "surat": "Surat",
    "vadodara": "Vadodara",
    "baroda": "Vadodara",
    "ahmedabad": "Ahmedabad",
    "ahemdabad": "Ahmedabad",
    "jaipur": "Jaipur",
    "lucknow": "Lucknow",
    "kanpur": "Kanpur",
    "indore": "Indore",
    "bhopal": "Bhopal",
    "patna": "Patna",
    "chandigarh": "Chandigarh",
    "coimbatore": "Coimbatore",
    "visakhapatnam": "Visakhapatnam",
    "vizag": "Visakhapatnam",
    "gurgaon": "Gurugram",
    "gurugram": "Gurugram",
    "noida": "Noida",
    "thane": "Thane",
    "navi mumbai": "Navi Mumbai",
}


def normalise_city(city: str | None) -> str | None:
    if not city:
        return city
    stripped = city.strip()
    key = stripped.lower()
    if key in _CITY_ALIASES:
        return _CITY_ALIASES[key]
    # Title-case anything not in the alias map
    return stripped.title()


async def _auto_queue_and_call(leads: list, db: Session):
    """
    Sequential auto-call: mark all leads as call_scheduled, trigger only the first.
    The rest fire automatically via livekit-event as each call ends.
    """
    cfg = db.query(CallingConfig).filter(CallingConfig.is_active == True).first()
    if not cfg or not cfg.auto_call_on_upload:
        return
    if not within_calling_hours(cfg):
        return  # Outside calling hours — leads stay as call_scheduled, will be triggered manually

    # Filter out duplicates and already-called leads
    eligible = [lead for lead in leads if not lead.is_duplicate and lead.status == LeadStatus.new]
    if not eligible:
        return

    eligible.sort(key=lambda lead: lead.id)

    # Mark all as queued
    for lead in eligible:
        lead.status = LeadStatus.call_scheduled
    db.commit()

    # Trigger only the first — livekit-event auto-fires the rest
    try:
        await trigger_call(eligible[0], db)
    except Exception:
        pass


# ── Upload CSV ────────────────────────────────────────────────────────────────


@router.post("/upload")
async def upload_csv(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not file.filename.endswith((".csv", ".tsv")):
        raise HTTPException(status_code=400, detail="Only CSV or TSV files are accepted")

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    save_path = os.path.join(UPLOAD_DIR, file.filename)

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    result = parse_and_import_csv(save_path, file.filename, db)

    # Auto-queue and call if enabled in settings
    upload_id = result.get("upload_id")
    if upload_id:
        new_leads = (
            db.query(Lead)
            .filter(
                Lead.upload_id == upload_id,
                Lead.status == LeadStatus.new,
                Lead.is_duplicate == False,
            )
            .order_by(Lead.id)
            .all()
        )
        background_tasks.add_task(_auto_queue_and_call, new_leads, db)

    return result


# ── Upload history ────────────────────────────────────────────────────────────


@router.get("/uploads")
def get_uploads(
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    uploads = db.query(LeadUpload).order_by(LeadUpload.uploaded_at.desc()).all()
    return [
        {
            "id": u.id,
            "file_name": u.file_name,
            "total_rows": u.total_rows,
            "imported": u.imported,
            "duplicates": u.duplicates,
            "failed": u.failed,
            "uploaded_at": u.uploaded_at,
        }
        for u in uploads
    ]


# ── Delete upload batch ───────────────────────────────────────────────────────


@router.delete("/uploads/{upload_id}")
def delete_upload_batch(
    upload_id: int,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    upload = db.query(LeadUpload).filter(LeadUpload.id == upload_id).first()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    lead_ids = [r.id for r in db.query(Lead.id).filter(Lead.upload_id == upload_id).all()]
    if lead_ids:
        db.query(CallLog).filter(CallLog.lead_id.in_(lead_ids)).delete(synchronize_session=False)
        db.query(Appointment).filter(Appointment.lead_id.in_(lead_ids)).delete(
            synchronize_session=False
        )
        db.query(SMSLog).filter(SMSLog.lead_id.in_(lead_ids)).delete(synchronize_session=False)
    deleted = db.query(Lead).filter(Lead.upload_id == upload_id).delete()
    db.delete(upload)
    db.commit()
    return {"message": f"Deleted {deleted} leads from batch", "deleted": deleted}


# ── Get all leads with filters ────────────────────────────────────────────────


@router.get("/")
def get_leads(
    # Universal filters
    client_id: int = Query(None),
    campaign_id: int = Query(None),
    source_platform: str = Query(None),
    status: str = Query(None),
    date_from: str = Query(None),   # ISO date string e.g. 2024-01-01
    date_to: str = Query(None),
    search: str = Query(None),
    # Legacy filters kept for backward-compat
    city: str = Query(None),
    inquiry_type: str = Query(None),
    consultation_type: str = Query(None),
    platform: str = Query(None),
    skip: int = Query(0),
    offset: int = Query(0),
    limit: int = Query(50),
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    from datetime import datetime
    q = db.query(Lead).filter(Lead.is_duplicate == False)

    if client_id is not None:
        q = q.filter(Lead.client_id == client_id)
    if campaign_id is not None:
        q = q.filter(Lead.campaign_id == campaign_id)
    if source_platform:
        q = q.filter(Lead.source_platform == source_platform)
    if status:
        q = q.filter(Lead.status == status)
    if date_from:
        try:
            q = q.filter(Lead.created_at >= datetime.fromisoformat(date_from))
        except ValueError:
            pass
    if date_to:
        try:
            q = q.filter(Lead.created_at <= datetime.fromisoformat(date_to + "T23:59:59"))
        except ValueError:
            pass
    if city:
        q = q.filter(Lead.city.ilike(f"%{city}%"))
    if inquiry_type:
        q = q.filter(Lead.inquiry_type == inquiry_type)
    if consultation_type:
        q = q.filter(Lead.consultation_type == consultation_type)
    if platform:
        q = q.filter(Lead.platform == platform)
    if search:
        q = q.filter(
            or_(
                Lead.full_name.ilike(f"%{search}%"),
                Lead.phone.ilike(f"%{search}%"),
                Lead.email.ilike(f"%{search}%"),
            )
        )

    total = q.count()
    effective_skip = skip or offset
    leads = q.order_by(Lead.created_at.desc()).offset(effective_skip).limit(limit).all()

    # Build client/campaign name lookup for serialization
    client_ids = {l.client_id for l in leads if l.client_id}
    campaign_ids = {l.campaign_id for l in leads if l.campaign_id}
    clients_map = {c.id: c.name for c in db.query(Client).filter(Client.id.in_(client_ids)).all()} if client_ids else {}
    campaigns_map = {c.id: c.name for c in db.query(Campaign).filter(Campaign.id.in_(campaign_ids)).all()} if campaign_ids else {}

    return {
        "total": total,
        "leads": [_serialize(lead, clients_map, campaigns_map) for lead in leads],
    }


# ── Get single lead ───────────────────────────────────────────────────────────


@router.get("/{lead_id}")
def get_lead(
    lead_id: int,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return _serialize(lead)


# ── Create a single lead manually ────────────────────────────────────────────


class LeadCreate(PydanticModel):
    full_name: str
    phone: str
    city: str | None = None
    inquiry_type: str | None = None
    second_inquiry_type: str | None = None
    problem_description: str | None = None
    consultation_type: str = "online"
    email: str | None = None
    client_id: int | None = None
    campaign_id: int | None = None
    source_platform: str | None = "manual"


@router.post("/")
async def create_lead(
    payload: LeadCreate,
    background_tasks: BackgroundTasks,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    phone = payload.phone.strip()
    if not phone.startswith("+"):
        phone = f"+{phone}"

    existing = db.query(Lead).filter(Lead.phone == phone).first()
    if existing:
        raise HTTPException(status_code=400, detail="A lead with this phone number already exists")

    lead = Lead(
        full_name=payload.full_name.strip(),
        phone=phone,
        city=normalise_city(payload.city),
        inquiry_type=payload.inquiry_type,
        second_inquiry_type=payload.second_inquiry_type,
        problem_description=payload.problem_description,
        consultation_type=payload.consultation_type,
        email=payload.email,
        client_id=payload.client_id,
        campaign_id=payload.campaign_id,
        source_platform=payload.source_platform or "manual",
        status=LeadStatus.new,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)

    # Auto-queue and call if enabled in settings
    background_tasks.add_task(_auto_queue_and_call, [lead], db)

    return _serialize(lead)


# ── Edit lead ─────────────────────────────────────────────────────────────────


class LeadUpdate(PydanticModel):
    full_name: str | None = None
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    inquiry_type: str | None = None
    second_inquiry_type: str | None = None
    problem_description: str | None = None
    consultation_type: str | None = None
    notes: str | None = None


@router.patch("/{lead_id}")
def update_lead(
    lead_id: int,
    body: LeadUpdate,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    for field, value in body.model_dump(exclude_none=True).items():
        if field == "city":
            value = normalise_city(value)
        setattr(lead, field, value)
    db.commit()
    db.refresh(lead)
    return _serialize(lead)


# ── Delete lead ───────────────────────────────────────────────────────────────


@router.delete("/{lead_id}")
def delete_lead(
    lead_id: int,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    db.query(CallLog).filter(CallLog.lead_id == lead_id).delete()
    db.query(Appointment).filter(Appointment.lead_id == lead_id).delete()
    db.query(SMSLog).filter(SMSLog.lead_id == lead_id).delete()
    db.delete(lead)
    db.commit()
    return {"message": "Lead deleted", "id": lead_id}


# ── Update lead status manually ───────────────────────────────────────────────


@router.patch("/{lead_id}/status")
def update_status(
    lead_id: int,
    payload: dict,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    allowed = [s.value for s in LeadStatus]
    new_status = payload.get("status")
    if new_status not in allowed:
        raise HTTPException(status_code=400, detail=f"Invalid status. Allowed: {allowed}")

    lead.status = new_status
    if payload.get("notes"):
        lead.notes = payload["notes"]
    db.commit()
    return {"message": "Status updated", "status": new_status}


# ── Filter options (for dropdowns) ───────────────────────────────────────────


@router.get("/meta/filters")
def get_filter_options(
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    cities = db.query(Lead.city).filter(Lead.city.isnot(None)).distinct().all()
    inquiry_types = db.query(Lead.inquiry_type).filter(Lead.inquiry_type.isnot(None)).distinct().all()
    source_platforms = db.query(Lead.source_platform).filter(Lead.source_platform.isnot(None)).distinct().all()
    clients = db.query(Client.id, Client.name).filter(Client.is_active == True).order_by(Client.name).all()
    campaigns = db.query(Campaign.id, Campaign.client_id, Campaign.name).filter(Campaign.is_active == True).order_by(Campaign.name).all()

    return {
        "cities": sorted([c[0] for c in cities if c[0]]),
        "inquiry_types": sorted([i[0] for i in inquiry_types if i[0]]),
        "source_platforms": sorted([p[0] for p in source_platforms if p[0]]),
        "statuses": [s.value for s in LeadStatus],
        "clients": [{"id": c.id, "name": c.name} for c in clients],
        "campaigns": [{"id": c.id, "client_id": c.client_id, "name": c.name} for c in campaigns],
    }


# ── Reset stuck "calling" leads ───────────────────────────────────────────────


@router.post("/reset-stuck")
def reset_stuck_calls(
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """Reset leads stuck in 'calling' state back to 'new' (e.g. after agent crash)."""
    stuck = db.query(Lead).filter(Lead.status == LeadStatus.calling).all()
    for lead in stuck:
        lead.status = LeadStatus.new
    db.commit()
    return {"reset": len(stuck), "message": f"{len(stuck)} lead(s) reset to 'new'"}


# ── Serializer ────────────────────────────────────────────────────────────────


def _serialize(lead: Lead, clients_map: dict = {}, campaigns_map: dict = {}) -> dict:
    return {
        "id": lead.id,
        "full_name": lead.full_name,
        "phone": lead.phone,
        "email": lead.email,
        "city": lead.city,
        # Multi-tenant
        "client_id": lead.client_id,
        "client_name": clients_map.get(lead.client_id) if lead.client_id else None,
        "campaign_id": lead.campaign_id,
        "campaign_name": campaigns_map.get(lead.campaign_id) if lead.campaign_id else lead.campaign_name,
        "source_platform": lead.source_platform,
        # Legacy
        "platform": lead.platform,
        "inquiry_type": lead.inquiry_type,
        "problem_description": lead.problem_description,
        "tests_done": lead.tests_done,
        "second_inquiry_type": lead.second_inquiry_type,
        "second_problem_description": lead.second_problem_description,
        "status": lead.status,
        "call_outcome": lead.call_outcome,
        "call_language": lead.call_language,
        "call_count": lead.call_count,
        "last_called_at": lead.last_called_at,
        "notes": lead.notes,
        "fb_lead_id": lead.fb_lead_id,
        "ad_name": lead.ad_name,
        "fb_created_time": lead.fb_created_time,
        "created_at": lead.created_at,
    }
