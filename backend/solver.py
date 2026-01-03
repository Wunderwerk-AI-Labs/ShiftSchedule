from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends
from ortools.sat.python import cp_model

from .auth import _get_current_user
from .constants import (
    DEFAULT_LOCATION_ID,
    DEFAULT_SUB_SHIFT_MINUTES,
    DEFAULT_SUB_SHIFT_START_MINUTES,
)
from .models import (
    Assignment,
    Holiday,
    SolveDayRequest,
    SolveDayResponse,
    SolveWeekRequest,
    SolveWeekResponse,
    SolverSettings,
    UserPublic,
)
from .state import _load_state

router = APIRouter()
PREFERRED_WINDOW_WEIGHT = 5
WORKING_HOURS_BLOCK_MINUTES = 15
WORKING_HOURS_PENALTY_WEIGHT = 1


def _get_day_type(date_iso: str, holidays: List[Holiday]) -> str:
    if any(holiday.dateISO == date_iso for holiday in holidays):
        return "holiday"
    dt = datetime.fromisoformat(f"{date_iso}T00:00:00")
    weekday = dt.weekday()
    mapping = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    return mapping[weekday]


def _get_weekday_key(date_iso: str) -> str:
    dt = datetime.fromisoformat(f"{date_iso}T00:00:00")
    mapping = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    return mapping[dt.weekday()]


def _normalize_window_requirement(value: Any) -> str:
    if not isinstance(value, str):
        return "none"
    trimmed = value.strip().lower()
    if trimmed == "preferred":
        return "preference"
    if trimmed in ("none", "preference", "mandatory"):
        return trimmed
    return "none"


def _get_clinician_time_window(clinician: Any, weekday_key: str) -> Tuple[str, Optional[int], Optional[int]]:
    raw = getattr(clinician, "preferredWorkingTimes", None)
    if not isinstance(raw, dict):
        return "none", None, None
    entry = raw.get(weekday_key)
    if not entry:
        return "none", None, None
    if isinstance(entry, dict):
        start_raw = entry.get("startTime")
        end_raw = entry.get("endTime")
        requirement_raw = entry.get("requirement", entry.get("mode", entry.get("status")))
    else:
        start_raw = getattr(entry, "startTime", None)
        end_raw = getattr(entry, "endTime", None)
        requirement_raw = getattr(entry, "requirement", None)
    requirement = _normalize_window_requirement(requirement_raw)
    start_minutes = _parse_time_to_minutes(start_raw)
    end_minutes = _parse_time_to_minutes(end_raw)
    if (
        requirement == "none"
        or start_minutes is None
        or end_minutes is None
        or end_minutes <= start_minutes
    ):
        return "none", None, None
    return requirement, start_minutes, end_minutes


def _parse_time_to_minutes(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    parts = value.split(":")
    if len(parts) != 2:
        return None
    try:
        h = int(parts[0])
        m = int(parts[1])
    except ValueError:
        return None
    if h < 0 or h > 23 or m < 0 or m > 59:
        return None
    return h * 60 + m


def _build_slot_interval(slot, location_id: str) -> Tuple[int, int, str]:
    start = _parse_time_to_minutes(getattr(slot, "startTime", None))
    if start is None:
        start = DEFAULT_SUB_SHIFT_START_MINUTES
    end = _parse_time_to_minutes(getattr(slot, "endTime", None))
    if end is None:
        end = start + DEFAULT_SUB_SHIFT_MINUTES
    offset = (
        slot.endDayOffset if isinstance(getattr(slot, "endDayOffset", None), int) else 0
    )
    total_end = end + max(0, min(3, offset)) * 24 * 60
    if total_end <= start:
        total_end = start
    return start, total_end, location_id


def _collect_slot_contexts(state) -> List[Dict[str, Any]]:
    template = state.weeklyTemplate
    if not template:
        return []
    location_order = {loc.id: idx for idx, loc in enumerate(state.locations)}
    day_order = {day_type: idx for idx, day_type in enumerate(["mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday"])}
    block_by_id = {block.id: block for block in template.blocks or []}
    block_order = {block.id: idx for idx, block in enumerate(template.blocks or [])}
    contexts: List[Dict[str, Any]] = []
    for template_location in template.locations:
        row_band_by_id = {band.id: band.order for band in template_location.rowBands}
        col_band_by_id = {band.id: band for band in template_location.colBands}
        location_id = (
            template_location.locationId
            if state.locationsEnabled
            else DEFAULT_LOCATION_ID
        )
        for slot in template_location.slots:
            block = block_by_id.get(slot.blockId)
            if not block:
                continue
            col_band = col_band_by_id.get(slot.colBandId)
            if not col_band:
                continue
            contexts.append(
                {
                    "slot": slot,
                    "block": block,
                    "slot_id": slot.id,
                    "section_id": block.sectionId,
                    "location_id": location_id,
                    "block_order": block_order.get(block.id, len(block_order)),
                    "row_order": row_band_by_id.get(slot.rowBandId, 0),
                    "col_order": col_band.order,
                    "day_type": col_band.dayType,
                    "day_order": day_order.get(col_band.dayType, 0),
                    "location_order": location_order.get(
                        template_location.locationId, 0
                    ),
                }
            )
    contexts.sort(
        key=lambda item: (
            item["block_order"],
            item["location_order"],
            item["row_order"],
            item["day_order"],
            item["col_order"],
        )
    )
    return contexts


@router.post("/v1/solve", response_model=SolveDayResponse)
def solve_day(payload: SolveDayRequest, current_user: UserPublic = Depends(_get_current_user)):
    state = _load_state(current_user.username)
    date_iso = payload.dateISO
    holidays = state.holidays or []
    day_type = _get_day_type(date_iso, holidays)
    weekday_key = _get_weekday_key(date_iso)

    slot_contexts = _collect_slot_contexts(state)
    slot_ids = {ctx["slot_id"] for ctx in slot_contexts}
    active_slots = [
        ctx
        for ctx in slot_contexts
        if ctx.get("day_type") == day_type
    ]

    vacation_ids = set()
    for clinician in state.clinicians:
        for vacation in clinician.vacations:
            if vacation.startISO <= date_iso <= vacation.endISO:
                vacation_ids.add(clinician.id)
                break

    manual_assignments: Dict[str, List[str]] = {}
    for assignment in state.assignments:
        if assignment.dateISO != date_iso:
            continue
        if assignment.rowId not in slot_ids:
            continue
        if assignment.clinicianId in vacation_ids:
            continue
        manual_assignments.setdefault(assignment.clinicianId, []).append(assignment.rowId)

    solver_settings = SolverSettings.model_validate(state.solverSettings or {})

    model = cp_model.CpModel()
    var_map: Dict[Tuple[str, str], cp_model.IntVar] = {}
    pref_weight: Dict[str, Dict[str, int]] = {}
    time_window_terms: List[cp_model.IntVar] = []
    section_by_slot_id = {ctx["slot_id"]: ctx["section_id"] for ctx in slot_contexts}
    slot_intervals: Dict[str, Tuple[int, int, str]] = {}
    for ctx in slot_contexts:
        slot_intervals[ctx["slot_id"]] = _build_slot_interval(
            ctx["slot"], ctx["location_id"]
        )

    for clinician in state.clinicians:
        if clinician.id in vacation_ids:
            continue
        window_req, window_start, window_end = _get_clinician_time_window(
            clinician, weekday_key
        )
        weights: Dict[str, int] = {}
        preferred = clinician.preferredClassIds or []
        for idx, class_id in enumerate(preferred):
            weights[class_id] = max(1, len(preferred) - idx)
        pref_weight[clinician.id] = weights
        for ctx in active_slots:
            if ctx["section_id"] not in clinician.qualifiedClassIds:
                continue
            interval = slot_intervals.get(ctx["slot_id"])
            if not interval:
                continue
            start, end, _loc = interval
            fits_window = (
                window_start is not None
                and window_end is not None
                and start >= window_start
                and end <= window_end
            )
            if window_req == "mandatory" and not fits_window:
                continue
            var = model.NewBoolVar(f"x_{clinician.id}_{ctx['slot_id']}")
            var_map[(clinician.id, ctx["slot_id"])] = var
            if window_req == "preference" and fits_window:
                time_window_terms.append(var)

    for clinician in state.clinicians:
        vars_for_clinician: List[Tuple[str, cp_model.IntVar, int, int, str]] = []
        for (cid, slot_id), var in var_map.items():
            if cid != clinician.id:
                continue
            interval = slot_intervals.get(slot_id)
            if not interval:
                continue
            start, end, loc = interval
            vars_for_clinician.append((slot_id, var, start, end, loc))
        for i in range(len(vars_for_clinician)):
            _sid_i, var_i, start_i, end_i, loc_i = vars_for_clinician[i]
            for j in range(i + 1, len(vars_for_clinician)):
                _sid_j, var_j, start_j, end_j, loc_j = vars_for_clinician[j]
                overlaps = not (end_i <= start_j or end_j <= start_i)
                if overlaps:
                    model.Add(var_i + var_j <= 1)
                if (
                    solver_settings.enforceSameLocationPerDay
                    and loc_i
                    and loc_j
                    and loc_i != loc_j
                ):
                    model.Add(var_i + var_j <= 1)

        manual_entries: List[Tuple[int, int, str]] = []
        for slot_id in manual_assignments.get(clinician.id, []):
            interval = slot_intervals.get(slot_id)
            if not interval:
                continue
            start, end, loc = interval
            manual_entries.append((start, end, loc))
        for _sid, var, start_i, end_i, loc_i in vars_for_clinician:
            for start_m, end_m, loc_m in manual_entries:
                overlaps = not (end_i <= start_m or end_m <= start_i)
                if overlaps:
                    model.Add(var <= 0)
                if (
                    solver_settings.enforceSameLocationPerDay
                    and loc_i
                    and loc_m
                    and loc_i != loc_m
                ):
                    model.Add(var <= 0)

    coverage_terms = []
    slack_terms = []
    notes: List[str] = []
    total_slots = len(slot_contexts)
    total_required = 0
    order_weight_by_slot_id: Dict[str, int] = {}

    def get_manual_count(slot_id: str) -> int:
        return sum(1 for rows in manual_assignments.values() if slot_id in rows)

    # First pass: collect slot info for wave-based distribution
    slot_info: List[Dict[str, Any]] = []
    for index, ctx in enumerate(active_slots):
        slot_id = ctx["slot_id"]
        order_weight = max(1, total_slots - index) * 10
        order_weight_by_slot_id[slot_id] = order_weight
        raw_required = getattr(ctx["slot"], "requiredSlots", 0)
        base_required = raw_required if isinstance(raw_required, int) else 0
        override = state.slotOverridesByKey.get(f"{slot_id}__{date_iso}", 0)
        target = max(0, base_required + override)
        total_required += target
        already = get_manual_count(slot_id)
        missing = max(0, target - already)
        vars_here = [
            var for (cid, sid), var in var_map.items() if sid == slot_id
        ]
        slot_info.append({
            "ctx": ctx,
            "slot_id": slot_id,
            "order_weight": order_weight,
            "base_required": base_required,
            "target": target,
            "already": already,
            "missing": missing,
            "vars_here": vars_here,
        })

    # Calculate wave multiplier for equal distribution when not only_fill_required
    # Wave multiplier determines how many times we can fill all slots proportionally
    wave_multiplier = 1
    if not payload.only_fill_required:
        total_available_clinicians = len(set(cid for (cid, _) in var_map.keys()))
        total_base_required = sum(info["base_required"] for info in slot_info if info["base_required"] > 0)
        if total_base_required > 0:
            # Calculate how many complete waves we can do with available clinicians
            wave_multiplier = max(1, total_available_clinicians // total_base_required)

    for info in slot_info:
        slot_id = info["slot_id"]
        order_weight = info["order_weight"]
        target = info["target"]
        base_required = info["base_required"]
        already = info["already"]
        missing = info["missing"]
        vars_here = info["vars_here"]

        if missing == 0:
            if payload.only_fill_required and vars_here:
                model.Add(sum(vars_here) == 0)
            continue
        if vars_here:
            covered = model.NewBoolVar(f"covered_{slot_id}")
            model.Add(sum(vars_here) + already >= covered)
            coverage_terms.append(covered * order_weight)
            # Calculate slot capacity based on wave distribution
            if payload.only_fill_required:
                # Only fill to required amount
                slot_capacity = missing
            else:
                # Wave-based: allow up to (base_required * wave_multiplier) - already
                wave_target = base_required * wave_multiplier
                slot_capacity = max(missing, wave_target - already)
            model.Add(sum(vars_here) <= slot_capacity)
        slack = model.NewIntVar(0, missing, f"slack_{slot_id}")
        if vars_here:
            model.Add(sum(vars_here) + slack + already >= missing)
        else:
            model.Add(slack + already >= missing)
        slack_terms.append(slack * order_weight)

    total_slack = sum(slack_terms) if slack_terms else 0
    total_coverage = sum(coverage_terms) if coverage_terms else 0
    total_priority = sum(
        var * order_weight_by_slot_id.get(sid, 0)
        for (cid, sid), var in var_map.items()
    )
    total_preference = sum(
        var * pref_weight.get(cid, {}).get(section_by_slot_id.get(sid, ""), 0)
        for (cid, sid), var in var_map.items()
    )
    total_time_window_preference = sum(time_window_terms) if time_window_terms else 0

    if payload.only_fill_required:
        model.Minimize(
            -total_coverage * 1000
            + total_slack * 1000
            - total_preference
            - total_time_window_preference * PREFERRED_WINDOW_WEIGHT
        )
    else:
        model.Minimize(
            -total_coverage * 1000
            + total_slack * 1000
            - total_priority * 10
            - total_preference
            - total_time_window_preference * PREFERRED_WINDOW_WEIGHT
        )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 2.0
    solver.parameters.num_search_workers = 8
    result = solver.Solve(model)

    if result not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveDayResponse(dateISO=date_iso, assignments=[], notes=["No solution"])

    new_assignments: List[Assignment] = []
    for (clinician_id, slot_id), var in var_map.items():
        if solver.Value(var) == 1:
            new_assignments.append(
                Assignment(
                    id=f"as-{date_iso}-{clinician_id}-{slot_id}",
                    rowId=slot_id,
                    dateISO=date_iso,
                    clinicianId=clinician_id,
                )
            )

    if slack_terms and solver.Value(total_slack) > 0:
        notes.append("Could not fill all required slots.")
    if payload.only_fill_required and total_required == 0:
        notes.append("No required slots detected for the selected day.")

    return SolveDayResponse(dateISO=date_iso, assignments=new_assignments, notes=notes)


@router.post("/v1/solve/week", response_model=SolveWeekResponse)
def solve_week(payload: SolveWeekRequest, current_user: UserPublic = Depends(_get_current_user)):
    state = _load_state(current_user.username)
    try:
        range_start = datetime.fromisoformat(f"{payload.startISO}T00:00:00+00:00").date()
    except ValueError:
        raise ValueError("Invalid startISO")
    if payload.endISO:
        try:
            range_end = datetime.fromisoformat(f"{payload.endISO}T00:00:00+00:00").date()
        except ValueError:
            raise ValueError("Invalid endISO")
    else:
        range_end = range_start + timedelta(days=6)
    if range_end < range_start:
        raise ValueError("Invalid endISO")

    context_start = range_start - timedelta(days=1)
    context_end = range_end + timedelta(days=1)
    day_isos: List[str] = []
    cursor = context_start
    while cursor <= context_end:
        day_isos.append(cursor.isoformat())
        cursor += timedelta(days=1)
    target_day_isos: List[str] = []
    cursor = range_start
    while cursor <= range_end:
        target_day_isos.append(cursor.isoformat())
        cursor += timedelta(days=1)
    target_date_set = set(target_day_isos)
    day_index_by_iso = {date_iso: idx for idx, date_iso in enumerate(day_isos)}

    slot_contexts = _collect_slot_contexts(state)
    slot_ids = {ctx["slot_id"] for ctx in slot_contexts}
    section_by_slot_id = {ctx["slot_id"]: ctx["section_id"] for ctx in slot_contexts}
    slot_intervals: Dict[str, Tuple[int, int, str]] = {}
    for ctx in slot_contexts:
        slot_intervals[ctx["slot_id"]] = _build_slot_interval(
            ctx["slot"], ctx["location_id"]
        )

    holidays = state.holidays or []
    day_type_by_iso = {iso: _get_day_type(iso, holidays) for iso in day_isos}
    weekday_by_iso = {iso: _get_weekday_key(iso) for iso in day_isos}

    vac_by_clinician: Dict[str, List[Tuple[str, str]]] = {}
    for clinician in state.clinicians:
        vac_by_clinician[clinician.id] = [(v.startISO, v.endISO) for v in clinician.vacations]

    def is_on_vac(clinician_id: str, date_iso: str) -> bool:
        for start, end in vac_by_clinician.get(clinician_id, []):
            if start <= date_iso <= end:
                return True
        return False

    manual_assignments: Dict[Tuple[str, str], List[str]] = {}
    for assignment in state.assignments:
        if assignment.rowId not in slot_ids:
            continue
        if assignment.dateISO not in day_isos:
            continue
        if is_on_vac(assignment.clinicianId, assignment.dateISO):
            continue
        manual_assignments.setdefault((assignment.clinicianId, assignment.dateISO), []).append(
            assignment.rowId
        )

    solver_settings = SolverSettings.model_validate(state.solverSettings or {})
    pref_weight: Dict[str, Dict[str, int]] = {}
    for clinician in state.clinicians:
        weights: Dict[str, int] = {}
        preferred = clinician.preferredClassIds or []
        for idx, class_id in enumerate(preferred):
            weights[class_id] = max(1, len(preferred) - idx)
        pref_weight[clinician.id] = weights
    working_window_by_clinician_date: Dict[Tuple[str, str], Tuple[str, int, int]] = {}
    for clinician in state.clinicians:
        for date_iso in target_day_isos:
            weekday_key = weekday_by_iso.get(date_iso)
            if not weekday_key:
                continue
            requirement, start_minutes, end_minutes = _get_clinician_time_window(
                clinician, weekday_key
            )
            if requirement == "none" or start_minutes is None or end_minutes is None:
                continue
            working_window_by_clinician_date[(clinician.id, date_iso)] = (
                requirement,
                start_minutes,
                end_minutes,
            )

    model = cp_model.CpModel()
    var_map: Dict[Tuple[str, str, str], cp_model.IntVar] = {}
    time_window_terms: List[cp_model.IntVar] = []

    active_slots_by_date: Dict[str, List[Dict[str, Any]]] = {}
    for date_iso in target_day_isos:
        day_type = day_type_by_iso.get(date_iso)
        active_slots_by_date[date_iso] = [
            ctx
            for ctx in slot_contexts
            if ctx.get("day_type") == day_type
        ]

    # Build vars
    for clinician in state.clinicians:
        for date_iso in target_day_isos:
            if is_on_vac(clinician.id, date_iso):
                continue
            window = working_window_by_clinician_date.get((clinician.id, date_iso))
            for ctx in active_slots_by_date.get(date_iso, []):
                if ctx["section_id"] not in clinician.qualifiedClassIds:
                    continue
                slot_id = ctx["slot_id"]
                interval = slot_intervals.get(slot_id)
                if not interval:
                    continue
                start, end, _loc = interval
                fits_window = False
                if window:
                    requirement, window_start, window_end = window
                    fits_window = (
                        start >= window_start and end <= window_end
                    )
                    if requirement == "mandatory" and not fits_window:
                        continue
                var = model.NewBoolVar(f"x_{clinician.id}_{date_iso}_{slot_id}")
                var_map[(clinician.id, date_iso, slot_id)] = var
                if window and window[0] == "preference" and fits_window:
                    time_window_terms.append(var)

    # Overlap + location constraints
    for clinician in state.clinicians:
        vars_for_clinician: List[Tuple[str, str, cp_model.IntVar, int, int, str]] = []
        for (cid, date_iso, sid), var in var_map.items():
            if cid != clinician.id:
                continue
            interval = slot_intervals.get(sid)
            day_index = day_index_by_iso.get(date_iso)
            if not interval or day_index is None:
                continue
            start, end, loc = interval
            abs_start = start + day_index * 24 * 60
            abs_end = end + day_index * 24 * 60
            vars_for_clinician.append((date_iso, sid, var, abs_start, abs_end, loc))

        for i in range(len(vars_for_clinician)):
            date_i, _sid_i, var_i, start_i, end_i, loc_i = vars_for_clinician[i]
            for j in range(i + 1, len(vars_for_clinician)):
                date_j, _sid_j, var_j, start_j, end_j, loc_j = vars_for_clinician[j]
                overlaps = not (end_i <= start_j or end_j <= start_i)
                if overlaps:
                    model.Add(var_i + var_j <= 1)
                if (
                    solver_settings.enforceSameLocationPerDay
                    and date_i == date_j
                    and loc_i
                    and loc_j
                    and loc_i != loc_j
                ):
                    model.Add(var_i + var_j <= 1)

        manual_entries: List[Tuple[str, int, int, str]] = []
        for (cid, date_iso), row_ids in manual_assignments.items():
            if cid != clinician.id:
                continue
            day_index = day_index_by_iso.get(date_iso)
            if day_index is None:
                continue
            for row_id in row_ids:
                interval = slot_intervals.get(row_id)
                if not interval:
                    continue
                start, end, loc = interval
                abs_start = start + day_index * 24 * 60
                abs_end = end + day_index * 24 * 60
                manual_entries.append((date_iso, abs_start, abs_end, loc))

        for date_i, _sid_i, var_i, start_i, end_i, loc_i in vars_for_clinician:
            for date_m, start_m, end_m, loc_m in manual_entries:
                overlaps = not (end_i <= start_m or end_m <= start_i)
                if overlaps:
                    model.Add(var_i <= 0)
                if (
                    solver_settings.enforceSameLocationPerDay
                    and date_i == date_m
                    and loc_i
                    and loc_m
                    and loc_i != loc_m
                ):
                    model.Add(var_i <= 0)

    # Coverage + rules
    coverage_terms = []
    slack_terms = []
    notes: List[str] = []
    total_slots = len(slot_contexts)
    order_weight_by_slot_id: Dict[str, int] = {}
    BIG = 20
    total_required = 0

    def get_manual_count(date_iso: str, slot_id: str) -> int:
        count = 0
        for (cid, diso), row_ids in manual_assignments.items():
            if diso != date_iso:
                continue
            for rid in row_ids:
                if rid == slot_id:
                    count += 1
        return count

    # First pass: collect slot info for wave-based distribution
    slot_date_info: List[Dict[str, Any]] = []
    for index, ctx in enumerate(slot_contexts):
        slot_id = ctx["slot_id"]
        order_weight = max(1, total_slots - index) * 10
        order_weight_by_slot_id[slot_id] = order_weight
        for date_iso in target_day_isos:
            day_type = day_type_by_iso.get(date_iso)
            if ctx.get("day_type") != day_type:
                continue
            raw_required = getattr(ctx["slot"], "requiredSlots", 0)
            base_required = raw_required if isinstance(raw_required, int) else 0
            override = state.slotOverridesByKey.get(f"{slot_id}__{date_iso}", 0)
            target = max(0, base_required + override)
            total_required += target
            already = get_manual_count(date_iso, slot_id)
            missing = max(0, target - already)
            vars_here = [
                var
                for (cid, d, sid), var in var_map.items()
                if d == date_iso and sid == slot_id
            ]
            slot_date_info.append({
                "ctx": ctx,
                "slot_id": slot_id,
                "date_iso": date_iso,
                "order_weight": order_weight,
                "base_required": base_required,
                "target": target,
                "already": already,
                "missing": missing,
                "vars_here": vars_here,
            })

    # Calculate wave multiplier for equal distribution when not only_fill_required
    # Wave multiplier determines how many times we can fill all slots proportionally
    wave_multiplier = 1
    if not payload.only_fill_required:
        total_available_clinicians = len(set(cid for (cid, _, _) in var_map.keys()))
        total_base_required = sum(info["base_required"] for info in slot_date_info if info["base_required"] > 0)
        if total_base_required > 0:
            # Calculate how many complete waves we can do with available clinicians
            wave_multiplier = max(1, total_available_clinicians // total_base_required)

    for info in slot_date_info:
        slot_id = info["slot_id"]
        date_iso = info["date_iso"]
        order_weight = info["order_weight"]
        base_required = info["base_required"]
        target = info["target"]
        already = info["already"]
        missing = info["missing"]
        vars_here = info["vars_here"]

        if missing == 0:
            if payload.only_fill_required and vars_here:
                model.Add(sum(vars_here) == 0)
            continue
        if vars_here:
            covered = model.NewBoolVar(f"covered_{slot_id}_{date_iso}")
            model.Add(sum(vars_here) + already >= covered)
            coverage_terms.append(covered * order_weight)
            # Calculate slot capacity based on wave distribution
            if payload.only_fill_required:
                # Only fill to required amount
                slot_capacity = missing
            else:
                # Wave-based: allow up to (base_required * wave_multiplier) - already
                wave_target = base_required * wave_multiplier
                slot_capacity = max(missing, wave_target - already)
            model.Add(sum(vars_here) <= slot_capacity)
        slack = model.NewIntVar(0, missing, f"slack_{slot_id}_{date_iso}")
        if vars_here:
            model.Add(sum(vars_here) + slack + already >= missing)
        else:
            model.Add(slack + already >= missing)
        slack_terms.append(slack * order_weight)

    # On-call rest days
    rest_class_id = solver_settings.onCallRestClassId
    rest_before = max(0, solver_settings.onCallRestDaysBefore or 0)
    rest_after = max(0, solver_settings.onCallRestDaysAfter or 0)
    rest_shift_row_ids = {
        ctx["slot_id"]
        for ctx in slot_contexts
        if ctx["section_id"] == rest_class_id
    }
    if (
        solver_settings.onCallRestEnabled
        and rest_shift_row_ids
        and (rest_before > 0 or rest_after > 0)
    ):
        for clinician in state.clinicians:
            for day_index, date_iso in enumerate(day_isos):
                manual_rows = manual_assignments.get((clinician.id, date_iso), [])
                manual_on_call = any(
                    row_id in rest_shift_row_ids for row_id in manual_rows
                )
                on_call_vars = [
                    var
                    for (cid, d, sid), var in var_map.items()
                    if cid == clinician.id and d == date_iso and sid in rest_shift_row_ids
                ]
                if not manual_on_call and not on_call_vars:
                    continue
                on_call_var: Optional[cp_model.IntVar] = None
                if not manual_on_call:
                    on_call_var = model.NewBoolVar(
                        f"on_call_{clinician.id}_{date_iso}"
                    )
                    model.Add(sum(on_call_vars) >= on_call_var)
                    for var in on_call_vars:
                        model.Add(var <= on_call_var)

                def apply_rest_constraint(target_idx: int) -> None:
                    if target_idx < 0 or target_idx >= len(day_isos):
                        return
                    target_date = day_isos[target_idx]
                    if target_date not in target_date_set:
                        return
                    vars_target = [
                        var
                        for (cid, d, _sid), var in var_map.items()
                        if cid == clinician.id and d == target_date
                    ]
                    manual_target = len(
                        manual_assignments.get((clinician.id, target_date), [])
                    )
                    if manual_on_call:
                        if manual_target > 0:
                            return
                        if vars_target:
                            model.Add(sum(vars_target) == 0)
                        return
                    if on_call_var is None:
                        return
                    if manual_target > 0:
                        model.Add(on_call_var == 0)
                    elif vars_target:
                        model.Add(sum(vars_target) <= BIG * (1 - on_call_var))

                for offset in range(1, rest_before + 1):
                    apply_rest_constraint(day_index - offset)
                for offset in range(1, rest_after + 1):
                    apply_rest_constraint(day_index + offset)

    hours_penalty_terms: List[cp_model.IntVar] = []
    total_days = len(target_day_isos)
    scale = total_days / 7.0 if total_days else 0
    slot_duration_by_id = {
        slot_id: max(0, end - start)
        for slot_id, (start, end, _loc) in slot_intervals.items()
    }
    manual_minutes_by_clinician: Dict[str, int] = {c.id: 0 for c in state.clinicians}
    for (clinician_id, date_iso), row_ids in manual_assignments.items():
        if date_iso not in target_date_set:
            continue
        total_minutes = 0
        for row_id in row_ids:
            duration = slot_duration_by_id.get(row_id)
            if duration is None:
                continue
            total_minutes += duration
        manual_minutes_by_clinician[clinician_id] = (
            manual_minutes_by_clinician.get(clinician_id, 0) + total_minutes
        )
    for clinician in state.clinicians:
        if not isinstance(clinician.workingHoursPerWeek, (int, float)):
            continue
        if clinician.workingHoursPerWeek <= 0:
            continue
        # Use per-clinician tolerance (default 5 hours)
        tolerance_hours = max(0, clinician.workingHoursToleranceHours or 5)
        target_minutes = int(round(clinician.workingHoursPerWeek * 60 * scale))
        tol_minutes = int(round(tolerance_hours * 60 * scale))
        if target_minutes <= 0 and tol_minutes <= 0:
            continue
        decision_terms = [
            var * slot_duration_by_id.get(sid, 0)
            for (cid, _d, sid), var in var_map.items()
            if cid == clinician.id
        ]
        max_decision_minutes = sum(
            slot_duration_by_id.get(sid, 0)
            for (cid, _d, sid) in var_map.keys()
            if cid == clinician.id
        )
        manual_minutes = manual_minutes_by_clinician.get(clinician.id, 0)
        max_total = manual_minutes + max_decision_minutes
        target_minus_tol = max(0, target_minutes - tol_minutes)
        target_plus_tol = target_minutes + tol_minutes
        total_minutes_expr = manual_minutes + sum(decision_terms)
        max_under = max(max_total, target_minus_tol)
        under = model.NewIntVar(0, max_under, f"under_{clinician.id}")
        over = model.NewIntVar(0, max_total, f"over_{clinician.id}")
        model.Add(under >= target_minus_tol - total_minutes_expr)
        model.Add(over >= total_minutes_expr - target_plus_tol)
        under_blocks = model.NewIntVar(
            0,
            max_under // WORKING_HOURS_BLOCK_MINUTES + 1,
            f"under_blocks_{clinician.id}",
        )
        over_blocks = model.NewIntVar(
            0,
            max_total // WORKING_HOURS_BLOCK_MINUTES + 1,
            f"over_blocks_{clinician.id}",
        )
        model.AddDivisionEquality(under_blocks, under, WORKING_HOURS_BLOCK_MINUTES)
        model.AddDivisionEquality(over_blocks, over, WORKING_HOURS_BLOCK_MINUTES)
        hours_penalty_terms.append(under_blocks + over_blocks)

    total_slack = sum(slack_terms) if slack_terms else 0
    total_coverage = sum(coverage_terms) if coverage_terms else 0

    total_priority = sum(
        var * order_weight_by_slot_id.get(sid, 0)
        for (cid, _d, sid), var in var_map.items()
    )
    total_preference = sum(
        var * pref_weight.get(cid, {}).get(section_by_slot_id.get(sid, ""), 0)
        for (cid, _d, sid), var in var_map.items()
    )
    total_time_window_preference = sum(time_window_terms) if time_window_terms else 0
    total_hours_penalty = sum(hours_penalty_terms) if hours_penalty_terms else 0

    if payload.only_fill_required:
        model.Minimize(
            -total_coverage * 1000
            + total_slack * 1000
            - total_preference
            - total_time_window_preference * PREFERRED_WINDOW_WEIGHT
            + total_hours_penalty * WORKING_HOURS_PENALTY_WEIGHT
        )
    else:
        model.Minimize(
            -total_coverage * 1000
            + total_slack * 1000
            - total_priority * 10
            - total_preference
            - total_time_window_preference * PREFERRED_WINDOW_WEIGHT
            + total_hours_penalty * WORKING_HOURS_PENALTY_WEIGHT
        )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10.0
    solver.parameters.num_search_workers = 8
    result = solver.Solve(model)

    if result not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return SolveWeekResponse(
            startISO=range_start.isoformat(),
            endISO=range_end.isoformat(),
            assignments=[],
            notes=["No solution"],
        )

    new_assignments: List[Assignment] = []
    for (clinician_id, date_iso, row_id), var in var_map.items():
        if solver.Value(var) == 1:
            new_assignments.append(
                Assignment(
                    id=f"as-{date_iso}-{clinician_id}-{row_id}",
                    rowId=row_id,
                    dateISO=date_iso,
                    clinicianId=clinician_id,
                )
            )

    if (
        solver_settings.onCallRestEnabled
        and rest_shift_row_ids
        and (rest_before > 0 or rest_after > 0)
    ):
        boundary_conflicts: set[tuple[str, str, str]] = set()
        on_call_assignments: set[tuple[str, str]] = set()
        for (clinician_id, date_iso), row_ids in manual_assignments.items():
            if date_iso not in target_date_set:
                continue
            if any(row_id in rest_shift_row_ids for row_id in row_ids):
                on_call_assignments.add((clinician_id, date_iso))
        for assignment in new_assignments:
            if assignment.dateISO not in target_date_set:
                continue
            if assignment.rowId in rest_shift_row_ids:
                on_call_assignments.add((assignment.clinicianId, assignment.dateISO))

        for clinician_id, date_iso in on_call_assignments:
            base_index = day_index_by_iso.get(date_iso)
            if base_index is None:
                continue
            for offset in range(1, rest_before + 1):
                target_idx = base_index - offset
                if target_idx < 0 or target_idx >= len(day_isos):
                    continue
                target_date = day_isos[target_idx]
                if target_date in target_date_set:
                    continue
                if manual_assignments.get((clinician_id, target_date)):
                    boundary_conflicts.add((clinician_id, date_iso, target_date))
            for offset in range(1, rest_after + 1):
                target_idx = base_index + offset
                if target_idx < 0 or target_idx >= len(day_isos):
                    continue
                target_date = day_isos[target_idx]
                if target_date in target_date_set:
                    continue
                if manual_assignments.get((clinician_id, target_date)):
                    boundary_conflicts.add((clinician_id, date_iso, target_date))

        if boundary_conflicts:
            notes.append(
                "Rest day conflicts outside the selected range; some boundary days are already assigned."
            )

    if solver.Value(total_slack) > 0:
        notes.append("Could not fill all required slots.")
    if payload.only_fill_required and total_required == 0:
        notes.append("No required slots detected for the selected timeframe.")

    return SolveWeekResponse(
        startISO=range_start.isoformat(),
        endISO=range_end.isoformat(),
        assignments=new_assignments,
        notes=notes,
    )
