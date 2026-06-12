from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import datetime

from core.database import get_db
from core.security import verify_password, create_access_token, hash_password
from core.dependencies import get_current_admin
from models.models.admin import Admin, UserSession
from models.models.system import AdminLoginLog

router = APIRouter(prefix="/auth", tags=["Auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


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

    admin = db.query(Admin).filter_by(email=payload.email).first()

    if not admin or not verify_password(payload.password, admin.password_hash):
        _log_login(db, admin.id if admin else None, payload.email, ip, False, "invalid_credentials")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not admin.is_active:
        _log_login(db, admin.id, payload.email, ip, False, "account_inactive")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is inactive")

    token = create_access_token({"sub": str(admin.id), "email": admin.email})

    db.add(UserSession(admin_id=admin.id, token=token, is_active=True))
    _log_login(db, admin.id, payload.email, ip, True)

    return {
        "access_token": token,
        "token_type": "bearer",
        "admin": {
            "id": admin.id,
            "email": admin.email,
            "full_name": admin.full_name,
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
