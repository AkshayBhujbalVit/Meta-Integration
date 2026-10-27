import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from core.config import ALLOWED_ORIGINS
from routers import auth, leads, kb, calling, appointments, sms, settings
from routers import whatsapp, analytics, usage, clients, campaigns, meta_webhook, webhooks, dev, integrations, oauth


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    from services.scheduler import start_scheduler
    start_scheduler()
    yield
    # ── Shutdown ──────────────────────────────────────────────────────────────
    from services.scheduler import stop_scheduler
    stop_scheduler()


app = FastAPI(
    title="Vidushi Infotech — AI Calling Platform",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)

# ── CORS — only allow configured origins (never wildcard *) ───────────────────
# Credentials are enabled, so a wildcard "*" would be unsafe (and invalid per the
# CORS spec) — strip it defensively in case it slips into ALLOWED_ORIGINS.
_cors_origins = [o for o in ALLOWED_ORIGINS if o != "*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)


# ── Security headers on every response ───────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    # HSTS — tell browsers to always use HTTPS for 1 year (production only)
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # CSP — API-only backend: no scripts/frames allowed
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    # Hide server fingerprint
    response.headers["Server"] = "vidushi"
    return response


app.include_router(auth.router)
app.include_router(leads.router)
app.include_router(kb.router)
app.include_router(calling.router)
app.include_router(appointments.router)
app.include_router(sms.router)
app.include_router(settings.router)
app.include_router(whatsapp.router)
app.include_router(analytics.router)
app.include_router(usage.router)
app.include_router(clients.router)
app.include_router(campaigns.router)
app.include_router(meta_webhook.router)
app.include_router(webhooks.router)
app.include_router(integrations.router)
app.include_router(oauth.router)
app.include_router(dev.router)

# Serve uploaded files (client logos, KB docs) — e.g. /uploads/client_logos/<file>
_UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(_UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_UPLOAD_DIR), name="uploads")


@app.get("/")
def root():
    return {"status": "ok", "app": "Vidushi Infotech AI Calling Platform", "version": "1.0.0"}


@app.get("/health")
def health():
    return {"status": "healthy"}
