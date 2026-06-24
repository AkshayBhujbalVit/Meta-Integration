from sqlalchemy.orm import Session

from models.models.platform_integration import PlatformIntegration


def is_source_paused(db: Session, source: str) -> bool:
    """True if the admin has paused this platform integration — auto-calling should be skipped."""
    obj = db.query(PlatformIntegration).filter(PlatformIntegration.source == source).first()
    return bool(obj and obj.is_paused)
