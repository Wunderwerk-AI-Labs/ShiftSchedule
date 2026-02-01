"""
Test fixtures that mimic Martin's complex radiology department setup.

This creates a realistic test environment with:
- Multiple locations (Kirchberg, Zitha, Cloche d'Or)
- Many sections (CT, IRM, Echo, MG, Staff meetings, etc.)
- Complex time patterns (06:30-07:30 staff, 07:30-11:30, 11:30-15:30, 15:30-19:00)
- Multiple clinicians with varying qualifications

Use these fixtures for testing solver behavior without accessing real user data.
"""

from typing import List, Dict, Tuple

from backend.models import (
    AppState,
    Assignment,
    Clinician,
    Location,
    TemplateBlock,
    TemplateColBand,
    TemplateRowBand,
    TemplateSlot,
    VacationRange,
    WeeklyCalendarTemplate,
    WeeklyTemplateLocation,
    WorkplaceRow,
)


# =============================================================================
# Section Definitions
# =============================================================================

SECTIONS = {
    # Kirchberg sections
    "ct-tout-hk": "CT tout HK",
    "ct-arthro-hk": "CT arthro HK",
    "irm-neuro-hk": "IRM neuro HK",
    "irm-tout-hk": "IRM tout HK",
    "irm-cardio-hk": "IRM cardio HK",
    "echo-tout-hk": "Echo tout HK",
    "mg-tout-hk": "MG tout HK",
    "mg-stereo-hk": "MG stereo HK",
    # Zitha sections
    "ct-tout-zk": "CT tout ZK",
    "ct-biopsie-zk": "CT biopsie ZK",
    "irm-tout-zk": "IRM tout ZK",
    "irm-seno-zk": "IRM seno ZK",
    "irm-neuro-zk": "IRM neuro ZK",
    "echo-tout-zk": "Echo tout ZK",
    "mg-tout-zk": "MG tout ZK",
    # Cloche d'Or sections
    "cor-tout": "COR tout",
    "cor-neuro": "COR neuro",
    # Staff/Meeting sections
    "tout-matin": "Tout matin",
    "tout-soir": "Tout soir",
    "staff-uro": "Staff Uro",
    "staff-gyn": "Staff Gyn",
    "staff-onco": "Staff onco merc",
    # On-call
    "garde-hk": "Garde HK",
    "astreinte": "Astreinte",
}


# =============================================================================
# Location Definitions
# =============================================================================

def make_locations() -> List[Location]:
    """Create the three hospital locations."""
    return [
        Location(id="loc-kirchberg", name="Kirchberg"),
        Location(id="loc-zitha", name="Zitha"),
        Location(id="loc-cdo", name="Cloche d'Or"),
    ]


# =============================================================================
# Clinician Definitions
# =============================================================================

def make_martin_like_clinicians() -> List[Clinician]:
    """
    Create a set of clinicians with varying qualifications.
    Mimics the diversity in Martin's setup.
    """
    return [
        # Senior radiologists - qualified for most sections
        Clinician(
            id="clin-alice",
            name="Dr. Alice Schmidt",
            qualifiedClassIds=[
                "ct-tout-hk", "ct-arthro-hk", "irm-neuro-hk", "irm-tout-hk",
                "echo-tout-hk", "mg-tout-hk", "ct-tout-zk", "irm-tout-zk",
                "tout-matin", "tout-soir", "garde-hk", "astreinte",
            ],
            preferredClassIds=["irm-neuro-hk", "irm-tout-hk"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        Clinician(
            id="clin-bob",
            name="Dr. Bob Mueller",
            qualifiedClassIds=[
                "ct-tout-hk", "irm-tout-hk", "irm-cardio-hk", "echo-tout-hk",
                "ct-tout-zk", "irm-tout-zk", "irm-seno-zk",
                "tout-matin", "garde-hk",
            ],
            preferredClassIds=["irm-cardio-hk"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        Clinician(
            id="clin-carol",
            name="Dr. Carol Weber",
            qualifiedClassIds=[
                "irm-neuro-hk", "irm-tout-hk", "mg-tout-hk", "mg-stereo-hk",
                "irm-tout-zk", "irm-neuro-zk", "mg-tout-zk",
                "cor-tout", "cor-neuro",
                "tout-matin", "staff-uro", "staff-gyn",
            ],
            preferredClassIds=["mg-tout-hk", "mg-stereo-hk"],
            vacations=[],
            workingHoursPerWeek=33.0,
        ),
        # Junior radiologists - more limited qualifications
        Clinician(
            id="clin-david",
            name="Dr. David Klein",
            qualifiedClassIds=[
                "ct-tout-hk", "ct-tout-zk", "echo-tout-hk", "echo-tout-zk",
                "tout-matin", "tout-soir",
            ],
            preferredClassIds=["ct-tout-hk"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        Clinician(
            id="clin-emma",
            name="Dr. Emma Fischer",
            qualifiedClassIds=[
                "irm-tout-zk", "irm-seno-zk", "mg-tout-zk",
                "echo-tout-zk",
                "tout-matin",
            ],
            preferredClassIds=["irm-seno-zk"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        Clinician(
            id="clin-frank",
            name="Dr. Frank Bauer",
            qualifiedClassIds=[
                "ct-tout-hk", "ct-arthro-hk", "irm-neuro-hk",
                "garde-hk", "astreinte",
                "tout-matin", "tout-soir",
            ],
            preferredClassIds=["irm-neuro-hk"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        # Specialists
        Clinician(
            id="clin-greta",
            name="Dr. Greta Hoffmann",
            qualifiedClassIds=[
                "irm-cardio-hk", "irm-neuro-hk", "irm-tout-hk",
                "cor-neuro",
                "staff-onco",
            ],
            preferredClassIds=["irm-cardio-hk"],
            vacations=[],
            workingHoursPerWeek=32.0,
        ),
        Clinician(
            id="clin-hans",
            name="Dr. Hans Richter",
            qualifiedClassIds=[
                "mg-tout-hk", "mg-stereo-hk", "mg-tout-zk",
                "irm-seno-zk",
                "staff-gyn",
            ],
            preferredClassIds=["mg-stereo-hk"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
    ]


# =============================================================================
# Slot Templates
# =============================================================================

def _make_slot(
    slot_id: str,
    location_id: str,
    row_band_id: str,
    col_band_id: str,
    block_id: str,
    start_time: str,
    end_time: str,
    required: int = 1,
    end_day_offset: int = 0,
) -> TemplateSlot:
    """Helper to create a template slot."""
    return TemplateSlot(
        id=slot_id,
        locationId=location_id,
        rowBandId=row_band_id,
        colBandId=col_band_id,
        blockId=block_id,
        requiredSlots=required,
        startTime=start_time,
        endTime=end_time,
        endDayOffset=end_day_offset,
    )


def make_kirchberg_slots(day_type: str) -> List[TemplateSlot]:
    """Create Kirchberg slots for a given day type."""
    col_band_id = f"col-{day_type}-1"
    slots = []

    # Morning staff meeting (06:30-07:30)
    slots.append(_make_slot(
        f"tout-matin-hk__{day_type}",
        "loc-kirchberg", "row-staff", col_band_id,
        "block-tout-matin", "06:30", "07:30", required=1
    ))

    # Morning slots (07:30-13:00)
    for section in ["ct-tout-hk", "irm-neuro-hk", "irm-cardio-hk", "echo-tout-hk", "mg-stereo-hk"]:
        slots.append(_make_slot(
            f"{section}-morning__{day_type}",
            "loc-kirchberg", f"row-{section}", col_band_id,
            f"block-{section}", "07:30", "13:00", required=1
        ))

    # Afternoon slots (13:00-16:00)
    for section in ["ct-tout-hk", "irm-neuro-hk", "echo-tout-hk", "mg-tout-hk"]:
        slots.append(_make_slot(
            f"{section}-afternoon__{day_type}",
            "loc-kirchberg", f"row-{section}", col_band_id,
            f"block-{section}", "13:00", "16:00", required=1
        ))

    # Evening slots (16:00-19:00)
    for section in ["ct-tout-hk", "irm-neuro-hk"]:
        slots.append(_make_slot(
            f"{section}-evening__{day_type}",
            "loc-kirchberg", f"row-{section}", col_band_id,
            f"block-{section}", "16:00", "19:00", required=1
        ))

    return slots


def make_zitha_slots(day_type: str) -> List[TemplateSlot]:
    """Create Zitha slots for a given day type."""
    col_band_id = f"col-{day_type}-1"
    slots = []

    # Morning staff meeting (06:30-07:30) - only on weekdays
    if day_type not in ["sat", "sun", "holiday"]:
        slots.append(_make_slot(
            f"tout-matin-zk__{day_type}",
            "loc-zitha", "row-staff-zk", col_band_id,
            "block-tout-matin", "06:30", "07:30", required=1
        ))

    # Morning slots (07:30-11:30)
    for section in ["ct-tout-zk", "irm-tout-zk", "echo-tout-zk", "mg-tout-zk"]:
        slots.append(_make_slot(
            f"{section}-morning__{day_type}",
            "loc-zitha", f"row-{section}", col_band_id,
            f"block-{section}", "07:30", "11:30", required=1
        ))

    # Midday slots (11:30-15:30)
    for section in ["ct-biopsie-zk", "irm-seno-zk", "echo-tout-zk"]:
        slots.append(_make_slot(
            f"{section}-midday__{day_type}",
            "loc-zitha", f"row-{section}", col_band_id,
            f"block-{section}", "11:30", "15:30", required=1
        ))

    # Afternoon slots (15:30-19:00)
    for section in ["ct-tout-zk", "irm-tout-zk"]:
        slots.append(_make_slot(
            f"{section}-afternoon__{day_type}",
            "loc-zitha", f"row-{section}", col_band_id,
            f"block-{section}", "15:30", "19:00", required=1
        ))

    return slots


# =============================================================================
# Main State Builder
# =============================================================================

def make_martin_like_state(
    day_types: List[str] = None,
    include_vacations: bool = False,
) -> AppState:
    """
    Create a complete AppState that mimics Martin's radiology department.

    Args:
        day_types: Which day types to include slots for. Default: ["mon", "tue", "wed", "thu", "fri"]
        include_vacations: Whether to add some vacation ranges

    Returns:
        A fully configured AppState ready for solver testing.
    """
    if day_types is None:
        day_types = ["mon", "tue", "wed", "thu", "fri"]

    locations = make_locations()
    clinicians = make_martin_like_clinicians()

    # Add some vacations if requested
    if include_vacations:
        # Alice is on vacation for a few days
        clinicians[0].vacations = [
            VacationRange(id="vac-1", startISO="2026-01-07", endISO="2026-01-09"),
        ]

    # Create workplace rows for all sections
    rows = []
    for section_id, section_name in SECTIONS.items():
        rows.append(WorkplaceRow(
            id=section_id,
            name=section_name,
            kind="class",
            dotColorClass="bg-slate-400",
            blockColor="#E8E1F5",
            locationId="loc-kirchberg" if "hk" in section_id else "loc-zitha" if "zk" in section_id else "loc-cdo",
            subShifts=[],
        ))

    # Add pool rows
    rows.extend([
        WorkplaceRow(id="pool-rest-day", name="Rest Day", kind="pool", dotColorClass="bg-slate-200"),
        WorkplaceRow(id="pool-vacation", name="Vacation", kind="pool", dotColorClass="bg-slate-200"),
    ])

    # Create blocks for all sections
    blocks = [
        TemplateBlock(id=f"block-{section_id}", sectionId=section_id, requiredSlots=0)
        for section_id in SECTIONS.keys()
    ]

    # Create column bands for all day types
    col_bands_kirchberg = [
        TemplateColBand(id=f"col-{day_type}-1", label="", order=1, dayType=day_type)
        for day_type in day_types
    ]
    col_bands_zitha = [
        TemplateColBand(id=f"col-{day_type}-1", label="", order=1, dayType=day_type)
        for day_type in day_types
    ]

    # Create row bands
    row_bands_kirchberg = [
        TemplateRowBand(id="row-staff", label="Staff", order=0),
    ] + [
        TemplateRowBand(id=f"row-{section_id}", label=section_name, order=i+1)
        for i, (section_id, section_name) in enumerate(SECTIONS.items())
        if "hk" in section_id or section_id in ["tout-matin", "tout-soir", "garde-hk", "astreinte"]
    ]

    row_bands_zitha = [
        TemplateRowBand(id="row-staff-zk", label="Staff", order=0),
    ] + [
        TemplateRowBand(id=f"row-{section_id}", label=section_name, order=i+1)
        for i, (section_id, section_name) in enumerate(SECTIONS.items())
        if "zk" in section_id
    ]

    # Create all slots for all day types
    kirchberg_slots = []
    zitha_slots = []
    for day_type in day_types:
        kirchberg_slots.extend(make_kirchberg_slots(day_type))
        zitha_slots.extend(make_zitha_slots(day_type))

    # Build template
    template = WeeklyCalendarTemplate(
        version=4,
        blocks=blocks,
        locations=[
            WeeklyTemplateLocation(
                locationId="loc-kirchberg",
                rowBands=row_bands_kirchberg,
                colBands=col_bands_kirchberg,
                slots=kirchberg_slots,
            ),
            WeeklyTemplateLocation(
                locationId="loc-zitha",
                rowBands=row_bands_zitha,
                colBands=col_bands_zitha,
                slots=zitha_slots,
            ),
        ],
    )

    # Solver settings matching Martin's
    solver_settings = {
        "enforceSameLocationPerDay": True,
        "preferContinuousShifts": True,
        "onCallRestEnabled": False,
        "onCallRestClassId": "garde-hk",
        "onCallRestDaysBefore": 1,
        "onCallRestDaysAfter": 1,
    }

    return AppState(
        locations=locations,
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


# =============================================================================
# Utility Functions
# =============================================================================

def get_slot_times(state: AppState) -> Dict[str, Tuple[str, str]]:
    """Extract slot ID -> (start, end) mapping from state."""
    slot_times = {}
    for loc in state.weeklyTemplate.locations:
        for slot in loc.slots:
            slot_times[slot.id] = (slot.startTime, slot.endTime)
    return slot_times


def check_for_gaps(
    assignments: List[Assignment],
    slot_times: Dict[str, Tuple[str, str]],
    date_iso: str,
) -> List[Dict]:
    """
    Check for gaps in assignments on a specific date.

    Returns list of gap descriptions.
    """
    from collections import defaultdict

    def time_to_min(t):
        h, m = t.split(":")
        return int(h) * 60 + int(m)

    # Group by clinician
    by_clinician = defaultdict(list)
    for a in assignments:
        if a.dateISO != date_iso:
            continue
        times = slot_times.get(a.rowId)
        if times:
            by_clinician[a.clinicianId].append({
                "start": times[0],
                "end": times[1],
                "slot": a.rowId,
            })

    gaps = []
    for clin_id, slots in by_clinician.items():
        if len(slots) < 2:
            continue
        slots.sort(key=lambda x: time_to_min(x["start"]))
        for i in range(len(slots) - 1):
            end_curr = time_to_min(slots[i]["end"])
            start_next = time_to_min(slots[i + 1]["start"])
            if end_curr < start_next:
                gaps.append({
                    "clinician": clin_id,
                    "date": date_iso,
                    "slot1": f"{slots[i]['start']}-{slots[i]['end']}",
                    "slot2": f"{slots[i + 1]['start']}-{slots[i + 1]['end']}",
                    "gap_hours": (start_next - end_curr) / 60,
                })

    return gaps
