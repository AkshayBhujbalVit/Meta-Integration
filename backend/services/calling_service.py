"""
Calling service — pluggable AI outbound call provider.

Supported providers:
  livekit  — LiveKit + Gemini Live API (default — realtime voice)
  bland    — Bland AI (api.bland.ai)
  retell   — Retell AI (api.retellai.com)
  custom   — Any HTTP webhook (admin-configured URL + headers)

Provider is selected from calling_config.provider in DB.
System prompt is built dynamically per lead (KB injection) then sent to the provider.
"""

import json
from datetime import datetime

from sqlalchemy.orm import Session

from core.http_client import async_client
from models.models.knowledge_base import KBItem, KBSection
from models.models.lead import Lead
from models.models.settings import CallingConfig, ClinicSettings
from services.embedding_service import search_kb_rag


def _get_kb_items(slug: str, db: Session, max_items: int = 5) -> list[dict]:
    section = db.query(KBSection).filter(KBSection.slug == slug).first()
    if not section:
        return []
    items = (
        db.query(KBItem)
        .filter(KBItem.section_id == section.id, KBItem.is_active == True)
        .order_by(KBItem.sort_order)
        .limit(max_items)
        .all()
    )
    return [{"q": i.question, "a": i.answer} for i in items]


def _kb_block(label: str, items: list[dict]) -> str:
    if not items:
        return ""
    lines = [f"\n## {label}"]
    for item in items:
        lines.append(f"Q: {item['q']}\nA: {item['a']}")
    return "\n".join(lines)


def _kb_block_rag(items: list[dict]) -> str:
    if not items:
        return ""
    lines = ["\n## KNOWLEDGE BASE (most relevant)"]
    for item in items:
        section = item.get("section", "")
        lines.append(f"[{section}]\nQ: {item['q']}\nA: {item['a']}")
    return "\n".join(lines)


def _build_rag_query(lead) -> str:
    parts = []
    if lead.inquiry_type:
        parts.append(lead.inquiry_type)
    if getattr(lead, "second_inquiry_type", None):
        parts.append(lead.second_inquiry_type)
    if getattr(lead, "problem_description", None):
        parts.append(lead.problem_description)
    return " ".join(parts)


# ── Default system prompt ─────────────────────────────────────────────────────

DEFAULT_INSTRUCTIONS = """\
## IDENTITY
You are an AI calling agent for {business_name}.
Your role is to follow up with leads, answer their questions, and guide them toward the next step
(booking a call, scheduling a demo, making an appointment, etc.).
You are NOT a human. If asked directly, always confirm you are an AI assistant.

## TONE & STYLE
- Speak naturally — warm, professional, and helpful.
- ONE thought per turn, then STOP and LISTEN. Never ask two things at once.
- React to what the person says before moving forward.
- NEVER repeat yourself. NEVER say the same phrase twice in a row.
- Be confident but never pushy.

## LANGUAGE
Start in Hindi by default. Switch naturally based on the lead:
- Consistent English speaker → switch to English
- Consistent regional language → match them
- Hinglish → match their style

Hindi: "Namaste {first_name} ji. Main {business_name} se baat kar raha/rahi hoon."
English: "Hello {first_name}. I'm calling from {business_name}."

## CALL OPENING
Start with ONLY this:
"Hello, kya main {first_name} ji se baat kar raha/rahi hoon?"
→ Wait for confirmation.

After they confirm:
"Main {business_name} se call kar raha/rahi hoon — aapne {inquiry_type} ke liye inquiry submit ki thi. Kya abhi 2-3 minute baat kar sakte hain?"
→ Wait.

If busy:
"Koi baat nahi. Jab convenient ho tab call karein."
→ End politely.

## GOAL
Guide the lead to the next step:
1. Understand their need — ask ONE question, then listen
2. Confirm their interest
3. Book or schedule the appropriate next step
4. Confirm and close warmly

## HANDLING QUESTIONS
- Answer questions directly and concisely (1-2 sentences)
- If you don't know: "Main aapko proper team se connect karta/karti hoon"
- Out of scope: "Main sirf {business_name} ke baare mein help kar sakta/sakti hoon"

## SPECIAL SITUATIONS
If ANGRY: "Main samajh sakta/sakti hoon, I'm sorry. Hum aapki help zaroor karenge." → Stay calm.
If SILENT: "Hello? Kya aap mujhe sun pa rahe hain?" (once) → offer to call back.

## IF ASKED "Are you AI?"
"Haan, main AI assistant hoon — {business_name} ki taraf se call kar raha/rahi hoon. Poori madad kar sakta/sakti hoon."

## CLOSING
"Thank you for your time! Agar koi aur sawaal ho, hum yahan hain. Have a wonderful day!"
→ STOP after this. Do not continue.

## HARD RULES
- Never make commitments you cannot keep
- Never invent contact details or prices
- If lead says bye/thank you → respond warmly and STOP immediately
- Never sound rushed or scripted
"""

DEFAULT_INBOUND_INSTRUCTIONS = """\
You are an AI assistant for {business_name}.
A person has called in. Greet them warmly and help them with their inquiry.

Greeting: "Namaste! {business_name} mein aapka swagat hai. Main aapki kya madad kar sakta/sakti hoon?"

You can help with:
1. Answering questions about the business
2. Booking appointments or demos
3. General inquiries

RULES:
- Match the caller's language (Hindi/English/regional)
- Never invent information you don't have
- Keep calls focused and concise
"""


def build_system_prompt(lead: Lead, db: Session) -> str:
    cfg = db.query(CallingConfig).first()
    settings = db.query(ClinicSettings).first()
    business_name = settings.clinic_name if settings and settings.clinic_name else "our company"
    business_hours = (
        settings.timings if settings and settings.timings else "Mon-Sat: 9:00 AM-6:00 PM"
    )
    first_name = (lead.full_name or "").split()[0] if lead.full_name else "ji"

    base = cfg.system_prompt if cfg and cfg.system_prompt else DEFAULT_INSTRUCTIONS

    class SafeMap(dict):
        def __missing__(self, key):
            return "{" + key + "}"

    instructions = base.format_map(
        SafeMap(
            business_name=business_name,
            business_hours=business_hours,
            first_name=first_name,
            inquiry_type=lead.inquiry_type or "your inquiry",
        )
    )

    call_count = lead.call_count or 0
    prev_outcome = lead.call_outcome or ""

    ctx_lines = [f"Name: {lead.full_name or 'Lead'}", f"Address as: {first_name} ji"]
    if lead.inquiry_type:
        ctx_lines.append(f"Primary inquiry: {lead.inquiry_type}")
    if lead.city:
        ctx_lines.append(f"City: {lead.city}")
    ctx_lines.append(f"Total previous calls: {call_count}")
    if prev_outcome:
        ctx_lines.append(f"Last call outcome: {prev_outcome}")

    followup_note = ""
    if call_count > 1:
        followup_note = f"""
NOTE: This is attempt #{call_count}. Previous outcome: {prev_outcome or 'unknown'}.
Keep the intro brief — lead has heard from us before. Go to the point sooner.
"""

    prompt = f"""{instructions}
{followup_note}
---
## LEAD DETAILS (this call)
{chr(10).join(ctx_lines)}

---
## KNOWLEDGE BASE
"""

    rag_query = _build_rag_query(lead)
    rag_items = search_kb_rag(rag_query, db, top_k=8)

    if rag_items:
        prompt += _kb_block_rag(rag_items)
    else:
        prompt += _kb_block("Business Info", _get_kb_items("business_info", db, max_items=5))
        if lead.inquiry_type:
            prompt += _kb_block(lead.inquiry_type, _get_kb_items("general", db, max_items=5))

    return prompt.strip()


def build_inbound_prompt(lead, db: Session) -> str:
    settings = db.query(ClinicSettings).first()
    business_name = settings.clinic_name if settings and settings.clinic_name else "our company"
    first_name = (lead.full_name or "").split()[0] if lead.full_name else "ji"

    outbound_prompt = build_system_prompt(lead, db)

    inbound_prefix = f"""\
THIS IS AN INBOUND CALL — the lead called in themselves.

Lead profile:
- Name: {lead.full_name or 'Unknown'}
- Inquiry: {lead.inquiry_type or 'General'}
- Previous status: {lead.status}
- Total previous calls: {lead.call_count or 0}

GREETING: "Namaste {first_name} ji! {business_name} mein aapka swagat hai. Kya main aapki madad kar sakta/sakti hoon?"

If we've spoken before, keep the tone familiar and warm.
"""
    return inbound_prefix + "\n" + outbound_prompt


# ── Calling hours helper ──────────────────────────────────────────────────────


def within_calling_hours(cfg) -> bool:
    """Return True if current local time is within the configured calling window."""
    now = datetime.now()
    current = now.strftime("%H:%M")
    start = getattr(cfg, "call_start_time", None) or "09:00"
    end = getattr(cfg, "call_end_time", None) or "20:00"
    return start <= current <= end


# ── Core trigger ──────────────────────────────────────────────────────────────


async def trigger_call(lead: Lead, db: Session) -> dict:
    cfg = db.query(CallingConfig).filter(CallingConfig.is_active == True).first()
    if not cfg:
        raise ValueError("Calling provider is not configured in settings")

    provider = (cfg.provider or "livekit").lower()

    if provider == "livekit":
        pass
    elif not cfg.api_key:
        raise ValueError(
            f"API key is not configured for '{provider}'. Add it in Settings → Calling Provider."
        )

    if lead.campaign_id:
        from models.models.campaign import Campaign

        campaign = db.query(Campaign).filter(Campaign.id == lead.campaign_id).first()
        if campaign and campaign.agent_prompt:
            settings = db.query(ClinicSettings).first()
            business_name = settings.clinic_name if settings else "our company"
            first_name = (lead.full_name or "").split()[0] if lead.full_name else "ji"

            class SafeMap(dict):
                def __missing__(self, key):
                    return "{" + key + "}"

            system_prompt = campaign.agent_prompt.format_map(
                SafeMap(
                    business_name=business_name,
                    first_name=first_name,
                    full_name=lead.full_name or "ji",
                    phone=lead.phone or "",
                    campaign_name=campaign.name or "",
                )
            )
        else:
            system_prompt = build_system_prompt(lead, db)
    else:
        system_prompt = build_system_prompt(lead, db)

    return await _dispatch(provider, cfg, lead, system_prompt, db)


# ── Provider dispatch ─────────────────────────────────────────────────────────


async def _dispatch(
    provider: str, cfg: CallingConfig, lead: Lead, prompt: str, db: Session
) -> dict:
    if provider == "livekit":
        from services.livekit_service import trigger_livekit_call

        return await trigger_livekit_call(lead, prompt, db)
    elif provider == "bland":
        call_id = await _bland_call(cfg, lead, prompt)
        return {"call_id": call_id, "provider": "bland", "status": "initiated"}
    elif provider == "retell":
        call_id = await _retell_call(cfg, lead, prompt)
        return {"call_id": call_id, "provider": "retell", "status": "initiated"}
    elif provider == "custom":
        call_id = await _custom_call(cfg, lead, prompt)
        return {"call_id": call_id, "provider": "custom", "status": "initiated"}
    else:
        raise ValueError(f"Unknown calling provider: {provider}")


# ── Bland AI ──────────────────────────────────────────────────────────────────


async def _bland_call(cfg: CallingConfig, lead: Lead, prompt: str) -> str:
    payload = {
        "phone_number": lead.phone,
        "task": prompt,
        "voice_id": 0,
        "reduce_latency": False,
        "request_data": {
            "lead_name": lead.full_name or "",
            "inquiry_type": lead.inquiry_type or "",
        },
    }
    if cfg.agent_id:
        payload["pathway_id"] = cfg.agent_id

    async with async_client(timeout=30) as client:
        resp = await client.post(
            "https://api.bland.ai/v1/calls",
            headers={"authorization": cfg.api_key},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("call_id") or data.get("id") or ""


# ── Retell AI ─────────────────────────────────────────────────────────────────


async def _retell_call(cfg: CallingConfig, lead: Lead, prompt: str) -> str:
    payload = {
        "agent_id": cfg.agent_id,
        "to_number": lead.phone,
        "retell_llm_dynamic_variables": {
            "lead_name": lead.full_name or "Lead",
            "inquiry_type": lead.inquiry_type or "",
            "system_prompt": prompt,
        },
    }
    async with async_client(timeout=30) as client:
        resp = await client.post(
            "https://api.retellai.com/v2/create-phone-call",
            headers={"Authorization": f"Bearer {cfg.api_key}"},
            json=payload,
        )
        resp.raise_for_status()
        data = resp.json()
        return data.get("call_id") or data.get("id") or ""


# ── Custom webhook ────────────────────────────────────────────────────────────


async def _custom_call(cfg: CallingConfig, lead: Lead, prompt: str) -> str:
    if not cfg.webhook_url:
        raise ValueError("Custom calling webhook URL is not configured")

    headers = {"Content-Type": "application/json"}
    if cfg.webhook_headers:
        try:
            headers.update(json.loads(cfg.webhook_headers))
        except Exception:
            pass

    payload = {
        "phone": lead.phone,
        "name": lead.full_name or "",
        "system_prompt": prompt,
        "agent_id": cfg.agent_id or "",
        "inquiry_type": lead.inquiry_type or "",
    }

    async with async_client(timeout=30) as client:
        resp = await client.post(cfg.webhook_url, headers=headers, json=payload)
        resp.raise_for_status()
        try:
            data = resp.json()
            return data.get("call_id") or data.get("id") or "custom_initiated"
        except Exception:
            return "custom_initiated"
