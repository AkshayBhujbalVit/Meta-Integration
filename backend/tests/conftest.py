"""
Pytest configuration.
Sets required env vars before any app module is imported,
so tests don't need a real .env file.
"""

import os

# Must be set before importing core.config — it raises RuntimeError if missing
os.environ.setdefault(
    "SECRET_KEY", "test-secret-key-not-for-production-1234567890ab"
)  # pragma: allowlist secret
os.environ.setdefault(
    "ENCRYPTION_KEY", "dGVzdC1lbmNyeXB0aW9uLWtleS1ub3QtZm9yLXByb2Q="
)  # pragma: allowlist secret
os.environ.setdefault("POSTGRES_USER", "test")
os.environ.setdefault("POSTGRES_PASSWORD", "test")  # pragma: allowlist secret
os.environ.setdefault("POSTGRES_HOST", "localhost")
os.environ.setdefault("POSTGRES_DB", "test_db")

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


@pytest.fixture(scope="session")
def engine():
    """In-memory SQLite DB — no Postgres needed for unit tests."""
    from models.models.base import Base

    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=eng)
    yield eng
    Base.metadata.drop_all(bind=eng)


@pytest.fixture
def db(engine):
    """Fresh DB session per test, rolled back after."""
    session_factory = sessionmaker(bind=engine)
    session = session_factory()
    yield session
    session.rollback()
    session.close()
