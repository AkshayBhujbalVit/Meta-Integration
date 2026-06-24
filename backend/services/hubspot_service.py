"""
HubSpot CRM webhook parser.

Supported events: crm.contact.creation, crm.contact.propertyChange
HubSpot sends an array of event objects per POST.

Field name variations handled:
  Phone:  phone, mobilephone, hs_mobile_phone, phonenumber, phone_number, mobile
  Name:   firstname, first_name, full_name, name, lastname, last_name
  Email:  email, email_address, hs_email_alias
  City:   city, hs_analytics_first_url, state, country (fallback)

Signature verification:
  Header: X-HubSpot-Signature
  Method: SHA-256(client_secret + request_body)
"""

import hashlib
import hmac
import logging
from typing import Any

logger = logging.getLogger("hubspot_service")

# All known HubSpot property names for each field — ordered by preference
_PHONE_KEYS = [
    "phone", "mobilephone", "hs_mobile_phone", "phone_number",
    "phonenumber", "mobile", "mobile_number", "work_phone", "fax",
]
_FIRSTNAME_KEYS = ["firstname", "first_name"]
_LASTNAME_KEYS = ["lastname", "last_name"]
_FULLNAME_KEYS = ["full_name", "name", "hs_calculated_form_submissions"]
_EMAIL_KEYS = ["email", "email_address", "hs_email_alias", "work_email"]
_CITY_KEYS = ["city", "hs_city", "state", "hs_state_code", "country", "zip"]


def verify_signature(body: bytes, signature_header: str, client_secret: str) -> bool:
    """
    HubSpot v1 signature: SHA-256(client_secret + raw_body).
    Returns True (allow) when client_secret is not yet configured — logs a warning.
    """
    if not client_secret:
        logger.warning(
            "HubSpot client_secret not configured — signature verification SKIPPED. "
            "Add hubspot_client_secret in Integrations to enforce HMAC checks."
        )
        return True
    if not signature_header:
        return False
    expected = hashlib.sha256((client_secret + body.decode("utf-8", errors="replace")).encode()).hexdigest()
    return hmac.compare_digest(signature_header.lower(), expected.lower())


def _extract(props: dict, keys: list[str]) -> str:
    """Try each key in order; handle both {key: {value: ...}} and {key: 'val'} formats."""
    for key in keys:
        raw = props.get(key)
        if raw is None:
            continue
        if isinstance(raw, dict):
            val = raw.get("value") or raw.get("newValue") or ""
        else:
            val = str(raw)
        val = val.strip()
        if val:
            return val
    return ""


def parse_payload(payload: Any) -> list[dict]:
    """
    Parse HubSpot webhook payload → list of unified lead dicts.
    Payload is always a list of event objects.
    """
    events = payload if isinstance(payload, list) else [payload]
    leads = []

    for event in events:
        sub_type = event.get("subscriptionType", "")

        # Only handle contact events (creation or property change)
        if "contact" not in sub_type.lower():
            logger.debug("Skipping non-contact HubSpot event: %s", sub_type)
            continue

        props = event.get("properties", {})

        phone = _extract(props, _PHONE_KEYS)
        email = _extract(props, _EMAIL_KEYS)

        if not phone and not email:
            logger.info("HubSpot event has no phone/email — skipping objectId=%s", event.get("objectId"))
            continue

        first_name = _extract(props, _FIRSTNAME_KEYS)
        last_name = _extract(props, _LASTNAME_KEYS)
        full_name = (
            _extract(props, _FULLNAME_KEYS)
            or f"{first_name} {last_name}".strip()
            or None
        )
        city = _extract(props, _CITY_KEYS)

        contact_id = str(event.get("objectId") or event.get("contactId") or "")
        portal_id = str(event.get("portalId") or "")

        leads.append({
            "full_name": full_name,
            "phone": phone,
            "email": email,
            "city": city,
            "external_id": f"hs_{contact_id}" if contact_id else None,
            "campaign_name": "HubSpot CRM",
            "form_name": sub_type,
            "extra": {
                "hubspot_contact_id": contact_id,
                "portal_id": portal_id,
                "subscription_type": sub_type,
            },
        })

    return leads
