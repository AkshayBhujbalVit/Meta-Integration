"""
Calendar service — pluggable provider dispatch.

Supported providers:
  google  — Google Calendar (service account JSON)
  caldav  — Universal CalDav (Apple iCloud, Outlook 365, Nextcloud, Fastmail, …)
  local   — No external sync; appointments tracked in-app only
"""

import json
from datetime import UTC, timedelta

from sqlalchemy.orm import Session

from models.models.settings import CalendarConfig


def _provider(db: Session) -> str:
    cfg = db.query(CalendarConfig).first()
    p = (getattr(cfg, "calendar_provider", None) or "google").lower()
    # Apple iCloud and Outlook both use the CalDav protocol
    return "caldav" if p in ("apple", "outlook") else p


# ── Google Calendar ───────────────────────────────────────────────────────────


def _get_google_service(db: Session):
    """Return (google_service, calendar_id) or (None, None)."""
    cfg = db.query(CalendarConfig).first()
    if not cfg or not cfg.is_active or not cfg.credentials_json:
        return None, None
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        from core.encryption import decrypt

        creds_data = json.loads(decrypt(cfg.credentials_json))
        credentials = service_account.Credentials.from_service_account_info(
            creds_data,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        service = build("calendar", "v3", credentials=credentials, cache_discovery=False)
        return service, cfg.calendar_id or "primary"
    except Exception as e:
        print(f"[Calendar/Google] Service init failed: {e}")
        return None, None


def _google_create(service, calendar_id: str, appt) -> str | None:
    appt_label = "In-Person" if appt.appointment_type == "in_person" else "Online"
    desc_lines = [
        f"Lead: {appt.patient_name or '—'}",
        f"Phone: {appt.phone}",
        f"Type: {appt_label}",
    ]
    if appt.inquiry_type:
        desc_lines.append(f"Inquiry: {appt.inquiry_type}")
    if appt.notes:
        desc_lines.append(f"Notes: {appt.notes}")
    event = {
        "summary": f"{appt_label} – {appt.patient_name or 'Patient'}",
        "description": "\n".join(desc_lines),
        "start": {"dateTime": appt.appointment_date.isoformat(), "timeZone": "Asia/Kolkata"},
        "end": {
            "dateTime": (appt.appointment_date + timedelta(minutes=30)).isoformat(),
            "timeZone": "Asia/Kolkata",
        },
    }
    try:
        result = service.events().insert(calendarId=calendar_id, body=event).execute()
        event_id = result.get("id")
        print(f"[Calendar/Google] Created event {event_id} for appointment {appt.id}")
        return event_id
    except Exception as e:
        print(f"[Calendar/Google] Failed to create event: {e}")
        return None


# ── CalDav ────────────────────────────────────────────────────────────────────


def _get_caldav_calendar(db: Session):
    """Return (client, calendar) or (None, None)."""
    cfg = db.query(CalendarConfig).first()
    if not cfg or not cfg.is_active or not cfg.caldav_url:
        return None, None
    try:
        import caldav

        from core.encryption import decrypt

        client = caldav.DAVClient(
            url=cfg.caldav_url,
            username=cfg.caldav_username or "",
            password=decrypt(cfg.caldav_password) or "",
        )
        principal = client.principal()
        calendars = principal.calendars()
        if not calendars:
            print("[Calendar/CalDav] No calendars found on server")
            return None, None

        target = calendars[0]
        if cfg.calendar_id and cfg.calendar_id not in ("primary", ""):
            for cal in calendars:
                if cfg.calendar_id.lower() in str(cal.url).lower():
                    target = cal
                    break
        return client, target
    except ImportError:
        print("[Calendar/CalDav] caldav library not installed — run: pip install caldav icalendar")
        return None, None
    except Exception as e:
        print(f"[Calendar/CalDav] Init failed: {e}")
        return None, None


def _caldav_create(calendar, appt) -> str | None:
    try:
        import uuid

        from icalendar import Calendar as iCal
        from icalendar import Event

        uid = str(uuid.uuid4())
        appt_label = "Online" if "online" in (appt.appointment_type or "").lower() else "In-Person"

        cal = iCal()
        cal.add("prodid", "-//Vidushi Infotech AI//EN")
        cal.add("version", "2.0")
        event = Event()
        event.add("uid", uid)
        event.add("summary", f"{appt_label} – {appt.patient_name or 'Patient'}")
        event.add("dtstart", appt.appointment_date.replace(tzinfo=UTC))
        event.add("dtend", (appt.appointment_date + timedelta(minutes=30)).replace(tzinfo=UTC))
        desc = "\n".join(
            filter(
                None,
                [
                    f"Lead: {appt.patient_name or '—'}",
                    f"Phone: {appt.phone}",
                    f"Inquiry: {appt.inquiry_type}" if appt.inquiry_type else None,
                    f"Notes: {appt.notes}" if appt.notes else None,
                ],
            )
        )
        event.add("description", desc)
        cal.add_component(event)
        calendar.save_event(cal.to_ical().decode("utf-8"))
        print(f"[Calendar/CalDav] Created event {uid}")
        return uid
    except Exception as e:
        print(f"[Calendar/CalDav] Failed to create event: {e}")
        return None


def _caldav_delete(calendar, uid: str) -> bool:
    try:
        event = calendar.event_by_uid(uid)
        event.delete()
        print(f"[Calendar/CalDav] Deleted event {uid}")
        return True
    except Exception as e:
        print(f"[Calendar/CalDav] Failed to delete event {uid}: {e}")
        return False


def _caldav_update(calendar, uid: str, appt) -> bool:
    try:
        from icalendar import Calendar as iCal

        caldav_event = calendar.event_by_uid(uid)
        appt_label = "Online" if "online" in (appt.appointment_type or "").lower() else "In-Person"

        cal = iCal.from_ical(caldav_event.data)
        for component in cal.walk("VEVENT"):
            component["summary"] = f"{appt_label} – {appt.patient_name or 'Patient'}"
            component.pop("dtstart", None)
            component.pop("dtend", None)
            component.add("dtstart", appt.appointment_date.replace(tzinfo=UTC))
            component.add(
                "dtend", (appt.appointment_date + timedelta(minutes=30)).replace(tzinfo=UTC)
            )

        caldav_event.data = cal.to_ical().decode("utf-8")
        caldav_event.save()
        return True
    except Exception as e:
        print(f"[Calendar/CalDav] Failed to update event {uid}: {e}")
        return False


def test_caldav_connection(url: str, username: str, password: str) -> dict:
    """Validate CalDav credentials and return found calendars."""
    try:
        import caldav

        client = caldav.DAVClient(url=url, username=username, password=password)
        calendars = client.principal().calendars()
        names = [c.name for c in calendars if c.name] or ["(unnamed)"]
        return {"success": True, "calendar_names": names}
    except ImportError:
        return {
            "success": False,
            "error": "caldav library not installed — run: pip install caldav icalendar",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# ── Public API ────────────────────────────────────────────────────────────────


def create_calendar_event(appt, db: Session) -> str | None:
    """Create a calendar event for an appointment. Returns event_id or None."""
    p = _provider(db)

    if p == "caldav":
        _, calendar = _get_caldav_calendar(db)
        if not calendar:
            return None
        return _caldav_create(calendar, appt)

    if p == "local":
        return None

    # Default: Google Calendar
    service, calendar_id = _get_google_service(db)
    if not service:
        return None
    return _google_create(service, calendar_id, appt)


def delete_calendar_event(event_id: str, db: Session) -> bool:
    """Delete a calendar event."""
    if not event_id:
        return False
    p = _provider(db)

    if p == "caldav":
        _, calendar = _get_caldav_calendar(db)
        if not calendar:
            return False
        return _caldav_delete(calendar, event_id)

    if p == "local":
        return False

    # Google
    service, calendar_id = _get_google_service(db)
    if not service:
        return False
    try:
        service.events().delete(calendarId=calendar_id, eventId=event_id).execute()
        print(f"[Calendar/Google] Deleted event {event_id}")
        return True
    except Exception as e:
        print(f"[Calendar/Google] Failed to delete event {event_id}: {e}")
        return False


def update_calendar_event(event_id: str, appt, db: Session) -> bool:
    """Update a calendar event when appointment is rescheduled."""
    if not event_id:
        return False
    p = _provider(db)

    if p == "caldav":
        _, calendar = _get_caldav_calendar(db)
        if not calendar:
            return False
        return _caldav_update(calendar, event_id, appt)

    if p == "local":
        return False

    # Google
    service, calendar_id = _get_google_service(db)
    if not service:
        return False
    appt_label = "In-Person" if appt.appointment_type == "in_person" else "Online"
    try:
        event = service.events().get(calendarId=calendar_id, eventId=event_id).execute()
        event["summary"] = f"{appt_label} – {appt.patient_name or 'Patient'}"
        event["start"] = {"dateTime": appt.appointment_date.isoformat(), "timeZone": "Asia/Kolkata"}
        event["end"] = {
            "dateTime": (appt.appointment_date + timedelta(minutes=30)).isoformat(),
            "timeZone": "Asia/Kolkata",
        }
        service.events().update(calendarId=calendar_id, eventId=event_id, body=event).execute()
        return True
    except Exception as e:
        print(f"[Calendar/Google] Failed to update event {event_id}: {e}")
        return False


def test_calendar_connection(credentials_json: str, calendar_id: str) -> dict:
    """Validate Google Calendar service account credentials."""
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        creds_data = json.loads(credentials_json)
        credentials = service_account.Credentials.from_service_account_info(
            creds_data,
            scopes=["https://www.googleapis.com/auth/calendar"],
        )
        service = build("calendar", "v3", credentials=credentials, cache_discovery=False)
        cal = service.calendars().get(calendarId=calendar_id or "primary").execute()
        return {"success": True, "calendar_name": cal.get("summary", "Unknown")}
    except json.JSONDecodeError:
        return {
            "success": False,
            "error": "Invalid JSON — paste the full service account key file contents",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
