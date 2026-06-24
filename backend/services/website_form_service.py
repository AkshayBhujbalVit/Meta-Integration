"""
Generic website contact-form parser.

Unlike Meta/HubSpot/Google/Klaviyo, an arbitrary client website has no fixed
field names or platform-issued auth — the per-source webhook token in the URL
is the only credential, and field names vary form-to-form, so every plausible
name is tried. Used for clients whose ads click through to their own site
instead of a native ad-platform lead form (see google_ads_service.py for that
still-supported native flow).
"""

import logging
from typing import Any

logger = logging.getLogger("website_form_service")

_PHONE_KEYS = [
    "phone", "mobile", "contact", "tel", "telephone", "phone_number",
    "your-phone", "your_phone", "contact_number", "mobile_number",
]
_NAME_KEYS = [
    "name", "full_name", "fullname", "your-name", "your_name", "contact_name",
]
_EMAIL_KEYS = ["email", "your-email", "your_email", "email_address"]
_MESSAGE_KEYS = [
    "message", "comments", "your-message", "your_message", "inquiry", "details", "notes",
]
_FORM_ID_KEYS = ["form_id", "website_form_id", "data-form-id"]


def _extract(payload: dict, keys: list[str]) -> str:
    for key in keys:
        val = payload.get(key)
        if val is None:
            # case-insensitive fallback — HTML form field names are inconsistent
            lower = key.lower()
            val = next((v for k, v in payload.items() if str(k).lower() == lower), None)
        if val is None:
            continue
        val = str(val).strip()
        if val:
            return val
    return ""


def parse_payload(payload: Any) -> list[dict]:
    """A website form submits one lead per request — always returns 0 or 1 entries."""
    if not isinstance(payload, dict):
        return []

    phone = _extract(payload, _PHONE_KEYS)
    email = _extract(payload, _EMAIL_KEYS)

    if not phone and not email:
        logger.info("Website form submission has no phone/email — skipping")
        return []

    full_name = _extract(payload, _NAME_KEYS) or None
    message = _extract(payload, _MESSAGE_KEYS)
    form_id = _extract(payload, _FORM_ID_KEYS)

    return [{
        "full_name": full_name,
        "phone": phone,
        "email": email,
        "city": "",
        "external_id": None,  # no stable platform ID — dedup falls back to phone/email
        "campaign_name": "Website Form",
        "form_name": form_id or "Website Form",
        "problem_description": message or None,
        "extra": {"website_form_id": form_id},
    }]
