from typing import List
from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .auth import _get_current_user
from .models import AppState, UserPublic
from .state import _load_state, _normalize_state, _save_state

router = APIRouter()


class HealthCheckIssue(BaseModel):
    type: str  # "orphaned_assignment", "slot_collision", "duplicate_assignment", "colband_explosion"
    severity: str  # "error", "warning"
    message: str
    details: dict = {}


class DatabaseHealthCheckResult(BaseModel):
    healthy: bool
    issues: List[HealthCheckIssue]
    stats: dict


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/v1/state", response_model=AppState)
def get_state(current_user: UserPublic = Depends(_get_current_user)):
    return _load_state(current_user.username)


@router.post("/v1/state", response_model=AppState)
def set_state(payload: AppState, current_user: UserPublic = Depends(_get_current_user)):
    normalized, _ = _normalize_state(payload)
    _save_state(normalized, current_user.username)
    return normalized


@router.get("/v1/state/health", response_model=DatabaseHealthCheckResult)
def check_database_health(current_user: UserPublic = Depends(_get_current_user)):
    """
    Run database health checks and return any issues found.

    Checks performed:
    1. Orphaned assignments - assignments referencing non-existent slots
    2. Slot collisions - multiple sections sharing the same slot position
    3. Duplicate assignments - same clinician assigned multiple times to same slot/date
    4. ColBand explosion - excessive colBands per day type
    """
    state = _load_state(current_user.username)
    issues: List[HealthCheckIssue] = []

    # Build valid slot IDs from template
    valid_slot_ids = set()
    pool_ids = set()
    slot_info = {}  # slot_id -> {locationId, rowBandId, dayType, colBandOrder, sectionId}

    for row in state.rows or []:
        if row.kind == "pool":
            pool_ids.add(row.id)

    template = state.weeklyTemplate
    if template:
        # Build slot info for collision detection
        for loc in template.locations or []:
            col_band_by_id = {cb.id: cb for cb in (loc.colBands or [])}
            for slot in loc.slots or []:
                valid_slot_ids.add(slot.id)
                col_band = col_band_by_id.get(slot.colBandId)
                if col_band:
                    # Find block to get sectionId
                    block = next((b for b in (template.blocks or []) if b.id == slot.blockId), None)
                    slot_info[slot.id] = {
                        "locationId": loc.locationId,
                        "rowBandId": slot.rowBandId,
                        "dayType": col_band.dayType,
                        "colBandOrder": col_band.order,
                        "sectionId": block.sectionId if block else None,
                        "slotId": slot.id,
                    }

    # 1. Check for orphaned assignments
    orphaned = []
    for assignment in state.assignments or []:
        row_id = assignment.rowId
        if row_id not in valid_slot_ids and row_id not in pool_ids:
            orphaned.append({
                "assignmentId": assignment.id,
                "rowId": row_id,
                "dateISO": assignment.dateISO,
                "clinicianId": assignment.clinicianId,
            })

    if orphaned:
        issues.append(HealthCheckIssue(
            type="orphaned_assignment",
            severity="warning",
            message=f"{len(orphaned)} assignment(s) reference slots not in the template",
            details={"assignments": orphaned[:10]},  # Limit to first 10
        ))

    # 2. Check for slot collisions (multiple sections at same position)
    position_to_slots = {}  # key: "locId__rowBandId__dayType__colBandOrder" -> list of slot infos
    for slot_id, info in slot_info.items():
        key = f"{info['locationId']}__{info['rowBandId']}__{info['dayType']}__{info['colBandOrder']}"
        if key not in position_to_slots:
            position_to_slots[key] = []
        position_to_slots[key].append(info)

    collisions = []
    for key, slots in position_to_slots.items():
        section_ids = set(s["sectionId"] for s in slots if s["sectionId"])
        if len(section_ids) > 1:
            collisions.append({
                "position": key,
                "sectionIds": list(section_ids),
                "slotCount": len(slots),
            })

    if collisions:
        issues.append(HealthCheckIssue(
            type="slot_collision",
            severity="error",
            message=f"{len(collisions)} slot collision(s) detected - sections hidden in calendar",
            details={"collisions": collisions[:10]},
        ))

    # 3. Check for duplicate assignments (same clinician, same slot, same date)
    assignment_keys = {}  # key: "rowId__dateISO__clinicianId" -> list of assignment ids
    for assignment in state.assignments or []:
        key = f"{assignment.rowId}__{assignment.dateISO}__{assignment.clinicianId}"
        if key not in assignment_keys:
            assignment_keys[key] = []
        assignment_keys[key].append(assignment.id)

    duplicates = []
    for key, ids in assignment_keys.items():
        if len(ids) > 1:
            parts = key.split("__")
            duplicates.append({
                "rowId": parts[0],
                "dateISO": parts[1],
                "clinicianId": parts[2],
                "assignmentIds": ids,
                "count": len(ids),
            })

    if duplicates:
        issues.append(HealthCheckIssue(
            type="duplicate_assignment",
            severity="warning",
            message=f"{len(duplicates)} duplicate assignment(s) found",
            details={"duplicates": duplicates[:10]},
        ))

    # 4. Check for colBand explosion
    MAX_COLBANDS_PER_DAY = 20
    colband_issues = []
    if template:
        for loc in template.locations or []:
            count_by_day = {}
            for cb in loc.colBands or []:
                day = cb.dayType or "unknown"
                count_by_day[day] = count_by_day.get(day, 0) + 1

            for day, count in count_by_day.items():
                if count > MAX_COLBANDS_PER_DAY:
                    colband_issues.append({
                        "locationId": loc.locationId,
                        "dayType": day,
                        "count": count,
                        "limit": MAX_COLBANDS_PER_DAY,
                    })

    if colband_issues:
        issues.append(HealthCheckIssue(
            type="colband_explosion",
            severity="error",
            message=f"{len(colband_issues)} location(s) have excessive colBands",
            details={"locations": colband_issues},
        ))

    # Build stats
    stats = {
        "totalAssignments": len(state.assignments or []),
        "totalSlots": len(valid_slot_ids),
        "totalClinicians": len(state.clinicians or []),
        "totalLocations": len(template.locations) if template else 0,
        "totalBlocks": len(template.blocks) if template else 0,
    }

    return DatabaseHealthCheckResult(
        healthy=len(issues) == 0,
        issues=issues,
        stats=stats,
    )
