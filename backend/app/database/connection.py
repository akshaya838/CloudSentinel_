from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url, URL
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def _build_engine():
    url = make_url(settings.DATABASE_URL) if settings.DATABASE_URL else URL.create(
        "sqlite", database=str(settings.DEFAULT_SQLITE_PATH)
    )
    if url.get_backend_name() == "sqlite":
        if url.database:
            Path(url.database).parent.mkdir(parents=True, exist_ok=True)
        return create_engine(url, connect_args={"check_same_thread": False})
    return create_engine(url, pool_pre_ping=True)


engine = _build_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
