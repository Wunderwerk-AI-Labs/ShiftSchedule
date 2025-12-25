import json
import os
import sqlite3
from typing import Dict, List, Literal

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from ortools.sat.python import cp_model


RowKind = Literal["class", "pool"]


class WorkplaceRow(BaseModel):
    id: str
    name: str
    kind: RowKind
    dotColorClass: str


class VacationRange(BaseModel):
    id: str
    startISO: str
    endISO: str


class Clinician(BaseModel):
    id: str
    name: str
    qualifiedClassIds: List[str]
    preferredClassIds: List[str] = []
    vacations: List[VacationRange]


class Assignment(BaseModel):
    id: str
    rowId: str
    dateISO: str
    clinicianId: str


class MinSlots(BaseModel):
    weekday: int
    weekend: int


class AppState(BaseModel):
    rows: List[WorkplaceRow]
    clinicians: List[Clinician]
    assignments: List[Assignment]
    minSlotsByRowId: Dict[str, MinSlots]
    slotOverridesByKey: Dict[str, int] = Field(default_factory=dict)


class SolveDayRequest(BaseModel):
    dateISO: str
    only_fill_required: bool = False


class SolveDayResponse(BaseModel):
    dateISO: str
    assignments: List[Assignment]
    notes: List[str]


def _default_state() -> AppState:
    rows = [
        WorkplaceRow(
            id="pool-not-allocated",
            name="Distribution Pool",
            kind="pool",
            dotColorClass="bg-slate-400",
        ),
        WorkplaceRow(
            id="pool-manual",
            name="Pool",
            kind="pool",
            dotColorClass="bg-slate-300",
        ),
        WorkplaceRow(
            id="pool-vacation",
            name="Vacation",
            kind="pool",
            dotColorClass="bg-emerald-500",
        ),
        WorkplaceRow(id="mri", name="MRI", kind="class", dotColorClass="bg-violet-500"),
        WorkplaceRow(id="ct", name="CT", kind="class", dotColorClass="bg-cyan-500"),
        WorkplaceRow(
            id="sonography",
            name="Sonography",
            kind="class",
            dotColorClass="bg-fuchsia-500",
        ),
        WorkplaceRow(
            id="conventional",
            name="Conventional",
            kind="class",
            dotColorClass="bg-amber-400",
        ),
        WorkplaceRow(
            id="on-call", name="On Call", kind="class", dotColorClass="bg-blue-600"
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
        "mri": MinSlots(weekday=2, weekend=1),
        "ct": MinSlots(weekday=2, weekend=1),
        "sonography": MinSlots(weekday=2, weekend=1),
        "conventional": MinSlots(weekday=2, weekend=1),
        "on-call": MinSlots(weekday=1, weekend=1),
    }
    return AppState(
        rows=rows,
        clinicians=clinicians,
        assignments=[],
        minSlotsByRowId=min_slots,
        slotOverridesByKey={},
    )


DB_PATH = os.environ.get("SCHEDULE_DB_PATH", "schedule.db")


def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, data TEXT NOT NULL)"
    )
    return conn


def _load_state(user_id: str) -> AppState:
    conn = _get_connection()
    cur = conn.execute("SELECT data FROM app_state WHERE id = ?", (user_id,))
    row = cur.fetchone()
    if not row and user_id == "jk":
        legacy = conn.execute(
            "SELECT data FROM app_state WHERE id = ?", ("state",)
        ).fetchone()
        if legacy:
            data = json.loads(legacy[0])
            state = AppState.model_validate(data)
            _save_state(state, user_id)
            conn.close()
            return state
    conn.close()
    if not row:
        state = _default_state()
        _save_state(state, user_id)
        return state
    data = json.loads(row[0])
    return AppState.model_validate(data)


def _save_state(state: AppState, user_id: str) -> None:
    conn = _get_connection()
    payload = state.model_dump()
    conn.execute(
        "INSERT OR REPLACE INTO app_state (id, data) VALUES (?, ?)",
        (user_id, json.dumps(payload)),
    )
    conn.commit()
    conn.close()


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

@app.get("/health")
def health():
    return {"status": "ok"}

def _resolve_user_id(request: Request) -> str:
    raw = (
        request.headers.get("x-user-id")
        or request.query_params.get("user_id")
        or "jk"
    )
    return raw.strip().lower() or "jk"


@app.get("/v1/state", response_model=AppState)
def get_state(request: Request):
    return _load_state(_resolve_user_id(request))


@app.post("/v1/state", response_model=AppState)
def set_state(payload: AppState, request: Request):
    user_id = _resolve_user_id(request)
    _save_state(payload, user_id)
    return payload


@app.post("/v1/solve", response_model=SolveDayResponse)
def solve_day(payload: SolveDayRequest, request: Request):
    STATE = _load_state(_resolve_user_id(request))
    dateISO = payload.dateISO

    rows_by_id = {row.id: row for row in STATE.rows}
    class_rows = [row for row in STATE.rows if row.kind == "class"]
    class_row_ids = {row.id for row in class_rows}
    ignored_pool_rows = {"pool-not-allocated", "pool-vacation"}

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
        if assignment.rowId in class_row_ids:
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
        for row in class_rows:
            if row.id in clinician.qualifiedClassIds:
                var_map[(clinician.id, row.id)] = model.NewBoolVar(
                    f"x_{clinician.id}_{row.id}"
                )

    for clinician in free_clinicians:
        vars_for_clinician = [
            var_map[(clinician.id, row.id)]
            for row in class_rows
            if (clinician.id, row.id) in var_map
        ]
        if vars_for_clinician:
            model.Add(sum(vars_for_clinician) <= 1)

    slack_vars = []
    coverage_terms = []
    slack_terms = []
    class_need: Dict[str, int] = {}
    class_order_weight: Dict[str, int] = {}
    total_classes = len(class_rows)
    for index, row in enumerate(class_rows):
        required = STATE.minSlotsByRowId.get(row.id, MinSlots(weekday=0, weekend=0))
        is_weekend = _is_weekend(dateISO)
        base_target = required.weekend if is_weekend else required.weekday
        override = STATE.slotOverridesByKey.get(f"{row.id}__{dateISO}", 0)
        target = max(0, base_target + override)
        class_need[row.id] = target
        class_order_weight[row.id] = max(1, total_classes - index)
        already = len([a for a in class_assignments if a.rowId == row.id])
        missing = max(0, target - already)
        if missing == 0:
            if payload.only_fill_required:
                assigned_vars = [
                    var_map[(clinician.id, row.id)]
                    for clinician in free_clinicians
                    if (clinician.id, row.id) in var_map
                ]
                if assigned_vars:
                    model.Add(sum(assigned_vars) == 0)
            continue
        assigned_vars = [
            var_map[(clinician.id, row.id)]
            for clinician in free_clinicians
            if (clinician.id, row.id) in var_map
        ]
        if assigned_vars:
            covered = model.NewBoolVar(f"covered_{row.id}")
            model.Add(sum(assigned_vars) >= covered)
            coverage_terms.append(covered * class_order_weight[row.id])
            if payload.only_fill_required:
                model.Add(sum(assigned_vars) <= missing)
        slack = model.NewIntVar(0, missing, f"slack_{row.id}")
        if assigned_vars:
            model.Add(sum(assigned_vars) + slack >= missing)
        else:
            model.Add(slack >= missing)
        slack_vars.append(slack)
        slack_terms.append(slack * class_order_weight[row.id])

    total_slack = sum(slack_terms) if slack_terms else 0
    total_coverage = sum(coverage_terms) if coverage_terms else 0
    total_priority = sum(
        var * class_need.get(rid, 0) for (cid, rid), var in var_map.items()
    )
    total_preference = sum(
        var * pref_weight.get(cid, {}).get(rid, 0) for (cid, rid), var in var_map.items()
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


def _is_weekend(dateISO: str) -> bool:
    y, m, d = dateISO.split("-")
    import datetime

    return datetime.date(int(y), int(m), int(d)).weekday() >= 5
