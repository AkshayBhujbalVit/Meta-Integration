import re
import pandas as pd
from datetime import datetime
from sqlalchemy.orm import Session

from models.models.lead import Lead, LeadUpload, LeadStatus


# ── Column name mapping (CSV header → our field) ─────────────────────────────

COLUMN_MAP = {
    "id": "fb_lead_id",
    "created_time": "fb_created_time",
    "ad_name": "ad_name",
    "campaign_name": "campaign_name",
    "form_name": "form_name",
    "platform": "platform",
    "are_you_a_working_professional?": "is_working_professional",
    "what_kind_of_fertility_support_are_you_looking_for?": "inquiry_type",
    "have_you_already_done_any_fertility_tests?": "tests_done",
    "describe_the_problem_in_few_words.": "problem_description",
    "email": "email",
    "full_name": "full_name",
    "phone": "phone",
    "city": "city",
}


# ── Phone number cleaner ──────────────────────────────────────────────────────

def clean_phone(raw: str) -> str | None:
    if not raw or str(raw).strip().lower() in ("", "nan", "none"):
        return None

    phone = str(raw).strip()

    # Remove p: prefix
    phone = re.sub(r"^p:", "", phone, flags=re.IGNORECASE)

    # Remove all spaces, dashes, dots inside
    phone = re.sub(r"[\s\-\.]", "", phone)

    # Keep only digits and leading +
    phone = re.sub(r"[^\d+]", "", phone)

    if not phone:
        return None

    # Already has +91
    if phone.startswith("+91") and len(phone) == 13:
        return phone

    # Has 91 prefix without +
    if phone.startswith("91") and len(phone) == 12:
        return "+" + phone

    # 10-digit number — add +91
    if len(phone) == 10 and phone.isdigit():
        return "+91" + phone

    # If longer (e.g. country code already in digits but malformed) try last 10
    if len(phone) > 10:
        last10 = phone[-10:]
        if last10.isdigit():
            return "+91" + last10

    return None


# ── Main parser ───────────────────────────────────────────────────────────────

def parse_and_import_csv(file_path: str, file_name: str, db: Session) -> dict:
    """
    Parse a Facebook leads CSV, clean data, handle duplicates, save to DB.
    Returns summary: {total, imported, duplicates, merged, failed}
    """

    # Meta exports are UTF-16 LE TSV — try that first, then utf-8 fallbacks
    df = None
    for enc in ("utf-16", "utf-16-le", "utf-8-sig", "utf-8"):
        for sep in ("\t", ","):
            try:
                tmp = pd.read_csv(file_path, sep=sep, encoding=enc, dtype=str)
                if tmp.shape[1] > 1:
                    df = tmp
                    break
            except Exception:
                continue
        if df is not None:
            break

    if df is None:
        raise ValueError("Could not read file — unsupported encoding or format")

    # Normalize column names
    df.columns = [c.strip().lower() for c in df.columns]

    total = len(df)
    imported = 0
    duplicates = 0
    merged = 0
    failed = 0

    # Create upload record
    upload = LeadUpload(file_name=file_name, total_rows=total)
    db.add(upload)
    db.flush()  # get upload.id

    for _, row in df.iterrows():
        try:
            # Map columns
            data = {}
            for csv_col, field in COLUMN_MAP.items():
                val = row.get(csv_col, "")
                data[field] = str(val).strip() if val and str(val).strip().lower() not in ("nan", "none", "") else None

            # Clean phone
            raw_phone = data.get("phone")
            phone = clean_phone(raw_phone)
            if not phone:
                failed += 1
                continue
            data["phone"] = phone

            # Clean fb_lead_id (strip l: prefix)
            if data.get("fb_lead_id"):
                data["fb_lead_id"] = re.sub(r"^l:", "", data["fb_lead_id"])

            # Parse fb_created_time
            if data.get("fb_created_time"):
                try:
                    data["fb_created_time"] = datetime.fromisoformat(
                        data["fb_created_time"].replace("+05:30", "+05:30")
                    )
                except Exception:
                    data["fb_created_time"] = None

            inquiry_type = data.get("inquiry_type")

            # ── Duplicate check ───────────────────────────────────────────────
            existing = db.query(Lead).filter(Lead.phone == phone).first()

            if existing:
                if existing.inquiry_type == inquiry_type:
                    # Same phone + same inquiry → pure duplicate, skip
                    existing.is_duplicate = True
                    duplicates += 1
                else:
                    # Same phone + different inquiry → merge into existing lead
                    if not existing.second_inquiry_type:
                        existing.second_inquiry_type = inquiry_type
                        existing.second_problem_description = data.get("problem_description")
                        db.flush()
                    merged += 1
                continue

            # ── Consultation type: Agra = in-clinic, all others = online ─────
            city_raw = (data.get("city") or "").strip()
            city_val = city_raw.lower()
            consultation_type = "in_clinic" if city_val == "agra" else "online"

            from routers.leads import normalise_city

            # ── New lead ──────────────────────────────────────────────────────
            lead = Lead(
                upload_id=upload.id,
                full_name=data.get("full_name"),
                phone=phone,
                email=data.get("email"),
                city=normalise_city(city_raw),
                fb_lead_id=data.get("fb_lead_id"),
                ad_name=data.get("ad_name"),
                campaign_name=data.get("campaign_name"),
                form_name=data.get("form_name"),
                platform=data.get("platform"),
                inquiry_type=inquiry_type,
                problem_description=data.get("problem_description"),
                tests_done=data.get("tests_done"),
                is_working_professional=data.get("is_working_professional"),
                fb_created_time=data.get("fb_created_time"),
                consultation_type=consultation_type,
                status=LeadStatus.new,
            )
            db.add(lead)
            imported += 1

        except Exception as e:
            failed += 1
            continue

    # Update upload record
    upload.imported = imported
    upload.duplicates = duplicates + merged
    upload.failed = failed
    db.commit()

    return {
        "upload_id": upload.id,
        "file_name": file_name,
        "total": total,
        "imported": imported,
        "duplicates": duplicates,
        "merged": merged,
        "failed": failed,
    }
