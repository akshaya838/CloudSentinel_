from fastapi import APIRouter, HTTPException
from app.core.responses import success, error
from app.services import topic_service

router = APIRouter(prefix="/topics", tags=["Topic Discovery"])


@router.get("")
def get_topics(k: int = 5):
    try:
        return success(topic_service.get_topics(k))
    except Exception as e:
        raise HTTPException(status_code=503, detail=error("TOPIC_MODELING_UNAVAILABLE", str(e)))
