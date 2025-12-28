from fastapi import APIRouter, Depends

from .auth import _get_current_user
from .models import AppState, UserPublic
from .state import _load_state, _normalize_state, _save_state

router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/v1/state", response_model=AppState)
def get_state(current_user: UserPublic = Depends(_get_current_user)):
    return _load_state(current_user.username)


@router.post("/v1/state", response_model=AppState)
def set_state(payload: AppState, current_user: UserPublic = Depends(_get_current_user)):
    normalized, _ = _normalize_state(payload)
    _save_state(normalized, current_user.username)
    return normalized
