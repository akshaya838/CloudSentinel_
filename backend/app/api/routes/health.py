"""
System health. Every field reflects something actually checked, not a
hardcoded "all green".
"""

import importlib.util
import os
from pathlib import Path

from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import settings
from app.core.responses import success
from app.services import warmup
from app.database.connection import engine

router = APIRouter(tags=["Health"])


def _check_ollama() -> str:
    try:
        import requests
        r = requests.get(f"{settings.OLLAMA_BASE_URL}/api/tags", timeout=2)
        return "operational" if r.status_code == 200 else "warning"
    except Exception:
        return "offline"


def _check_database() -> str:
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return "operational"
    except Exception:
        return "offline"


def _module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def _hf_cached(repo: str) -> bool:
    home = Path(os.getenv("HF_HOME", Path.home() / ".cache" / "huggingface"))
    return (home / "hub" / f"models--{repo.replace('/', '--')}").exists()


def _check_translation() -> str:
    if not _module("transformers"):
        return "offline"
    # Library present but weights not cached yet -> they download on first use.
    return "operational" if _hf_cached("facebook/m2m100_418M") else "warning"


def _check_speech() -> str:
    present = [_module("faster_whisper"), _module("pyttsx3")]
    if all(present):
        return "operational"  # libraries present; Whisper weights download on first use
    return "warning" if any(present) else "offline"


@router.get("/health")
def health():
    return success({
        "database": _check_database(),
        "ml_pipeline": "operational" if settings.DATA_PROCESSED.exists() else "warning",
        "vector_database": "operational" if settings.CHROMA_DIR.exists() else "warning",
        "llm": _check_ollama(),
        "translation_model": _check_translation(),
        "speech_services": _check_speech(),
    })


@router.get("/health/warmup")
def health_warmup():
    """Progress of the background model loading: pending | loading | ready | failed | skipped."""
    st = warmup.status()
    return success({"steps": st, "ready": all(v in ("ready", "skipped") for v in st.values())})
