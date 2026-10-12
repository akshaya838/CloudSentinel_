"""
CloudSentinel - Voice I/O (NLP Concept 10)
=============================================
Lets someone speak a question instead of typing it, and hear the answer
instead of reading it. Two separate models, chosen for different reasons:

Speech-to-Text (STT): faster-whisper (a CTranslate2 reimplementation of
OpenAI's Whisper, same accuracy, much lighter and faster than the original
openai-whisper package). Whisper is natively multilingual, so it handles
English, Tamil, and Hindi speech with the SAME model — no separate STT
model per language needed, consistent with the "one model, three
languages" choice already made for translation (Stage: multilingual).

Text-to-Speech (TTS): pyttsx3, which wraps the operating system's own
built-in speech engine (SAPI5 on Windows) rather than a downloaded neural
TTS model. This is a deliberate trade-off, not an oversight: Coqui TTS
(the originally planned option) is multi-gigabyte, has had unstable
maintenance, and its Tamil/Hindi voice quality is inconsistent. pyttsx3
works instantly offline with no download, at the cost of more robotic-
sounding speech and depending on whatever language voices are installed
on the Windows machine running it (Tamil/Hindi system voices may need to
be installed separately via Windows Settings > Time & Language > Speech).
This trade-off should be stated plainly in any report, not glossed over.

Requires (run from repo root):
    pip install faster-whisper pyttsx3

Usage:
    python -m src.voice.voice_io --stt path/to/question.wav
    python -m src.voice.voice_io --tts "This CVE is rated Critical severity."
"""

import argparse
import os
import sys
from functools import lru_cache
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


SUPPORTED = ("en", "ta", "hi")
# 'base' is fast but weak on Tamil and Hindi; 'small' is the smallest model that is dependable for them.
DEFAULT_MODEL = os.getenv("WHISPER_MODEL", "small")
BEAM_SIZE = int(os.getenv("WHISPER_BEAM_SIZE", "1"))  # 1 = greedy: ~3x faster than 5, rarely worse on short questions
# Words a security question is likely to contain; nudges English transcripts toward the right spelling.
ENGLISH_PROMPT = "CVE, CWE, Log4Shell, Log4j, remote code execution, SQL injection, buffer overflow, authentication bypass."


@lru_cache(maxsize=2)
def _load_model(model_size: str):
    """Loading Whisper takes seconds, so do it once per process and reuse it for every request."""
    from faster_whisper import WhisperModel
    return WhisperModel(model_size, device="cpu", compute_type="int8")


def _run(model, audio_path: str, language: str | None, vad: bool, initial_prompt: str | None):
    kwargs = dict(
        beam_size=BEAM_SIZE,
        language=language,
        initial_prompt=initial_prompt,
        condition_on_previous_text=False,  # stops one bad segment from derailing the rest
    )
    if vad:
        kwargs.update(vad_filter=True, vad_parameters={"min_silence_duration_ms": 500})
    segments, info = model.transcribe(audio_path, **kwargs)
    text = " ".join(seg.text.strip() for seg in segments).strip()
    return text, info


def _best_supported_language(info) -> str | None:
    """If Whisper's top guess is outside en/ta/hi (it often calls Tamil 'Malayalam', or Hindi 'Urdu'),
    take the most likely of the three languages we actually support."""
    probs = getattr(info, "all_language_probs", None)
    if not probs:
        return None
    ranked = [(lang, p) for lang, p in probs if lang in SUPPORTED]
    return max(ranked, key=lambda x: x[1])[0] if ranked else None


def transcribe(audio_path: str, model_size: str | None = None, initial_prompt: str | None = None,
               language: str | None = None) -> dict:
    """Speech-to-text.

    language: "en" | "ta" | "hi" forces that language (fastest and most accurate, since Whisper
    skips language detection); None lets Whisper detect it, restricted to the supported three.
    Voice-activity detection trims silence; if it removes everything, the audio is retried without it.
    """
    if language is not None and language not in SUPPORTED:
        raise ValueError(f"language must be one of {SUPPORTED} or None")
    try:
        model = _load_model(model_size or DEFAULT_MODEL)
    except ImportError:
        raise RuntimeError("Speech-to-text is not installed. Run: pip install faster-whisper") from None

    def prompt_for(lang):
        return initial_prompt if initial_prompt is not None else (ENGLISH_PROMPT if lang == "en" else None)

    text, info = _run(model, audio_path, language, True, prompt_for(language))
    detected = language or info.language
    if language is None and detected not in SUPPORTED:
        fixed = _best_supported_language(info)
        if fixed:
            detected = fixed
            text, info = _run(model, audio_path, fixed, True, prompt_for(fixed))
    if not text:  # VAD can drop quiet speech entirely; one retry without it
        text, info = _run(model, audio_path, detected if detected in SUPPORTED else language, False,
                          prompt_for(detected))

    return {
        "text": text,
        "detected_language": detected if language is None else language,
        "language_probability": round(1.0 if language else info.language_probability, 3),
    }


def speak(text: str, output_path: str | None = None) -> str:
    """Text-to-speech via the OS speech engine. If output_path is given,
    saves to a .wav/.mp3 file instead of speaking immediately — this is
    the mode the API uses, since a server process shouldn't play audio
    out loud on whatever machine it happens to run on."""
    try:
        import pyttsx3
    except ImportError:
        raise RuntimeError("Run: pip install pyttsx3") from None

    engine = pyttsx3.init()
    if output_path:
        engine.save_to_file(text, output_path)
        engine.runAndWait()
        return output_path
    else:
        engine.say(text)
        engine.runAndWait()
        return "(spoken aloud, no file saved)"


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="CloudSentinel voice I/O")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--stt", metavar="AUDIO_PATH", help="Transcribe an audio file to text")
    parser.add_argument("--lang", choices=SUPPORTED, default=None, help="For --stt: spoken language (auto-detected if omitted)")
    group.add_argument("--tts", metavar="TEXT", help="Speak text aloud")
    parser.add_argument("--out", default=None, help="For --tts: save to this file instead of speaking aloud")
    args = parser.parse_args()

    if args.stt:
        result = transcribe(args.stt, language=args.lang)
        print(f"Detected language: {result['detected_language']} (p={result['language_probability']})")
        print(f"Transcript: {result['text']}")
    else:
        result = speak(args.tts, args.out)
        print(f"Done: {result}")
