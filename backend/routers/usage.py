from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from models.models.call import CallLog
from models.models.lead import Lead
from models.models.sms import SMSLog
from models.models.whatsapp_log import WhatsAppMessage

router = APIRouter(prefix="/usage", tags=["Usage"])

# Estimated rates (USD) — LiveKit + Gemini Live + Twilio
RATE_CALL_PER_MIN = 0.07    # LiveKit SIP (~$0.013/min) + Gemini Live (~$0.06/min combined)
RATE_SMS_PER_MSG  = 0.008   # Twilio SMS (~$0.0075/msg)
RATE_WA_PER_MSG   = 0.005   # Twilio / Meta Cloud WhatsApp


def _since(period: str) -> Optional[datetime]:
    days = {"7d": 7, "30d": 30, "90d": 90}.get(period)
    return datetime.utcnow() - timedelta(days=days) if days else None


@router.get("/overview")
def usage_overview(
    period: str = "30d",
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    since = _since(period)

    # ── Calls ──────────────────────────────────────────────────────────────────
    cq = db.query(CallLog)
    if since:
        cq = cq.filter(CallLog.created_at >= since)
    total_calls = cq.count()

    dur_q = db.query(func.sum(CallLog.duration_seconds))
    if since:
        dur_q = dur_q.filter(CallLog.created_at >= since)
    total_seconds = dur_q.scalar() or 0
    total_minutes = round(total_seconds / 60, 1)

    outcome_q = db.query(CallLog.outcome, func.count(CallLog.id)).group_by(CallLog.outcome)
    if since:
        outcome_q = outcome_q.filter(CallLog.created_at >= since)

    dir_q = db.query(CallLog.direction, func.count(CallLog.id)).group_by(CallLog.direction)
    if since:
        dir_q = dir_q.filter(CallLog.created_at >= since)

    # ── SMS ────────────────────────────────────────────────────────────────────
    sq = db.query(SMSLog)
    if since:
        sq = sq.filter(SMSLog.sent_at >= since)
    total_sms = sq.count()

    sms_type_q = db.query(SMSLog.sms_type, func.count(SMSLog.id)).group_by(SMSLog.sms_type)
    if since:
        sms_type_q = sms_type_q.filter(SMSLog.sent_at >= since)

    sms_status_q = db.query(SMSLog.status, func.count(SMSLog.id)).group_by(SMSLog.status)
    if since:
        sms_status_q = sms_status_q.filter(SMSLog.sent_at >= since)

    sms_lang_q = db.query(SMSLog.language, func.count(SMSLog.id)).group_by(SMSLog.language)
    if since:
        sms_lang_q = sms_lang_q.filter(SMSLog.sent_at >= since)

    # ── WhatsApp ───────────────────────────────────────────────────────────────
    wq = db.query(WhatsAppMessage)
    if since:
        wq = wq.filter(WhatsAppMessage.created_at >= since)
    total_wa = wq.count()

    wa_in_q = db.query(func.count(WhatsAppMessage.id)).filter(WhatsAppMessage.direction == "inbound")
    if since:
        wa_in_q = wa_in_q.filter(WhatsAppMessage.created_at >= since)
    wa_inbound = wa_in_q.scalar() or 0

    wa_unique_q = db.query(func.count(func.distinct(WhatsAppMessage.phone)))
    if since:
        wa_unique_q = wa_unique_q.filter(WhatsAppMessage.created_at >= since)
    wa_unique = wa_unique_q.scalar() or 0

    # ── Leads intake ───────────────────────────────────────────────────────────
    lq = db.query(Lead)
    if since:
        lq = lq.filter(Lead.created_at >= since)
    total_leads = lq.count()

    leads_by_source_q = (
        db.query(Lead.source_platform, func.count(Lead.id))
        .group_by(Lead.source_platform)
    )
    if since:
        leads_by_source_q = leads_by_source_q.filter(Lead.created_at >= since)

    leads_by_status_q = (
        db.query(Lead.status, func.count(Lead.id))
        .group_by(Lead.status)
    )
    if since:
        leads_by_status_q = leads_by_status_q.filter(Lead.created_at >= since)

    called_leads_q = db.query(func.count(Lead.id)).filter(Lead.call_count > 0)
    if since:
        called_leads_q = called_leads_q.filter(Lead.created_at >= since)
    called_leads = called_leads_q.scalar() or 0

    # ── Cost estimates ─────────────────────────────────────────────────────────
    est_call = round(total_minutes * RATE_CALL_PER_MIN, 2)
    est_sms  = round(total_sms * RATE_SMS_PER_MSG, 2)
    est_wa   = round(total_wa  * RATE_WA_PER_MSG,  2)

    return {
        "period": period,
        "leads": {
            "total": total_leads,
            "called": called_leads,
            "by_source": {(k or "manual"): v for k, v in leads_by_source_q.all()},
            "by_status": {(k or "new"): v for k, v in leads_by_status_q.all()},
        },
        "calls": {
            "total": total_calls,
            "total_minutes": total_minutes,
            "by_outcome": {(k or "unknown"): v for k, v in outcome_q.all()},
            "by_direction": {(k or "outbound"): v for k, v in dir_q.all()},
            "est_cost_usd": est_call,
        },
        "sms": {
            "total": total_sms,
            "by_type": {(k or "other"): v for k, v in sms_type_q.all()},
            "by_status": {(k or "unknown"): v for k, v in sms_status_q.all()},
            "by_language": {(k or "unknown"): v for k, v in sms_lang_q.all()},
            "est_cost_usd": est_sms,
        },
        "whatsapp": {
            "total": total_wa,
            "inbound": wa_inbound,
            "outbound": total_wa - wa_inbound,
            "unique_leads": wa_unique,
            "est_cost_usd": est_wa,
        },
        "cost_summary": {
            "calls_usd": est_call,
            "sms_usd": est_sms,
            "whatsapp_usd": est_wa,
            "total_usd": round(est_call + est_sms + est_wa, 2),
        },
        "rates": {
            "call_per_min_usd": RATE_CALL_PER_MIN,
            "sms_per_msg_usd": RATE_SMS_PER_MSG,
            "whatsapp_per_msg_usd": RATE_WA_PER_MSG,
        },
    }
