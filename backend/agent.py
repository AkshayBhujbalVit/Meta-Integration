"""
LiveKit Voice Agent — Vidushi Infotech AI Calling Platform
==========================================================
Handles both OUTBOUND (AI calls lead) and INBOUND (lead calls back) calls.

Outbound room name format: call-{lead_id}-{uuid8}   → prompt stored in room.metadata
Inbound room name format:  inbound-{uuid}           → prompt fetched from backend by phone number

Start with:
    python agent.py dev      # local development
    python agent.py start    # production
"""

import asyncio
import logging
import os
import random
import struct
import time

import httpx
from dotenv import load_dotenv
from livekit import api as livekit_api
from livekit import rtc
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, function_tool
from livekit.plugins import openai as lk_openai

load_dotenv(override=True)

logger = logging.getLogger("agent")

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-realtime")
BACKEND_URL = os.getenv("BACKEND_PUBLIC_URL", "http://localhost:8009")
INTERNAL_API_SECRET = os.getenv("INTERNAL_API_SECRET", "")

_INTERNAL_HEADERS = {"X-Internal-Token": INTERNAL_API_SECRET} if INTERNAL_API_SECRET else {}

DEFAULT_INSTRUCTIONS = """\
Aap {business_name} ki AI calling assistant hain.
Goal: Natural baat karke lead se baat karna aur unki requirement samajhna.

STYLE: Real conversation — script nahi. 1-2 sentences, phir RUKO aur suno.
Jo bole uspe react karo. Warm aur helpful.

LANGUAGE: Hindi mein shuru. 2+ sentences doosri bhasha mein aaye tab switch.

FLOW:
1. OPENING: "Namaste! Main {business_name} se call kar raha/rahi hoon — kya main {first_name} ji se baat kar sakta/sakti hoon?" → wait for answer
2. Unki requirement samjho
3. Meeting ya callback schedule karo using book_appointment tool
4. Close: WhatsApp + SMS confirmation mention karo

RULES: Seedha helpful bano. Pressure mat daalo.
"""

DEFAULT_INBOUND_INSTRUCTIONS = """\
Aap {business_name} ki AI assistant hain.
Caller ne aapko call kiya hai.
Greeting: "Namaste! {business_name} mein aapka swagat hai. Main aapki kya madad kar sakti hoon?"
Caller ki bhasha mein baat karo. Meeting book karne, reschedule karne, ya general queries ka jawab do.
"""


# ── Tool factory ──────────────────────────────────────────────────────────────


def _make_check_slots_tool():
    """Returns a tool that checks real available slots from the backend."""

    @function_tool
    async def check_available_slots() -> str:
        """
        Check what appointment slots are available at the clinic.

        Call this when the patient asks:
        - "kab available hai" / "kab slot hai"
        - "what dates are available" / "koi slot batao"
        - "kal available hai kya" / "is time slot available hai"
        - Any question about availability or free time

        Returns 2-3 real available slots, giving first priority to
        recently cancelled / rescheduled slots.
        """
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(f"{BACKEND_URL}/calling/available-slots")
                if resp.status_code == 200:
                    data = resp.json()
                    if not data.get("available"):
                        return (
                            "Abhi koi slot available nahi hai agle kuch dinon mein. "
                            "Patient ko batao: 'Filhaal koi slot available nahi hai — "
                            "kya main aapko 2-3 din baad call karun?'"
                        )
                    slots = data["slots"]
                    has_freed = any(s.get("is_freed_slot") for s in slots)
                    labels = ", ".join(s["label"] for s in slots)

                    if has_freed:
                        return (
                            f"Yeh slots available hain (pehla slot abhi free hua hai — "
                            f"priority basis pe offer karo): {labels}. "
                            f"Patient ko sirf yeh 2-3 options do aur unhe choose karne do."
                        )
                    return (
                        f"Yeh slots available hain: {labels}. "
                        f"Patient ko yeh options do aur poochho kaun sa suit karega."
                    )
        except Exception as e:
            logger.warning("check_available_slots failed: %s", e)
        return (
            "Slot check nahi ho saka abhi. "
            "Patient se seedha poochho: 'Aapke liye kaun sa din aur time theek rahega?'"
        )

    return check_available_slots


def _make_check_specific_slot_tool():
    """Tool to verify if a patient's requested time is actually available."""

    @function_tool
    async def check_specific_slot(requested_datetime: str) -> str:
        """
        Check if a SPECIFIC date and time slot is available for appointment.

        Call this IMMEDIATELY when the patient mentions a specific time, e.g.:
        - "aaj 3 baje" → check_specific_slot("2026-06-03T15:00:00")
        - "kal 5 baje" → check_specific_slot("2026-06-04T17:00:00")
        - "parso subah 10" → check_specific_slot(...)

        If available → confirm it and proceed to book.
        If NOT available → tell patient it's taken and offer the alternatives returned.

        Args:
            requested_datetime: ISO 8601 string e.g. "2026-06-03T15:00:00"
        """
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                resp = await client.get(
                    f"{BACKEND_URL}/calling/check-slot",
                    params={"requested_datetime": requested_datetime},
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("available"):
                        slot = data["slot"]
                        freed_note = (
                            " (Yeh slot recently free hua hai!)"
                            if slot.get("is_freed_slot")
                            else ""
                        )
                        return f"Slot available hai{freed_note}: {slot['label']}. Confirm karke book karo."
                    else:
                        alts = data.get("alternatives", [])
                        alt_text = (
                            ", ".join(a["label"] for a in alts) if alts else "koi alternative nahi"
                        )
                        return (
                            f"{data.get('message', 'Yeh slot available nahi hai.')} "
                            f"Patient ko yeh alternatives offer karo: {alt_text}"
                        )
        except Exception as e:
            logger.warning("check_specific_slot failed: %s", e)
        return "Slot check nahi ho saka. Patient se directly poochho ki koi aur time suit karega."

    return check_specific_slot


def _make_book_appointment_tool(lead_id: int):
    @function_tool
    async def book_appointment(
        appointment_datetime: str,
        appointment_type: str = "online",
        notes: str = "",
    ) -> str:
        """
        Book an appointment for the patient in the database.

        Args:
            appointment_datetime: ISO 8601 datetime string, e.g. "2026-06-02T18:00:00"
            appointment_type: "online" or "in_clinic"
            notes: Optional notes about the appointment
        """
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{BACKEND_URL}/calling/internal/book-appointment",
                    json={
                        "lead_id": lead_id,
                        "appointment_datetime": appointment_datetime,
                        "appointment_type": appointment_type,
                        "notes": notes,
                    },
                    headers=_INTERNAL_HEADERS,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    logger.info("Appointment booked: %s", data)
                    # Return minimal signal — let the AI compose the closing naturally (avoids duplicate messages)
                    return f"BOOKED:{data.get('appointment_date', appointment_datetime)}"
                else:
                    logger.error("Failed to book appointment: %s", resp.text)
                    return "BOOKING_FAILED: Please ask the patient to try a different time."
        except Exception as e:
            logger.error("book_appointment tool error: %s", e)
            return "BOOKING_FAILED: Technical issue, ask patient to call back."

    return book_appointment


# ── Config helpers ────────────────────────────────────────────────────────────


async def _get_agent_voice() -> str:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{BACKEND_URL}/calling/agent-config")
            if resp.status_code == 200:
                return resp.json().get("voice", "coral")
    except Exception:
        pass
    return os.getenv("AGENT_VOICE", "coral")


async def _get_inbound_context(caller_phone: str) -> dict:
    """Fetch lead context for an inbound caller from the backend."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{BACKEND_URL}/calling/inbound-context",
                params={"phone": caller_phone},
                headers=_INTERNAL_HEADERS,
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception as e:
        logger.warning("Could not fetch inbound context: %s", e)
    return {"lead_id": 0, "instructions": DEFAULT_INBOUND_INSTRUCTIONS, "is_returning": False}


def _extract_caller_phone(participant: rtc.Participant) -> str:
    """Extract caller's phone number from a SIP participant's identity/attributes."""
    identity = participant.identity or ""
    # SIP participant identity is often "+919876543210" or "sip:+91...@domain"
    if identity.startswith("sip:"):
        identity = identity.split("sip:")[1].split("@")[0]

    attrs = participant.attributes or {}
    for key in ("sip.from", "sip_from", "caller_id", "from_number", "phone"):
        val = attrs.get(key, "")
        if val:
            if "@" in val:
                val = val.split("@")[0].replace("sip:", "").replace("tel:", "")
            return val.strip()

    return identity.strip()


# ── Office background noise ───────────────────────────────────────────────────
# NOTE: Separate track approach does not reach SIP callers — LiveKit SIP bridge
# only forwards the primary audio track. Background noise is disabled for phone calls.
# If a WebRTC client (browser) is in the room, they would hear it.

_SAMPLE_RATE = 48000
_CHUNK_SAMPLES = _SAMPLE_RATE // 5  # 200 ms chunks — fewer async boundaries, less jitter


def _make_noise_buffer(seconds: int = 10) -> bytes:
    """Pre-generate N seconds of pink noise in a thread (off event loop) — avoids blocking."""
    volume = 0.012
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0
    total = _SAMPLE_RATE * seconds
    out: list[int] = []
    for _ in range(total):
        w = random.uniform(-1.0, 1.0)  # noqa: S311
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.96900 * b2 + w * 0.1538520
        b3 = 0.86650 * b3 + w * 0.3104856
        b4 = 0.55000 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.0168980
        pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * volume / 5.0
        b6 = w * 0.115926
        out.append(int(max(-1.0, min(1.0, pink)) * 32767))
    return struct.pack(f"<{total}h", *out)


async def _publish_office_noise(room: rtc.Room) -> None:
    """Publish subtle office ambient noise. Works for WebRTC clients; SIP callers may not hear it."""
    import concurrent.futures

    loop = asyncio.get_event_loop()
    source = rtc.AudioSource(sample_rate=_SAMPLE_RATE, num_channels=1)
    track = rtc.LocalAudioTrack.create_audio_track("office-ambient", source)
    try:
        await room.local_participant.publish_track(track)
        logger.info("Office noise track published")
    except Exception as e:
        logger.warning("Could not publish office noise: %s", e)
        return
    try:
        chunk_size = _CHUNK_SAMPLES
        chunk_bytes = chunk_size * 2  # 16-bit = 2 bytes per sample
        while True:
            # Generate 10s buffer off the event loop to avoid blocking
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                buf = await loop.run_in_executor(pool, _make_noise_buffer, 10)
            offset = 0
            while offset + chunk_bytes <= len(buf):
                chunk = buf[offset : offset + chunk_bytes]
                frame = rtc.AudioFrame(
                    data=chunk,
                    sample_rate=_SAMPLE_RATE,
                    num_channels=1,
                    samples_per_channel=chunk_size,
                )
                await source.capture_frame(frame)
                await asyncio.sleep(chunk_size / _SAMPLE_RATE)  # precise real-time pacing
                offset += chunk_bytes
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.debug("Office noise task ended: %s", e)


# ── Main entrypoint ───────────────────────────────────────────────────────────


async def entrypoint(ctx: JobContext):
    await ctx.connect()

    is_inbound = not ctx.room.name.startswith("call-")

    if is_inbound:
        await _handle_inbound(ctx)
    else:
        await _handle_outbound(ctx)


# ── Outbound call (existing flow) ─────────────────────────────────────────────


async def _handle_outbound(ctx: JobContext) -> None:
    instructions = ctx.room.metadata.strip() if ctx.room.metadata else DEFAULT_INSTRUCTIONS

    try:
        await asyncio.wait_for(
            ctx.wait_for_participant(kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP),
            timeout=60,
        )
        logger.info("Outbound | Room: %s | Patient answered", ctx.room.name)
    except TimeoutError:
        logger.warning("Outbound | Room: %s | No answer in 60s", ctx.room.name)
        await _notify_backend(ctx.room.name, "", duration=0, outcome="no_answer")
        return

    try:
        lead_id = int(ctx.room.name.split("-")[1])
    except (IndexError, ValueError):
        lead_id = 0

    await _run_session(ctx, instructions, lead_id, direction="outbound")


# ── Inbound call ──────────────────────────────────────────────────────────────


async def _handle_inbound(ctx: JobContext) -> None:
    logger.info("Inbound | Room: %s | Waiting for caller", ctx.room.name)

    try:
        participant = await asyncio.wait_for(
            ctx.wait_for_participant(kind=rtc.ParticipantKind.PARTICIPANT_KIND_SIP),
            timeout=30,
        )
    except TimeoutError:
        logger.warning("Inbound | Room: %s | No caller in 30s", ctx.room.name)
        return

    caller_phone = _extract_caller_phone(participant)
    logger.info("Inbound | Room: %s | Caller: %s", ctx.room.name, caller_phone)

    context = await _get_inbound_context(caller_phone)
    lead_id: int = context.get("lead_id", 0)
    instructions: str = context.get("instructions", DEFAULT_INBOUND_INSTRUCTIONS)

    await _run_session(
        ctx,
        instructions,
        lead_id,
        direction="inbound",
        caller_phone=caller_phone,
    )


# ── Realtime transcript patch ─────────────────────────────────────────────────


def _patch_realtime_transcript(llm_model: object, transcript_list: list[str]) -> None:
    """Patch OpenAI Realtime plugin sessions to capture AI audio transcripts.

    The SDK stores AI speech in _MessageGeneration.audio_transcript (internal)
    but never writes it back to ChatMessage.content, so session.history is always
    empty for assistant turns. We wrap _handle_response_output_item_done which
    fires after each AI turn is complete with the full transcript available.
    """
    sessions = getattr(llm_model, "_sessions", []) or []
    for rt_sess in sessions:
        orig = getattr(rt_sess, "_handle_response_output_item_done", None)
        if orig is None:
            logger.debug("realtime session has no _handle_response_output_item_done")
            continue

        def _patched(event, _orig=orig, _sess=rt_sess, _tl=transcript_list):
            _orig(event)  # run original (closes channels, etc.)
            try:
                if getattr(getattr(event, "item", None), "type", None) != "message":
                    return
                item_id = getattr(event.item, "id", None)
                if not item_id:
                    return
                gen = getattr(_sess, "_current_generation", None)
                if not gen:
                    return
                msg_gen = (getattr(gen, "messages", {}) or {}).get(item_id)
                if not msg_gen:
                    return
                transcript = (getattr(msg_gen, "audio_transcript", "") or "").strip()
                if transcript:
                    entry = f"assistant: {transcript}"
                    if entry not in _tl:
                        _tl.append(entry)
                        logger.debug("Captured AI turn: %s…", transcript[:60])
            except Exception as e:
                logger.debug("Transcript patch error: %s", e)

        rt_sess._handle_response_output_item_done = _patched
        logger.info("Realtime transcript patch applied to session %s", type(rt_sess).__name__)


# ── Shared session runner ─────────────────────────────────────────────────────


async def _run_session(
    ctx: JobContext,
    instructions: str,
    lead_id: int,
    direction: str = "outbound",
    caller_phone: str = "",
) -> None:
    voice = await _get_agent_voice()
    call_start = time.time()  # fallback — overwritten after session.start() succeeds
    room_name = ctx.room.name

    tools = [
        _make_check_specific_slot_tool(),  # check if PATIENT'S requested time is free
        _make_check_slots_tool(),  # list available slots when patient is unsure
        *([_make_book_appointment_tool(lead_id)] if lead_id else []),
    ]

    agent = Agent(
        instructions=instructions,
        tools=tools,
        llm=lk_openai.realtime.RealtimeModel(
            model="gpt-realtime-2025-08-28",  # latest — best conversation quality
            api_key=OPENAI_API_KEY,
            voice=voice,
            temperature=0.7,
            max_response_output_tokens=250,
            input_audio_transcription={"model": "gpt-realtime-transcription"},
            turn_detection={
                "type": "server_vad",
                "silence_duration_ms": 1000,  # 1s silence before AI responds
                "threshold": 0.88,  # high threshold — SIP echo is loud, need 0.88+
                "prefix_padding_ms": 500,  # 500ms speech must exist before VAD triggers
            },
        ),
    )

    session = AgentSession(
        # SIP echo cancellation — SIP phone echo is brief and has no transcribed words
        allow_interruptions=True,  # allow real user interruptions
        min_interruption_duration=0.8,  # echo < 0.8s → not a real interruption
        min_interruption_words=2,  # echo has 0 words → won't interrupt AI
        resume_false_interruption=True,  # if interrupted by echo, AI resumes speaking
        false_interruption_timeout=1.5,  # if "speech" stops within 1.5s, treat as false
        agent_false_interruption_timeout=1.0,  # agent-side false interruption detection
        aec_warmup_duration=5.0,  # 5s for echo cancellation to calibrate on SIP
    )

    # Collect transcript and detected language in real-time
    live_transcript: list[str] = []
    detected_language: list[str] = []  # first detected lang wins

    def _detect_lang(text: str) -> str:
        """Detect language from script — Devanagari → Hindi, else English."""
        if not text:
            return ""
        devanagari = sum(1 for c in text if "ऀ" <= c <= "ॿ")
        return "Hindi" if len(text) > 0 and devanagari / len(text) > 0.15 else "English"

    @session.on("user_input_transcribed")
    def _on_user_speech(ev):
        try:
            if not getattr(ev, "is_final", True):
                return
            text = getattr(ev, "transcript", None)
            if text and text.strip():
                live_transcript.append(f"user: {text.strip()}")
                # Detect language from script if API didn't provide it
                if not detected_language:
                    lang = getattr(ev, "language", None) or _detect_lang(text.strip())
                    if lang:
                        detected_language.append(str(lang))
        except Exception:
            pass

    # conversation_item_added fires for every turn (user + assistant).
    # For OpenAI Realtime, AI turns are AudioContent — text_content is always None.
    # Must read AudioContent.transcript directly.
    @session.on("conversation_item_added")
    def _on_item_added(ev):
        try:
            from livekit.agents.llm import AudioContent  # noqa: PLC0415

            item = getattr(ev, "item", None)
            if item is None:
                return
            role = getattr(item, "role", None)
            if role not in ("user", "assistant"):
                return
            text = None
            for block in getattr(item, "content", []) or []:
                if isinstance(block, str) and block.strip():
                    text = block.strip()
                    break
                if (
                    isinstance(block, AudioContent)
                    and block.transcript
                    and block.transcript.strip()
                ):
                    text = block.transcript.strip()
                    break
            if not text:
                text = getattr(item, "text_content", None)
            if text and text.strip():
                entry = f"{role}: {text.strip()}"
                if entry not in live_transcript:
                    live_transcript.append(entry)
        except Exception:
            pass

    noise_task: asyncio.Task | None = None
    try:
        await session.start(agent, room=ctx.room)
        # Start timer AFTER session is fully up — excludes SDK init time from duration
        call_start = time.time()
        logger.info("Room: %s | Session started", room_name)

        # Patch the realtime plugin session to capture AI audio transcripts.
        # The SDK never writes AudioContent.transcript back to ChatMessage so
        # session.history always has empty content for assistant turns.
        # _handle_response_output_item_done fires after each AI turn is complete
        # and _current_generation.messages[item_id].audio_transcript is fully populated.
        _patch_realtime_transcript(agent.llm, live_transcript)

        # Start noise AFTER session is live so the room audio is fully ready
        noise_task = asyncio.create_task(_publish_office_noise(ctx.room))
        session.generate_reply()
        await session.wait_for_inactive()
        logger.info("Room: %s | Session ended normally", room_name)
    except Exception as e:
        logger.error("Room: %s | Session error: %s", room_name, e, exc_info=True)
    finally:
        if noise_task:
            noise_task.cancel()
        # Wait 3s so all response-committed events finish writing to history
        await asyncio.sleep(3.0)
        duration = int(time.time() - call_start)
        # Use session.history as primary source (most complete after session ends)
        history_transcript = _get_transcript(session)
        if history_transcript.strip():
            transcript = history_transcript
        elif live_transcript:
            transcript = "\n".join(live_transcript)
        else:
            transcript = ""
        logger.info(
            "Room: %s | Transcript lines (history=%d, live=%d)",
            room_name,
            len(history_transcript.splitlines()),
            len(live_transcript),
        )
        # Default to Hindi if nothing detected (AI always starts in Hindi)
        language = detected_language[0] if detected_language else "Hindi"

        if direction == "inbound":
            await _notify_inbound_backend(
                room_name, caller_phone, lead_id, transcript, duration, recording_url=""
            )
        else:
            await _notify_backend(
                room_name,
                transcript,
                duration=duration,
                recording_url="",
                language=language,
            )


# ── Transcript & recording ────────────────────────────────────────────────────


def _get_transcript(session: AgentSession) -> str:
    """Read full transcript from session history.

    OpenAI Realtime responses are AudioContent objects — text_content skips them.
    We must walk content blocks and read AudioContent.transcript directly.
    """
    try:
        from livekit.agents.llm import AudioContent  # noqa: PLC0415

        lines = []
        for item in session.history.items:
            role = getattr(item, "role", None)
            if role not in ("user", "assistant"):
                continue
            text = None
            for block in getattr(item, "content", []) or []:
                if isinstance(block, str) and block.strip():
                    text = block.strip()
                    break
                if (
                    isinstance(block, AudioContent)
                    and block.transcript
                    and block.transcript.strip()
                ):
                    text = block.transcript.strip()
                    break
            if not text:
                # fallback for non-realtime models that use text_content
                text = getattr(item, "text_content", None)
            if text and text.strip():
                lines.append(f"{role}: {text.strip()}")
        logger.debug(
            "_get_transcript: %d items → %d lines", len(list(session.history.items)), len(lines)
        )
        return "\n".join(lines)
    except Exception as e:
        logger.debug("_get_transcript error: %s", e)
        return ""


async def _get_recording_url(room_name: str) -> str:
    try:
        await asyncio.sleep(1)
        client = livekit_api.LiveKitAPI(
            url=os.getenv("LIVEKIT_URL", ""),
            api_key=os.getenv("LIVEKIT_API_KEY", ""),
            api_secret=os.getenv("LIVEKIT_API_SECRET", ""),
        )
        egresses = await client.egress.list_egress(
            livekit_api.ListEgressRequest(room_name=room_name)
        )
        for e in egresses.items:
            for f in getattr(e, "file_results", []):
                if getattr(f, "download_url", ""):
                    return f.download_url
        return ""
    except Exception as e:
        logger.debug("Room: %s | No recording URL: %s", room_name, e)
        return ""


# ── Backend notifications ─────────────────────────────────────────────────────


async def _notify_backend(
    room_name: str,
    transcript: str,
    duration: int = 0,
    outcome: str = "",
    recording_url: str = "",
    language: str = "",
) -> None:
    payload = {
        "room_name": room_name,
        "event": "call_ended",
        "transcript": transcript,
        "duration_seconds": duration,
    }
    if outcome:
        payload["outcome"] = outcome
    if recording_url:
        payload["recording_url"] = recording_url
    if language:
        payload["language_used"] = language
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{BACKEND_URL}/calling/livekit-event", json=payload, headers=_INTERNAL_HEADERS
            )
        logger.info("Room: %s | Backend notified (outbound)", room_name)
    except Exception as e:
        logger.warning("Room: %s | Failed to notify backend: %s", room_name, e)


async def _notify_inbound_backend(
    room_name: str,
    caller_phone: str,
    lead_id: int,
    transcript: str,
    duration: int,
    recording_url: str = "",
) -> None:
    payload = {
        "room_name": room_name,
        "caller_phone": caller_phone,
        "lead_id": lead_id,
        "transcript": transcript,
        "duration_seconds": duration,
        "recording_url": recording_url,
    }
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{BACKEND_URL}/calling/inbound-event", json=payload, headers=_INTERNAL_HEADERS
            )
        logger.info("Room: %s | Backend notified (inbound)", room_name)
    except Exception as e:
        logger.warning("Room: %s | Failed to notify inbound backend: %s", room_name, e)


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            api_key=os.getenv("LIVEKIT_API_KEY", ""),
            api_secret=os.getenv("LIVEKIT_API_SECRET", ""),
            ws_url=os.getenv("LIVEKIT_URL", ""),
        )
    )
