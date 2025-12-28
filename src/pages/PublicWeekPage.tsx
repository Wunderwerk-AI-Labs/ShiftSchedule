import { useEffect, useMemo, useState } from "react";
import ScheduleGrid from "../components/schedule/ScheduleGrid";
import WeekNavigator from "../components/schedule/WeekNavigator";
import { getPublicWebWeek, type PublicWebWeekResponse } from "../api/client";
import {
  Assignment,
  buildAssignmentMap,
  Clinician,
  WorkplaceRow,
  locations as defaultLocations,
} from "../data/mockData";
import { addDays, addWeeks, startOfWeek, toISODate } from "../lib/date";
import { buildRenderedAssignmentMap } from "../lib/schedule";
import { cx } from "../lib/classNames";
import { buildScheduleRows, normalizeAppState } from "../lib/shiftRows";

type PublicWeekPageProps = {
  token: string;
  theme: "light" | "dark";
};

const parseISODate = (value: string | null) => {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

export default function PublicWeekPage({ token, theme }: PublicWeekPageProps) {
  const initialStart = useMemo(() => {
    if (typeof window === "undefined") return new Date();
    const start = new URLSearchParams(window.location.search).get("start");
    const parsed = parseISODate(start);
    return startOfWeek(parsed ?? new Date(), 1);
  }, []);
  const [weekStartDate, setWeekStartDate] = useState<Date>(initialStart);
  const weekStartISO = useMemo(() => toISODate(weekStartDate), [weekStartDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStartDate, i)),
    [weekStartDate],
  );
  const weekEndISO = useMemo(() => toISODate(addDays(weekStartDate, 6)), [weekStartDate]);

  const [data, setData] = useState<PublicWebWeekResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "unpublished" | "invalid">(
    "loading",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("start", weekStartISO);
    window.history.replaceState({}, "", url);
  }, [weekStartISO]);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    getPublicWebWeek(token, weekStartISO)
      .then((response) => {
        if (!alive) return;
        setData(response);
        if (!response.published) {
          setStatus("unpublished");
        } else {
          setStatus("ready");
        }
      })
      .catch((err) => {
        if (!alive) return;
        if ((err as { status?: number }).status === 404) {
          setStatus("invalid");
        } else {
          setStatus("invalid");
        }
      });
    return () => {
      alive = false;
    };
  }, [token, weekStartISO]);

  const normalized = useMemo(() => {
    if (!data?.published) return null;
    const normalizedState = normalizeAppState({
      locations: data.locations ?? [],
      locationsEnabled: data.locationsEnabled ?? true,
      rows: (data.rows ?? []) as WorkplaceRow[],
      clinicians: (data.clinicians ?? []) as Clinician[],
      assignments: (data.assignments ?? []) as Assignment[],
      minSlotsByRowId: data.minSlotsByRowId ?? {},
      slotOverridesByKey: data.slotOverridesByKey ?? {},
      holidays: data.holidays ?? [],
      publishedWeekStartISOs: [],
    });
    return normalizedState.state;
  }, [data]);

  const rows = (normalized?.rows ?? []) as WorkplaceRow[];
  const clinicians = (normalized?.clinicians ?? []) as Clinician[];
  const locationsEnabled = normalized?.locationsEnabled ?? true;
  const scheduleRows = useMemo(
    () => buildScheduleRows(rows, normalized?.locations ?? defaultLocations, locationsEnabled),
    [rows, normalized?.locations, locationsEnabled],
  );
  const rowById = useMemo(
    () => new Map(scheduleRows.map((row) => [row.id, row])),
    [scheduleRows],
  );
  const assignmentMap = useMemo(() => {
    if (!normalized?.assignments) return new Map<string, Assignment[]>();
    return buildAssignmentMap(normalized.assignments as Assignment[]);
  }, [normalized]);
  const renderAssignmentMap = useMemo(
    () => buildRenderedAssignmentMap(assignmentMap, clinicians, weekDays),
    [assignmentMap, clinicians, weekDays],
  );
  const holidayDates = useMemo(
    () => new Set((normalized?.holidays ?? []).map((holiday) => holiday.dateISO)),
    [normalized],
  );
  const holidayNameByDate = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const holiday of normalized?.holidays ?? []) {
      const list = map.get(holiday.dateISO) ?? [];
      list.push(holiday.name);
      map.set(holiday.dateISO, list);
    }
    const record: Record<string, string> = {};
    for (const [dateISO, names] of map.entries()) {
      record[dateISO] = names.join(" · ");
    }
    return record;
  }, [normalized]);

  const poolSeparatorId = useMemo(
    () => rows.find((row) => row.kind === "pool")?.id ?? "",
    [rows],
  );

  const handlePrevWeek = () => setWeekStartDate((prev) => addWeeks(prev, -1));
  const handleNextWeek = () => setWeekStartDate((prev) => addWeeks(prev, 1));
  const handleToday = () => setWeekStartDate(startOfWeek(new Date(), 1));

  return (
    <div className={cx("min-h-screen bg-slate-50 dark:bg-slate-950", theme === "dark" && "dark")}>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 pb-6 pt-6 sm:px-6">
        <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
          🩺 Shift Planner
        </div>
        <WeekNavigator
          variant="card"
          rangeStart={weekDays[0]}
          rangeEndInclusive={weekDays[6]}
          onPrevWeek={handlePrevWeek}
          onNextWeek={handleNextWeek}
          onToday={handleToday}
        />
      </div>

      {status === "invalid" ? (
        <div className="mx-auto max-w-xl px-6 py-8 text-center">
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            Link invalid or expired.
          </div>
        </div>
      ) : status === "unpublished" ? (
        <div className="mx-auto max-w-xl px-6 py-8 text-center">
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              Not published
            </div>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              This week is not published yet.
            </div>
          </div>
        </div>
      ) : status === "ready" ? (
        <ScheduleGrid
          leftHeaderTitle=""
          weekDays={weekDays}
          rows={scheduleRows}
          assignmentMap={renderAssignmentMap}
          holidayDates={holidayDates}
          holidayNameByDate={holidayNameByDate}
          readOnly
          header={null}
          separatorBeforeRowIds={poolSeparatorId ? [poolSeparatorId] : []}
          minSlotsByRowId={normalized?.minSlotsByRowId ?? {}}
          slotOverridesByKey={normalized?.slotOverridesByKey ?? {}}
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
          onCellClick={() => {}}
          onMoveWithinDay={() => {}}
        />
      ) : (
        <div className="mx-auto max-w-xl px-6 py-8 text-center text-sm text-slate-500 dark:text-slate-300">
          Loading…
        </div>
      )}

    </div>
  );
}
