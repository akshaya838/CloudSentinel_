from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.responses import error, success
from app.database.connection import get_db
from app.models import User
from app.schemas.auth import CreateUserRequest
from app.services import auth_service

# Router-level admin-only dependency is applied in main.py; the per-route
# dependency below is also needed to know *who* the acting admin is.
router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/users")
def users(db: Session = Depends(get_db)):
    return success(auth_service.list_users(db))


@router.post("/users", status_code=201)
def create_user(req: CreateUserRequest, request: Request,
                admin: User = Depends(require_roles("admin")), db: Session = Depends(get_db)):
    try:
        user = auth_service.create_user(db, req.email, req.full_name, req.role, req.password,
                                        actor=admin, ip=request.client.host if request.client else None)
    except auth_service.AuthError as e:
        raise HTTPException(e.status, detail=error(e.code, e.message))
    return success(auth_service.user_out(user), "User created")


@router.get("/audit-logs")
def audit_logs(limit: int = 100, db: Session = Depends(get_db)):
    return success(auth_service.list_audit(db, max(1, min(limit, 500))))
