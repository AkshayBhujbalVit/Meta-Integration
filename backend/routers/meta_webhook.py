"""
Meta Lead Ads Webhook
─────────────────────
GET  /meta/webhook  — verification handshake (Meta calls this once when you register)
POST /meta/webhook  — real-time lead notification

Setup in Meta for Developers:
  1. App → Webhooks → Subscribe to "leadgen" field on your Page
  2. Callback URL: https://<your-domain>/meta/webhook
  3. Verify token: value of META_VERIFY_TOKEN env var
  4. App Secret: set META_APP_SECRET in .env for HMAC signature verification

Security:
  - GET:  checks hub.verify_token matches META_VERIFY_TOKEN
  - POST: verifies X-Hub-Signature-256 header using META_APP_SECRET
"""

import hashlib
import hmac
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from core.config import META_APP_SECRET, META_VERIFY_TOKEN
from core.database import get_db
from core.encryption import decrypt
from models.models.campaign import Campaign
from models.models.client import Client
from models.models.lead import Lead, LeadStatus
from models.models.platform_integration import PlatformIntegration
from services.meta_service import fetch_lead_from_meta

logger = logging.getLogger("meta_webhook")

router = APIRouter(prefix="/meta", tags=["Meta"])

_MAX_PAYLOAD_BYTES = 512_000  # 512 KB


# ── Webhook verification ──────────────────────────────────────────────────────

@router.get("/webhook")
def verify_webhook(
    hub_mode: str = Query(alias="hub.mode", default=""),
    hub_verify_token: str = Query(alias="hub.verify_token", default=""),
    hub_challenge: str = Query(alias="hub.challenge", default=""),
):
    if not META_VERIFY_TOKEN:
        raise HTTPException(status_code=500, detail="META_VERIFY_TOKEN not configured in .env")

    if hub_mode == "subscribe" and hub_verify_token == META_VERIFY_TOKEN:
        logger.info("Meta webhook verified successfully")
        return int(hub_challenge)

    raise HTTPException(status_code=403, detail="Verification token mismatch")


# ── Webhook event receiver ────────────────────────────────────────────────────

@router.post("/webhook", status_code=200)
async def receive_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")

    body = await request.body()

    # HMAC signature verification
    if META_APP_SECRET:
        signature_header = request.headers.get("X-Hub-Signature-256", "")
        expected = "sha256=" + hmac.new(
            META_APP_SECRET.encode(), body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature_header, expected):
            logger.warning("Meta webhook signature mismatch — rejecting request")
            raise HTTPException(status_code=403, detail="Invalid signature")
    else:
        logger.warning(
            "META_APP_SECRET not set — signature verification SKIPPED. "
            "Set META_APP_SECRET in .env to enforce HMAC checks."
        )

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    if payload.get("object") != "page":
        return {"status": "ignored", "reason": "not a page event"}

    queued = 0
    for entry in payload.get("entry", []):
        page_id = str(entry.get("id", ""))
        for change in entry.get("changes", []):
            if change.get("field") != "leadgen":
                continue
            value = change.get("value", {})
            leadgen_id = str(value.get("leadgen_id", ""))
            form_id = str(value.get("form_id", ""))
            ad_name = value.get("ad_name", "")
            campaign_name_meta = value.get("campaign_name", "")

            if not leadgen_id:
                continue

            background_tasks.add_task(
                _process_lead,
                page_id=page_id,
                leadgen_id=leadgen_id,
                form_id=form_id,
                ad_name=ad_name,
                campaign_name_meta=campaign_name_meta,
            )
            queued += 1

    logger.info("Meta webhook → %d lead(s) queued", queued)
    return {"status": "ok", "queued": queued}


# ── Background: save + auto-call ──────────────────────────────────────────────

async def _process_lead(
    page_id: str,
    leadgen_id: str,
    form_id: str,
    ad_name: str,
    campaign_name_meta: str,
):
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        # Skip duplicates
        existing = db.query(Lead).filter(Lead.fb_lead_id == leadgen_id).first()
        if existing:
            logger.info("Lead %s already exists — skipping", leadgen_id)
            return

        # Find access token — check per-client first, then platform-level
        access_token = None
        client_id = None

        client = db.query(Client).filter(Client.meta_page_id == page_id).first()
        if client:
            access_token = decrypt(client.meta_access_token)
            client_id = client.id
        else:
            platform = db.query(PlatformIntegration).filter(
                PlatformIntegration.source == "meta",
                PlatformIntegration.meta_page_id == page_id,
            ).first()
            if platform:
                access_token = decrypt(platform.meta_access_token)
                logger.info("Using platform-level Meta token for page_id=%s", page_id)
            else:
                logger.warning(
                    "No client or platform integration found for Meta page_id=%s. "
                    "Connect your page in Integrations → Meta Ads.",
                    page_id,
                )

        if not access_token:
            logger.error(
                "No access token for page %s — saving stub lead for %s. "
                "Connect your page in Integrations → Meta Ads.",
                page_id, leadgen_id,
            )
            _save_stub_lead(db, leadgen_id, page_id, form_id, ad_name, campaign_name_meta, client_id)
            return

        # Fetch full lead data from Graph API
        lead_data = await fetch_lead_from_meta(leadgen_id, access_token)
        if not lead_data:
            logger.error("Graph API returned no data for leadgen_id=%s", leadgen_id)
            _save_stub_lead(db, leadgen_id, page_id, form_id, ad_name, campaign_name_meta, client_id)
            return

        # Find matching campaign: try form_id first, then fallback to any active Meta campaign
        campaign_id = _find_campaign(db, client_id, form_id)

        # Build and save the lead
        lead = Lead(
            client_id=client_id,
            campaign_id=campaign_id,
            source_platform="meta_lead_ads",
            status=LeadStatus.new,
            platform="fb",
            ad_name=lead_data.get("ad_name") or ad_name,
            campaign_name=lead_data.get("campaign_name") or campaign_name_meta,
            form_name=lead_data.get("form_name"),
            fb_lead_id=leadgen_id,
            fb_created_time=lead_data.get("fb_created_time"),
            full_name=lead_data.get("full_name"),
            phone=lead_data.get("phone", ""),
            email=lead_data.get("email"),
            city=lead_data.get("city"),
            inquiry_type=lead_data.get("inquiry_type"),
            problem_description=lead_data.get("problem_description"),
            tests_done=lead_data.get("tests_done"),
            is_working_professional=lead_data.get("is_working_professional"),
        )
        db.add(lead)

        if campaign_id:
            db.query(Campaign).filter(Campaign.id == campaign_id).update(
                {Campaign.total_leads: Campaign.total_leads + 1}
            )

        db.commit()
        db.refresh(lead)
        logger.info(
            "Saved Meta lead %s → client_id=%s campaign_id=%s name=%s phone=%s",
            leadgen_id, client_id, campaign_id, lead.full_name, lead.phone,
        )

        # Auto-call if campaign is active and within calling hours
        if campaign_id:
            await _maybe_auto_call(db, lead, campaign_id)

    except Exception:
        logger.exception("Error processing Meta lead %s", leadgen_id)
        db.rollback()
    finally:
        db.close()


def _find_campaign(db: Session, client_id: int | None, form_id: str) -> int | None:
    """
    Match campaign strictly by Meta form_id.

    Multi-client safety: Vidushi runs ONE Meta page for ALL clients.
    Each client's Lead Ad form has a unique form_id. The campaign in our
    system that has Campaign.meta_form_id == form_id is the authoritative
    owner — no guessing, no cross-client fallback.

    Fallback to "any active campaign" is only allowed when client_id is known
    (per-client webhook token) — safe because we're already scoped to one client.
    """
    if form_id:
        q = db.query(Campaign).filter(Campaign.meta_form_id == form_id)
        if client_id is not None:
            q = q.filter(Campaign.client_id == client_id)
        campaign = q.first()
        if campaign:
            return campaign.id

    # Safe fallback ONLY when a specific client is identified
    if client_id is not None:
        fallback = (
            db.query(Campaign)
            .filter(
                Campaign.client_id == client_id,
                Campaign.lead_sources.contains("meta_lead_ads"),
                Campaign.is_active == True,
            )
            .first()
        )
        return fallback.id if fallback else None

    # Platform-level token with no form_id match → do NOT assign randomly.
    # Lead is saved but unassigned. User should set meta_form_id on the campaign.
    logger.warning(
        "Meta lead arrived with form_id=%r but no campaign matched. "
        "Go to Campaigns and set the Meta Form ID to route this lead.",
        form_id,
    )
    return None


async def _maybe_auto_call(db: Session, lead: Lead, campaign_id: int):
    """Trigger an immediate call if the campaign is active and we're within calling hours."""
    try:
        from models.models.campaign import Campaign
        from models.models.settings import CallingConfig
        from services.calling_service import trigger_call, within_calling_hours
        from services.integration_state import is_source_paused

        if is_source_paused(db, "meta"):
            logger.info("Meta integration is paused — lead %s queued, no auto-call", lead.id)
            return

        campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
        if not campaign or campaign.status != "active":
            logger.info("Campaign %s not active — Meta lead %s queued, no auto-call", campaign_id, lead.id)
            return

        cfg = db.query(CallingConfig).filter(CallingConfig.is_active == True).first()
        if not cfg or not within_calling_hours(cfg):
            logger.info("Outside calling hours — Meta lead %s will be called by scheduler", lead.id)
            return

        lead.status = LeadStatus.calling
        db.commit()

        await trigger_call(lead, db)
        campaign.calls_made = (campaign.calls_made or 0) + 1
        db.commit()
        logger.info("Auto-called Meta lead %s (campaign %s)", lead.id, campaign_id)

    except Exception:
        logger.exception("Auto-call failed for Meta lead %s", lead.id)
        try:
            lead.status = LeadStatus.new
            db.commit()
        except Exception:
            db.rollback()


def _save_stub_lead(
    db, leadgen_id: str, page_id: str, form_id: str,
    ad_name: str, campaign_name_meta: str, client_id: int | None,
):
    """Save a minimal lead record when Graph API call fails."""
    try:
        lead = Lead(
            client_id=client_id,
            source_platform="meta_lead_ads",
            status=LeadStatus.new,
            platform="fb",
            fb_lead_id=leadgen_id,
            ad_name=ad_name,
            campaign_name=campaign_name_meta,
            phone="",
        )
        db.add(lead)
        db.commit()
        logger.info("Saved stub lead for leadgen_id=%s (no access token or Graph API failure)", leadgen_id)
    except Exception:
        logger.exception("Failed to save stub lead %s", leadgen_id)
        db.rollback()
