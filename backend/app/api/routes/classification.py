from fastapi import APIRouter
from pydantic import BaseModel

from app.core.responses import success
from app.services import classification_service

router = APIRouter(prefix="/classification", tags=["Classification"])


class ClassifyRequest(BaseModel):
    text: str


@router.post("")
def classify(req: ClassifyRequest):
    return success(classification_service.classify_text(req.text))
