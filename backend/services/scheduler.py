"""
Retry scheduler — automatically re-calls no_answer and callback_requested leads
within the configured gap (default: retry 1 after 4h, retry 2 after 24h, retry 3 after 48h).

Started as a background task when FastAPI starts (see main.py).
Uses APScheduler AsyncIOScheduler so it shares the event loop with FastAPI.
"""

import logging
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

logger = logging.getLogger("scheduler")

# One shared scheduler instance imported by main.py
scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")


async def _retry_missed_calls() -> None:
    """
    Find leads that:
    - Are in no_answer or callback_requested state
    - Have been called fewer times than max_retries (from CallingConfig)
    - Were last called at least retry_gap_hours ago
    - Are within the current calling hours window
    Then queue them for a retry call (sequentially, max 3 at a time).
    """
    from core.database import SessionLocal
    from models.models.lead import Lead, LeadStatus
    from models.models.settings import CallingConfig
    from services.calling_service import trigger_call, within_calling_hours

    db = SessionLocal()
    try:
        cfg = db.query(CallingConfig).filter(CallingConfig.is_active == True).first()
        if not cfg:
            return

        if not within_calling_hours(cfg):
            logger.debug("Outside calling hours — skipping retry run")
            return

        max_retries = cfg.max_retries or 3
        retry_gap_hours = cfg.retry_gap_hours or 4
        cutoff = datetime.utcnow() - timedelta(hours=retry_gap_hours)

        # Leads eligible for retry
        retry_leads = (
            db.query(Lead)
            .filter(
                Lead.status.in_([LeadStatus.no_answer, LeadStatus.callback_requested]),
                Lead.call_count < max_retries,
                Lead.last_called_at != None,
                Lead.last_called_at < cutoff,
            )
            .order_by(Lead.last_called_at.asc())
            .limit(3)  # process at most 3 per cycle to avoid flooding
            .all()
        )

        if not retry_leads:
            logger.debug("No leads eligible for retry")
            return

        logger.info("Retry scheduler: %d leads eligible", len(retry_leads))

        # Mark all as call_scheduled, trigger the first one
        for lead in retry_leads:
            lead.status = LeadStatus.call_scheduled
        db.commit()

        first = retry_leads[0]
        try:
            await trigger_call(first, db)
            logger.info("Retry call triggered for lead %d (%s)", first.id, first.full_name)
        except Exception as e:
            first.status = LeadStatus.no_answer  # revert so we try again later
            db.commit()
            logger.warning("Retry call failed for lead %d: %s", first.id, e)

    except Exception as e:
        logger.error("Retry scheduler error: %s", e)
    finally:
        db.close()


async def _send_daily_reminders() -> None:
    """
    Send day-before appointment reminders at 09:00 IST every morning.
    Finds appointments scheduled for tomorrow and sends WhatsApp/SMS reminder.
    """
    from core.database import SessionLocal
    from models.models.appointment import Appointment
    from models.models.lead import Lead
    from services.messaging_service import send_appointment_reminder

    db = SessionLocal()
    try:
        tomorrow_start = datetime.utcnow().replace(hour=18, minute=30, second=0, microsecond=0)
        tomorrow_end = tomorrow_start + timedelta(days=1)

        appointments = (
            db.query(Appointment)
            .filter(
                Appointment.appointment_date >= tomorrow_start,
                Appointment.appointment_date < tomorrow_end,
                Appointment.status.in_(["booked", "confirmed"]),
            )
            .all()
        )

        if not appointments:
            return

        logger.info("Daily reminders: sending for %d appointments", len(appointments))

        for appt in appointments:
            lead = db.query(Lead).filter(Lead.id == appt.lead_id).first()
            if not lead:
                continue
            try:
                lang = lead.call_language or "hindi"
                send_appointment_reminder(lead, appt, lang, db)
                logger.info("Reminder sent for appointment %d (lead %d)", appt.id, lead.id)
            except Exception as e:
                logger.warning("Reminder failed for appointment %d: %s", appt.id, e)

    except Exception as e:
        logger.error("Daily reminder scheduler error: %s", e)
    finally:
        db.close()


def start_scheduler() -> None:
    """Register all jobs and start the scheduler. Called from main.py lifespan."""
    # Retry missed calls every 15 minutes
    scheduler.add_job(
        _retry_missed_calls,
        trigger=IntervalTrigger(minutes=15),
        id="retry_missed_calls",
        name="Retry no-answer leads",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=60,
    )

    # Daily reminders at 09:00 IST (03:30 UTC)
    from apscheduler.triggers.cron import CronTrigger
    scheduler.add_job(
        _send_daily_reminders,
        trigger=CronTrigger(hour=3, minute=30, timezone="UTC"),
        id="daily_reminders",
        name="Send day-before appointment reminders",
        replace_existing=True,
        max_instances=1,
    )

    scheduler.start()
    logger.info("Scheduler started — retry job every 15 min, reminders at 09:00 IST")


def stop_scheduler() -> None:
    """Gracefully stop the scheduler. Called from main.py lifespan shutdown."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
