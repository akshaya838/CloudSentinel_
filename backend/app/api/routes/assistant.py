from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.core.logging import logger
from app.core.responses import error, success
from app.services import assistant_service

router = APIRouter(tags=["AI Assistant"])

Lang = Literal["en", "ta", "hi"]


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


class HistoryTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=1500)
    sources: list[str] = Field(default_factory=list, max_length=10)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    target_lang: Optional[Lang] = None
    top_k: int = Field(default=3, ge=1, le=10)
    history: list[HistoryTurn] = Field(default_factory=list, max_length=12)  # earlier turns, for follow-ups
    translate_sources: bool = False  # off by default: translating every source adds seconds and nobody listens to them


@router.post("/search")
async def search(req: SearchRequest):
    try:
        return success(await run_in_threadpool(assistant_service.search, req.query, req.top_k))
    except Exception as e:
        raise HTTPException(status_code=503, detail=error("SEARCH_UNAVAILABLE", str(e)))


@router.post("/assistant")
async def ask(req: AskRequest):
    # Blocking model work runs in a worker thread so one slow question never freezes the server.
    try:
        data = await run_in_threadpool(
            assistant_service.ask, req.question, req.target_lang, req.top_k,
            [t.model_dump() for t in req.history], req.translate_sources,
        )
        return success(data)
    except (Exception, SystemExit) as e:  # the translator exits (not raises) when its libraries are missing
        logger.exception("assistant failed")
        # only messages written for users are shown; anything else (paths, library errors) stays in the log
        safe = isinstance(e, (FileNotFoundError, assistant_service.AssistantError)) and str(e)
        msg = str(e) if safe else "The assistant is unavailable right now. Please try again."
        raise HTTPException(status_code=503, detail=error("ASSISTANT_UNAVAILABLE", msg))
