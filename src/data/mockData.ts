import { addDays, startOfWeek, toISODate } from "../lib/date";

export type WorkplaceRow = {
  id: string;
  name: string;
  kind: "class" | "pool";
  dotColorClass: string;
};

export type Assignment = {
  id: string;
  rowId: string;
  dateISO: string; // YYYY-MM-DD
  clinicianId: string;
};

export type VacationPeriod = {
  id: string;
  startISO: string;
  endISO: string;
};

export type Clinician = {
  id: string;
  name: string;
  qualifiedClassIds: string[];
  preferredClassIds: string[];
  vacations: VacationPeriod[];
};

export const workplaceRows: WorkplaceRow[] = [
  {
    id: "pool-not-allocated",
    name: "Distribution Pool",
    kind: "pool",
    dotColorClass: "bg-slate-400",
  },
  {
    id: "pool-manual",
    name: "Reserve Pool",
    kind: "pool",
    dotColorClass: "bg-slate-300",
  },
  { id: "pool-vacation", name: "Vacation", kind: "pool", dotColorClass: "bg-emerald-500" },
  { id: "mri", name: "MRI", kind: "class", dotColorClass: "bg-violet-500" },
  { id: "ct", name: "CT", kind: "class", dotColorClass: "bg-cyan-500" },
  { id: "sonography", name: "Sonography", kind: "class", dotColorClass: "bg-fuchsia-500" },
  { id: "conventional", name: "Conventional", kind: "class", dotColorClass: "bg-amber-400" },
  { id: "on-call", name: "On Call", kind: "class", dotColorClass: "bg-blue-600" },
];

export const defaultMinSlotsByRowId: Record<
  string,
  { weekday: number; weekend: number }
> = {
  mri: { weekday: 2, weekend: 1 },
  ct: { weekday: 2, weekend: 1 },
  sonography: { weekday: 2, weekend: 1 },
  conventional: { weekday: 2, weekend: 1 },
  "on-call": { weekday: 1, weekend: 1 },
};

export const clinicians: Clinician[] = [
  {
    id: "sarah-chen",
    name: "Sarah Chen",
    qualifiedClassIds: ["mri", "sonography", "conventional"],
    preferredClassIds: ["sonography", "mri"],
    vacations: [{ id: "vac-1", startISO: "2025-12-18", endISO: "2025-12-20" }],
  },
  {
    id: "james-wilson",
    name: "James Wilson",
    qualifiedClassIds: ["mri", "on-call"],
    preferredClassIds: ["on-call"],
    vacations: [],
  },
  {
    id: "michael-ross",
    name: "Michael Ross",
    qualifiedClassIds: ["ct", "conventional", "on-call"],
    preferredClassIds: ["ct"],
    vacations: [],
  },
  {
    id: "emily-brooks",
    name: "Emily Brooks",
    qualifiedClassIds: ["sonography", "conventional"],
    preferredClassIds: ["conventional"],
    vacations: [],
  },
  {
    id: "david-kim",
    name: "David Kim",
    qualifiedClassIds: ["ct", "sonography"],
    preferredClassIds: ["ct"],
    vacations: [],
  },
  {
    id: "ava-patel",
    name: "Ava Patel",
    qualifiedClassIds: ["ct", "mri"],
    preferredClassIds: [],
    vacations: [],
  },
  {
    id: "lena-park",
    name: "Lena Park",
    qualifiedClassIds: ["conventional"],
    preferredClassIds: ["conventional"],
    vacations: [],
  },
];

const seedWeekStart = startOfWeek(new Date("2025-12-21T12:00:00"), 1);

function isoAt(dayOffset: number) {
  return toISODate(addDays(seedWeekStart, dayOffset));
}

export const assignments: Assignment[] = [];

export function buildAssignmentMap(items: Assignment[]) {
  const map = new Map<string, Assignment[]>();
  for (const a of items) {
    const key = `${a.rowId}__${a.dateISO}`;
    const existing = map.get(key);
    if (existing) existing.push(a);
    else map.set(key, [a]);
  }
  return map;
}
