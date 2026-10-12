from fastapi import APIRouter, HTTPException
from app.core.responses import success, error
from app.services import duplicate_service

router = APIRouter(prefix="/duplicates", tags=["Duplicate Detection"])


@router.get("")
def get_duplicates(threshold: float = 0.85):
    try:
        return success(duplicate_service.find_duplicates(threshold))
    except Exception as e:
        raise HTTPException(status_code=503, detail=error("DUPLICATE_DETECTION_UNAVAILABLE", str(e)))
