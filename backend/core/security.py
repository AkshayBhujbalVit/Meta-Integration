from datetime import UTC, datetime, timedelta

import bcrypt
from jose import JWTError, jwt

from core.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, SECRET_KEY


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(data: dict) -> str:
    payload = data.copy()
    expire = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload.update({"exp": expire})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def create_appointment_token(appt_id: int, action: str, expires_hours: int = 72) -> str:
    """Create a short-lived signed token for patient self-service cancel/reschedule."""
    expire = datetime.now(UTC) + timedelta(hours=expires_hours)
    return jwt.encode(
        {"appt_id": appt_id, "action": action, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


def decode_appointment_token(token: str) -> dict | None:
    try:
        data = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if "appt_id" not in data or "action" not in data:
            return None
        return data
    except JWTError:
        return None
