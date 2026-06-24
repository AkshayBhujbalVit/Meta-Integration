"""
Phone number normalization — converts any format to E.164 (+91XXXXXXXXXX).
Falls back gracefully to the original string when phonenumbers is not installed
or the number cannot be parsed.
"""

import logging

logger = logging.getLogger("phone_service")

try:
    import phonenumbers
    _HAS_LIB = True
except ImportError:
    _HAS_LIB = False
    logger.warning("phonenumbers not installed — install it: pip install phonenumbers")


def to_e164(phone: str, default_country: str = "IN") -> str:
    """
    Normalize phone to E.164 format (e.g. +919876543210).
    default_country: ISO 3166-1 alpha-2 used when no country code is present.
    """
    if not phone:
        return phone

    phone = phone.strip()

    if not _HAS_LIB:
        return phone

    # Try parsing as-is (works when number already has + country code)
    for attempt in (phone, f"+{phone}"):
        try:
            parsed = phonenumbers.parse(attempt, default_country if attempt == phone else None)
            if phonenumbers.is_valid_number(parsed):
                return phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)
        except Exception:
            continue

    logger.warning("Could not normalize phone to E.164: %s", phone)
    return phone
