"""Authentication / authorisation dependencies shared by every protected route."""

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.responses import error
from app.core.security import decode_access_token
from app.database.connection import get_db
from app.models import User

bearer = HTTPBearer(auto_error=False)


def _unauthenticated(message: str = "Authentication required.") -> HTTPException:
    return HTTPException(401, detail=error("UNAUTHENTICATED", message), headers={"WWW-Authenticate": "Bearer"})


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None or creds.scheme.lower() != "bearer":
        raise _unauthenticated()
    try:
        payload = decode_access_token(creds.credentials)
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise _unauthenticated("Your session has expired. Please sign in again.")
    except (jwt.PyJWTError, KeyError, ValueError):
        raise _unauthenticated("Invalid authentication token.")

    # Role and active-status always come from the database, never from the token,
    # so disabling an account or changing a role takes effect immediately.
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthenticated("This account no longer exists or has been disabled.")
    return user


def require_roles(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(
                403,
                detail=error("FORBIDDEN", f"Your role ({user.role}) does not have access to this resource."),
            )
        return user

    return checker
