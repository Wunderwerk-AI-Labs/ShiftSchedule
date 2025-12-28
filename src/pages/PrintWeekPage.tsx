import { useEffect, useMemo, useState } from "react";
import ScheduleGrid from "../components/schedule/ScheduleGrid";
import { getState, type Holiday } from "../api/client";
import {
  Assignment,
  buildAssignmentMap,
  Clinician,
  defaultMinSlotsByRowId,
  WorkplaceRow,
  locations as defaultLocations,
} from "../data/mockData";
import { addDays, startOfWeek, formatRangeLabel } from "../lib/date";
import { buildRenderedAssignmentMap } from "../lib/schedule";
import { cx } from "../lib/classNames";
import { buildScheduleRows, normalizeAppState } from "../lib/shiftRows";

type PrintWeekPageProps = {
  theme: "light" | "dark";
};

const parseISODate = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export default function PrintWeekPage({ theme }: PrintWeekPageProps) {
  const [rows, setRows] = useState<WorkplaceRow[]>([]);
  const [locations, setLocations] = useState(defaultLocations);
  const [locationsEnabled, setLocationsEnabled] = useState(true);
  const [clinicians, setClinicians] = useState<Clinician[]>([]);
  const [assignmentMap, setAssignmentMap] = useState<Map<string, Assignment[]>>(new Map());
  const [minSlotsByRowId, setMinSlotsByRowId] = useState(defaultMinSlotsByRowId);
  const [slotOverridesByKey, setSlotOverridesByKey] = useState<Record<string, number>>({});
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const startParam =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("start") : null;
  const anchorDate = useMemo(() => parseISODate(startParam) ?? new Date(), [startParam]);
  const weekStart = useMemo(() => startOfWeek(anchorDate, 1), [anchorDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekEndInclusive = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const holidayDates = useMemo(
    () => new Set(holidays.map((holiday) => holiday.dateISO)),
    [holidays],
  );
  const holidayNameByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const holiday of holidays) {
      const list = map.get(holiday.dateISO) ?? [];
      list.push(holiday.name);
      map.set(holiday.dateISO, list);
    }
    const record: Record<string, string> = {};
    for (const [dateISO, names] of map.entries()) {
      record[dateISO] = names.join(" · ");
    }
    return record;
  }, [holidays]);

  const poolsSeparatorId = useMemo(() => rows.find((row) => row.kind === "pool")?.id, [rows]);
  const scheduleRows = useMemo(
    () => buildScheduleRows(rows, locations, locationsEnabled),
    [rows, locations, locationsEnabled],
  );
  const rowById = useMemo(() => new Map(scheduleRows.map((row) => [row.id, row])), [scheduleRows]);

  const isWeekendOrHoliday = (dateISO: string) => {
    const date = new Date(`${dateISO}T00:00:00`);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    return isWeekend || holidayDates.has(dateISO);
  };

  const renderAssignmentMap = useMemo(
    () => buildRenderedAssignmentMap(assignmentMap, clinicians, weekDays),
    [assignmentMap, clinicians, weekDays],
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__PDF_READY__ = false;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    getState()
      .then((state) => {
        if (!alive) return;
        const { state: normalized } = normalizeAppState(state);
        if (normalized.locations?.length) setLocations(normalized.locations);
        setLocationsEnabled(normalized.locationsEnabled ?? true);
        if (normalized.rows?.length) setRows(normalized.rows);
        if (normalized.clinicians?.length) {
          setClinicians(
            normalized.clinicians.map((clinician) => ({
              ...clinician,
              preferredClassIds: [...clinician.qualifiedClassIds],
            })),
          );
        }
        if (normalized.assignments) {
          setAssignmentMap(buildAssignmentMap(normalized.assignments));
        }
        if (normalized.minSlotsByRowId) setMinSlotsByRowId(normalized.minSlotsByRowId);
        if (normalized.slotOverridesByKey) setSlotOverridesByKey(normalized.slotOverridesByKey);
        if (normalized.holidays) setHolidays(normalized.holidays);
      })
      .catch(() => {
        if (!alive) return;
        setError("Unable to load schedule data.");
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    if (typeof window === "undefined") return;
    const markReady = () => {
      window.__PDF_READY__ = true;
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(markReady);
    });
  }, [loading, rows, clinicians, assignmentMap, minSlotsByRowId, slotOverridesByKey]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white px-6 py-10 text-sm text-slate-500">
        Preparing PDF…
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white px-6 py-10 text-sm text-rose-600">
        {error}
      </div>
    );
  }

  return (
    <div className={cx("bg-white", theme === "dark" && "dark")}>
      <ScheduleGrid
        leftHeaderTitle=""
        weekDays={weekDays}
        rows={scheduleRows}
        assignmentMap={renderAssignmentMap}
        holidayDates={holidayDates}
        holidayNameByDate={holidayNameByDate}
        header={
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {formatRangeLabel(weekStart, weekEndInclusive)}
            </div>
          </div>
        }
        separatorBeforeRowIds={poolsSeparatorId ? [poolsSeparatorId] : []}
        minSlotsByRowId={minSlotsByRowId}
        getClinicianName={(id) => clinicians.find((c) => c.id === id)?.name ?? "Unknown"}
        getHasEligibleClasses={(id) => {
          const clinician = clinicians.find((item) => item.id === id);
          return clinician ? clinician.qualifiedClassIds.length > 0 : false;
        }}
        getIsQualified={(clinicianId, rowId) => {
          const scheduleRow = rowById.get(rowId);
          const classId =
            scheduleRow?.kind === "class"
              ? scheduleRow.parentId ?? scheduleRow.id
              : rowId;
          const clinician = clinicians.find((item) => item.id === clinicianId);
          return clinician ? clinician.qualifiedClassIds.includes(classId) : false;
        }}
        slotOverridesByKey={slotOverridesByKey}
        onRemoveEmptySlot={() => {}}
        onMoveWithinDay={() => {}}
        onCellClick={() => {}}
      />
    </div>
  );
}
