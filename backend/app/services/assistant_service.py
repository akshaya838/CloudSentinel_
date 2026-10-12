"""
The grounded AI assistant pipeline: translate (if needed) -> retrieve -> generate -> translate back.
This is the single place that pipeline lives, so /api/v1/assistant and /api/v1/search both call
into it rather than duplicating the retrieval logic.

Speed/robustness rules for the multilingual path:
  * the embedding model is loaded once (not per question)
  * the answer (and, optionally, the sources) are translated in ONE batched model call
  * a question that is already in the answer language is never translated
  * every stage is timed and reported, and each stage degrades instead of failing the request
"""

import re
import time

from app.core.config import settings
from app.core.logging import logger
from app.services.model_loader import get_translator

from ml.multilingual.translate_module import LANG_CODES

CVE_ID = re.compile(r"CVE-\d{4}-\d{4,7}", re.IGNORECASE)
COLLECTION = "cve_knowledge"
MAX_HISTORY = 6
_PRONOUNS = re.compile(r"\b(it|its|this|that|these|those|them|they|same|above|previous|one)\b", re.IGNORECASE)
_FOLLOWUP_WORDS = re.compile(r"\b(patch|fix|mitigat|remediat|affected|exploit|severity|score|cvss|impact|more|why|how)\b", re.IGNORECASE)


class AssistantError(RuntimeError):
    """An error whose message is written for the user and is safe to show."""


def _require_index():
    if not settings.CHROMA_DIR.exists():
        raise FileNotFoundError("Vector index not found. Build it with ml/rag/build_index.py")


def search(question: str, top_k: int = 5) -> dict:
    """Semantic search only — no generation. Powers /api/v1/search."""
    _require_index()
    from retrieve import query_index  # flat import, matches ml/rag's own convention

    hits = query_index(question, collection_name=COLLECTION, persist_dir=str(settings.CHROMA_DIR), top_k=top_k)
    return {"query": question, "results": hits}


def resolve_followup(query_en: str, history: list[dict] | None) -> str:
    """"How do I patch it?" means nothing to a retriever. When the question names no CVE and looks
    like a follow-up, tie it to the CVE most recently discussed in the conversation."""
    if not history or CVE_ID.search(query_en):
        return query_en
    short = len(query_en.split()) <= 8
    if not (_PRONOUNS.search(query_en) or (short and _FOLLOWUP_WORDS.search(query_en))):
        return query_en
    for turn in reversed(history[-MAX_HISTORY:]):
        named = CVE_ID.findall(turn.get("content") or "")
        sources = [x for x in (turn.get("sources") or []) if x and CVE_ID.fullmatch(str(x))]
        found = named[-1] if named else (sources[0] if sources else None)
        if found:
            return f"{query_en} (regarding {found.upper()})"
    return query_en


def _retrieve(query_en: str, top_k: int) -> list[dict]:
    from retrieve import get_by_source_id, query_index

    persist = str(settings.CHROMA_DIR)
    hits: list[dict] = []
    seen: set[str] = set()
    exact_ids = list(dict.fromkeys(m.upper() for m in CVE_ID.findall(query_en)))
    for cve_id in exact_ids:  # exact records first
        try:
            for h in get_by_source_id(cve_id, COLLECTION, persist):
                if h["chunk_id"] not in seen:
                    seen.add(h["chunk_id"])
                    hits.append(h)
        except Exception:  # an exact-lookup problem must never block semantic search
            logger.exception("exact lookup failed for %s", cve_id)
    n_exact = len(hits)
    for h in query_index(query_en, collection_name=COLLECTION, persist_dir=persist, top_k=top_k):
        if h["chunk_id"] not in seen:
            seen.add(h["chunk_id"])
            hits.append(h)
    return hits[:top_k + n_exact]


def extractive_answer(hits: list[dict]) -> str:
    """Used when the language model is unavailable: state what the top retrieved record says,
    word for word, so the user still gets a grounded answer instead of an error."""
    top = hits[0]
    meta = top.get("metadata", {})
    first = re.split(r"(?<=[.!?])\s+", top["text"].strip())[0]
    sev = meta.get("cvss_severity")
    return f"{meta.get('source_id', 'The top match')}{f' ({sev})' if sev else ''}: {first}"


def _tick(timings: dict, name: str, t0: float) -> float:
    now = time.perf_counter()
    timings[name] = round((now - t0) * 1000)
    return now


def ask(question: str, target_lang: str | None = None, top_k: int = 3,
        history: list[dict] | None = None, translate_sources: bool = False) -> dict:
    """Full grounded-assistant pipeline: translate -> retrieve -> generate -> translate back."""
    _require_index()
    from ml.generation.generate_answer import generate_answer

    timings: dict[str, int] = {}
    t0 = time.perf_counter()
    translator = get_translator()
    source_lang = translator.detect_source_lang(question)
    response_lang = target_lang or source_lang
    notes: list[str] = []

    query_en = question
    if source_lang != "en":
        try:
            query_en = translator.translate_many([question], "en", source_lang)[0]
        except Exception:
            logger.exception("question translation failed")
            raise AssistantError("Could not translate the question to English. Try asking in English.") from None
    t = _tick(timings, "translate_question", t0)

    query_en = resolve_followup(query_en, history)
    hits = _retrieve(query_en, top_k)
    t = _tick(timings, "retrieve", t)

    answer_en = None
    generation_note = None
    answer_mode = None
    if not hits:
        generation_note = "I couldn't find enough information in the indexed vulnerability data to answer this reliably."
    else:
        try:
            answer_en = generate_answer(query_en, hits)["answer"]
            answer_mode = "llm"
        except (ConnectionError, RuntimeError) as e:
            logger.warning("LLM unavailable, using extractive answer: %s", e)
            answer_en = extractive_answer(hits)
            answer_mode = "extractive"
            generation_note = "The language model is not running, so this is the top matching record quoted directly."
    t = _tick(timings, "generate", t)

    for hit in hits:
        hit["text_en"] = hit["text"]

    answer = answer_en
    if response_lang != "en" and (answer_en or translate_sources):
        # one batched call for the answer and (optionally) every source
        batch = ([answer_en] if answer_en else []) + ([h["text_en"] for h in hits] if translate_sources else [])
        try:
            out = translator.translate_many(batch, response_lang, "en")
            if answer_en:
                answer = out.pop(0)
            if translate_sources:
                for h, txt in zip(hits, out):
                    h["text"] = txt
        except Exception:
            logger.exception("answer translation failed")
            answer = answer_en  # still useful in English; never lose the answer to a translation error
            response_lang = "en"
            notes.append("Translation failed, so the answer is shown in English.")
    t = _tick(timings, "translate_answer", t)
    timings["total"] = round((time.perf_counter() - t0) * 1000)

    return {
        "question": question,
        "question_en": query_en,
        "detected_language": LANG_CODES[source_lang],
        "response_language": LANG_CODES[response_lang],
        "response_lang_code": response_lang,
        "answer": answer,
        "answer_mode": answer_mode,
        "generation_note": " ".join([n for n in [generation_note, *notes] if n]) or None,
        "sources": [h.get("metadata", {}).get("source_id") for h in hits],
        "results": hits,
        "timings_ms": timings,
    }
