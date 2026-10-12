from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.core.logging import logger
from app.core.responses import error, success
from app.services import translation_service

router = APIRouter(prefix="/translation", tags=["Translation"])

Lang = Literal["en", "ta", "hi"]


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    target_lang: Lang
    source_lang: Optional[Lang] = None  # auto-detected from the script when omitted


@router.post("")
def translate(req: TranslateRequest):
    try:
        return success(translation_service.translate(req.text, req.target_lang, req.source_lang))
    except (Exception, SystemExit):  # the translator exits (not raises) when its libraries are missing
        logger.exception("translation failed")
        raise HTTPException(503, detail=error(
            "TRANSLATION_UNAVAILABLE",
            "Translation is unavailable right now. The translation model may not be downloaded yet."))
