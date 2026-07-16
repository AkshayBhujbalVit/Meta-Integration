"""
OAuth 2.0 Flows
───────────────
POST /oauth/meta/start         — (auth) returns the Facebook OAuth URL to open in a popup
GET  /oauth/meta/callback      — Meta redirects here after user authorises; saves page; closes popup
POST /oauth/meta/select-page   — when user has multiple FB pages, call this to pick one
POST /oauth/hubspot/start      — (auth) returns the HubSpot OAuth URL to open in a popup
GET  /oauth/hubspot/callback   — HubSpot redirects here after authorisation; saves tokens; closes popup

Security:
  - /start endpoints require JWT auth (caller must be logged-in admin)
  - A short-lived CSRF state token is generated per /start call and consumed in the callback
  - Page session tokens let the frontend select from multiple FB pages without re-exposing raw tokens
"""

import logging
import secrets
import urllib.parse
import uuid
from time import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from core.config import (
    BACKEND_PUBLIC_URL,
    FRONTEND_URL,
    HUBSPOT_CLIENT_ID,
    HUBSPOT_CLIENT_SECRET,
    META_APP_ID,
    META_APP_SECRET,
)
from core.database import get_db
from core.dependencies import get_current_admin
from core.encryption import encrypt
from models.models.admin import Admin
from models.models.client import Client
from models.models.platform_integration import PlatformIntegration
from services.meta_service import save_client_meta_ad_accounts, save_client_meta_page

logger = logging.getLogger("oauth")
router = APIRouter(prefix="/oauth", tags=["OAuth"])

# ── CSRF state store (per /start call, single-use, TTL 5 min) ────────────────
# Carries which client_id (if any) this OAuth round-trip is connecting Meta
# for, so the callback knows whether to save onto a specific tenant's Client
# row or (for a Vidushi super-admin with no client_id) the platform-level
# PlatformIntegration singleton.

_STATE: dict[str, tuple[float, int | None]] = {}
_STATE_TTL = 300


def _new_state(client_id: int | None = None) -> str:
    _prune_states()
    token = secrets.token_urlsafe(32)
    _STATE[token] = (time(), client_id)
    return token


def _consume_state(token: str) -> tuple[bool, int | None]:
    _prune_states()
    entry = _STATE.pop(token, None)
    if entry is None:
        return False, None
    _, client_id = entry
    return True, client_id


def _prune_states():
    cutoff = time() - _STATE_TTL
    for k in [k for k, (ts, _) in _STATE.items() if ts < cutoff]:
        del _STATE[k]


# ── Page session store (multiple-page selection, TTL 10 min) ─────────────────

_PAGE_SESSIONS: dict[str, tuple[float, int | None, list[dict]]] = {}
_PAGE_SESSION_TTL = 600


def _store_pages(pages: list[dict], client_id: int | None) -> str:
    sid = secrets.token_urlsafe(16)
    _PAGE_SESSIONS[sid] = (time(), client_id, pages)
    return sid


def _consume_pages(sid: str) -> tuple[int | None, list[dict]] | None:
    entry = _PAGE_SESSIONS.pop(sid, None)
    if not entry:
        return None
    created, client_id, pages = entry
    return None if time() - created > _PAGE_SESSION_TTL else (client_id, pages)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_or_create(db: Session, source: str) -> PlatformIntegration:
    obj = db.query(PlatformIntegration).filter(PlatformIntegration.source == source).first()
    if not obj:
        obj = PlatformIntegration(source=source, webhook_token=str(uuid.uuid4()))
        db.add(obj)
        db.commit()
        db.refresh(obj)
    return obj


def _popup_redirect(platform: str, **params) -> RedirectResponse:
    qs = urllib.parse.urlencode({k: str(v) for k, v in params.items() if v is not None})
    return RedirectResponse(f"{FRONTEND_URL}/oauth-callback?platform={platform}&{qs}", status_code=302)


# ─────────────────────────────────────────────────────────────────────────────
# Meta OAuth
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/meta/start")
def meta_start(
    client_id: int | None = Query(None),
    admin: Admin = Depends(get_current_admin),
):
    if not META_APP_ID:
        raise HTTPException(
            500,
            "META_APP_ID is not set in .env. "
            "Go to developers.facebook.com → Your App → Basic Settings → copy the App ID."
        )
    if not META_APP_SECRET:
        raise HTTPException(500, "META_APP_SECRET is not set in .env")

    # Tenant admins always connect their own client, regardless of any
    # client_id passed in. A Vidushi super-admin (admin.client_id is None)
    # may target an explicit client_id, or omit it to connect the
    # platform-level (agency-wide) Meta account instead.
    target_client_id = admin.client_id if admin.client_id is not None else client_id

    state = _new_state(target_client_id)
    redirect_uri = f"{BACKEND_PUBLIC_URL}/oauth/meta/callback"
    url = (
        "https://www.facebook.com/v19.0/dialog/oauth"
        f"?client_id={META_APP_ID}"
        f"&redirect_uri={urllib.parse.quote(redirect_uri, safe='')}"
        # ads_read added so we can mirror the connected account's real Campaigns/Ad Sets —
        # works without App Review as long as the connecting user is an admin of the ad account,
        # same dev-mode rule already relied on for leads_retrieval/pages_read_engagement.
        "&scope=pages_manage_metadata%2Cleads_retrieval%2Cpages_read_engagement%2Cads_read"
        f"&state={state}"
        "&response_type=code"
    )
    return {"url": url}


@router.get("/meta/callback")
async def meta_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    db: Session = Depends(get_db),
):
    if error or not code:
        return _popup_redirect("meta", error=error or "cancelled")

    if not state:
        return _popup_redirect("meta", error="invalid_state")
    state_valid, client_id = _consume_state(state)
    if not state_valid:
        return _popup_redirect("meta", error="invalid_state")

    redirect_uri = f"{BACKEND_PUBLIC_URL}/oauth/meta/callback"

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(
                "https://graph.facebook.com/v19.0/oauth/access_token",
                params={
                    "client_id": META_APP_ID,
                    "client_secret": META_APP_SECRET,
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
            )
            r.raise_for_status()
            user_token = r.json()["access_token"]

            # Exchange for a long-lived (~60 day) token — needed for ad-account/campaign
            # reads done later via "Sync Campaigns", independent of the page token.
            long_lived_token = user_token
            try:
                ll_r = await client.get(
                    "https://graph.facebook.com/v19.0/oauth/access_token",
                    params={
                        "grant_type": "fb_exchange_token",
                        "client_id": META_APP_ID,
                        "client_secret": META_APP_SECRET,
                        "fb_exchange_token": user_token,
                    },
                )
                ll_r.raise_for_status()
                long_lived_token = ll_r.json()["access_token"]
            except Exception:
                logger.warning("Meta long-lived token exchange failed — using short-lived user token")

            pages_r = await client.get(
                "https://graph.facebook.com/v19.0/me/accounts",
                params={"access_token": user_token, "fields": "id,name,access_token", "limit": 20},
            )
            pages_r.raise_for_status()
            pages = pages_r.json().get("data", [])

            # Ad accounts are independent of which page gets selected below.
            ad_accounts: list[dict] = []
            try:
                adacc_r = await client.get(
                    "https://graph.facebook.com/v19.0/me/adaccounts",
                    params={"access_token": long_lived_token, "fields": "id,name,account_status", "limit": 50},
                )
                adacc_r.raise_for_status()
                ad_accounts = adacc_r.json().get("data", [])
            except Exception:
                logger.warning("Meta ad account lookup failed — ads_read may not be granted yet")
    except httpx.HTTPStatusError as e:
        logger.error("Meta OAuth exchange failed: %s", e.response.text)
        return _popup_redirect("meta", error="exchange_failed")
    except Exception:
        logger.exception("Meta OAuth exchange error")
        return _popup_redirect("meta", error="exchange_failed")

    if not pages:
        return _popup_redirect("meta", error="no_pages")

    client = None
    if client_id is not None:
        client = db.query(Client).filter(Client.id == client_id).first()
        if not client:
            return _popup_redirect("meta", error="client_not_found")
        save_client_meta_ad_accounts(db, client, long_lived_token, ad_accounts)
    else:
        _save_meta_ad_accounts(db, long_lived_token, ad_accounts)

    if len(pages) == 1:
        page = pages[0]
        if client is not None:
            save_client_meta_page(db, client, page["id"], page["name"], page["access_token"])
        else:
            _save_meta_page(db, page["id"], page["name"], page["access_token"])
        logger.info("Meta OAuth connected: %s (%s) client_id=%s", page["name"], page["id"], client_id)
        return _popup_redirect("meta", success="1", page_name=page["name"], page_id=page["id"])

    # Multiple pages — store them server-side (with which client this is for), show picker in popup
    sid = _store_pages(pages, client_id)
    names_encoded = urllib.parse.quote("|".join(f"{p['id']}:{p['name']}" for p in pages))
    return _popup_redirect("meta", select="1", session=sid, pages=names_encoded)


@router.post("/meta/select-page")
def meta_select_page(
    session: str = Query(...),
    page_id: str = Query(...),
    db: Session = Depends(get_db),
):
    entry = _consume_pages(session)
    if not entry:
        raise HTTPException(400, "Session expired — please reconnect via the Connect button")
    client_id, pages = entry

    page = next((p for p in pages if p["id"] == page_id), None)
    if not page:
        raise HTTPException(404, "Page not found in session")

    if client_id is not None:
        client = db.query(Client).filter(Client.id == client_id).first()
        if not client:
            raise HTTPException(404, "Client not found")
        save_client_meta_page(db, client, page["id"], page["name"], page["access_token"])
    else:
        _save_meta_page(db, page["id"], page["name"], page["access_token"])

    logger.info("Meta OAuth page selected: %s (%s) client_id=%s", page["name"], page["id"], client_id)
    return {"success": True, "page_name": page["name"], "page_id": page["id"]}


def _save_meta_page(db: Session, page_id: str, page_name: str, access_token: str):
    obj = _get_or_create(db, "meta")
    obj.meta_page_id = page_id
    obj.meta_page_name = page_name
    obj.meta_access_token = encrypt(access_token)
    db.commit()


def _save_meta_ad_accounts(db: Session, long_lived_token: str, ad_accounts: list[dict]):
    """
    Store the long-lived user token (needed for ad account/campaign reads) and
    auto-select the ad account if there's exactly one. With multiple ad accounts,
    leave meta_ad_account_id unset — the Integrations page lets the admin pick
    one via GET/PATCH /integrations/meta/ad-account.
    """
    obj = _get_or_create(db, "meta")
    obj.meta_user_access_token = encrypt(long_lived_token)
    if len(ad_accounts) == 1:
        obj.meta_ad_account_id = ad_accounts[0]["id"]
        logger.info("Meta ad account auto-selected: %s", ad_accounts[0]["id"])
    elif len(ad_accounts) > 1:
        logger.info("Meta OAuth found %d ad accounts — admin must pick one in Integrations", len(ad_accounts))
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# HubSpot OAuth
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/hubspot/start")
def hubspot_start(_=Depends(get_current_admin)):
    if not HUBSPOT_CLIENT_ID:
        raise HTTPException(
            500,
            "HUBSPOT_CLIENT_ID is not set in .env. "
            "Go to app.hubspot.com → Your App → Auth tab → copy the Client ID."
        )
    if not HUBSPOT_CLIENT_SECRET:
        raise HTTPException(500, "HUBSPOT_CLIENT_SECRET is not set in .env")

    state = _new_state()
    redirect_uri = f"{BACKEND_PUBLIC_URL}/oauth/hubspot/callback"
    scopes = "crm.objects.contacts.read%20oauth%20crm.objects.contacts.write"
    url = (
        "https://app.hubspot.com/oauth/authorize"
        f"?client_id={HUBSPOT_CLIENT_ID}"
        f"&redirect_uri={urllib.parse.quote(redirect_uri, safe='')}"
        f"&scope={scopes}"
        f"&state={state}"
    )
    return {"url": url}


@router.get("/hubspot/callback")
async def hubspot_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    db: Session = Depends(get_db),
):
    if error or not code:
        return _popup_redirect("hubspot", error=error or "cancelled")

    if not state:
        return _popup_redirect("hubspot", error="invalid_state")
    state_valid, _ = _consume_state(state)
    if not state_valid:
        return _popup_redirect("hubspot", error="invalid_state")

    redirect_uri = f"{BACKEND_PUBLIC_URL}/oauth/hubspot/callback"

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://api.hubapi.com/oauth/v1/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": HUBSPOT_CLIENT_ID,
                    "client_secret": HUBSPOT_CLIENT_SECRET,
                    "redirect_uri": redirect_uri,
                    "code": code,
                },
            )
            r.raise_for_status()
            tokens = r.json()
            access_token = tokens["access_token"]
            refresh_token = tokens.get("refresh_token", "")

            # Fetch portal info (hub_id, hub_domain)
            info_r = await client.get(
                f"https://api.hubapi.com/oauth/v1/access-tokens/{access_token}",
            )
            info_r.raise_for_status()
            info = info_r.json()
            portal_id = str(info.get("hub_id", ""))
            hub_domain = info.get("hub_domain", "")
    except httpx.HTTPStatusError as e:
        logger.error("HubSpot OAuth exchange failed: %s", e.response.text)
        return _popup_redirect("hubspot", error="exchange_failed")
    except Exception:
        logger.exception("HubSpot OAuth exchange error")
        return _popup_redirect("hubspot", error="exchange_failed")

    obj = _get_or_create(db, "hubspot")
    obj.hubspot_portal_id = portal_id
    obj.hubspot_api_key = encrypt(access_token)
    if refresh_token:
        obj.hubspot_refresh_token = encrypt(refresh_token)
    db.commit()

    logger.info("HubSpot OAuth connected: portal %s (%s)", portal_id, hub_domain)
    return _popup_redirect(
        "hubspot", success="1",
        portal_id=portal_id,
        hub_domain=urllib.parse.quote(hub_domain),
    )
