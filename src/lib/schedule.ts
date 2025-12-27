import { addDays, toISODate } from "./date";
import type { Assignment, Clinician } from "../data/mockData";

export const FREE_POOL_ID = "pool-not-allocated";
export const VACATION_POOL_ID = "pool-vacation";

export function buildRenderedAssignmentMap(
  assignmentMap: Map<string, Assignment[]>,
  clinicians: Clinician[],
  displayDays: Date[],
) {
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

  const next = new Map<string, Assignment[]>();
  const assignedByDate = new Map<string, Set<string>>();

  for (const [key, list] of assignmentMap.entries()) {
    const [rowId, dateISO] = key.split("__");
    if (!dateISO) continue;
    if (rowId === FREE_POOL_ID || rowId === VACATION_POOL_ID) continue;

    const vacationSet = vacationByDate.get(dateISO);
    const filtered = list.filter((item) => !vacationSet || !vacationSet.has(item.clinicianId));
    if (filtered.length === 0) continue;
    next.set(key, [...filtered]);

    let set = assignedByDate.get(dateISO);
    if (!set) {
      set = new Set();
      assignedByDate.set(dateISO, set);
    }
    for (const item of filtered) set.add(item.clinicianId);
  }

  for (const date of displayDays) {
    const dateISO = toISODate(date);
    const assigned = assignedByDate.get(dateISO) ?? new Set<string>();
    const vacationSet = vacationByDate.get(dateISO) ?? new Set<string>();
    for (const clinician of clinicians) {
      if (assigned.has(clinician.id)) continue;
      const inVacation = vacationSet.has(clinician.id);
      const poolRowId = inVacation ? VACATION_POOL_ID : FREE_POOL_ID;
      const key = `${poolRowId}__${dateISO}`;
      const item: Assignment = {
        id: `pool-${poolRowId}-${clinician.id}-${dateISO}`,
        rowId: poolRowId,
        dateISO,
        clinicianId: clinician.id,
      };
      const existing = next.get(key);
      if (existing) existing.push(item);
      else next.set(key, [item]);
    }
  }

  return next;
}
