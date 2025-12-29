from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends
from ortools.sat.python import cp_model

from .auth import _get_current_user
from .models import (
    Assignment,
    Holiday,
    MinSlots,
    SolveDayRequest,
    SolveDayResponse,
    SolveWeekRequest,
    SolveWeekResponse,
    SolverSettings,
    SubShift,
    UserPublic,
    WorkplaceRow,
)
from .state import _load_state

router = APIRouter()


@router.post("/v1/solve", response_model=SolveDayResponse)
def solve_day(payload: SolveDayRequest, current_user: UserPublic = Depends(_get_current_user)):
    state = _load_state(current_user.username)
    dateISO = payload.dateISO

    rows_by_id = {row.id: row for row in state.rows}
    class_rows = [row for row in state.rows if row.kind == "class"]
    ignored_pool_rows = {"pool-not-allocated", "pool-vacation"}
    shift_rows: List[tuple[WorkplaceRow, SubShift, str, int]] = []
    shift_row_ids: set[str] = set()
    parent_by_shift_id: Dict[str, str] = {}
    for index, row in enumerate(class_rows):
        for shift in row.subShifts:
            shift_row_id = f"{row.id}::{shift.id}"
            shift_rows.append((row, shift, shift_row_id, index))
            shift_row_ids.add(shift_row_id)
            parent_by_shift_id[shift_row_id] = row.id

    vacation_ids = set()
    for clinician in state.clinicians:
        for vacation in clinician.vacations:
            if vacation.startISO <= dateISO <= vacation.endISO:
                vacation_ids.add(clinician.id)
                break

    assigned_ids = set()
    class_assignments = []
    for assignment in state.assignments:
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
        for c in state.clinicians
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
        required = state.minSlotsByRowId.get(
            shift_row_id, MinSlots(weekday=0, weekend=0)
        )
        is_weekend = _is_weekend_or_holiday(dateISO, state.holidays)
        base_target = required.weekend if is_weekend else required.weekday
        override = state.slotOverridesByKey.get(f"{shift_row_id}__{dateISO}", 0)
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
        model.Minimize(-total_coverage * 10000 + total_slack * 100 - total_preference)
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


def _build_shift_intervals(
    class_rows: List[WorkplaceRow],
) -> Dict[str, Tuple[int, int, str]]:
    intervals: Dict[str, Tuple[int, int, str]] = {}
    for row in class_rows:
        for shift in row.subShifts:
            start = _parse_time_to_minutes(shift.startTime) or 0
            end = _parse_time_to_minutes(shift.endTime) or start
            offset = shift.endDayOffset if isinstance(shift.endDayOffset, int) else 0
            total_end = end + max(0, min(3, offset)) * 24 * 60
            if total_end <= start:
                total_end = start
            intervals[f"{row.id}::{shift.id}"] = (start, total_end, row.locationId or "")
    return intervals


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

    class_rows = [row for row in state.rows if row.kind == "class"]
    shift_intervals = _build_shift_intervals(class_rows)
    shift_rows: List[tuple[WorkplaceRow, SubShift, str, int]] = []
    parent_by_shift_id: Dict[str, str] = {}
    for index, row in enumerate(class_rows):
        for shift in row.subShifts:
            sid = f"{row.id}::{shift.id}"
            shift_rows.append((row, shift, sid, index))
            parent_by_shift_id[sid] = row.id

    holidays = state.holidays or []
    weekend_holidays = {h.dateISO for h in holidays}
    def is_weekend_or_holiday(diso: str) -> bool:
        y, m, d = diso.split("-")
        dt = datetime(int(y), int(m), int(d))
        return dt.weekday() >= 5 or diso in weekend_holidays

    vac_by_clinician: Dict[str, List[Tuple[str, str]]] = {}
    for clinician in state.clinicians:
        vac_by_clinician[clinician.id] = [(v.startISO, v.endISO) for v in clinician.vacations]

    def is_on_vac(clinician_id: str, date_iso: str) -> bool:
        for start, end in vac_by_clinician.get(clinician_id, []):
            if start <= date_iso <= end:
                return True
        return False

    shift_row_ids = {sid for _row, _shift, sid, _idx in shift_rows}
    manual_assignments: Dict[Tuple[str, str], List[str]] = {}
    for assignment in state.assignments:
        if assignment.rowId not in shift_row_ids:
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

    model = cp_model.CpModel()
    var_map: Dict[Tuple[str, str, str], cp_model.IntVar] = {}

    # Build vars
    for clinician in state.clinicians:
        for date_iso in target_day_isos:
            if is_on_vac(clinician.id, date_iso):
                continue
            for row, shift, shift_row_id, _idx in shift_rows:
                if row.id not in clinician.qualifiedClassIds:
                    continue
                var_map[(clinician.id, date_iso, shift_row_id)] = model.NewBoolVar(
                    f"x_{clinician.id}_{date_iso}_{shift_row_id}"
                )

    # At most once per day if disabled
    if not solver_settings.allowMultipleShiftsPerDay:
        for clinician in state.clinicians:
            for date_iso in target_day_isos:
                vars_for_day = [
                    var
                    for (cid, d, _sid), var in var_map.items()
                    if cid == clinician.id and d == date_iso
                ]
                manual = len(manual_assignments.get((clinician.id, date_iso), []))
                if manual >= 1:
                    if vars_for_day:
                        model.Add(sum(vars_for_day) == 0)
                    continue
                if vars_for_day:
                    model.Add(sum(vars_for_day) <= 1)

    # Overlap + location constraints
    for clinician in state.clinicians:
        vars_for_clinician: List[Tuple[str, str, cp_model.IntVar, int, int, str]] = []
        for (cid, date_iso, sid), var in var_map.items():
            if cid != clinician.id:
                continue
            interval = shift_intervals.get(sid)
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
                interval = shift_intervals.get(row_id)
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
    total_classes = len(class_rows)
    order_weight_by_shift_id: Dict[str, int] = {}
    BIG = 20

    def get_manual_count(date_iso: str, shift_row_id: str) -> int:
        count = 0
        for cid, diso in manual_assignments:
            if diso != date_iso:
                continue
            for rid in manual_assignments[(cid, diso)]:
                if rid == shift_row_id:
                    count += 1
        return count

    for row, shift, shift_row_id, index in shift_rows:
        required = state.minSlotsByRowId.get(
            shift_row_id, MinSlots(weekday=0, weekend=0)
        )
        order_weight = max(1, total_classes - index) * 10 + (4 - shift.order)
        order_weight_by_shift_id[shift_row_id] = order_weight
        for date_iso in target_day_isos:
            is_weekend = is_weekend_or_holiday(date_iso)
            base_target = required.weekend if is_weekend else required.weekday
            override = state.slotOverridesByKey.get(f"{shift_row_id}__{date_iso}", 0)
            target = max(0, base_target + override)
            already = get_manual_count(date_iso, shift_row_id)
            missing = max(0, target - already)
            vars_here = [
                var
                for (cid, d, sid), var in var_map.items()
                if d == date_iso and sid == shift_row_id
            ]
            if missing == 0:
                if payload.only_fill_required and vars_here:
                    model.Add(sum(vars_here) == 0)
                continue
            if vars_here:
                covered = model.NewBoolVar(f"covered_{shift_row_id}_{date_iso}")
                model.Add(sum(vars_here) + already >= covered)
                coverage_terms.append(covered * order_weight)
                if payload.only_fill_required:
                    model.Add(sum(vars_here) <= missing)
            slack = model.NewIntVar(0, missing, f"slack_{shift_row_id}_{date_iso}")
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
        sid for row, _shift, sid, _idx in shift_rows if row.id == rest_class_id
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

    total_slack = sum(slack_terms) if slack_terms else 0
    total_coverage = sum(coverage_terms) if coverage_terms else 0

    total_priority = sum(
        var * order_weight_by_shift_id.get(sid, 0)
        for (cid, _d, sid), var in var_map.items()
    )
    total_preference = sum(
        var * pref_weight.get(cid, {}).get(parent_by_shift_id.get(sid, ""), 0)
        for (cid, _d, sid), var in var_map.items()
    )

    if payload.only_fill_required:
        model.Minimize(-total_coverage * 10000 + total_slack * 100 - total_preference)
    else:
        model.Minimize(
            -total_coverage * 10000
            + total_slack * 100
            - total_priority * 10
            - total_preference
        )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 4.0
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

    return SolveWeekResponse(
        startISO=range_start.isoformat(),
        endISO=range_end.isoformat(),
        assignments=new_assignments,
        notes=notes,
    )
