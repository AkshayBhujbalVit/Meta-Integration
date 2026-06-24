"""
Development-only seed endpoint.
Inserts 2 test leads per source platform plus sample call logs and an appointment.
All inserts are idempotent — safe to call multiple times.

BLOCKED in production (ENV=production).
"""
import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from models.models.appointment import Appointment
from models.models.call import CallLog
from models.models.lead import Lead, LeadStatus

router = APIRouter(prefix="/dev", tags=["Dev"])

_IS_PRODUCTION = os.getenv("ENV", "development").lower() == "production"


def _require_dev():
    if _IS_PRODUCTION:
        raise HTTPException(status_code=404, detail="Not found")


_SEED_LEADS = [
    # ── Meta Lead Ads ──────────────────────────────────────────────────────────
    {
        "source_platform": "meta_lead_ads",
        "fb_lead_id": "seed_meta_001",
        "full_name": "Priya Sharma",
        "phone": "+919876543210",
        "email": "priya.sharma@example.com",
        "city": "Mumbai",
        "inquiry_type": "Product Demo",
        "status": LeadStatus.interested,
        "call_count": 1,
    },
    {
        "source_platform": "meta_lead_ads",
        "fb_lead_id": "seed_meta_002",
        "full_name": "Rahul Verma",
        "phone": "+919812345678",
        "email": "rahul.verma@example.com",
        "city": "Delhi",
        "inquiry_type": "Pricing Query",
        "status": LeadStatus.new,
        "call_count": 0,
    },
    # ── HubSpot ────────────────────────────────────────────────────────────────
    {
        "source_platform": "hubspot_webhook",
        "external_id": "hs_seed_001",
        "full_name": "Anjali Mehta",
        "phone": "+919923456789",
        "email": "anjali.mehta@example.com",
        "city": "Pune",
        "inquiry_type": "Enterprise Plan",
        "status": LeadStatus.call_scheduled,
        "call_count": 0,
    },
    {
        "source_platform": "hubspot_webhook",
        "external_id": "hs_seed_002",
        "full_name": "Vikram Singh",
        "phone": "+919834567890",
        "email": "vikram.singh@example.com",
        "city": "Bangalore",
        "inquiry_type": "Integration Support",
        "status": LeadStatus.no_answer,
        "call_count": 2,
    },
    # ── Google Ads ─────────────────────────────────────────────────────────────
    {
        "source_platform": "google_webhook",
        "external_id": "gads_seed_001",
        "full_name": "Sunita Patel",
        "phone": "+919745678901",
        "email": "sunita.patel@example.com",
        "city": "Ahmedabad",
        "inquiry_type": "Free Trial",
        "status": LeadStatus.new,
        "call_count": 0,
    },
    {
        "source_platform": "google_webhook",
        "external_id": "gads_seed_002",
        "full_name": "Amit Joshi",
        "phone": "+919756789012",
        "email": "amit.joshi@example.com",
        "city": "Hyderabad",
        "inquiry_type": "Product Demo",
        "status": LeadStatus.callback_requested,
        "call_count": 1,
    },
    # ── Klaviyo ────────────────────────────────────────────────────────────────
    {
        "source_platform": "klaviyo_webhook",
        "external_id": "klav_seed_001",
        "full_name": "Deepika Nair",
        "phone": "+919667890123",
        "email": "deepika.nair@example.com",
        "city": "Chennai",
        "inquiry_type": "Newsletter Subscriber",
        "status": LeadStatus.new,
        "call_count": 0,
    },
    {
        "source_platform": "klaviyo_webhook",
        "external_id": "klav_seed_002",
        "full_name": "Rohan Gupta",
        "phone": "+919578901234",
        "email": "rohan.gupta@example.com",
        "city": "Kolkata",
        "inquiry_type": "Webinar Registrant",
        "status": LeadStatus.interested,
        "call_count": 1,
    },
]


def _lead_exists(db: Session, data: dict) -> bool:
    if data.get("fb_lead_id"):
        return db.query(Lead).filter(Lead.fb_lead_id == data["fb_lead_id"]).first() is not None
    if data.get("external_id"):
        return db.query(Lead).filter(Lead.external_id == data["external_id"]).first() is not None
    return False


@router.post("/seed-test-data")
def seed_test_data(db: Session = Depends(get_db), _=Depends(get_current_admin), __=Depends(_require_dev)):
    now = datetime.utcnow()
    created_leads = []
    skipped_leads = []

    for data in _SEED_LEADS:
        if _lead_exists(db, data):
            skipped_leads.append(data.get("full_name"))
            continue

        lead = Lead(
            source_platform=data["source_platform"],
            fb_lead_id=data.get("fb_lead_id"),
            external_id=data.get("external_id"),
            full_name=data["full_name"],
            phone=data["phone"],
            email=data.get("email"),
            city=data.get("city"),
            inquiry_type=data.get("inquiry_type"),
            status=data["status"],
            call_count=data.get("call_count", 0),
            last_called_at=now - timedelta(hours=2) if data.get("call_count", 0) > 0 else None,
            consultation_type="online",
        )
        db.add(lead)
        db.flush()
        created_leads.append(lead)

    db.commit()

    # ── Sample call logs (attached to the first Meta and first HubSpot lead) ──
    call_logs_created = 0
    for lead in created_leads:
        if lead.source_platform not in ("meta_lead_ads", "hubspot_webhook") or lead.call_count == 0:
            continue
        existing = db.query(CallLog).filter(CallLog.lead_id == lead.id).first()
        if existing:
            continue
        for attempt in range(1, lead.call_count + 1):
            cl = CallLog(
                lead_id=lead.id,
                phone=lead.phone,
                language_used="hindi",
                duration_seconds=90 + attempt * 30,
                started_at=now - timedelta(hours=3 - attempt),
                ended_at=now - timedelta(hours=3 - attempt) + timedelta(seconds=90 + attempt * 30),
                status="completed",
                outcome="interested" if lead.status == LeadStatus.interested else "no_answer",
                summary=f"Seed call {attempt} — AI discussed {lead.inquiry_type or 'services'}.",
                direction="outbound",
                attempt_number=attempt,
            )
            db.add(cl)
            call_logs_created += 1

    db.commit()

    # ── Sample appointment (first Meta lead, if created) ─────────────────────
    appt_created = False
    meta_lead = next(
        (l for l in created_leads if l.source_platform == "meta_lead_ads" and l.call_count > 0),
        None,
    )
    if meta_lead:
        existing_appt = db.query(Appointment).filter(Appointment.lead_id == meta_lead.id).first()
        if not existing_appt:
            appt_dt = now + timedelta(days=3, hours=10)
            appt = Appointment(
                lead_id=meta_lead.id,
                patient_name=meta_lead.full_name,
                phone=meta_lead.phone,
                appointment_date=appt_dt,
                appointment_type="online",
                inquiry_type=meta_lead.inquiry_type,
                status="booked",
                notes="Seed appointment — scheduled after AI call.",
            )
            db.add(appt)
            db.commit()
            appt_created = True

    return {
        "status": "ok",
        "leads_created": len(created_leads),
        "leads_skipped": len(skipped_leads),
        "call_logs_created": call_logs_created,
        "appointment_created": appt_created,
        "details": {
            "created": [l.full_name for l in created_leads],
            "skipped": skipped_leads,
        },
    }


@router.delete("/seed-test-data")
def clear_seed_data(db: Session = Depends(get_db), _=Depends(get_current_admin), __=Depends(_require_dev)):
    """Remove all seeded test data."""
    fb_ids = [d["fb_lead_id"] for d in _SEED_LEADS if d.get("fb_lead_id")]
    ext_ids = [d["external_id"] for d in _SEED_LEADS if d.get("external_id")]

    leads = (
        db.query(Lead)
        .filter(
            Lead.fb_lead_id.in_(fb_ids) | Lead.external_id.in_(ext_ids)
        )
        .all()
    )

    removed = 0
    for lead in leads:
        db.query(CallLog).filter(CallLog.lead_id == lead.id).delete()
        db.query(Appointment).filter(Appointment.lead_id == lead.id).delete()
        db.delete(lead)
        removed += 1

    db.commit()
    return {"status": "ok", "removed_leads": removed}
