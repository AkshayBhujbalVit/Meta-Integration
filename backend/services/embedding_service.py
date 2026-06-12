"""
RAG embedding service — OpenAI text-embedding-3-small + numpy cosine similarity.
Embeddings stored as JSON text in PostgreSQL (no pgvector extension required).
"""

import os
import json
import logging
from typing import Optional

import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import text

log = logging.getLogger(__name__)

EMBED_MODEL = "text-embedding-3-small"


def embed_text(content: str) -> Optional[list[float]]:
    """Return a 1536-dim embedding vector, or None on failure."""
    try:
        import openai
        client = openai.OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        resp = client.embeddings.create(model=EMBED_MODEL, input=content[:8000])
        return resp.data[0].embedding
    except Exception as e:
        log.warning(f"embed_text failed: {e}")
        return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    denom = np.linalg.norm(va) * np.linalg.norm(vb)
    return float(np.dot(va, vb) / denom) if denom > 0 else 0.0


def search_kb_rag(query: str, db: Session, top_k: int = 6) -> list[dict]:
    """
    Embed the query and return the top-K most similar active KB items.
    Falls back to [] if no embeddings exist yet.
    """
    query_vec = embed_text(query)
    if query_vec is None:
        return []

    try:
        rows = db.execute(text("""
            SELECT ki.id, ki.question, ki.answer, ki.embedding_json, ks.name AS section
            FROM   kb_item ki
            JOIN   kb_section ks ON ks.id = ki.section_id
            WHERE  ki.is_active = true
              AND  ki.embedding_json IS NOT NULL
        """)).fetchall()
    except Exception as e:
        log.warning(f"search_kb_rag DB query failed: {e}")
        return []

    if not rows:
        return []

    scored = []
    for r in rows:
        try:
            vec = json.loads(r.embedding_json)
            sim = _cosine_similarity(query_vec, vec)
            scored.append({
                "section": r.section,
                "q": r.question,
                "a": r.answer,
                "score": round(sim, 3),
            })
        except Exception:
            continue

    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


def embed_and_store(item_id: int, question: str, answer: str, db: Session) -> bool:
    """Embed a KB item's Q+A and write the JSON vector back to the DB row."""
    content = f"{question}\n{answer}"
    vec = embed_text(content)
    if vec is None:
        return False
    try:
        db.execute(
            text("UPDATE kb_item SET embedding_json = :vec WHERE id = :id"),
            {"vec": json.dumps(vec), "id": item_id},
        )
        db.commit()
        return True
    except Exception as e:
        log.warning(f"embed_and_store failed for item {item_id}: {e}")
        db.rollback()
        return False


def ensure_embedding_column(db: Session) -> bool:
    """Add embedding_json TEXT column to kb_item if it doesn't exist."""
    try:
        db.execute(text(
            "ALTER TABLE kb_item ADD COLUMN IF NOT EXISTS embedding_json TEXT"
        ))
        db.commit()
        log.info("embedding_json column ready")
        return True
    except Exception as e:
        log.warning(f"ensure_embedding_column failed: {e}")
        db.rollback()
        return False
