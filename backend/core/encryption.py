"""
Fernet symmetric encryption for sensitive values stored in the database.

All API keys, auth tokens, and secrets saved to DB are encrypted at rest.
The ENCRYPTION_KEY env var is the master key — keep it safe and backed up.
If it is lost, encrypted values in the DB cannot be recovered.

Usage:
    from core.encryption import encrypt, decrypt

    stored = encrypt("sk-live-abc123")   # store this in DB
    plain  = decrypt(stored)             # use this at runtime
"""

import logging
import os
from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("encryption")

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = os.getenv("ENCRYPTION_KEY", "").strip()
        if not key:
            raise RuntimeError(
                "ENCRYPTION_KEY is not set. "
                "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            )
        _fernet = Fernet(key.encode())
    return _fernet


def encrypt(plain: str | None) -> str | None:
    """Encrypt a plaintext string. Returns None if input is None or empty."""
    if not plain:
        return plain
    return _get_fernet().encrypt(plain.encode()).decode()


def decrypt(token: str | None) -> str | None:
    """Decrypt a Fernet token back to plaintext. Returns None if input is None or empty."""
    if not token:
        return token
    try:
        return _get_fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        logger.warning(
            "decrypt(): failed to decrypt value (not a valid Fernet token). "
            "Returning raw value — check that ENCRYPTION_KEY matches the key used to encrypt this value."
        )
        return token


def is_encrypted(value: str | None) -> bool:
    """Return True if the value looks like a Fernet token (starts with gAA)."""
    return bool(value and value.startswith("gAA"))
