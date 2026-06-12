"""
Demo seed script  clears old test records and inserts 5 realistic demo entries.
Run from the backend/ directory:
    python seed_demo.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from datetime import datetime, timedelta
from core.database import SessionLocal
from models.models.lead    import Lead, LeadStatus
from models.models.call    import CallLog
from models.models.appointment import Appointment

db = SessionLocal()

#  1. Delete ALL existing leads, call logs, appointments 
print("Clearing old records...")
db.query(Appointment).delete()
db.query(CallLog).delete()
db.query(Lead).delete()
db.commit()
print("  OK Cleared")

#  2. Insert 5 demo leads 

now = datetime.utcnow()

LEADS = [
    dict(full_name="Priya Sharma",    phone="+919876543210", city="Mumbai",    inquiry_type="IVF / IUI",         consultation_type="online",   status=LeadStatus.appointment_booked, call_count=1),
    dict(full_name="Meena Patel",     phone="+918765432109", city="Agra",      inquiry_type="PCOS / PCOD",       consultation_type="in_clinic", status=LeadStatus.appointment_booked, call_count=1),
    dict(full_name="Sunita Verma",    phone="+917654321098", city="Delhi",     inquiry_type="Hormonal Health",   consultation_type="online",   status=LeadStatus.interested,         call_count=1),
    dict(full_name="Rekha Singh",     phone="+916543210987", city="Pune",      inquiry_type="Pregnancy",         consultation_type="online",   status=LeadStatus.appointment_booked, call_count=1),
    dict(full_name="Kavita Joshi",    phone="+915432109876", city="Jaipur",    inquiry_type="Gynaecological",   consultation_type="in_clinic", status=LeadStatus.not_interested,     call_count=1),
]

leads = []
for l in LEADS:
    lead = Lead(**l)
    db.add(lead)
    db.flush()
    leads.append(lead)

db.commit()
print(f"  OK Inserted {len(leads)} leads")

#  3. Insert call logs 

TRANSCRIPTS = [
    "assistant: Namaste! Kya main Priya ji se baat kar sakti hoon?\nuser: Haan, main Priya bol rahi hoon.\nassistant: Priya ji, aapne IVF ke baare mein enquiry ki thi. Kya aap doctor se online consult karna chahti hain?\nuser: Haan bilkul, mujhe consult karna hai.\nassistant: Bahut achha! Maine aapka appointment kal shaam 5 baje book kar diya hai. Confirmation WhatsApp pe aayega.\nuser: Thank you!",
    "assistant: Namaste! Meena ji se baat ho sakti hai?\nuser: Ji haan.\nassistant: Aapne PCOS ke liye in-clinic appointment ke baare mein poochha tha. Agra clinic mein kab aa sakti hain?\nuser: Agli week Monday ko aa sakti hoon.\nassistant: Theek hai, Monday 10 baje ka slot confirm kar diya. Clinic ka address WhatsApp pe bhejte hain.\nuser: Shukriya.",
    "assistant: Namaste Sunita ji! Aapne hormonal health ke baare mein inquiry ki thi.\nuser: Haan, mujhe kuch issues hain.\nassistant: Koi baat nahi, Dr. Sonal Gupta aapki poori help karengi. Kya aap online consult karna chahti hain?\nuser: Haan interested hoon, baad mein call karein please.\nassistant: Zaroor, hum aapko call karenge. Apna convenient time batayein.",
    "assistant: Namaste Rekha ji! IVF treatment ke baare mein baat karni thi.\nuser: Haan, main bahut pareshan hoon. Help chahiye.\nassistant: Hum samajhte hain. Dr. Sonal Gupta ne kai patients ki help ki hai. Online consult karein?\nuser: Haan please, jaldi appointment chahiye.\nassistant: Appointment book kar diya  kal subah 11 baje. WhatsApp pe details aayenge.\nuser: Bahut bahut shukriya!",
    "assistant: Namaste Kavita ji! Gynaecological concern ke baare mein inquiry thi.\nuser: Haan, lekin abhi interest nahi hai.\nassistant: Koi baat nahi Kavita ji. Agar kabhi zaroorat ho toh hum yahan hain.\nuser: Theek hai.\nassistant: Dhanyawad. Apna khayal rakhein.",
]

OUTCOMES   = ["appointment_booked", "appointment_booked", "callback_requested", "appointment_booked", "not_interested"]
DURATIONS  = [185, 210, 95, 172, 60]
LANGUAGES  = ["hindi", "hindi", "hindi", "hindi", "hindi"]

call_logs = []
for i, lead in enumerate(leads):
    started = now - timedelta(hours=3 - i * 0.3)
    cl = CallLog(
        lead_id=lead.id,
        vapi_call_id=f"demo-call-{i+1}-{lead.id}",
        vapi_assistant_id="livekit-demo",
        phone=lead.phone,
        attempt_number=1,
        status="completed",
        outcome=OUTCOMES[i],
        language_used=LANGUAGES[i],
        duration_seconds=DURATIONS[i],
        transcript=TRANSCRIPTS[i],
        summary=None,
        started_at=started,
        ended_at=started + timedelta(seconds=DURATIONS[i]),
    )
    db.add(cl)
    call_logs.append(cl)

db.commit()
print(f"   Inserted {len(call_logs)} call logs")

#  4. Insert appointments 
# Lead 0  Priya: Online, booked
# Lead 1  Meena: In-Clinic, confirmed
# Lead 2  Sunita: No appointment (interested / callback)
# Lead 3  Rekha: Online, rescheduled (booked with note)
# Lead 4  Kavita: No appointment (not interested)

tomorrow     = now + timedelta(days=1)
next_monday  = now + timedelta(days=(7 - now.weekday()) % 7 or 7)
next_week    = now + timedelta(days=5)

APPTS = [
    dict(lead=leads[0], date=tomorrow.replace(hour=17, minute=0, second=0),   atype="online",   status="booked",    notes=None),
    dict(lead=leads[1], date=next_monday.replace(hour=10, minute=0, second=0), atype="in_clinic", status="confirmed", notes="Patient confirmed via WhatsApp"),
    dict(lead=leads[3], date=next_week.replace(hour=11, minute=0, second=0),   atype="online",   status="booked",    notes="Rescheduled from original slot  patient requested morning"),
]

for a in APPTS:
    lead = a["lead"]
    appt = Appointment(
        lead_id=lead.id,
        patient_name=lead.full_name,
        phone=lead.phone,
        appointment_date=a["date"],
        appointment_type=a["atype"],
        inquiry_type=lead.inquiry_type,
        status=a["status"],
        notes=a["notes"],
        booked_at=now - timedelta(hours=1),
    )
    db.add(appt)

db.commit()
print(f"   Inserted {len(APPTS)} appointments")

db.close()
print("\nDONE  Demo data ready! Open the app to see the results.")
print("\nDemo leads:")
print("  1. Priya Sharma     Appointment booked (Online, tomorrow 5 PM)")
print("  2. Meena Patel      Appointment confirmed (In-Clinic, next Monday)")
print("  3. Sunita Verma     Interested, callback requested (no appointment)")
print("  4. Rekha Singh      Appointment booked (Online, rescheduled)")
print("  5. Kavita Joshi     Not interested (no appointment)")

