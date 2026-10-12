"""Authentication, authorisation (roles), lockout, password and audit behaviour."""
import time
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.core.config import settings
from tests.conftest import PASSWORDS, email_for

PROTECTED = [
    ("get", "/api/v1/dashboard"),
    ("get", "/api/v1/cves"),
    ("get", "/api/v1/auth/me"),
    ("post", "/api/v1/classification"),
    ("get", "/api/v1/pipeline/status"),
    ("get", "/api/v1/admin/users"),
]


def login(client, email, password):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


@pytest.mark.parametrize("method,path", PROTECTED)
def test_every_protected_endpoint_rejects_anonymous_requests(client, method, path):
    r = getattr(client, method)(path, **({"json": {}} if method == "post" else {}))
    assert r.status_code == 401
    assert r.json()["detail"]["error"]["code"] == "UNAUTHENTICATED"
    assert r.headers["www-authenticate"] == "Bearer"


def test_login_success_returns_token_and_user_without_password_hash(client):
    r = login(client, email_for("analyst"), PASSWORDS["analyst"])
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["token_type"] == "bearer" and data["expires_in"] > 0
    assert data["user"]["role"] == "analyst"
    assert "hashed_password" not in data["user"] and "password" not in data["user"]


def test_login_is_case_insensitive_on_email(client):
    assert login(client, email_for("viewer").upper(), PASSWORDS["viewer"]).status_code == 200


def test_wrong_password_and_unknown_email_give_the_same_error(client):
    wrong_pw = login(client, email_for("admin"), "definitely-wrong-1")
    unknown = login(client, "nobody@test.example", "definitely-wrong-1")
    assert wrong_pw.status_code == unknown.status_code == 401
    assert wrong_pw.json()["detail"] == unknown.json()["detail"]  # no user enumeration
    assert wrong_pw.json()["detail"]["error"]["code"] == "INVALID_CREDENTIALS"


def test_passwords_are_stored_as_bcrypt_hashes(client):
    from app.database.connection import SessionLocal
    from app.models import User
    with SessionLocal() as db:
        for user in db.query(User).all():
            assert user.hashed_password.startswith("$2")
            assert user.hashed_password not in PASSWORDS.values()


def test_me_returns_current_user(client, tokens):
    r = client.get("/api/v1/auth/me", headers=tokens["viewer"])
    assert r.status_code == 200 and r.json()["data"]["email"] == email_for("viewer")


def test_garbage_wrong_secret_and_expired_tokens_are_rejected(client):
    assert client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not.a.jwt"}).status_code == 401
    forged = jwt.encode({"sub": "1", "exp": datetime.now(timezone.utc) + timedelta(hours=1)}, "wrong-secret-xxxxxxxxxxxxxxxxxxxxxxxx", algorithm="HS256")
    assert client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401
    expired = jwt.encode({"sub": "1", "exp": datetime.now(timezone.utc) - timedelta(seconds=30)}, settings.JWT_SECRET, algorithm="HS256")
    r = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and "expired" in r.json()["detail"]["error"]["message"].lower()


def test_viewer_can_read_but_not_use_analyst_features(client, tokens):
    h = tokens["viewer"]
    assert client.get("/api/v1/dashboard", headers=h).status_code == 200
    for method, path in [("post", "/api/v1/classification"), ("get", "/api/v1/topics"),
                         ("post", "/api/v1/assistant"), ("get", "/api/v1/reports/weekly-brief"),
                         ("get", "/api/v1/pipeline/status"), ("get", "/api/v1/admin/users")]:
        r = getattr(client, method)(path, headers=h, **({"json": {}} if method == "post" else {}))
        assert r.status_code == 403, path
        assert r.json()["detail"]["error"]["code"] == "FORBIDDEN"


def test_analyst_cannot_reach_admin_only_endpoints(client, tokens):
    h = tokens["analyst"]
    assert client.get("/api/v1/pipeline/status", headers=h).status_code == 403
    assert client.get("/api/v1/admin/users", headers=h).status_code == 403
    assert client.get("/api/v1/admin/audit-logs", headers=h).status_code == 403


def test_admin_can_reach_everything_and_user_list_hides_hashes(client, tokens):
    h = tokens["admin"]
    assert client.get("/api/v1/pipeline/status", headers=h).status_code == 200
    users = client.get("/api/v1/admin/users", headers=h).json()["data"]
    assert {u["role"] for u in users} >= {"admin", "analyst", "viewer"}
    assert all("hashed_password" not in u for u in users)


def test_audit_log_records_sign_ins_and_failures(client, tokens):
    login(client, email_for("viewer"), "wrong-password-1")
    events = client.get("/api/v1/admin/audit-logs", headers=tokens["admin"]).json()["data"]
    names = {e["event"] for e in events}
    assert {"login_success", "login_failure", "user_created"} <= names
    assert not any("wrong-password-1" in (e["detail"] or "") for e in events)  # passwords never logged


def test_repeated_failures_lock_out_even_the_correct_password(client):
    for _ in range(settings.LOGIN_MAX_ATTEMPTS):
        assert login(client, email_for("viewer"), "wrong-password-1").status_code == 401
    locked = login(client, email_for("viewer"), PASSWORDS["viewer"])
    assert locked.status_code == 429
    assert locked.json()["detail"]["error"]["code"] == "TOO_MANY_ATTEMPTS"
    assert int(locked.headers["retry-after"]) > 0


def test_admin_creates_user_who_can_then_sign_in(client, tokens):
    body = {"email": "New.Hire@test.example", "full_name": "New Hire", "role": "viewer", "password": "FreshPass#2026"}
    r = client.post("/api/v1/admin/users", json=body, headers=tokens["admin"])
    assert r.status_code == 201 and r.json()["data"]["email"] == "new.hire@test.example"
    assert login(client, "new.hire@test.example", "FreshPass#2026").status_code == 200
    dup = client.post("/api/v1/admin/users", json=body, headers=tokens["admin"])
    assert dup.status_code == 409 and dup.json()["detail"]["error"]["code"] == "EMAIL_EXISTS"


def test_create_user_enforces_password_policy_and_admin_role(client, tokens):
    weak = {"email": "weak@test.example", "full_name": "Weak", "role": "viewer", "password": "short1"}
    r = client.post("/api/v1/admin/users", json=weak, headers=tokens["admin"])
    assert r.status_code == 400 and r.json()["detail"]["error"]["code"] == "WEAK_PASSWORD"
    assert client.post("/api/v1/admin/users", json=weak, headers=tokens["analyst"]).status_code == 403
    bad_role = {**weak, "role": "superuser", "password": "LongEnough#2026"}
    assert client.post("/api/v1/admin/users", json=bad_role, headers=tokens["admin"]).status_code == 422


def test_change_password_flow(client, tokens):
    client.post("/api/v1/admin/users", headers=tokens["admin"], json={
        "email": "pwchange@test.example", "full_name": "Pw Change", "role": "viewer", "password": "OriginalPass#1"})
    token = login(client, "pwchange@test.example", "OriginalPass#1").json()["data"]["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    url = "/api/v1/auth/change-password"

    wrong = client.post(url, headers=h, json={"current_password": "nope-nope-1", "new_password": "BrandNewPass#2"})
    assert wrong.status_code == 400 and wrong.json()["detail"]["error"]["code"] == "INVALID_CURRENT_PASSWORD"
    weak = client.post(url, headers=h, json={"current_password": "OriginalPass#1", "new_password": "weak"})
    assert weak.json()["detail"]["error"]["code"] == "WEAK_PASSWORD"
    same = client.post(url, headers=h, json={"current_password": "OriginalPass#1", "new_password": "OriginalPass#1"})
    assert same.json()["detail"]["error"]["code"] == "PASSWORD_REUSED"

    ok = client.post(url, headers=h, json={"current_password": "OriginalPass#1", "new_password": "BrandNewPass#2"})
    assert ok.status_code == 200
    assert login(client, "pwchange@test.example", "OriginalPass#1").status_code == 401
    assert login(client, "pwchange@test.example", "BrandNewPass#2").status_code == 200


def test_disabling_an_account_invalidates_its_existing_token(client, tokens):
    from app.database.connection import SessionLocal
    from app.models import User
    client.post("/api/v1/admin/users", headers=tokens["admin"], json={
        "email": "leaver@test.example", "full_name": "Leaver", "role": "analyst", "password": "LeaverPass#2026"})
    token = login(client, "leaver@test.example", "LeaverPass#2026").json()["data"]["access_token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200

    with SessionLocal() as db:
        db.query(User).filter(User.email == "leaver@test.example").update({"is_active": False})
        db.commit()
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401
    assert login(client, "leaver@test.example", "LeaverPass#2026").status_code == 401


def test_security_headers_present(client):
    r = client.get("/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"
