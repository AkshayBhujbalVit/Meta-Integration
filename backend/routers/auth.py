from collections import defaultdict
from datetime import datetime
from time import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from core.database import get_db
from core.dependencies import get_current_admin
from core.security import create_access_token, hash_password, verify_password
from models.models.admin import Admin, UserSession
from models.models.client import Client
from models.models.system import AdminLoginLog

router = APIRouter(prefix="/auth", tags=["Auth"])

# ── Brute-force protection (in-memory, per-IP) ────────────────────────────────
_login_attempts: dict[str, list[float]] = defaultdict(list)
_RATE_WINDOW_SECS = 900   # 15-minute sliding window
_RATE_MAX_ATTEMPTS = 10   # max attempts before lockout


def _check_rate_limit(ip: str) -> None:
    now = time()
    # Evict attempts outside the window
    _login_attempts[ip] = [t for t in _login_attempts[ip] if now - t < _RATE_WINDOW_SECS]
    if len(_login_attempts[ip]) >= _RATE_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again in 15 minutes.",
            headers={"Retry-After": "900"},
        )
    _login_attempts[ip].append(now)


def _clear_rate_limit(ip: str) -> None:
    _login_attempts.pop(ip, None)


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class SignupRequest(BaseModel):
    business_name: str        # doctor's clinic/practice name -> Client.name
    full_name: str            # doctor's own name -> Admin.full_name
    email: str
    password: str
    phone: str | None = None
    business_type: str | None = None


def _log_login(db: Session, admin_id: int | None, email: str, ip: str, success: bool, reason: str | None = None):
    db.add(AdminLoginLog(
        admin_id=admin_id,
        email=email,
        ip_address=ip,
        success=success,
        failure_reason=reason,
    ))
    db.commit()


@router.post("/login")
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    ip = request.client.host if request.client else "unknown"

    # Rate-limit before touching the DB to avoid timing oracle
    _check_rate_limit(ip)

    admin = db.query(Admin).filter_by(email=payload.email).first()

    if not admin or not verify_password(payload.password, admin.password_hash):
        _log_login(db, admin.id if admin else None, payload.email, ip, False, "invalid_credentials")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not admin.is_active:
        _log_login(db, admin.id, payload.email, ip, False, "account_inactive")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    # Successful login — clear the rate-limit counter for this IP
    _clear_rate_limit(ip)

    token = create_access_token({"sub": str(admin.id), "email": admin.email, "client_id": admin.client_id})

    db.add(UserSession(admin_id=admin.id, token=token, is_active=True))
    _log_login(db, admin.id, payload.email, ip, True)

    return {
        "access_token": token,
        "token_type": "bearer",
        "admin": {
            "id": admin.id,
            "email": admin.email,
            "full_name": admin.full_name,
            "client_id": admin.client_id,
        },
    }


@router.post("/signup", status_code=201)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    """Self-service doctor signup: creates a new Client (tenant) and its first Admin together."""
    if db.query(Admin).filter_by(email=payload.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    client = Client(
        name=payload.business_name,
        business_type=payload.business_type,
        phone=payload.phone,
        email=payload.email,
    )
    db.add(client)
    db.flush()  # assign client.id before creating the admin row

    admin = Admin(
        email=payload.email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name,
        phone=payload.phone,
        client_id=client.id,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    token = create_access_token({"sub": str(admin.id), "email": admin.email, "client_id": admin.client_id})
    db.add(UserSession(admin_id=admin.id, token=token, is_active=True))
    db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "admin": {
            "id": admin.id,
            "email": admin.email,
            "full_name": admin.full_name,
            "client_id": admin.client_id,
        },
    }


@router.post("/logout")
def logout(
    credentials=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    token_str = credentials  # admin object returned by dependency
    # Mark all sessions for this admin inactive
    db.query(UserSession).filter_by(admin_id=credentials.id, is_active=True).update({"is_active": False})
    db.commit()
    return {"message": "Logged out successfully"}


@router.get("/me")
def me(admin: Admin = Depends(get_current_admin)):
    return {
        "id": admin.id,
        "email": admin.email,
        "full_name": admin.full_name,
        "phone": admin.phone,
        "is_active": admin.is_active,
        "client_id": admin.client_id,
    }


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if not verify_password(payload.current_password, admin.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")

    admin.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"message": "Password changed successfully"}
