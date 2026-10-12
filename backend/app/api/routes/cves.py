from typing import Optional

from fastapi import APIRouter, HTTPException

from app.core.responses import success, error
from app.services import cve_service

router = APIRouter(prefix="/cves", tags=["CVEs"])


@router.get("")
def list_cves(
    severity: Optional[str] = None,
    cwe: Optional[str] = None,
    search: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
):
    try:
        return success(cve_service.list_cves(severity, cwe, search, page, page_size))
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=error("DATA_NOT_READY", str(e)))


@router.get("/stats")
def stats():
    try:
        return success(cve_service.get_stats())
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=error("DATA_NOT_READY", str(e)))


@router.get("/{cve_id}")
def get_cve(cve_id: str):
    record = cve_service.get_cve(cve_id)
    if record is None:
        raise HTTPException(status_code=404, detail=error("CVE_NOT_FOUND", f"{cve_id} was not found in the processed dataset"))
    return success(record)
