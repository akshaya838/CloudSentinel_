"""
Test fixtures. Environment is set BEFORE the app is imported so the tests use a
throwaway SQLite database and a fixed test JWT secret (never the dev database).
"""
import os
import sys
import tempfile
from pathlib import Path

# Make the project root importable so tests can import the `ml` package directly.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

_TMP = Path(tempfile.mkdtemp(prefix="cve-test-"))
os.environ.update({
    "ENVIRONMENT": "test",
    "DATABASE_URL": f"sqlite:///{(_TMP / 'test.db').as_posix()}",
    "JWT_SECRET": "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz",
    "BCRYPT_ROUNDS": "4",
    "SEED_DEMO_USERS": "false",
})

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

PASSWORDS = {
    "admin": "AdminPass#12345",
    "analyst": "AnalystPass#12345",
    "viewer": "ViewerPass#12345",
}


def email_for(role: str) -> str:
    return f"{role}@test.example"


@pytest.fixture(scope="session")
def client():
    from app import models as _models  # noqa: F401
    from app.database.connection import Base, SessionLocal, engine
    from app.main import app as fastapi_app
    from app.services import auth_service

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        for role, password in PASSWORDS.items():
            auth_service.create_user(db, email_for(role), f"Test {role}", role, password)
    with TestClient(fastapi_app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_login_limiter():
    from app.services import auth_service
    auth_service.login_limiter.clear()
    yield
    auth_service.login_limiter.clear()


@pytest.fixture(scope="session")
def tokens(client):
    out = {}
    for role, password in PASSWORDS.items():
        r = client.post("/api/v1/auth/login", json={"email": email_for(role), "password": password})
        assert r.status_code == 200, r.text
        out[role] = {"Authorization": f"Bearer {r.json()['data']['access_token']}"}
    return out
