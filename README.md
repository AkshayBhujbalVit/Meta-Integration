# Vidushi Infotech — AI Calling Platform

Multi-tenant SaaS platform. Leads arrive from Meta Lead Ads, HubSpot, Google Ads, or Klaviyo. An AI voice agent (LiveKit + Gemini Live) calls them instantly. You see everything in a unified dashboard.

---

## End-to-End Flow

```
Marketing Platform             Backend (FastAPI)              AI Agent
──────────────────             ─────────────────              ────────
Meta Lead Ad Form   ──POST──▶  /meta/webhook                  LiveKit
HubSpot Contact     ──POST──▶  /webhooks/hubspot/{token}  ──▶  + Gemini Live
Google Lead Form    ──POST──▶  /webhooks/google/{token}        (voice call)
Klaviyo Event       ──POST──▶  /webhooks/klaviyo/{token}
CSV Upload          ──UI──────▶ /leads/upload

                               PostgreSQL
                               ─────────────────────────────
                               Client → Campaign → Lead

                               Frontend (Next.js)
                               ─────────────────────────────
                               Dashboard / Leads / Calls / Analytics
```

**What happens when a lead arrives:**
1. Webhook fires → Backend identifies client + campaign by form/list ID
2. Lead is saved to the database (deduplication by phone/email)
3. If campaign is active and within calling hours → AI agent dials immediately
4. If outside hours → scheduler retries in the next window
5. Call result (answered, voicemail, booked appointment) is logged
6. You see everything live in the dashboard

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend API | FastAPI (Python 3.10+) |
| AI Voice Agent | LiveKit + Gemini Live (gemini-2.5-flash) |
| Database | PostgreSQL 14+ via SQLAlchemy ORM |
| Frontend | Next.js 15 (App Router, TypeScript) |
| Encryption | Fernet symmetric encryption for all stored secrets |
| Auth | JWT (8-hour tokens), bcrypt passwords |
| Scheduler | APScheduler (retry failed calls, daily reports) |

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.10+ | Backend + AI agent |
| Node.js | 18+ | Frontend |
| PostgreSQL | 14+ | Must be running on port 5432 |
| ngrok (dev only) | latest | Exposes localhost for webhooks |

---

## First-Time Setup

### Step 1 — Clone & navigate

```powershell
cd ai_calling_meta_integration
```

### Step 2 — Backend: create virtualenv + install packages

```powershell
cd backend
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

### Step 3 — Backend: create .env file

Create `backend\.env` with all required values (see [Environment Variables](#environment-variables) below).

Minimum required to start:

```env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_db_password
POSTGRES_DB=vidushi_meta_saas
SECRET_KEY=<generate below>
ENCRYPTION_KEY=<generate below>
GOOGLE_API_KEY=<from Google AI Studio>
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=APIxxxxxxx
LIVEKIT_API_SECRET=xxxxxxxx
LIVEKIT_SIP_TRUNK_ID=ST_xxxxxxx
BACKEND_PUBLIC_URL=https://your-ngrok-url.ngrok.io
FRONTEND_URL=http://localhost:3000
```

Generate `SECRET_KEY`:
```powershell
python -c "import secrets; print(secrets.token_hex(32))"
```

Generate `ENCRYPTION_KEY`:
```powershell
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### Step 4 — Backend: initialise the database

```powershell
# still in backend\ with venv active
$env:ADMIN_INITIAL_PASSWORD = "choose-a-strong-password"
python init_db.py
```

This creates all tables, runs migrations, and seeds the admin account.
Login: `admin@vidushiinfotech.com` / the password you set above.

### Step 5 — Frontend: install packages

```powershell
cd ..\frontend
npm install
```

### Step 6 — Frontend: create .env.local

Create `frontend\.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8009
```

---

## Running the Project

You need **3 terminals** open simultaneously.

### Terminal 1 — Backend API

```powershell
cd backend
.\venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 8009 --reload
```

Wait for: `Uvicorn running on http://0.0.0.0:8009`

### Terminal 2 — AI Voice Agent

```powershell
cd backend
.\venv\Scripts\activate
python agent.py dev
```

Wait for: `registered worker`

> The agent must be running for AI calls to work. It stays connected to LiveKit and picks up dispatched jobs.

### Terminal 3 — Frontend

```powershell
cd frontend
npm run dev
```

Wait for: `Ready in Xms`

### Open in browser

```
http://localhost:3000
```

Login: `admin@vidushiinfotech.com` / your `ADMIN_INITIAL_PASSWORD`

---

## Environment Variables

All variables go in `backend\.env`.

### Core (required)

| Variable | How to get it |
|----------|--------------|
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ENCRYPTION_KEY` | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `POSTGRES_USER` | Your PostgreSQL username |
| `POSTGRES_PASSWORD` | Your PostgreSQL password |
| `POSTGRES_HOST` | Default: `localhost` |
| `POSTGRES_PORT` | Default: `5432` |
| `POSTGRES_DB` | Default: `vidushi_meta_saas` |
| `ADMIN_INITIAL_PASSWORD` | Only needed when running `init_db.py` |

### AI Voice (required for calls)

| Variable | How to get it |
|----------|--------------|
| `GOOGLE_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → Get API Key |
| `LIVEKIT_URL` | [cloud.livekit.io](https://cloud.livekit.io) → Project → Settings → WSS URL |
| `LIVEKIT_API_KEY` | Same page → API Keys |
| `LIVEKIT_API_SECRET` | Same page → API Keys |
| `LIVEKIT_SIP_TRUNK_ID` | LiveKit Console → SIP → Outbound Trunk → copy ST_xxx |

### URLs (required for webhooks + OAuth)

| Variable | Value |
|----------|-------|
| `BACKEND_PUBLIC_URL` | Your backend's public URL, e.g. `https://abc123.ngrok.io` |
| `FRONTEND_URL` | Your frontend's public URL, e.g. `http://localhost:3000` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins, e.g. `http://localhost:3000` |

### Meta / Facebook

| Variable | How to get it |
|----------|--------------|
| `META_APP_ID` | [developers.facebook.com](https://developers.facebook.com) → Your App → Basic Settings |
| `META_APP_SECRET` | Same page → App Secret (click Show) |
| `META_VERIFY_TOKEN` | Any random string you choose — you'll set the same value in Meta Webhooks |

### HubSpot OAuth

| Variable | How to get it |
|----------|--------------|
| `HUBSPOT_CLIENT_ID` | [app.hubspot.com/developer](https://app.hubspot.com/developer) → Your App → Auth tab |
| `HUBSPOT_CLIENT_SECRET` | Same page → Client Secret |

### SMS / WhatsApp (optional)

| Variable | How to get it |
|----------|--------------|
| `TWILIO_ACCOUNT_SID` | [console.twilio.com](https://console.twilio.com) |
| `TWILIO_AUTH_TOKEN` | Same page |
| `TWILIO_FROM_NUMBER` | Your Twilio phone number in E.164 format |

---

## Platform Integration Setup

### Meta Lead Ads

**What you need:** A Facebook Developer App with `pages_manage_metadata`, `leads_retrieval`, `pages_read_engagement` permissions.

**One-click setup:**
1. Set `META_APP_ID` and `META_APP_SECRET` in `.env`
2. In the platform: **Integrations → Meta Ads → Connect with Facebook**
3. A Facebook login popup opens — log in, select your page — done

**Webhook setup (one time):**
- Go to [developers.facebook.com](https://developers.facebook.com) → Your App → Webhooks
- Add: Callback URL = `{BACKEND_PUBLIC_URL}/meta/webhook`
- Verify Token = value of `META_VERIFY_TOKEN` in `.env`
- Subscribe to: `leadgen` events on your page

**How it works at runtime:**
1. Someone fills a Lead Ad form
2. Meta sends a POST to `/meta/webhook` with a `leadgen_id`
3. Backend calls Meta Graph API to fetch full lead details using your Page Access Token
4. Lead is saved → AI calls the person within seconds

---

### HubSpot CRM

**What you need:** A HubSpot Developer App OR a Private App token.

**Option A — One-click OAuth (recommended):**
1. Create an app at [app.hubspot.com/developer](https://app.hubspot.com/developer)
2. Set `HUBSPOT_CLIENT_ID` and `HUBSPOT_CLIENT_SECRET` in `.env`
3. Redirect URI to add in HubSpot app: `{BACKEND_PUBLIC_URL}/oauth/hubspot/callback`
4. In the platform: **Integrations → HubSpot CRM → Connect with HubSpot**

**Option B — Private App token (manual):**
1. HubSpot → Settings → Integrations → Private Apps → Create app
2. Scopes: `crm.objects.contacts.read`
3. Copy the access token → paste in **Integrations → HubSpot CRM → Private App Token**

**Webhook setup (both options):**
- After connecting, copy your webhook URL from the HubSpot panel
- In HubSpot: Settings → Integrations → Webhooks → Create Subscription
- Event type: `contact.creation`
- Paste the webhook URL

**How it works:** New HubSpot contact → webhook fires → AI calls the contact.

---

### Google Ads

**What you need:** Nothing — Google sends leads to your URL.

**Setup:**
1. In platform: **Integrations → Google Ads → Generate Webhook URL**
2. Copy the URL shown
3. In Google Ads: Assets → Lead Form Asset → edit form → Lead Delivery → Webhook → paste URL

**How it works:** User submits lead form → Google POSTs to your webhook URL → AI calls.

---

### Klaviyo

**What you need:** A Klaviyo Private API Key.

**Setup:**
1. Klaviyo → Account → Settings → API Keys → Create Private API Key
2. Scopes: `profiles:read`, `events:read`
3. In platform: **Integrations → Klaviyo → paste the key → Save**
4. Copy your webhook URL that appears after saving
5. Klaviyo → Integrations → Webhooks → Add Webhook → paste URL
6. Events: `Subscribed to List` and/or `Filled Out Form`

---

## Campaign Setup (required for call routing)

Campaigns connect leads to the right AI agent. **Every client needs at least one campaign.**

1. Go to **Campaigns → New Campaign**
2. Select the **Client** this campaign belongs to
3. Configure the **AI Agent**: name, voice prompt, calling hours, phone number
4. Go to the **Lead Source** tab — select which platform(s) feed this campaign
5. Enter the **platform-specific ID** (critical for multi-client routing):
   - Meta: paste the Form ID from your Lead Ad form
   - HubSpot: paste the HubSpot List ID
   - Google: paste the Lead Form ID or Campaign ID
   - Klaviyo: paste the List Name/ID

> **Why platform-specific IDs matter:** Vidushi manages ONE Meta page / HubSpot account for MANY clients simultaneously. The only way to route a lead to the right client is by matching on the specific form/list ID. Without this, leads cannot be assigned.

---

## Multi-Client Architecture

```
Vidushi Infotech (Admin)
├── Client A (Clinic XYZ)
│   ├── Campaign: "Summer Campaign"  ← meta_form_id = "123456"
│   └── Campaign: "Walk-ins"         ← meta_form_id = "789012"
├── Client B (Real Estate Firm)
│   ├── Campaign: "Property Enquiry" ← hubspot_list_id = "456"
│   └── ...
└── Client C ...
```

- One Meta page / HubSpot account feeds ALL clients
- Routing is by `meta_form_id`, `hubspot_list_id`, etc. — never random
- Each campaign has its own AI agent prompt and calling config

---

## Security

| Feature | Implementation |
|---------|---------------|
| Passwords | bcrypt hashed |
| JWT | HS256, 8-hour expiry |
| Stored secrets | Fernet symmetric encryption (all API keys, access tokens) |
| Webhook auth | Meta: HMAC-SHA256 signature; HubSpot/Klaviyo: per-platform HMAC |
| Login brute-force | 10 attempts per IP per 15-minute window → HTTP 429 |
| Payload size | 512 KB limit on all webhooks |
| CORS | Explicit allow-list, no wildcard |
| Security headers | HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy |

---

## Key URLs

| URL | Description |
|-----|-------------|
| `http://localhost:3000` | Main app |
| `http://localhost:3000/setup` | In-app setup guide |
| `http://localhost:8009/docs` | Backend Swagger UI (disabled in production) |
| `{BACKEND_PUBLIC_URL}/meta/webhook` | Meta Lead Ads webhook endpoint |
| `{BACKEND_PUBLIC_URL}/webhooks/hubspot/{token}` | HubSpot webhook |
| `{BACKEND_PUBLIC_URL}/webhooks/google/{token}` | Google Ads webhook |
| `{BACKEND_PUBLIC_URL}/webhooks/klaviyo/{token}` | Klaviyo webhook |

---

## Project Structure

```
ai_calling_meta_integration/
├── backend/
│   ├── main.py                    # FastAPI app + all router registration
│   ├── agent.py                   # LiveKit voice agent (run separately)
│   ├── init_db.py                 # DB init + migrations + admin seed
│   ├── core/
│   │   ├── config.py              # All env vars
│   │   ├── database.py            # SQLAlchemy engine + session
│   │   ├── encryption.py          # Fernet encrypt/decrypt helpers
│   │   └── dependencies.py        # JWT auth dependency
│   ├── models/models/
│   │   ├── client.py              # Client (business account)
│   │   ├── campaign.py            # Campaign (agent config + lead routing)
│   │   ├── lead.py                # Lead (universal inbox)
│   │   ├── platform_integration.py # Platform-level credentials (Meta, HubSpot, etc.)
│   │   └── ...                    # call, appointment, settings, admin
│   ├── routers/
│   │   ├── auth.py                # Login, JWT, brute-force protection
│   │   ├── clients.py             # /clients CRUD
│   │   ├── campaigns.py           # /campaigns CRUD + start-calls
│   │   ├── leads.py               # /leads CRUD + CSV upload
│   │   ├── calling.py             # /calling — trigger calls, logs
│   │   ├── meta_webhook.py        # /meta/webhook — Meta Lead Ads
│   │   ├── webhooks.py            # /webhooks/{source}/{token} — HubSpot/Google/Klaviyo
│   │   ├── integrations.py        # /integrations — platform credentials CRUD
│   │   ├── oauth.py               # /oauth — one-click Meta + HubSpot OAuth
│   │   ├── analytics.py           # /analytics — dashboard stats + exports
│   │   └── ...                    # appointments, sms, whatsapp, settings, usage
│   └── services/
│       ├── calling_service.py     # Prompt builder + call dispatcher
│       ├── meta_service.py        # Meta Graph API lead fetch
│       ├── hubspot_service.py     # HubSpot webhook verification + lead parser
│       ├── google_ads_service.py  # Google Ads lead parser
│       ├── klaviyo_service.py     # Klaviyo webhook verification + lead parser
│       └── scheduler.py           # APScheduler — retry calls, daily tasks
└── frontend/
    ├── src/app/
    │   ├── login/                 # Login page
    │   ├── oauth-callback/        # OAuth popup close page
    │   └── (dashboard)/           # All protected pages (require login)
    │       ├── dashboard/         # Overview stats
    │       ├── setup/             # In-app setup guide (this document in UI form)
    │       ├── integrations/      # Platform connection (Meta OAuth, HubSpot, etc.)
    │       ├── clients/           # Client management
    │       ├── campaigns/         # Campaign management + AI agent config
    │       ├── leads/             # Universal leads inbox
    │       ├── calls/             # Call logs + cancel
    │       ├── appointments/      # Appointment calendar
    │       ├── analytics/         # Funnel, heatmap, trends
    │       └── settings/          # Calling, SMS, calendar config
    └── src/lib/api.ts             # All API calls (typed)
```

---

## Ports

| Service | Port |
|---------|------|
| Backend API | 8009 |
| Frontend | 3000 |
| PostgreSQL | 5432 |

---

## Troubleshooting

**Backend won't start — `SECRET_KEY is not set`**
→ Add `SECRET_KEY=...` to `backend\.env`

**AI agent not connecting — `registered worker` never appears**
→ Check `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` are correct
→ Make sure LiveKit SIP trunk is created and `LIVEKIT_SIP_TRUNK_ID` is set

**Meta webhook not receiving leads**
→ Confirm `BACKEND_PUBLIC_URL` is set to your ngrok URL (not localhost)
→ Check the Callback URL in Meta Developers matches exactly: `{BACKEND_PUBLIC_URL}/meta/webhook`
→ Ensure `leadgen` is subscribed on your page

**"Connect with Facebook" button shows error**
→ `META_APP_ID` or `META_APP_SECRET` not set in `.env`
→ Facebook App must be in Development mode (or reviewed + live for production)
→ Redirect URI in Meta App settings must include `{BACKEND_PUBLIC_URL}/oauth/meta/callback`

**HubSpot OAuth fails**
→ `HUBSPOT_CLIENT_ID` / `HUBSPOT_CLIENT_SECRET` not set
→ Redirect URI in HubSpot app settings must include `{BACKEND_PUBLIC_URL}/oauth/hubspot/callback`

**Leads not routing to the right campaign**
→ Set the Meta Form ID / HubSpot List ID on the Campaign → Lead Source tab
→ Without a specific ID, platform-level leads cannot be routed safely across clients

**Encryption error on startup**
→ `ENCRYPTION_KEY` is missing or was changed after secrets were saved
→ If changed: all stored API keys/tokens need to be re-entered in Integrations
