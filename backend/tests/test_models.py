"""
Database model smoke tests — runs against in-memory SQLite (no Postgres needed).
"""

from core.security import hash_password
from models.models.admin import Admin
from models.models.settings import CalendarConfig, CallingConfig, MessagingConfig


class TestAdminModel:
    def test_create_admin(self, db):
        admin = Admin(
            email="test@example.com",
            password_hash=hash_password("test-pass"),
            full_name="Test Admin",
        )
        db.add(admin)
        db.flush()
        assert admin.id is not None

    def test_admin_email_unique(self, db):
        import pytest
        from sqlalchemy.exc import IntegrityError

        db.add(Admin(email="dup@example.com", password_hash="h"))
        db.flush()
        db.add(Admin(email="dup@example.com", password_hash="h"))
        with pytest.raises(IntegrityError):
            db.flush()
        db.rollback()


class TestSettingsModels:
    def test_calling_config_defaults(self, db):
        cfg = CallingConfig()
        db.add(cfg)
        db.flush()
        assert cfg.id is not None

    def test_messaging_config_defaults(self, db):
        cfg = MessagingConfig()
        db.add(cfg)
        db.flush()
        assert cfg.id is not None

    def test_calendar_config_defaults(self, db):
        cfg = CalendarConfig()
        db.add(cfg)
        db.flush()
        assert cfg.id is not None
        assert cfg.is_active is False
