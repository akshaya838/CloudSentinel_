"""Voice input and translation endpoints: validation, temp-file hygiene, error mapping, roles.
The speech and translation models themselves cannot run in CI, so they are replaced by stubs;
what is tested is everything around them."""
import os
import sys
import types
from pathlib import Path

import pytest

from app.core.config import settings
from app.services import translation_service, voice_service

WEBM = ("voice.webm", b"fake-audio-bytes", "audio/webm;codecs=opus")


def post_audio(client, headers, files=None):
    return client.post("/api/v1/voice/transcribe", headers=headers, files={"file": files or WEBM})


@pytest.fixture
def stub_transcriber(monkeypatch):
    seen = {}

    def fake(path, language=None):
        seen["path"] = path
        seen["language"] = language
        seen["existed"] = os.path.exists(path)
        seen["content"] = Path(path).read_bytes()
        return {"text": "remote code execution", "detected_language": "en", "language_probability": 0.98}

    monkeypatch.setattr(voice_service, "transcribe_audio", fake)
    return seen


# ------------------------------------------------------------------ /voice/transcribe

def test_transcribe_requires_sign_in_and_an_analyst_role(client, tokens):
    assert client.post("/api/v1/voice/transcribe", files={"file": WEBM}).status_code == 401
    assert post_audio(client, tokens["viewer"]).status_code == 403


def test_transcribe_returns_text_and_language(client, tokens, stub_transcriber):
    r = post_audio(client, tokens["analyst"])
    assert r.status_code == 200
    data = r.json()["data"]
    assert data == {"text": "remote code execution", "detected_language": "en", "language_probability": 0.98}


def test_audio_goes_to_a_private_temp_file_with_the_right_extension_and_is_deleted(client, tokens, stub_transcriber):
    post_audio(client, tokens["analyst"])
    assert stub_transcriber["existed"] and stub_transcriber["content"] == b"fake-audio-bytes"
    assert stub_transcriber["path"].endswith(".webm")
    assert not os.path.exists(stub_transcriber["path"])  # cleaned up
    assert "outputs" not in stub_transcriber["path"]  # not written into the project folder


def test_each_request_gets_its_own_temp_file(client, tokens, stub_transcriber):
    post_audio(client, tokens["analyst"])
    first = stub_transcriber["path"]
    post_audio(client, tokens["analyst"])
    assert stub_transcriber["path"] != first


def test_temp_file_is_deleted_even_when_transcription_fails(client, tokens, monkeypatch):
    seen = {}

    def boom(path, language=None):
        seen["path"] = path
        raise ValueError("decoder exploded on /secret/path")

    monkeypatch.setattr(voice_service, "transcribe_audio", boom)
    r = post_audio(client, tokens["analyst"])
    assert r.status_code == 503 and r.json()["detail"]["error"]["code"] == "TRANSCRIPTION_FAILED"
    assert "/secret/path" not in r.text  # internal details are logged, not shown to users
    assert not os.path.exists(seen["path"])


def test_missing_speech_library_gives_a_clear_install_hint(client, tokens, monkeypatch):
    def missing(path, language=None):
        raise RuntimeError("Speech-to-text is not installed. Run: pip install faster-whisper")

    monkeypatch.setattr(voice_service, "transcribe_audio", missing)
    r = post_audio(client, tokens["analyst"])
    assert r.status_code == 503 and r.json()["detail"]["error"]["code"] == "VOICE_UNAVAILABLE"
    assert "pip install faster-whisper" in r.json()["detail"]["error"]["message"]


def test_non_audio_uploads_are_rejected(client, tokens, stub_transcriber):
    r = post_audio(client, tokens["analyst"], ("notes.txt", b"hello", "text/plain"))
    assert r.status_code == 415 and r.json()["detail"]["error"]["code"] == "UNSUPPORTED_AUDIO_TYPE"
    assert "path" not in stub_transcriber  # never reached the model


def test_oversized_uploads_are_rejected_before_transcription(client, tokens, stub_transcriber, monkeypatch):
    monkeypatch.setattr(settings, "MAX_AUDIO_BYTES", 10)
    r = post_audio(client, tokens["analyst"], ("big.webm", b"x" * 11, "audio/webm"))
    assert r.status_code == 413 and r.json()["detail"]["error"]["code"] == "AUDIO_TOO_LARGE"
    assert "path" not in stub_transcriber


def test_empty_recording_is_rejected(client, tokens, stub_transcriber):
    r = post_audio(client, tokens["analyst"], ("empty.webm", b"", "audio/webm"))
    assert r.status_code == 400 and r.json()["detail"]["error"]["code"] == "EMPTY_AUDIO"


@pytest.mark.parametrize("content_type,suffix", [
    ("audio/webm;codecs=opus", ".webm"), ("audio/ogg", ".ogg"), ("audio/mp4", ".mp4"), ("audio/wav", ".wav"),
    ("audio/something-new", ".audio"),
])
def test_extension_follows_the_browsers_format(client, tokens, stub_transcriber, content_type, suffix):
    post_audio(client, tokens["analyst"], ("clip", b"abc", content_type))
    assert stub_transcriber["path"].endswith(suffix)


# ------------------------------------------------------------------ /translation

def test_translation_requires_an_analyst_role(client, tokens):
    body = {"text": "hello", "target_lang": "en"}
    assert client.post("/api/v1/translation", json=body).status_code == 401
    assert client.post("/api/v1/translation", json=body, headers=tokens["viewer"]).status_code == 403


def test_translation_passes_text_and_languages_to_the_translator(client, tokens, monkeypatch):
    calls = []

    def fake(text, target, source=None):
        calls.append((text, target, source))
        return {"source_lang": "ta", "target_lang": "en", "source_text": text, "translated_text": "remote code execution"}

    monkeypatch.setattr(translation_service, "translate", fake)
    r = client.post("/api/v1/translation", headers=tokens["analyst"],
                    json={"text": "தொலைநிலை குறியீடு செயலாக்கம்", "target_lang": "en", "source_lang": "ta"})
    assert r.status_code == 200 and r.json()["data"]["translated_text"] == "remote code execution"
    assert calls == [("தொலைநிலை குறியீடு செயலாக்கம்", "en", "ta")]


@pytest.mark.parametrize("body", [
    {"text": "hi", "target_lang": "fr"},          # unsupported language
    {"text": "", "target_lang": "en"},            # empty
    {"text": "x" * 2001, "target_lang": "en"},    # too long
    {"target_lang": "en"},                        # missing text
])
def test_translation_validates_input(client, tokens, body):
    assert client.post("/api/v1/translation", json=body, headers=tokens["analyst"]).status_code == 422


@pytest.mark.parametrize("exc", [RuntimeError("model missing at /secret"), SystemExit("pip install transformers")])
def test_translation_failure_is_a_clean_503(client, tokens, monkeypatch, exc):
    def boom(*a, **k):
        raise exc

    monkeypatch.setattr(translation_service, "translate", boom)
    r = client.post("/api/v1/translation", json={"text": "hello", "target_lang": "ta"}, headers=tokens["analyst"])
    assert r.status_code == 503 and r.json()["detail"]["error"]["code"] == "TRANSLATION_UNAVAILABLE"
    assert "/secret" not in r.text


# ------------------------------------------------------------------ ml/voice/voice_io.py

@pytest.fixture
def fake_whisper(monkeypatch):
    from ml.voice import voice_io

    class Segment:
        def __init__(self, text): self.text = text

    class Info:
        language, language_probability = "ta", 0.91234

    state = {"constructed": 0, "calls": []}

    class FakeModel:
        def __init__(self, size, device, compute_type):
            state["constructed"] += 1
            state["args"] = (size, device, compute_type)

        def transcribe(self, path, **kw):
            state["calls"].append((path, kw["beam_size"], kw["initial_prompt"]))
            return iter([Segment(" first part "), Segment("second part ")]), Info()

    module = types.ModuleType("faster_whisper")
    module.WhisperModel = FakeModel
    monkeypatch.setitem(sys.modules, "faster_whisper", module)
    voice_io._load_model.cache_clear()
    yield state, voice_io
    voice_io._load_model.cache_clear()


def test_whisper_model_is_loaded_once_and_reused(fake_whisper):
    state, voice_io = fake_whisper
    voice_io.transcribe("a.webm")
    voice_io.transcribe("b.webm")
    assert state["constructed"] == 1
    assert state["args"] == (voice_io.DEFAULT_MODEL, "cpu", "int8")
    assert [c[0] for c in state["calls"]] == ["a.webm", "b.webm"]


def test_transcribe_joins_segments_and_reports_the_detected_language(fake_whisper):
    _, voice_io = fake_whisper
    assert voice_io.transcribe("a.webm") == {"text": "first part second part", "detected_language": "ta", "language_probability": 0.912}


def test_transcribe_explains_how_to_install_when_whisper_is_missing(monkeypatch):
    from ml.voice import voice_io
    monkeypatch.setitem(sys.modules, "faster_whisper", None)  # makes `import faster_whisper` fail
    voice_io._load_model.cache_clear()
    with pytest.raises(RuntimeError, match="pip install faster-whisper"):
        voice_io.transcribe("a.webm")
