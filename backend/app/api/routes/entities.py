from fastapi import APIRouter
from pydantic import BaseModel

from app.core.responses import success
from app.services import entity_linking_service

router = APIRouter(prefix="/entities", tags=["Entity Intelligence"])


class LinkRequest(BaseModel):
    text: str


@router.post("/link")
def link(req: LinkRequest):
    return success(entity_linking_service.link_entities(req.text))
