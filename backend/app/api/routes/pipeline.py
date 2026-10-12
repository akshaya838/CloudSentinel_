"""
Data Pipeline control page backend. Running the pipeline live from an API
call (rather than a developer running the scripts manually) needs a
background-task/job-queue layer not yet built — honestly stubbed as 501.
"""
from fastapi import APIRouter, HTTPException
from app.core.responses import success, error
from app.core.config import settings

router = APIRouter(prefix="/pipeline", tags=["Data Pipeline"])


@router.get("/status")
def status():
    stages = [
        {"stage": "Raw Data", "status": "complete" if settings.DATA_RAW.exists() else "pending"},
        {"stage": "ETL (Clean + Normalize)", "status": "complete" if settings.DATA_PROCESSED.exists() else "pending"},
        {"stage": "EDA Charts", "status": "complete" if settings.EDA_DIR.exists() and any(settings.EDA_DIR.glob("*.png")) else "pending"},
        {"stage": "Vector Indexing", "status": "complete" if settings.CHROMA_DIR.exists() else "pending"},
    ]
    return success({"stages": stages})


@router.post("/run")
def run_pipeline():
    raise HTTPException(
        status_code=501,
        detail=error("NOT_IMPLEMENTED", "Triggering the pipeline from the API (vs. running scripts manually) needs a background-job layer not yet built."),
    )
