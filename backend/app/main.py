"""
CloudSentinel - Backend Entrypoint

Run from backend/ directory:
    uvicorn app.main:app --reload --port 8000

Swagger UI:  http://localhost:8000/docs
ReDoc:       http://localhost:8000/redoc

Access control (enforced here, per router, regardless of what the UI hides):
    viewer   dashboard, CVE explorer/detail, entity linking
    analyst  + search, assistant, classification, topics, duplicates, reports, voice
    admin    + data pipeline, user management, audit log
"""

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app import models  # noqa: F401  (registers tables on Base.metadata)
from app.api.deps import require_roles
from app.api.routes import (
    admin, assistant, auth, classification, cves, dashboard, duplicates,
    entities, health, pipeline, reports, topics, translation, voice,
)
from app.core.config import settings
from app.core.logging import configure_logging, logger
from app.database.connection import Base, SessionLocal, engine
from app.services import auth_service, warmup

configure_logging()


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(engine)
    if settings.SEED_DEMO_USERS:
        with SessionLocal() as db:
            created = auth_service.seed_demo_users(db)
        if created:
            logger.warning("Seeded DEMO users (development only): %s", ", ".join(created))
    warmup.start_warmup()  # models load in the background; requests are served meanwhile
    yield


app = FastAPI(
    title=settings.APP_NAME,
    description="CloudSentinel: privacy-first, locally processed CVE vulnerability intelligence with a voice-first multilingual assistant.",
    version="0.2.0-phase2",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


if settings.EDA_DIR.exists():
    app.mount("/static/eda", StaticFiles(directory=str(settings.EDA_DIR)), name="eda-charts")

ALL_ROLES = ["viewer", "analyst", "admin"]
ANALYST_UP = ["analyst", "admin"]
P = settings.API_V1_PREFIX

# Public: health and the auth endpoints (which enforce auth themselves where needed)
app.include_router(health.router)
app.include_router(auth.router, prefix=P)

# Any signed-in user
for r in (dashboard.router, cves.router, entities.router):
    app.include_router(r, prefix=P, dependencies=[Depends(require_roles(*ALL_ROLES))])

# Analysts and admins
for r in (classification.router, assistant.router, topics.router, duplicates.router,
          reports.router, voice.router, translation.router):
    app.include_router(r, prefix=P, dependencies=[Depends(require_roles(*ANALYST_UP))])

# Admins only
for r in (pipeline.router, admin.router):
    app.include_router(r, prefix=P, dependencies=[Depends(require_roles("admin"))])
