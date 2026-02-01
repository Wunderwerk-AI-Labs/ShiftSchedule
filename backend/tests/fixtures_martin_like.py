"""
Test fixtures that mimic a complex radiology department setup.

This creates a realistic test environment with:
- Multiple locations (Main Campus, North Wing, South Site)
- Many sections (CT, MRI, Ultrasound, Mammography, Staff meetings, etc.)
- Complex time patterns (06:30-07:30 rounds, 07:30-11:30, 11:30-15:30, 15:30-19:00)
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
    # Main Campus sections
    "ct-general-mc": "CT General MC",
    "ct-interv-mc": "CT Interventional MC",
    "mri-neuro-mc": "MRI Neuro MC",
    "mri-general-mc": "MRI General MC",
    "mri-cardiac-mc": "MRI Cardiac MC",
    "us-general-mc": "Ultrasound General MC",
    "mammo-general-mc": "Mammography General MC",
    "mammo-stereo-mc": "Mammography Stereo MC",
    # North Wing sections
    "ct-general-nw": "CT General NW",
    "ct-biopsy-nw": "CT Biopsy NW",
    "mri-general-nw": "MRI General NW",
    "mri-breast-nw": "MRI Breast NW",
    "mri-neuro-nw": "MRI Neuro NW",
    "us-general-nw": "Ultrasound General NW",
    "mammo-general-nw": "Mammography General NW",
    # South Site sections
    "imaging-general-ss": "Imaging General SS",
    "imaging-neuro-ss": "Imaging Neuro SS",
    # Staff/Meeting sections
    "morning-rounds": "Morning Rounds",
    "evening-rounds": "Evening Rounds",
    "mdt-urology": "MDT Urology",
    "mdt-gynecology": "MDT Gynecology",
    "mdt-oncology": "MDT Oncology",
    # On-call
    "oncall-mc": "On-Call MC",
    "standby": "Standby",
}


# =============================================================================
# Location Definitions
# =============================================================================

def make_locations() -> List[Location]:
    """Create the three hospital locations."""
    return [
        Location(id="loc-main-campus", name="Main Campus"),
        Location(id="loc-north-wing", name="North Wing"),
        Location(id="loc-south-site", name="South Site"),
    ]


# =============================================================================
# Clinician Definitions
# =============================================================================

def make_martin_like_clinicians() -> List[Clinician]:
    """
    Create a set of clinicians with varying qualifications.
    Mimics the diversity in a real radiology department.
    """
    return [
        # Senior radiologists - qualified for most sections
        Clinician(
            id="clin-chen",
            name="Dr. Sarah Chen",
            qualifiedClassIds=[
                "ct-general-mc", "ct-interv-mc", "mri-neuro-mc", "mri-general-mc",
                "us-general-mc", "mammo-general-mc", "ct-general-nw", "mri-general-nw",
                "morning-rounds", "evening-rounds", "oncall-mc", "standby",
            ],
            preferredClassIds=["mri-neuro-mc", "mri-general-mc"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        Clinician(
            id="clin-patel",
            name="Dr. Raj Patel",
            qualifiedClassIds=[
                "ct-general-mc", "mri-general-mc", "mri-cardiac-mc", "us-general-mc",
                "ct-general-nw", "mri-general-nw", "mri-breast-nw",
                "morning-rounds", "oncall-mc",
            ],
            preferredClassIds=["mri-cardiac-mc"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        Clinician(
            id="clin-johnson",
            name="Dr. Emily Johnson",
            qualifiedClassIds=[
                "mri-neuro-mc", "mri-general-mc", "mammo-general-mc", "mammo-stereo-mc",
                "mri-general-nw", "mri-neuro-nw", "mammo-general-nw",
                "imaging-general-ss", "imaging-neuro-ss",
                "morning-rounds", "mdt-urology", "mdt-gynecology",
            ],
            preferredClassIds=["mammo-general-mc", "mammo-stereo-mc"],
            vacations=[],
            workingHoursPerWeek=33.0,
        ),
        # Junior radiologists - more limited qualifications
        Clinician(
            id="clin-williams",
            name="Dr. Michael Williams",
            qualifiedClassIds=[
                "ct-general-mc", "ct-general-nw", "us-general-mc", "us-general-nw",
                "morning-rounds", "evening-rounds",
            ],
            preferredClassIds=["ct-general-mc"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        Clinician(
            id="clin-garcia",
            name="Dr. Maria Garcia",
            qualifiedClassIds=[
                "mri-general-nw", "mri-breast-nw", "mammo-general-nw",
                "us-general-nw",
                "morning-rounds",
            ],
            preferredClassIds=["mri-breast-nw"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        Clinician(
            id="clin-kim",
            name="Dr. James Kim",
            qualifiedClassIds=[
                "ct-general-mc", "ct-interv-mc", "mri-neuro-mc",
                "oncall-mc", "standby",
                "morning-rounds", "evening-rounds",
            ],
            preferredClassIds=["mri-neuro-mc"],
            vacations=[],
            workingHoursPerWeek=40.0,
        ),
        # Specialists
        Clinician(
            id="clin-nguyen",
            name="Dr. Lisa Nguyen",
            qualifiedClassIds=[
                "mri-cardiac-mc", "mri-neuro-mc", "mri-general-mc",
                "imaging-neuro-ss",
                "mdt-oncology",
            ],
            preferredClassIds=["mri-cardiac-mc"],
            vacations=[],
            workingHoursPerWeek=32.0,
        ),
        Clinician(
            id="clin-brown",
            name="Dr. David Brown",
            qualifiedClassIds=[
                "mammo-general-mc", "mammo-stereo-mc", "mammo-general-nw",
                "mri-breast-nw",
                "mdt-gynecology",
            ],
            preferredClassIds=["mammo-stereo-mc"],
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


def make_main_campus_slots(day_type: str) -> List[TemplateSlot]:
    """Create Main Campus slots for a given day type."""
    col_band_id = f"col-{day_type}-1"
    slots = []

    # Morning rounds (06:30-07:30)
    slots.append(_make_slot(
        f"morning-rounds-mc__{day_type}",
        "loc-main-campus", "row-staff", col_band_id,
        "block-morning-rounds", "06:30", "07:30", required=1
    ))

    # Morning slots (07:30-13:00)
    for section in ["ct-general-mc", "mri-neuro-mc", "mri-cardiac-mc", "us-general-mc", "mammo-stereo-mc"]:
        slots.append(_make_slot(
            f"{section}-morning__{day_type}",
            "loc-main-campus", f"row-{section}", col_band_id,
            f"block-{section}", "07:30", "13:00", required=1
        ))

    # Afternoon slots (13:00-16:00)
    for section in ["ct-general-mc", "mri-neuro-mc", "us-general-mc", "mammo-general-mc"]:
        slots.append(_make_slot(
            f"{section}-afternoon__{day_type}",
            "loc-main-campus", f"row-{section}", col_band_id,
            f"block-{section}", "13:00", "16:00", required=1
        ))

    # Evening slots (16:00-19:00)
    for section in ["ct-general-mc", "mri-neuro-mc"]:
        slots.append(_make_slot(
            f"{section}-evening__{day_type}",
            "loc-main-campus", f"row-{section}", col_band_id,
            f"block-{section}", "16:00", "19:00", required=1
        ))

    return slots


def make_north_wing_slots(day_type: str) -> List[TemplateSlot]:
    """Create North Wing slots for a given day type."""
    col_band_id = f"col-{day_type}-1"
    slots = []

    # Morning rounds (06:30-07:30) - only on weekdays
    if day_type not in ["sat", "sun", "holiday"]:
        slots.append(_make_slot(
            f"morning-rounds-nw__{day_type}",
            "loc-north-wing", "row-staff-nw", col_band_id,
            "block-morning-rounds", "06:30", "07:30", required=1
        ))

    # Morning slots (07:30-11:30)
    for section in ["ct-general-nw", "mri-general-nw", "us-general-nw", "mammo-general-nw"]:
        slots.append(_make_slot(
            f"{section}-morning__{day_type}",
            "loc-north-wing", f"row-{section}", col_band_id,
            f"block-{section}", "07:30", "11:30", required=1
        ))

    # Midday slots (11:30-15:30)
    for section in ["ct-biopsy-nw", "mri-breast-nw", "us-general-nw"]:
        slots.append(_make_slot(
            f"{section}-midday__{day_type}",
            "loc-north-wing", f"row-{section}", col_band_id,
            f"block-{section}", "11:30", "15:30", required=1
        ))

    # Afternoon slots (15:30-19:00)
    for section in ["ct-general-nw", "mri-general-nw"]:
        slots.append(_make_slot(
            f"{section}-afternoon__{day_type}",
            "loc-north-wing", f"row-{section}", col_band_id,
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
    Create a complete AppState that mimics a complex radiology department.

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
        # Dr. Chen is on vacation for a few days
        clinicians[0].vacations = [
            VacationRange(id="vac-1", startISO="2026-01-07", endISO="2026-01-09"),
        ]

    # Create workplace rows for all sections
    rows = []
    for section_id, section_name in SECTIONS.items():
        loc_id = "loc-main-campus" if "mc" in section_id else "loc-north-wing" if "nw" in section_id else "loc-south-site"
        rows.append(WorkplaceRow(
            id=section_id,
            name=section_name,
            kind="class",
            dotColorClass="bg-slate-400",
            blockColor="#E8E1F5",
            locationId=loc_id,
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
    col_bands_main = [
        TemplateColBand(id=f"col-{day_type}-1", label="", order=1, dayType=day_type)
        for day_type in day_types
    ]
    col_bands_north = [
        TemplateColBand(id=f"col-{day_type}-1", label="", order=1, dayType=day_type)
        for day_type in day_types
    ]

    # Create row bands
    row_bands_main = [
        TemplateRowBand(id="row-staff", label="Staff", order=0),
    ] + [
        TemplateRowBand(id=f"row-{section_id}", label=section_name, order=i+1)
        for i, (section_id, section_name) in enumerate(SECTIONS.items())
        if "mc" in section_id or section_id in ["morning-rounds", "evening-rounds", "oncall-mc", "standby"]
    ]

    row_bands_north = [
        TemplateRowBand(id="row-staff-nw", label="Staff", order=0),
    ] + [
        TemplateRowBand(id=f"row-{section_id}", label=section_name, order=i+1)
        for i, (section_id, section_name) in enumerate(SECTIONS.items())
        if "nw" in section_id
    ]

    # Create all slots for all day types
    main_slots = []
    north_slots = []
    for day_type in day_types:
        main_slots.extend(make_main_campus_slots(day_type))
        north_slots.extend(make_north_wing_slots(day_type))

    # Build template
    template = WeeklyCalendarTemplate(
        version=4,
        blocks=blocks,
        locations=[
            WeeklyTemplateLocation(
                locationId="loc-main-campus",
                rowBands=row_bands_main,
                colBands=col_bands_main,
                slots=main_slots,
            ),
            WeeklyTemplateLocation(
                locationId="loc-north-wing",
                rowBands=row_bands_north,
                colBands=col_bands_north,
                slots=north_slots,
            ),
        ],
    )

    # Solver settings
    solver_settings = {
        "enforceSameLocationPerDay": True,
        "preferContinuousShifts": True,
        "onCallRestEnabled": False,
        "onCallRestClassId": "oncall-mc",
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
