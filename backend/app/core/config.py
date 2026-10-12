"""
Centralized application settings, loaded from environment variables.

Auth model (Phase 2):
  * Users live in a SQL database (SQLite by default so it runs with zero setup;
    set DATABASE_URL to a PostgreSQL URL for a real deployment).
  * Sessions are short-lived JWTs signed with JWT_SECRET.
  * In production (ENVIRONMENT=production) JWT_SECRET is mandatory and demo
    users are never seeded.
"""

import logging
import os
import secrets
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = BACKEND_ROOT.parent
_log = logging.getLogger("cve_intelligence")

ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    return default if value is None else value.strip().lower() in {"1", "true", "yes", "on"}


def _resolve_jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET", "").strip()
    if secret:
        return secret
    if ENVIRONMENT == "production":
        raise RuntimeError("JWT_SECRET must be set when ENVIRONMENT=production")
    _log.warning(
        "JWT_SECRET is not set: using an ephemeral random secret. "
        "Everyone is signed out whenever the backend restarts."
    )
    return secrets.token_urlsafe(48)


class Settings:
    # --- Identity ---
    APP_NAME: str = "CloudSentinel"
    API_V1_PREFIX: str = "/api/v1"
    ENVIRONMENT: str = ENVIRONMENT
    REPO_ROOT: Path = REPO_ROOT

    # --- CORS ---
    CORS_ORIGINS: list[str] = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

    # --- Database ---
    # Empty -> SQLite file at data/app.db. Set to postgresql://... for Postgres
    # (Postgres path is written but not tested against a live Postgres yet).
    DATABASE_URL: str = os.getenv("DATABASE_URL", "").strip()
    DEFAULT_SQLITE_PATH: Path = REPO_ROOT / "data" / "app.db"

    # --- Auth ---
    JWT_SECRET: str = _resolve_jwt_secret()
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))
    BCRYPT_ROUNDS: int = int(os.getenv("BCRYPT_ROUNDS", "12"))
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_WINDOW_SECONDS: int = 300
    SEED_DEMO_USERS: bool = _env_bool("SEED_DEMO_USERS", ENVIRONMENT != "production")

    # --- ML / data paths ---
    DATA_RAW: Path = REPO_ROOT / "data" / "raw" / "cves_expanded.json"
    DATA_PROCESSED: Path = REPO_ROOT / "data" / "processed" / "cves_clean.csv"
    CHROMA_DIR: Path = REPO_ROOT / "data" / "processed" / "chroma_store"
    EDA_DIR: Path = REPO_ROOT / "outputs" / "eda"

    # --- Voice input ---
    MAX_AUDIO_BYTES: int = int(os.getenv("MAX_AUDIO_BYTES", str(10 * 1024 * 1024)))  # 10 MB ~ many minutes of speech

    # --- Warm-up: load the models in the background when the server starts ---
    WARMUP_ON_START: bool = _env_bool("WARMUP_ON_START", ENVIRONMENT != "test")

    # --- External model services ---
    OLLAMA_BASE_URL: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    MODEL_NAME: str = os.getenv("MODEL_NAME", "llama3.1")


settings = Settings()
