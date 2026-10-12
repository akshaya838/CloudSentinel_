import os
import tempfile
from pathlib import Path

from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.core.config import settings
from app.core.logging import logger
from app.core.responses import error, success
from app.services import voice_service

router = APIRouter(prefix="/voice", tags=["Voice"])

# What browsers produce: Chrome/Edge record webm, Firefox ogg, Safari mp4.
_TYPE_SUFFIX = {
    "audio/webm": ".webm", "video/webm": ".webm", "audio/ogg": ".ogg", "audio/mp4": ".mp4",
    "audio/x-m4a": ".m4a", "audio/m4a": ".m4a", "audio/mpeg": ".mp3", "audio/mp3": ".mp3",
    "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/wave": ".wav",
}


class SpeakRequest(BaseModel):
    text: str


def _suffix_for(upload: UploadFile) -> str:
    content_type = (upload.content_type or "").split(";")[0].strip().lower()
    if content_type not in _TYPE_SUFFIX and not content_type.startswith("audio/"):
        raise HTTPException(415, detail=error("UNSUPPORTED_AUDIO_TYPE", "Upload an audio recording (webm, ogg, mp4, mp3 or wav)."))
    return _TYPE_SUFFIX.get(content_type, ".audio")


@router.post("/transcribe")
async def transcribe(file: UploadFile = File(...), language: Optional[str] = Form(None)):
    # "auto"/empty -> let Whisper detect; otherwise force en/ta/hi (faster and more accurate)
    language = (language or "").strip().lower() or None
    if language == "auto":
        language = None
    if language not in (None, "en", "ta", "hi"):
        raise HTTPException(422, detail=error("UNSUPPORTED_LANGUAGE", "Language must be auto, en, ta or hi."))
    suffix = _suffix_for(file)
    data = await file.read(settings.MAX_AUDIO_BYTES + 1)  # never read more than the cap into memory
    if len(data) > settings.MAX_AUDIO_BYTES:
        mb = settings.MAX_AUDIO_BYTES // (1024 * 1024)
        raise HTTPException(413, detail=error("AUDIO_TOO_LARGE", f"The recording is larger than {mb} MB."))
    if not data:
        raise HTTPException(400, detail=error("EMPTY_AUDIO", "No audio was received."))

    # A private temp file per request: concurrent users never overwrite each other's audio,
    # and it is always deleted, even if transcription fails.
    fd, path = tempfile.mkstemp(prefix="voice-", suffix=suffix)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        # Whisper is CPU-heavy and blocking: run it off the event loop so other requests keep flowing.
        result = await run_in_threadpool(voice_service.transcribe_audio, path, language)
    except RuntimeError as e:  # our own "not installed" messages
        raise HTTPException(503, detail=error("VOICE_UNAVAILABLE", str(e)))
    except Exception:
        logger.exception("transcription failed")
        raise HTTPException(503, detail=error(
            "TRANSCRIPTION_FAILED", "Could not transcribe this recording. Please try again."))
    finally:
        Path(path).unlink(missing_ok=True)
    return success(result)


@router.post("/speak")
def speak(req: SpeakRequest):
    out_path = Path("outputs/_tmp_speech.wav")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        voice_service.synthesize_speech(req.text, str(out_path))
    except Exception as e:
        raise HTTPException(status_code=503, detail=error("VOICE_UNAVAILABLE", str(e)))
    return FileResponse(str(out_path), media_type="audio/wav")
