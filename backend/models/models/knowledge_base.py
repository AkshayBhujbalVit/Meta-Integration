from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from .base import Base


class KBSection(Base):
    """Top-level sections e.g. Doctor Info, IVF, PCOS, FAQs"""
    __tablename__ = "kb_section"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)            # e.g. "IVF / IUI"
    slug = Column(String(100), nullable=False, unique=True)  # e.g. "ivf_iui"
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class KBItem(Base):
    """Q&A items within a section — added manually."""
    __tablename__ = "kb_item"

    id = Column(Integer, primary_key=True, index=True)
    section_id = Column(Integer, nullable=False, index=True)
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class KBDocument(Base):
    """Uploaded PDF/DOCX files for a section."""
    __tablename__ = "kb_document"

    id = Column(Integer, primary_key=True, index=True)
    section_id = Column(Integer, nullable=True, index=True)  # null = general
    file_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    file_type = Column(String(20), nullable=True)             # pdf / docx
    extracted_text = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=func.now())
