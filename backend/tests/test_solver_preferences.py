from typing import Dict, List

from backend.models import (
    AppState,
    Clinician,
    Location,
    SolveDayRequest,
    SolveWeekRequest,
    TemplateBlock,
    TemplateColBand,
    TemplateRowBand,
    TemplateSlot,
    WeeklyCalendarTemplate,
    WeeklyTemplateLocation,
    WorkplaceRow,
    UserPublic,
)
from backend.solver import solve_day, solve_week


def _build_state(
    clinicians: List[Clinician],
    slots: List[TemplateSlot],
    col_bands: List[TemplateColBand],
    solver_settings: Dict[str, object],
) -> AppState:
    location = Location(id="loc-default", name="Berlin")
    row = WorkplaceRow(
        id="section-a",
        name="Section A",
        kind="class",
        dotColorClass="bg-slate-400",
        blockColor="#E8E1F5",
        locationId="loc-default",
        subShifts=[],
    )
    template = WeeklyCalendarTemplate(
        version=4,
        blocks=[TemplateBlock(id="block-a", sectionId="section-a", requiredSlots=0)],
        locations=[
            WeeklyTemplateLocation(
                locationId="loc-default",
                rowBands=[TemplateRowBand(id="row-1", label="Row 1", order=1)],
                colBands=col_bands,
                slots=slots,
            )
        ],
    )
    return AppState(
        locations=[location],
        locationsEnabled=True,
        rows=[row],
        clinicians=clinicians,
        assignments=[],
        minSlotsByRowId={},
        slotOverridesByKey={},
        weeklyTemplate=template,
        holidays=[],
        solverSettings=solver_settings,
        solverRules=[],
        publishedWeekStartISOs=[],
    )


def test_day_solver_enforces_mandatory_windows(monkeypatch) -> None:
    clinicians = [
        Clinician(
            id="clin-a",
            name="Clinician A",
            qualifiedClassIds=["section-a"],
            preferredClassIds=[],
            vacations=[],
            preferredWorkingTimes={
                "mon": {
                    "startTime": "09:00",
                    "endTime": "12:00",
                    "requirement": "mandatory",
                }
            },
        )
    ]
    col_bands = [
        TemplateColBand(id="col-mon-1", label="", order=1, dayType="mon"),
        TemplateColBand(id="col-mon-2", label="", order=2, dayType="mon"),
    ]
    slots = [
        TemplateSlot(
            id="slot-a",
            locationId="loc-default",
            rowBandId="row-1",
            colBandId="col-mon-1",
            blockId="block-a",
            requiredSlots=1,
            startTime="09:00",
            endTime="11:00",
            endDayOffset=0,
        ),
        TemplateSlot(
            id="slot-b",
            locationId="loc-default",
            rowBandId="row-1",
            colBandId="col-mon-2",
            blockId="block-a",
            requiredSlots=1,
            startTime="13:00",
            endTime="15:00",
            endDayOffset=0,
        ),
    ]
    state = _build_state(
        clinicians,
        slots,
        col_bands,
        {
            "enforceSameLocationPerDay": False,
            "onCallRestEnabled": False,
            "onCallRestDaysBefore": 1,
            "onCallRestDaysAfter": 1,
            "workingHoursToleranceHours": 5,
        },
    )
    monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)
    response = solve_day(
        SolveDayRequest(dateISO="2026-01-05", only_fill_required=True),
        current_user=UserPublic(username="test", role="admin", active=True),
    )
    assigned_ids = {assignment.rowId for assignment in response.assignments}
    assert "slot-a" in assigned_ids
    assert "slot-b" not in assigned_ids


def test_day_solver_prefers_preferred_window(monkeypatch) -> None:
    clinicians = [
        Clinician(
            id="clin-b",
            name="Clinician B",
            qualifiedClassIds=["section-a"],
            preferredClassIds=["section-a"],
            vacations=[],
        ),
        Clinician(
            id="clin-a",
            name="Clinician A",
            qualifiedClassIds=["section-a"],
            preferredClassIds=[],
            vacations=[],
            preferredWorkingTimes={
                "mon": {
                    "startTime": "08:00",
                    "endTime": "12:00",
                    "requirement": "preference",
                }
            },
        ),
    ]
    col_bands = [TemplateColBand(id="col-mon-1", label="", order=1, dayType="mon")]
    slots = [
        TemplateSlot(
            id="slot-a",
            locationId="loc-default",
            rowBandId="row-1",
            colBandId="col-mon-1",
            blockId="block-a",
            requiredSlots=1,
            startTime="09:00",
            endTime="11:00",
            endDayOffset=0,
        )
    ]
    state = _build_state(
        clinicians,
        slots,
        col_bands,
        {
            "enforceSameLocationPerDay": False,
            "onCallRestEnabled": False,
            "onCallRestDaysBefore": 1,
            "onCallRestDaysAfter": 1,
            "workingHoursToleranceHours": 5,
        },
    )
    monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)
    response = solve_day(
        SolveDayRequest(dateISO="2026-01-05", only_fill_required=True),
        current_user=UserPublic(username="test", role="admin", active=True),
    )
    assert response.assignments
    assert response.assignments[0].clinicianId == "clin-a"


def test_week_solver_hours_tolerance_nudges_distribution(monkeypatch) -> None:
    clinicians = [
        Clinician(
            id="clin-a",
            name="Clinician A",
            qualifiedClassIds=["section-a"],
            preferredClassIds=[],
            vacations=[],
            workingHoursPerWeek=7,
        ),
        Clinician(
            id="clin-b",
            name="Clinician B",
            qualifiedClassIds=["section-a"],
            preferredClassIds=[],
            vacations=[],
            workingHoursPerWeek=7,
        ),
    ]
    col_bands = [
        TemplateColBand(id="col-mon-1", label="", order=1, dayType="mon"),
        TemplateColBand(id="col-mon-2", label="", order=2, dayType="mon"),
    ]
    slots = [
        TemplateSlot(
            id="slot-a",
            locationId="loc-default",
            rowBandId="row-1",
            colBandId="col-mon-1",
            blockId="block-a",
            requiredSlots=1,
            startTime="08:00",
            endTime="09:00",
            endDayOffset=0,
        ),
        TemplateSlot(
            id="slot-b",
            locationId="loc-default",
            rowBandId="row-1",
            colBandId="col-mon-2",
            blockId="block-a",
            requiredSlots=1,
            startTime="09:00",
            endTime="10:00",
            endDayOffset=0,
        ),
    ]
    state = _build_state(
        clinicians,
        slots,
        col_bands,
        {
            "enforceSameLocationPerDay": False,
            "onCallRestEnabled": False,
            "onCallRestDaysBefore": 1,
            "onCallRestDaysAfter": 1,
            "workingHoursToleranceHours": 0,
        },
    )
    monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)
    response = solve_week(
        SolveWeekRequest(
            startISO="2026-01-05",
            endISO="2026-01-05",
            only_fill_required=True,
        ),
        current_user=UserPublic(username="test", role="admin", active=True),
    )
    assignments_by_clinician: Dict[str, int] = {}
    for assignment in response.assignments:
        assignments_by_clinician[assignment.clinicianId] = (
            assignments_by_clinician.get(assignment.clinicianId, 0) + 1
        )
    assert assignments_by_clinician.get("clin-a", 0) == 1
    assert assignments_by_clinician.get("clin-b", 0) == 1
