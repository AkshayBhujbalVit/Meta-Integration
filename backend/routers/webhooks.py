"""
Universal Webhook Receiver
──────────────────────────
POST /webhooks/{source}/{token}

Each client gets a unique webhook_token (UUID). Paste this token into the
platform's webhook URL field — it identifies the client and acts as the
auth credential for that URL.

Supported sources:
  hubspot  — HubSpot CRM contact.creation events
  google   — Google Ads Lead Form Asset submissions (Google's native in-ad form)
  klaviyo  — Klaviyo metric events (Subscribed to List / Filled Out Form)
  website  — generic contact-form submission (clients whose ads link to their own
             website instead of a native ad-platform lead form). Accepts JSON or
             a plain HTML form post (application/x-www-form-urlencoded) — no HMAC,
             same trust model as Google's webhook (the URL token is the credential).

Flow for every incoming webhook:
  1. Look up client by webhook_token → identify tenant
  2. Verify platform-specific HMAC signature (skip if secret not yet saved)
  3. Parse platform payload → list of normalised lead dicts
  4. For each lead: normalize phone to E.164, upsert (idempotent), auto-call
"""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.encryption import decrypt
from models.models.campaign import Campaign
from models.models.client import Client
from models.models.lead import Lead, LeadStatus
from models.models.platform_integration import PlatformIntegration
from services import google_ads_service, hubspot_service, klaviyo_service, website_form_service
from services.phone_service import to_e164

logger = logging.getLogger("webhooks")

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

_ALLOWED_SOURCES = {"hubspot", "google", "klaviyo", "website"}


# ── Main receiver ─────────────────────────────────────────────────────────────

_MAX_PAYLOAD_BYTES = 512_000  # 512 KB


@router.post("/{source}/{token}", status_code=200)
async def receive_webhook(
    source: str,
    token: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    if source not in _ALLOWED_SOURCES:
        raise HTTPException(status_code=404, detail=f"Unknown source '{source}'")

    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > _MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Payload too large")

    # Identify by token — try per-client first, then platform-level
    client = db.query(Client).filter(Client.webhook_token == token).first()
    platform = None
    if not client:
        platform = db.query(PlatformIntegration).filter(
            PlatformIntegration.webhook_token == token,
            PlatformIntegration.source == source,
        ).first()
    if not client and not platform:
        logger.warning("Webhook with unknown token=%s source=%s — ignoring", token, source)
        return {"status": "ignored"}

    body = await request.body()

    try:
        payload = await request.json()
    except Exception:
        # Plain HTML <form method="POST"> submissions (no JS) send this instead of JSON —
        # only website forms realistically hit this path; other sources always send JSON.
        try:
            form = await request.form()
            payload = dict(form)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid request body")

    # Credentials come from whichever record matched
    hs_secret  = (client.hubspot_client_secret if client else (platform.hubspot_client_secret if platform else None))
    klav_key   = (client.klaviyo_api_key if client else (platform.klaviyo_api_key if platform else None))

    # ── Platform-specific: verify + parse ─────────────────────────────────────
    if source == "hubspot":
        sig = request.headers.get("X-HubSpot-Signature", "")
        if hs_secret:
            secret = decrypt(hs_secret)
            if not hubspot_service.verify_signature(body, sig, secret):
                logger.warning("HubSpot signature mismatch")
                raise HTTPException(status_code=403, detail="Invalid HubSpot signature")
        leads_data = hubspot_service.parse_payload(payload)

    elif source == "google":
        leads_data = google_ads_service.parse_payload(payload)

    elif source == "klaviyo":
        sig = request.headers.get("X-Klaviyo-Signature", "")
        ts = request.headers.get("X-Klaviyo-Timestamp", "")
        if klav_key:
            key = decrypt(klav_key)
            url = str(request.url)
            if not klaviyo_service.verify_signature(body, sig, ts, url, key):
                logger.warning("Klaviyo signature mismatch")
                raise HTTPException(status_code=403, detail="Invalid Klaviyo signature")
        leads_data = klaviyo_service.parse_payload(payload)

    elif source == "website":
        leads_data = website_form_service.parse_payload(payload)

    else:
        leads_data = []

    client_id = client.id if client else None

    for lead_data in leads_data:
        background_tasks.add_task(
            _process_lead,
            client_id=client_id,
            source=source,
            lead_data=lead_data,
        )

    logger.info("Webhook %s → client_id=%s, %d lead(s) queued", source, client_id, len(leads_data))
    return {"status": "ok", "queued": len(leads_data)}


# ── Background: save + auto-call ──────────────────────────────────────────────

async def _process_lead(client_id: int, source: str, lead_data: dict):
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        source_platform = f"{source}_webhook"

        phone_raw = (lead_data.get("phone") or "").strip()
        email = (lead_data.get("email") or "").strip().lower()
        phone = to_e164(phone_raw) if phone_raw else ""

        if not phone and not email:
            logger.warning("%s lead has neither phone nor email — skipped", source)
            return

        # ── Idempotent upsert ─────────────────────────────────────────────────
        external_id = lead_data.get("external_id")
        existing = None

        if external_id:
            existing = db.query(Lead).filter(Lead.external_id == external_id).first()
        if not existing and email:
            q = db.query(Lead).filter(Lead.email == email)
            if client_id is not None:
                q = q.filter(Lead.client_id == client_id)
            existing = q.first()
        if not existing and phone:
            q = db.query(Lead).filter(Lead.phone == phone)
            if client_id is not None:
                q = q.filter(Lead.client_id == client_id)
            existing = q.first()

        if existing:
            logger.info("Duplicate %s lead (id=%s) — skipping", source, existing.id)
            return

        # ── Match campaign ────────────────────────────────────────────────────
        campaign_id = _find_campaign(db, client_id, source, lead_data)

        lead = Lead(
            client_id=client_id,
            campaign_id=campaign_id,
            source_platform=source_platform,
            status=LeadStatus.new,
            full_name=lead_data.get("full_name"),
            phone=phone,
            email=email,
            city=lead_data.get("city") or "",
            campaign_name=lead_data.get("campaign_name"),
            form_name=lead_data.get("form_name"),
            problem_description=lead_data.get("problem_description"),
            external_id=external_id,
        )
        db.add(lead)

        if campaign_id:
            db.query(Campaign).filter(Campaign.id == campaign_id).update(
                {Campaign.total_leads: Campaign.total_leads + 1}
            )

        db.commit()
        db.refresh(lead)
        logger.info(
            "Saved %s lead id=%s → client=%s campaign=%s phone=%s",
            source, lead.id, client_id, campaign_id, phone,
        )

        # ── Auto-trigger call if campaign is active ───────────────────────────
        if campaign_id:
            await _maybe_trigger_call(db, lead, campaign_id, source)

    except Exception:
        logger.exception("Error processing %s lead for client_id=%s", source, client_id)
        db.rollback()
    finally:
        db.close()


def _find_campaign(db: Session, client_id: int | None, source: str, lead_data: dict) -> int | None:
    """
    Match campaign by platform-specific ID (hubspot_list_id, google_form_id, klaviyo_list_id).

    Multi-client safety: Vidushi runs ONE HubSpot/Google/Klaviyo account for ALL clients.
    Each client's campaign is tagged with a specific list/form ID in the platform.
    We match on that ID only — never assign randomly across clients.

    Fallback to "any active campaign" is only safe when client_id is known
    (per-client webhook token — already scoped to one client).
    """
    extra = lead_data.get("extra", {}) or {}

    def _scoped(q, **kwargs):
        """Filter by client if known, plus any extra field filters."""
        if client_id is not None:
            q = q.filter(Campaign.client_id == client_id)
        for k, v in kwargs.items():
            q = q.filter(getattr(Campaign, k) == v)
        return q

    matched = None

    if source == "hubspot":
        list_id = str(extra.get("hubspot_list_id", "")).strip()
        if list_id:
            matched = _scoped(db.query(Campaign), hubspot_list_id=list_id).first()

    elif source == "google":
        form_id = str(extra.get("google_form_id", "")).strip()
        if form_id:
            matched = _scoped(db.query(Campaign), google_form_id=form_id).first()
        if not matched:
            gcamp_id = str(extra.get("google_campaign_id", "")).strip()
            if gcamp_id:
                matched = _scoped(db.query(Campaign), google_campaign_id=gcamp_id).first()

    elif source == "klaviyo":
        list_name = str(lead_data.get("campaign_name", "")).strip()
        if list_name:
            matched = _scoped(db.query(Campaign), klaviyo_list_id=list_name).first()

    elif source == "website":
        form_id = str(extra.get("website_form_id", "")).strip()
        if form_id:
            matched = _scoped(db.query(Campaign), website_form_id=form_id).first()

    if matched:
        return matched.id

    # Safe fallback ONLY when a specific client is identified (per-client webhook token)
    if client_id is not None:
        source_tag = f"{source}_webhook"
        fallback = (
            db.query(Campaign)
            .filter(
                Campaign.client_id == client_id,
                Campaign.lead_sources.contains(source_tag),
                Campaign.is_active == True,
            )
            .first()
        )
        return fallback.id if fallback else None

    # Platform-level token with no specific ID match → do NOT assign randomly.
    logger.warning(
        "%s lead arrived but no campaign matched (extra=%r). "
        "Set the matching list/form ID on a Campaign to route this lead.",
        source.upper(), extra,
    )
    return None


async def _maybe_trigger_call(db: Session, lead: Lead, campaign_id: int, source: str):
    """Auto-dial the lead if the integration isn't paused, the campaign is active, and we are within calling hours."""
    try:
        from models.models.campaign import Campaign
        from models.models.settings import CallingConfig
        from services.calling_service import trigger_call, within_calling_hours
        from services.integration_state import is_source_paused

        if is_source_paused(db, source):
            logger.info("%s integration is paused — lead %s queued, no auto-call", source, lead.id)
            return

        campaign = db.query(Campaign).filter(Campaign.id == campaign_id).first()
        if not campaign or campaign.status != "active":
            logger.info("Campaign %s not active — lead %s queued, no auto-call", campaign_id, lead.id)
            return

        cfg = db.query(CallingConfig).filter(CallingConfig.is_active == True).first()
        if not cfg or not within_calling_hours(cfg):
            logger.info("Outside calling hours — lead %s will be called by scheduler", lead.id)
            return

        lead.status = LeadStatus.calling
        db.commit()

        result = await trigger_call(lead, db)
        campaign.calls_made = (campaign.calls_made or 0) + 1
        db.commit()
        logger.info("Auto-called lead %s via %s", lead.id, source_from_platform(lead.source_platform))

    except Exception:
        logger.exception("Auto-trigger failed for lead %s", lead.id)
        # Reset status so scheduler can retry
        try:
            lead.status = LeadStatus.new
            db.commit()
        except Exception:
            db.rollback()


def source_from_platform(platform: str | None) -> str:
    return (platform or "").replace("_webhook", "").upper()
