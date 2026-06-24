import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from models.models.campaign import Campaign, CampaignStatus
from models.models.lead import Lead, LeadStatus

logger = logging.getLogger("campaigns")

router = APIRouter(prefix="/campaigns", tags=["Campaigns"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class CampaignCreate(BaseModel):
    client_id: int
    name: str
    description: str | None = None
    agent_name: str | None = "AI Calling Assistant"
    agent_prompt: str | None = None
    language_default: str | None = "hindi"
    agent_voice: str | None = "alloy"
    call_start_time: str | None = "09:00"
    call_end_time: str | None = "20:00"
    max_retries: int | None = 3
    retry_gap_hours: int | None = 24
    caller_phone_number: str | None = None
    lead_sources: str | None = None
    meta_form_id: str | None = None
    meta_form_name: str | None = None
    meta_ad_name: str | None = None
    hubspot_list_id: str | None = None
    google_form_id: str | None = None
    google_campaign_id: str | None = None
    klaviyo_list_id: str | None = None
    website_form_id: str | None = None


class CampaignUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    status: str | None = None
    agent_name: str | None = None
    agent_prompt: str | None = None
    language_default: str | None = None
    agent_voice: str | None = None
    call_start_time: str | None = None
    call_end_time: str | None = None
    max_retries: int | None = None
    retry_gap_hours: int | None = None
    caller_phone_number: str | None = None
    lead_sources: str | None = None
    meta_form_id: str | None = None
    meta_form_name: str | None = None
    meta_ad_name: str | None = None
    hubspot_list_id: str | None = None
    google_form_id: str | None = None
    google_campaign_id: str | None = None
    klaviyo_list_id: str | None = None
    website_form_id: str | None = None
    is_active: bool | None = None


def _serialize(c: Campaign, lead_count: int = 0) -> dict:
    return {
        "id": c.id,
        "client_id": c.client_id,
        "name": c.name,
        "description": c.description,
        "status": c.status,
        "agent_name": c.agent_name,
        "agent_prompt": c.agent_prompt,
        "language_default": c.language_default,
        "agent_voice": c.agent_voice,
        "call_start_time": c.call_start_time,
        "call_end_time": c.call_end_time,
        "max_retries": c.max_retries,
        "retry_gap_hours": c.retry_gap_hours,
        "caller_phone_number": c.caller_phone_number,
        "lead_sources": c.lead_sources,
        "meta_form_id": c.meta_form_id,
        "meta_form_name": c.meta_form_name,
        "meta_ad_name": c.meta_ad_name,
        "hubspot_list_id": c.hubspot_list_id,
        "google_form_id": c.google_form_id,
        "google_campaign_id": c.google_campaign_id,
        "klaviyo_list_id": c.klaviyo_list_id,
        "website_form_id": c.website_form_id,
        "total_leads": c.total_leads,
        "calls_made": c.calls_made,
        "booked": c.booked,
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_campaigns(
    client_id: int | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    q = db.query(Campaign)
    if client_id is not None:
        q = q.filter(Campaign.client_id == client_id)
    if status:
        q = q.filter(Campaign.status == status)
    campaigns = q.order_by(Campaign.created_at.desc()).all()
    return [_serialize(c) for c in campaigns]


@router.post("", status_code=201)
def create_campaign(
    body: CampaignCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    campaign = Campaign(**body.model_dump())
    db.add(campaign)
    db.commit()
    db.refresh(campaign)
    return _serialize(campaign)


@router.get("/{campaign_id}")
def get_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    return _serialize(campaign)


@router.patch("/{campaign_id}")
def update_campaign(
    campaign_id: int,
    body: CampaignUpdate,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    updates = body.model_dump(exclude_none=True)
    if "status" in updates and updates["status"] not in [s.value for s in CampaignStatus]:
        raise HTTPException(status_code=400, detail=f"Invalid status. Valid: {[s.value for s in CampaignStatus]}")

    for field, value in updates.items():
        setattr(campaign, field, value)
    db.commit()
    db.refresh(campaign)
    return _serialize(campaign)


@router.delete("/{campaign_id}", status_code=204)
def delete_campaign(
    campaign_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    db.delete(campaign)
    db.commit()


@router.get("/{campaign_id}/leads")
def list_campaign_leads(
    campaign_id: int,
    status: str | None = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Get all leads assigned to a campaign."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    q = db.query(Lead).filter(Lead.campaign_id == campaign_id)
    if status:
        q = q.filter(Lead.status == status)

    total = q.count()
    leads = q.order_by(Lead.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "leads": [
            {
                "id": l.id,
                "full_name": l.full_name,
                "phone": l.phone,
                "email": l.email,
                "city": l.city,
                "source_platform": l.source_platform,
                "status": l.status,
                "call_outcome": l.call_outcome,
                "call_count": l.call_count,
                "last_called_at": l.last_called_at.isoformat() if l.last_called_at else None,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            }
            for l in leads
        ],
    }


@router.post("/{campaign_id}/start-calls")
async def start_campaign_calls(
    campaign_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """
    Start the AI calling queue for a campaign.
    Marks all eligible leads as call_scheduled, then fires the first call.
    Subsequent calls chain automatically via the livekit-event webhook.
    """
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    if campaign.status not in ("active", "draft", "paused"):
        raise HTTPException(status_code=400, detail=f"Cannot start calls — campaign status is '{campaign.status}'")

    # Activate the campaign if not already
    if campaign.status != "active":
        campaign.status = CampaignStatus.active.value
        db.commit()

    skip_statuses = {
        LeadStatus.calling,
        LeadStatus.call_scheduled,
        LeadStatus.appointment_booked,
        LeadStatus.not_interested,
    }

    leads = (
        db.query(Lead)
        .filter(Lead.campaign_id == campaign_id)
        .all()
    )
    eligible = [l for l in leads if l.status not in skip_statuses]

    if not eligible:
        return {"triggered": 0, "queued": 0, "skipped": len(leads) - len(eligible), "message": "No eligible leads to call"}

    eligible.sort(key=lambda l: l.id)

    for lead in eligible:
        lead.status = LeadStatus.call_scheduled
    db.commit()

    first = eligible[0]
    try:
        from services.calling_service import trigger_call
        result = await trigger_call(first, db)
        campaign.calls_made = (campaign.calls_made or 0) + 1
        db.commit()
        return {
            "triggered": 1,
            "queued": len(eligible) - 1,
            "skipped": len(leads) - len(eligible),
            "first_call": {"lead_id": first.id, "name": first.full_name, **result},
        }
    except Exception as e:
        first.status = LeadStatus.new
        db.commit()
        logger.error("Campaign %s start-calls failed: %s", campaign_id, e)
        raise HTTPException(status_code=500, detail=f"Failed to start first call: {e}") from e


@router.post("/{campaign_id}/assign-lead/{lead_id}")
def assign_lead_to_campaign(
    campaign_id: int,
    lead_id: int,
    db: Session = Depends(get_db),
    _: dict = Depends(get_current_admin),
):
    """Assign an existing lead to a campaign."""
    campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")

    lead = db.query(Lead).filter(Lead.id == lead_id).first()
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead.campaign_id = campaign_id
    lead.client_id = campaign.client_id
    campaign.total_leads = db.query(Lead).filter(Lead.campaign_id == campaign_id).count() + 1
    db.commit()
    return {"ok": True, "lead_id": lead_id, "campaign_id": campaign_id}
