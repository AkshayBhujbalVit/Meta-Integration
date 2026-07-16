"""
Platform-level integration settings.
Vidushi Infotech runs ONE set of integrations (HubSpot, Google Ads, Klaviyo, Meta).
Leads flow into the unified platform and get routed to campaigns via campaign rules.
"""
import logging
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from core.encryption import decrypt, encrypt
from models.models.admin import Admin
from models.models.campaign import Campaign
from models.models.client import Client
from models.models.meta_lead_form import MetaLeadForm
from models.models.meta_synced_campaign import MetaSyncedCampaign
from models.models.platform_integration import PlatformIntegration
from services import meta_ads_service

logger = logging.getLogger("integrations")
router = APIRouter(prefix="/integrations", tags=["Integrations"])

BASE_WEBHOOK_URL = "http://localhost:8009"  # overridden by env in production


def _webhook_url(source: str, token: str) -> str:
    import os
    base = os.getenv("PUBLIC_BACKEND_URL", BASE_WEBHOOK_URL).rstrip("/")
    return f"{base}/webhooks/{source}/{token}"


def _get_or_create(db: Session, source: str) -> PlatformIntegration:
    obj = db.query(PlatformIntegration).filter(PlatformIntegration.source == source).first()
    if not obj:
        obj = PlatformIntegration(source=source, webhook_token=str(uuid.uuid4()))
        db.add(obj)
        db.commit()
        db.refresh(obj)
    elif not obj.webhook_token:
        obj.webhook_token = str(uuid.uuid4())
        db.commit()
        db.refresh(obj)
    return obj


def _resolve_meta_account(db: Session, admin: Admin, client_id: int | None = None):
    """
    Returns (obj, client_id_or_none) — the object holding this request's Meta
    credentials. `Client` and `PlatformIntegration` share the same field names
    for Meta (meta_page_id/meta_access_token/meta_user_access_token/
    meta_ad_account_id), so callers can read/write either one identically.

    Tenant admins are always scoped to their own client. A Vidushi
    super-admin may pass client_id explicitly to manage a specific tenant's
    Meta connection, or omit it to fall back to the platform-level
    (agency-wide) Meta connection.
    """
    target_client_id = admin.client_id if admin.client_id is not None else client_id
    if target_client_id is not None:
        client = db.query(Client).filter(Client.id == target_client_id).first()
        if not client:
            raise HTTPException(404, "Client not found")
        return client, target_client_id
    return _get_or_create(db, "meta"), None


def _serialize(obj: PlatformIntegration, source: str) -> dict:
    token = obj.webhook_token or ""
    connected = False
    if source == "meta":
        connected = bool(obj.meta_page_id and obj.meta_access_token)
    elif source == "hubspot":
        connected = bool(obj.hubspot_api_key)
    elif source == "google":
        connected = bool(obj.webhook_token)
    elif source == "klaviyo":
        connected = bool(obj.klaviyo_api_key)
    elif source == "website":
        connected = bool(obj.webhook_token)

    import os
    backend_url = os.getenv("PUBLIC_BACKEND_URL", "http://localhost:8009").rstrip("/")

    return {
        "source": source,
        "connected": connected,
        "is_paused": bool(obj.is_paused),
        "webhook_token": token,
        "webhook_url": _webhook_url(source, token) if token else None,
        # Meta
        "meta_page_id": obj.meta_page_id,
        "meta_page_name": obj.meta_page_name,
        "meta_ad_account_id": obj.meta_ad_account_id,
        "meta_callback_url": f"{backend_url}/meta/webhook",
        "meta_verify_token_set": bool(os.getenv("META_VERIFY_TOKEN")),
        "meta_app_secret_set": bool(os.getenv("META_APP_SECRET")),
        # HubSpot
        "hubspot_portal_id": obj.hubspot_portal_id,
        "hubspot_connected": bool(obj.hubspot_api_key),
        # Google
        "google_customer_id": obj.google_customer_id,
        # Klaviyo
        "klaviyo_account_id": obj.klaviyo_account_id,
        "klaviyo_connected": bool(obj.klaviyo_api_key),
    }


def _serialize_meta(obj, client_id: int | None) -> dict:
    """
    Meta is tenant-scoped (obj may be a Client or the platform-level
    PlatformIntegration singleton), so it can't reuse `_serialize` — Client
    has no `is_paused`/`webhook_token` columns.
    """
    backend_url = os.getenv("PUBLIC_BACKEND_URL", "http://localhost:8009").rstrip("/")
    return {
        "source": "meta",
        "connected": bool(obj.meta_page_id and obj.meta_access_token),
        "is_paused": bool(getattr(obj, "is_paused", False)),
        "client_id": client_id,
        "meta_page_id": obj.meta_page_id,
        "meta_page_name": obj.meta_page_name,
        "meta_ad_account_id": obj.meta_ad_account_id,
        "meta_callback_url": f"{backend_url}/meta/webhook",
        "meta_verify_token_set": bool(os.getenv("META_VERIFY_TOKEN")),
        "meta_app_secret_set": bool(os.getenv("META_APP_SECRET")),
    }


# ── GET all ───────────────────────────────────────────────────────────────────

@router.get("")
def list_integrations(
    client_id: int | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    results = {}
    meta_obj, meta_client_id = _resolve_meta_account(db, admin, client_id)
    results["meta"] = _serialize_meta(meta_obj, meta_client_id)
    for source in ("hubspot", "google", "klaviyo", "website"):
        obj = db.query(PlatformIntegration).filter(PlatformIntegration.source == source).first()
        if obj:
            results[source] = _serialize(obj, source)
        else:
            results[source] = {"source": source, "connected": False}
    return results


@router.get("/{source}")
def get_integration(
    source: str,
    client_id: int | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    if source not in ("meta", "hubspot", "google", "klaviyo", "website"):
        raise HTTPException(404, "Unknown source")
    if source == "meta":
        obj, scoped_client_id = _resolve_meta_account(db, admin, client_id)
        return _serialize_meta(obj, scoped_client_id)
    obj = db.query(PlatformIntegration).filter(PlatformIntegration.source == source).first()
    if not obj:
        return {"source": source, "connected": False}
    return _serialize(obj, source)


# ── Meta ──────────────────────────────────────────────────────────────────────

class MetaConnect(BaseModel):
    meta_page_id: str
    meta_page_name: str | None = None
    meta_access_token: str


@router.post("/meta")
def connect_meta(body: MetaConnect, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    obj = _get_or_create(db, "meta")
    obj.meta_page_id = body.meta_page_id
    obj.meta_page_name = body.meta_page_name
    obj.meta_access_token = encrypt(body.meta_access_token)
    db.commit()
    db.refresh(obj)
    return _serialize(obj, "meta")


@router.delete("/meta")
def disconnect_meta(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    obj = db.query(PlatformIntegration).filter(PlatformIntegration.source == "meta").first()
    if obj:
        obj.meta_page_id = None
        obj.meta_page_name = None
        obj.meta_access_token = None
        db.commit()
    return {"status": "disconnected"}


# ── HubSpot ───────────────────────────────────────────────────────────────────

class HubSpotConnect(BaseModel):
    portal_id: str | None = None
    api_key: str
    client_secret: str | None = None


@router.post("/hubspot")
def connect_hubspot(body: HubSpotConnect, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    obj = _get_or_create(db, "hubspot")
    obj.hubspot_portal_id = body.portal_id
    obj.hubspot_api_key = encrypt(body.api_key)
    obj.hubspot_client_secret = encrypt(body.client_secret) if body.client_secret else None
    db.commit()
    db.refresh(obj)
    return _serialize(obj, "hubspot")


@router.delete("/hubspot")
def disconnect_hubspot(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    obj = db.query(PlatformIntegration).filter(PlatformIntegration.source == "hubspot").first()
    if obj:
        obj.hubspot_api_key = None
        obj.hubspot_client_secret = None
        db.commit()
    return {"status": "disconnected"}


# ── Google Ads ────────────────────────────────────────────────────────────────

class GoogleConnect(BaseModel):
    customer_id: str | None = None


@router.post("/google")
def connect_google(body: GoogleConnect, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    obj = _get_or_create(db, "google")
    obj.google_customer_id = body.customer_id
    db.commit()
    db.refresh(obj)
    return _serialize(obj, "google")


@router.delete("/google")
def disconnect_google(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    obj = db.query(PlatformIntegration).filter(PlatformIntegration.source == "google").first()
    if obj:
        obj.google_customer_id = None
        db.commit()
    return {"status": "disconnected"}


# ── Klaviyo ───────────────────────────────────────────────────────────────────

class KlaviyoConnect(BaseModel):
    account_id: str | None = None
    api_key: str


@router.post("/klaviyo")
def connect_klaviyo(body: KlaviyoConnect, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    obj = _get_or_create(db, "klaviyo")
    obj.klaviyo_account_id = body.account_id
    obj.klaviyo_api_key = encrypt(body.api_key)
    db.commit()
    db.refresh(obj)
    return _serialize(obj, "klaviyo")


@router.delete("/klaviyo")
def disconnect_klaviyo(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    obj = db.query(PlatformIntegration).filter(PlatformIntegration.source == "klaviyo").first()
    if obj:
        obj.klaviyo_api_key = None
        db.commit()
    return {"status": "disconnected"}


# ── Regenerate webhook token ───────────────────────────────────────────────────

@router.post("/{source}/regenerate-token")
def regenerate_token(source: str, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    if source not in ("meta", "hubspot", "google", "klaviyo", "website"):
        raise HTTPException(404, "Unknown source")
    obj = _get_or_create(db, source)
    obj.webhook_token = str(uuid.uuid4())
    db.commit()
    db.refresh(obj)
    return _serialize(obj, source)


# ── Pause / resume (generic — stops auto-calling for leads from this source) ──

class PauseBody(BaseModel):
    is_paused: bool


@router.patch("/{source}")
def set_paused(source: str, body: PauseBody, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    if source not in ("meta", "hubspot", "google", "klaviyo", "website"):
        raise HTTPException(404, "Unknown source")
    obj = _get_or_create(db, source)
    obj.is_paused = body.is_paused
    db.commit()
    db.refresh(obj)
    return _serialize(obj, source)


# ── Meta — ad account selection ────────────────────────────────────────────────

@router.get("/meta/ad-accounts")
async def list_meta_ad_accounts(
    client_id: int | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    obj, _ = _resolve_meta_account(db, admin, client_id)
    if not obj.meta_user_access_token:
        raise HTTPException(400, "Connect Meta first via Connect with Facebook.")
    token = decrypt(obj.meta_user_access_token)
    try:
        accounts = await meta_ads_service.list_ad_accounts(token)
    except Exception as e:
        raise HTTPException(502, f"Meta API error: {e}") from e
    return {"ad_accounts": accounts, "selected": obj.meta_ad_account_id}


class AdAccountBody(BaseModel):
    ad_account_id: str


@router.patch("/meta/ad-account")
def select_meta_ad_account(
    body: AdAccountBody,
    client_id: int | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    obj, _ = _resolve_meta_account(db, admin, client_id)
    obj.meta_ad_account_id = body.ad_account_id
    db.commit()
    return {"ok": True, "meta_ad_account_id": body.ad_account_id}


# ── Meta — sync Campaigns / Ad Sets / Lead Forms ──────────────────────────────

@router.post("/meta/sync")
async def sync_meta_campaigns(
    client_id: int | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    obj, scoped_client_id = _resolve_meta_account(db, admin, client_id)
    if not obj.meta_page_id or not obj.meta_access_token:
        raise HTTPException(400, "Connect Meta first via Connect with Facebook.")

    now = datetime.now(timezone.utc)
    campaigns_synced = 0
    adsets_synced = 0
    forms_synced = 0

    if obj.meta_ad_account_id and obj.meta_user_access_token:
        user_token = decrypt(obj.meta_user_access_token)
        try:
            campaigns = await meta_ads_service.list_campaigns(obj.meta_ad_account_id, user_token)
            adsets = await meta_ads_service.list_adsets(obj.meta_ad_account_id, user_token)
        except Exception as e:
            raise HTTPException(502, f"Meta Ads API error: {e}") from e

        for c in campaigns:
            _upsert_synced_campaign(db, c["id"], "campaign", None, c.get("name"),
                                     c.get("status"), c.get("objective"), obj.meta_ad_account_id, now,
                                     scoped_client_id)
            campaigns_synced += 1
        for a in adsets:
            _upsert_synced_campaign(db, a["id"], "adset", str(a.get("campaign_id") or ""), a.get("name"),
                                     a.get("status"), None, obj.meta_ad_account_id, now,
                                     scoped_client_id)
            adsets_synced += 1
        db.commit()
    else:
        logger.info("No Meta ad account selected — skipping Campaign/Ad Set sync. "
                    "Pick one via GET/PATCH /integrations/meta/ad-account.")

    page_token = decrypt(obj.meta_access_token)
    try:
        forms = await meta_ads_service.list_lead_forms(obj.meta_page_id, page_token)
    except Exception as e:
        raise HTTPException(502, f"Meta Graph API error fetching lead forms: {e}") from e

    for f in forms:
        form = db.query(MetaLeadForm).filter(MetaLeadForm.external_id == f["id"]).first()
        if not form:
            form = MetaLeadForm(external_id=f["id"])
            db.add(form)
        form.client_id = scoped_client_id
        form.page_id = obj.meta_page_id
        form.name = f.get("name")
        form.status = f.get("status")
        form.leads_count = f.get("leads_count")
        form.synced_at = now
        forms_synced += 1
    db.commit()

    return {
        "status": "ok",
        "campaigns_synced": campaigns_synced,
        "adsets_synced": adsets_synced,
        "forms_synced": forms_synced,
        "ad_account_selected": bool(obj.meta_ad_account_id),
    }


def _upsert_synced_campaign(
    db, external_id, level, parent_external_id, name, status, objective, ad_account_id, now, client_id=None,
):
    row = db.query(MetaSyncedCampaign).filter(MetaSyncedCampaign.external_id == external_id).first()
    if not row:
        row = MetaSyncedCampaign(external_id=external_id, level=level)
        db.add(row)
    row.client_id = client_id
    row.level = level
    row.parent_external_id = parent_external_id
    row.name = name
    row.status = status
    row.objective = objective
    row.ad_account_id = ad_account_id
    row.synced_at = now


@router.get("/meta/campaigns")
def get_meta_synced_campaigns(
    client_id: int | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    scoped_client_id = admin.client_id if admin.client_id is not None else client_id
    rows = (
        db.query(MetaSyncedCampaign)
        .filter(MetaSyncedCampaign.client_id == scoped_client_id)
        .order_by(MetaSyncedCampaign.name)
        .all()
    )
    campaigns = [r for r in rows if r.level == "campaign"]
    adsets = [r for r in rows if r.level == "adset"]
    tree = []
    for c in campaigns:
        tree.append({
            "id": c.external_id,
            "name": c.name,
            "status": c.status,
            "objective": c.objective,
            "synced_at": c.synced_at.isoformat() if c.synced_at else None,
            "adsets": [
                {"id": a.external_id, "name": a.name, "status": a.status,
                 "synced_at": a.synced_at.isoformat() if a.synced_at else None}
                for a in adsets if a.parent_external_id == c.external_id
            ],
        })
    return {"campaigns": tree}


# ── Meta — Lead Forms + AI toggle ─────────────────────────────────────────────

def _serialize_form(f: MetaLeadForm) -> dict:
    return {
        "id": f.id,
        "external_id": f.external_id,
        "name": f.name,
        "status": f.status,
        "leads_count": f.leads_count,
        "ai_enabled": f.ai_enabled,
        "linked_campaign_id": f.linked_campaign_id,
        "synced_at": f.synced_at.isoformat() if f.synced_at else None,
    }


@router.get("/meta/lead-forms")
def get_meta_lead_forms(
    client_id: int | None = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    scoped_client_id = admin.client_id if admin.client_id is not None else client_id
    forms = (
        db.query(MetaLeadForm)
        .filter(MetaLeadForm.client_id == scoped_client_id)
        .order_by(MetaLeadForm.name)
        .all()
    )
    return {"lead_forms": [_serialize_form(f) for f in forms]}


class LeadFormToggle(BaseModel):
    ai_enabled: bool
    campaign_id: int | None = None
    create_campaign: dict | None = None  # {"client_id": int, "name": str}


@router.patch("/meta/lead-forms/{form_id}")
def toggle_meta_lead_form(
    form_id: int, body: LeadFormToggle, db: Session = Depends(get_db), admin: Admin = Depends(get_current_admin),
):
    form = db.query(MetaLeadForm).filter(MetaLeadForm.id == form_id).first()
    if not form:
        raise HTTPException(404, "Lead form not found")
    if admin.client_id is not None and form.client_id != admin.client_id:
        raise HTTPException(403, "Not authorized for this lead form")

    if body.ai_enabled:
        campaign = None
        if body.campaign_id:
            campaign = db.query(Campaign).filter(Campaign.id == body.campaign_id).first()
            if not campaign:
                raise HTTPException(404, "Campaign not found")
            if admin.client_id is not None and campaign.client_id != admin.client_id:
                raise HTTPException(403, "Not authorized for this campaign")
        elif body.create_campaign:
            # Tenant admins can only ever create campaigns under their own client —
            # never trust a client_id passed in the request body.
            client_id = admin.client_id if admin.client_id is not None else body.create_campaign.get("client_id")
            name = body.create_campaign.get("name")
            if not client_id or not name:
                raise HTTPException(400, "create_campaign requires client_id and name")
            campaign = Campaign(client_id=client_id, name=name, meta_form_id=form.external_id)
            db.add(campaign)
            db.flush()
        elif form.linked_campaign_id:
            campaign = db.query(Campaign).filter(Campaign.id == form.linked_campaign_id).first()

        if not campaign:
            raise HTTPException(
                400,
                "Provide campaign_id (link an existing campaign) or create_campaign "
                "(client_id + name) to enable AI calling for this lead form.",
            )
        if campaign.meta_form_id and campaign.meta_form_id != form.external_id:
            raise HTTPException(
                400,
                f"Campaign '{campaign.name}' is already routing a different Meta form "
                f"({campaign.meta_form_id}). Pick a different campaign.",
            )

        # Changing which campaign this form routes to — clear the old campaign's
        # link so it doesn't keep stale routing to a form it no longer owns.
        if form.linked_campaign_id and form.linked_campaign_id != campaign.id:
            old_campaign = db.query(Campaign).filter(Campaign.id == form.linked_campaign_id).first()
            if old_campaign and old_campaign.meta_form_id == form.external_id:
                old_campaign.meta_form_id = None

        campaign.meta_form_id = form.external_id
        form.linked_campaign_id = campaign.id
        form.ai_enabled = True
    else:
        form.ai_enabled = False

    db.commit()
    db.refresh(form)
    return _serialize_form(form)
