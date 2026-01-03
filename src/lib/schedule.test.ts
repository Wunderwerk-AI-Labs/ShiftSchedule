import { describe, expect, it } from "vitest";
import type { Assignment, Clinician } from "../api/client";
import {
  buildRenderedAssignmentMap,
  buildShiftInterval,
  formatTimeRangeLabel,
  intervalsOverlap,
  REST_DAY_POOL_ID,
  VACATION_POOL_ID,
} from "./schedule";
import type { ScheduleRow } from "./shiftRows";

const baseRow: ScheduleRow = {
  id: "row-1",
  name: "MRI",
  kind: "class",
  dotColorClass: "bg-slate-200",
  startTime: "08:00",
  endTime: "16:00",
  endDayOffset: 0,
};

describe("intervalsOverlap", () => {
  it("returns false when intervals only touch at the edge", () => {
    expect(intervalsOverlap({ start: 0, end: 60 }, { start: 60, end: 120 })).toBe(
      false,
    );
  });

  it("returns true when intervals overlap", () => {
    expect(intervalsOverlap({ start: 0, end: 90 }, { start: 60, end: 120 })).toBe(
      true,
    );
  });

  it("returns false when first interval is completely before second", () => {
    expect(intervalsOverlap({ start: 0, end: 30 }, { start: 60, end: 120 })).toBe(
      false,
    );
  });

  it("returns false when first interval is completely after second", () => {
    expect(intervalsOverlap({ start: 150, end: 180 }, { start: 60, end: 120 })).toBe(
      false,
    );
  });

  it("returns true when one interval contains the other", () => {
    expect(intervalsOverlap({ start: 0, end: 180 }, { start: 60, end: 120 })).toBe(
      true,
    );
  });
});

describe("buildShiftInterval", () => {
  it("builds an interval with day offset applied", () => {
    const row: ScheduleRow = {
      ...baseRow,
      endDayOffset: 1,
    };
    expect(buildShiftInterval(row)).toEqual({ start: 480, end: 2400 });
  });

  it("returns null when end time is not after start", () => {
    const row: ScheduleRow = {
      ...baseRow,
      endTime: "08:00",
    };
    expect(buildShiftInterval(row)).toBeNull();
  });

  it("ignores non-class rows", () => {
    const row: ScheduleRow = {
      id: "pool-row",
      name: "Pool",
      kind: "pool",
      dotColorClass: "bg-slate-200",
    };
    expect(buildShiftInterval(row)).toBeNull();
  });

  it("handles overnight shifts correctly", () => {
    const row: ScheduleRow = {
      ...baseRow,
      startTime: "22:00",
      endTime: "06:00",
      endDayOffset: 1,
    };
    const interval = buildShiftInterval(row);
    expect(interval).not.toBeNull();
    // 22:00 = 22*60 = 1320 minutes
    // 06:00 + 1 day = 6*60 + 24*60 = 360 + 1440 = 1800 minutes
    expect(interval?.start).toBe(1320);
    expect(interval?.end).toBe(1800);
  });

  it("clamps endDayOffset to valid range", () => {
    const row: ScheduleRow = {
      ...baseRow,
      endDayOffset: 10, // Should be clamped to 3
    };
    const interval = buildShiftInterval(row);
    expect(interval).not.toBeNull();
    // end = 16:00 + 3 days = 960 + 3*1440 = 960 + 4320 = 5280
    expect(interval?.end).toBe(5280);
  });
});

describe("formatTimeRangeLabel", () => {
  it("formats basic time range", () => {
    // 8:00 = 480 minutes, 16:00 = 960 minutes
    expect(formatTimeRangeLabel(480, 960)).toBe("08:00 - 16:00");
  });

  it("formats time range with day offset", () => {
    // 22:00 = 1320 minutes, 06:00 next day = 360 + 1440 = 1800 minutes
    expect(formatTimeRangeLabel(1320, 1800)).toBe("22:00 - 06:00 +1d");
  });
});

describe("buildRenderedAssignmentMap", () => {
  const makeClinicianWithVacation = (
    id: string,
    vacationStart?: string,
    vacationEnd?: string,
  ): Clinician => ({
    id,
    name: `Dr. ${id}`,
    qualifiedClassIds: [],
    preferredClassIds: [],
    vacations: vacationStart && vacationEnd
      ? [{ id: "v1", startISO: vacationStart, endISO: vacationEnd }]
      : [],
  });

  const scheduleRows: ScheduleRow[] = [
    {
      id: "slot-a",
      kind: "class",
      name: "MRI",
      dotColorClass: "bg-slate-200",
      sectionId: "mri",
    },
    {
      id: "pool-rest-day",
      kind: "pool",
      name: "Rest Day",
      dotColorClass: "bg-slate-200",
    },
    {
      id: "pool-vacation",
      kind: "pool",
      name: "Vacation",
      dotColorClass: "bg-emerald-500",
    },
  ];

  it("filters out assignments during vacation", () => {
    const clinicians = [makeClinicianWithVacation("clin-1", "2026-01-05", "2026-01-10")];
    const assignments: Assignment[] = [
      { id: "a1", rowId: "slot-a", dateISO: "2026-01-07", clinicianId: "clin-1" },
    ];
    const assignmentMap = new Map([["slot-a__2026-01-07", assignments]]);
    const displayDays = [new Date("2026-01-07")];

    const result = buildRenderedAssignmentMap(assignmentMap, clinicians, displayDays, {
      scheduleRows,
    });

    // Assignment should be filtered out due to vacation
    const slotAssignments = result.get("slot-a__2026-01-07");
    expect(slotAssignments?.length ?? 0).toBe(0);
  });

  it("preserves assignments outside vacation period", () => {
    const clinicians = [makeClinicianWithVacation("clin-1", "2026-01-10", "2026-01-15")];
    const assignments: Assignment[] = [
      { id: "a1", rowId: "slot-a", dateISO: "2026-01-07", clinicianId: "clin-1" },
    ];
    const assignmentMap = new Map([["slot-a__2026-01-07", assignments]]);
    const displayDays = [new Date("2026-01-07")];

    const result = buildRenderedAssignmentMap(assignmentMap, clinicians, displayDays, {
      scheduleRows,
    });

    const slotAssignments = result.get("slot-a__2026-01-07");
    expect(slotAssignments?.length).toBe(1);
    expect(slotAssignments?.[0].clinicianId).toBe("clin-1");
  });

  it("places vacation clinicians in vacation pool", () => {
    const clinicians = [makeClinicianWithVacation("clin-1", "2026-01-05", "2026-01-10")];
    const assignmentMap = new Map<string, Assignment[]>();
    const displayDays = [new Date("2026-01-07")];

    const result = buildRenderedAssignmentMap(assignmentMap, clinicians, displayDays, {
      scheduleRows,
    });

    const vacationAssignments = result.get(`${VACATION_POOL_ID}__2026-01-07`);
    expect(vacationAssignments).toBeDefined();
    expect(vacationAssignments?.some((a) => a.clinicianId === "clin-1")).toBe(true);
  });

  it("never references deprecated Distribution Pool", () => {
    const clinicians = [makeClinicianWithVacation("clin-1")];
    const assignmentMap = new Map<string, Assignment[]>();
    const displayDays = [new Date("2026-01-07")];

    const result = buildRenderedAssignmentMap(assignmentMap, clinicians, displayDays, {
      scheduleRows,
    });

    // No key should reference the deprecated pool
    for (const key of result.keys()) {
      expect(key).not.toContain("pool-not-allocated");
    }
  });

  it("preserves valid pool assignments from input", () => {
    // Test that pool assignments are preserved when passed in the assignmentMap
    const clinicians = [makeClinicianWithVacation("clin-1")];
    const assignmentMap = new Map<string, Assignment[]>([
      ["pool-rest-day__2026-01-07", [
        { id: "a1", rowId: "pool-rest-day", dateISO: "2026-01-07", clinicianId: "clin-1" },
      ]],
    ]);
    const displayDays = [new Date("2026-01-07")];

    const result = buildRenderedAssignmentMap(assignmentMap, clinicians, displayDays, {
      scheduleRows,
    });

    const poolAssignments = result.get(`${REST_DAY_POOL_ID}__2026-01-07`);
    expect(poolAssignments).toBeDefined();
    expect(poolAssignments?.some((a) => a.clinicianId === "clin-1")).toBe(true);
  });
});
