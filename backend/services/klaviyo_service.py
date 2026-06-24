"""
Klaviyo metric webhook parser.

Subscribe to these metric events in Klaviyo → Integrations → Webhooks:
  - "Subscribed to List"
  - "Filled Out Form"
  - "Submitted Form"
  - Any custom metric that captures a lead

Signature verification:
  Header:  X-Klaviyo-Signature
  Method:  Base64(HMAC-SHA256(private_key, timestamp + url + raw_body))
  Docs:    https://developers.klaviyo.com/en/docs/webhook_security

Phone field variations handled:
  $phone_number, phone_number, phone, mobile, sms_number, hs_phone, tel
Name field variations:
  first_name, $first_name, FirstName, last_name, $last_name, full_name, name
Email variations:
  email, $email, EmailAddress, email_address
"""

import base64
import hashlib
import hmac
import logging
from typing import Any

logger = logging.getLogger("klaviyo_service")

_PHONE_KEYS = [
    "phone_number", "$phone_number", "phone", "mobile",
    "sms_number", "mobile_number", "tel", "telephone",
]
_FIRSTNAME_KEYS = ["first_name", "$first_name", "FirstName", "fname"]
_LASTNAME_KEYS = ["last_name", "$last_name", "LastName", "lname"]
_FULLNAME_KEYS = ["full_name", "name", "fullname", "Full Name"]
_EMAIL_KEYS = ["email", "$email", "EmailAddress", "email_address", "Email"]
_CITY_KEYS = ["city", "$city", "City", "location_city", "state", "$region"]


def verify_signature(
    body: bytes,
    signature_header: str,
    timestamp_header: str,
    url: str,
    api_key: str,
) -> bool:
    """
    Verify Klaviyo webhook HMAC signature.
    Returns True (skip) when api_key is not configured.
    """
    if not api_key:
        logger.warning(
            "Klaviyo api_key not configured — signature verification SKIPPED. "
            "Add klaviyo_api_key in Integrations to enforce HMAC checks."
        )
        return True
    if not signature_header or not timestamp_header:
        return False
    try:
        msg = (timestamp_header + url + body.decode("utf-8", errors="replace")).encode()
        digest = hmac.new(api_key.encode(), msg, hashlib.sha256).digest()
        expected = base64.b64encode(digest).decode()
        return hmac.compare_digest(signature_header, expected)
    except Exception as exc:
        logger.warning("Klaviyo signature verification error: %s", exc)
        return False


def _get(d: dict, keys: list[str]) -> str:
    """Try each key; handle nested dicts and lists."""
    for key in keys:
        val = d.get(key)
        if val is None:
            # Case-insensitive fallback
            lower_key = key.lower().lstrip("$")
            val = next((v for k, v in d.items() if k.lower().lstrip("$") == lower_key), None)
        if val is None:
            continue
        if isinstance(val, list):
            val = val[0] if val else ""
        if isinstance(val, dict):
            val = val.get("value") or val.get("name") or ""
        val = str(val).strip()
        if val:
            return val
    return ""


def _extract_profile(event_attrs: dict) -> dict:
    """
    Extract profile dict from Klaviyo event regardless of nesting.
    Klaviyo v2023 API wraps it; older flat formats also supported.
    """
    # Modern format: event.attributes.profile.data.attributes
    profile = event_attrs.get("profile", {})
    if isinstance(profile, dict):
        inner = profile.get("data", {})
        if isinstance(inner, dict):
            attrs = inner.get("attributes", {})
            if attrs:
                return attrs
        # Flat profile dict (older webhooks)
        return profile.get("attributes", profile)

    return {}


def parse_payload(payload: Any) -> list[dict]:
    """
    Parse Klaviyo webhook payload → list of unified lead dicts.
    Handles both single-event and batch payloads.
    """
    leads = []

    # Klaviyo can send: {"data": {...}} or {"data": [...]} or a bare list
    data = payload.get("data", payload)
    events = data if isinstance(data, list) else [data]

    for event in events:
        # Navigate to event attributes
        attrs = event.get("attributes", event)

        # Metric name
        metric = attrs.get("metric", {})
        if isinstance(metric, dict):
            metric_name = metric.get("name") or metric.get("data", {}).get("attributes", {}).get("name", "Klaviyo Event")
        else:
            metric_name = str(metric) or "Klaviyo Event"

        # Profile data
        profile_attrs = _extract_profile(attrs)
        if not profile_attrs:
            # Try top-level event fields (some legacy formats)
            profile_attrs = event

        phone = _get(profile_attrs, _PHONE_KEYS)
        email = _get(profile_attrs, _EMAIL_KEYS)

        if not phone and not email:
            logger.info("Klaviyo event '%s' has no phone/email — skipping", metric_name)
            continue

        first_name = _get(profile_attrs, _FIRSTNAME_KEYS)
        last_name = _get(profile_attrs, _LASTNAME_KEYS)
        full_name = _get(profile_attrs, _FULLNAME_KEYS) or f"{first_name} {last_name}".strip() or None

        # Location — Klaviyo stores it in a nested location object or flat
        location = profile_attrs.get("location", {})
        if isinstance(location, dict):
            city = location.get("city") or location.get("region") or location.get("country") or ""
        else:
            city = _get(profile_attrs, _CITY_KEYS)

        # List / form name for context
        event_props = attrs.get("event_properties", {}) or {}
        list_name = (
            event_props.get("list_name")
            or event_props.get("$list_name")
            or event_props.get("List Name")
            or event_props.get("form_name")
            or event_props.get("Form Name")
            or metric_name
        )

        # Profile ID — try multiple locations
        profile_id = (
            profile_attrs.get("id")
            or event.get("data", {}).get("id", "") if isinstance(event.get("data"), dict) else ""
        ) or ""

        leads.append({
            "full_name": full_name,
            "phone": phone,
            "email": email,
            "city": str(city).strip(),
            "external_id": f"klav_{profile_id}" if profile_id else None,
            "campaign_name": list_name,
            "form_name": metric_name,
            "extra": {
                "klaviyo_profile_id": str(profile_id),
                "metric": metric_name,
                "list_name": list_name,
                "event_properties": event_props,
            },
        })

    return leads
