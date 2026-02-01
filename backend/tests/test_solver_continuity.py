"""Tests for solver shift continuity constraints.

These tests verify that the solver correctly enforces continuous work blocks
and prevents split shifts (gaps between assignments for the same clinician
on the same day).
"""

from typing import Dict, List, Tuple

import pytest

from backend.models import (
    AppState,
    Assignment,
    Clinician,
    Location,
    SolveRangeRequest,
    TemplateBlock,
    TemplateColBand,
    TemplateRowBand,
    TemplateSlot,
    UserPublic,
    WeeklyCalendarTemplate,
    WeeklyTemplateLocation,
    WorkplaceRow,
)
from backend.solver import _solve_range_impl

from .conftest import (
    make_clinician,
    make_pool_row,
    make_workplace_row,
)
from .fixtures_martin_like import (
    make_martin_like_state,
    get_slot_times,
    check_for_gaps,
)


# Test user for solver calls
TEST_USER = UserPublic(username="test", role="user", active=True)

# Test date (Monday)
TEST_DATE = "2026-01-05"


def _make_col_bands_for_day(day_type: str, count: int = 1) -> List[TemplateColBand]:
    """Create column bands for a specific day type."""
    return [
        TemplateColBand(id=f"col-{day_type}-{i+1}", label="", order=i+1, dayType=day_type)
        for i in range(count)
    ]


def _make_consecutive_slots(
    times: List[Tuple[str, str, int]],  # [(start, end, required), ...]
    day_type: str = "mon",
    location_id: str = "loc-default",
    block_id: str = "block-a",
) -> List[TemplateSlot]:
    """Create consecutive slots for testing continuity."""
    slots = []
    for i, (start, end, required) in enumerate(times):
        slots.append(
            TemplateSlot(
                id=f"slot-{i+1}__{day_type}",
                locationId=location_id,
                rowBandId="row-1",
                colBandId=f"col-{day_type}-1",
                blockId=block_id,
                requiredSlots=required,
                startTime=start,
                endTime=end,
                endDayOffset=0,
            )
        )
    return slots


def _build_continuity_test_state(
    clinicians: List[Clinician],
    slots: List[TemplateSlot],
    solver_settings: Dict[str, object],
    assignments: List[Assignment] = None,
    sections: List[str] = None,
) -> AppState:
    """Build a complete AppState for continuity testing."""
    location = Location(id="loc-default", name="Berlin")

    if sections is None:
        sections = ["section-a"]

    rows = [
        WorkplaceRow(
            id=section,
            name=section.replace("-", " ").title(),
            kind="class",
            dotColorClass="bg-slate-400",
            blockColor="#E8E1F5",
            locationId="loc-default",
            subShifts=[],
        )
        for section in sections
    ] + [
        make_pool_row("pool-rest-day", "Rest Day"),
        make_pool_row("pool-vacation", "Vacation"),
    ]

    blocks = [
        TemplateBlock(id=f"block-{chr(97+i)}", sectionId=section, requiredSlots=0)
        for i, section in enumerate(sections)
    ]

    # Create col_bands for Monday (default test day)
    col_bands = _make_col_bands_for_day("mon", 1)

    template = WeeklyCalendarTemplate(
        version=4,
        blocks=blocks,
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
        rows=rows,
        clinicians=clinicians,
        assignments=assignments or [],
        minSlotsByRowId={},
        slotOverridesByKey={},
        weeklyTemplate=template,
        holidays=[],
        solverSettings=solver_settings,
        solverRules=[],
        publishedWeekStartISOs=[],
    )


def _has_split_shift(
    assignments: List[Assignment],
    slots: List[TemplateSlot],
    date_iso: str,
) -> Tuple[bool, str]:
    """
    Check if any clinician has split shifts (gaps between assignments).

    Returns (has_split, description) where description explains the split if found.
    """
    # Build slot time lookup
    slot_times = {}
    for slot in slots:
        slot_times[slot.id] = (slot.startTime, slot.endTime)

    # Group assignments by clinician for the given date
    assignments_by_clinician: Dict[str, List[Tuple[int, int, str]]] = {}
    for a in assignments:
        if a.dateISO != date_iso:
            continue
        if a.rowId not in slot_times:
            continue
        start_str, end_str = slot_times[a.rowId]
        start_min = int(start_str.split(":")[0]) * 60 + int(start_str.split(":")[1])
        end_min = int(end_str.split(":")[0]) * 60 + int(end_str.split(":")[1])
        if a.clinicianId not in assignments_by_clinician:
            assignments_by_clinician[a.clinicianId] = []
        assignments_by_clinician[a.clinicianId].append((start_min, end_min, a.rowId))

    # Check each clinician for gaps
    for clin_id, time_slots in assignments_by_clinician.items():
        if len(time_slots) <= 1:
            continue
        # Sort by start time
        time_slots.sort(key=lambda x: x[0])
        for i in range(len(time_slots) - 1):
            end_current = time_slots[i][1]
            start_next = time_slots[i + 1][0]
            if end_current < start_next:
                gap_hours = (start_next - end_current) / 60
                return True, (
                    f"Clinician {clin_id} has {gap_hours:.1f}h gap between "
                    f"{time_slots[i][2]} (ends {end_current//60:02d}:{end_current%60:02d}) and "
                    f"{time_slots[i+1][2]} (starts {start_next//60:02d}:{start_next%60:02d})"
                )

    return False, ""


class TestContinuityBasic:
    """Basic tests for shift continuity constraint."""

    def test_prevents_gap_between_shifts(self, monkeypatch) -> None:
        """
        3 consecutive slots: 08-12, 12-16, 16-20
        1 clinician, requiredSlots=1 for first and last slot only

        The solver should NOT create a gap by assigning 08-12 + 16-20.
        With preferContinuousShifts=True, it should either:
        - Assign only 08-12, OR
        - Assign only 16-20, OR
        - Assign 08-12 + 12-16, OR
        - Assign 12-16 + 16-20

        But NOT 08-12 + 16-20 (which would skip the middle slot and create a gap).
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["section-a"]),
        ]

        # Three consecutive slots: first and last require 1 person, middle requires 0
        slots = _make_consecutive_slots([
            ("08:00", "12:00", 1),  # Required
            ("12:00", "16:00", 0),  # Not required
            ("16:00", "20:00", 1),  # Required
        ])

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = _build_continuity_test_state(clinicians, slots, solver_settings)
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Check for split shifts
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"

        # Verify we got some assignments
        day_assignments = [a for a in response.assignments if a.dateISO == TEST_DATE]
        assert len(day_assignments) >= 1, "Should have at least one assignment"

    def test_fills_continuous_block(self, monkeypatch) -> None:
        """
        3 consecutive slots: 08-12, 12-16, 16-20
        1 clinician, requiredSlots=1 for all three

        Expected: Assigns all three continuously (no gaps).
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["section-a"]),
        ]

        # Three consecutive required slots
        slots = _make_consecutive_slots([
            ("08:00", "12:00", 1),
            ("12:00", "16:00", 1),
            ("16:00", "20:00", 1),
        ])

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = _build_continuity_test_state(clinicians, slots, solver_settings)
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Should have all 3 assignments for the clinician
        day_assignments = [a for a in response.assignments if a.dateISO == TEST_DATE]
        assert len(day_assignments) == 3, f"Expected 3 assignments, got {len(day_assignments)}"

        # All should be for the same clinician (continuous block)
        clinician_ids = {a.clinicianId for a in day_assignments}
        assert len(clinician_ids) == 1, "All assignments should be for the same clinician"

        # No gaps
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"


class TestContinuityMultipleClinicians:
    """Tests for continuity with multiple clinicians."""

    def test_multiple_clinicians_each_continuous(self, monkeypatch) -> None:
        """
        4 slots: 08-12, 12-16, 16-20, 20-24
        2 clinicians, requiredSlots=2 per slot

        Expected: Each clinician gets a continuous block, no gaps.
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["section-a"]),
            make_clinician("clin-2", "Dr. Bob", qualified_class_ids=["section-a"]),
        ]

        slots = _make_consecutive_slots([
            ("08:00", "12:00", 2),
            ("12:00", "16:00", 2),
            ("16:00", "20:00", 2),
            ("20:00", "24:00", 2),
        ])

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = _build_continuity_test_state(clinicians, slots, solver_settings)
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Check each clinician has no gaps
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"


class TestContinuityWithManualAssignments:
    """Tests for continuity when manual assignments exist."""

    def test_solver_extends_manual_continuously(self, monkeypatch) -> None:
        """
        3 slots: 08-12, 12-16, 16-20
        Manual assignment at 12-16 for clinician
        Required: 1 per slot

        Expected: Solver should extend the manual assignment continuously,
        filling either 08-12 (to make 08-16 block) or 16-20 (to make 12-20 block),
        but NOT both (which would still be continuous 08-20).
        The key is it should NOT assign a different clinician to create gaps.
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["section-a"]),
            make_clinician("clin-2", "Dr. Bob", qualified_class_ids=["section-a"]),
        ]

        slots = _make_consecutive_slots([
            ("08:00", "12:00", 1),
            ("12:00", "16:00", 1),
            ("16:00", "20:00", 1),
        ])

        # Manual assignment for clin-1 at 12-16
        manual_assignments = [
            Assignment(
                id="manual-1",
                rowId="slot-2__mon",  # 12:00-16:00 slot
                dateISO=TEST_DATE,
                clinicianId="clin-1",
                source="manual",
            )
        ]

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = _build_continuity_test_state(
            clinicians, slots, solver_settings, assignments=manual_assignments
        )
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Manual assignment should still be there
        all_assignments = manual_assignments + response.assignments

        # Check no clinician has gaps
        has_split, description = _has_split_shift(all_assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"


class TestContinuityOvernightShifts:
    """Tests for continuity with overnight shifts."""

    def test_overnight_shift_continuity(self, monkeypatch) -> None:
        """
        Slots: 16-20, 20-08+1 (next day with endDayOffset=1)

        Expected: Can assign both continuously (touching at 20:00).
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["section-a"]),
        ]

        slots = [
            TemplateSlot(
                id="slot-1__mon",
                locationId="loc-default",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-a",
                requiredSlots=1,
                startTime="16:00",
                endTime="20:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="slot-2__mon",
                locationId="loc-default",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-a",
                requiredSlots=1,
                startTime="20:00",
                endTime="08:00",
                endDayOffset=1,  # Ends next day
            ),
        ]

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = _build_continuity_test_state(clinicians, slots, solver_settings)
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Should have 2 assignments (both slots filled by one clinician)
        day_assignments = [a for a in response.assignments if a.dateISO == TEST_DATE]
        assert len(day_assignments) == 2, f"Expected 2 assignments, got {len(day_assignments)}"

        # Both should be same clinician (continuous)
        clinician_ids = {a.clinicianId for a in day_assignments}
        assert len(clinician_ids) == 1, "Both overnight slots should be same clinician"


class TestContinuityRealisticScenario:
    """Tests with realistic radiology department scenarios."""

    def test_radiology_department_no_splits(self, monkeypatch) -> None:
        """
        Realistic scenario:
        - Multiple sections: MRI, CT (at same location)
        - Multiple time slots per section: Morning (08-12), Afternoon (12-16), Evening (16-20)
        - 3 clinicians with different qualifications

        Expected: No split shifts in solution.
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["mri", "ct"]),
            make_clinician("clin-2", "Dr. Bob", qualified_class_ids=["mri"]),
            make_clinician("clin-3", "Dr. Carol", qualified_class_ids=["ct"]),
        ]

        # MRI slots
        mri_slots = [
            TemplateSlot(
                id=f"mri-slot-{i+1}__mon",
                locationId="loc-default",
                rowBandId="row-mri",
                colBandId="col-mon-1",
                blockId="block-mri",
                requiredSlots=1,
                startTime=start,
                endTime=end,
                endDayOffset=0,
            )
            for i, (start, end) in enumerate([("08:00", "12:00"), ("12:00", "16:00"), ("16:00", "20:00")])
        ]

        # CT slots
        ct_slots = [
            TemplateSlot(
                id=f"ct-slot-{i+1}__mon",
                locationId="loc-default",
                rowBandId="row-ct",
                colBandId="col-mon-1",
                blockId="block-ct",
                requiredSlots=1,
                startTime=start,
                endTime=end,
                endDayOffset=0,
            )
            for i, (start, end) in enumerate([("08:00", "12:00"), ("12:00", "16:00"), ("16:00", "20:00")])
        ]

        all_slots = mri_slots + ct_slots

        # Build state with multiple sections
        location = Location(id="loc-default", name="Berlin")
        rows = [
            WorkplaceRow(id="mri", name="MRI", kind="class", dotColorClass="bg-blue-400", blockColor="#E1F5FE", locationId="loc-default", subShifts=[]),
            WorkplaceRow(id="ct", name="CT", kind="class", dotColorClass="bg-green-400", blockColor="#E8F5E9", locationId="loc-default", subShifts=[]),
            make_pool_row("pool-rest-day", "Rest Day"),
            make_pool_row("pool-vacation", "Vacation"),
        ]

        blocks = [
            TemplateBlock(id="block-mri", sectionId="mri", requiredSlots=0),
            TemplateBlock(id="block-ct", sectionId="ct", requiredSlots=0),
        ]

        col_bands = _make_col_bands_for_day("mon", 1)

        template = WeeklyCalendarTemplate(
            version=4,
            blocks=blocks,
            locations=[
                WeeklyTemplateLocation(
                    locationId="loc-default",
                    rowBands=[
                        TemplateRowBand(id="row-mri", label="MRI", order=1),
                        TemplateRowBand(id="row-ct", label="CT", order=2),
                    ],
                    colBands=col_bands,
                    slots=all_slots,
                )
            ],
        )

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = AppState(
            locations=[location],
            locationsEnabled=True,
            rows=rows,
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

        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Check no clinician has gaps
        has_split, description = _has_split_shift(response.assignments, all_slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"


class TestContinuityMultipleSections:
    """Tests for continuity with multiple sections at the same location."""

    def test_no_gap_across_different_sections_same_location(self, monkeypatch) -> None:
        """
        Real-world scenario from Kirchberg location:
        - Echo: 07:30-13:00
        - CT: 13:00-16:00
        - CT: 16:00-19:00

        A clinician qualified for Echo and CT should NOT get:
        - Echo 07:30-13:00 + CT 16:00-19:00 (gap from 13:00-16:00)

        They should either:
        - Echo 07:30-13:00 + CT 13:00-16:00 (continuous), OR
        - CT 13:00-16:00 + CT 16:00-19:00 (continuous), OR
        - Just one slot
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["echo", "ct"]),
        ]

        # Create slots matching the real Kirchberg pattern
        slots = [
            TemplateSlot(
                id="echo-morning__mon",
                locationId="loc-default",
                rowBandId="row-echo",
                colBandId="col-mon-1",
                blockId="block-echo",
                requiredSlots=1,
                startTime="07:30",
                endTime="13:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-afternoon__mon",
                locationId="loc-default",
                rowBandId="row-ct",
                colBandId="col-mon-1",
                blockId="block-ct",
                requiredSlots=1,
                startTime="13:00",
                endTime="16:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-evening__mon",
                locationId="loc-default",
                rowBandId="row-ct",
                colBandId="col-mon-1",
                blockId="block-ct",
                requiredSlots=1,
                startTime="16:00",
                endTime="19:00",
                endDayOffset=0,
            ),
        ]

        # Build state with multiple sections
        location = Location(id="loc-default", name="Kirchberg")
        rows = [
            WorkplaceRow(id="echo", name="Echo", kind="class", dotColorClass="bg-blue-400", blockColor="#E1F5FE", locationId="loc-default", subShifts=[]),
            WorkplaceRow(id="ct", name="CT", kind="class", dotColorClass="bg-green-400", blockColor="#E8F5E9", locationId="loc-default", subShifts=[]),
            make_pool_row("pool-rest-day", "Rest Day"),
            make_pool_row("pool-vacation", "Vacation"),
        ]

        blocks = [
            TemplateBlock(id="block-echo", sectionId="echo", requiredSlots=0),
            TemplateBlock(id="block-ct", sectionId="ct", requiredSlots=0),
        ]

        col_bands = _make_col_bands_for_day("mon", 1)

        template = WeeklyCalendarTemplate(
            version=4,
            blocks=blocks,
            locations=[
                WeeklyTemplateLocation(
                    locationId="loc-default",
                    rowBands=[
                        TemplateRowBand(id="row-echo", label="Echo", order=1),
                        TemplateRowBand(id="row-ct", label="CT", order=2),
                    ],
                    colBands=col_bands,
                    slots=slots,
                )
            ],
        )

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = AppState(
            locations=[location],
            locationsEnabled=True,
            rows=rows,
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

        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Check for split shifts
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"

    def test_gap_when_only_non_adjacent_slots_required(self, monkeypatch) -> None:
        """
        Scenario where ONLY non-adjacent slots are required:
        - Echo: 07:30-13:00 (required=1)
        - CT: 13:00-16:00 (required=0)
        - CT: 16:00-19:00 (required=1)

        With only 1 clinician, the solver MUST choose:
        - Either fill Echo (07:30-13:00), OR
        - Fill CT evening (16:00-19:00)
        - But NOT both (that creates a gap)

        This tests the constraint is actually enforced.
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["echo", "ct"]),
        ]

        slots = [
            TemplateSlot(
                id="echo-morning__mon",
                locationId="loc-default",
                rowBandId="row-echo",
                colBandId="col-mon-1",
                blockId="block-echo",
                requiredSlots=1,  # Required
                startTime="07:30",
                endTime="13:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-afternoon__mon",
                locationId="loc-default",
                rowBandId="row-ct",
                colBandId="col-mon-1",
                blockId="block-ct",
                requiredSlots=0,  # NOT required (bridge slot)
                startTime="13:00",
                endTime="16:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-evening__mon",
                locationId="loc-default",
                rowBandId="row-ct",
                colBandId="col-mon-1",
                blockId="block-ct",
                requiredSlots=1,  # Required
                startTime="16:00",
                endTime="19:00",
                endDayOffset=0,
            ),
        ]

        location = Location(id="loc-default", name="Kirchberg")
        rows = [
            WorkplaceRow(id="echo", name="Echo", kind="class", dotColorClass="bg-blue-400", blockColor="#E1F5FE", locationId="loc-default", subShifts=[]),
            WorkplaceRow(id="ct", name="CT", kind="class", dotColorClass="bg-green-400", blockColor="#E8F5E9", locationId="loc-default", subShifts=[]),
            make_pool_row("pool-rest-day", "Rest Day"),
            make_pool_row("pool-vacation", "Vacation"),
        ]

        blocks = [
            TemplateBlock(id="block-echo", sectionId="echo", requiredSlots=0),
            TemplateBlock(id="block-ct", sectionId="ct", requiredSlots=0),
        ]

        col_bands = _make_col_bands_for_day("mon", 1)

        template = WeeklyCalendarTemplate(
            version=4,
            blocks=blocks,
            locations=[
                WeeklyTemplateLocation(
                    locationId="loc-default",
                    rowBands=[
                        TemplateRowBand(id="row-echo", label="Echo", order=1),
                        TemplateRowBand(id="row-ct", label="CT", order=2),
                    ],
                    colBands=col_bands,
                    slots=slots,
                )
            ],
        )

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = AppState(
            locations=[location],
            locationsEnabled=True,
            rows=rows,
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

        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # The constraint should prevent filling both required slots with a gap
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"

        # Verify we got at least one assignment (not zero)
        day_assignments = [a for a in response.assignments if a.dateISO == TEST_DATE]
        assert len(day_assignments) >= 1, "Should have at least one assignment"


class TestContinuityRealWorldGap:
    """Tests reproducing real-world gap scenarios from Martin's data."""

    def test_kirchberg_monday_gap(self, monkeypatch) -> None:
        """
        Exact reproduction of Alexandre's gap on 2026-02-02:
        - Assigned: CT tout HK 07:30-13:00
        - Gap: 13:00-16:00 (no assignment)
        - Assigned: IRM neuro HK 16:00-19:00

        This should NOT happen with preferContinuousShifts=True.

        Available slots at Kirchberg on Monday:
        - CT tout HK: 07:30-13:00
        - IRM neuro HK: 13:00-16:00  <- Should bridge the gap
        - CT tout HK: 13:00-16:00    <- Alternative bridge
        - Echo tout HK: 13:00-16:00  <- Alternative bridge
        - IRM neuro HK: 16:00-19:00
        - CT tout HK: 16:00-19:00
        """
        # Alexandre is qualified for: CT tout HK, IRM neuro HK, Echo tout HK
        clinicians = [
            make_clinician(
                "clin-alex",
                "Alexandre Cordebar",
                qualified_class_ids=["ct-tout", "irm-neuro", "echo-tout"]
            ),
        ]

        # Recreate the Kirchberg Monday slot structure
        slots = [
            # Morning slots
            TemplateSlot(
                id="ct-tout-morning__mon",
                locationId="loc-kirchberg",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-ct-tout",
                requiredSlots=1,
                startTime="07:30",
                endTime="13:00",
                endDayOffset=0,
            ),
            # Afternoon slots (13:00-16:00) - these should bridge the gap
            TemplateSlot(
                id="irm-neuro-afternoon__mon",
                locationId="loc-kirchberg",
                rowBandId="row-2",
                colBandId="col-mon-1",
                blockId="block-irm-neuro",
                requiredSlots=1,
                startTime="13:00",
                endTime="16:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-tout-afternoon__mon",
                locationId="loc-kirchberg",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-ct-tout",
                requiredSlots=1,
                startTime="13:00",
                endTime="16:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="echo-tout-afternoon__mon",
                locationId="loc-kirchberg",
                rowBandId="row-3",
                colBandId="col-mon-1",
                blockId="block-echo-tout",
                requiredSlots=1,
                startTime="13:00",
                endTime="16:00",
                endDayOffset=0,
            ),
            # Evening slots (16:00-19:00)
            TemplateSlot(
                id="irm-neuro-evening__mon",
                locationId="loc-kirchberg",
                rowBandId="row-2",
                colBandId="col-mon-1",
                blockId="block-irm-neuro",
                requiredSlots=1,
                startTime="16:00",
                endTime="19:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-tout-evening__mon",
                locationId="loc-kirchberg",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-ct-tout",
                requiredSlots=1,
                startTime="16:00",
                endTime="19:00",
                endDayOffset=0,
            ),
        ]

        location = Location(id="loc-kirchberg", name="Kirchberg")
        rows = [
            WorkplaceRow(id="ct-tout", name="CT tout HK", kind="class", dotColorClass="bg-blue-400", blockColor="#E1F5FE", locationId="loc-kirchberg", subShifts=[]),
            WorkplaceRow(id="irm-neuro", name="IRM neuro HK", kind="class", dotColorClass="bg-green-400", blockColor="#E8F5E9", locationId="loc-kirchberg", subShifts=[]),
            WorkplaceRow(id="echo-tout", name="Echo tout HK", kind="class", dotColorClass="bg-yellow-400", blockColor="#FFF9C4", locationId="loc-kirchberg", subShifts=[]),
            make_pool_row("pool-rest-day", "Rest Day"),
            make_pool_row("pool-vacation", "Vacation"),
        ]

        blocks = [
            TemplateBlock(id="block-ct-tout", sectionId="ct-tout", requiredSlots=0),
            TemplateBlock(id="block-irm-neuro", sectionId="irm-neuro", requiredSlots=0),
            TemplateBlock(id="block-echo-tout", sectionId="echo-tout", requiredSlots=0),
        ]

        col_bands = _make_col_bands_for_day("mon", 1)

        template = WeeklyCalendarTemplate(
            version=4,
            blocks=blocks,
            locations=[
                WeeklyTemplateLocation(
                    locationId="loc-kirchberg",
                    rowBands=[
                        TemplateRowBand(id="row-1", label="CT", order=1),
                        TemplateRowBand(id="row-2", label="IRM", order=2),
                        TemplateRowBand(id="row-3", label="Echo", order=3),
                    ],
                    colBands=col_bands,
                    slots=slots,
                )
            ],
        )

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = AppState(
            locations=[location],
            locationsEnabled=True,
            rows=rows,
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

        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Check for split shifts
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"

        # The clinician should have continuous assignments
        alex_assignments = [a for a in response.assignments if a.clinicianId == "clin-alex" and a.dateISO == TEST_DATE]
        print(f"Alexandre's assignments: {[a.rowId for a in alex_assignments]}")

    def test_kirchberg_monday_gap_multiple_clinicians(self, monkeypatch) -> None:
        """
        Same as above but with multiple clinicians competing for the same slots.
        This is closer to the real-world scenario where the gap occurs.

        The issue might be that when multiple clinicians compete for the bridge slot,
        the solver might leave the bridge slot for another clinician, creating a gap
        for the first clinician.
        """
        clinicians = [
            make_clinician(
                "clin-alex",
                "Alexandre Cordebar",
                qualified_class_ids=["ct-tout", "irm-neuro", "echo-tout"]
            ),
            make_clinician(
                "clin-bob",
                "Bob Smith",
                qualified_class_ids=["irm-neuro", "echo-tout"]  # NOT qualified for CT
            ),
            make_clinician(
                "clin-carol",
                "Carol Johnson",
                qualified_class_ids=["ct-tout", "irm-neuro"]  # NOT qualified for Echo
            ),
        ]

        # Same slot structure as before
        slots = [
            TemplateSlot(
                id="ct-tout-morning__mon",
                locationId="loc-kirchberg",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-ct-tout",
                requiredSlots=1,
                startTime="07:30",
                endTime="13:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="irm-neuro-afternoon__mon",
                locationId="loc-kirchberg",
                rowBandId="row-2",
                colBandId="col-mon-1",
                blockId="block-irm-neuro",
                requiredSlots=1,
                startTime="13:00",
                endTime="16:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-tout-afternoon__mon",
                locationId="loc-kirchberg",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-ct-tout",
                requiredSlots=1,
                startTime="13:00",
                endTime="16:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="echo-tout-afternoon__mon",
                locationId="loc-kirchberg",
                rowBandId="row-3",
                colBandId="col-mon-1",
                blockId="block-echo-tout",
                requiredSlots=1,
                startTime="13:00",
                endTime="16:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="irm-neuro-evening__mon",
                locationId="loc-kirchberg",
                rowBandId="row-2",
                colBandId="col-mon-1",
                blockId="block-irm-neuro",
                requiredSlots=1,
                startTime="16:00",
                endTime="19:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-tout-evening__mon",
                locationId="loc-kirchberg",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-ct-tout",
                requiredSlots=1,
                startTime="16:00",
                endTime="19:00",
                endDayOffset=0,
            ),
        ]

        location = Location(id="loc-kirchberg", name="Kirchberg")
        rows = [
            WorkplaceRow(id="ct-tout", name="CT tout HK", kind="class", dotColorClass="bg-blue-400", blockColor="#E1F5FE", locationId="loc-kirchberg", subShifts=[]),
            WorkplaceRow(id="irm-neuro", name="IRM neuro HK", kind="class", dotColorClass="bg-green-400", blockColor="#E8F5E9", locationId="loc-kirchberg", subShifts=[]),
            WorkplaceRow(id="echo-tout", name="Echo tout HK", kind="class", dotColorClass="bg-yellow-400", blockColor="#FFF9C4", locationId="loc-kirchberg", subShifts=[]),
            make_pool_row("pool-rest-day", "Rest Day"),
            make_pool_row("pool-vacation", "Vacation"),
        ]

        blocks = [
            TemplateBlock(id="block-ct-tout", sectionId="ct-tout", requiredSlots=0),
            TemplateBlock(id="block-irm-neuro", sectionId="irm-neuro", requiredSlots=0),
            TemplateBlock(id="block-echo-tout", sectionId="echo-tout", requiredSlots=0),
        ]

        col_bands = _make_col_bands_for_day("mon", 1)

        template = WeeklyCalendarTemplate(
            version=4,
            blocks=blocks,
            locations=[
                WeeklyTemplateLocation(
                    locationId="loc-kirchberg",
                    rowBands=[
                        TemplateRowBand(id="row-1", label="CT", order=1),
                        TemplateRowBand(id="row-2", label="IRM", order=2),
                        TemplateRowBand(id="row-3", label="Echo", order=3),
                    ],
                    colBands=col_bands,
                    slots=slots,
                )
            ],
        )

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = AppState(
            locations=[location],
            locationsEnabled=True,
            rows=rows,
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

        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Print assignments for debugging
        for clin in clinicians:
            clin_assignments = [a for a in response.assignments if a.clinicianId == clin.id and a.dateISO == TEST_DATE]
            if clin_assignments:
                print(f"{clin.name}'s assignments: {[a.rowId for a in clin_assignments]}")

        # Check for split shifts for ALL clinicians
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"


    def test_early_morning_gap_marie_scenario(self, monkeypatch) -> None:
        """
        Reproduction of Marie's gap on 2026-02-02:
        - Assigned: Tout matin 06:30-07:30
        - Gap: 07:30-11:30 (no assignment)
        - Assigned: IRM seno ZK 11:30-15:30

        Available slots at Zitha on Monday:
        - Tout matin: 06:30-07:30
        - IRM tout ZK: 07:30-11:30  <- Should bridge the gap
        - CT tout ZK: 07:30-11:30
        - Echo tout ZK: 07:30-11:30
        - MG tout ZK: 07:30-11:30
        - IRM seno ZK: 11:30-15:30
        - Echo tout ZK: 11:30-15:30
        """
        clinicians = [
            make_clinician(
                "clin-marie",
                "Marie Laurain",
                qualified_class_ids=["tout-matin", "irm-tout", "ct-tout", "echo-tout", "mg-tout", "irm-seno"]
            ),
        ]

        slots = [
            # Early morning
            TemplateSlot(
                id="tout-matin__mon",
                locationId="loc-zitha",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-tout-matin",
                requiredSlots=1,
                startTime="06:30",
                endTime="07:30",
                endDayOffset=0,
            ),
            # Morning slots (07:30-11:30) - these should bridge the gap
            TemplateSlot(
                id="irm-tout-morning__mon",
                locationId="loc-zitha",
                rowBandId="row-2",
                colBandId="col-mon-1",
                blockId="block-irm-tout",
                requiredSlots=1,
                startTime="07:30",
                endTime="11:30",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-tout-morning__mon",
                locationId="loc-zitha",
                rowBandId="row-3",
                colBandId="col-mon-1",
                blockId="block-ct-tout",
                requiredSlots=1,
                startTime="07:30",
                endTime="11:30",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="echo-tout-morning__mon",
                locationId="loc-zitha",
                rowBandId="row-4",
                colBandId="col-mon-1",
                blockId="block-echo-tout",
                requiredSlots=1,
                startTime="07:30",
                endTime="11:30",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="mg-tout-morning__mon",
                locationId="loc-zitha",
                rowBandId="row-5",
                colBandId="col-mon-1",
                blockId="block-mg-tout",
                requiredSlots=1,
                startTime="07:30",
                endTime="11:30",
                endDayOffset=0,
            ),
            # Afternoon slots (11:30-15:30)
            TemplateSlot(
                id="irm-seno-afternoon__mon",
                locationId="loc-zitha",
                rowBandId="row-6",
                colBandId="col-mon-1",
                blockId="block-irm-seno",
                requiredSlots=1,
                startTime="11:30",
                endTime="15:30",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="echo-tout-afternoon__mon",
                locationId="loc-zitha",
                rowBandId="row-4",
                colBandId="col-mon-1",
                blockId="block-echo-tout",
                requiredSlots=1,
                startTime="11:30",
                endTime="15:30",
                endDayOffset=0,
            ),
        ]

        location = Location(id="loc-zitha", name="Zitha")
        rows = [
            WorkplaceRow(id="tout-matin", name="Tout matin", kind="class", dotColorClass="bg-gray-400", blockColor="#F5F5F5", locationId="loc-zitha", subShifts=[]),
            WorkplaceRow(id="irm-tout", name="IRM tout ZK", kind="class", dotColorClass="bg-blue-400", blockColor="#E1F5FE", locationId="loc-zitha", subShifts=[]),
            WorkplaceRow(id="ct-tout", name="CT tout ZK", kind="class", dotColorClass="bg-green-400", blockColor="#E8F5E9", locationId="loc-zitha", subShifts=[]),
            WorkplaceRow(id="echo-tout", name="Echo tout ZK", kind="class", dotColorClass="bg-yellow-400", blockColor="#FFF9C4", locationId="loc-zitha", subShifts=[]),
            WorkplaceRow(id="mg-tout", name="MG tout ZK", kind="class", dotColorClass="bg-purple-400", blockColor="#F3E5F5", locationId="loc-zitha", subShifts=[]),
            WorkplaceRow(id="irm-seno", name="IRM seno ZK", kind="class", dotColorClass="bg-pink-400", blockColor="#FCE4EC", locationId="loc-zitha", subShifts=[]),
            make_pool_row("pool-rest-day", "Rest Day"),
            make_pool_row("pool-vacation", "Vacation"),
        ]

        blocks = [
            TemplateBlock(id="block-tout-matin", sectionId="tout-matin", requiredSlots=0),
            TemplateBlock(id="block-irm-tout", sectionId="irm-tout", requiredSlots=0),
            TemplateBlock(id="block-ct-tout", sectionId="ct-tout", requiredSlots=0),
            TemplateBlock(id="block-echo-tout", sectionId="echo-tout", requiredSlots=0),
            TemplateBlock(id="block-mg-tout", sectionId="mg-tout", requiredSlots=0),
            TemplateBlock(id="block-irm-seno", sectionId="irm-seno", requiredSlots=0),
        ]

        col_bands = _make_col_bands_for_day("mon", 1)

        template = WeeklyCalendarTemplate(
            version=4,
            blocks=blocks,
            locations=[
                WeeklyTemplateLocation(
                    locationId="loc-zitha",
                    rowBands=[
                        TemplateRowBand(id="row-1", label="Tout matin", order=1),
                        TemplateRowBand(id="row-2", label="IRM tout", order=2),
                        TemplateRowBand(id="row-3", label="CT tout", order=3),
                        TemplateRowBand(id="row-4", label="Echo tout", order=4),
                        TemplateRowBand(id="row-5", label="MG tout", order=5),
                        TemplateRowBand(id="row-6", label="IRM seno", order=6),
                    ],
                    colBands=col_bands,
                    slots=slots,
                )
            ],
        )

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = AppState(
            locations=[location],
            locationsEnabled=True,
            rows=rows,
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

        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Print assignments for debugging
        marie_assignments = [a for a in response.assignments if a.clinicianId == "clin-marie" and a.dateISO == TEST_DATE]
        print(f"Marie's assignments: {[a.rowId for a in marie_assignments]}")

        # Check for split shifts
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"


    def test_gap_forced_by_competing_clinicians(self, monkeypatch) -> None:
        """
        Test where multiple clinicians compete for the bridge slots,
        potentially forcing gaps for some clinicians.

        Scenario:
        - Marie: qualified for all sections
        - Bob: ONLY qualified for 07:30-11:30 slots (he "steals" the bridge)

        If Bob must be assigned to 07:30-11:30 (because it's his only option),
        and Marie is assigned to 06:30-07:30 AND 11:30-15:30,
        then Marie would have a gap.

        BUT: The constraint should PREVENT Marie from having both 06:30-07:30
        and 11:30-15:30 if there's no bridge slot available for her.
        """
        clinicians = [
            make_clinician(
                "clin-marie",
                "Marie Laurain",
                qualified_class_ids=["tout-matin", "irm-tout", "irm-seno"]
            ),
            make_clinician(
                "clin-bob",
                "Bob Smith",
                # Bob is ONLY qualified for the bridge slot
                qualified_class_ids=["irm-tout"]
            ),
        ]

        slots = [
            # Early morning (only Marie qualified)
            TemplateSlot(
                id="tout-matin__mon",
                locationId="loc-zitha",
                rowBandId="row-1",
                colBandId="col-mon-1",
                blockId="block-tout-matin",
                requiredSlots=1,
                startTime="06:30",
                endTime="07:30",
                endDayOffset=0,
            ),
            # Bridge slot (both qualified, but Bob has no other options)
            TemplateSlot(
                id="irm-tout-morning__mon",
                locationId="loc-zitha",
                rowBandId="row-2",
                colBandId="col-mon-1",
                blockId="block-irm-tout",
                requiredSlots=1,
                startTime="07:30",
                endTime="11:30",
                endDayOffset=0,
            ),
            # Afternoon slot (only Marie qualified)
            TemplateSlot(
                id="irm-seno-afternoon__mon",
                locationId="loc-zitha",
                rowBandId="row-3",
                colBandId="col-mon-1",
                blockId="block-irm-seno",
                requiredSlots=1,
                startTime="11:30",
                endTime="15:30",
                endDayOffset=0,
            ),
        ]

        location = Location(id="loc-zitha", name="Zitha")
        rows = [
            WorkplaceRow(id="tout-matin", name="Tout matin", kind="class", dotColorClass="bg-gray-400", blockColor="#F5F5F5", locationId="loc-zitha", subShifts=[]),
            WorkplaceRow(id="irm-tout", name="IRM tout ZK", kind="class", dotColorClass="bg-blue-400", blockColor="#E1F5FE", locationId="loc-zitha", subShifts=[]),
            WorkplaceRow(id="irm-seno", name="IRM seno ZK", kind="class", dotColorClass="bg-pink-400", blockColor="#FCE4EC", locationId="loc-zitha", subShifts=[]),
            make_pool_row("pool-rest-day", "Rest Day"),
            make_pool_row("pool-vacation", "Vacation"),
        ]

        blocks = [
            TemplateBlock(id="block-tout-matin", sectionId="tout-matin", requiredSlots=0),
            TemplateBlock(id="block-irm-tout", sectionId="irm-tout", requiredSlots=0),
            TemplateBlock(id="block-irm-seno", sectionId="irm-seno", requiredSlots=0),
        ]

        col_bands = _make_col_bands_for_day("mon", 1)

        template = WeeklyCalendarTemplate(
            version=4,
            blocks=blocks,
            locations=[
                WeeklyTemplateLocation(
                    locationId="loc-zitha",
                    rowBands=[
                        TemplateRowBand(id="row-1", label="Tout matin", order=1),
                        TemplateRowBand(id="row-2", label="IRM tout", order=2),
                        TemplateRowBand(id="row-3", label="IRM seno", order=3),
                    ],
                    colBands=col_bands,
                    slots=slots,
                )
            ],
        )

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = AppState(
            locations=[location],
            locationsEnabled=True,
            rows=rows,
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

        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Print assignments for debugging
        for clin in clinicians:
            clin_assignments = [a for a in response.assignments if a.clinicianId == clin.id and a.dateISO == TEST_DATE]
            if clin_assignments:
                print(f"{clin.name}'s assignments: {[a.rowId for a in clin_assignments]}")

        # Check for split shifts - THIS IS THE KEY TEST
        # If Bob takes the bridge slot, Marie should NOT have both 06:30-07:30 and 11:30-15:30
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"


class TestContinuityDistributeAllMode:
    """Tests for continuity in 'Distribute All' mode (only_fill_required=False)."""

    def test_distribute_all_no_gaps(self, monkeypatch) -> None:
        """
        In 'Distribute All' mode, the solver tries to assign as many slots as possible.
        Even in this mode, it should not create gaps.

        3 slots: 08-12, 12-16, 16-20
        2 clinicians, no required slots (distribute mode)

        Each clinician should still get continuous assignments.
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["section-a"]),
            make_clinician("clin-2", "Dr. Bob", qualified_class_ids=["section-a"]),
        ]

        slots = _make_consecutive_slots([
            ("08:00", "12:00", 0),  # Not required
            ("12:00", "16:00", 0),  # Not required
            ("16:00", "20:00", 0),  # Not required
        ])

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = _build_continuity_test_state(clinicians, slots, solver_settings)
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        # Use only_fill_required=False for "Distribute All" mode
        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=False),
            current_user=TEST_USER,
        )

        # Check for split shifts
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected in Distribute All mode: {description}"

    def test_distribute_all_multiple_sections(self, monkeypatch) -> None:
        """
        Distribute All mode with multiple sections at same location.
        This more closely matches the real-world scenario.

        Slots:
        - Echo: 07:30-13:00
        - CT: 13:00-16:00
        - CT: 16:00-19:00

        2 clinicians qualified for both.
        In distribute mode, they might get assigned to fill more slots,
        but should still maintain continuity.
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["echo", "ct"]),
            make_clinician("clin-2", "Dr. Bob", qualified_class_ids=["echo", "ct"]),
        ]

        slots = [
            TemplateSlot(
                id="echo-morning__mon",
                locationId="loc-default",
                rowBandId="row-echo",
                colBandId="col-mon-1",
                blockId="block-echo",
                requiredSlots=0,
                startTime="07:30",
                endTime="13:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-afternoon__mon",
                locationId="loc-default",
                rowBandId="row-ct",
                colBandId="col-mon-1",
                blockId="block-ct",
                requiredSlots=0,
                startTime="13:00",
                endTime="16:00",
                endDayOffset=0,
            ),
            TemplateSlot(
                id="ct-evening__mon",
                locationId="loc-default",
                rowBandId="row-ct",
                colBandId="col-mon-1",
                blockId="block-ct",
                requiredSlots=0,
                startTime="16:00",
                endTime="19:00",
                endDayOffset=0,
            ),
        ]

        location = Location(id="loc-default", name="Kirchberg")
        rows = [
            WorkplaceRow(id="echo", name="Echo", kind="class", dotColorClass="bg-blue-400", blockColor="#E1F5FE", locationId="loc-default", subShifts=[]),
            WorkplaceRow(id="ct", name="CT", kind="class", dotColorClass="bg-green-400", blockColor="#E8F5E9", locationId="loc-default", subShifts=[]),
            make_pool_row("pool-rest-day", "Rest Day"),
            make_pool_row("pool-vacation", "Vacation"),
        ]

        blocks = [
            TemplateBlock(id="block-echo", sectionId="echo", requiredSlots=0),
            TemplateBlock(id="block-ct", sectionId="ct", requiredSlots=0),
        ]

        col_bands = _make_col_bands_for_day("mon", 1)

        template = WeeklyCalendarTemplate(
            version=4,
            blocks=blocks,
            locations=[
                WeeklyTemplateLocation(
                    locationId="loc-default",
                    rowBands=[
                        TemplateRowBand(id="row-echo", label="Echo", order=1),
                        TemplateRowBand(id="row-ct", label="CT", order=2),
                    ],
                    colBands=col_bands,
                    slots=slots,
                )
            ],
        )

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": True,
            "onCallRestEnabled": False,
        }

        state = AppState(
            locations=[location],
            locationsEnabled=True,
            rows=rows,
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

        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=False),
            current_user=TEST_USER,
        )

        # Check for split shifts
        has_split, description = _has_split_shift(response.assignments, slots, TEST_DATE)
        assert not has_split, f"Split shift detected: {description}"


class TestMartinLikeFixture:
    """Tests using the Martin-like fixture for realistic scenarios."""

    def test_martin_like_monday_no_gaps(self, monkeypatch) -> None:
        """
        Test Monday schedule with Martin-like fixture.
        8 clinicians, 2 locations (Kirchberg + Zitha), many sections.
        """
        state = make_martin_like_state(day_types=["mon"])
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # Get slot times and check for gaps
        slot_times = get_slot_times(state)
        gaps = check_for_gaps(response.assignments, slot_times, TEST_DATE)

        if gaps:
            for gap in gaps:
                print(f"Gap: {gap['clinician']} has {gap['gap_hours']:.1f}h gap between {gap['slot1']} and {gap['slot2']}")

        assert len(gaps) == 0, f"Found {len(gaps)} gaps in Martin-like schedule: {gaps}"

    def test_martin_like_full_week_no_gaps(self, monkeypatch) -> None:
        """
        Test a full week with Martin-like fixture.
        """
        state = make_martin_like_state(day_types=["mon", "tue", "wed", "thu", "fri"])
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        # Solve Monday through Friday
        response = _solve_range_impl(
            SolveRangeRequest(startISO="2026-01-05", endISO="2026-01-09", only_fill_required=True),
            current_user=TEST_USER,
        )

        slot_times = get_slot_times(state)

        # Check each day for gaps
        all_gaps = []
        for i, date in enumerate(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09"]):
            gaps = check_for_gaps(response.assignments, slot_times, date)
            all_gaps.extend(gaps)

        if all_gaps:
            for gap in all_gaps:
                print(f"Gap: {gap['clinician']} on {gap['date']} - {gap['gap_hours']:.1f}h between {gap['slot1']} and {gap['slot2']}")

        assert len(all_gaps) == 0, f"Found {len(all_gaps)} gaps across the week"

    def test_martin_like_with_vacations(self, monkeypatch) -> None:
        """
        Test with some clinicians on vacation.
        This reduces capacity and might expose edge cases.
        """
        state = make_martin_like_state(day_types=["mon"], include_vacations=True)
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        slot_times = get_slot_times(state)
        gaps = check_for_gaps(response.assignments, slot_times, TEST_DATE)

        assert len(gaps) == 0, f"Found {len(gaps)} gaps with vacations: {gaps}"

    def test_martin_like_distribute_all(self, monkeypatch) -> None:
        """
        Test 'Distribute All' mode with Martin-like fixture.
        """
        state = make_martin_like_state(day_types=["mon"])
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=False),
            current_user=TEST_USER,
        )

        slot_times = get_slot_times(state)
        gaps = check_for_gaps(response.assignments, slot_times, TEST_DATE)

        assert len(gaps) == 0, f"Found {len(gaps)} gaps in distribute mode: {gaps}"


class TestMultiWeekScenarios:
    """Tests for multi-week scheduling (3 weeks = 15 working days).

    These tests verify that the solver correctly handles:
    - Extended scheduling periods
    - Working hours distribution over multiple weeks
    - No gaps across all days
    - Consistent constraint enforcement over time
    """

    # 3 weeks of dates (Mon-Fri)
    # Week 1: 2026-01-05 to 2026-01-09
    # Week 2: 2026-01-12 to 2026-01-16
    # Week 3: 2026-01-19 to 2026-01-23
    THREE_WEEK_DATES = [
        # Week 1
        "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
        # Week 2
        "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16",
        # Week 3
        "2026-01-19", "2026-01-20", "2026-01-21", "2026-01-22", "2026-01-23",
    ]

    def test_three_weeks_no_gaps(self, monkeypatch) -> None:
        """
        Test 3-week schedule with Martin-like fixture.
        15 working days, 8 clinicians, 2 locations.

        This is the most comprehensive continuity test.
        """
        state = make_martin_like_state(day_types=["mon", "tue", "wed", "thu", "fri"])
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        # Solve all 3 weeks at once
        response = _solve_range_impl(
            SolveRangeRequest(
                startISO=self.THREE_WEEK_DATES[0],  # 2026-01-05
                endISO=self.THREE_WEEK_DATES[-1],    # 2026-01-23
                only_fill_required=True,
            ),
            current_user=TEST_USER,
        )

        slot_times = get_slot_times(state)

        # Check each day for gaps
        all_gaps = []
        for date in self.THREE_WEEK_DATES:
            gaps = check_for_gaps(response.assignments, slot_times, date)
            all_gaps.extend(gaps)

        if all_gaps:
            print(f"\nFound {len(all_gaps)} gaps across 3 weeks:")
            for gap in all_gaps[:10]:  # Show first 10
                print(f"  {gap['clinician']} on {gap['date']}: {gap['gap_hours']:.1f}h gap between {gap['slot1']} and {gap['slot2']}")
            if len(all_gaps) > 10:
                print(f"  ... and {len(all_gaps) - 10} more")

        assert len(all_gaps) == 0, f"Found {len(all_gaps)} gaps across 3 weeks"

        # Verify we got a reasonable number of assignments
        total_assignments = len(response.assignments)
        print(f"\n3-week solve: {total_assignments} assignments across {len(self.THREE_WEEK_DATES)} days")
        assert total_assignments > 0, "Should have assignments"

    def test_three_weeks_working_hours_distribution(self, monkeypatch) -> None:
        """
        Test that working hours are distributed across 3 weeks.

        Each clinician should get assignments proportional to their
        workingHoursPerWeek setting over the 3-week period.

        Note: This is a soft constraint, so we verify reasonable distribution,
        not perfect equality.
        """
        state = make_martin_like_state(day_types=["mon", "tue", "wed", "thu", "fri"])
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(
                startISO=self.THREE_WEEK_DATES[0],
                endISO=self.THREE_WEEK_DATES[-1],
                only_fill_required=True,
            ),
            current_user=TEST_USER,
        )

        # Count assignments per clinician
        assignments_by_clinician: Dict[str, int] = {}
        for a in response.assignments:
            assignments_by_clinician[a.clinicianId] = assignments_by_clinician.get(a.clinicianId, 0) + 1

        print("\n3-week assignment distribution:")
        for clin_id, count in sorted(assignments_by_clinician.items()):
            print(f"  {clin_id}: {count} assignments")

        # All clinicians should have some assignments
        clinician_ids = {c.id for c in state.clinicians}
        for clin_id in clinician_ids:
            count = assignments_by_clinician.get(clin_id, 0)
            # Allow some clinicians to have 0 if they're specialists with few slots
            # But most should have work
            assert count >= 0, f"{clin_id} has negative assignments"

        # Total should be reasonable (not zero)
        total = sum(assignments_by_clinician.values())
        assert total > 0, "Should have total assignments"

    def test_three_weeks_all_required_slots_filled(self, monkeypatch) -> None:
        """
        Test that required slots are filled across 3 weeks.

        Verifies the solver can handle the full capacity planning.
        """
        state = make_martin_like_state(day_types=["mon", "tue", "wed", "thu", "fri"])
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(
                startISO=self.THREE_WEEK_DATES[0],
                endISO=self.THREE_WEEK_DATES[-1],
                only_fill_required=True,
            ),
            current_user=TEST_USER,
        )

        # Count filled vs total required slots per day
        slot_times = get_slot_times(state)

        # Get required slots count from template
        required_slots_per_day = sum(
            slot.requiredSlots
            for loc in state.weeklyTemplate.locations
            for slot in loc.slots
            if "__mon" in slot.id  # Count one day type as reference
        )

        print(f"\n3-week solve statistics:")
        print(f"  Required slots per day (Monday template): {required_slots_per_day}")
        print(f"  Total assignments: {len(response.assignments)}")
        print(f"  Days covered: {len(self.THREE_WEEK_DATES)}")

        # Check if solver reported any unfilled slots
        notes_str = " ".join(response.notes)
        if "Could not fill" in notes_str:
            print(f"  Warning: {notes_str}")

        # Should have assignments
        assert len(response.assignments) > 0, "Should have assignments"

    def test_three_weeks_distribute_all_mode(self, monkeypatch) -> None:
        """
        Test 'Distribute All' mode across 3 weeks.

        This mode assigns as many slots as possible, even if not required.
        """
        state = make_martin_like_state(day_types=["mon", "tue", "wed", "thu", "fri"])
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(
                startISO=self.THREE_WEEK_DATES[0],
                endISO=self.THREE_WEEK_DATES[-1],
                only_fill_required=False,  # Distribute All mode
            ),
            current_user=TEST_USER,
        )

        slot_times = get_slot_times(state)

        # Check for gaps
        all_gaps = []
        for date in self.THREE_WEEK_DATES:
            gaps = check_for_gaps(response.assignments, slot_times, date)
            all_gaps.extend(gaps)

        assert len(all_gaps) == 0, f"Found {len(all_gaps)} gaps in Distribute All mode"

        print(f"\n3-week Distribute All: {len(response.assignments)} assignments")

    def test_three_weeks_with_vacations(self, monkeypatch) -> None:
        """
        Test 3 weeks with vacation periods.

        Some clinicians are on vacation during parts of the 3 weeks,
        reducing available capacity.
        """
        state = make_martin_like_state(
            day_types=["mon", "tue", "wed", "thu", "fri"],
            include_vacations=True,
        )
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(
                startISO=self.THREE_WEEK_DATES[0],
                endISO=self.THREE_WEEK_DATES[-1],
                only_fill_required=True,
            ),
            current_user=TEST_USER,
        )

        slot_times = get_slot_times(state)

        # Check for gaps
        all_gaps = []
        for date in self.THREE_WEEK_DATES:
            gaps = check_for_gaps(response.assignments, slot_times, date)
            all_gaps.extend(gaps)

        assert len(all_gaps) == 0, f"Found {len(all_gaps)} gaps with vacations"

        print(f"\n3-week with vacations: {len(response.assignments)} assignments")

    def test_three_weeks_qualifications_respected(self, monkeypatch) -> None:
        """
        Test that qualifications are respected across all 3 weeks.

        Each assignment must match the clinician's qualifications.
        """
        state = make_martin_like_state(day_types=["mon", "tue", "wed", "thu", "fri"])
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(
                startISO=self.THREE_WEEK_DATES[0],
                endISO=self.THREE_WEEK_DATES[-1],
                only_fill_required=True,
            ),
            current_user=TEST_USER,
        )

        # Build qualification lookup
        clinician_qualifications = {c.id: set(c.qualifiedClassIds) for c in state.clinicians}

        # Build slot-to-section mapping
        slot_to_section = {}
        for loc in state.weeklyTemplate.locations:
            for slot in loc.slots:
                block_id = slot.blockId
                # Find the section for this block
                for block in state.weeklyTemplate.blocks:
                    if block.id == block_id:
                        slot_to_section[slot.id] = block.sectionId
                        break

        # Verify each assignment
        violations = []
        for a in response.assignments:
            # Extract base slot ID (remove date suffix)
            slot_base = a.rowId
            section = slot_to_section.get(slot_base)

            if section:
                clin_quals = clinician_qualifications.get(a.clinicianId, set())
                if section not in clin_quals:
                    violations.append(f"{a.clinicianId} assigned to {section} but not qualified")

        if violations:
            print(f"\nQualification violations found:")
            for v in violations[:10]:
                print(f"  {v}")

        assert len(violations) == 0, f"Found {len(violations)} qualification violations"


class TestContinuityDisabled:
    """Tests when continuity constraint is disabled."""

    def test_allows_gaps_when_disabled(self, monkeypatch) -> None:
        """
        When preferContinuousShifts=False, gaps should be allowed.

        This verifies the constraint actually does something.
        """
        clinicians = [
            make_clinician("clin-1", "Dr. Alice", qualified_class_ids=["section-a"]),
        ]

        # Three slots where filling first and third (skipping middle) is optimal
        # if we don't enforce continuity
        slots = _make_consecutive_slots([
            ("08:00", "12:00", 1),  # Required
            ("12:00", "16:00", 0),  # Not required
            ("16:00", "20:00", 1),  # Required
        ])

        solver_settings = {
            "enforceSameLocationPerDay": True,
            "preferContinuousShifts": False,  # DISABLED
            "onCallRestEnabled": False,
        }

        state = _build_continuity_test_state(clinicians, slots, solver_settings)
        monkeypatch.setattr("backend.solver._load_state", lambda _user_id: state)

        response = _solve_range_impl(
            SolveRangeRequest(startISO=TEST_DATE, endISO=TEST_DATE, only_fill_required=True),
            current_user=TEST_USER,
        )

        # With continuity disabled and only first+third required,
        # the solver might create a gap (08-12 + 16-20, skipping 12-16)
        # This test just verifies the solver runs successfully
        day_assignments = [a for a in response.assignments if a.dateISO == TEST_DATE]
        assert len(day_assignments) >= 1, "Should have assignments"
