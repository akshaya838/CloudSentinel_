from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.responses import error, success
from app.core.security import create_access_token
from app.database.connection import get_db
from app.models import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["Auth"])


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _raise(e: auth_service.AuthError):
    headers = {"Retry-After": str(e.retry_after)} if e.retry_after else None
    raise HTTPException(e.status, detail=error(e.code, e.message), headers=headers)


@router.post("/login")
def login(req: LoginRequest, request: Request, db: Session = Depends(get_db)):
    try:
        user = auth_service.authenticate(db, req.email, req.password, _ip(request))
    except auth_service.AuthError as e:
        _raise(e)
    return success({
        "access_token": create_access_token(user.id, user.role),
        "token_type": "bearer",
        "expires_in": settings.JWT_EXPIRE_MINUTES * 60,
        "user": auth_service.user_out(user),
    }, "Signed in")


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return success(auth_service.user_out(user))


@router.post("/change-password")
def change_password(req: ChangePasswordRequest, request: Request,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        auth_service.change_password(db, user, req.current_password, req.new_password, _ip(request))
    except auth_service.AuthError as e:
        _raise(e)
    return success({}, "Password updated")
