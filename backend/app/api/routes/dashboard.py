from fastapi import APIRouter, HTTPException

from app.core.responses import success, error
from app.services import cve_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("")
def get_dashboard():
    try:
        kpis = cve_service.get_dashboard_kpis()
        top_products = cve_service.get_top_products()
        return success({"kpis": kpis, "top_products": top_products})
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=error("DATA_NOT_READY", str(e)))
