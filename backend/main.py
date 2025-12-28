import json
import os
import re
import secrets
import sqlite3
from email.utils import format_datetime, parsedate_to_datetime
from hashlib import sha256
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from jose import JWTError, jwt
from passlib.context import CryptContext
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright
from pydantic import BaseModel, Field, ValidationError
from ortools.sat.python import cp_model

try:
    from backend.ical import generate_ics
except ImportError:  # pragma: no cover
    from ical import generate_ics

RowKind = Literal["class", "pool"]
Role = Literal["admin", "user"]

SHIFT_ROW_SEPARATOR = "::"
DEFAULT_LOCATION_ID = "loc-default"
DEFAULT_LOCATION_NAME = "Default"
DEFAULT_SUB_SHIFT_MINUTES = 8 * 60
DEFAULT_SUB_SHIFT_START_MINUTES = 8 * 60
DEFAULT_SUB_SHIFT_START = "08:00"


class UserPublic(BaseModel):
    username: str
    role: Role
    active: bool


class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: Role = "user"
    importState: Optional[Dict[str, Any]] = None


class UserUpdateRequest(BaseModel):
    active: Optional[bool] = None
    role: Optional[Role] = None
    password: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class Location(BaseModel):
    id: str
    name: str


class SubShift(BaseModel):
    id: str
    name: str
    order: Literal[1, 2, 3]
    startTime: Optional[str] = None
    endTime: Optional[str] = None
    endDayOffset: Optional[int] = None
    hours: Optional[float] = None


class WorkplaceRow(BaseModel):
    id: str
    name: str
    kind: RowKind
    dotColorClass: str
    locationId: Optional[str] = None
    subShifts: List[SubShift] = Field(default_factory=list)


class VacationRange(BaseModel):
    id: str
    startISO: str
    endISO: str


class Holiday(BaseModel):
    dateISO: str
    name: str


class Clinician(BaseModel):
    id: str
    name: str
    qualifiedClassIds: List[str]
    preferredClassIds: List[str] = []
    vacations: List[VacationRange]
    workingHoursPerWeek: Optional[float] = None


class Assignment(BaseModel):
    id: str
    rowId: str
    dateISO: str
    clinicianId: str


class MinSlots(BaseModel):
    weekday: int
    weekend: int


class AppState(BaseModel):
    locations: List[Location] = Field(default_factory=list)
    locationsEnabled: bool = True
    rows: List[WorkplaceRow]
    clinicians: List[Clinician]
    assignments: List[Assignment]
    minSlotsByRowId: Dict[str, MinSlots]
    slotOverridesByKey: Dict[str, int] = Field(default_factory=dict)
    holidayCountry: Optional[str] = None
    holidayYear: Optional[int] = None
    holidays: List[Holiday] = Field(default_factory=list)
    publishedWeekStartISOs: List[str] = Field(default_factory=list)


class UserStateExport(BaseModel):
    version: int = 1
    exportedAt: str
    sourceUser: str
    state: AppState


class SolveDayRequest(BaseModel):
    dateISO: str
    only_fill_required: bool = False


class SolveDayResponse(BaseModel):
    dateISO: str
    assignments: List[Assignment]
    notes: List[str]


class IcalPublishRequest(BaseModel):
    pass


class IcalPublishAllLink(BaseModel):
    subscribeUrl: str


class IcalPublishClinicianLink(BaseModel):
    clinicianId: str
    clinicianName: str
    subscribeUrl: str


class IcalPublishStatus(BaseModel):
    published: bool
    all: Optional[IcalPublishAllLink] = None
    clinicians: List[IcalPublishClinicianLink] = Field(default_factory=list)


class WebPublishStatus(BaseModel):
    published: bool
    token: Optional[str] = None


def _build_shift_row_id(class_id: str, sub_shift_id: str) -> str:
    return f"{class_id}{SHIFT_ROW_SEPARATOR}{sub_shift_id}"


def _parse_shift_row_id(row_id: str) -> tuple[str, Optional[str]]:
    if SHIFT_ROW_SEPARATOR not in row_id:
        return row_id, None
    class_id, sub_shift_id = row_id.split(SHIFT_ROW_SEPARATOR, 1)
    return class_id, sub_shift_id or None


def _ensure_locations(locations: List[Location]) -> List[Location]:
    by_id = {loc.id: loc for loc in locations if loc.id}
    if DEFAULT_LOCATION_ID not in by_id:
        by_id[DEFAULT_LOCATION_ID] = Location(
            id=DEFAULT_LOCATION_ID, name=DEFAULT_LOCATION_NAME
        )
    return list(by_id.values())

def _parse_time_to_minutes(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    match = re.match(r"^(\d{1,2}):(\d{2})$", value.strip())
    if not match:
        return None
    hours = int(match.group(1))
    minutes = int(match.group(2))
    if hours < 0 or hours > 23 or minutes < 0 or minutes > 59:
        return None
    return hours * 60 + minutes


def _format_minutes(total_minutes: int) -> str:
    clamped = total_minutes % (24 * 60)
    hours = clamped // 60
    minutes = clamped % 60
    return f"{hours:02d}:{minutes:02d}"


def _normalize_sub_shifts(sub_shifts: List[SubShift]) -> List[SubShift]:
    if not sub_shifts:
        return [
            SubShift(
                id="s1",
                name="Shift 1",
                order=1,
                startTime=DEFAULT_SUB_SHIFT_START,
                endTime=_format_minutes(DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES),
            )
        ]
    used_orders = set()
    normalized: List[SubShift] = []
    for shift in sub_shifts:
        order = shift.order if shift.order in (1, 2, 3) else None
        if not order or order in used_orders:
            for candidate in (1, 2, 3):
                if candidate not in used_orders:
                    order = candidate
                    break
        if not order or order in used_orders:
            continue
        used_orders.add(order)
        shift_id = shift.id or f"s{order}"
        shift_name = shift.name or f"Shift {order}"
        start_minutes = _parse_time_to_minutes(shift.startTime)
        end_minutes = _parse_time_to_minutes(shift.endTime)
        raw_offset = shift.endDayOffset if isinstance(shift.endDayOffset, int) else 0
        end_day_offset = max(0, min(3, raw_offset))
        if start_minutes is None:
            start_minutes = DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES * (
                order - 1
            )
        legacy_hours = shift.hours if isinstance(shift.hours, (int, float)) else None
        duration_minutes = (
            int(max(0, legacy_hours) * 60) if legacy_hours is not None else DEFAULT_SUB_SHIFT_MINUTES
        )
        if end_minutes is None:
            end_minutes = start_minutes + duration_minutes
        normalized.append(
            SubShift(
                id=shift_id,
                name=shift_name,
                order=order,
                startTime=_format_minutes(start_minutes),
                endTime=_format_minutes(end_minutes),
                endDayOffset=end_day_offset,
            )
        )
    if not normalized:
        normalized.append(
            SubShift(
                id="s1",
                name="Shift 1",
                order=1,
                startTime=DEFAULT_SUB_SHIFT_START,
                endTime=_format_minutes(DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES),
                endDayOffset=0,
            )
        )
    normalized.sort(key=lambda item: item.order)
    return normalized[:3]


def _resolve_shift_row(
    row_id: str, rows_by_id: Dict[str, WorkplaceRow]
) -> tuple[Optional[WorkplaceRow], Optional[SubShift]]:
    class_id, sub_shift_id = _parse_shift_row_id(row_id)
    row = rows_by_id.get(class_id)
    if not row or row.kind != "class":
        return None, None
    if not sub_shift_id:
        sub_shift_id = "s1"
    sub_shift = next(
        (shift for shift in row.subShifts if shift.id == sub_shift_id), None
    )
    return row, sub_shift


def _normalize_state(state: AppState) -> tuple[AppState, bool]:
    changed = False
    locations_enabled = state.locationsEnabled is not False
    if state.locationsEnabled != locations_enabled:
        state.locationsEnabled = locations_enabled
        changed = True
    locations = _ensure_locations(state.locations or [])
    if state.locations != locations:
        state.locations = locations
        changed = True
    location_ids = {loc.id for loc in state.locations}

    class_rows: List[WorkplaceRow] = []
    sub_shift_ids_by_class: Dict[str, set[str]] = {}
    for row in state.rows:
        if row.kind != "class":
            continue
        normalized_shifts = _normalize_sub_shifts(row.subShifts)
        if row.subShifts != normalized_shifts:
            row.subShifts = normalized_shifts
            changed = True
        else:
            row.subShifts = normalized_shifts
        if not row.locationId or row.locationId not in location_ids:
            row.locationId = DEFAULT_LOCATION_ID
            changed = True
        if not locations_enabled and row.locationId != DEFAULT_LOCATION_ID:
            row.locationId = DEFAULT_LOCATION_ID
            changed = True
        class_rows.append(row)
        sub_shift_ids_by_class[row.id] = {shift.id for shift in row.subShifts}

    class_row_ids = {row.id for row in class_rows}

    next_assignments: List[Assignment] = []
    for assignment in state.assignments:
        if assignment.rowId in class_row_ids and SHIFT_ROW_SEPARATOR not in assignment.rowId:
            assignment = assignment.model_copy(
                update={"rowId": _build_shift_row_id(assignment.rowId, "s1")}
            )
            changed = True
        next_assignments.append(assignment)
    state.assignments = next_assignments

    min_slots = dict(state.minSlotsByRowId)
    for row in class_rows:
        base = min_slots.pop(row.id, None)
        if base:
            changed = True
        for shift in row.subShifts:
            shift_row_id = _build_shift_row_id(row.id, shift.id)
            if shift_row_id not in min_slots:
                min_slots[shift_row_id] = (
                    base if shift.id == "s1" and base else MinSlots(weekday=0, weekend=0)
                )
                changed = True
    for key in list(min_slots.keys()):
        if SHIFT_ROW_SEPARATOR not in key:
            continue
        class_id, sub_shift_id = _parse_shift_row_id(key)
        if not sub_shift_id:
            del min_slots[key]
            changed = True
            continue
        class_shift_ids = sub_shift_ids_by_class.get(class_id)
        if not class_shift_ids or sub_shift_id not in class_shift_ids:
            del min_slots[key]
            changed = True
    state.minSlotsByRowId = min_slots

    overrides = state.slotOverridesByKey or {}
    next_overrides: Dict[str, int] = {}
    for key, value in overrides.items():
        row_id, date_iso = key.split("__", 1) if "__" in key else (key, "")
        if not row_id or not date_iso:
            continue
        next_row_id = row_id
        if row_id in class_row_ids and SHIFT_ROW_SEPARATOR not in row_id:
            next_row_id = _build_shift_row_id(row_id, "s1")
            changed = True
        elif SHIFT_ROW_SEPARATOR in row_id:
            class_id, sub_shift_id = _parse_shift_row_id(row_id)
            class_shift_ids = sub_shift_ids_by_class.get(class_id)
            if not sub_shift_id or not class_shift_ids:
                changed = True
                continue
            if sub_shift_id not in class_shift_ids:
                fallback = next(iter(class_shift_ids), None)
                if not fallback:
                    changed = True
                    continue
                next_row_id = _build_shift_row_id(class_id, fallback)
                changed = True
        next_key = f"{next_row_id}__{date_iso}"
        next_overrides[next_key] = next_overrides.get(next_key, 0) + int(value)
    if overrides != next_overrides:
        state.slotOverridesByKey = next_overrides
        changed = True

    return state, changed


def _default_state() -> AppState:
    current_year = datetime.now(timezone.utc).year
    default_location = Location(id=DEFAULT_LOCATION_ID, name=DEFAULT_LOCATION_NAME)
    rows = [
        WorkplaceRow(
            id="pool-not-allocated",
            name="Distribution Pool",
            kind="pool",
            dotColorClass="bg-slate-400",
        ),
        WorkplaceRow(
            id="pool-manual",
            name="Reserve Pool",
            kind="pool",
            dotColorClass="bg-slate-300",
        ),
        WorkplaceRow(
            id="pool-vacation",
            name="Vacation",
            kind="pool",
            dotColorClass="bg-emerald-500",
        ),
        WorkplaceRow(
            id="mri",
            name="MRI",
            kind="class",
            dotColorClass="bg-violet-500",
            locationId=DEFAULT_LOCATION_ID,
            subShifts=[
                SubShift(
                    id="s1",
                    name="Shift 1",
                    order=1,
                    startTime=DEFAULT_SUB_SHIFT_START,
                    endTime=_format_minutes(
                        DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES
                    ),
                    endDayOffset=0,
                )
            ],
        ),
        WorkplaceRow(
            id="ct",
            name="CT",
            kind="class",
            dotColorClass="bg-cyan-500",
            locationId=DEFAULT_LOCATION_ID,
            subShifts=[
                SubShift(
                    id="s1",
                    name="Shift 1",
                    order=1,
                    startTime=DEFAULT_SUB_SHIFT_START,
                    endTime=_format_minutes(
                        DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES
                    ),
                    endDayOffset=0,
                )
            ],
        ),
        WorkplaceRow(
            id="sonography",
            name="Sonography",
            kind="class",
            dotColorClass="bg-fuchsia-500",
            locationId=DEFAULT_LOCATION_ID,
            subShifts=[
                SubShift(
                    id="s1",
                    name="Shift 1",
                    order=1,
                    startTime=DEFAULT_SUB_SHIFT_START,
                    endTime=_format_minutes(
                        DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES
                    ),
                    endDayOffset=0,
                )
            ],
        ),
        WorkplaceRow(
            id="conventional",
            name="Conventional",
            kind="class",
            dotColorClass="bg-amber-400",
            locationId=DEFAULT_LOCATION_ID,
            subShifts=[
                SubShift(
                    id="s1",
                    name="Shift 1",
                    order=1,
                    startTime=DEFAULT_SUB_SHIFT_START,
                    endTime=_format_minutes(
                        DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES
                    ),
                    endDayOffset=0,
                )
            ],
        ),
        WorkplaceRow(
            id="on-call",
            name="On Call",
            kind="class",
            dotColorClass="bg-blue-600",
            locationId=DEFAULT_LOCATION_ID,
            subShifts=[
                SubShift(
                    id="s1",
                    name="Shift 1",
                    order=1,
                    startTime=DEFAULT_SUB_SHIFT_START,
                    endTime=_format_minutes(
                        DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES
                    ),
                    endDayOffset=0,
                )
            ],
        ),
    ]
    clinicians = [
        Clinician(
            id="sarah-chen",
            name="Sarah Chen",
            qualifiedClassIds=["mri", "sonography", "conventional"],
            preferredClassIds=["sonography", "mri"],
            vacations=[],
        ),
        Clinician(
            id="james-wilson",
            name="James Wilson",
            qualifiedClassIds=["mri", "on-call"],
            preferredClassIds=["on-call"],
            vacations=[],
        ),
        Clinician(
            id="michael-ross",
            name="Michael Ross",
            qualifiedClassIds=["ct", "conventional", "on-call"],
            preferredClassIds=["ct"],
            vacations=[],
        ),
        Clinician(
            id="emily-brooks",
            name="Emily Brooks",
            qualifiedClassIds=["sonography", "conventional"],
            preferredClassIds=["conventional"],
            vacations=[],
        ),
        Clinician(
            id="david-kim",
            name="David Kim",
            qualifiedClassIds=["ct", "sonography"],
            preferredClassIds=["ct"],
            vacations=[],
        ),
        Clinician(
            id="ava-patel",
            name="Ava Patel",
            qualifiedClassIds=["ct", "mri"],
            preferredClassIds=[],
            vacations=[],
        ),
        Clinician(
            id="lena-park",
            name="Lena Park",
            qualifiedClassIds=["conventional"],
            preferredClassIds=["conventional"],
            vacations=[],
        ),
    ]
    min_slots = {
        _build_shift_row_id("mri", "s1"): MinSlots(weekday=2, weekend=1),
        _build_shift_row_id("ct", "s1"): MinSlots(weekday=2, weekend=1),
        _build_shift_row_id("sonography", "s1"): MinSlots(weekday=2, weekend=1),
        _build_shift_row_id("conventional", "s1"): MinSlots(weekday=2, weekend=1),
        _build_shift_row_id("on-call", "s1"): MinSlots(weekday=1, weekend=1),
    }
    return AppState(
        locations=[default_location],
        locationsEnabled=True,
        rows=rows,
        clinicians=clinicians,
        assignments=[],
        minSlotsByRowId=min_slots,
        slotOverridesByKey={},
        holidayCountry="DE",
        holidayYear=current_year,
        holidays=[],
    )


DB_PATH = os.environ.get("SCHEDULE_DB_PATH", "schedule.db")
JWT_SECRET = os.environ.get("JWT_SECRET", "dev-secret")
PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "").strip()
FRONTEND_BASE_URL = (
    os.environ.get("FRONTEND_BASE_URL")
    or os.environ.get("APP_ORIGIN")
    or "http://localhost:5173"
).strip()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", "720"))
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
_SCHEMA_READY = False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def _utcnow_iso() -> str:
    return _utcnow().isoformat()


def _ensure_schema(conn: sqlite3.Connection) -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_state (
            id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            active INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ical_publications (
            username TEXT PRIMARY KEY,
            token TEXT UNIQUE NOT NULL,
            start_date_iso TEXT NULL,
            end_date_iso TEXT NULL,
            cal_name TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ical_clinician_publications (
            username TEXT NOT NULL,
            clinician_id TEXT NOT NULL,
            token TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (username, clinician_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS web_publications (
            username TEXT PRIMARY KEY,
            token TEXT UNIQUE NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )

    columns = [row["name"] for row in conn.execute("PRAGMA table_info(app_state)").fetchall()]
    if "updated_at" not in columns:
        conn.execute("ALTER TABLE app_state ADD COLUMN updated_at TEXT")
        now = _utcnow_iso()
        conn.execute(
            "UPDATE app_state SET updated_at = ? WHERE updated_at IS NULL OR updated_at = ''",
            (now,),
        )

    conn.commit()
    _SCHEMA_READY = True


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    _ensure_schema(conn)
    return conn


def _load_state(user_id: str) -> AppState:
    conn = _get_connection()
    row = conn.execute(
        "SELECT data FROM app_state WHERE id = ?", (user_id,)
    ).fetchone()
    if not row and user_id == "jk":
        legacy = conn.execute(
            "SELECT data FROM app_state WHERE id = ?", ("state",)
        ).fetchone()
        if legacy:
            data = json.loads(legacy[0])
            state = AppState.model_validate(data)
            state, _ = _normalize_state(state)
            _save_state(state, user_id)
            conn.close()
            return state
    conn.close()
    if not row:
        state = _default_state()
        _save_state(state, user_id)
        return state
    data = json.loads(row[0])
    state = AppState.model_validate(data)
    state, changed = _normalize_state(state)
    if changed:
        _save_state(state, user_id)
    return state


def _save_state(state: AppState, user_id: str) -> None:
    conn = _get_connection()
    payload = state.model_dump()
    now = _utcnow_iso()
    conn.execute(
        "INSERT OR REPLACE INTO app_state (id, data, updated_at) VALUES (?, ?, ?)",
        (user_id, json.dumps(payload), now),
    )
    conn.commit()
    conn.close()


def _parse_date_input(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", trimmed):
        try:
            datetime.fromisoformat(f"{trimmed}T00:00:00+00:00")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid date.") from exc
        return trimmed
    match = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", trimmed)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid date format.")
    day_raw, month_raw, year_raw = match.groups()
    day = int(day_raw)
    month = int(month_raw)
    year = int(year_raw)
    try:
        dt = datetime(year, month, day, tzinfo=timezone.utc)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid date.") from exc
    return dt.date().isoformat()


def _parse_iso_datetime(value: Optional[str]) -> datetime:
    if not value:
        return _utcnow()
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return _utcnow()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0)


def _normalize_week_start(date_iso: str) -> tuple[str, str]:
    base = datetime.fromisoformat(f"{date_iso}T00:00:00+00:00").date()
    week_start = base - timedelta(days=base.weekday())
    week_end = week_start + timedelta(days=6)
    return week_start.isoformat(), week_end.isoformat()


def _etag_matches(if_none_match: Optional[str], etag: str) -> bool:
    if not if_none_match:
        return False
    raw = if_none_match.strip()
    if raw == "*":
        return True
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    for part in parts:
        if part == etag:
            return True
        if part.startswith("W/") and part[2:].strip() == etag:
            return True
    return False


def _if_modified_since_matches(if_modified_since: Optional[str], last_modified: datetime) -> bool:
    if not if_modified_since:
        return False
    try:
        parsed = parsedate_to_datetime(if_modified_since)
    except (TypeError, ValueError):
        return False
    if parsed is None:
        return False
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    parsed_utc = parsed.astimezone(timezone.utc).replace(microsecond=0)
    return parsed_utc >= last_modified


def _compute_public_etag(
    token: str,
    state_updated_at: str,
    publication_updated_at: str,
) -> str:
    payload = "|".join(
        [
            token,
            state_updated_at or "",
            publication_updated_at or "",
        ]
    )
    digest = sha256(payload.encode("utf-8")).hexdigest()
    return f"\"{digest}\""


def _compute_public_week_etag(
    token: str,
    week_start_iso: str,
    state_updated_at: str,
    publication_updated_at: str,
) -> str:
    payload = "|".join(
        [
            token,
            week_start_iso,
            state_updated_at or "",
            publication_updated_at or "",
        ]
    )
    digest = sha256(payload.encode("utf-8")).hexdigest()
    return f"\"{digest}\""


def _build_subscribe_url(request: Request, token: str) -> str:
    base = PUBLIC_BASE_URL or str(request.base_url).rstrip("/")
    return f"{base}/v1/ical/{token}.ics"


def _token_exists(conn: sqlite3.Connection, token: str) -> bool:
    row = conn.execute(
        """
        SELECT token FROM ical_publications WHERE token = ?
        UNION
        SELECT token FROM ical_clinician_publications WHERE token = ?
        LIMIT 1
        """,
        (token, token),
    ).fetchone()
    return row is not None


def _web_token_exists(conn: sqlite3.Connection, token: str) -> bool:
    row = conn.execute(
        "SELECT token FROM web_publications WHERE token = ? LIMIT 1",
        (token,),
    ).fetchone()
    return row is not None


def _get_publication_by_username(username: str) -> Optional[sqlite3.Row]:
    conn = _get_connection()
    row = conn.execute(
        """
        SELECT username, token, start_date_iso, end_date_iso, cal_name, created_at, updated_at
        FROM ical_publications
        WHERE username = ?
        """,
        (username,),
    ).fetchone()
    conn.close()
    return row


def _get_web_publication_by_username(username: str) -> Optional[sqlite3.Row]:
    conn = _get_connection()
    row = conn.execute(
        """
        SELECT username, token, created_at, updated_at
        FROM web_publications
        WHERE username = ?
        """,
        (username,),
    ).fetchone()
    conn.close()
    return row


def _get_web_publication_by_token(token: str) -> Optional[sqlite3.Row]:
    conn = _get_connection()
    row = conn.execute(
        """
        SELECT username, token, created_at, updated_at
        FROM web_publications
        WHERE token = ?
        """,
        (token,),
    ).fetchone()
    conn.close()
    return row


def _get_publication_by_token(token: str) -> Optional[sqlite3.Row]:
    conn = _get_connection()
    row = conn.execute(
        """
        SELECT username, token, start_date_iso, end_date_iso, cal_name, created_at, updated_at
        FROM ical_publications
        WHERE token = ?
        """,
        (token,),
    ).fetchone()
    conn.close()
    return row


def _get_clinician_publication_by_token(token: str) -> Optional[sqlite3.Row]:
    conn = _get_connection()
    row = conn.execute(
        """
        SELECT username, clinician_id, token, created_at, updated_at
        FROM ical_clinician_publications
        WHERE token = ?
        """,
        (token,),
    ).fetchone()
    conn.close()
    return row


def _get_clinician_publications_for_user(
    conn: sqlite3.Connection, username: str
) -> Dict[str, Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT clinician_id, token, created_at, updated_at
        FROM ical_clinician_publications
        WHERE username = ?
        """,
        (username,),
    ).fetchall()
    return {row["clinician_id"]: dict(row) for row in rows}


def _ensure_clinician_publications(
    conn: sqlite3.Connection, username: str, clinicians: List[Clinician]
) -> Dict[str, Dict[str, Any]]:
    now = _utcnow_iso()
    existing = _get_clinician_publications_for_user(conn, username)
    for clinician in clinicians:
        if clinician.id in existing:
            continue
        for _ in range(10):
            token = secrets.token_urlsafe(32)
            if _token_exists(conn, token):
                continue
            try:
                conn.execute(
                    """
                    INSERT INTO ical_clinician_publications (
                        username, clinician_id, token, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (username, clinician.id, token, now, now),
                )
                existing[clinician.id] = {
                    "clinician_id": clinician.id,
                    "token": token,
                    "created_at": now,
                    "updated_at": now,
                }
                break
            except sqlite3.IntegrityError:
                conn.rollback()
                continue
    return existing


def _build_publish_status(
    request: Request,
    publication: sqlite3.Row,
    clinician_rows: Dict[str, Dict[str, Any]],
    clinicians: List[Clinician],
) -> IcalPublishStatus:
    all_link = IcalPublishAllLink(
        subscribeUrl=_build_subscribe_url(request, publication["token"])
    )
    clinician_links = []
    for clinician in clinicians:
        row = clinician_rows.get(clinician.id)
        if not row:
            continue
        clinician_links.append(
            IcalPublishClinicianLink(
                clinicianId=clinician.id,
                clinicianName=clinician.name,
                subscribeUrl=_build_subscribe_url(request, row["token"]),
            )
        )
    return IcalPublishStatus(published=True, all=all_link, clinicians=clinician_links)


def _load_state_blob_and_updated_at(username: str) -> tuple[Dict[str, Any], datetime, str]:
    state = _load_state(username)
    conn = _get_connection()
    row = conn.execute(
        "SELECT updated_at FROM app_state WHERE id = ?",
        (username,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User state not found.")
    updated_at_raw = row["updated_at"] or ""
    updated_at = _parse_iso_datetime(updated_at_raw)
    return state.model_dump(), updated_at, updated_at_raw


def _parse_import_state(payload: Optional[Dict[str, Any]]) -> Optional[AppState]:
    if payload is None:
        return None
    if isinstance(payload, dict) and "state" in payload:
        export = UserStateExport.model_validate(payload)
        return export.state
    return AppState.model_validate(payload)


def _hash_password(password: str) -> str:
    return pwd_context.hash(password)


def _verify_password(password: str, hashed: str) -> bool:
    return pwd_context.verify(password, hashed)


def _is_truthy(value: Optional[str]) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _user_row_to_public(row: sqlite3.Row) -> UserPublic:
    return UserPublic(
        username=row["username"],
        role=row["role"],
        active=bool(row["active"]),
    )


def _get_user_by_username(username: str) -> Optional[sqlite3.Row]:
    conn = _get_connection()
    row = conn.execute(
        "SELECT id, username, password_hash, role, active FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    conn.close()
    return row


def _list_users() -> List[UserPublic]:
    conn = _get_connection()
    rows = conn.execute(
        "SELECT username, role, active FROM users ORDER BY username"
    ).fetchall()
    conn.close()
    return [_user_row_to_public(row) for row in rows]


def _create_user(username: str, password: str, role: Role, active: bool = True) -> UserPublic:
    conn = _get_connection()
    conn.execute(
        """
        INSERT INTO users (username, password_hash, role, active, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            username,
            _hash_password(password),
            role,
            1 if active else 0,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()
    row = conn.execute(
        "SELECT username, role, active FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    conn.close()
    if not row:
        raise RuntimeError("User creation failed.")
    return _user_row_to_public(row)


def _update_user(username: str, updates: UserUpdateRequest) -> UserPublic:
    conn = _get_connection()
    fields = []
    values: List[object] = []
    if updates.active is not None:
        fields.append("active = ?")
        values.append(1 if updates.active else 0)
    if updates.role is not None:
        fields.append("role = ?")
        values.append(updates.role)
    if updates.password is not None:
        fields.append("password_hash = ?")
        values.append(_hash_password(updates.password))
    if not fields:
        raise HTTPException(status_code=400, detail="No updates provided.")
    values.append(username)
    conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE username = ?", values)
    conn.commit()
    row = conn.execute(
        "SELECT username, role, active FROM users WHERE username = ?",
        (username,),
    ).fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="User not found.")
    return _user_row_to_public(row)


def _delete_user(username: str) -> None:
    conn = _get_connection()
    conn.execute("DELETE FROM users WHERE username = ?", (username,))
    conn.execute("DELETE FROM app_state WHERE id = ?", (username,))
    conn.execute("DELETE FROM ical_publications WHERE username = ?", (username,))
    conn.execute("DELETE FROM ical_clinician_publications WHERE username = ?", (username,))
    conn.execute("DELETE FROM web_publications WHERE username = ?", (username,))
    conn.commit()
    conn.close()


def _create_access_token(user: UserPublic) -> str:
    expires = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": user.username, "role": user.role, "exp": expires}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _get_current_user(authorization: Optional[str] = Header(default=None)) -> UserPublic:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token.")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
        ) from exc
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")
    row = _get_user_by_username(username)
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found.")
    if not row["active"]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User disabled.")
    return _user_row_to_public(row)


def _require_admin(current_user: UserPublic = Depends(_get_current_user)) -> UserPublic:
    if current_user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin required.")
    return current_user


def _ensure_admin_user() -> None:
    username = os.environ.get("ADMIN_USERNAME")
    password = os.environ.get("ADMIN_PASSWORD")
    reset_password = _is_truthy(os.environ.get("ADMIN_PASSWORD_RESET"))
    if not username or not password:
        return
    normalized = username.strip().lower()
    if not normalized:
        return
    existing = _get_user_by_username(normalized)
    if existing:
        if reset_password:
            _update_user(
                normalized,
                UserUpdateRequest(active=True, role="admin", password=password),
            )
        return
    _create_user(normalized, password, "admin", active=True)


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


@app.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest):
    username = payload.username.strip().lower()
    if not username or not payload.password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
    row = _get_user_by_username(username)
    if not row or not row["active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
    if not _verify_password(payload.password, row["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials.")
    user_public = _user_row_to_public(row)
    token = _create_access_token(user_public)
    return TokenResponse(access_token=token, user=user_public)


@app.get("/auth/me", response_model=UserPublic)
def get_me(current_user: UserPublic = Depends(_get_current_user)):
    return current_user


@app.get("/auth/users", response_model=List[UserPublic])
def list_users(_: UserPublic = Depends(_require_admin)):
    return _list_users()


@app.get("/auth/users/{username}/export", response_model=UserStateExport)
def export_user_state(username: str, _: UserPublic = Depends(_require_admin)):
    normalized = username.strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="Username required.")
    if not _get_user_by_username(normalized):
        raise HTTPException(status_code=404, detail="User not found.")
    state = _load_state(normalized)
    return UserStateExport(
        exportedAt=datetime.now(timezone.utc).isoformat(),
        sourceUser=normalized,
        state=state,
    )


@app.post("/auth/users", response_model=UserPublic)
def create_user(
    payload: UserCreateRequest, current_user: UserPublic = Depends(_require_admin)
):
    username = payload.username.strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="Username required.")
    if not payload.password:
        raise HTTPException(status_code=400, detail="Password required.")
    if _get_user_by_username(username):
        raise HTTPException(status_code=409, detail="User already exists.")
    try:
        import_state = _parse_import_state(payload.importState)
    except ValidationError:
        raise HTTPException(status_code=400, detail="Invalid import state.")
    created = _create_user(username, payload.password, payload.role, active=True)
    if import_state is None:
        template_state = _load_state(current_user.username)
        _save_state(template_state, username)
    else:
        _save_state(import_state, username)
    return created


@app.patch("/auth/users/{username}", response_model=UserPublic)
def update_user(
    username: str,
    payload: UserUpdateRequest,
    _: UserPublic = Depends(_require_admin),
):
    normalized = username.strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="Username required.")
    if payload.password is not None and not payload.password:
        raise HTTPException(status_code=400, detail="Password required.")
    return _update_user(normalized, payload)


@app.delete("/auth/users/{username}", status_code=204)
def delete_user(
    username: str,
    current_user: UserPublic = Depends(_require_admin),
):
    normalized = username.strip().lower()
    if not normalized:
        raise HTTPException(status_code=400, detail="Username required.")
    if normalized == current_user.username:
        raise HTTPException(status_code=400, detail="Cannot delete yourself.")
    if not _get_user_by_username(normalized):
        raise HTTPException(status_code=404, detail="User not found.")
    _delete_user(normalized)

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/v1/state", response_model=AppState)
def get_state(current_user: UserPublic = Depends(_get_current_user)):
    return _load_state(current_user.username)


@app.post("/v1/state", response_model=AppState)
def set_state(payload: AppState, current_user: UserPublic = Depends(_get_current_user)):
    normalized, _ = _normalize_state(payload)
    _save_state(normalized, current_user.username)
    return normalized


@app.get("/v1/web/publish", response_model=WebPublishStatus)
def get_web_publication_status(current_user: UserPublic = Depends(_get_current_user)):
    publication = _get_web_publication_by_username(current_user.username)
    if not publication:
        return WebPublishStatus(published=False)
    return WebPublishStatus(published=True, token=publication["token"])


@app.post("/v1/web/publish", response_model=WebPublishStatus)
def publish_web(current_user: UserPublic = Depends(_get_current_user)):
    now = _utcnow_iso()
    conn = _get_connection()
    existing = conn.execute(
        "SELECT token FROM web_publications WHERE username = ?",
        (current_user.username,),
    ).fetchone()
    if existing:
        token = existing["token"]
        conn.execute(
            "UPDATE web_publications SET updated_at = ? WHERE username = ?",
            (now, current_user.username),
        )
        conn.commit()
        conn.close()
        return WebPublishStatus(published=True, token=token)

    for _ in range(10):
        token = secrets.token_urlsafe(32)
        if _web_token_exists(conn, token):
            continue
        try:
            conn.execute(
                """
                INSERT INTO web_publications (username, token, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (current_user.username, token, now, now),
            )
            conn.commit()
            conn.close()
            return WebPublishStatus(published=True, token=token)
        except sqlite3.IntegrityError:
            conn.rollback()
            continue
    conn.close()
    raise HTTPException(status_code=500, detail="Failed to generate token.")


@app.post("/v1/web/publish/rotate", response_model=WebPublishStatus)
def rotate_web(current_user: UserPublic = Depends(_get_current_user)):
    now = _utcnow_iso()
    conn = _get_connection()
    existing = conn.execute(
        "SELECT token FROM web_publications WHERE username = ?",
        (current_user.username,),
    ).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="No publication found.")
    for _ in range(10):
        token = secrets.token_urlsafe(32)
        if _web_token_exists(conn, token):
            continue
        try:
            conn.execute(
                "UPDATE web_publications SET token = ?, updated_at = ? WHERE username = ?",
                (token, now, current_user.username),
            )
            conn.commit()
            conn.close()
            return WebPublishStatus(published=True, token=token)
        except sqlite3.IntegrityError:
            conn.rollback()
            continue
    conn.close()
    raise HTTPException(status_code=500, detail="Failed to generate token.")


@app.delete("/v1/web/publish", status_code=204)
def unpublish_web(current_user: UserPublic = Depends(_get_current_user)):
    conn = _get_connection()
    conn.execute("DELETE FROM web_publications WHERE username = ?", (current_user.username,))
    conn.commit()
    conn.close()


@app.get("/v1/pdf/week")
def export_week_pdf(
    start: str = Query(..., min_length=8),
    authorization: Optional[str] = Header(default=None),
    current_user: UserPublic = Depends(_get_current_user),
):
    start_iso = _parse_date_input(start)
    if not start_iso:
        raise HTTPException(status_code=400, detail="Start date required.")
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token.")
    base_url = FRONTEND_BASE_URL.rstrip("/")
    print_url = f"{base_url}/print/week?start={start_iso}"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page(viewport={"width": 1400, "height": 900})
                page.add_init_script(
                    "localStorage.setItem('authToken', %s);" % json.dumps(token)
                )
                page.goto(print_url, wait_until="networkidle", timeout=20000)
                page.wait_for_function("window.__PDF_READY__ === true", timeout=20000)
                page.emulate_media(media="print")
                dims = page.evaluate(
                    """() => {
                        const body = document.body;
                        const html = document.documentElement;
                        return {
                            width: Math.max(body.scrollWidth, html.scrollWidth),
                            height: Math.max(body.scrollHeight, html.scrollHeight),
                        };
                    }"""
                )
                width = float(dims.get("width", 0) or 0)
                height = float(dims.get("height", 0) or 0)
                dpi = 96.0
                a4_width = 11.69 * dpi
                a4_height = 8.27 * dpi
                margin = (10 / 25.4) * dpi
                usable_width = max(1.0, a4_width - (2 * margin))
                usable_height = max(1.0, a4_height - (2 * margin))
                scale = 1.0
                if width > 0 and height > 0:
                    scale = min(1.0, usable_width / width, usable_height / height)
                pdf_bytes = page.pdf(
                    format="A4",
                    landscape=True,
                    print_background=True,
                    scale=scale,
                    margin={"top": "10mm", "right": "10mm", "bottom": "10mm", "left": "10mm"},
                )
            finally:
                browser.close()
    except PlaywrightTimeoutError as exc:
        raise HTTPException(status_code=504, detail="PDF render timed out.") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="PDF render failed.") from exc

    filename = f"shift-planner-{start_iso}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/v1/pdf/weeks")
def export_weeks_pdf(
    start: str = Query(..., min_length=8),
    weeks: int = Query(..., ge=1, le=55),
    authorization: Optional[str] = Header(default=None),
    current_user: UserPublic = Depends(_get_current_user),
):
    start_iso = _parse_date_input(start)
    if not start_iso:
        raise HTTPException(status_code=400, detail="Start date required.")
    token = _extract_bearer_token(authorization)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing token.")
    base_url = FRONTEND_BASE_URL.rstrip("/")
    print_url = f"{base_url}/print/weeks?start={start_iso}&weeks={weeks}"

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            try:
                page = browser.new_page(viewport={"width": 1400, "height": 900})
                page.add_init_script(
                    "localStorage.setItem('authToken', %s);" % json.dumps(token)
                )
                page.goto(print_url, wait_until="networkidle", timeout=20000)
                page.wait_for_function("window.__PDF_READY__ === true", timeout=20000)
                page.emulate_media(media="print")
                dims = page.evaluate(
                    """() => {
                        const body = document.body;
                        const html = document.documentElement;
                        return {
                            width: Math.max(body.scrollWidth, html.scrollWidth),
                            height: Math.max(body.scrollHeight, html.scrollHeight),
                        };
                    }"""
                )
                width = float(dims.get("width", 0) or 0)
                dpi = 96.0
                a4_width = 11.69 * dpi
                margin = (10 / 25.4) * dpi
                usable_width = max(1.0, a4_width - (2 * margin))
                scale = 1.0
                if width > 0:
                    scale = min(1.0, usable_width / width)
                pdf_bytes = page.pdf(
                    format="A4",
                    landscape=True,
                    print_background=True,
                    scale=scale,
                    margin={
                        "top": "10mm",
                        "right": "10mm",
                        "bottom": "10mm",
                        "left": "10mm",
                    },
                )
            finally:
                browser.close()
    except PlaywrightTimeoutError as exc:
        raise HTTPException(status_code=504, detail="PDF render timed out.") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail="PDF render failed.") from exc

    filename = f"shift-planner-{start_iso}-{weeks}w.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/v1/web/{token}/week")
def get_public_web_week(
    token: str,
    start: str = Query(..., min_length=8),
    if_none_match: Optional[str] = Header(default=None),
    if_modified_since: Optional[str] = Header(default=None),
):
    publication = _get_web_publication_by_token(token)
    if not publication:
        raise HTTPException(status_code=404, detail="Link not found.")

    start_iso = _parse_date_input(start)
    if not start_iso:
        raise HTTPException(status_code=400, detail="Start date required.")
    week_start_iso, week_end_iso = _normalize_week_start(start_iso)

    state_payload, state_updated_at, state_updated_at_raw = _load_state_blob_and_updated_at(
        publication["username"]
    )
    publication_updated_at_raw = publication["updated_at"] or ""
    publication_updated_at = _parse_iso_datetime(publication_updated_at_raw)
    last_modified = max(state_updated_at, publication_updated_at)
    etag = _compute_public_week_etag(
        token,
        week_start_iso,
        state_updated_at_raw,
        publication_updated_at_raw,
    )
    headers = {
        "Cache-Control": "private, max-age=0, must-revalidate",
        "ETag": etag,
        "Last-Modified": format_datetime(last_modified, usegmt=True),
        "Referrer-Policy": "no-referrer",
    }

    if _etag_matches(if_none_match, etag) or _if_modified_since_matches(
        if_modified_since, last_modified
    ):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)

    state = AppState.model_validate(state_payload)
    published_weeks = set(state.publishedWeekStartISOs or [])
    if week_start_iso not in published_weeks:
        return Response(
            content=json.dumps(
                {
                    "published": False,
                    "weekStartISO": week_start_iso,
                    "weekEndISO": week_end_iso,
                }
            ),
            media_type="application/json",
            headers=headers,
        )

    row_by_id = {row.id: row for row in state.rows}
    clinician_by_id = {clinician.id: clinician for clinician in state.clinicians}
    assignments: List[Dict[str, Any]] = []
    for assignment in state.assignments:
        if assignment.dateISO < week_start_iso or assignment.dateISO > week_end_iso:
            continue
        row, _sub_shift = _resolve_shift_row(assignment.rowId, row_by_id)
        if not row:
            continue
        clinician = clinician_by_id.get(assignment.clinicianId)
        if not clinician:
            continue
        if any(
            vacation.startISO <= assignment.dateISO <= vacation.endISO
            for vacation in clinician.vacations
        ):
            continue
        assignments.append(assignment.model_dump())

    holidays = [
        holiday.model_dump()
        for holiday in state.holidays
        if week_start_iso <= holiday.dateISO <= week_end_iso
    ]

    payload = {
        "published": True,
        "weekStartISO": week_start_iso,
        "weekEndISO": week_end_iso,
        "locations": [loc.model_dump() for loc in state.locations],
        "locationsEnabled": state.locationsEnabled,
        "rows": [row.model_dump() for row in state.rows],
        "clinicians": [clinician.model_dump() for clinician in state.clinicians],
        "assignments": assignments,
        "minSlotsByRowId": {
            row_id: min_slots.model_dump()
            for row_id, min_slots in state.minSlotsByRowId.items()
        },
        "slotOverridesByKey": state.slotOverridesByKey,
        "holidays": holidays,
    }
    return Response(
        content=json.dumps(payload),
        media_type="application/json",
        headers=headers,
    )


@app.get("/v1/ical/publish", response_model=IcalPublishStatus)
def get_ical_publication_status(
    request: Request, current_user: UserPublic = Depends(_get_current_user)
):
    publication = _get_publication_by_username(current_user.username)
    if not publication:
        return IcalPublishStatus(published=False)
    state = _load_state(current_user.username)
    conn = _get_connection()
    clinician_rows = _ensure_clinician_publications(conn, current_user.username, state.clinicians)
    conn.commit()
    conn.close()
    return _build_publish_status(request, publication, clinician_rows, state.clinicians)


@app.post("/v1/ical/publish", response_model=IcalPublishStatus)
def publish_ical(
    request: Request,
    current_user: UserPublic = Depends(_get_current_user),
    _payload: Optional[IcalPublishRequest] = None,
):
    now = _utcnow_iso()
    conn = _get_connection()
    existing = conn.execute(
        "SELECT token FROM ical_publications WHERE username = ?",
        (current_user.username,),
    ).fetchone()
    if existing:
        token = existing["token"]
        conn.execute(
            """
            UPDATE ical_publications
            SET updated_at = ?
            WHERE username = ?
            """,
            (now, current_user.username),
        )
        state = _load_state(current_user.username)
        clinician_rows = _ensure_clinician_publications(
            conn, current_user.username, state.clinicians
        )
        conn.commit()
        conn.close()
        return _build_publish_status(request, {"token": token}, clinician_rows, state.clinicians)

    for _ in range(10):
        token = secrets.token_urlsafe(32)
        if _token_exists(conn, token):
            continue
        try:
            conn.execute(
                """
                INSERT INTO ical_publications (
                    username, token, start_date_iso, end_date_iso, cal_name, created_at, updated_at
                )
                VALUES (?, ?, NULL, NULL, NULL, ?, ?)
                """,
                (current_user.username, token, now, now),
            )
            state = _load_state(current_user.username)
            clinician_rows = _ensure_clinician_publications(
                conn, current_user.username, state.clinicians
            )
            conn.commit()
            conn.close()
            return _build_publish_status(request, {"token": token}, clinician_rows, state.clinicians)
        except sqlite3.IntegrityError:
            conn.rollback()
            continue
    conn.close()
    raise HTTPException(status_code=500, detail="Could not generate a unique token.")


@app.post("/v1/ical/publish/rotate", response_model=IcalPublishStatus)
def rotate_ical_token(
    request: Request, current_user: UserPublic = Depends(_get_current_user)
):
    now = _utcnow_iso()
    conn = _get_connection()
    existing = conn.execute(
        "SELECT token FROM ical_publications WHERE username = ?",
        (current_user.username,),
    ).fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="No publication found.")
    for _ in range(10):
        token = secrets.token_urlsafe(32)
        if _token_exists(conn, token):
            continue
        try:
            conn.execute(
                "UPDATE ical_publications SET token = ?, updated_at = ? WHERE username = ?",
                (token, now, current_user.username),
            )
            conn.execute(
                "DELETE FROM ical_clinician_publications WHERE username = ?",
                (current_user.username,),
            )
            state = _load_state(current_user.username)
            clinician_rows = _ensure_clinician_publications(
                conn, current_user.username, state.clinicians
            )
            conn.commit()
            conn.close()
            return _build_publish_status(request, {"token": token}, clinician_rows, state.clinicians)
        except sqlite3.IntegrityError:
            conn.rollback()
            continue

    conn.close()
    raise HTTPException(status_code=500, detail="Could not generate a unique token.")


@app.delete("/v1/ical/publish", status_code=204)
def unpublish_ical(current_user: UserPublic = Depends(_get_current_user)):
    conn = _get_connection()
    conn.execute(
        "DELETE FROM ical_publications WHERE username = ?",
        (current_user.username,),
    )
    conn.execute(
        "DELETE FROM ical_clinician_publications WHERE username = ?",
        (current_user.username,),
    )
    conn.commit()
    conn.close()


@app.get("/v1/ical/{token}.ics")
def get_public_ical(
    token: str,
    request: Request,
    if_none_match: Optional[str] = Header(default=None, alias="If-None-Match"),
    if_modified_since: Optional[str] = Header(default=None, alias="If-Modified-Since"),
):
    publication = _get_publication_by_token(token)
    clinician_scope = None
    if not publication:
        publication = _get_clinician_publication_by_token(token)
        if not publication:
            raise HTTPException(status_code=404, detail="Not found.")
        clinician_scope = publication["clinician_id"]

    owner = publication["username"]
    app_state, state_updated_at, state_updated_at_raw = _load_state_blob_and_updated_at(owner)
    publication_updated_at_raw = publication["updated_at"] or ""
    publication_updated_at = _parse_iso_datetime(publication_updated_at_raw)

    last_modified = max(state_updated_at, publication_updated_at)
    etag = _compute_public_etag(
        token=token,
        state_updated_at=state_updated_at_raw,
        publication_updated_at=publication_updated_at_raw,
    )
    headers = {
        "Cache-Control": "private, max-age=0, must-revalidate",
        "ETag": etag,
        "Last-Modified": format_datetime(last_modified, usegmt=True),
    }

    if _etag_matches(if_none_match, etag) or _if_modified_since_matches(
        if_modified_since, last_modified
    ):
        return Response(status_code=304, headers=headers)

    cal_name = f"Shift Planner ({owner})"
    if clinician_scope:
        clinician_name = None
        for clinician in app_state.get("clinicians") or []:
            if clinician.get("id") == clinician_scope:
                clinician_name = clinician.get("name")
                break
        if clinician_name:
            cal_name = f"Shift Planner ({clinician_name})"
    ics = generate_ics(
        app_state,
        app_state.get("publishedWeekStartISOs") or [],
        cal_name,
        clinician_id=clinician_scope,
        dtstamp=last_modified,
    )
    headers["Content-Disposition"] = f'inline; filename="shift-planner-{owner}.ics"'
    return Response(content=ics, media_type="text/calendar", headers=headers)


@app.post("/v1/solve", response_model=SolveDayResponse)
def solve_day(payload: SolveDayRequest, current_user: UserPublic = Depends(_get_current_user)):
    STATE = _load_state(current_user.username)
    dateISO = payload.dateISO

    rows_by_id = {row.id: row for row in STATE.rows}
    class_rows = [row for row in STATE.rows if row.kind == "class"]
    ignored_pool_rows = {"pool-not-allocated", "pool-vacation"}
    shift_rows: List[tuple[WorkplaceRow, SubShift, str, int]] = []
    shift_row_ids: set[str] = set()
    parent_by_shift_id: Dict[str, str] = {}
    for index, row in enumerate(class_rows):
        for shift in row.subShifts:
            shift_row_id = _build_shift_row_id(row.id, shift.id)
            shift_rows.append((row, shift, shift_row_id, index))
            shift_row_ids.add(shift_row_id)
            parent_by_shift_id[shift_row_id] = row.id

    vacation_ids = set()
    for clinician in STATE.clinicians:
        for vacation in clinician.vacations:
            if vacation.startISO <= dateISO <= vacation.endISO:
                vacation_ids.add(clinician.id)
                break

    assigned_ids = set()
    class_assignments = []
    for assignment in STATE.assignments:
        if assignment.dateISO != dateISO:
            continue
        if assignment.rowId in ignored_pool_rows:
            continue
        if assignment.clinicianId in vacation_ids:
            continue
        assigned_ids.add(assignment.clinicianId)
        if assignment.rowId in shift_row_ids:
            class_assignments.append(assignment)

    free_clinicians = [
        c
        for c in STATE.clinicians
        if c.id not in assigned_ids and c.id not in vacation_ids
    ]

    model = cp_model.CpModel()
    var_map = {}
    pref_weight: Dict[str, Dict[str, int]] = {}
    for clinician in free_clinicians:
        pref_weight[clinician.id] = {}
        for idx, class_id in enumerate(clinician.preferredClassIds):
            pref_weight[clinician.id][class_id] = max(1, len(clinician.preferredClassIds) - idx)
        for row, _shift, shift_row_id, _index in shift_rows:
            if row.id in clinician.qualifiedClassIds:
                var_map[(clinician.id, shift_row_id)] = model.NewBoolVar(
                    f"x_{clinician.id}_{shift_row_id}"
                )

    for clinician in free_clinicians:
        vars_for_clinician = [
            var_map[(clinician.id, shift_row_id)]
            for _row, _shift, shift_row_id, _index in shift_rows
            if (clinician.id, shift_row_id) in var_map
        ]
        if vars_for_clinician:
            model.Add(sum(vars_for_clinician) <= 1)

    slack_vars = []
    coverage_terms = []
    slack_terms = []
    class_need: Dict[str, int] = {}
    class_order_weight: Dict[str, int] = {}
    total_classes = len(class_rows)
    for row, shift, shift_row_id, index in shift_rows:
        required = STATE.minSlotsByRowId.get(
            shift_row_id, MinSlots(weekday=0, weekend=0)
        )
        is_weekend = _is_weekend_or_holiday(dateISO, STATE.holidays)
        base_target = required.weekend if is_weekend else required.weekday
        override = STATE.slotOverridesByKey.get(f"{shift_row_id}__{dateISO}", 0)
        target = max(0, base_target + override)
        class_need[shift_row_id] = target
        class_order_weight[shift_row_id] = max(1, total_classes - index) * 10 + (
            4 - shift.order
        )
        already = len([a for a in class_assignments if a.rowId == shift_row_id])
        missing = max(0, target - already)
        if missing == 0:
            if payload.only_fill_required:
                assigned_vars = [
                    var_map[(clinician.id, shift_row_id)]
                    for clinician in free_clinicians
                    if (clinician.id, shift_row_id) in var_map
                ]
                if assigned_vars:
                    model.Add(sum(assigned_vars) == 0)
            continue
        assigned_vars = [
            var_map[(clinician.id, shift_row_id)]
            for clinician in free_clinicians
            if (clinician.id, shift_row_id) in var_map
        ]
        if assigned_vars:
            covered = model.NewBoolVar(f"covered_{shift_row_id}")
            model.Add(sum(assigned_vars) >= covered)
            coverage_terms.append(covered * class_order_weight[shift_row_id])
            if payload.only_fill_required:
                model.Add(sum(assigned_vars) <= missing)
        slack = model.NewIntVar(0, missing, f"slack_{shift_row_id}")
        if assigned_vars:
            model.Add(sum(assigned_vars) + slack >= missing)
        else:
            model.Add(slack >= missing)
        slack_vars.append(slack)
        slack_terms.append(slack * class_order_weight[shift_row_id])

    total_slack = sum(slack_terms) if slack_terms else 0
    total_coverage = sum(coverage_terms) if coverage_terms else 0
    total_priority = sum(
        var * class_need.get(rid, 0) for (cid, rid), var in var_map.items()
    )
    total_preference = sum(
        var * pref_weight.get(cid, {}).get(parent_by_shift_id.get(rid, ""), 0)
        for (cid, rid), var in var_map.items()
    )
    if payload.only_fill_required:
        model.Minimize(
            -total_coverage * 10000 + total_slack * 100 - total_preference
        )
    else:
        model.Minimize(
            -total_coverage * 10000
            + total_slack * 100
            - total_priority * 10
            - total_preference
        )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 2.0
    solver.parameters.num_search_workers = 8
    result = solver.Solve(model)

    notes: List[str] = []
    if result not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveDayResponse(dateISO=dateISO, assignments=[], notes=["No solution"])

    new_assignments: List[Assignment] = []
    for (clinician_id, row_id), var in var_map.items():
        if solver.Value(var) == 1:
            new_assignments.append(
                Assignment(
                    id=f"as-{dateISO}-{clinician_id}-{row_id}",
                    rowId=row_id,
                    dateISO=dateISO,
                    clinicianId=clinician_id,
                )
            )

    if slack_vars and solver.Value(total_slack) > 0:
        notes.append("Could not fill all required slots.")

    return SolveDayResponse(dateISO=dateISO, assignments=new_assignments, notes=notes)


def _is_weekend_or_holiday(dateISO: str, holidays: List[Holiday]) -> bool:
    y, m, d = dateISO.split("-")
    import datetime

    is_weekend = datetime.date(int(y), int(m), int(d)).weekday() >= 5
    if is_weekend:
        return True
    return any(holiday.dateISO == dateISO for holiday in holidays)
