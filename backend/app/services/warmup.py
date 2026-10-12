"""
Start-up warm-up. The first request after a restart used to pay for loading every model
(translation, embeddings, speech) and for Ollama loading the language model. Doing that in a
background thread as soon as the server starts means the first real question is as fast as the
hundredth. The server answers requests immediately; /health/warmup reports progress.
"""

import threading

from app.core.config import settings
from app.core.logging import logger

STEPS = ("translation", "embeddings", "speech", "llm")
_status: dict[str, str] = {s: "pending" for s in STEPS}
_lock = threading.Lock()


def status() -> dict[str, str]:
    with _lock:
        return dict(_status)


def _set(step: str, value: str) -> None:
    with _lock:
        _status[step] = value


def _warm_translation():
    from app.services.model_loader import get_translator
    tr = get_translator()
    tr.translate_many(["hello"], "ta", "en")  # the first generate() call is the slow one; pay for it now
    tr.translate_many(["hello"], "hi", "en")


def _warm_embeddings():
    from retrieve import get_cached_embedding_fn
    get_cached_embedding_fn()(["warm up"])


def _warm_speech():
    from ml.voice.voice_io import DEFAULT_MODEL, _load_model
    _load_model(DEFAULT_MODEL)


def _warm_llm():
    from ml.generation.generate_answer import warm_up
    warm_up(settings.MODEL_NAME)


_WORK = {
    "translation": _warm_translation,
    "embeddings": _warm_embeddings,
    "speech": _warm_speech,
    "llm": _warm_llm,
}


def run_warmup() -> None:
    for step in STEPS:
        _set(step, "loading")
        try:
            _WORK[step]()
            _set(step, "ready")
        except (Exception, SystemExit) as e:  # a missing model must not stop the others from loading
            logger.warning("warm-up of %s failed: %s", step, e)
            _set(step, "failed")


def start_warmup() -> threading.Thread | None:
    if not settings.WARMUP_ON_START:
        for s in STEPS:
            _set(s, "skipped")
        return None
    t = threading.Thread(target=run_warmup, name="warmup", daemon=True)
    t.start()
    return t
