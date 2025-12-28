import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import _ensure_admin_user, router as auth_router
from .db import _get_connection
from .ical_routes import router as ical_router
from .pdf import router as pdf_router
from .solver import router as solver_router
from .state_routes import router as state_router
from .web import router as web_router

app = FastAPI(title="Weekly Schedule API", version="0.1.0")

CORS_ALLOW_ORIGINS = os.environ.get("CORS_ALLOW_ORIGINS", "")
CORS_ALLOW_ORIGIN_REGEX = os.environ.get(
    "CORS_ALLOW_ORIGIN_REGEX", r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"
)
_allowed_origins = [origin.strip() for origin in CORS_ALLOW_ORIGINS.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_origin_regex=None if _allowed_origins else CORS_ALLOW_ORIGIN_REGEX,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    conn = _get_connection()
    conn.close()
    _ensure_admin_user()


app.include_router(auth_router)
app.include_router(state_router)
app.include_router(web_router)
app.include_router(pdf_router)
app.include_router(ical_router)
app.include_router(solver_router)
