from typing import Dict, List

from fastapi import APIRouter, Depends
from ortools.sat.python import cp_model

from .auth import _get_current_user
from .models import (
    Assignment,
    Holiday,
    MinSlots,
    SolveDayRequest,
    SolveDayResponse,
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
