"""
Analytics router — powers the enhanced dashboard reporting.

Endpoints:
  GET /analytics/overview   — aggregated KPIs
  GET /analytics/funnel     — conversion funnel (leads → called → interested → booked → attended)
  GET /analytics/heatmap    — call answer rate by hour of day
  GET /analytics/trends     — weekly / monthly time-series (calls, bookings)
  GET /analytics/export     — Excel / CSV bulk export of all leads + call outcomes
"""

import io
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from models.models.lead import Lead, LeadStatus
from models.models.call import CallLog
from models.models.appointment import Appointment
from models.models.client import Client
from models.models.campaign import Campaign, CampaignStatus

logger = logging.getLogger("analytics")

router = APIRouter(prefix="/analytics", tags=["Analytics"])


# ── Overview KPIs ─────────────────────────────────────────────────────────────

@router.get("/overview")
def overview(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    """High-level KPIs for the dashboard header."""
    total_leads = db.query(Lead).filter(Lead.is_duplicate == False).count()
    total_calls = db.query(CallLog).count()
    outbound_calls = db.query(CallLog).filter(CallLog.direction == "outbound").count()
    inbound_calls = db.query(CallLog).filter(CallLog.direction == "inbound").count()

    answered = db.query(CallLog).filter(
        CallLog.status == "completed",
        CallLog.duration_seconds > 0,
    ).count()

    interested = db.query(Lead).filter(Lead.status == LeadStatus.interested).count()
    booked = db.query(Lead).filter(Lead.status == LeadStatus.appointment_booked).count()
    not_interested = db.query(Lead).filter(Lead.status == LeadStatus.not_interested).count()
    no_answer = db.query(Lead).filter(Lead.status == LeadStatus.no_answer).count()
    callback = db.query(Lead).filter(Lead.status == LeadStatus.callback_requested).count()

    total_appts = db.query(Appointment).filter(
        Appointment.status.in_(["booked", "confirmed", "completed"])
    ).count()
    attended_appts = db.query(Appointment).filter(
        Appointment.status == "completed"
    ).count()

    avg_duration = db.query(func.avg(CallLog.duration_seconds)).filter(
        CallLog.duration_seconds > 0
    ).scalar() or 0

    # Leads called at least once
    called_leads = db.query(Lead).filter(Lead.call_count > 0, Lead.is_duplicate == False).count()
    answer_rate = round((answered / total_calls * 100), 1) if total_calls > 0 else 0
    booking_rate = round((booked / called_leads * 100), 1) if called_leads > 0 else 0
    attendance_rate = round((attended_appts / total_appts * 100), 1) if total_appts > 0 else 0

    # WhatsApp messages (if table exists)
    try:
        from models.models.whatsapp_log import WhatsAppMessage
        wa_inbound = db.query(WhatsAppMessage).filter(WhatsAppMessage.direction == "inbound").count()
        wa_outbound = db.query(WhatsAppMessage).filter(WhatsAppMessage.direction == "outbound").count()
    except Exception:
        wa_inbound = wa_outbound = 0

    return {
        "total_leads": total_leads,
        "total_calls": total_calls,
        "outbound_calls": outbound_calls,
        "inbound_calls": inbound_calls,
        "answered_calls": answered,
        "answer_rate_pct": answer_rate,
        "leads_called": called_leads,
        "interested": interested,
        "booked": booked,
        "not_interested": not_interested,
        "no_answer": no_answer,
        "callback_requested": callback,
        "booking_rate_pct": booking_rate,
        "total_appointments": total_appts,
        "attended_appointments": attended_appts,
        "attendance_rate_pct": attendance_rate,
        "avg_call_duration_seconds": round(avg_duration),
        "whatsapp_inbound": wa_inbound,
        "whatsapp_outbound": wa_outbound,
    }


# ── Conversion funnel ─────────────────────────────────────────────────────────

@router.get("/funnel")
def funnel(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    """
    Conversion funnel: Total Leads → Called → Answered → Interested → Booked → Attended.
    Each step is a count and % of the previous step.
    """
    total = db.query(Lead).filter(Lead.is_duplicate == False).count()
    called = db.query(Lead).filter(
        Lead.call_count > 0, Lead.is_duplicate == False
    ).count()
    answered = db.query(CallLog).filter(
        CallLog.status == "completed", CallLog.duration_seconds > 10
    ).distinct(CallLog.lead_id).count()
    interested = db.query(Lead).filter(
        Lead.status.in_([LeadStatus.interested, LeadStatus.appointment_booked])
    ).count()
    booked = db.query(Lead).filter(Lead.status == LeadStatus.appointment_booked).count()
    attended = db.query(Appointment).filter(Appointment.status == "completed").count()

    def pct(num, denom):
        return round(num / denom * 100, 1) if denom else 0

    return {
        "steps": [
            {"label": "Total Leads", "count": total, "pct_of_prev": 100},
            {"label": "Called", "count": called, "pct_of_prev": pct(called, total)},
            {"label": "Answered (>10s)", "count": answered, "pct_of_prev": pct(answered, called)},
            {"label": "Interested", "count": interested, "pct_of_prev": pct(interested, answered)},
            {"label": "Appointment Booked", "count": booked, "pct_of_prev": pct(booked, interested)},
            {"label": "Attended", "count": attended, "pct_of_prev": pct(attended, booked)},
        ]
    }


# ── Call time heatmap ─────────────────────────────────────────────────────────

@router.get("/heatmap")
def heatmap(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    """
    Call answer-rate grouped by hour of day (IST).
    Returns 24 buckets — each with total calls and answered calls.
    """
    logs = db.query(CallLog).filter(CallLog.started_at != None).all()

    total_by_hour: dict[int, int] = defaultdict(int)
    answered_by_hour: dict[int, int] = defaultdict(int)

    for log in logs:
        if log.started_at is None:
            continue
        # Convert UTC → IST (+5:30)
        ist_hour = (log.started_at + timedelta(hours=5, minutes=30)).hour
        total_by_hour[ist_hour] += 1
        if log.status == "completed" and (log.duration_seconds or 0) > 10:
            answered_by_hour[ist_hour] += 1

    buckets = []
    for h in range(24):
        total = total_by_hour[h]
        answered = answered_by_hour[h]
        buckets.append({
            "hour": h,
            "label": f"{h:02d}:00",
            "total_calls": total,
            "answered": answered,
            "answer_rate": round(answered / total * 100, 1) if total else 0,
        })

    return {"heatmap": buckets}


# ── Trends (time series) ──────────────────────────────────────────────────────

@router.get("/trends")
def trends(
    period: str = Query("30d", description="7d | 30d | 90d"),
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    """
    Daily time-series for the chosen period:
    - Leads added per day
    - Calls made per day
    - Appointments booked per day
    """
    days_map = {"7d": 7, "30d": 30, "90d": 90}
    days = days_map.get(period, 30)
    since = datetime.utcnow() - timedelta(days=days)

    # Daily leads
    leads_raw = (
        db.query(
            func.date(Lead.created_at).label("day"),
            func.count(Lead.id).label("count"),
        )
        .filter(Lead.created_at >= since, Lead.is_duplicate == False)
        .group_by(func.date(Lead.created_at))
        .all()
    )

    # Daily calls
    calls_raw = (
        db.query(
            func.date(CallLog.started_at).label("day"),
            func.count(CallLog.id).label("count"),
        )
        .filter(CallLog.started_at >= since)
        .group_by(func.date(CallLog.started_at))
        .all()
    )

    # Daily appointments booked
    appts_raw = (
        db.query(
            func.date(Appointment.booked_at).label("day"),
            func.count(Appointment.id).label("count"),
        )
        .filter(
            Appointment.booked_at >= since,
            Appointment.status.in_(["booked", "confirmed", "completed"]),
        )
        .group_by(func.date(Appointment.booked_at))
        .all()
    )

    def _to_dict(rows) -> dict:
        return {str(r.day): r.count for r in rows}

    leads_map = _to_dict(leads_raw)
    calls_map = _to_dict(calls_raw)
    appts_map = _to_dict(appts_raw)

    # Build a complete daily series
    series = []
    for i in range(days):
        day = (since + timedelta(days=i + 1)).date()
        key = str(day)
        series.append({
            "date": key,
            "leads": leads_map.get(key, 0),
            "calls": calls_map.get(key, 0),
            "appointments": appts_map.get(key, 0),
        })

    return {"period": period, "series": series}


# ── Export (Excel / CSV) ──────────────────────────────────────────────────────

@router.get("/export")
def export(
    format: str = Query("excel", description="excel | csv"),
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    """
    Export all leads with their latest call outcome and appointment info
    as an Excel workbook or CSV file.
    """
    leads = (
        db.query(Lead)
        .filter(Lead.is_duplicate == False)
        .order_by(Lead.created_at.desc())
        .all()
    )

    # Build rows
    rows = []
    for lead in leads:
        latest_call = (
            db.query(CallLog)
            .filter(CallLog.lead_id == lead.id)
            .order_by(CallLog.created_at.desc())
            .first()
        )
        latest_appt = (
            db.query(Appointment)
            .filter(Appointment.lead_id == lead.id)
            .order_by(Appointment.booked_at.desc())
            .first()
        )
        rows.append({
            "ID": lead.id,
            "Name": lead.full_name or "",
            "Phone": lead.phone,
            "City": lead.city or "",
            "Email": lead.email or "",
            "Inquiry Type": lead.inquiry_type or "",
            "Consultation Type": lead.consultation_type or "",
            "Status": lead.status,
            "Call Count": lead.call_count or 0,
            "Last Called": lead.last_called_at.strftime("%Y-%m-%d %H:%M") if lead.last_called_at else "",
            "Last Outcome": latest_call.outcome if latest_call else "",
            "Last Call Duration (s)": latest_call.duration_seconds if latest_call else "",
            "Appointment Date": latest_appt.appointment_date.strftime("%Y-%m-%d %H:%M") if latest_appt else "",
            "Appointment Type": latest_appt.appointment_type if latest_appt else "",
            "Appointment Status": latest_appt.status if latest_appt else "",
            "Created At": lead.created_at.strftime("%Y-%m-%d") if lead.created_at else "",
        })

    if format == "csv":
        import csv
        buf = io.StringIO()
        if rows:
            writer = csv.DictWriter(buf, fieldnames=rows[0].keys())
            writer.writeheader()
            writer.writerows(rows)
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=leads_export.csv"},
        )

    # Excel export via openpyxl
    try:
        import openpyxl
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Leads"

        header_fill = PatternFill("solid", fgColor="7C3AED")
        header_font = Font(bold=True, color="FFFFFF")

        if rows:
            headers = list(rows[0].keys())
            for col_idx, header in enumerate(headers, 1):
                cell = ws.cell(row=1, column=col_idx, value=header)
                cell.fill = header_fill
                cell.font = header_font
                cell.alignment = Alignment(horizontal="center")

            for row_idx, row in enumerate(rows, 2):
                for col_idx, value in enumerate(row.values(), 1):
                    ws.cell(row=row_idx, column=col_idx, value=value)

            # Auto-width
            for col_idx, _ in enumerate(headers, 1):
                col_letter = get_column_letter(col_idx)
                ws.column_dimensions[col_letter].auto_size = True

        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": "attachment; filename=leads_export.xlsx"},
        )

    except ImportError:
        raise HTTPException(
            status_code=500,
            detail="openpyxl not installed. Run: pip install openpyxl",
        )


# ── Inquiry type breakdown ────────────────────────────────────────────────────

@router.get("/inquiry-breakdown")
def inquiry_breakdown(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    """Count leads per inquiry type — for bar chart."""
    rows = (
        db.query(Lead.inquiry_type, func.count(Lead.id).label("count"))
        .filter(Lead.is_duplicate == False, Lead.inquiry_type != None)
        .group_by(Lead.inquiry_type)
        .order_by(func.count(Lead.id).desc())
        .all()
    )
    return [{"inquiry_type": r.inquiry_type, "count": r.count} for r in rows]


# ── City breakdown ────────────────────────────────────────────────────────────

@router.get("/city-breakdown")
def city_breakdown(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    """Count leads per city — for table/chart."""
    rows = (
        db.query(Lead.city, func.count(Lead.id).label("count"))
        .filter(Lead.is_duplicate == False, Lead.city != None, Lead.city != "")
        .group_by(Lead.city)
        .order_by(func.count(Lead.id).desc())
        .limit(15)
        .all()
    )
    return [{"city": r.city, "count": r.count} for r in rows]


# ── Multi-tenant dashboard overview ──────────────────────────────────────────

@router.get("/dashboard-overview")
def dashboard_overview(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    """KPIs + per-client breakdown for the multi-tenant dashboard."""
    today = datetime.utcnow().date()
    today_start = datetime(today.year, today.month, today.day)

    total_clients = db.query(Client).filter(Client.is_active == True).count()
    active_campaigns = db.query(Campaign).filter(Campaign.status == CampaignStatus.active.value).count()
    total_leads = db.query(Lead).filter(Lead.is_duplicate == False).count()
    new_leads_today = db.query(Lead).filter(Lead.created_at >= today_start, Lead.is_duplicate == False).count()
    calls_today = db.query(CallLog).filter(CallLog.created_at >= today_start).count()
    booked_today = db.query(Lead).filter(
        Lead.status == LeadStatus.appointment_booked,
        Lead.updated_at >= today_start,
    ).count()
    total_booked = db.query(Lead).filter(Lead.status == LeadStatus.appointment_booked).count()
    total_called = db.query(Lead).filter(Lead.call_count > 0, Lead.is_duplicate == False).count()

    # Platform breakdown — leads + called + booked per source
    platforms_raw = (
        db.query(Lead.source_platform, func.count(Lead.id).label("total"))
        .filter(Lead.is_duplicate == False, Lead.source_platform.isnot(None))
        .group_by(Lead.source_platform)
        .all()
    )
    by_platform = []
    for row in platforms_raw:
        p = row.source_platform
        called_p = db.query(Lead).filter(
            Lead.source_platform == p, Lead.call_count > 0, Lead.is_duplicate == False
        ).count()
        booked_p = db.query(Lead).filter(
            Lead.source_platform == p, Lead.status == LeadStatus.appointment_booked
        ).count()
        by_platform.append({
            "platform": p,
            "total": row.total,
            "called": called_p,
            "booked": booked_p,
            "conv_pct": round(booked_p / row.total * 100, 1) if row.total else 0,
        })
    by_platform.sort(key=lambda x: x["total"], reverse=True)

    # Active campaigns with stats
    active_campaign_rows = (
        db.query(Campaign)
        .filter(Campaign.status == CampaignStatus.active.value, Campaign.is_active == True)
        .order_by(Campaign.id.desc())
        .limit(10)
        .all()
    )
    client_map_full = {c.id: c for c in db.query(Client).all()}
    active_campaigns_list = []
    for camp in active_campaign_rows:
        c_leads = db.query(Lead).filter(Lead.campaign_id == camp.id, Lead.is_duplicate == False).count()
        c_called = db.query(Lead).filter(Lead.campaign_id == camp.id, Lead.call_count > 0).count()
        c_booked = db.query(Lead).filter(
            Lead.campaign_id == camp.id, Lead.status == LeadStatus.appointment_booked
        ).count()
        client_obj = client_map_full.get(camp.client_id)
        active_campaigns_list.append({
            "id": camp.id,
            "name": camp.name,
            "client_name": client_obj.name if client_obj else "—",
            "caller_phone": camp.caller_phone_number,
            "total_leads": c_leads,
            "called": c_called,
            "booked": c_booked,
            "conv_pct": round(c_booked / c_leads * 100, 1) if c_leads else 0,
        })

    # Per-client breakdown
    client_rows = db.query(Client).filter(Client.is_active == True).all()
    client_stats = []
    for client in client_rows:
        c_leads = db.query(Lead).filter(Lead.client_id == client.id, Lead.is_duplicate == False).count()
        c_booked = db.query(Lead).filter(
            Lead.client_id == client.id, Lead.status == LeadStatus.appointment_booked,
        ).count()
        c_active = db.query(Campaign).filter(
            Campaign.client_id == client.id, Campaign.status == CampaignStatus.active.value
        ).count()
        client_stats.append({
            "id": client.id,
            "name": client.name,
            "business_type": client.business_type,
            "total_leads": c_leads,
            "booked": c_booked,
            "active_campaigns": c_active,
        })
    client_stats.sort(key=lambda x: x["total_leads"], reverse=True)

    # Recent leads feed
    recent_leads = (
        db.query(Lead)
        .filter(Lead.is_duplicate == False)
        .order_by(Lead.created_at.desc())
        .limit(15)
        .all()
    )
    campaign_map = {c.id: c.name for c in db.query(Campaign).all()}
    recent = [
        {
            "id": l.id,
            "full_name": l.full_name,
            "phone": l.phone,
            "status": l.status,
            "source_platform": l.source_platform or "manual",
            "client_name": client_map_full[l.client_id].name if l.client_id and l.client_id in client_map_full else "—",
            "campaign_name": campaign_map.get(l.campaign_id, "—") if l.campaign_id else "—",
            "created_at": l.created_at.isoformat() if l.created_at else None,
        }
        for l in recent_leads
    ]

    return {
        "total_clients": total_clients,
        "active_campaigns": active_campaigns,
        "total_leads": total_leads,
        "new_leads_today": new_leads_today,
        "calls_today": calls_today,
        "booked_today": booked_today,
        "total_booked": total_booked,
        "total_called": total_called,
        "by_platform": by_platform,
        "active_campaigns_list": active_campaigns_list,
        "clients": client_stats[:10],
        "recent_leads": recent,
    }
