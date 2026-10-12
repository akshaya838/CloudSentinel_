"""
Centralized, lazy, cached loading of every heavy ML resource (spaCy
pipeline, trained classifier, translator model). Every service imports
from here rather than loading its own copy — satisfies the spec's
"load models once and reuse them, not on every request" requirement.

sys.path is wired here, once, so every ml.* import works the same way
regardless of which route triggered it first.
"""

import json
import sys
from functools import lru_cache
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "ml" / "rag"))  # retrieve.py/build_index.py use flat imports

from app.core.config import settings  # noqa: E402


@lru_cache(maxsize=1)
def get_nlp():
    from ml.ner.ner_pipeline import build_pipeline
    return build_pipeline()


@lru_cache(maxsize=1)
def get_classifier():
    from ml.classification.severity_classifier import train_baseline_classifier
    if not settings.DATA_RAW.exists():
        raise FileNotFoundError(f"Training data not found at {settings.DATA_RAW}")
    records = json.loads(settings.DATA_RAW.read_text(encoding="utf-8"))
    return train_baseline_classifier(records)


@lru_cache(maxsize=1)
def get_translator():
    from ml.multilingual.translate_module import Translator
    return Translator()


@lru_cache(maxsize=1)
def get_cve_lookup() -> dict:
    import pandas as pd
    if not settings.DATA_PROCESSED.exists():
        return {}
    df = pd.read_csv(settings.DATA_PROCESSED)
    return {row["cve_id"]: row.to_dict() for _, row in df.iterrows()}
