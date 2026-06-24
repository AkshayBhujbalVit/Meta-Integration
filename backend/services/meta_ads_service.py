"""
Meta Marketing API reads — Campaigns, Ad Sets, and Lead Forms for the connected account.

Read-only mirror: nothing here ever writes back to Meta. Campaigns/Ad Sets are for
visibility only (Campaign.meta_form_id is the actual lead-routing key, synced separately
via list_lead_forms using the existing Page token).
"""

import logging

import httpx

logger = logging.getLogger("meta_ads_service")

GRAPH_API_BASE = "https://graph.facebook.com/v19.0"


async def list_ad_accounts(user_token: str) -> list[dict]:
    url = f"{GRAPH_API_BASE}/me/adaccounts"
    params = {"access_token": user_token, "fields": "id,name,account_status", "limit": 50}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json().get("data", [])


async def list_campaigns(ad_account_id: str, user_token: str) -> list[dict]:
    url = f"{GRAPH_API_BASE}/{ad_account_id}/campaigns"
    params = {"access_token": user_token, "fields": "id,name,status,objective", "limit": 200}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json().get("data", [])


async def list_adsets(ad_account_id: str, user_token: str) -> list[dict]:
    url = f"{GRAPH_API_BASE}/{ad_account_id}/adsets"
    params = {"access_token": user_token, "fields": "id,name,status,campaign_id", "limit": 200}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json().get("data", [])


async def list_lead_forms(page_id: str, page_token: str) -> list[dict]:
    """Uses the existing Page token already stored for lead fetching — no new scope needed."""
    url = f"{GRAPH_API_BASE}/{page_id}/leadgen_forms"
    params = {"access_token": page_token, "fields": "id,name,status,leads_count", "limit": 200}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        return resp.json().get("data", [])
