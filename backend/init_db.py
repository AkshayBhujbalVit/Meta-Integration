"""
Initialize Database — Create all tables + seed default data
────────────────────────────────────────────────────────────
Run: python init_db.py

This will:
1. Create all tables if they don't exist
2. Create default admin account
3. Create default KB sections
4. Create default clinic settings and Vapi/Twilio config rows
"""

import os

from dotenv import load_dotenv

load_dotenv()

from sqlalchemy import create_engine, inspect
from sqlalchemy.engine import URL
from sqlalchemy.orm import sessionmaker

from models.models.admin import Admin
from models.models.appointment import Appointment
from models.models.base import Base
from models.models.call import CallLog
from models.models.client import Client
from models.models.campaign import Campaign
from models.models.knowledge_base import KBSection, KBItem, KBDocument
from models.models.lead import Lead
from models.models.meta_lead_form import MetaLeadForm  # noqa: F401
from models.models.meta_synced_campaign import MetaSyncedCampaign  # noqa: F401
from models.models.platform_integration import PlatformIntegration  # noqa: F401
from models.models.settings import CalendarConfig, CallingConfig, ClinicSettings, MessagingConfig
from models.models.sms import SMSLog  # noqa: F401
from models.models.system import AdminLoginLog  # noqa: F401
from models.models.whatsapp_log import WhatsAppMessage  # noqa: F401

_pg_user = os.getenv("POSTGRES_USER", "postgres")
_pg_pass = os.getenv("POSTGRES_PASSWORD", "")
_pg_host = os.getenv("POSTGRES_HOST", "localhost")
_pg_port = int(os.getenv("POSTGRES_PORT", "5432"))
_pg_db   = os.getenv("POSTGRES_DB", "vidushi_meta_saas")

db_url = URL.create(
    drivername="postgresql",
    username=_pg_user,
    password=_pg_pass,
    host=_pg_host,
    port=_pg_port,
    database=_pg_db,
)


def _ensure_database_exists():
    """Connect to the default 'postgres' DB and create our DB if missing."""
    from sqlalchemy import text

    admin_url = URL.create(
        drivername="postgresql",
        username=_pg_user,
        password=_pg_pass,
        host=_pg_host,
        port=_pg_port,
        database="postgres",  # always exists
    )
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    try:
        with admin_engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :db"),
                {"db": _pg_db},
            ).fetchone()
            if not exists:
                conn.execute(text(f'CREATE DATABASE "{_pg_db}"'))
                print(f"  Created database '{_pg_db}'")
            else:
                print(f"  Database '{_pg_db}' already exists")
    finally:
        admin_engine.dispose()


engine = create_engine(db_url)
Session = sessionmaker(bind=engine)


def enable_extensions():
    """Enable pgvector if installed — optional, app falls back to keyword search without it."""
    from sqlalchemy import text

    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
        print("  pgvector extension enabled")
    except Exception:
        print("  pgvector not installed — KB semantic search disabled (keyword fallback active)")


def create_tables():
    print("Creating tables...")
    for table in Base.metadata.sorted_tables:
        try:
            table.create(bind=engine, checkfirst=True)
        except Exception as e:
            print(f"  Skipped {table.name}: {e}")

    inspector = inspect(engine)
    tables = inspector.get_table_names()
    print(f"  {len(tables)} tables in database:")
    for t in sorted(tables):
        print(f"    - {t}")
    print()


def add_missing_columns():
    """Safe migration — adds new columns to existing tables without dropping data."""
    from sqlalchemy import text

    migrations = [
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS agent_name VARCHAR(100) DEFAULT 'AI Calling Assistant'",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS llm_model VARCHAR(50) DEFAULT 'gpt-4o'",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS voice_provider VARCHAR(30) DEFAULT '11labs'",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS voice_id VARCHAR(100)",
        "ALTER TABLE call_log ADD COLUMN IF NOT EXISTS recording_url VARCHAR(500)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS phone_number_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS auto_call_on_upload BOOLEAN DEFAULT FALSE",
        "UPDATE clinic_settings SET clinic_name = 'Vidushi Infotech' WHERE clinic_name = 'Dr. Sonal Gupta Clinic'",
        # Calendar integration columns
        "ALTER TABLE appointment ADD COLUMN IF NOT EXISTS calendar_event_id VARCHAR(255)",
        # Phone number provider
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS phone_provider VARCHAR(30)",
        # LiveKit + Twilio encrypted credentials
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS livekit_url TEXT",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS livekit_api_key TEXT",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS livekit_api_secret TEXT",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS livekit_sip_trunk_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS twilio_account_sid TEXT",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS twilio_auth_token TEXT",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS twilio_from_number VARCHAR(30)",
        # ── v2.1 — inbound calls, WhatsApp bot, analytics ─────────────────────
        "ALTER TABLE call_log ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'outbound'",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS inbound_sip_trunk_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS inbound_phone_number VARCHAR(30)",
        # ── v2.2 — Calendar multi-provider ────────────────────────────────────
        "ALTER TABLE calendar_config ADD COLUMN IF NOT EXISTS calendar_provider VARCHAR(30) DEFAULT 'google'",
        "ALTER TABLE calendar_config ADD COLUMN IF NOT EXISTS caldav_url VARCHAR(500)",
        "ALTER TABLE calendar_config ADD COLUMN IF NOT EXISTS caldav_username VARCHAR(255)",
        "ALTER TABLE calendar_config ADD COLUMN IF NOT EXISTS caldav_password TEXT",
        # ── v2.2 — VoBiz SIP trunk credentials ────────────────────────────────
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_auth_id TEXT",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_auth_token TEXT",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_phone_number VARCHAR(30)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_sip_domain VARCHAR(255)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_sip_username TEXT",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_sip_password TEXT",
        # ── v2.2 — Separate WhatsApp provider in messaging_config ─────────────
        "ALTER TABLE messaging_config ADD COLUMN IF NOT EXISTS whatsapp_provider VARCHAR(30)",
        "ALTER TABLE messaging_config ADD COLUMN IF NOT EXISTS whatsapp_api_key TEXT",
        "ALTER TABLE messaging_config ADD COLUMN IF NOT EXISTS whatsapp_api_secret TEXT",
        # ── v3.0 — Multi-tenant: Client + Campaign + Lead source ──────────────
        "ALTER TABLE lead ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES client(id) ON DELETE SET NULL",
        "ALTER TABLE lead ADD COLUMN IF NOT EXISTS campaign_id INTEGER REFERENCES campaign(id) ON DELETE SET NULL",
        "ALTER TABLE lead ADD COLUMN IF NOT EXISTS source_platform VARCHAR(50)",
        "CREATE INDEX IF NOT EXISTS ix_lead_client_id ON lead(client_id)",
        "CREATE INDEX IF NOT EXISTS ix_lead_campaign_id ON lead(campaign_id)",
        "CREATE INDEX IF NOT EXISTS ix_lead_source_platform ON lead(source_platform)",
        # ── v3.1 — Meta page access token per client ──────────────────────────
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS meta_access_token TEXT",
        # ── v3.2 — Per-client channel config ──────────────────────────────────
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS calling_config JSONB",
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS sms_config JSONB",
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS whatsapp_config JSONB",
        # ── v4.0 — Multi-platform webhook integrations ─────────────────────────
        # Client: unique webhook URL token + per-platform credentials (all encrypted)
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS webhook_token VARCHAR(36)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_client_webhook_token ON client(webhook_token) WHERE webhook_token IS NOT NULL",
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS hubspot_portal_id VARCHAR(50)",
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS hubspot_api_key TEXT",
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS hubspot_client_secret TEXT",
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS google_ads_customer_id VARCHAR(50)",
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS google_ads_refresh_token TEXT",
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS klaviyo_account_id VARCHAR(50)",
        "ALTER TABLE client ADD COLUMN IF NOT EXISTS klaviyo_api_key TEXT",
        # Campaign: platform-specific routing IDs
        "ALTER TABLE campaign ADD COLUMN IF NOT EXISTS hubspot_list_id VARCHAR(100)",
        "ALTER TABLE campaign ADD COLUMN IF NOT EXISTS google_form_id VARCHAR(100)",
        "ALTER TABLE campaign ADD COLUMN IF NOT EXISTS google_campaign_id VARCHAR(100)",
        "ALTER TABLE campaign ADD COLUMN IF NOT EXISTS klaviyo_list_id VARCHAR(100)",
        # Lead: generic dedup key for non-Meta sources
        "ALTER TABLE lead ADD COLUMN IF NOT EXISTS external_id VARCHAR(150)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_external_id ON lead(external_id) WHERE external_id IS NOT NULL",
        # ── v5.0 — Platform-level integrations (not per-client) ───────────────
        """CREATE TABLE IF NOT EXISTS platform_integration (
            id SERIAL PRIMARY KEY,
            source VARCHAR(50) NOT NULL UNIQUE,
            webhook_token VARCHAR(36) UNIQUE,
            meta_page_id VARCHAR(100),
            meta_page_name VARCHAR(255),
            meta_access_token TEXT,
            hubspot_portal_id VARCHAR(50),
            hubspot_api_key TEXT,
            hubspot_client_secret TEXT,
            google_customer_id VARCHAR(50),
            klaviyo_account_id VARCHAR(50),
            klaviyo_api_key TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        )""",
        "CREATE INDEX IF NOT EXISTS ix_platform_integration_source ON platform_integration(source)",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_integration_token ON platform_integration(webhook_token) WHERE webhook_token IS NOT NULL",
        # ── v5.1 — HubSpot OAuth refresh token ───────────────────────────────
        "ALTER TABLE platform_integration ADD COLUMN IF NOT EXISTS hubspot_refresh_token TEXT",
        # ── v6.0 — Integration pause switch + Meta Ads campaign/ad-set sync ──
        "ALTER TABLE platform_integration ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT FALSE",
        "ALTER TABLE platform_integration ADD COLUMN IF NOT EXISTS meta_user_access_token TEXT",
        "ALTER TABLE platform_integration ADD COLUMN IF NOT EXISTS meta_ad_account_id VARCHAR(50)",
        # ── v6.1 — Website Form lead source (for clients whose ads link to a website, not a native lead form) ──
        "ALTER TABLE campaign ADD COLUMN IF NOT EXISTS website_form_id VARCHAR(100)",
        # ── v6.2 — VoBiz/Twilio non-destructive provider switching (ported from ai_calling_poc_LiveKit) ──
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_trunk_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_outbound_trunk_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_inbound_trunk_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS vobiz_dispatch_rule_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS livekit_sip_uri VARCHAR(255)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS livekit_dispatch_rule_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS twilio_outbound_trunk_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS twilio_inbound_trunk_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS twilio_dispatch_rule_id VARCHAR(100)",
    ]
    for sql in migrations:
        try:
            with engine.connect() as conn:
                conn.execute(text(sql))
                conn.commit()
        except Exception as e:
            print(f"  Migration note: {e}")
    print("Column migration done")


def seed_admin():
    import bcrypt

    db = Session()
    try:
        existing = db.query(Admin).filter_by(email="admin@vidushiinfotech.com").first()
        if existing:
            print("Admin already exists: admin@vidushiinfotech.com")
            return

        admin_password = os.getenv("ADMIN_INITIAL_PASSWORD")
        if not admin_password:
            raise RuntimeError(
                "ADMIN_INITIAL_PASSWORD env var is not set.\n"
                "Set it before running init_db.py:\n"
                "  PowerShell: $env:ADMIN_INITIAL_PASSWORD='<choose-a-strong-value>'\n"
                "  bash:       export ADMIN_INITIAL_PASSWORD='<choose-a-strong-value>'"
            )
        pw_hash = bcrypt.hashpw(admin_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        admin = Admin(
            email="admin@vidushiinfotech.com",
            password_hash=pw_hash,
            full_name="Vidushi Infotech Admin",
            phone="+91-XXXXXXXXXX",
            is_active=True,
        )
        db.add(admin)
        db.commit()
        print("Created admin: admin@vidushiinfotech.com (password from ADMIN_INITIAL_PASSWORD)")
    except Exception as e:
        db.rollback()
        print(f"  Error creating admin: {e}")
    finally:
        db.close()


def seed_kb_sections():
    # Knowledge Base removed from this platform — no sections seeded
    print("KB sections: skipped (not used in this platform)")


def seed_default_settings():
    db = Session()
    try:
        if not db.query(ClinicSettings).first():
            db.add(
                ClinicSettings(
                    clinic_name="Vidushi Infotech",
                    doctor_name="",
                    city="",
                    address="",
                    website="https://www.vidushiinfotech.com",
                    timings="Mon–Sat: 10:00 AM–6:00 PM",
                )
            )
            print("Created default clinic settings")

        if not db.query(CallingConfig).first():
            from services.calling_service import DEFAULT_INSTRUCTIONS

            db.add(
                CallingConfig(
                    provider="livekit",
                    system_prompt=DEFAULT_INSTRUCTIONS,
                    language_default="hindi",
                    call_start_time="09:00",
                    call_end_time="20:00",
                    max_retries=3,
                    retry_gap_hours=24,
                )
            )
            print("Created default calling config (provider: livekit)")

        if not db.query(MessagingConfig).first():
            db.add(
                MessagingConfig(
                    provider="twilio",
                    is_whatsapp_enabled=True,
                    is_sms_enabled=True,
                )
            )
            print("Created default messaging config (provider: twilio)")

        if not db.query(CalendarConfig).first():
            db.add(
                CalendarConfig(
                    calendar_id="primary",
                    is_active=False,
                )
            )
            print("Created default calendar config (inactive — configure in Settings > Calendar)")

        db.commit()
    except Exception as e:
        db.rollback()
        print(f"  Error creating settings: {e}")
    finally:
        db.close()


def seed_kb_items():
    # KB content is client-specific — add via the UI after setup
    print("KB items: skipped (add client-specific content via Settings > Knowledge Base)")
    return

if __name__ == "__main__":
    print("=" * 55)
    print("  Vidushi Infotech — Database Initialization")
    print("=" * 55)
    print(f"  Host: {os.getenv('POSTGRES_HOST')}")
    print(f"  DB:   {os.getenv('POSTGRES_DB')}")
    print()

    _ensure_database_exists()
    enable_extensions()
    create_tables()
    add_missing_columns()
    seed_admin()
    seed_kb_sections()
    seed_default_settings()
    seed_kb_items()

    print()
    print("Done! You can now run:")
    print("  uvicorn main:app --host 0.0.0.0 --port 8009")
    print()
    print("Login: admin@vidushiinfotech.com (use the password you set in ADMIN_INITIAL_PASSWORD)")
    print("=" * 55)
