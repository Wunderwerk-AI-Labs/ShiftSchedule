import { useEffect, useMemo, useState } from "react";
import ScheduleGrid from "../components/schedule/ScheduleGrid";
import { getState, type Holiday } from "../api/client";
import {
  Assignment,
  buildAssignmentMap,
  Clinician,
  defaultMinSlotsByRowId,
  WorkplaceRow,
} from "../data/mockData";
import { addDays, startOfWeek, formatRangeLabel } from "../lib/date";
import { buildRenderedAssignmentMap } from "../lib/schedule";
import { cx } from "../lib/classNames";

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
        if (state.rows?.length) {
          const classRows = state.rows.filter((row) => row.kind === "class");
          const poolRows = state.rows.filter((row) => row.kind === "pool");
          setRows([...classRows, ...poolRows]);
        }
        if (state.clinicians?.length) {
          setClinicians(
            state.clinicians.map((clinician) => ({
              ...clinician,
              preferredClassIds: [...clinician.qualifiedClassIds],
            })),
          );
        }
        if (state.assignments) {
          setAssignmentMap(buildAssignmentMap(state.assignments));
        }
        if (state.minSlotsByRowId) setMinSlotsByRowId(state.minSlotsByRowId);
        if (state.slotOverridesByKey) setSlotOverridesByKey(state.slotOverridesByKey);
        if (state.holidays) setHolidays(state.holidays);
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
        rows={rows}
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
          const clinician = clinicians.find((item) => item.id === clinicianId);
          return clinician ? clinician.qualifiedClassIds.includes(rowId) : false;
        }}
        slotOverridesByKey={slotOverridesByKey}
        onRemoveEmptySlot={() => {}}
        onMoveWithinDay={() => {}}
        onCellClick={() => {}}
      />
    </div>
  );
}
