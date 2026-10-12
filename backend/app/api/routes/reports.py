"""
Reports: extractive-summarization briefing is real and working now.
PDF/CSV export and the other report types (Section 33) need persistence
and a templating layer not yet built — honestly stubbed as 501, not faked.
"""
from fastapi import APIRouter, HTTPException
from app.core.responses import success, error
from app.services import summarization_service

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get("/weekly-brief")
def weekly_brief(severity: str | None = None, top_n: int = 5):
    try:
        return success(summarization_service.summarize(severity, top_n))
    except Exception as e:
        raise HTTPException(status_code=503, detail=error("SUMMARIZATION_UNAVAILABLE", str(e)))


@router.post("/export")
def export_report():
    raise HTTPException(
        status_code=501,
        detail=error("NOT_IMPLEMENTED", "PDF/CSV export is planned for a later phase and is not yet built."),
    )
