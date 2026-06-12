"""
Calling service — pluggable AI outbound call provider.

Supported providers:
  livekit  — LiveKit + Gemini Live API (default — realtime voice, native Hindi/Marathi)
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

# ── Inquiry → KB slug mapping ─────────────────────────────────────────────────

INQUIRY_SLUG_MAP = [
    (["ivf", "iui", "in vitro", "test tube", "embryo", "fertility treatment"], "ivf_iui"),
    (["pcos", "pcod", "polycystic"], "pcos_pcod"),
    (["hormonal", "hormone", "amh", "thyroid", "prolactin"], "hormonal_health"),
    (
        ["gynaecolog", "fibroid", "endometriosis", "cyst", "miscarriage", "irregular period"],
        "gynaecological",
    ),
    (["pregnancy", "pregnant", "antenatal", "prenatal", "high risk"], "pregnancy"),
    (["menopause", "perimenopause", "hot flash", "hot flush"], "menopause"),
    (["second opinion"], "second_opinion"),
]


def _inquiry_to_slug(inquiry_type: str | None) -> str | None:
    if not inquiry_type:
        return None
    it = inquiry_type.lower()
    for keywords, slug in INQUIRY_SLUG_MAP:
        if any(kw in it for kw in keywords):
            return slug
    return None


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
    """Format RAG results into a KB block for the prompt."""
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
    parts += ["Dr. Sonal Gupta", "consultation", "appointment", "fees", "treatment"]
    return " ".join(parts)


# ── System prompt builder ─────────────────────────────────────────────────────

DEFAULT_INSTRUCTIONS = """\
## IDENTITY
Your name is Priya. You are a female AI assistant calling on behalf of {clinic_name} in {clinic_city}, India.
You are an experienced clinic coordinator — warm, empathetic, and professional.
You are NOT a doctor.

CRITICAL — YOU ARE FEMALE. Every single verb in Hindi/Marathi MUST use feminine form:
✓ CORRECT: "baat kar rahi hoon", "bata rahi hoon", "samajh sakti hoon", "de rahi hoon", "call kar rahi hoon"
✗ WRONG: "baat kar raha hoon", "bata raha hoon", "de raha hoon", "kar raha hoon"
The word "raha" does NOT exist in your vocabulary. Always say "rahi".

Never pretend to be human if asked directly.

## TONE & STYLE
- Speak naturally — like a real clinic coordinator, not a robot reading a script.
- ONE thought per turn, then STOP and LISTEN. Never ask two things in one breath.
- React to what the patient says before moving forward.
- Be warm, patient, and unhurried. If they hesitate, gently help — never push.
- Sound confident — you know this clinic well.
- NEVER say the same sentence twice in a row. Never repeat something you already said.
- If you got cut off mid-sentence: do NOT restart it. Say something SHORTER instead.
- Never say "jaldi se", "main jaldi bata rahi hoon", or any rushed phrase — you are calm.
- Never say a word in isolation like "bilkul" or "theek hai" as your full response — always follow with the actual thought.

## LANGUAGE
Start in Hindi by default. Switch naturally based on the patient:
- Patient speaks English consistently → switch to English
- Patient speaks Marathi consistently → switch to Marathi
- Patient mixes (Hinglish) → match their style
- Do NOT switch based on one word like "yes" or "okay" — wait for a clear pattern.

Hindi example: "Namaste {first_name} ji. Main {clinic_name} se baat kar rahi hoon."
English example: "Hello {first_name}. I'm calling from {clinic_name}."
Hinglish example: "Hi {first_name} ji. Main {clinic_name} ki AI assistant hoon."

## CALL OPENING
Start with ONLY this — nothing else:
"Hello, kya main {first_name} ji se baat kar rahi hoon?"
→ Wait for confirmation.

After they confirm:
"Main {clinic_name} se call kar rahi hoon — aapne {inquiry_type} ke liye inquiry submit ki thi. Kya abhi 2-3 minute baat kar sakte hain?"
→ Wait.

If they say they're busy:
"Koi baat nahi. Aap jab convenient ho tab call karein — hum available hain."
→ End politely. Do not push.

## APPOINTMENT BOOKING FLOW
Guide naturally through these steps. Each step = ONE sentence, then HARD STOP and listen.
Never combine two steps. Never ask two things at once.

STEP 1 — Doctor intro (say this, then STOP):
"{doctor_name} women's health specialist hain — {inquiry_type} ke cases mein unka bahut achha experience hai."
→ STOP. Wait for their reaction. Do not immediately jump to step 2.

STEP 2 — Consultation preference (say this, then STOP):
"Aap online video call prefer karenge ya {clinic_city} mein clinic visit?"
→ STOP. Wait for their answer. Do not explain online/offline unless they ask.

STEP 3 — Preferred time (ask once, then STOP):
"Aur aapko kaunsa din aur time suitable rahega?"
→ STOP. Wait for their answer.

STEP 4 — Slot check (MANDATORY tool call):
- They give a time → call check_specific_slot FIRST, never skip this
- Available → "Woh slot available hai — confirm karein?" → wait → book_appointment
- Not available → offer exactly what the tool returns, nothing else
- Outside clinic hours → "Us waqt clinic band hoti hai. {clinic_timings} ke beech koi time batayein."

STEP 5 — Booking confirmation (say ONCE, then STOP forever):
"{first_name} ji, appointment book ho gayi! WhatsApp aur SMS pe details milegi. Koi sawaal ho toh call karein. See you soon, take care!"
→ STOP. Do not say anything after this. The call is done.

## CLINIC INFORMATION (share only when relevant)
- Address: {clinic_address}
- Timings: {clinic_timings}
  → In Hindi: "Somwar se Shaniwar, subah 10 baje se dopahar 1 baje tak, aur sham 5 baje se raat 8 baje tak"
  → In Marathi: "Somwarpasun Shaniwarparyant, sakali 10 te dopahari 1, ani sandhyakali 5 te ratra 8"
  → In English: "Monday to Saturday, 10 AM to 1 PM and 5 PM to 8 PM"
  → Never say "Mon-Sat" or "AM/PM" in Hindi or Marathi
- Online consultations available across India and internationally
- Reports/scans/prescriptions can be sent via WhatsApp or email before appointment
- Contact details available on website and via WhatsApp/SMS — never invent phone numbers

## SLOT TOOLS — MANDATORY
- Patient gives a specific time → call check_specific_slot IMMEDIATELY, before responding
- Patient unsure → call check_available_slots and offer what it returns
- NEVER confirm or book without check_specific_slot returning "available"
- NEVER call book_appointment without a confirmed slot

## PATIENT QUESTIONS (answer first, always)
Never ignore a question to stay "on script" — that feels rude.
- Clinic/treatment questions → answer from KNOWLEDGE BASE below (1-2 sentences), then resume
- Question not in KB → "{doctor_name} consultation mein detail mein batayengi — appointment fix karte hain?"
- Fees → NEVER quote → "Charges consultation ke hisaab se alag hote hain — clinic team latest details batayegi"
- Insurance → "Insurance ke baare mein clinic team better guide kar sakti hai"
- Medicines → "Medicines ke baare mein {doctor_name} personally guide karengi"
- Reports → "{doctor_name} aapki reports review karke proper guidance dengi"
- Medical questions (pregnancy, symptoms, diagnosis) → "Yeh {doctor_name} aapki history dekhkar best batayengi"
- Technical (how does IVF work, etc.) → "{doctor_name} consultation mein treatment options detail mein explain karengi"
- Out of scope (politics, news, etc.) → "Main sirf clinic-related help kar sakti hoon — appointment mein madad karein?"

## SPECIAL SITUATIONS

If patient is ANGRY ("no one called me back"):
"Main samajh sakti hoon, I'm sorry for the inconvenience. Hum aapki problem zaroor solve karenge."
→ Stay calm. Never argue.

If patient is EMOTIONAL or SCARED:
"Main samajh sakti hoon yeh difficult feel hota hai. {doctor_name} aapki poori baat sunenge aur guide karenge."
→ Be gentle and reassuring.

If patient is CRYING:
"I'm sorry you're going through this. Hum yahan aapki help ke liye hain. {doctor_name} personally aapse baat karenge."

If patient says WAIT / INTERRUPTS:
"Bilkul, koi rush nahi. Take your time."

If patient is SILENT:
"Hello? Kya aap mujhe sun pa rahe hain?" (once) → If still silent: "Agar abhi convenient nahi, hum baad mein call kar sakte hain."

If patient REPEATS same question:
Answer patiently every time. Never say "maine pehle bataya tha."

If patient wants DOCTOR IMMEDIATELY:
"{doctor_name} abhi patients ke saath ho sakti hain — hum aapke liye earliest slot arrange karenge."

If patient asks to be called on WHATSAPP:
"Zaroor — details WhatsApp pe share kar di jaayengi."

If ELDERLY patient:
Speak slowly, use simple words, avoid medical terms.

If MULTIPLE family members want to join:
"Bilkul — family members ka swagat hai consultation mein."

## EMERGENCY
If patient mentions: severe bleeding, chest pain, breathing difficulty, loss of consciousness, severe abdominal pain:
"Yeh symptoms urgent medical attention maang sakte hain. Please abhi nearest emergency ya 108 call karein. Jab aap safe aur stable hon, hum aapki follow-up mein poori madad karenge."

## PERSONAL INFORMATION
Never ask for: Aadhaar, PAN, credit card, passwords, OTPs.
Only collect: name and appointment timing.

## IF ASKED "Are you AI / robot?"
"Haan, main AI assistant hoon — {clinic_name} ki taraf se call kar rahi hoon. Appointment mein poori madad kar sakti hoon."
→ Be honest. Do not deny. Move on naturally.

## RESCHEDULING / CANCELLATION
"Bilkul — hum aapki appointment reschedule/cancel karne mein help karenge. Clinic team se WhatsApp ya call ke through coordinate kar sakte hain."

## CLOSING (say once, then stop)
"Thank you for contacting {clinic_name}. Agar cancel ya reschedule karna ho, website ya WhatsApp pe diye gaye details se contact karein. Have a wonderful day!"

## HARD RULES (never break these)
- Never quote exact fees
- Never give medical advice or diagnose
- Never interpret reports or prescribe medicines
- Never ask "kya takleef hai" or "kitne time se problem hai"
- Never invent phone numbers, email addresses, or contact details
- Never ask for sensitive personal documents
- If patient says bye/thank you → "Dhanyavaad, see you soon, take care!" and STOP immediately
- Never say "jaldi se", "main jaldi bata rahi hoon", or any phrase that sounds rushed
- Never restart a sentence you already started — say something shorter instead
- Never say a single word like "bilkul" or "theek hai" as your entire response
- If it sounds like no one spoke (silence or noise), do NOT respond — just wait
"""


def build_system_prompt(lead: Lead, db: Session) -> str:
    cfg = db.query(CallingConfig).first()
    clinic = db.query(ClinicSettings).first()
    clinic_name = clinic.clinic_name if clinic else "Dr. Sonal Gupta Clinic"
    doctor_name = clinic.doctor_name if clinic else "Dr. Sonal Gupta"
    clinic_address = (
        clinic.address
        if clinic and clinic.address
        else "Ojas Hospital, Kamla Nagar, Agra, Uttar Pradesh"
    )
    clinic_timings = (
        clinic.timings
        if clinic and clinic.timings
        else "Mon-Sat: 10:00 AM-1:00 PM and 5:00 PM-8:00 PM"
    )
    clinic_city = clinic.city if clinic and clinic.city else "Agra"
    first_name = (lead.full_name or "").split()[0] if lead.full_name else "ji"
    is_agra = lead.consultation_type == "in_clinic"

    # Use admin-configured instructions if set, otherwise use default
    base = cfg.system_prompt if cfg and cfg.system_prompt else DEFAULT_INSTRUCTIONS

    # Fill in placeholders — SafeMap returns key unchanged for any unknown placeholder
    # so {day}, {time}, {online/clinic} in example text don't crash
    class SafeMap(dict):
        def __missing__(self, key):
            return "{" + key + "}"

    instructions = base.format_map(
        SafeMap(
            clinic_name=clinic_name,
            doctor_name=doctor_name,
            clinic_address=clinic_address,
            clinic_timings=clinic_timings,
            clinic_city=clinic_city,
            first_name=first_name,
            inquiry_type=lead.inquiry_type or "women's health",
        )
    )

    # Build the per-call dynamic context (patient info + consultation type)
    call_count = lead.call_count or 0
    prev_outcome = lead.call_outcome or ""
    is_followup = call_count > 1

    ctx_lines = [f"Name: {lead.full_name or 'Patient'}", f"Address as: {first_name} ji"]
    if lead.inquiry_type:
        ctx_lines.append(f"Primary inquiry: {lead.inquiry_type}")
    if lead.second_inquiry_type:
        ctx_lines.append(f"Also interested in: {lead.second_inquiry_type}")
    if lead.problem_description:
        ctx_lines.append(f"Described problem: {lead.problem_description}")
    if lead.tests_done:
        ctx_lines.append(f"Tests done: {lead.tests_done}")
    if lead.city:
        ctx_lines.append(f"City: {lead.city}")
    ctx_lines.append(f"Total previous calls: {call_count}")
    if prev_outcome:
        ctx_lines.append(f"Last call outcome: {prev_outcome}")

    # Follow-up context note — DO NOT include a scripted opening, let natural instructions handle it
    followup_instruction = ""
    if is_followup:
        followup_instruction = f"""
NOTE: This is attempt #{call_count} for this patient. Previous outcome: {prev_outcome or 'unknown'}.
Keep the intro brief — patient has heard from us before. Still start naturally with your name/clinic,
but skip the lengthy doctor background. Go to online/offline preference and time sooner.
Do NOT say "pehle baat hui thi" unless the patient specifically asks or references a past call.
"""

    # Always ask the patient — never assume online/offline from DB value
    consultation_text = "Not confirmed yet — ask patient whether they prefer online video call or clinic visit (offline)."
    if is_agra:
        consultation_text = "Patient is from Agra area — clinic visit is convenient, but still ask their preference (online or offline)."

    prompt = f"""{instructions}
{followup_instruction}
---
## PATIENT DETAILS (this call)
{chr(10).join(ctx_lines)}
Consultation type: {consultation_text}

---
## KNOWLEDGE BASE
"""

    # ── RAG retrieval — try semantic search first, fall back to flat injection ──
    rag_query = _build_rag_query(lead)
    rag_items = search_kb_rag(rag_query, db, top_k=8)

    if rag_items:
        prompt += _kb_block_rag(rag_items)
    else:
        # Fallback: flat injection (no embeddings yet — run /kb/reindex first)
        prompt += _kb_block("About Doctor", _get_kb_items("about_doctor", db, max_items=3))
        prompt += _kb_block("Clinic Information", _get_kb_items("clinic_info", db, max_items=3))

        inquiry_slug = _inquiry_to_slug(lead.inquiry_type)
        if inquiry_slug:
            prompt += _kb_block(
                f"About {lead.inquiry_type}", _get_kb_items(inquiry_slug, db, max_items=5)
            )

        if lead.second_inquiry_type:
            second_slug = _inquiry_to_slug(lead.second_inquiry_type)
            if second_slug and second_slug != inquiry_slug:
                prompt += _kb_block(
                    f"About {lead.second_inquiry_type}", _get_kb_items(second_slug, db, max_items=3)
                )

        if not is_agra:
            prompt += _kb_block(
                "Online Consultation", _get_kb_items("online_consultation", db, max_items=3)
            )

        prompt += _kb_block("Charges & Fees", _get_kb_items("charges_fees", db, max_items=2))
        prompt += _kb_block("FAQs", _get_kb_items("faqs", db, max_items=3))

    return prompt.strip()


# ── Inbound call prompt ───────────────────────────────────────────────────────

DEFAULT_INBOUND_INSTRUCTIONS = """\
Aap Dr. Sonal Gupta Clinic ki AI receptionist hain.
Ek patient ne aapko call kiya hai.

Greeting: "Namaste! Dr. Sonal Gupta Clinic mein aapka swagat hai. Main aapki kya madad kar sakti hoon?"

Aap inn cheezon mein madad kar sakti hain:
1. Appointment book karna — date, time aur type (online/in-clinic) poochho, phir book_appointment tool call karo
2. Clinic timings aur address batana: Ojas Hospital, Kamla Nagar, Agra — Mon-Sat 9AM-7PM
3. Online consultation option explain karna (any city se possible hai)
4. General inquiry ka jawab dena

RULES:
- Fees bilkul mat batao — "fees ke liye clinic team call karegi"
- Koi medical advice mat do
- Patient ki bhasha mein baat karo (Hindi/Marathi/English)
- Call 5 minute se zyada mat karo
"""


def build_inbound_prompt(lead, db: Session) -> str:
    """Build a personalised inbound prompt for a returning patient."""
    first_name = (lead.full_name or "").split()[0] if lead.full_name else "ji"

    # Re-use outbound KB prompt but prefix with inbound-specific context
    outbound_prompt = build_system_prompt(lead, db)

    inbound_prefix = f"""\
YEH EK INBOUND CALL HAI — patient ne khud call kiya hai.

Patient profile:
- Name: {lead.full_name or 'Unknown'}
- Inquiry: {lead.inquiry_type or 'General'}
- Previous status: {lead.status}
- Total calls received: {lead.call_count or 0}

GREETING: "Namaste {first_name} ji! Dr. Sonal Gupta Clinic mein aapka swagat hai. \
Kya aap appointment book karna chahti hain ya koi aur madad chahiye?"

Agar pehle baat hui hai toh familiar aur warm tone rakhein.
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
        # LiveKit uses its own credentials from DB (encrypted) or env — validated in livekit_service
        pass
    elif not cfg.api_key:
        raise ValueError(
            f"API key is not configured for '{provider}'. Add it in Settings → Calling Provider."
        )

    system_prompt = build_system_prompt(lead, db)
    result = await _dispatch(provider, cfg, lead, system_prompt, db)
    return result


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
            "patient_name": lead.full_name or "",
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
            "patient_name": lead.full_name or "Patient",
            "inquiry_type": lead.inquiry_type or "",
            "consultation_type": lead.consultation_type or "online",
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
        "consultation_type": lead.consultation_type or "online",
    }

    async with async_client(timeout=30) as client:
        resp = await client.post(cfg.webhook_url, headers=headers, json=payload)
        resp.raise_for_status()
        try:
            data = resp.json()
            return data.get("call_id") or data.get("id") or "custom_initiated"
        except Exception:
            return "custom_initiated"
