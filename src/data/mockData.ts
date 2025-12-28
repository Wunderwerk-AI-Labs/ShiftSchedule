import { addDays, startOfWeek, toISODate } from "../lib/date";

export type WorkplaceRow = {
  id: string;
  name: string;
  kind: "class" | "pool";
  dotColorClass: string;
  locationId?: string;
  subShifts?: SubShift[];
};

export type Location = {
  id: string;
  name: string;
};

export type SubShift = {
  id: string;
  name: string;
  order: 1 | 2 | 3;
  startTime: string;
  endTime: string;
  endDayOffset?: number;
  hours?: number;
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
  workingHoursPerWeek?: number;
};

export const locations: Location[] = [{ id: "loc-default", name: "Default" }];
export const locationsEnabled = true;

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
  {
    id: "mri",
    name: "MRI",
    kind: "class",
    dotColorClass: "bg-violet-500",
    locationId: "loc-default",
    subShifts: [
      {
        id: "s1",
        name: "Shift 1",
        order: 1,
        startTime: "08:00",
        endTime: "16:00",
        endDayOffset: 0,
      },
    ],
  },
  {
    id: "ct",
    name: "CT",
    kind: "class",
    dotColorClass: "bg-cyan-500",
    locationId: "loc-default",
    subShifts: [
      {
        id: "s1",
        name: "Shift 1",
        order: 1,
        startTime: "08:00",
        endTime: "16:00",
        endDayOffset: 0,
      },
    ],
  },
  {
    id: "sonography",
    name: "Sonography",
    kind: "class",
    dotColorClass: "bg-fuchsia-500",
    locationId: "loc-default",
    subShifts: [
      {
        id: "s1",
        name: "Shift 1",
        order: 1,
        startTime: "08:00",
        endTime: "16:00",
        endDayOffset: 0,
      },
    ],
  },
  {
    id: "conventional",
    name: "Conventional",
    kind: "class",
    dotColorClass: "bg-amber-400",
    locationId: "loc-default",
    subShifts: [
      {
        id: "s1",
        name: "Shift 1",
        order: 1,
        startTime: "08:00",
        endTime: "16:00",
        endDayOffset: 0,
      },
    ],
  },
  {
    id: "on-call",
    name: "On Call",
    kind: "class",
    dotColorClass: "bg-blue-600",
    locationId: "loc-default",
    subShifts: [
      {
        id: "s1",
        name: "Shift 1",
        order: 1,
        startTime: "08:00",
        endTime: "16:00",
        endDayOffset: 0,
      },
    ],
  },
];

export const defaultMinSlotsByRowId: Record<
  string,
  { weekday: number; weekend: number }
> = {
  "mri::s1": { weekday: 2, weekend: 1 },
  "ct::s1": { weekday: 2, weekend: 1 },
  "sonography::s1": { weekday: 2, weekend: 1 },
  "conventional::s1": { weekday: 2, weekend: 1 },
  "on-call::s1": { weekday: 1, weekend: 1 },
};

export const clinicians: Clinician[] = [
  {
    id: "sarah-chen",
    name: "Sarah Chen",
    qualifiedClassIds: ["mri", "sonography", "conventional"],
    preferredClassIds: ["sonography", "mri"],
    vacations: [{ id: "vac-1", startISO: "2025-12-18", endISO: "2025-12-20" }],
    workingHoursPerWeek: 38,
  },
  {
    id: "james-wilson",
    name: "James Wilson",
    qualifiedClassIds: ["mri", "on-call"],
    preferredClassIds: ["on-call"],
    vacations: [],
    workingHoursPerWeek: 40,
  },
  {
    id: "michael-ross",
    name: "Michael Ross",
    qualifiedClassIds: ["ct", "conventional", "on-call"],
    preferredClassIds: ["ct"],
    vacations: [],
    workingHoursPerWeek: 36,
  },
  {
    id: "emily-brooks",
    name: "Emily Brooks",
    qualifiedClassIds: ["sonography", "conventional"],
    preferredClassIds: ["conventional"],
    vacations: [],
    workingHoursPerWeek: 32,
  },
  {
    id: "david-kim",
    name: "David Kim",
    qualifiedClassIds: ["ct", "sonography"],
    preferredClassIds: ["ct"],
    vacations: [],
    workingHoursPerWeek: 40,
  },
  {
    id: "ava-patel",
    name: "Ava Patel",
    qualifiedClassIds: ["ct", "mri"],
    preferredClassIds: [],
    vacations: [],
    workingHoursPerWeek: 28,
  },
  {
    id: "lena-park",
    name: "Lena Park",
    qualifiedClassIds: ["conventional"],
    preferredClassIds: ["conventional"],
    vacations: [],
    workingHoursPerWeek: 30,
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
