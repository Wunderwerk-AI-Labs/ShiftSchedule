import type {
  AppState,
  Location,
  MinSlots,
  SubShift,
  WorkplaceRow,
} from "../api/client";

export const SHIFT_ROW_SEPARATOR = "::";
export const DEFAULT_LOCATION_ID = "loc-default";
export const DEFAULT_LOCATION_NAME = "Default";
const DEFAULT_SUB_SHIFT_MINUTES = 8 * 60;
const DEFAULT_SUB_SHIFT_START_MINUTES = 8 * 60;

export type ScheduleRow = WorkplaceRow & {
  parentId?: string;
  parentName?: string;
  subShiftId?: string;
  subShiftName?: string;
  subShiftOrder?: number;
  subShiftStartTime?: string;
  subShiftEndTime?: string;
  subShiftEndDayOffset?: number;
  locationName?: string;
  isSubShiftRow?: boolean;
};

export function buildShiftRowId(classId: string, subShiftId: string) {
  return `${classId}${SHIFT_ROW_SEPARATOR}${subShiftId}`;
}

export function getAvailableSubShiftId(usedIds: Set<string>, order: number): string {
  const preferred = `s${order}`;
  if (!usedIds.has(preferred)) return preferred;
  const fallback = ["s1", "s2", "s3"].find((id) => !usedIds.has(id));
  if (fallback) return fallback;
  let suffix = 2;
  let candidate = `${preferred}-${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${preferred}-${suffix}`;
  }
  return candidate;
}

export function parseShiftRowId(rowId: string): { classId: string; subShiftId?: string } {
  const [classId, subShiftId] = rowId.split(SHIFT_ROW_SEPARATOR);
  if (!subShiftId || classId === rowId) {
    return { classId: rowId };
  }
  return { classId, subShiftId };
}

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

function formatMinutes(totalMinutes: number): string {
  const clamped = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hours = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function normalizeSubShifts(subShifts?: SubShift[]): SubShift[] {
  const source = subShifts?.length
    ? subShifts
    : [
        {
          id: "s1",
          name: "Shift 1",
          order: 1,
          startTime: "08:00",
          endTime: "16:00",
          endDayOffset: 0,
          hours: undefined,
        },
      ];
  const usedOrders = new Set<number>();
  const normalized: SubShift[] = [];
  for (const item of source) {
    const rawOrder = item.order;
    let order =
      typeof rawOrder === "number" && rawOrder >= 1 && rawOrder <= 3 ? rawOrder : null;
    if (!order || usedOrders.has(order)) {
      const fallback = [1, 2, 3].find((candidate) => !usedOrders.has(candidate));
      order = fallback ?? 1;
    }
    if (order > 3) continue;
    usedOrders.add(order);
    const id = item.id?.trim() || `s${order}`;
    const name = item.name?.trim() || `Shift ${order}`;
    const rawStart = parseTimeToMinutes(item.startTime);
    const rawEnd = parseTimeToMinutes(item.endTime);
    const rawOffset =
      typeof item.endDayOffset === "number" && Number.isFinite(item.endDayOffset)
        ? Math.max(0, Math.min(3, Math.floor(item.endDayOffset)))
        : 0;
    const legacyHours =
      typeof item.hours === "number" && Number.isFinite(item.hours)
        ? Math.max(0, item.hours)
        : null;
    const fallbackStart =
      DEFAULT_SUB_SHIFT_START_MINUTES + (order - 1) * DEFAULT_SUB_SHIFT_MINUTES;
    const startMinutes = rawStart ?? fallbackStart;
    const durationMinutes = legacyHours !== null ? legacyHours * 60 : DEFAULT_SUB_SHIFT_MINUTES;
    const endMinutes = rawEnd ?? startMinutes + durationMinutes;
    normalized.push({
      id,
      name,
      order: order as 1 | 2 | 3,
      startTime: formatMinutes(startMinutes),
      endTime: formatMinutes(endMinutes),
      endDayOffset: rawOffset,
    });
  }
  if (!normalized.length) {
    normalized.push({
      id: "s1",
      name: "Shift 1",
      order: 1,
      startTime: "08:00",
      endTime: "16:00",
      endDayOffset: 0,
    });
  }
  return normalized.sort((a, b) => a.order - b.order).slice(0, 3);
}

export function ensureLocations(locations?: Location[]): Location[] {
  const next = new Map<string, Location>();
  for (const location of locations ?? []) {
    if (!location?.id) continue;
    next.set(location.id, location);
  }
  if (!next.has(DEFAULT_LOCATION_ID)) {
    next.set(DEFAULT_LOCATION_ID, {
      id: DEFAULT_LOCATION_ID,
      name: DEFAULT_LOCATION_NAME,
    });
  }
  return Array.from(next.values());
}

export function normalizeAppState(state: AppState): { state: AppState; changed: boolean } {
  let changed = false;
  const locationsEnabled = state.locationsEnabled !== false;
  if (state.locationsEnabled !== locationsEnabled) {
    changed = true;
  }
  const locations = ensureLocations(state.locations);
  if (!state.locations || state.locations.length !== locations.length) {
    changed = true;
  }
  const locationIdSet = new Set(locations.map((loc) => loc.id));

  const rows = (state.rows ?? []).map((row) => {
    if (row.kind !== "class") return row;
    const normalizedShifts = normalizeSubShifts(row.subShifts);
    const usedSubShiftIds = new Set<string>();
    const subShifts = normalizedShifts.map((shift) => {
      const baseId = shift.id?.trim() || `s${shift.order}`;
      if (!usedSubShiftIds.has(baseId)) {
        usedSubShiftIds.add(baseId);
        return baseId === shift.id ? shift : { ...shift, id: baseId };
      }
      const nextId = getAvailableSubShiftId(usedSubShiftIds, shift.order);
      usedSubShiftIds.add(nextId);
      changed = true;
      return { ...shift, id: nextId };
    });
    let locationId =
      row.locationId && locationIdSet.has(row.locationId)
        ? row.locationId
        : DEFAULT_LOCATION_ID;
    if (!locationsEnabled && locationId !== DEFAULT_LOCATION_ID) {
      locationId = DEFAULT_LOCATION_ID;
      changed = true;
    }
    if (
      row.locationId !== locationId ||
      !row.subShifts ||
      row.subShifts.length !== subShifts.length
    ) {
      changed = true;
    }
    return { ...row, locationId, subShifts };
  });

  const classRows = rows.filter((row) => row.kind === "class");
  const classRowIds = new Set(classRows.map((row) => row.id));
  const subShiftIdsByClass = new Map(
    classRows.map((row) => [
      row.id,
      new Set((row.subShifts ?? []).map((shift) => shift.id)),
    ]),
  );

  const assignments = (state.assignments ?? []).map((assignment) => {
    if (classRowIds.has(assignment.rowId) && !assignment.rowId.includes(SHIFT_ROW_SEPARATOR)) {
      changed = true;
      return {
        ...assignment,
        rowId: buildShiftRowId(assignment.rowId, "s1"),
      };
    }
    return assignment;
  });

  const minSlotsByRowId: Record<string, MinSlots> = {
    ...(state.minSlotsByRowId ?? {}),
  };
  for (const row of classRows) {
    const base = minSlotsByRowId[row.id];
    if (base) {
      delete minSlotsByRowId[row.id];
      changed = true;
    }
    for (const shift of row.subShifts ?? []) {
      const shiftRowId = buildShiftRowId(row.id, shift.id);
      if (!minSlotsByRowId[shiftRowId]) {
        minSlotsByRowId[shiftRowId] =
          shift.id === "s1" && base ? base : { weekday: 0, weekend: 0 };
        changed = true;
      }
    }
  }
  for (const key of Object.keys(minSlotsByRowId)) {
    if (!key.includes(SHIFT_ROW_SEPARATOR)) continue;
    const { classId, subShiftId } = parseShiftRowId(key);
    const valid = subShiftId && subShiftIdsByClass.get(classId)?.has(subShiftId);
    if (!valid) {
      delete minSlotsByRowId[key];
      changed = true;
    }
  }

  const overrides = state.slotOverridesByKey ?? {};
  const slotOverridesByKey: Record<string, number> = {};
  for (const [key, value] of Object.entries(overrides)) {
    const [rowId, dateISO] = key.split("__");
    if (!rowId || !dateISO) continue;
    let nextRowId = rowId;
    if (classRowIds.has(rowId) && !rowId.includes(SHIFT_ROW_SEPARATOR)) {
      nextRowId = buildShiftRowId(rowId, "s1");
      changed = true;
    } else if (rowId.includes(SHIFT_ROW_SEPARATOR)) {
      const { classId, subShiftId } = parseShiftRowId(rowId);
      const classShiftIds = subShiftIdsByClass.get(classId);
      if (!subShiftId || !classShiftIds) {
        changed = true;
        continue;
      }
      if (!classShiftIds.has(subShiftId)) {
        const fallback = Array.from(classShiftIds)[0];
        if (!fallback) {
          changed = true;
          continue;
        }
        nextRowId = buildShiftRowId(classId, fallback);
        changed = true;
      }
    }
    const nextKey = `${nextRowId}__${dateISO}`;
    slotOverridesByKey[nextKey] = (slotOverridesByKey[nextKey] ?? 0) + value;
  }
  if (Object.keys(overrides).length !== Object.keys(slotOverridesByKey).length) {
    changed = true;
  }

  return {
    state: {
      ...state,
      locationsEnabled,
      locations,
      rows,
      assignments,
      minSlotsByRowId,
      slotOverridesByKey,
    },
    changed,
  };
}

export function buildScheduleRows(
  rows: WorkplaceRow[],
  locations: Location[],
  locationsEnabled = true,
): ScheduleRow[] {
  const locationNameById = new Map(locations.map((loc) => [loc.id, loc.name]));
  const scheduleRows: ScheduleRow[] = [];
  for (const row of rows) {
    if (row.kind !== "class") {
      scheduleRows.push(row);
      continue;
    }
    const subShifts = normalizeSubShifts(row.subShifts);
    const locationName = locationsEnabled
      ? (row.locationId && locationNameById.get(row.locationId)) ??
        locationNameById.get(DEFAULT_LOCATION_ID)
      : undefined;
    for (const shift of subShifts) {
      scheduleRows.push({
        ...row,
        id: buildShiftRowId(row.id, shift.id),
        parentId: row.id,
        parentName: row.name,
        subShiftId: shift.id,
        subShiftName: shift.name,
        subShiftOrder: shift.order,
        subShiftStartTime: shift.startTime,
        subShiftEndTime: shift.endTime,
        subShiftEndDayOffset: shift.endDayOffset,
        locationName,
        isSubShiftRow: true,
      });
    }
  }
  return scheduleRows;
}
