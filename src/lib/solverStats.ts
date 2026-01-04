import type { Assignment, Clinician } from "../api/client";
import type { ScheduleRow } from "./shiftRows";

export type SolverLiveStats = {
  filledSlots: number;
  totalRequiredSlots: number;
  openSlots: number;
  nonConsecutiveShifts: number;
  cliniciansWithinHours: number;
  totalCliniciansWithTarget: number;
};

// Map day of week (0=Sun, 1=Mon, ..., 6=Sat) to DayType
const DAY_INDEX_TO_TYPE: Record<number, string> = {
  0: "sun",
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
};

// Helper to get all dates in a range (inclusive)
function getDatesInRange(startISO: string, endISO: string): string[] {
  const dates: string[] = [];
  const start = new Date(startISO);
  const end = new Date(endISO);
  const current = new Date(start);
  while (current <= end) {
    dates.push(current.toISOString().split("T")[0]);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// Parse "HH:MM" to minutes since midnight
function parseTimeToMinutes(time: string | undefined): number | null {
  if (!time) return null;
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

// Calculate slot duration in minutes
function getSlotDurationMinutes(row: ScheduleRow): number {
  const start = parseTimeToMinutes(row.startTime);
  const end = parseTimeToMinutes(row.endTime);
  if (start === null || end === null) return 480; // Default 8 hours

  let duration = end - start;
  // Handle overnight shifts
  if (row.endDayOffset && row.endDayOffset > 0) {
    duration += row.endDayOffset * 24 * 60;
  } else if (duration < 0) {
    duration += 24 * 60; // Assume next day
  }
  return Math.max(0, duration);
}

/**
 * Calculate live solver statistics from the current solution.
 *
 * @param assignments - Current solution's assignments
 * @param scheduleRows - Schedule row definitions (with requiredSlots, startTime, endTime, dayType)
 * @param clinicians - Clinician data (for working hours calculation)
 * @param solveRange - The date range being solved
 * @param holidays - Set of holiday date ISOs
 * @returns Statistics about the current solution
 */
export function calculateSolverLiveStats(
  assignments: Assignment[],
  scheduleRows: ScheduleRow[],
  clinicians: Clinician[],
  solveRange: { startISO: string; endISO: string },
  holidays: Set<string>,
): SolverLiveStats {
  // Get all dates in the solve range
  const dates = getDatesInRange(solveRange.startISO, solveRange.endISO);

  // Count working days (Mon-Fri) excluding holidays for working hours scaling
  let workingDaysInRange = 0;
  for (const dateISO of dates) {
    const date = new Date(dateISO);
    const dayOfWeek = date.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5; // Mon-Fri
    const isHoliday = holidays.has(dateISO);
    if (isWeekday && !isHoliday) {
      workingDaysInRange++;
    }
  }
  // Scale based on working days: if 4 working days in range, scale = 4/5
  const scale = workingDaysInRange / 5.0;

  // Build maps for quick lookup
  const rowById = new Map(scheduleRows.map((r) => [r.id, r]));

  // Count assignments per (rowId, dateISO)
  const assignmentCounts = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.rowId}|${a.dateISO}`;
    assignmentCounts.set(key, (assignmentCounts.get(key) ?? 0) + 1);
  }

  // ===== 1. Calculate filled slots vs required slots =====
  // Build a map: rowId -> (dayType -> requiredSlots)
  const rowRequiredByDayType = new Map<string, Map<string, number>>();
  for (const row of scheduleRows) {
    if (row.kind !== "class" || !row.requiredSlots) continue;
    const required = row.requiredSlots;
    if (required <= 0) continue;

    if (!rowRequiredByDayType.has(row.id)) {
      rowRequiredByDayType.set(row.id, new Map());
    }
    const dayMap = rowRequiredByDayType.get(row.id)!;

    if (row.dayType) {
      // Row is specific to a day type
      dayMap.set(row.dayType, required);
    } else {
      // Row applies to all day types
      for (const dayType of ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]) {
        dayMap.set(dayType, required);
      }
    }
  }

  let totalRequiredSlots = 0;
  let filledSlots = 0;

  for (const [rowId, dayMap] of rowRequiredByDayType) {
    for (const dateISO of dates) {
      const date = new Date(dateISO);
      const dayType = holidays.has(dateISO)
        ? "holiday"
        : DAY_INDEX_TO_TYPE[date.getDay()] ?? "mon";

      const required = dayMap.get(dayType) ?? 0;
      if (required === 0) continue;

      const key = `${rowId}|${dateISO}`;
      const filled = assignmentCounts.get(key) ?? 0;

      totalRequiredSlots += required;
      filledSlots += Math.min(filled, required); // Don't count overfilling
    }
  }

  const openSlots = totalRequiredSlots - filledSlots;

  // ===== 2. Calculate non-consecutive shifts =====
  // Group assignments by clinician and date, then check for gaps
  const assignmentsByClinicianDate = new Map<string, Set<string>>();
  for (const a of assignments) {
    const key = `${a.clinicianId}|${a.dateISO}`;
    if (!assignmentsByClinicianDate.has(key)) {
      assignmentsByClinicianDate.set(key, new Set());
    }
    assignmentsByClinicianDate.get(key)!.add(a.rowId);
  }

  let nonConsecutiveShifts = 0;

  for (const [_key, rowIds] of assignmentsByClinicianDate) {
    if (rowIds.size <= 1) continue;

    // Get time intervals for each row
    const intervals: { start: number; end: number }[] = [];
    for (const rowId of rowIds) {
      const row = rowById.get(rowId);
      if (!row) continue;
      const start = parseTimeToMinutes(row.startTime);
      const end = parseTimeToMinutes(row.endTime);
      if (start !== null && end !== null) {
        let adjustedEnd = end;
        if (row.endDayOffset && row.endDayOffset > 0) {
          adjustedEnd += row.endDayOffset * 24 * 60;
        } else if (end < start) {
          adjustedEnd += 24 * 60;
        }
        intervals.push({ start, end: adjustedEnd });
      }
    }

    if (intervals.length <= 1) continue;

    // Sort by start time
    intervals.sort((a, b) => a.start - b.start);

    // Check for gaps between consecutive intervals
    for (let i = 1; i < intervals.length; i++) {
      const prev = intervals[i - 1];
      const curr = intervals[i];
      // If there's a gap (current starts after previous ends), it's non-consecutive
      if (curr.start > prev.end) {
        nonConsecutiveShifts++;
        break; // Count once per (clinician, date) pair
      }
    }
  }

  // ===== 3. Calculate clinicians within working hours =====
  // Sum up hours per clinician and compare to their target
  const minutesByClinicianId = new Map<string, number>();

  for (const a of assignments) {
    const row = rowById.get(a.rowId);
    if (!row) continue;
    const duration = getSlotDurationMinutes(row);
    minutesByClinicianId.set(
      a.clinicianId,
      (minutesByClinicianId.get(a.clinicianId) ?? 0) + duration,
    );
  }

  let cliniciansWithinHours = 0;
  let totalCliniciansWithTarget = 0;

  for (const clinician of clinicians) {
    const targetHoursPerWeek = clinician.workingHoursPerWeek;
    if (typeof targetHoursPerWeek !== "number" || targetHoursPerWeek <= 0) {
      continue; // Skip clinicians without a target
    }

    totalCliniciansWithTarget++;

    const toleranceHours = clinician.workingHoursToleranceHours ?? 5;
    const targetMinutes = targetHoursPerWeek * 60 * scale;
    const toleranceMinutes = toleranceHours * 60 * scale;

    const actualMinutes = minutesByClinicianId.get(clinician.id) ?? 0;
    const deviation = Math.abs(actualMinutes - targetMinutes);

    if (deviation <= toleranceMinutes) {
      cliniciansWithinHours++;
    }
  }

  return {
    filledSlots,
    totalRequiredSlots,
    openSlots,
    nonConsecutiveShifts,
    cliniciansWithinHours,
    totalCliniciansWithTarget,
  };
}
