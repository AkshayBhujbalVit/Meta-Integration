import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.config import BACKEND_PUBLIC_URL
from core.database import get_db
from core.dependencies import get_current_admin, verify_client_access
from core.encryption import encrypt, decrypt
from models.models.admin import Admin
from models.models.client import Client
from services.meta_service import save_client_meta_page

router = APIRouter(prefix="/clients", tags=["Clients"])

LOGO_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads", "client_logos")
os.makedirs(LOGO_UPLOAD_DIR, exist_ok=True)
_ALLOWED_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg", ".webp"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class ClientCreate(BaseModel):
    name: str
    business_type: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    address: str | None = None
    city: str | None = None
    notes: str | None = None
    meta_page_id: str | None = None
    meta_page_name: str | None = None


class ClientUpdate(BaseModel):
    name: str | None = None
    business_type: str | None = None
    phone: str | None = None
    email: str | None = None
    website: str | None = None
    address: str | None = None
    city: str | None = None
    notes: str | None = None
    meta_page_id: str | None = None
    meta_page_name: str | None = None
    primary_color: str | None = None
    is_active: bool | None = None


def _serialize(c: Client) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "business_type": c.business_type,
        "phone": c.phone,
        "email": c.email,
        "website": c.website,
        "address": c.address,
        "city": c.city,
        "notes": c.notes,
        "logo_url": c.logo_url,
        "primary_color": c.primary_color,
        "meta_page_id": c.meta_page_id,
        "meta_page_name": c.meta_page_name,
        "hubspot_portal_id": c.hubspot_portal_id,
        "hubspot_connected": bool(c.hubspot_api_key),
        "google_ads_customer_id": c.google_ads_customer_id,
        "google_ads_connected": bool(c.google_ads_refresh_token),
        "klaviyo_account_id": c.klaviyo_account_id,
        "klaviyo_connected": bool(c.klaviyo_api_key),
        "webhook_token": c.webhook_token,
        "is_active": c.is_active,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_clients(
    is_active: bool | None = Query(None),
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    q = db.query(Client)
    # Tenant admins only ever see their own client — never the full list.
    if admin.client_id is not None:
        q = q.filter(Client.id == admin.client_id)
    if is_active is not None:
        q = q.filter(Client.is_active == is_active)
    clients = q.order_by(Client.name).all()
    return [_serialize(c) for c in clients]


@router.post("", status_code=201)
def create_client(
    body: ClientCreate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(get_current_admin),
):
    # Only Vidushi super-admins provision new clients this way; doctors get
    # their own Client row created together with their Admin via /auth/signup.
    if admin.client_id is not None:
        raise HTTPException(status_code=403, detail="Not authorized to create clients")
    client = Client(**body.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    return _serialize(client)


@router.get("/{client_id}")
def get_client(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    return _serialize(client)


@router.patch("/{client_id}")
def update_client(
    client_id: int,
    body: ClientUpdate,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(client, field, value)
    db.commit()
    db.refresh(client)
    return _serialize(client)


@router.delete("/{client_id}", status_code=204)
def delete_client(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    db.delete(client)
    db.commit()


# ── Branding ──────────────────────────────────────────────────────────────────

@router.post("/{client_id}/logo")
async def upload_client_logo(
    client_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    """Upload a logo image for this client's dashboard/login branding."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in _ALLOWED_LOGO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(_ALLOWED_LOGO_EXTENSIONS))}",
        )

    filename = f"client_{client_id}_{uuid.uuid4().hex[:8]}{ext}"
    save_path = os.path.join(LOGO_UPLOAD_DIR, filename)
    with open(save_path, "wb") as f:
        f.write(await file.read())

    client.logo_url = f"{BACKEND_PUBLIC_URL}/uploads/client_logos/{filename}"
    db.commit()
    db.refresh(client)
    return {"logo_url": client.logo_url}


# ── Meta connection ───────────────────────────────────────────────────────────

class MetaConnectBody(BaseModel):
    meta_page_id: str
    meta_page_name: str | None = None
    meta_access_token: str       # plaintext — we encrypt before storing


@router.post("/{client_id}/connect-meta")
def connect_meta_page(
    client_id: int,
    body: MetaConnectBody,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    """Link a Meta Facebook Page to this client and store the page access token."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    save_client_meta_page(db, client, body.meta_page_id, body.meta_page_name, body.meta_access_token)
    return {
        "ok": True,
        "client_id": client_id,
        "meta_page_id": body.meta_page_id,
        "meta_page_name": body.meta_page_name,
    }


# ── Calling config ────────────────────────────────────────────────────────────

MASKED = "••••••••••••"


class CallingConfigBody(BaseModel):
    provider: str | None = None         # twilio | vobiz | livekit_sip | custom
    account_sid: str | None = None      # Twilio Account SID / VoBiz Auth ID
    auth_token: str | None = None       # plaintext — stored encrypted
    from_number: str | None = None      # E.164 caller number e.g. +91XXXXXXXXXX
    sip_trunk_id: str | None = None     # LiveKit SIP trunk


@router.get("/{client_id}/calling-config")
def get_calling_config(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    cfg = dict(client.calling_config or {})
    return {
        "provider": cfg.get("provider"),
        "account_sid": cfg.get("account_sid"),
        "auth_token_set": bool(cfg.get("auth_token_enc")),
        "from_number": cfg.get("from_number"),
        "sip_trunk_id": cfg.get("sip_trunk_id"),
    }


@router.put("/{client_id}/calling-config")
def update_calling_config(
    client_id: int,
    body: CallingConfigBody,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    cfg = dict(client.calling_config or {})
    update = body.model_dump(exclude_none=True)
    if "auth_token" in update:
        cfg["auth_token_enc"] = encrypt(update.pop("auth_token"))
    cfg.update(update)
    client.calling_config = cfg
    db.commit()
    return {"ok": True}


# ── SMS config ────────────────────────────────────────────────────────────────

class SMSConfigBody(BaseModel):
    provider: str | None = None     # twilio | msg91 | textlocal | custom
    from_number: str | None = None
    sender_id: str | None = None
    api_key: str | None = None       # plaintext — stored encrypted


@router.get("/{client_id}/sms-config")
def get_sms_config(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    cfg = dict(client.sms_config or {})
    return {
        "provider": cfg.get("provider"),
        "from_number": cfg.get("from_number"),
        "sender_id": cfg.get("sender_id"),
        "api_key_set": bool(cfg.get("api_key_enc")),
    }


@router.put("/{client_id}/sms-config")
def update_sms_config(
    client_id: int,
    body: SMSConfigBody,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    cfg = dict(client.sms_config or {})
    update = body.model_dump(exclude_none=True)
    if "api_key" in update:
        cfg["api_key_enc"] = encrypt(update.pop("api_key"))
    cfg.update(update)
    client.sms_config = cfg
    db.commit()
    return {"ok": True}


# ── WhatsApp config ───────────────────────────────────────────────────────────

class WhatsAppConfigBody(BaseModel):
    provider: str | None = None              # meta_cloud | twilio
    phone_number_id: str | None = None       # Meta Cloud API phone number ID
    access_token: str | None = None          # plaintext — stored encrypted
    business_account_id: str | None = None   # Meta Business Account ID


@router.get("/{client_id}/whatsapp-config")
def get_whatsapp_config(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    cfg = dict(client.whatsapp_config or {})
    return {
        "provider": cfg.get("provider"),
        "phone_number_id": cfg.get("phone_number_id"),
        "access_token_set": bool(cfg.get("access_token_enc")),
        "business_account_id": cfg.get("business_account_id"),
    }


@router.put("/{client_id}/whatsapp-config")
def update_whatsapp_config(
    client_id: int,
    body: WhatsAppConfigBody,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    cfg = dict(client.whatsapp_config or {})
    update = body.model_dump(exclude_none=True)
    if "access_token" in update:
        cfg["access_token_enc"] = encrypt(update.pop("access_token"))
    cfg.update(update)
    client.whatsapp_config = cfg
    db.commit()
    return {"ok": True}


# ── Webhook token ─────────────────────────────────────────────────────────────

@router.post("/{client_id}/generate-webhook-token")
def generate_webhook_token(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    """Generate (or regenerate) the unique webhook token for this client."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.webhook_token = str(uuid.uuid4())
    db.commit()
    return {
        "webhook_token": client.webhook_token,
        "webhook_urls": {
            "hubspot": f"{BACKEND_PUBLIC_URL}/webhooks/hubspot/{client.webhook_token}",
            "google":  f"{BACKEND_PUBLIC_URL}/webhooks/google/{client.webhook_token}",
            "klaviyo": f"{BACKEND_PUBLIC_URL}/webhooks/klaviyo/{client.webhook_token}",
        },
    }


@router.get("/{client_id}/webhook-urls")
def get_webhook_urls(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    """Return the webhook URLs for all platforms for this client."""
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if not client.webhook_token:
        raise HTTPException(
            status_code=400,
            detail="Webhook token not yet generated. Call POST /clients/{id}/generate-webhook-token first.",
        )
    return {
        "webhook_token": client.webhook_token,
        "webhook_urls": {
            "hubspot": f"{BACKEND_PUBLIC_URL}/webhooks/hubspot/{client.webhook_token}",
            "google":  f"{BACKEND_PUBLIC_URL}/webhooks/google/{client.webhook_token}",
            "klaviyo": f"{BACKEND_PUBLIC_URL}/webhooks/klaviyo/{client.webhook_token}",
        },
    }


# ── HubSpot integration ───────────────────────────────────────────────────────

class HubSpotConnectBody(BaseModel):
    portal_id: str | None = None
    api_key: str                    # HubSpot Private App token (plaintext — encrypted at rest)
    client_secret: str | None = None  # For webhook signature verification


@router.post("/{client_id}/connect-hubspot")
def connect_hubspot(
    client_id: int,
    body: HubSpotConnectBody,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.hubspot_portal_id = body.portal_id
    client.hubspot_api_key = encrypt(body.api_key)
    if body.client_secret:
        client.hubspot_client_secret = encrypt(body.client_secret)
    if not client.webhook_token:
        client.webhook_token = str(uuid.uuid4())
    db.commit()
    return {
        "ok": True,
        "portal_id": body.portal_id,
        "webhook_url": f"{BACKEND_PUBLIC_URL}/webhooks/hubspot/{client.webhook_token}",
    }


@router.delete("/{client_id}/connect-hubspot", status_code=204)
def disconnect_hubspot(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.hubspot_portal_id = None
    client.hubspot_api_key = None
    client.hubspot_client_secret = None
    db.commit()


# ── Google Ads integration ────────────────────────────────────────────────────

class GoogleAdsConnectBody(BaseModel):
    customer_id: str | None = None     # Google Ads Customer ID (e.g. 123-456-7890)
    refresh_token: str | None = None   # OAuth refresh token (plaintext — encrypted at rest)


@router.post("/{client_id}/connect-google")
def connect_google_ads(
    client_id: int,
    body: GoogleAdsConnectBody,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.google_ads_customer_id = body.customer_id
    if body.refresh_token:
        client.google_ads_refresh_token = encrypt(body.refresh_token)
    if not client.webhook_token:
        client.webhook_token = str(uuid.uuid4())
    db.commit()
    return {
        "ok": True,
        "customer_id": body.customer_id,
        "webhook_url": f"{BACKEND_PUBLIC_URL}/webhooks/google/{client.webhook_token}",
        "instructions": (
            "Paste this URL into: Google Ads → Assets → Lead Form Asset → "
            "Lead Delivery → Webhook URL"
        ),
    }


@router.delete("/{client_id}/connect-google", status_code=204)
def disconnect_google_ads(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.google_ads_customer_id = None
    client.google_ads_refresh_token = None
    db.commit()


# ── Klaviyo integration ───────────────────────────────────────────────────────

class KlaviyoConnectBody(BaseModel):
    account_id: str | None = None   # Klaviyo account/company ID (for display)
    api_key: str                    # Klaviyo Private API key — used for signature verification


@router.post("/{client_id}/connect-klaviyo")
def connect_klaviyo(
    client_id: int,
    body: KlaviyoConnectBody,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.klaviyo_account_id = body.account_id
    client.klaviyo_api_key = encrypt(body.api_key)
    if not client.webhook_token:
        client.webhook_token = str(uuid.uuid4())
    db.commit()
    return {
        "ok": True,
        "account_id": body.account_id,
        "webhook_url": f"{BACKEND_PUBLIC_URL}/webhooks/klaviyo/{client.webhook_token}",
        "instructions": (
            "Paste this URL into: Klaviyo → Integrations → Webhooks → Add Webhook URL. "
            "Subscribe to: 'Subscribed to List' and/or 'Filled Out Form'."
        ),
    }


@router.delete("/{client_id}/connect-klaviyo", status_code=204)
def disconnect_klaviyo(
    client_id: int,
    db: Session = Depends(get_db),
    _: int = Depends(verify_client_access),
):
    client = db.query(Client).filter(Client.id == client_id).first()
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    client.klaviyo_account_id = None
    client.klaviyo_api_key = None
    db.commit()
