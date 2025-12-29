import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from .constants import (
    DEFAULT_LOCATION_ID,
    DEFAULT_LOCATION_NAME,
    DEFAULT_SUB_SHIFT_MINUTES,
    DEFAULT_SUB_SHIFT_START,
    DEFAULT_SUB_SHIFT_START_MINUTES,
    SHIFT_ROW_SEPARATOR,
)
from .db import _get_connection, _utcnow_iso
from .models import (
    AppState,
    Assignment,
    Clinician,
    Holiday,
    Location,
    MinSlots,
    SolverRule,
    SolverSettings,
    SubShift,
    UserStateExport,
    VacationRange,
    WorkplaceRow,
)


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
                endTime=_format_minutes(
                    DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES
                ),
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
            int(max(0, legacy_hours) * 60)
            if legacy_hours is not None
            else DEFAULT_SUB_SHIFT_MINUTES
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
                endTime=_format_minutes(
                    DEFAULT_SUB_SHIFT_START_MINUTES + DEFAULT_SUB_SHIFT_MINUTES
                ),
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
    row_ids = {row.id for row in state.rows}
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
    fallback_shift_id_by_class = {
        row.id: (row.subShifts[0].id if row.subShifts else "s1") for row in class_rows
    }

    next_assignments: List[Assignment] = []
    for assignment in state.assignments:
        row_id = assignment.rowId
        if row_id in class_row_ids and SHIFT_ROW_SEPARATOR not in row_id:
            fallback = fallback_shift_id_by_class.get(row_id, "s1")
            assignment = assignment.model_copy(
                update={"rowId": _build_shift_row_id(row_id, fallback)}
            )
            row_id = assignment.rowId
            changed = True
        if SHIFT_ROW_SEPARATOR in row_id:
            class_id, sub_shift_id = _parse_shift_row_id(row_id)
            if class_id in class_row_ids:
                class_shift_ids = sub_shift_ids_by_class.get(class_id, set())
                if not sub_shift_id or sub_shift_id not in class_shift_ids:
                    fallback = fallback_shift_id_by_class.get(class_id)
                    if not fallback:
                        changed = True
                        continue
                    assignment = assignment.model_copy(
                        update={"rowId": _build_shift_row_id(class_id, fallback)}
                    )
                    changed = True
                next_assignments.append(assignment)
                continue
            changed = True
            continue
        if row_id in class_row_ids or row_id.startswith("pool-") or row_id in row_ids:
            next_assignments.append(assignment)
        else:
            changed = True
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
                    base
                    if shift.id == "s1" and base
                    else MinSlots(weekday=0, weekend=0)
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

    # Solver settings defaults
    solver_settings = state.solverSettings or {}
    default_settings = SolverSettings().model_dump()
    merged_settings = {**default_settings, **solver_settings}
    merged_settings["allowMultipleShiftsPerDay"] = bool(
        merged_settings.get("allowMultipleShiftsPerDay", False)
    )
    merged_settings["enforceSameLocationPerDay"] = bool(
        merged_settings.get("enforceSameLocationPerDay", False)
    )
    merged_settings["onCallRestEnabled"] = bool(
        merged_settings.get("onCallRestEnabled", False)
    )
    on_call_class_id = merged_settings.get("onCallRestClassId")
    if not isinstance(on_call_class_id, str) or on_call_class_id not in class_row_ids:
        merged_settings["onCallRestClassId"] = class_rows[0].id if class_rows else None

    def _clamp_days(value: Any) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 1
        return max(0, min(7, parsed))

    merged_settings["onCallRestDaysBefore"] = _clamp_days(
        merged_settings.get("onCallRestDaysBefore", 1)
    )
    merged_settings["onCallRestDaysAfter"] = _clamp_days(
        merged_settings.get("onCallRestDaysAfter", 1)
    )
    if merged_settings != solver_settings:
        state.solverSettings = merged_settings
        changed = True

    # Solver rules validation
    valid_shift_row_ids = {
        _build_shift_row_id(row.id, shift.id) for row in class_rows for shift in row.subShifts
    }
    normalized_rules: List[Dict[str, Any]] = []
    for raw_rule in state.solverRules or []:
        try:
            rule = SolverRule.model_validate(raw_rule)
        except Exception:
            changed = True
            continue
        enabled = rule.enabled
        if rule.ifShiftRowId not in valid_shift_row_ids:
            enabled = False
        if rule.thenType == "shiftRow" and rule.thenShiftRowId not in valid_shift_row_ids:
            enabled = False
        normalized_rules.append({**rule.model_dump(), "enabled": enabled})
        if enabled != rule.enabled:
            changed = True
    if normalized_rules != (state.solverRules or []):
        state.solverRules = normalized_rules
        changed = True

    return state, changed


def _default_state() -> AppState:
    current_year = datetime.now(timezone.utc).year
    default_location = Location(id=DEFAULT_LOCATION_ID, name=DEFAULT_LOCATION_NAME)
    rows = [
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
            id="pool-rest-day",
            name="Rest Day",
            kind="pool",
            dotColorClass="bg-slate-200",
        ),
        WorkplaceRow(
            id="pool-vacation",
            name="Vacation",
            kind="pool",
            dotColorClass="bg-emerald-500",
        ),
    ]
    clinicians = [
        Clinician(
            id="sarah-chen",
            name="Sarah Chen",
            qualifiedClassIds=["mri", "sonography", "conventional"],
            preferredClassIds=["sonography", "mri"],
            vacations=[
                VacationRange(id="vac-1", startISO="2025-12-18", endISO="2025-12-20")
            ],
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
        solverSettings=SolverSettings().model_dump(),
        solverRules=[],
        rows=rows,
        clinicians=clinicians,
        assignments=[],
        minSlotsByRowId=min_slots,
        slotOverridesByKey={},
        holidayCountry="DE",
        holidayYear=current_year,
        holidays=[],
    )


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
            from fastapi import HTTPException

            raise HTTPException(status_code=400, detail="Invalid date.") from exc
        return trimmed
    match = re.match(r"^(\d{1,2})\.(\d{1,2})\.(\d{4})$", trimmed)
    if not match:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Invalid date format.")
    day_raw, month_raw, year_raw = match.groups()
    day = int(day_raw)
    month = int(month_raw)
    year = int(year_raw)
    try:
        dt = datetime(year, month, day)
    except ValueError as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Invalid date.") from exc
    return dt.date().isoformat()


def _parse_iso_datetime(value: Optional[str]) -> datetime:
    if not value:
        return datetime.now(timezone.utc).replace(microsecond=0)
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return datetime.now(timezone.utc).replace(microsecond=0)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(microsecond=0)


def _normalize_week_start(date_iso: str) -> tuple[str, str]:
    base = datetime.fromisoformat(f"{date_iso}T00:00:00+00:00").date()
    week_start = base - timedelta(days=base.weekday())
    week_end = week_start + timedelta(days=6)
    return week_start.isoformat(), week_end.isoformat()


def _load_state_blob_and_updated_at(username: str) -> tuple[Dict[str, Any], datetime, str]:
    conn = _get_connection()
    row = conn.execute(
        "SELECT data, updated_at FROM app_state WHERE id = ?", (username,)
    ).fetchone()
    conn.close()
    if not row:
        state = _default_state()
        _save_state(state, username)
        now = _utcnow_iso()
        return state.model_dump(), datetime.fromisoformat(now), now
    data = json.loads(row[0])
    updated_at_raw = row[1]
    updated_at = _parse_iso_datetime(updated_at_raw)
    return data, updated_at, updated_at_raw


def _parse_import_state(payload: Optional[Dict[str, Any]]) -> Optional[AppState]:
    if payload is None:
        return None
    if isinstance(payload, dict) and "state" in payload:
        export = UserStateExport.model_validate(payload)
        normalized, _ = _normalize_state(export.state)
        return normalized
    state = AppState.model_validate(payload)
    normalized, _ = _normalize_state(state)
    return normalized
