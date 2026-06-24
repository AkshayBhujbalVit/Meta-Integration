"""
Google Ads Lead Form Extension (Lead Form Asset) webhook parser.

Configure in: Google Ads → Assets → Lead Form Asset → Lead Delivery → Webhook
Google sends a POST with form field data when a user submits.

Field name variations handled:
  Google sends `column_name` as a standardized enum string — we handle all known values.
  Reference: https://developers.google.com/google-ads/api/reference/rpc/v16/LeadFormField

Phone:     PHONE_NUMBER, PHONE, MOBILE_NUMBER
Name:      FULL_NAME, FIRST_NAME, LAST_NAME
Email:     EMAIL
Location:  CITY, STATE, ZIP_CODE, COUNTRY, POSTAL_CODE
Custom:    CUSTOM_QUESTION_* (question text in column_id, answer in string_value)

No HMAC signature from Google — the unique token in the URL acts as authentication.
Optionally, Google lets you add a `google_key` to the payload for an extra check.
"""

import logging

logger = logging.getLogger("google_ads_service")

# Ordered preference lists — first match wins
_PHONE_COLS = [
    "PHONE_NUMBER", "PHONE", "MOBILE_NUMBER", "WORK_PHONE",
]
_FIRSTNAME_COLS = ["FIRST_NAME"]
_LASTNAME_COLS = ["LAST_NAME"]
_FULLNAME_COLS = ["FULL_NAME"]
_EMAIL_COLS = ["EMAIL", "WORK_EMAIL"]
_CITY_COLS = ["CITY", "STATE", "ZIP_CODE", "POSTAL_CODE", "COUNTRY"]


def parse_payload(payload: dict) -> list[dict]:
    """
    Parse Google Ads lead form webhook payload → list of unified lead dicts.
    """
    # Build a case-insensitive lookup from column_name → string_value
    raw: dict[str, str] = {}
    for col in payload.get("user_column_data", []):
        name = (col.get("column_name") or col.get("columnName") or "").upper().strip()
        value = (col.get("string_value") or col.get("stringValue") or "").strip()
        if name and value:
            raw[name] = value

    def get(*keys: str) -> str:
        for k in keys:
            if k.upper() in raw:
                return raw[k.upper()]
        return ""

    phone = get(*_PHONE_COLS)
    email = get(*_EMAIL_COLS)

    if not phone and not email:
        lead_id = payload.get("lead_id", payload.get("leadId", ""))
        logger.info("Google Ads lead has no phone/email — skipping lead_id=%s", lead_id)
        return []

    first_name = get(*_FIRSTNAME_COLS)
    last_name = get(*_LASTNAME_COLS)
    full_name = get(*_FULLNAME_COLS) or f"{first_name} {last_name}".strip() or None
    city = get(*_CITY_COLS)

    # Custom question answers — store as form_name for context
    custom_answers = {
        k: v for k, v in raw.items() if k.startswith("CUSTOM_QUESTION")
    }

    lead_id = str(payload.get("lead_id") or payload.get("leadId") or "")
    campaign_name = payload.get("campaign_name") or payload.get("campaignName") or "Google Ads"
    campaign_id = str(payload.get("campaign_id") or payload.get("campaignId") or "")
    form_id = str(payload.get("form_id") or payload.get("formId") or "")
    ad_group_id = str(payload.get("adgroup_id") or payload.get("adGroupId") or "")

    return [{
        "full_name": full_name,
        "phone": phone,
        "email": email,
        "city": city,
        "external_id": f"gads_{lead_id}" if lead_id else None,
        "campaign_name": campaign_name,
        "form_name": f"Google Lead Form {form_id}" if form_id else "Google Lead Form",
        "extra": {
            "google_lead_id": lead_id,
            "google_campaign_id": campaign_id,
            "google_form_id": form_id,
            "google_adgroup_id": ad_group_id,
            "custom_answers": custom_answers,
        },
    }]
