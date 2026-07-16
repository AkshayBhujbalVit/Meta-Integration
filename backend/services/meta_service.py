"""
Meta Graph API service — fetches lead data after a webhook notification.

Flow:
  1. Webhook fires with leadgen_id + page_id + form_id
  2. We look up the Client by page_id to get the page access token
  3. We call Graph API to fetch full field_data for the lead
  4. We map Meta field names → our Lead model fields
  5. We look up the Campaign by form_id (optional) for auto-assignment
"""

import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.orm import Session

from core.encryption import decrypt, encrypt
from models.models.client import Client

logger = logging.getLogger("meta_service")


def save_client_meta_page(db: Session, client: Client, page_id: str, page_name: str, access_token: str) -> None:
    """
    Attach a connected Meta Page to this client — shared by the manual
    "Connect Meta" form (routers/clients.py) and the OAuth callback
    (routers/oauth.py) so there's one place that writes these fields.
    """
    client.meta_page_id = page_id
    client.meta_page_name = page_name
    client.meta_access_token = encrypt(access_token)
    db.commit()


def save_client_meta_ad_accounts(db: Session, client: Client, long_lived_token: str, ad_accounts: list[dict]) -> None:
    """
    Store the long-lived user token (needed for ad account/campaign reads) and
    auto-select the ad account if there's exactly one. With multiple ad
    accounts, leave meta_ad_account_id unset — the Integrations page lets the
    admin pick one via GET/PATCH /integrations/meta/ad-account.
    """
    client.meta_user_access_token = encrypt(long_lived_token)
    if len(ad_accounts) == 1:
        client.meta_ad_account_id = ad_accounts[0]["id"]
        logger.info("Meta ad account auto-selected for client %s: %s", client.id, ad_accounts[0]["id"])
    elif len(ad_accounts) > 1:
        logger.info(
            "Meta OAuth found %d ad accounts for client %s — admin must pick one in Integrations",
            len(ad_accounts), client.id,
        )
    db.commit()

GRAPH_API_BASE = "https://graph.facebook.com/v19.0"

# Maps common Meta form field names → Lead model fields
_FIELD_MAP = {
    "full_name": "full_name",
    "name": "full_name",
    "first_name": "full_name",       # fallback — we'll combine first+last below
    "last_name": "_last_name",
    "phone_number": "phone",
    "phone": "phone",
    "mobile_number": "phone",
    "email": "email",
    "email_address": "email",
    "city": "city",
    "state": "city",                 # store state in city if no city field
    "what_kind_of_fertility_support": "inquiry_type",
    "describe_the_problem": "problem_description",
    "problem_description": "problem_description",
    "have_you_done_fertility_tests": "tests_done",
    "are_you_a_working_professional": "is_working_professional",
}


async def fetch_lead_from_meta(leadgen_id: str, access_token: str) -> dict | None:
    """Call Graph API and return parsed lead fields dict."""
    url = f"{GRAPH_API_BASE}/{leadgen_id}"
    params = {
        "fields": "field_data,created_time,ad_id,ad_name,campaign_id,campaign_name,form_id",
        "access_token": access_token,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        logger.error("Graph API fetch failed for lead %s: %s", leadgen_id, exc)
        return None

    return _parse_lead_data(data, leadgen_id)


def _parse_lead_data(data: dict, leadgen_id: str) -> dict:
    """Map Graph API response to Lead model field dict."""
    field_data: list[dict] = data.get("field_data", [])

    raw: dict[str, str] = {}
    for field in field_data:
        name = field.get("name", "").lower().strip()
        values = field.get("values", [])
        raw[name] = values[0] if values else ""

    lead: dict = {
        "fb_lead_id": leadgen_id,
        "ad_name": data.get("ad_name"),
        "campaign_name": data.get("campaign_name"),
        "form_name": None,
    }

    first_name = ""
    last_name = ""

    for meta_field, value in raw.items():
        mapped = _FIELD_MAP.get(meta_field)
        if not mapped:
            continue
        if mapped == "full_name":
            if not lead.get("full_name"):
                lead["full_name"] = value
        elif mapped == "_last_name":
            last_name = value
        else:
            lead[mapped] = value

        if meta_field == "first_name":
            first_name = value

    # Combine first + last if full_name wasn't a dedicated field
    if first_name and not lead.get("full_name"):
        lead["full_name"] = f"{first_name} {last_name}".strip()

    # Parse created_time
    created_time_str = data.get("created_time")
    if created_time_str:
        try:
            lead["fb_created_time"] = datetime.fromisoformat(
                created_time_str.replace("Z", "+00:00")
            )
        except ValueError:
            pass

    return lead
