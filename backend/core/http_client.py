"""
Shared httpx client factory.
Set SSL_VERIFY=false in .env to disable certificate verification
(useful when behind a corporate proxy/VPN with self-signed certs).
"""

import os
import httpx

# Read once at startup — default True (always verify in prod)
_SSL_VERIFY = os.getenv("SSL_VERIFY", "true").lower() not in ("false", "0", "no")


def sync_client(**kwargs) -> httpx.Client:
    kwargs.setdefault("verify", _SSL_VERIFY)
    return httpx.Client(**kwargs)


def async_client(**kwargs) -> httpx.AsyncClient:
    kwargs.setdefault("verify", _SSL_VERIFY)
    return httpx.AsyncClient(**kwargs)
