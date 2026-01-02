import { addDays, toISODate } from "./date";
import { getDayType } from "./dayTypes";
import type { SolverSettings } from "../api/client";
import type { Assignment, Clinician } from "../api/client";
import type { ScheduleRow } from "./shiftRows";

export const FREE_POOL_ID = "pool-not-allocated";
export const MANUAL_POOL_ID = "pool-manual";
export const REST_DAY_POOL_ID = "pool-rest-day";
export const VACATION_POOL_ID = "pool-vacation";

export type TimeRange = { start: number; end: number };
export type AvailabilitySegment = { label: string; kind: "free" | "taken" };
export type RenderedAssignment = Assignment & {
  availabilitySegments?: AvailabilitySegment[];
};

const MINUTES_IN_DAY = 24 * 60;

function parseTimeToMinutes(value?: string): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutesWithOffset(totalMinutes: number): string {
  const offset = Math.floor(totalMinutes / MINUTES_IN_DAY);
  const clamped = ((totalMinutes % MINUTES_IN_DAY) + MINUTES_IN_DAY) % MINUTES_IN_DAY;
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return offset > 0 ? `${base} +${offset}d` : base;
}

export function formatTimeRangeLabel(start: number, end: number): string {
  return `${formatMinutesWithOffset(start)} - ${formatMinutesWithOffset(end)}`;
}

export function buildShiftInterval(row: ScheduleRow): TimeRange | null {
  if (row.kind !== "class") return null;
  const start = parseTimeToMinutes(row.startTime);
  if (start === null) return null;
  const endBase = parseTimeToMinutes(row.endTime);
  if (endBase === null) return null;
  const offset =
    typeof row.endDayOffset === "number" && Number.isFinite(row.endDayOffset)
      ? Math.max(0, Math.min(3, Math.floor(row.endDayOffset)))
      : 0;
  const end = endBase + offset * MINUTES_IN_DAY;
  if (end <= start) return null;
  return { start, end };
}

export function intervalsOverlap(a: TimeRange, b: TimeRange): boolean {
  return !(a.end <= b.start || b.end <= a.start);
}

function mergeIntervals(intervals: TimeRange[]): TimeRange[] {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: TimeRange[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

function buildAvailabilitySegments(
  assignedIntervals: TimeRange[],
  daySpan: TimeRange | null,
): AvailabilitySegment[] {
  if (!daySpan) return [];
  const merged = mergeIntervals(
    assignedIntervals.filter((interval) => interval.end > interval.start),
  );
  const segments: AvailabilitySegment[] = [];
  let cursor = daySpan.start;
  for (const interval of merged) {
    if (interval.start > cursor) {
      segments.push({
        kind: "free",
        label: formatTimeRangeLabel(cursor, interval.start),
      });
    }
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < daySpan.end) {
    segments.push({
      kind: "free",
      label: formatTimeRangeLabel(cursor, daySpan.end),
    });
  }
  return segments;
}

function hasFreeShift(
  assignedIntervals: TimeRange[],
  shiftIntervals: TimeRange[],
): boolean {
  if (!shiftIntervals.length) return true;
  if (!assignedIntervals.length) return true;
  for (const interval of shiftIntervals) {
    if (!assignedIntervals.some((assigned) => intervalsOverlap(interval, assigned))) {
      return true;
    }
  }
  return false;
}

export function buildRenderedAssignmentMap(
  assignmentMap: Map<string, Assignment[]>,
  clinicians: Clinician[],
  displayDays: Date[],
  options?: {
    scheduleRows?: ScheduleRow[];
    solverSettings?: SolverSettings;
    holidayDates?: Set<string>;
  },
) {
  const scheduleRows = options?.scheduleRows ?? [];
  const holidayDates = options?.holidayDates;
  const solverSettings = options?.solverSettings ?? {
    allowMultipleShiftsPerDay: false,
    enforceSameLocationPerDay: false,
    onCallRestEnabled: false,
    onCallRestClassId: "",
    onCallRestDaysBefore: 0,
    onCallRestDaysAfter: 0,
  };
  const displayDateSet = new Set(displayDays.map((date) => toISODate(date)));
  const rowKindById = new Map(scheduleRows.map((row) => [row.id, row.kind]));
  const sectionByRowId = new Map(
    scheduleRows
      .filter((row) => row.kind === "class")
      .map((row) => [row.id, row.sectionId ?? row.id]),
  );
  const hasManualPoolRow = scheduleRows.some((row) => row.id === MANUAL_POOL_ID);
  const hasRestDayPoolRow = scheduleRows.some((row) => row.id === REST_DAY_POOL_ID);
  const onCallRestClassId = solverSettings.onCallRestClassId ?? "";
  const restDaysBefore = Math.max(0, solverSettings.onCallRestDaysBefore ?? 0);
  const restDaysAfter = Math.max(0, solverSettings.onCallRestDaysAfter ?? 0);
  const onCallShiftRowIds = new Set(
    Array.from(sectionByRowId.entries())
      .filter(([, sectionId]) => sectionId === onCallRestClassId)
      .map(([rowId]) => rowId),
  );
  const shiftIntervalsByRowId = new Map<string, TimeRange>();
  const shiftIntervalsByDayType = new Map<string, TimeRange[]>();
  for (const row of scheduleRows) {
    if (row.kind !== "class") continue;
    const interval = buildShiftInterval(row);
    if (!interval) continue;
    shiftIntervalsByRowId.set(row.id, interval);
    if (row.dayType) {
      const list = shiftIntervalsByDayType.get(row.dayType) ?? [];
      list.push(interval);
      shiftIntervalsByDayType.set(row.dayType, list);
    }
  }
  const allShiftIntervals = Array.from(shiftIntervalsByRowId.values());
  const daySpan = allShiftIntervals.length
    ? {
        start: Math.min(...allShiftIntervals.map((interval) => interval.start)),
        end: Math.max(...allShiftIntervals.map((interval) => interval.end)),
      }
    : null;

  const vacationByDate = new Map<string, Set<string>>();
  for (const clinician of clinicians) {
    for (const vacation of clinician.vacations) {
      let cursor = new Date(`${vacation.startISO}T00:00:00`);
      const end = new Date(`${vacation.endISO}T00:00:00`);
      while (cursor <= end) {
        const dateISO = toISODate(cursor);
        let set = vacationByDate.get(dateISO);
        if (!set) {
          set = new Set();
          vacationByDate.set(dateISO, set);
        }
        set.add(clinician.id);
        cursor = addDays(cursor, 1);
      }
    }
  }

  const next = new Map<string, RenderedAssignment[]>();
  const assignedByDate = new Map<string, Map<string, TimeRange[]>>();
  const assignedCliniciansByDate = new Map<string, Set<string>>();
  const unknownIntervalByDate = new Map<string, Set<string>>();
  const assignedShiftRowsByDate = new Map<string, Map<string, Set<string>>>();
  const restDayAssignmentsByDate = new Map<string, Set<string>>();
  const poolCliniciansByKey = new Map<string, Set<string>>();
  const poolCliniciansByDate = new Map<string, Set<string>>();

  for (const [key, list] of assignmentMap.entries()) {
    const [rowId, dateISO] = key.split("__");
    if (!dateISO) continue;
    if (rowId === FREE_POOL_ID || rowId === VACATION_POOL_ID) continue;
    const rowKind =
      rowKindById.get(rowId) ?? (rowId.startsWith("pool-") ? "pool" : "class");

    const vacationSet = vacationByDate.get(dateISO);
    const filtered = list.filter((item) => !vacationSet || !vacationSet.has(item.clinicianId));
    if (filtered.length === 0) continue;
    next.set(key, [...filtered]);
    if (rowKind === "pool") {
      const poolSet = poolCliniciansByKey.get(key) ?? new Set<string>();
      for (const item of filtered) {
        poolSet.add(item.clinicianId);
        const dateSet = poolCliniciansByDate.get(dateISO) ?? new Set<string>();
        dateSet.add(item.clinicianId);
        poolCliniciansByDate.set(dateISO, dateSet);
      }
      poolCliniciansByKey.set(key, poolSet);
      if (rowId === REST_DAY_POOL_ID) {
        const restSet = restDayAssignmentsByDate.get(dateISO) ?? new Set<string>();
        for (const item of filtered) {
          restSet.add(item.clinicianId);
        }
        restDayAssignmentsByDate.set(dateISO, restSet);
      }
    }

    if (rowKind !== "class") continue;
    let dayAssignments = assignedByDate.get(dateISO);
    if (!dayAssignments) {
      dayAssignments = new Map();
      assignedByDate.set(dateISO, dayAssignments);
    }
    let dayShiftRows = assignedShiftRowsByDate.get(dateISO);
    if (!dayShiftRows) {
      dayShiftRows = new Map();
      assignedShiftRowsByDate.set(dateISO, dayShiftRows);
    }
    let assignedSet = assignedCliniciansByDate.get(dateISO);
    if (!assignedSet) {
      assignedSet = new Set();
      assignedCliniciansByDate.set(dateISO, assignedSet);
    }
    let unknownSet = unknownIntervalByDate.get(dateISO);
    if (!unknownSet) {
      unknownSet = new Set();
      unknownIntervalByDate.set(dateISO, unknownSet);
    }
    for (const item of filtered) {
      assignedSet.add(item.clinicianId);
      const entry = dayAssignments.get(item.clinicianId) ?? [];
      const interval = shiftIntervalsByRowId.get(rowId);
      if (interval) entry.push(interval);
      else unknownSet.add(item.clinicianId);
      dayAssignments.set(item.clinicianId, entry);
      const assignedRows = dayShiftRows.get(item.clinicianId) ?? new Set<string>();
      assignedRows.add(rowId);
      dayShiftRows.set(item.clinicianId, assignedRows);
    }
  }

  for (const [key, list] of next.entries()) {
    const [rowId, dateISO] = key.split("__");
    if (!rowId || !dateISO) continue;
    const rowKind =
      rowKindById.get(rowId) ?? (rowId.startsWith("pool-") ? "pool" : "class");
    if (rowKind !== "pool") continue;
    const assignedSet = assignedCliniciansByDate.get(dateISO);
    if (!assignedSet || assignedSet.size === 0) continue;
    const filtered = list.filter((item) => !assignedSet.has(item.clinicianId));
    if (filtered.length === 0) {
      next.delete(key);
      continue;
    }
    if (filtered.length !== list.length) {
      next.set(key, filtered);
    }
  }
  poolCliniciansByKey.clear();
  poolCliniciansByDate.clear();
  for (const [key, list] of next.entries()) {
    const [rowId, dateISO] = key.split("__");
    if (!rowId || !dateISO) continue;
    const rowKind =
      rowKindById.get(rowId) ?? (rowId.startsWith("pool-") ? "pool" : "class");
    if (rowKind !== "pool") continue;
    const poolSet = poolCliniciansByKey.get(key) ?? new Set<string>();
    for (const item of list) {
      poolSet.add(item.clinicianId);
      const dateSet = poolCliniciansByDate.get(dateISO) ?? new Set<string>();
      dateSet.add(item.clinicianId);
      poolCliniciansByDate.set(dateISO, dateSet);
    }
    poolCliniciansByKey.set(key, poolSet);
  }

  const offByDate = new Map<string, Set<string>>();
  for (const [dateISO, cliniciansOff] of restDayAssignmentsByDate.entries()) {
    const offSet = offByDate.get(dateISO) ?? new Set<string>();
    cliniciansOff.forEach((clinicianId) => offSet.add(clinicianId));
    offByDate.set(dateISO, offSet);
  }
  if (
    solverSettings.onCallRestEnabled &&
    onCallShiftRowIds.size > 0 &&
    (restDaysBefore > 0 || restDaysAfter > 0)
  ) {
    const shiftDateISO = (dateISO: string, delta: number) =>
      toISODate(addDays(new Date(`${dateISO}T00:00:00`), delta));
    for (const [dateISO, clinicianMap] of assignedShiftRowsByDate.entries()) {
      for (const [clinicianId, assignedRows] of clinicianMap.entries()) {
        const hasOnCall = Array.from(assignedRows).some((rowId) =>
          onCallShiftRowIds.has(rowId),
        );
        if (!hasOnCall) continue;
        for (let offset = 1; offset <= restDaysBefore; offset += 1) {
          const targetISO = shiftDateISO(dateISO, -offset);
          if (!displayDateSet.has(targetISO)) continue;
          const offSet = offByDate.get(targetISO) ?? new Set<string>();
          offSet.add(clinicianId);
          offByDate.set(targetISO, offSet);
        }
        for (let offset = 1; offset <= restDaysAfter; offset += 1) {
          const targetISO = shiftDateISO(dateISO, offset);
          if (!displayDateSet.has(targetISO)) continue;
          const offSet = offByDate.get(targetISO) ?? new Set<string>();
          offSet.add(clinicianId);
          offByDate.set(targetISO, offSet);
        }
      }
    }
  }

  if (offByDate.size > 0) {
    for (const [key, list] of next.entries()) {
      const [rowId, dateISO] = key.split("__");
      if (!rowId || !dateISO) continue;
      const rowKind =
        rowKindById.get(rowId) ?? (rowId.startsWith("pool-") ? "pool" : "class");
      if (rowKind !== "pool") continue;
      const offSet = offByDate.get(dateISO);
      if (!offSet || offSet.size === 0) continue;
      if (rowId === REST_DAY_POOL_ID || rowId === VACATION_POOL_ID) continue;
      const filtered = list.filter((item) => !offSet.has(item.clinicianId));
      if (filtered.length !== list.length) {
        const restKey = `${REST_DAY_POOL_ID}__${dateISO}`;
        const restList = next.get(restKey) ?? [];
        const restSet = new Set(restList.map((item) => item.clinicianId));
        for (const item of list) {
          if (!offSet.has(item.clinicianId)) continue;
          if (restSet.has(item.clinicianId)) continue;
          restList.push({
            ...item,
            id: `pool-${REST_DAY_POOL_ID}-${item.clinicianId}-${dateISO}`,
            rowId: REST_DAY_POOL_ID,
          });
          restSet.add(item.clinicianId);
        }
        if (restList.length > 0) {
          next.set(restKey, restList);
        }
      }
      if (filtered.length === 0) {
        next.delete(key);
      } else if (filtered.length !== list.length) {
        next.set(key, filtered);
      }
    }
  }

  const columnIntervalsByDayType = (() => {
    const map = new Map<string, { interval: TimeRange | null; mixed: boolean }>();
    for (const row of scheduleRows) {
      if (row.kind !== "class") continue;
      if (!row.dayType || !row.colBandOrder) continue;
      const interval = shiftIntervalsByRowId.get(row.id);
      if (!interval) continue;
      const key = `${row.dayType}-${row.colBandOrder}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { interval, mixed: false });
        continue;
      }
      if (!existing.interval) continue;
      if (
        existing.interval.start !== interval.start ||
        existing.interval.end !== interval.end
      ) {
        map.set(key, { interval: existing.interval, mixed: true });
      }
    }
    return map;
  })();

  const getColumnIntervalsForDayType = (dayType: string) => {
    const entries: Array<{ colOrder: number; interval: TimeRange }> = [];
    let mixed = false;
    for (const [key, meta] of columnIntervalsByDayType.entries()) {
      const [keyDayType, keyColOrder] = key.split("-");
      if (keyDayType !== dayType) continue;
      const colOrder = Number(keyColOrder);
      if (!Number.isFinite(colOrder)) continue;
      if (meta.mixed || !meta.interval) {
        mixed = true;
      } else {
        entries.push({ colOrder, interval: meta.interval });
      }
    }
    entries.sort((a, b) => a.colOrder - b.colOrder);
    return { intervals: entries.map((entry) => entry.interval), mixed };
  };

  for (const date of displayDays) {
    const dateISO = toISODate(date);
    const dayType = getDayType(dateISO, holidayDates);
    const assigned = assignedByDate.get(dateISO) ?? new Map();
    const assignedSet = assignedCliniciansByDate.get(dateISO) ?? new Set<string>();
    const unknownSet = unknownIntervalByDate.get(dateISO) ?? new Set<string>();
    const vacationSet = vacationByDate.get(dateISO) ?? new Set<string>();
    const offSet = offByDate.get(dateISO) ?? new Set<string>();
    for (const clinician of clinicians) {
      const inVacation = vacationSet.has(clinician.id);
      const isOff = offSet.has(clinician.id);
      const offPoolId = hasRestDayPoolRow
        ? REST_DAY_POOL_ID
        : hasManualPoolRow
          ? MANUAL_POOL_ID
          : FREE_POOL_ID;
      const poolRowId = inVacation ? VACATION_POOL_ID : isOff ? offPoolId : FREE_POOL_ID;
      const key = `${poolRowId}__${dateISO}`;
      const poolDateSet = poolCliniciansByDate.get(dateISO);
      if (!inVacation && poolDateSet?.has(clinician.id)) continue;
      if (!inVacation) {
        const hasAnyAssignment = assignedSet.has(clinician.id);
        const clinicianAssignments = assigned.get(clinician.id);
        const hasAssignments = Boolean(clinicianAssignments?.length);
        const dayIntervals =
          shiftIntervalsByDayType.get(dayType) ?? allShiftIntervals;
        if (!solverSettings.allowMultipleShiftsPerDay && hasAnyAssignment) continue;
        if (
          solverSettings.allowMultipleShiftsPerDay &&
          hasAnyAssignment &&
          (unknownSet.has(clinician.id) ||
            !hasFreeShift(clinicianAssignments ?? [], dayIntervals))
        ) {
          continue;
        }
        if (
          solverSettings.allowMultipleShiftsPerDay &&
          hasAssignments &&
          !unknownSet.has(clinician.id)
        ) {
          const { intervals, mixed } = getColumnIntervalsForDayType(dayType);
          if (!mixed && intervals.length > 0) {
            const coversAll = intervals.every((interval) =>
              (clinicianAssignments ?? []).some((assignedInterval: TimeRange) =>
                intervalsOverlap(interval, assignedInterval),
              ),
            );
            if (coversAll) continue;
          }
        }
      }

      const existingPoolSet = poolCliniciansByKey.get(key);
      if (existingPoolSet?.has(clinician.id)) continue;
      const item: RenderedAssignment = {
        id: `pool-${poolRowId}-${clinician.id}-${dateISO}`,
        rowId: poolRowId,
        dateISO,
        clinicianId: clinician.id,
      };
      if (!inVacation && !isOff) {
        const clinicianAssignments = assigned.get(clinician.id);
        const segments = buildAvailabilitySegments(clinicianAssignments ?? [], daySpan);
        if (segments.length > 0 && (clinicianAssignments?.length ?? 0) > 0) {
          item.availabilitySegments = segments;
        }
      }
      const existing = next.get(key);
      if (existing) existing.push(item);
      else next.set(key, [item]);
      const poolSet = poolCliniciansByKey.get(key) ?? new Set<string>();
      poolSet.add(clinician.id);
      poolCliniciansByKey.set(key, poolSet);
    }
  }

  return next;
}
