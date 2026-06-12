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
from models.models.base import Base
from models.models.knowledge_base import KBSection
from models.models.settings import CalendarConfig, CallingConfig, ClinicSettings, MessagingConfig

db_url = URL.create(
    drivername="postgresql",
    username=os.getenv("POSTGRES_USER"),
    password=os.getenv("POSTGRES_PASSWORD"),
    host=os.getenv("POSTGRES_HOST", "localhost"),
    port=int(os.getenv("POSTGRES_PORT", "5432")),
    database=os.getenv("POSTGRES_DB"),
)

engine = create_engine(db_url)
Session = sessionmaker(bind=engine)


def enable_extensions():
    """Enable PostgreSQL extensions needed by the app."""
    from sqlalchemy import text

    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    print("Extensions enabled (pgvector)")


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
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS agent_name VARCHAR(100) DEFAULT 'Dr. Sonal Gupta AI Caller'",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS llm_model VARCHAR(50) DEFAULT 'gpt-4o'",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS voice_provider VARCHAR(30) DEFAULT '11labs'",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS voice_id VARCHAR(100)",
        "ALTER TABLE call_log ADD COLUMN IF NOT EXISTS recording_url VARCHAR(500)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS phone_number_id VARCHAR(100)",
        "ALTER TABLE calling_config ADD COLUMN IF NOT EXISTS auto_call_on_upload BOOLEAN DEFAULT FALSE",
        # Fix city — was incorrectly set to Pune, clinic is in Agra
        "UPDATE clinic_settings SET city = 'Agra' WHERE city = 'Pune'",
        "UPDATE clinic_settings SET clinic_name = 'Dr. Sonal Gupta Clinic' WHERE clinic_name = 'Dr. Sonal Gupta Clinic'",
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
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception as e:
                print(f"  Migration note: {e}")
    print("Column migration done")


def seed_admin():
    import bcrypt

    db = Session()
    try:
        existing = db.query(Admin).filter_by(email="admin@sonalgupta.com").first()
        if existing:
            print("Admin already exists: admin@sonalgupta.com")
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
            email="admin@sonalgupta.com",
            password_hash=pw_hash,
            full_name="Dr. Sonal Gupta",
            phone="+91-XXXXXXXXXX",
            is_active=True,
        )
        db.add(admin)
        db.commit()
        print("Created admin: admin@sonalgupta.com (password from ADMIN_INITIAL_PASSWORD)")
    except Exception as e:
        db.rollback()
        print(f"  Error creating admin: {e}")
    finally:
        db.close()


def seed_kb_sections():
    db = Session()
    try:
        existing = db.query(KBSection).count()
        if existing > 0:
            print(f"KB sections already exist ({existing} sections)")
            return

        sections = [
            {
                "name": "About Doctor",
                "slug": "about_doctor",
                "sort_order": 1,
                "description": "Doctor profile, qualifications and experience",
            },
            {
                "name": "Clinic Info",
                "slug": "clinic_info",
                "sort_order": 2,
                "description": "Address, timings, contact, online consultation process",
            },
            {
                "name": "Online Consultation",
                "slug": "online_consultation",
                "sort_order": 3,
                "description": "How online consultation works, fees, booking process",
            },
            {
                "name": "IVF / IUI",
                "slug": "ivf_iui",
                "sort_order": 4,
                "description": "IVF and IUI treatment information",
            },
            {
                "name": "PCOS / PCOD",
                "slug": "pcos_pcod",
                "sort_order": 5,
                "description": "PCOS and PCOD management",
            },
            {
                "name": "Hormonal Health",
                "slug": "hormonal_health",
                "sort_order": 6,
                "description": "Hormonal health and related treatments",
            },
            {
                "name": "Gynaecological Concerns",
                "slug": "gynaecological",
                "sort_order": 7,
                "description": "General gynaecological concerns and treatments",
            },
            {
                "name": "Second Opinion",
                "slug": "second_opinion",
                "sort_order": 8,
                "description": "Second opinion consultation process",
            },
            {
                "name": "Pregnancy Consultation",
                "slug": "pregnancy",
                "sort_order": 9,
                "description": "Pregnancy care, high-risk pregnancy, and antenatal consultation",
            },
            {
                "name": "Menopause",
                "slug": "menopause",
                "sort_order": 10,
                "description": "Menopause symptoms, management and treatment",
            },
            {
                "name": "Charges & Fees",
                "slug": "charges_fees",
                "sort_order": 11,
                "description": "Consultation fees and pricing",
            },
            {
                "name": "FAQs",
                "slug": "faqs",
                "sort_order": 12,
                "description": "Frequently asked questions",
            },
        ]

        for s in sections:
            db.add(KBSection(**s))
        db.commit()
        print(f"Created {len(sections)} KB sections")
    except Exception as e:
        db.rollback()
        print(f"  Error creating KB sections: {e}")
    finally:
        db.close()


def seed_default_settings():
    db = Session()
    try:
        if not db.query(ClinicSettings).first():
            db.add(
                ClinicSettings(
                    clinic_name="Dr. Sonal Gupta Clinic",
                    doctor_name="Dr. Sonal Gupta",
                    city="Agra",
                    address="Ojas Hospital, Kamla Nagar, Agra, Uttar Pradesh",
                    website="https://www.drsonalgupta.in",
                    timings="Mon–Sat: 10:00 AM–1:00 PM and 5:00 PM–8:00 PM",
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
    db = Session()
    try:
        from models.models.knowledge_base import KBItem, KBSection

        existing = db.query(KBItem).count()
        if existing > 0:
            print(f"KB items already exist ({existing} items)")
            return

        def section_id(slug):
            s = db.query(KBSection).filter_by(slug=slug).first()
            return s.id if s else None

        items = [
            # ── About Doctor ────────────────────────────────────────────────
            (
                section_id("about_doctor"),
                "Who is Dr. Sonal Gupta?",
                "Dr. Sonal Gupta is a Women's Health and Infertility Specialist based in Agra, Uttar Pradesh. She has over 21 years of experience and practices at Ojas Hospital, Kamla Nagar, Agra. She specialises in IVF, IUI, PCOS, hormonal health, gynaecological surgeries, and high-risk pregnancy. She offers both in-clinic visits at Agra and online consultations for patients across India.",
            ),
            (
                section_id("about_doctor"),
                "What are Dr. Sonal Gupta's specialisations?",
                "Dr. Sonal Gupta specialises in fertility treatment (IVF, IUI), PCOS and PCOD management, hormonal health, gynaecological concerns including endometriosis and fibroids, high-risk pregnancy, menopause management, and second opinion consultations for complex cases.",
            ),
            (
                section_id("about_doctor"),
                "How many years of experience does she have?",
                "Dr. Sonal Gupta has over 21 years of experience treating women with infertility, hormonal issues, and gynaecological conditions. Her patients come from across India — including Pune, Mumbai, Delhi, and other cities — many of whom consult her online.",
            ),
            # ── Clinic Info ─────────────────────────────────────────────────
            (
                section_id("clinic_info"),
                "Where is the clinic located?",
                "Dr. Sonal Gupta's clinic is at Ojas Hospital, Kamla Nagar, Agra, Uttar Pradesh. For patients who cannot travel, she also offers online video consultations. Check drsonalgupta.in for directions and more details.",
            ),
            (
                section_id("clinic_info"),
                "What are the clinic timings?",
                "The clinic is open Monday to Saturday. Morning slot: 10:00 AM to 1:00 PM. Evening slot: 5:00 PM to 8:00 PM. Closed on Sundays and public holidays. For online consultations, timings may differ — please confirm when booking.",
            ),
            (
                section_id("clinic_info"),
                "What is the clinic contact number?",
                "For appointments and inquiries please call or WhatsApp the clinic directly or visit drsonalgupta.in. The team will help you schedule at a time that is convenient for you.",
            ),
            # ── Online Consultation ─────────────────────────────────────────
            (
                section_id("online_consultation"),
                "How does online consultation work?",
                "Online consultation with Dr. Sonal Gupta is done via video call. After booking you will receive a link or contact details. You can share your reports, describe your symptoms, and get expert advice from the comfort of your home.",
            ),
            (
                section_id("online_consultation"),
                "What is the online consultation fee?",
                "The online consultation fee is affordable and designed to make specialist care accessible. Please contact the clinic for the current fee as it may be updated.",
            ),
            (
                section_id("online_consultation"),
                "Can I share my reports during online consultation?",
                "Yes, you can share your medical reports, test results, scans, and any other documents via WhatsApp or email before the consultation so Dr. Sonal can review them in advance.",
            ),
            (
                section_id("online_consultation"),
                "How do I book an online consultation?",
                "You can book an online consultation by calling the clinic, WhatsApp messaging, or by filling the inquiry form. Our team will confirm the date and time for your video consultation.",
            ),
            # ── IVF / IUI ───────────────────────────────────────────────────
            (
                section_id("ivf_iui"),
                "What is IVF and how does it work?",
                "IVF stands for In Vitro Fertilisation. It is a fertility treatment where eggs are collected from the woman and fertilised with sperm in a laboratory. The resulting embryo is then placed in the uterus. Dr. Sonal Gupta guides patients through each step of the IVF process with care and support.",
            ),
            (
                section_id("ivf_iui"),
                "What is IUI treatment?",
                "IUI stands for Intrauterine Insemination. It is a simpler fertility procedure where washed and concentrated sperm is placed directly into the uterus during ovulation. It is often recommended before IVF as a less invasive option.",
            ),
            (
                section_id("ivf_iui"),
                "Who is IVF suitable for?",
                "IVF may be suitable for women with blocked fallopian tubes, severe endometriosis, low egg quality, unexplained infertility, or those who have had multiple failed IUI cycles. Dr. Sonal Gupta will assess your individual case and recommend the best treatment.",
            ),
            (
                section_id("ivf_iui"),
                "How many IVF cycles are usually needed?",
                "This varies for each patient depending on age, egg quality, and other factors. Some patients succeed in the first cycle while others may need two or three. Dr. Sonal Gupta will discuss realistic expectations during your consultation.",
            ),
            (
                section_id("ivf_iui"),
                "I have had failed IVF cycles. Can Dr. Sonal help?",
                "Yes, Dr. Sonal Gupta has experience with patients who have had previous failed IVF cycles. She can review your history, identify possible reasons for failure, and suggest the best next steps. A second opinion consultation is highly recommended.",
            ),
            # ── PCOS / PCOD ─────────────────────────────────────────────────
            (
                section_id("pcos_pcod"),
                "What is PCOS and PCOD?",
                "PCOS stands for Polycystic Ovary Syndrome and PCOD stands for Polycystic Ovarian Disease. Both involve hormonal imbalance causing irregular periods, cysts on ovaries, and difficulty conceiving. Dr. Sonal Gupta provides personalised treatment plans for PCOS and PCOD management.",
            ),
            (
                section_id("pcos_pcod"),
                "Can women with PCOS get pregnant?",
                "Yes, many women with PCOS can conceive with proper treatment and lifestyle guidance. Dr. Sonal Gupta helps patients manage PCOS through medication, diet advice, and fertility treatments when needed.",
            ),
            (
                section_id("pcos_pcod"),
                "What are the symptoms of PCOS?",
                "Common symptoms include irregular or delayed periods, weight gain, excess hair growth, acne, and difficulty conceiving. If you experience these, a consultation with Dr. Sonal Gupta is recommended for proper diagnosis and treatment.",
            ),
            # ── Hormonal Health ─────────────────────────────────────────────
            (
                section_id("hormonal_health"),
                "What hormonal issues does Dr. Sonal treat?",
                "Dr. Sonal Gupta treats a range of hormonal issues including thyroid disorders affecting fertility, low AMH levels, high prolactin, hormonal imbalance causing irregular cycles, and conditions related to estrogen and progesterone imbalance.",
            ),
            (
                section_id("hormonal_health"),
                "What is AMH and why is it important for fertility?",
                "AMH stands for Anti-Mullerian Hormone. It is a blood test that gives an indication of your ovarian reserve, meaning how many eggs you have. Low AMH means lower egg reserve. Dr. Sonal can guide you on treatment options even with low AMH.",
            ),
            # ── Gynaecological Concerns ─────────────────────────────────────
            (
                section_id("gynaecological"),
                "What gynaecological conditions does Dr. Sonal treat?",
                "Dr. Sonal Gupta treats endometriosis, fibroids, dermoid cysts, ovarian cysts, recurrent miscarriages, irregular periods, and other gynaecological concerns that may affect fertility or general women's health.",
            ),
            (
                section_id("gynaecological"),
                "I have endometriosis. Can I still conceive?",
                "Yes, many women with endometriosis can conceive. Dr. Sonal Gupta will evaluate the severity of your condition and recommend whether natural conception, IUI, or IVF is the best path for you.",
            ),
            (
                section_id("gynaecological"),
                "What is a follicular study?",
                "A follicular study is a series of ultrasound scans done during your menstrual cycle to track the growth of egg follicles. It helps determine the best time for conception or treatment. Dr. Sonal uses follicular studies to monitor and guide fertility treatment.",
            ),
            # ── Pregnancy Consultation ──────────────────────────────────────
            (
                section_id("pregnancy"),
                "Does Dr. Sonal Gupta provide pregnancy consultation?",
                "Yes, Dr. Sonal Gupta provides pregnancy consultation including antenatal care, high-risk pregnancy management, and guidance throughout the pregnancy journey. She supports patients from conception to delivery planning.",
            ),
            (
                section_id("pregnancy"),
                "What is high-risk pregnancy and how can Dr. Sonal help?",
                "A high-risk pregnancy involves conditions that may affect the health of the mother or baby, such as advanced maternal age, PCOS, thyroid issues, or previous pregnancy complications. Dr. Sonal Gupta provides specialised monitoring and care for high-risk pregnancies.",
            ),
            (
                section_id("pregnancy"),
                "I had a miscarriage before. Can Dr. Sonal help with my next pregnancy?",
                "Yes, Dr. Sonal Gupta has experience managing patients with previous miscarriages or recurrent pregnancy loss. She will investigate the cause and provide appropriate support and treatment to help you have a healthy pregnancy.",
            ),
            # ── Menopause ───────────────────────────────────────────────────
            (
                section_id("menopause"),
                "What is menopause and when does it happen?",
                "Menopause is when a woman's menstrual periods stop permanently, usually around age 45 to 55. It is caused by a natural decline in reproductive hormones. Dr. Sonal Gupta helps women manage the symptoms and transition smoothly through this phase.",
            ),
            (
                section_id("menopause"),
                "What are the symptoms of menopause?",
                "Common symptoms include hot flashes, night sweats, mood changes, sleep problems, irregular periods, vaginal dryness, and reduced energy. Dr. Sonal Gupta can assess your symptoms and recommend hormonal or non-hormonal treatment options.",
            ),
            (
                section_id("menopause"),
                "Can Dr. Sonal help with early menopause or premature ovarian insufficiency?",
                "Yes, Dr. Sonal Gupta treats women experiencing early menopause or premature ovarian insufficiency. She will evaluate hormonal levels and discuss treatment options including hormone replacement therapy and fertility preservation where applicable.",
            ),
            # ── Second Opinion ──────────────────────────────────────────────
            (
                section_id("second_opinion"),
                "Can I get a second opinion from Dr. Sonal?",
                "Yes, Dr. Sonal Gupta offers second opinion consultations. If you are unsure about a diagnosis or treatment plan given by another doctor, you can share your reports and get Dr. Sonal's expert view. This is especially helpful for complex fertility cases.",
            ),
            (
                section_id("second_opinion"),
                "What documents should I bring for a second opinion?",
                "Please bring all your previous medical reports including blood tests, hormone tests, semen analysis, ultrasound scans, and any treatment history. You can share these in advance via WhatsApp for the online consultation.",
            ),
            # ── Charges & Fees ──────────────────────────────────────────────
            (
                section_id("charges_fees"),
                "What is the consultation fee?",
                "Dr. Sonal Gupta's consultation fee is kept reasonable to make specialist care accessible. For the latest fee details please contact the clinic. Online consultation fees may differ from in-clinic fees.",
            ),
            (
                section_id("charges_fees"),
                "Are there any hidden charges?",
                "No, Dr. Sonal Gupta's clinic maintains full transparency on fees. Any tests or procedures recommended will be explained clearly along with the associated costs before proceeding.",
            ),
            # ── FAQs ────────────────────────────────────────────────────────
            (
                section_id("faqs"),
                "I am trying to conceive but not succeeding. What should I do?",
                "The first step is a thorough evaluation. Dr. Sonal Gupta will assess both partners if applicable, review your cycle, run necessary tests, and create a personalised plan. Early consultation improves chances of success significantly.",
            ),
            (
                section_id("faqs"),
                "Do both husband and wife need to come for consultation?",
                "It is beneficial for both partners to be evaluated, especially if there is a fertility concern. However, the initial consultation can be done by one partner. Dr. Sonal will advise if partner testing is needed.",
            ),
            (
                section_id("faqs"),
                "Is the consultation confidential?",
                "Yes, all consultations with Dr. Sonal Gupta are completely confidential. Patient privacy is a top priority.",
            ),
            (
                section_id("faqs"),
                "Do you provide treatment for patients outside Agra?",
                "Yes, Dr. Sonal Gupta offers online video consultations for patients across India. Many patients from Pune, Mumbai, Delhi, Nagpur, and other cities consult online and manage their treatment from home. You just need to share your reports on WhatsApp before the call.",
            ),
            (
                section_id("faqs"),
                "Can I consult if I am above 40 years of age?",
                "Yes, Dr. Sonal Gupta consultates women of all ages. While fertility does decline with age, there are still options available. An honest assessment of your situation and the best possible path forward will be discussed during consultation.",
            ),
        ]

        count = 0
        for section_id_val, question, answer in items:
            if section_id_val:
                db.add(
                    KBItem(
                        section_id=section_id_val,
                        question=question,
                        answer=answer,
                        sort_order=count,
                    )
                )
                count += 1

        db.commit()
        print(f"Created {count} KB items across all sections")
    except Exception as e:
        db.rollback()
        print(f"  Error creating KB items: {e}")
    finally:
        db.close()


if __name__ == "__main__":
    print("=" * 55)
    print("  Dr. Sonal Gupta AI — Database Initialization")
    print("=" * 55)
    print(f"  Host: {os.getenv('POSTGRES_HOST')}")
    print(f"  DB:   {os.getenv('POSTGRES_DB')}")
    print()

    enable_extensions()
    create_tables()
    add_missing_columns()
    seed_admin()
    seed_kb_sections()
    seed_default_settings()
    seed_kb_items()

    print()
    print("Done! You can now run:")
    print("  uvicorn main:app --host 0.0.0.0 --port 8006")
    print()
    print("Login: admin@sonalgupta.com (use the password you set in ADMIN_INITIAL_PASSWORD)")
    print("=" * 55)
