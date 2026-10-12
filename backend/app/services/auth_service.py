"""Authentication, user management, audit logging and login throttling."""

import os
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logging import logger
from app.core.security import hash_password, validate_password_policy, verify_password
from app.models import AuditLog, User


class AuthError(Exception):
    def __init__(self, code: str, message: str, status: int, retry_after: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.retry_after = retry_after


class LoginLimiter:
    """In-memory failed-login throttle keyed by (client ip, email).

    Good enough for a single backend process. With several workers or
    instances this must move to a shared store (e.g. Redis)."""

    def __init__(self) -> None:
        self._fails: dict[tuple, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def retry_after(self, key: tuple) -> int:
        with self._lock:
            q = self._fails.get(key)
            if not q:
                return 0
            now = time.monotonic()
            while q and now - q[0] > settings.LOGIN_WINDOW_SECONDS:
                q.popleft()
            if len(q) < settings.LOGIN_MAX_ATTEMPTS:
                return 0
            return max(1, int(settings.LOGIN_WINDOW_SECONDS - (now - q[0])) + 1)

    def record_failure(self, key: tuple) -> None:
        with self._lock:
            self._fails[key].append(time.monotonic())

    def reset(self, key: tuple) -> None:
        with self._lock:
            self._fails.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._fails.clear()


login_limiter = LoginLimiter()
_dummy_hash: str | None = None


def _timing_dummy_hash() -> str:
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password("timing-equalisation-only-0")
    return _dummy_hash


def user_out(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def record_audit(db: Session, event: str, user: User | None = None, email: str | None = None,
                 ip: str | None = None, detail: str | None = None) -> None:
    db.add(AuditLog(
        event=event,
        user_id=user.id if user else None,
        user_email=(user.email if user else email),
        ip=ip,
        detail=detail,
    ))
    db.commit()
    logger.info("audit event=%s user=%s ip=%s", event, user.email if user else email, ip)


def authenticate(db: Session, email: str, password: str, ip: str) -> User:
    email_n = email.strip().lower()
    key = (ip, email_n)

    wait = login_limiter.retry_after(key)
    if wait:
        record_audit(db, "login_locked", email=email_n, ip=ip, detail=f"throttled for ~{wait}s")
        raise AuthError("TOO_MANY_ATTEMPTS", f"Too many failed sign-in attempts. Try again in {wait} seconds.",
                        429, retry_after=wait)

    user = db.scalar(select(User).where(User.email == email_n))
    if user is not None and user.is_active:
        ok = verify_password(password, user.hashed_password)
    else:
        verify_password(password, _timing_dummy_hash())  # keep timing similar for unknown/disabled accounts
        ok = False

    if not ok:
        login_limiter.record_failure(key)
        record_audit(db, "login_failure", email=email_n, ip=ip)
        # One generic message: never reveal whether the email exists or the account is disabled.
        raise AuthError("INVALID_CREDENTIALS", "Invalid email or password.", 401)

    login_limiter.reset(key)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    record_audit(db, "login_success", user=user, ip=ip)
    return user


def change_password(db: Session, user: User, current: str, new: str, ip: str | None = None) -> None:
    if not verify_password(current, user.hashed_password):
        record_audit(db, "password_change_failed", user=user, ip=ip, detail="wrong current password")
        raise AuthError("INVALID_CURRENT_PASSWORD", "Current password is incorrect.", 400)
    problem = validate_password_policy(new)
    if problem:
        raise AuthError("WEAK_PASSWORD", problem, 400)
    if verify_password(new, user.hashed_password):
        raise AuthError("PASSWORD_REUSED", "New password must be different from the current password.", 400)
    user.hashed_password = hash_password(new)
    db.commit()
    record_audit(db, "password_changed", user=user, ip=ip)


def create_user(db: Session, email: str, full_name: str, role: str, password: str,
                actor: User | None = None, ip: str | None = None) -> User:
    email_n = email.strip().lower()
    problem = validate_password_policy(password)
    if problem:
        raise AuthError("WEAK_PASSWORD", problem, 400)
    if db.scalar(select(User).where(User.email == email_n)) is not None:
        raise AuthError("EMAIL_EXISTS", "A user with that email already exists.", 409)
    user = User(email=email_n, full_name=full_name.strip(), role=role, hashed_password=hash_password(password))
    db.add(user)
    db.commit()
    record_audit(db, "user_created", user=user, ip=ip,
                 detail=f"role={role} created_by={actor.email if actor else 'system'}")
    return user


# Demo accounts for local development ONLY. Never seeded when ENVIRONMENT=production.
# Override the passwords with the DEMO_*_PASSWORD environment variables.
_DEMO_USERS = [
    ("admin@cloudco.example", "Platform Admin", "admin", "DEMO_ADMIN_PASSWORD", "Admin#2026Demo"),
    ("analyst@cloudco.example", "Security Engineer", "analyst", "DEMO_ANALYST_PASSWORD", "Analyst#2026Demo"),
    ("viewer@cloudco.example", "Cloud Engineer", "viewer", "DEMO_VIEWER_PASSWORD", "Viewer#2026Demo"),
]


def seed_demo_users(db: Session) -> list[str]:
    if db.scalar(select(func.count()).select_from(User)):
        return []
    created = []
    for email, name, role, env_name, default_pw in _DEMO_USERS:
        create_user(db, email, name, role, os.getenv(env_name, default_pw))
        created.append(email)
    return created


def list_users(db: Session) -> list[dict]:
    return [user_out(u) for u in db.scalars(select(User).order_by(User.id))]


def list_audit(db: Session, limit: int = 100) -> list[dict]:
    rows = db.scalars(select(AuditLog).order_by(AuditLog.id.desc()).limit(limit))
    return [{
        "id": r.id, "created_at": r.created_at.isoformat(), "event": r.event,
        "user_email": r.user_email, "ip": r.ip, "detail": r.detail,
    } for r in rows]
