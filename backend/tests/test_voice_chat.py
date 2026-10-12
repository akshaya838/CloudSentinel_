"""Voice-first multilingual assistant: speech hints, batched/cached translation, retrieval,
follow-ups, graceful fallbacks, timings and warm-up. The heavy models (Whisper, M2M-100, the
embedder, Ollama) cannot run in CI, so they are replaced with fakes; what is tested is all the
logic around them."""
import contextlib
import sys
import types

import pytest

from app.core.config import settings
from app.services import assistant_service, voice_service, warmup
from ml.multilingual import translate_module as tm

WEBM = ("voice.webm", b"fake-audio-bytes", "audio/webm")


# ------------------------------------------------------------------ /voice/transcribe language hint

@pytest.fixture
def capture_language(monkeypatch):
    seen = {}

    def fake(path, language=None):
        seen["language"] = language
        return {"text": "x", "detected_language": language or "en", "language_probability": 1.0}

    monkeypatch.setattr(voice_service, "transcribe_audio", fake)
    return seen


@pytest.mark.parametrize("sent,expected", [(None, None), ("", None), ("auto", None), ("ta", "ta"), ("HI", "hi"), ("en", "en")])
def test_language_hint_reaches_the_speech_model(client, tokens, capture_language, sent, expected):
    data = {} if sent is None else {"language": sent}
    r = client.post("/api/v1/voice/transcribe", headers=tokens["analyst"], files={"file": WEBM}, data=data)
    assert r.status_code == 200
    assert capture_language["language"] == expected


def test_unsupported_language_hint_is_rejected_before_transcription(client, tokens, capture_language):
    r = client.post("/api/v1/voice/transcribe", headers=tokens["analyst"], files={"file": WEBM}, data={"language": "fr"})
    assert r.status_code == 422 and r.json()["detail"]["error"]["code"] == "UNSUPPORTED_LANGUAGE"
    assert "language" not in capture_language


# ------------------------------------------------------------------ voice_io behaviour

@pytest.fixture
def whisper(monkeypatch):
    """A scriptable fake Whisper. `script` maps (language, vad) -> (text, detected, all_language_probs)."""
    from ml.voice import voice_io

    calls = []
    script = {}

    class Seg:
        def __init__(self, text): self.text = text

    class FakeModel:
        def __init__(self, *a, **k): pass

        def transcribe(self, path, **kw):
            lang, vad = kw.get("language"), bool(kw.get("vad_filter"))
            calls.append({"language": lang, "vad": vad, "prompt": kw.get("initial_prompt"), "beam": kw["beam_size"],
                          "ctx": kw.get("condition_on_previous_text")})
            text, detected, probs = script.get((lang, vad), script.get((lang, None), ("", lang or "en", None)))
            info = types.SimpleNamespace(language=lang or detected, language_probability=0.9, all_language_probs=probs)
            return iter([Seg(text)] if text else []), info

    module = types.ModuleType("faster_whisper")
    module.WhisperModel = FakeModel
    monkeypatch.setitem(sys.modules, "faster_whisper", module)
    voice_io._load_model.cache_clear()
    yield types.SimpleNamespace(calls=calls, script=script, io=voice_io)
    voice_io._load_model.cache_clear()


def test_forced_language_skips_detection_and_reports_that_language(whisper):
    whisper.script[("ta", True)] = ("வணக்கம்", "ta", None)
    out = whisper.io.transcribe("a.webm", language="ta")
    assert out["text"] == "வணக்கம்" and out["detected_language"] == "ta" and out["language_probability"] == 1.0
    assert len(whisper.calls) == 1 and whisper.calls[0]["language"] == "ta"
    assert whisper.calls[0]["prompt"] is None  # the English vocabulary prompt must not bias Tamil


def test_english_gets_the_security_vocabulary_prompt(whisper):
    whisper.script[("en", True)] = ("explain log4shell", "en", None)
    whisper.io.transcribe("a.webm", language="en")
    assert "Log4Shell" in whisper.calls[0]["prompt"]


def test_decoding_settings_favour_speed_and_stability(whisper):
    whisper.script[("en", True)] = ("hi", "en", None)
    whisper.io.transcribe("a.webm", language="en")
    assert whisper.calls[0]["beam"] == whisper.io.BEAM_SIZE == 1
    assert whisper.calls[0]["vad"] is True and whisper.calls[0]["ctx"] is False


def test_unsupported_detection_is_corrected_to_the_best_supported_language(whisper):
    # Whisper calls Tamil "Malayalam": re-run forced to the likeliest of en/ta/hi
    whisper.script[(None, True)] = ("garbled", "ml", [("ml", 0.6), ("ta", 0.3), ("hi", 0.05), ("en", 0.01)])
    whisper.script[("ta", True)] = ("சரியான உரை", "ta", None)
    out = whisper.io.transcribe("a.webm")
    assert out["text"] == "சரியான உரை" and out["detected_language"] == "ta"
    assert [c["language"] for c in whisper.calls] == [None, "ta"]


def test_supported_detection_is_trusted_without_a_second_pass(whisper):
    whisper.script[(None, True)] = ("namaste", "hi", [("hi", 0.9), ("ta", 0.05)])
    out = whisper.io.transcribe("a.webm")
    assert out["detected_language"] == "hi" and len(whisper.calls) == 1


def test_silence_filter_that_removes_everything_is_retried_without_it(whisper):
    whisper.script[("en", True)] = ("", "en", None)
    whisper.script[("en", False)] = ("quiet speech", "en", None)
    out = whisper.io.transcribe("a.webm", language="en")
    assert out["text"] == "quiet speech"
    assert [c["vad"] for c in whisper.calls] == [True, False]


def test_truly_empty_audio_returns_empty_text_not_an_error(whisper):
    assert whisper.io.transcribe("a.webm", language="en")["text"] == ""


def test_invalid_language_is_refused(whisper):
    with pytest.raises(ValueError):
        whisper.io.transcribe("a.webm", language="fr")


# ------------------------------------------------------------------ translator logic (fake M2M-100)

class FakeTokenizer:
    def __init__(self): self.src_lang = None; self.batches = []
    def __call__(self, texts, **kw):
        self.batches.append((self.src_lang, list(texts)))
        return {"texts": list(texts)}
    def get_lang_id(self, lang): return lang
    def batch_decode(self, generated, skip_special_tokens=True): return [f"<{g}>" for g in generated]


class FakeModelM2M:
    def __init__(self): self.generate_calls = []
    def generate(self, texts, forced_bos_token_id, num_beams, max_new_tokens):
        self.generate_calls.append((list(texts), forced_bos_token_id, num_beams))
        return [f"{forced_bos_token_id}:{t}" for t in texts]


@pytest.fixture
def translator():
    import threading
    from collections import OrderedDict
    t = tm.Translator.__new__(tm.Translator)
    t._torch = types.SimpleNamespace(inference_mode=contextlib.nullcontext)
    t.tokenizer, t.model = FakeTokenizer(), FakeModelM2M()
    t._lock, t._cache = threading.Lock(), OrderedDict()
    return t


def test_sentences_are_split_and_translated_in_one_batch(translator):
    out = translator.translate_many(["First one. Second one!", "Third?"], "ta", "en")
    assert len(translator.model.generate_calls) == 1  # ONE model call for every sentence of every text
    assert translator.model.generate_calls[0][0] == ["First one.", "Second one!", "Third?"]
    assert out == ["<ta:First one.> <ta:Second one!>", "<ta:Third?>"]


def test_repeated_text_is_served_from_the_cache(translator):
    translator.translate_many(["Same sentence."], "hi", "en")
    translator.translate_many(["Same sentence."], "hi", "en")
    assert len(translator.model.generate_calls) == 1


def test_only_uncached_sentences_hit_the_model(translator):
    translator.translate_many(["Known."], "hi", "en")
    translator.translate_many(["Known. New one."], "hi", "en")
    assert translator.model.generate_calls[1][0] == ["New one."]


def test_text_already_in_the_target_language_is_not_translated(translator):
    assert translator.translate_many(["Already English."], "en", "en") == ["Already English."]
    r = translator.translate("Already English.", "en")
    assert r["translated_text"] == "Already English." and not translator.model.generate_calls


def test_mixed_source_languages_are_batched_per_language(translator):
    translator.translate_many(["hello there", "யாருக்கு"], "en")  # en passes through, ta is translated
    assert [b[0] for b in translator.tokenizer.batches] == ["ta"]


def test_cve_ids_survive_translation(translator):
    out = translator.translate_many(["Explain CVE-2021-44228 please."], "ta", "en")[0]
    assert "CVE-2021-44228" in out


def test_rejects_unsupported_languages(translator):
    with pytest.raises(ValueError):
        translator.translate_many(["x"], "fr", "en")
    with pytest.raises(ValueError):
        translator.translate_many(["x"], "en", "fr")


def test_cache_is_bounded(translator, monkeypatch):
    monkeypatch.setattr(tm, "CACHE_SIZE", 3)
    translator.translate_many([f"Sentence {i}." for i in range(10)], "hi", "en")
    assert len(translator._cache) == 3


@pytest.mark.parametrize("text,lang", [
    ("What is Log4Shell?", "en"), ("இந்த பாதிப்பு எவ்வளவு தீவிரமானது?", "ta"), ("यह कमजोरी कितनी गंभीर है?", "hi"),
    ("CVE-2021-44228 பற்றி விளக்கு", "ta"), ("", "en"), ("12345 !!!", "en"),
])
def test_script_language_detection(text, lang):
    assert tm.detect_script_lang(text) == lang


def test_long_runs_are_cut_without_losing_words():
    text = " ".join(["word"] * 400)
    pieces = tm.split_sentences(text)
    assert all(len(p) <= tm.MAX_CHARS_PER_PIECE for p in pieces)
    assert " ".join(pieces).split() == text.split()


# ------------------------------------------------------------------ retrieval (real ChromaDB, fake embedder)

@pytest.fixture
def index(tmp_path):
    chromadb = pytest.importorskip("chromadb")
    persist = str(tmp_path / "chroma")
    client = chromadb.PersistentClient(path=persist, settings=chromadb.Settings(anonymized_telemetry=False))
    col = client.create_collection("cve_knowledge", metadata={"hnsw:space": "cosine"})
    docs = {
        "CVE-2021-44228": "Apache Log4j2 JNDI remote code execution. Critical.",
        "CVE-2022-0001": "SQL injection in a login form.",
        "CVE-2023-0002": "Cross site scripting in a comment box.",
    }
    col.add(ids=[f"{k}#0" for k in docs], documents=list(docs.values()),
            metadatas=[{"source_id": k, "cvss_severity": "CRITICAL"} for k in docs],
            embeddings=[[1, 0, 0], [0, 1, 0], [0, 0, 1]])
    return persist


def test_exact_cve_lookup_returns_that_record(index):
    from retrieve import get_by_source_id
    hits = get_by_source_id("CVE-2022-0001", "cve_knowledge", index)
    assert [h["metadata"]["source_id"] for h in hits] == ["CVE-2022-0001"] and hits[0]["distance"] == 0.0
    assert get_by_source_id("CVE-1999-0000", "cve_knowledge", index) == []


def test_embedding_model_is_loaded_once_across_questions(index, monkeypatch):
    import retrieve
    loads = []
    monkeypatch.setattr(retrieve, "get_embedding_fn", lambda: (loads.append(1), lambda texts: [[1, 0, 0]] * len(texts))[1])
    retrieve.get_cached_embedding_fn.cache_clear()
    for _ in range(3):
        retrieve.query_index("anything", "cve_knowledge", index, top_k=1)
    assert len(loads) == 1
    retrieve.get_cached_embedding_fn.cache_clear()


# ------------------------------------------------------------------ assistant pipeline

class FakeTranslator:
    def __init__(self, fail=False):
        self.calls, self.fail = [], fail

    def detect_source_lang(self, text): return tm.detect_script_lang(text)

    def translate_many(self, texts, target, source=None):
        self.calls.append((list(texts), target, source))
        if self.fail:
            raise RuntimeError("model crashed at /secret")
        return [f"[{target}]{t}" for t in texts]


def hit(cve, text="A flaw. More detail."):
    return {"chunk_id": f"{cve}#0", "text": text, "distance": 0.2, "metadata": {"source_id": cve, "cvss_severity": "CRITICAL"}}


@pytest.fixture
def pipeline(monkeypatch, tmp_path):
    import retrieve
    import ml.generation.generate_answer as gen
    monkeypatch.setattr(settings, "CHROMA_DIR", tmp_path)  # exists
    tr = FakeTranslator()
    state = types.SimpleNamespace(tr=tr, queries=[], answer="Grounded answer.", llm_error=None, hits=[hit("CVE-2021-44228")])
    monkeypatch.setattr(assistant_service, "get_translator", lambda: state.tr)
    monkeypatch.setattr(retrieve, "query_index", lambda q, **k: (state.queries.append(q), [dict(h) for h in state.hits])[1])
    monkeypatch.setattr(retrieve, "get_by_source_id", lambda i, *a: [])

    def fake_generate(q, hits):
        if state.llm_error:
            raise state.llm_error
        return {"answer": state.answer}

    monkeypatch.setattr(gen, "generate_answer", fake_generate)
    return state


def test_english_question_is_never_translated(pipeline):
    r = assistant_service.ask("Explain Log4Shell")
    assert pipeline.tr.calls == [] and r["answer"] == "Grounded answer." and r["response_lang_code"] == "en"


def test_tamil_question_is_translated_in_and_the_answer_back_out_in_two_calls_total(pipeline):
    r = assistant_service.ask("லாக்4ஷெல் என்றால் என்ன")
    assert [(c[1], c[2]) for c in pipeline.tr.calls] == [("en", "ta"), ("ta", "en")]  # no per-source translations
    assert pipeline.queries == ["[en]லாக்4ஷெல் என்றால் என்ன"]
    assert r["answer"] == "[ta]Grounded answer." and r["response_language"] == "Tamil"


def test_sources_are_translated_in_the_same_batch_only_when_asked(pipeline):
    pipeline.hits = [hit("CVE-1-1111"), hit("CVE-2-2222")]
    r = assistant_service.ask("यह क्या है", translate_sources=True)
    batch_calls = [c for c in pipeline.tr.calls if c[1] == "hi"]
    assert len(batch_calls) == 1 and len(batch_calls[0][0]) == 3  # answer + 2 sources, ONE call
    assert r["results"][0]["text"].startswith("[hi]") and r["results"][0]["text_en"] == "A flaw. More detail."
    pipeline.tr.calls.clear()
    plain = assistant_service.ask("यह क्या है")
    assert plain["results"][0]["text"] == "A flaw. More detail."
    assert [len(c[0]) for c in pipeline.tr.calls if c[1] == "hi"] == [1]  # only the answer was translated


def test_explicit_target_language_overrides_the_question_language(pipeline):
    r = assistant_service.ask("Explain Log4Shell", target_lang="hi")
    assert r["answer"] == "[hi]Grounded answer." and r["detected_language"] == "English"


def test_llm_down_gives_a_grounded_extractive_answer_not_an_error(pipeline):
    pipeline.llm_error = ConnectionError("Could not reach Ollama")
    r = assistant_service.ask("Explain Log4Shell")
    assert r["answer_mode"] == "extractive"
    assert r["answer"] == "CVE-2021-44228 (CRITICAL): A flaw."
    assert "language model is not running" in r["generation_note"]


def test_no_hits_refuses_instead_of_inventing(pipeline):
    pipeline.hits = []
    r = assistant_service.ask("capital of France")
    assert r["answer"] is None and "couldn't find enough information" in r["generation_note"]


def test_answer_translation_failure_falls_back_to_english(pipeline):
    pipeline.tr = FakeTranslator(fail=True)
    r = assistant_service.ask("Explain Log4Shell", target_lang="ta")
    assert r["answer"] == "Grounded answer." and r["response_lang_code"] == "en"
    assert "Translation failed" in r["generation_note"] and "/secret" not in str(r)


def test_question_translation_failure_is_a_clear_error(pipeline):
    pipeline.tr = FakeTranslator(fail=True)
    with pytest.raises(assistant_service.AssistantError, match="Could not translate the question"):
        assistant_service.ask("லாக்4ஷெல்")


def test_every_stage_is_timed(pipeline):
    t = assistant_service.ask("Explain Log4Shell")["timings_ms"]
    assert set(t) == {"translate_question", "retrieve", "generate", "translate_answer", "total"}
    assert all(isinstance(v, int) and v >= 0 for v in t.values())


def test_missing_index_is_reported(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "CHROMA_DIR", tmp_path / "nope")
    with pytest.raises(FileNotFoundError):
        assistant_service.ask("x")


# ---- follow-ups

H = [{"role": "user", "content": "Explain CVE-2021-44228", "sources": []},
     {"role": "assistant", "content": "Log4Shell allows RCE.", "sources": ["CVE-2021-44228", "CVE-2020-1111"]}]


@pytest.mark.parametrize("q", ["How do I patch it?", "what is its severity", "and the fix?", "Is this exploitable"])
def test_follow_ups_are_tied_to_the_cve_just_discussed(q):
    assert assistant_service.resolve_followup(q, H).endswith("(regarding CVE-2021-44228)")


@pytest.mark.parametrize("q,h", [
    ("Explain CVE-2019-9999", H),                      # names its own CVE
    ("Which vulnerabilities allow SQL injection in web login forms today", H),  # long, standalone
    ("How do I patch it?", []),                       # nothing to refer to
    ("How do I patch it?", None),
])
def test_standalone_questions_are_left_alone(q, h):
    assert assistant_service.resolve_followup(q, h) == q


def test_history_reaches_retrieval_through_ask(pipeline):
    assistant_service.ask("How do I patch it?", history=H)
    assert pipeline.queries == ["How do I patch it? (regarding CVE-2021-44228)"]


def test_most_recent_cve_wins():
    h = H + [{"role": "user", "content": "now CVE-2022-0001", "sources": []}]
    assert assistant_service.resolve_followup("fix it", h).endswith("CVE-2022-0001)")


# ---- the HTTP route

def test_assistant_route_validates_and_forwards_history(client, tokens, monkeypatch):
    seen = {}

    def fake(q, lang, top_k, history, translate_sources):
        seen.update(q=q, lang=lang, top_k=top_k, history=history, ts=translate_sources)
        return {"answer": "ok"}

    monkeypatch.setattr(assistant_service, "ask", fake)
    body = {"question": "How do I patch it?", "target_lang": "ta", "history": [{"role": "assistant", "content": "x", "sources": ["CVE-2021-44228"]}]}
    r = client.post("/api/v1/assistant", json=body, headers=tokens["analyst"])
    assert r.status_code == 200 and r.json()["data"] == {"answer": "ok"}
    assert seen["lang"] == "ta" and seen["history"][0]["sources"] == ["CVE-2021-44228"] and seen["ts"] is False


@pytest.mark.parametrize("body", [
    {"question": ""}, {"question": "x", "target_lang": "fr"}, {"question": "x", "top_k": 0},
    {"question": "x", "history": [{"role": "robot", "content": "x"}]}, {"question": "x" * 2001},
])
def test_assistant_route_rejects_bad_input(client, tokens, body):
    assert client.post("/api/v1/assistant", json=body, headers=tokens["analyst"]).status_code == 422


@pytest.mark.parametrize("exc", [RuntimeError("secret /path boom"), SystemExit("pip install x"), KeyError("k")])
def test_assistant_route_failures_are_clean_503s(client, tokens, monkeypatch, exc):
    def boom(*a, **k): raise exc
    monkeypatch.setattr(assistant_service, "ask", boom)
    r = client.post("/api/v1/assistant", json={"question": "x"}, headers=tokens["analyst"])
    assert r.status_code == 503 and r.json()["detail"]["error"]["code"] == "ASSISTANT_UNAVAILABLE"
    assert "/path" not in r.text and r.json()["detail"]["error"]["message"].startswith("The assistant is unavailable")


def test_user_safe_errors_are_shown(client, tokens, monkeypatch):
    def boom(*a, **k): raise assistant_service.AssistantError("Could not translate the question to English. Try asking in English.")
    monkeypatch.setattr(assistant_service, "ask", boom)
    r = client.post("/api/v1/assistant", json={"question": "x"}, headers=tokens["analyst"])
    assert "Try asking in English" in r.json()["detail"]["error"]["message"]


def test_assistant_route_requires_analyst(client, tokens):
    assert client.post("/api/v1/assistant", json={"question": "x"}, headers=tokens["viewer"]).status_code == 403


# ------------------------------------------------------------------ warm-up

def test_warmup_is_skipped_in_tests_and_reported(client, tokens):
    r = client.get("/health/warmup")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["ready"] is True and set(data["steps"]) == {"translation", "embeddings", "speech", "llm"}


def test_one_failing_warmup_step_does_not_stop_the_others(monkeypatch):
    ran = []

    def ok(name): return lambda: ran.append(name)
    def bad(): raise SystemExit("pip install transformers")

    monkeypatch.setattr(warmup, "_WORK", {"translation": bad, "embeddings": ok("e"), "speech": ok("s"), "llm": bad})
    warmup.run_warmup()
    assert ran == ["e", "s"]
    assert warmup.status() == {"translation": "failed", "embeddings": "ready", "speech": "ready", "llm": "failed"}


def test_warmup_can_be_disabled(monkeypatch):
    monkeypatch.setattr(settings, "WARMUP_ON_START", False)
    assert warmup.start_warmup() is None
    assert set(warmup.status().values()) == {"skipped"}


def test_warmup_runs_in_a_background_thread(monkeypatch):
    import threading
    monkeypatch.setattr(settings, "WARMUP_ON_START", True)
    gate = threading.Event()
    monkeypatch.setattr(warmup, "_WORK", {s: gate.wait for s in warmup.STEPS})
    t = warmup.start_warmup()
    assert t is not None and t.daemon and t.is_alive()  # start-up did not block on the models
    gate.set(); t.join(5)
    assert set(warmup.status().values()) == {"ready"}
