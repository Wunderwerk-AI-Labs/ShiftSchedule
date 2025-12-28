import { useEffect, useMemo, useState } from "react";
import ClinicianEditModal from "../components/schedule/ClinicianEditModal";
import AutomatedPlanningPanel from "../components/schedule/AutomatedPlanningPanel";
import HelpView from "../components/schedule/HelpView";
import IcalExportModal from "../components/schedule/IcalExportModal";
import ScheduleGrid from "../components/schedule/ScheduleGrid";
import SettingsView from "../components/schedule/SettingsView";
import TopBar from "../components/schedule/TopBar";
import WeekNavigator from "../components/schedule/WeekNavigator";
import AdminUsersPanel from "../components/auth/AdminUsersPanel";
import { ChevronLeftIcon, ChevronRightIcon } from "../components/schedule/icons";
import {
  exportWeekPdf,
  exportWeeksPdf,
  getIcalPublishStatus,
  getWebPublishStatus,
  getState,
  publishIcal,
  publishWeb,
  rotateIcalToken,
  saveState,
  solveDay,
  rotateWeb,
  unpublishIcal,
  unpublishWeb,
  type AuthUser,
  type Holiday,
  type IcalPublishStatus,
  type WebPublishStatus,
} from "../api/client";
import {
  Assignment,
  assignments,
  buildAssignmentMap,
  Clinician,
  clinicians as defaultClinicians,
  defaultMinSlotsByRowId,
  WorkplaceRow,
  workplaceRows,
} from "../data/mockData";
import { cx } from "../lib/classNames";
import { addDays, addWeeks, startOfWeek, toISODate } from "../lib/date";
import { buildICalendar, type ICalEvent } from "../lib/ical";
import {
  buildRenderedAssignmentMap,
  FREE_POOL_ID,
  VACATION_POOL_ID,
} from "../lib/schedule";

const CLASS_COLORS = [
  "bg-violet-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-amber-400",
  "bg-blue-600",
  "bg-rose-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-lime-500",
];
const MANUAL_POOL_ID = "pool-manual";

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.(query).matches ?? false;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    if (media.addEventListener) {
      media.addEventListener("change", update);
      return () => media.removeEventListener("change", update);
    }
    media.addListener(update);
    return () => media.removeListener(update);
  }, [query]);

  return matches;
}

function MobileDayNavigator({
  date,
  onPrevDay,
  onNextDay,
  onToday,
}: {
  date: Date;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}) {
  const label = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onPrevDay}
        className="grid h-8 w-8 place-items-center rounded-md border border-slate-200/70 bg-white text-slate-600 hover:bg-slate-50 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label="Previous day"
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </button>
      <div className="min-w-[96px] text-center text-sm font-normal tracking-tight text-slate-700 dark:text-slate-200">
        {label}
      </div>
      <button
        type="button"
        onClick={onNextDay}
        className="grid h-8 w-8 place-items-center rounded-md border border-slate-200/70 bg-white text-slate-600 hover:bg-slate-50 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300 dark:hover:bg-slate-800"
        aria-label="Next day"
      >
        <ChevronRightIcon className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToday}
        className="h-8 rounded-md border border-slate-200/70 bg-white px-3 text-sm font-normal text-slate-700 hover:bg-slate-50 active:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        Today
      </button>
    </div>
  );
}

type WeeklySchedulePageProps = {
  currentUser: AuthUser;
  onLogout: () => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
};

export default function WeeklySchedulePage({
  currentUser,
  onLogout,
  theme,
  onToggleTheme,
}: WeeklySchedulePageProps) {
  const currentYear = new Date().getFullYear();
  const [viewMode, setViewMode] = useState<"calendar" | "settings" | "help">(
    "calendar",
  );
  const [exportOpen, setExportOpen] = useState(false);
  const [icalPublishStatus, setIcalPublishStatus] = useState<IcalPublishStatus | null>(
    null,
  );
  const [icalPublishLoading, setIcalPublishLoading] = useState(false);
  const [icalPublishError, setIcalPublishError] = useState<string | null>(null);
  const [webPublishStatus, setWebPublishStatus] = useState<WebPublishStatus | null>(
    null,
  );
  const [webPublishLoading, setWebPublishLoading] = useState(false);
  const [webPublishError, setWebPublishError] = useState<string | null>(null);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<{ current: number; total: number } | null>(
    null,
  );
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [anchorDate, setAnchorDate] = useState<Date>(new Date());
  const [assignmentMap, setAssignmentMap] = useState<Map<string, Assignment[]>>(() =>
    buildAssignmentMap(assignments),
  );
  const [minSlotsByRowId, setMinSlotsByRowId] = useState<
    Record<string, { weekday: number; weekend: number }>
  >(defaultMinSlotsByRowId);
  const [slotOverridesByKey, setSlotOverridesByKey] = useState<
    Record<string, number>
  >({});
  const [clinicians, setClinicians] = useState<Clinician[]>(() =>
    defaultClinicians.map((clinician) => ({
      ...clinician,
      preferredClassIds: [...clinician.qualifiedClassIds],
    })),
  );
  const [editingClinicianId, setEditingClinicianId] = useState<string>("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string>("");
  const [solverNotice, setSolverNotice] = useState<string | null>(null);
  const [autoPlanProgress, setAutoPlanProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [autoPlanError, setAutoPlanError] = useState<string | null>(null);
  const [autoPlanRunning, setAutoPlanRunning] = useState(false);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayCountry, setHolidayCountry] = useState("DE");
  const [holidayYear, setHolidayYear] = useState(currentYear);
  const [publishedWeekStartISOs, setPublishedWeekStartISOs] = useState<string[]>([]);

  const isMobile = useMediaQuery("(max-width: 640px)");
  const weekStart = useMemo(() => startOfWeek(anchorDate, 1), [anchorDate]);
  const currentWeekStartISO = useMemo(() => toISODate(weekStart), [weekStart]);
  const fullWeekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const displayDays = useMemo(
    () => (isMobile ? [anchorDate] : fullWeekDays),
    [anchorDate, fullWeekDays, isMobile],
  );
  const weekEndInclusive = useMemo(() => addDays(weekStart, 6), [weekStart]);
  const isWeekPublished = useMemo(
    () => publishedWeekStartISOs.includes(currentWeekStartISO),
    [currentWeekStartISO, publishedWeekStartISOs],
  );

  const [rows, setRows] = useState<WorkplaceRow[]>(workplaceRows);
  const classRows = useMemo(() => rows.filter((r) => r.kind === "class"), [rows]);
  const poolRows = useMemo(() => rows.filter((r) => r.kind === "pool"), [rows]);
  const allRows = useMemo(() => [...classRows, ...poolRows], [classRows, poolRows]);
  const classRowIds = useMemo(() => classRows.map((r) => r.id), [classRows]);
  const poolsSeparatorId = poolRows[0]?.id ?? "";
  const clinicianNameById = useMemo(
    () => new Map(clinicians.map((clinician) => [clinician.id, clinician.name])),
    [clinicians],
  );
  const rowById = useMemo(
    () => new Map(allRows.map((row) => [row.id, row])),
    [allRows],
  );
  const clinicianById = useMemo(
    () => new Map(clinicians.map((clinician) => [clinician.id, clinician])),
    [clinicians],
  );
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
  const isWeekendOrHoliday = (dateISO: string) => {
    const date = new Date(`${dateISO}T00:00:00`);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    return isWeekend || holidayDates.has(dateISO);
  };

  const downloadTextFile = (filename: string, mimeType: string, content: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const downloadBlob = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const collectClassAssignments = () => {
    const items: Assignment[] = [];
    for (const list of assignmentMap.values()) {
      for (const assignment of list) {
        const row = rowById.get(assignment.rowId);
        if (!row || row.kind !== "class") continue;
        items.push(assignment);
      }
    }
    return items;
  };

  const withinRange = (
    dateISO: string,
    range: { startISO?: string; endISO?: string },
  ) => {
    if (range.startISO && dateISO < range.startISO) return false;
    if (range.endISO && dateISO > range.endISO) return false;
    return true;
  };

  const buildIcalEventsForAssignments = (
    assignments: Assignment[],
    options: { includeClinicianInSummary: boolean },
  ): ICalEvent[] => {
    return assignments
      .map((assignment): ICalEvent | null => {
        const row = rowById.get(assignment.rowId);
        const clinician = clinicianById.get(assignment.clinicianId);
        if (!row || row.kind !== "class" || !clinician) return null;
        const summary = options.includeClinicianInSummary
          ? `${row.name} — ${clinician.name}`
          : row.name;
        const description = options.includeClinicianInSummary
          ? undefined
          : `Person: ${clinician.name}`;
        return {
          uid: `${assignment.id}@shift-planner`,
          dateISO: assignment.dateISO,
          summary,
          ...(description ? { description } : {}),
        };
      })
      .filter((item): item is ICalEvent => item !== null)
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  };

  const handleDownloadIcalAll = (range: { startISO?: string; endISO?: string }) => {
    const classAssignments = collectClassAssignments().filter((assignment) =>
      withinRange(assignment.dateISO, range),
    );
    const events = buildIcalEventsForAssignments(classAssignments, {
      includeClinicianInSummary: true,
    });
    const ics = buildICalendar({
      calendarName: "Shift Planner (All people)",
      events,
    });
    downloadTextFile("shift-planner-all.ics", "text/calendar;charset=utf-8", ics);
  };

  const handleDownloadIcalClinician = (
    clinicianId: string,
    range: { startISO?: string; endISO?: string },
  ) => {
    const clinician = clinicianById.get(clinicianId);
    if (!clinician) return;
    const classAssignments = collectClassAssignments().filter(
      (assignment) =>
        assignment.clinicianId === clinicianId &&
        withinRange(assignment.dateISO, range),
    );
    const events = buildIcalEventsForAssignments(classAssignments, {
      includeClinicianInSummary: false,
    });
    const safeName = clinician.name
      .trim()
      .replaceAll(/[^\w\- ]+/g, "")
      .replaceAll(/\s+/g, "-")
      .toLowerCase();
    const ics = buildICalendar({
      calendarName: `Shift Planner (${clinician.name})`,
      events,
    });
    downloadTextFile(
      `shift-planner-${safeName || clinician.id}.ics`,
      "text/calendar;charset=utf-8",
      ics,
    );
  };

  const openExportModal = () => {
    setExportOpen(true);
    setIcalPublishError(null);
    setIcalPublishLoading(true);
    setWebPublishError(null);
    setWebPublishLoading(true);
    getIcalPublishStatus()
      .then(async (status) => {
        if (status.published) {
          try {
            const refreshed = await publishIcal();
            setIcalPublishStatus(refreshed);
            return;
          } catch {
            // fall through to show existing status
          }
        }
        setIcalPublishStatus(status);
      })
      .catch(() => {
        setIcalPublishError("Could not load subscription status.");
        setIcalPublishStatus(null);
      })
      .finally(() => setIcalPublishLoading(false));
    getWebPublishStatus()
      .then((status) => {
        setWebPublishStatus(status);
      })
      .catch(() => {
        setWebPublishError("Could not load web link status.");
        setWebPublishStatus(null);
      })
      .finally(() => setWebPublishLoading(false));
  };

  const closeExportModal = () => {
    setExportOpen(false);
    setIcalPublishError(null);
    setIcalPublishLoading(false);
    setWebPublishError(null);
    setWebPublishLoading(false);
  };

  const handlePublishSubscription = async () => {
    setIcalPublishError(null);
    setIcalPublishLoading(true);
    try {
      const status = await publishIcal();
      setIcalPublishStatus(status);
    } catch {
      setIcalPublishError("Publishing failed.");
    } finally {
      setIcalPublishLoading(false);
    }
  };

  const handleRotateSubscription = async () => {
    setIcalPublishError(null);
    setIcalPublishLoading(true);
    try {
      const status = await rotateIcalToken();
      setIcalPublishStatus(status);
    } catch {
      setIcalPublishError("Rotating the link failed.");
    } finally {
      setIcalPublishLoading(false);
    }
  };

  const handleUnpublishSubscription = async () => {
    setIcalPublishError(null);
    setIcalPublishLoading(true);
    try {
      await unpublishIcal();
      setIcalPublishStatus({ published: false });
    } catch {
      setIcalPublishError("Unpublishing failed.");
    } finally {
      setIcalPublishLoading(false);
    }
  };

  const handleWebPublish = async () => {
    setWebPublishError(null);
    setWebPublishLoading(true);
    try {
      const status = await publishWeb();
      setWebPublishStatus(status);
    } catch {
      setWebPublishError("Publishing failed.");
    } finally {
      setWebPublishLoading(false);
    }
  };

  const handleWebRotate = async () => {
    setWebPublishError(null);
    setWebPublishLoading(true);
    try {
      const status = await rotateWeb();
      setWebPublishStatus(status);
    } catch {
      setWebPublishError("Refreshing the link failed.");
    } finally {
      setWebPublishLoading(false);
    }
  };

  const handleWebUnpublish = async () => {
    setWebPublishError(null);
    setWebPublishLoading(true);
    try {
      await unpublishWeb();
      setWebPublishStatus({ published: false });
    } catch {
      setWebPublishError("Unpublishing failed.");
    } finally {
      setWebPublishLoading(false);
    }
  };

  const handleExportPdfBatch = async (args: {
    startISO: string;
    weeks: number;
    mode: "combined" | "individual";
  }) => {
    setPdfError(null);
    setPdfExporting(true);
    try {
      if (args.mode === "combined") {
        setPdfProgress({ current: 0, total: args.weeks });
        const pdfBlob = await exportWeeksPdf(args.startISO, args.weeks);
        const endISO = toISODate(addDays(addWeeks(new Date(`${args.startISO}T00:00:00`), args.weeks), -1));
        downloadBlob(`shift-planner-${args.startISO}-to-${endISO}.pdf`, pdfBlob);
      } else {
        const baseDate = startOfWeek(new Date(`${args.startISO}T00:00:00`), 1);
        for (let i = 0; i < args.weeks; i += 1) {
          const weekStartDate = addWeeks(baseDate, i);
          const weekStartISO = toISODate(weekStartDate);
          setPdfProgress({ current: i + 1, total: args.weeks });
          const pdfBlob = await exportWeekPdf(weekStartISO);
          downloadBlob(`shift-planner-${weekStartISO}.pdf`, pdfBlob);
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    } catch {
      setPdfError("PDF export failed.");
    } finally {
      setPdfExporting(false);
      setPdfProgress(null);
    }
  };

  const renderAssignmentMap = useMemo(
    () => buildRenderedAssignmentMap(assignmentMap, clinicians, displayDays),
    [assignmentMap, clinicians, displayDays],
  );

  const isOnVacation = (clinicianId: string, dateISO: string) => {
    const clinician = clinicians.find((item) => item.id === clinicianId);
    if (!clinician) return false;
    return clinician.vacations.some(
      (vacation) => vacation.startISO <= dateISO && dateISO <= vacation.endISO,
    );
  };

  const shiftDateISO = (dateISO: string, delta: number) =>
    toISODate(addDays(new Date(`${dateISO}T00:00:00`), delta));
  const formatEuropeanDate = (dateISO: string) => {
    const [year, month, day] = dateISO.split("-");
    if (!year || !month || !day) return dateISO;
    return `${day}.${month}.${year}`;
  };

  const applySolverAssignments = (assignments: Assignment[]) => {
    if (!assignments.length) return;
    setAssignmentMap((prev) => {
      const next = new Map(prev);
      for (const assignment of assignments) {
        const key = `${assignment.rowId}__${assignment.dateISO}`;
        const existing = next.get(key) ?? [];
        const already = existing.some(
          (item) =>
            item.clinicianId === assignment.clinicianId &&
            item.rowId === assignment.rowId &&
            item.dateISO === assignment.dateISO,
        );
        if (!already) next.set(key, [...existing, assignment]);
      }
      return next;
    });
  };

  const buildDateRange = (startISO: string, endISO: string) => {
    const dates: string[] = [];
    let current = new Date(`${startISO}T00:00:00`);
    const end = new Date(`${endISO}T00:00:00`);
    while (current <= end) {
      dates.push(toISODate(current));
      current = addDays(current, 1);
    }
    return dates;
  };

  const handleRunAutomatedPlanning = async (args: {
    startISO: string;
    endISO: string;
    onlyFillRequired: boolean;
  }) => {
    if (autoPlanRunning) return;
    setAutoPlanError(null);
    const dateISOs = buildDateRange(args.startISO, args.endISO);
    if (dateISOs.length === 0) {
      setAutoPlanError("Select a valid timeframe to run the solver.");
      return;
    }
    setAutoPlanRunning(true);
    setAutoPlanProgress({ current: 0, total: dateISOs.length });
    for (let index = 0; index < dateISOs.length; index += 1) {
      const dateISO = dateISOs[index];
      try {
        const result = await solveDay(dateISO, {
          onlyFillRequired: args.onlyFillRequired,
        });
        if (result.notes.length > 0) {
          setSolverNotice(result.notes[0]);
          window.setTimeout(() => setSolverNotice(null), 4000);
        }
        applySolverAssignments(result.assignments);
      } catch {
        setAutoPlanError(`Solver failed on ${formatEuropeanDate(dateISO)}.`);
        setSolverNotice("Solver service is not responding.");
        window.setTimeout(() => setSolverNotice(null), 4000);
        break;
      } finally {
        setAutoPlanProgress({ current: index + 1, total: dateISOs.length });
      }
    }
    setAutoPlanRunning(false);
    setAutoPlanProgress(null);
  };

  const handleResetAutomatedRange = (args: { startISO: string; endISO: string }) => {
    setAutoPlanError(null);
    setAssignmentMap((prev) => {
      const next = new Map(prev);
      for (const [key, list] of next.entries()) {
        const [rowId, keyDate] = key.split("__");
        if (!rowId || !keyDate) continue;
        if (rowId.startsWith("pool-")) continue;
        if (keyDate < args.startISO || keyDate > args.endISO) continue;
        const filtered = list.filter((item) => isOnVacation(item.clinicianId, keyDate));
        if (filtered.length === 0) next.delete(key);
        else next.set(key, filtered);
      }
      return next;
    });
  };

  const addVacationDay = (clinicianId: string, dateISO: string) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        if (
          clinician.vacations.some(
            (vacation) => vacation.startISO <= dateISO && dateISO <= vacation.endISO,
          )
        ) {
          return clinician;
        }
        const nextVacations = [
          ...clinician.vacations,
          {
            id: `vac-${clinicianId}-${Date.now().toString(36)}`,
            startISO: dateISO,
            endISO: dateISO,
          },
        ].sort((a, b) => a.startISO.localeCompare(b.startISO));
        const merged: typeof nextVacations = [];
        for (const vacation of nextVacations) {
          const last = merged[merged.length - 1];
          if (!last) {
            merged.push(vacation);
            continue;
          }
          const lastEndPlus = shiftDateISO(last.endISO, 1);
          if (vacation.startISO <= lastEndPlus) {
            merged[merged.length - 1] = {
              ...last,
              endISO: vacation.endISO > last.endISO ? vacation.endISO : last.endISO,
            };
          } else {
            merged.push(vacation);
          }
        }
        return { ...clinician, vacations: merged };
      }),
    );
  };

  const removeVacationDay = (clinicianId: string, dateISO: string) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        let changed = false;
        const nextVacations: typeof clinician.vacations = [];
        for (const vacation of clinician.vacations) {
          if (dateISO < vacation.startISO || dateISO > vacation.endISO) {
            nextVacations.push(vacation);
            continue;
          }
          changed = true;
          if (vacation.startISO === dateISO && vacation.endISO === dateISO) {
            continue;
          }
          if (vacation.startISO === dateISO) {
            nextVacations.push({
              ...vacation,
              startISO: shiftDateISO(dateISO, 1),
            });
            continue;
          }
          if (vacation.endISO === dateISO) {
            nextVacations.push({
              ...vacation,
              endISO: shiftDateISO(dateISO, -1),
            });
            continue;
          }
          nextVacations.push(
            {
              id: `vac-${clinicianId}-${Date.now().toString(36)}a`,
              startISO: vacation.startISO,
              endISO: shiftDateISO(dateISO, -1),
            },
            {
              id: `vac-${clinicianId}-${Date.now().toString(36)}b`,
              startISO: shiftDateISO(dateISO, 1),
              endISO: vacation.endISO,
            },
          );
        }
        if (!changed) return clinician;
        nextVacations.sort((a, b) => a.startISO.localeCompare(b.startISO));
        return { ...clinician, vacations: nextVacations };
      }),
    );
  };

  const getBaseSlotsForDate = (rowId: string, dateISO: string) => {
    const minSlots = minSlotsByRowId[rowId] ?? { weekday: 0, weekend: 0 };
    return isWeekendOrHoliday(dateISO) ? minSlots.weekend : minSlots.weekday;
  };

  const adjustSlotOverride = (rowId: string, dateISO: string, delta: number) => {
    const baseSlots = getBaseSlotsForDate(rowId, dateISO);
    setSlotOverridesByKey((prev) => {
      const key = `${rowId}__${dateISO}`;
      const current = prev[key] ?? 0;
      const nextValue = Math.max(-baseSlots, current + delta);
      if (nextValue === current) return prev;
      const next = { ...prev };
      if (nextValue === 0) {
        delete next[key];
      } else {
        next[key] = nextValue;
      }
      return next;
    });
  };

  const openSlotsCount = useMemo(() => {
    const dateISOs = fullWeekDays.map(toISODate);
    let openSlots = 0;
    for (const rowId of classRowIds) {
      const minSlots = minSlotsByRowId[rowId] ?? { weekday: 0, weekend: 0 };
      for (const d of dateISOs) {
        const cell = assignmentMap.get(`${rowId}__${d}`) ?? [];
        const baseRequired = isWeekendOrHoliday(d)
          ? minSlots.weekend
          : minSlots.weekday;
        const override = slotOverridesByKey[`${rowId}__${d}`] ?? 0;
        const required = Math.max(0, baseRequired + override);
        if (required > cell.length) openSlots += required - cell.length;
      }
    }
    return openSlots;
  }, [
    fullWeekDays,
    assignmentMap,
    classRowIds,
    minSlotsByRowId,
    slotOverridesByKey,
    holidayDates,
  ]);

  const editingClinician = useMemo(
    () => clinicians.find((clinician) => clinician.id === editingClinicianId),
    [clinicians, editingClinicianId],
  );

  useEffect(() => {
    let alive = true;
    setHasLoaded(false);
    setLoadedUserId("");
    getState()
      .then((state) => {
        if (!alive) return;
        if (state.rows?.length) {
          const filteredRows = state.rows.filter((row) => row.id !== "pool-not-working");
          const hasManualPool = filteredRows.some((row) => row.id === MANUAL_POOL_ID);
          const nextRows = hasManualPool
            ? filteredRows
            : filteredRows.reduce<WorkplaceRow[]>((acc, row) => {
                acc.push(row);
                if (row.id === "pool-not-allocated") {
                  acc.push({
                    id: MANUAL_POOL_ID,
                    name: "Pool",
                    kind: "pool",
                    dotColorClass: "bg-slate-300",
                  });
                }
                return acc;
              }, []);
          if (!hasManualPool && nextRows.length === filteredRows.length) {
            nextRows.unshift({
              id: MANUAL_POOL_ID,
              name: "Pool",
              kind: "pool",
              dotColorClass: "bg-slate-300",
            });
          }
          setRows(nextRows);
          if (nextRows.length !== state.rows.length) {
            state.rows = nextRows;
          }
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
          const filteredAssignments = state.assignments.filter(
            (assignment) => assignment.rowId !== "pool-not-working",
          );
          setAssignmentMap(buildAssignmentMap(filteredAssignments));
          state.assignments = filteredAssignments;
        }
        if (state.minSlotsByRowId) setMinSlotsByRowId(state.minSlotsByRowId);
        if (state.slotOverridesByKey) {
          setSlotOverridesByKey(state.slotOverridesByKey);
        }
        if (state.holidays) setHolidays(state.holidays);
        if (state.holidayCountry) setHolidayCountry(state.holidayCountry);
        if (state.holidayYear) setHolidayYear(state.holidayYear);
        setPublishedWeekStartISOs(state.publishedWeekStartISOs ?? []);
      })
      .catch(() => {
        /* Backend optional during local-only dev */
      })
      .finally(() => {
        if (alive) {
          setLoadedUserId(currentUser.username);
          setHasLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [currentUser.username]);

  useEffect(() => {
    if (!hasLoaded || loadedUserId !== currentUser.username) return;
    const toAssignments = () => {
      const out: Assignment[] = [];
      for (const list of assignmentMap.values()) {
        out.push(...list);
      }
      return out;
    };
    const payload = {
      rows,
      clinicians,
      assignments: toAssignments(),
      minSlotsByRowId,
      slotOverridesByKey,
      holidays,
      holidayCountry,
      holidayYear,
      publishedWeekStartISOs,
    };
    const handle = window.setTimeout(() => {
      saveState(payload).catch(() => {
        /* Backend optional during local-only dev */
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [
    rows,
    clinicians,
    assignmentMap,
    minSlotsByRowId,
    slotOverridesByKey,
    holidays,
    holidayCountry,
    holidayYear,
    publishedWeekStartISOs,
    hasLoaded,
    currentUser.username,
  ]);

  const handleToggleQualification = (clinicianId: string, classId: string) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        const hasClass = clinician.qualifiedClassIds.includes(classId);
        const nextQualified = hasClass
          ? clinician.qualifiedClassIds.filter((id) => id !== classId)
          : [...clinician.qualifiedClassIds, classId];
        return {
          ...clinician,
          qualifiedClassIds: nextQualified,
          preferredClassIds: [...nextQualified],
        };
      }),
    );
  };

  const handleReorderQualification = (
    clinicianId: string,
    fromClassId: string,
    toClassId: string,
  ) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        const fromIndex = clinician.qualifiedClassIds.indexOf(fromClassId);
        const toIndex = clinician.qualifiedClassIds.indexOf(toClassId);
        if (fromIndex === -1 || toIndex === -1) return clinician;
        const nextQualified = [...clinician.qualifiedClassIds];
        const [moved] = nextQualified.splice(fromIndex, 1);
        nextQualified.splice(toIndex, 0, moved);
        return {
          ...clinician,
          qualifiedClassIds: nextQualified,
          preferredClassIds: [...nextQualified],
        };
      }),
    );
  };

  const handleAddVacation = (clinicianId: string) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        const id = `vac-${Date.now().toString(36)}`;
        const start = addDays(new Date(), 7);
        const end = addDays(start, 1);
        return {
          ...clinician,
          vacations: [
            ...clinician.vacations,
            { id, startISO: toISODate(start), endISO: toISODate(end) },
          ],
        };
      }),
    );
  };

  const handleUpdateVacation = (
    clinicianId: string,
    vacationId: string,
    updates: { startISO?: string; endISO?: string },
  ) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        return {
          ...clinician,
          vacations: clinician.vacations.map((vacation) =>
            vacation.id === vacationId ? { ...vacation, ...updates } : vacation,
          ),
        };
      }),
    );
  };

  const handleRemoveVacation = (clinicianId: string, vacationId: string) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        return {
          ...clinician,
          vacations: clinician.vacations.filter((vacation) => vacation.id !== vacationId),
        };
      }),
    );
  };
  const handleAddHoliday = (holiday: Holiday) => {
    const trimmedName = holiday.name.trim();
    if (!holiday.dateISO || !trimmedName) return;
    setHolidays((prev) => {
      const exists = prev.some(
        (item) => item.dateISO === holiday.dateISO && item.name === trimmedName,
      );
      if (exists) return prev;
      return [...prev, { dateISO: holiday.dateISO, name: trimmedName }];
    });
  };
  const handleRemoveHoliday = (holiday: Holiday) => {
    setHolidays((prev) =>
      prev.filter(
        (item) => !(item.dateISO === holiday.dateISO && item.name === holiday.name),
      ),
    );
  };
  const handleFetchHolidays = async (countryCode: string, year: number) => {
    const normalizedCountry = countryCode.trim().toUpperCase();
    const response = await fetch(
      `https://date.nager.at/api/v3/PublicHolidays/${year}/${normalizedCountry}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch holidays (${response.status}).`);
    }
    const data = (await response.json()) as Array<{
      date: string;
      localName?: string;
      name?: string;
    }>;
    const fetched = data.map((item) => ({
      dateISO: item.date,
      name: item.localName ?? item.name ?? "Holiday",
    }));
    const unique = new Map<string, Holiday>();
    for (const item of fetched) {
      unique.set(`${item.dateISO}__${item.name}`, item);
    }
    setHolidays((prev) => {
      const yearPrefix = `${year}-`;
      const keep = prev.filter((holiday) => !holiday.dateISO.startsWith(yearPrefix));
      return [...keep, ...Array.from(unique.values())];
    });
    setHolidayCountry(normalizedCountry);
    setHolidayYear(year);
  };
  const openSlotsBadge = (
    <span
      className={cx(
        "inline-flex items-center self-start rounded-full px-2.5 py-1 text-[11px] font-normal ring-1 ring-inset sm:self-auto sm:px-3",
        openSlotsCount === 0
          ? "bg-emerald-50 text-emerald-600 ring-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-200 dark:ring-emerald-500/40"
          : "bg-rose-50 text-rose-600 ring-rose-200 dark:bg-rose-900/40 dark:text-rose-200 dark:ring-rose-500/40",
      )}
    >
      {openSlotsCount} Open Slots
    </span>
  );
  const publishToggle = (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
      <span>Publish</span>
      <button
        type="button"
        role="switch"
        aria-checked={isWeekPublished}
        onClick={() => handleWeekPublishToggle(!isWeekPublished)}
        className={cx(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
          isWeekPublished
            ? "bg-emerald-500"
            : "bg-slate-300 dark:bg-slate-700",
        )}
      >
        <span
          className={cx(
            "inline-block h-4 w-4 translate-x-0.5 rounded-full bg-white shadow transition-transform",
            isWeekPublished && "translate-x-[18px]",
          )}
        />
      </button>
    </div>
  );
  const handleWeekPublishToggle = (nextPublished: boolean) => {
    setPublishedWeekStartISOs((prev) => {
      const next = new Set(prev);
      if (nextPublished) {
        next.add(currentWeekStartISO);
      } else {
        next.delete(currentWeekStartISO);
      }
      return Array.from(next);
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <TopBar
        viewMode={viewMode}
        onSetViewMode={setViewMode}
        onOpenExport={() => {
          setPdfError(null);
          setPdfProgress(null);
          openExportModal();
        }}
        username={currentUser.username}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={onToggleTheme}
      />

      {viewMode === "calendar" ? (
        <>
          <ScheduleGrid
            leftHeaderTitle=""
            weekDays={displayDays}
            rows={allRows}
            assignmentMap={renderAssignmentMap}
            holidayDates={holidayDates}
            holidayNameByDate={holidayNameByDate}
            header={
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {isMobile ? (
                    <MobileDayNavigator
                      date={anchorDate}
                      onPrevDay={() => setAnchorDate((d) => addDays(d, -1))}
                      onNextDay={() => setAnchorDate((d) => addDays(d, 1))}
                      onToday={() => setAnchorDate(new Date())}
                    />
                  ) : (
                    <WeekNavigator
                      variant="card"
                      rangeStart={weekStart}
                      rangeEndInclusive={weekEndInclusive}
                      onPrevWeek={() => setAnchorDate((d) => addWeeks(d, -1))}
                      onNextWeek={() => setAnchorDate((d) => addWeeks(d, 1))}
                      onToday={() => setAnchorDate(new Date())}
                    />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {openSlotsBadge}
                  {publishToggle}
                </div>
              </div>
            }
            separatorBeforeRowIds={poolsSeparatorId ? [poolsSeparatorId] : []}
            minSlotsByRowId={minSlotsByRowId}
            getClinicianName={(id) => clinicianNameById.get(id) ?? "Unknown"}
            getHasEligibleClasses={(id) => {
              const clinician = clinicians.find((item) => item.id === id);
              return clinician ? clinician.qualifiedClassIds.length > 0 : false;
            }}
            getIsQualified={(clinicianId, rowId) => {
              const clinician = clinicians.find((item) => item.id === clinicianId);
              return clinician ? clinician.qualifiedClassIds.includes(rowId) : false;
            }}
            slotOverridesByKey={slotOverridesByKey}
            onRemoveEmptySlot={({ rowId, dateISO }) => {
              adjustSlotOverride(rowId, dateISO, -1);
            }}
            onClinicianClick={(clinicianId) => setEditingClinicianId(clinicianId)}
            onCellClick={({ row, date }) => {
              if (row.kind !== "class") return;
              adjustSlotOverride(row.id, toISODate(date), 1);
            }}
            onMoveWithinDay={({
              dateISO,
              fromRowId,
              toRowId,
              assignmentId,
              clinicianId,
            }) => {
              setAssignmentMap((prev) => {
                const fromKey = `${fromRowId}__${dateISO}`;
                const toKey = `${toRowId}__${dateISO}`;
                if (fromKey === toKey) return prev;
                const fromRow = rowById.get(fromRowId);
                const toRow = rowById.get(toRowId);
                if (!fromRow || !toRow) return prev;

                const next = new Map(prev);
                const removeAssignment = (key: string, targetId: string) => {
                  const list = next.get(key) ?? [];
                  const nextList = list.filter((a) => a.id !== targetId);
                  if (nextList.length === 0) next.delete(key);
                  else next.set(key, nextList);
                };
                const removeAssignmentsForDate = (
                  targetClinicianId: string,
                  targetDateISO: string,
                ) => {
                  for (const [key, list] of next.entries()) {
                    const [, keyDate] = key.split("__");
                    if (keyDate !== targetDateISO) continue;
                    const filtered = list.filter(
                      (assignment) => assignment.clinicianId !== targetClinicianId,
                    );
                    if (filtered.length === 0) next.delete(key);
                    else next.set(key, filtered);
                  }
                };
                const isToVacation = toRow.id === VACATION_POOL_ID;
                const isFromVacation = fromRow.id === VACATION_POOL_ID;

                if (isToVacation) {
                  addVacationDay(clinicianId, dateISO);
                  removeAssignmentsForDate(clinicianId, dateISO);
                  return next;
                }

                if (isFromVacation) {
                  removeVacationDay(clinicianId, dateISO);
                  if (toRow.id === FREE_POOL_ID) {
                    return next;
                  }
                }
                if (toRow.kind === "pool") {
                  const isManualPool = toRow.id === MANUAL_POOL_ID;
                  if (isManualPool) {
                    if (fromRow.kind === "class" || fromRow.id === MANUAL_POOL_ID) {
                      const fromList = next.get(fromKey) ?? [];
                      const moving = fromList.find((a) => a.id === assignmentId);
                      if (!moving) return prev;
                      removeAssignment(fromKey, assignmentId);
                      const toList = next.get(toKey) ?? [];
                      const already = toList.some((item) => item.clinicianId === clinicianId);
                      if (!already) {
                        next.set(toKey, [...toList, { ...moving, rowId: toRowId, dateISO }]);
                      }
                      return next;
                    }

                    const toList = next.get(toKey) ?? [];
                    const already = toList.some((item) => item.clinicianId === clinicianId);
                    if (!already) {
                      const newItem: Assignment = {
                        id: `pool-${toRowId}-${clinicianId}-${dateISO}`,
                        rowId: toRowId,
                        dateISO,
                        clinicianId,
                      };
                      next.set(toKey, [...toList, newItem]);
                    }
                    return next;
                  }

                  if (fromRow.kind === "class" || fromRow.id === MANUAL_POOL_ID) {
                    removeAssignment(fromKey, assignmentId);
                  }
                  return next;
                }

                if (fromRow.kind === "pool") {
                  if (fromRow.id === MANUAL_POOL_ID) {
                    removeAssignment(fromKey, assignmentId);
                  }
                  const alreadyAssigned = Array.from(next.entries()).some(([key, list]) => {
                    const keyDate = key.split("__")[1];
                    if (keyDate !== dateISO) return false;
                    return list.some((a) => a.clinicianId === clinicianId);
                  });
                  if (alreadyAssigned) return prev;
                  const toList = next.get(toKey) ?? [];
                  const newItem: Assignment = {
                    id: `as-${Date.now().toString(36)}-${clinicianId}`,
                    rowId: toRowId,
                    dateISO,
                    clinicianId,
                  };
                  next.set(toKey, [...toList, newItem]);
                  return next;
                }

                const fromList = next.get(fromKey) ?? [];
                const moving = fromList.find((a) => a.id === assignmentId);
                if (!moving) return prev;
                const nextFrom = fromList.filter((a) => a.id !== assignmentId);
                if (nextFrom.length === 0) next.delete(fromKey);
                else next.set(fromKey, nextFrom);
                const toList = next.get(toKey) ?? [];
                next.set(toKey, [...toList, { ...moving, rowId: toRowId, dateISO }]);
                return next;
              });
            }}
          />
          <div className="mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 sm:pb-10">
            <AutomatedPlanningPanel
              weekStartISO={toISODate(weekStart)}
              weekEndISO={toISODate(weekEndInclusive)}
              isRunning={autoPlanRunning}
              progress={autoPlanProgress}
              error={autoPlanError}
              onRun={handleRunAutomatedPlanning}
              onReset={handleResetAutomatedRange}
            />
          </div>
        </>
      ) : viewMode === "settings" ? (
        <>
          <SettingsView
            classRows={classRows}
            poolRows={poolRows}
            minSlotsByRowId={minSlotsByRowId}
            clinicians={clinicians}
            holidays={holidays}
            holidayCountry={holidayCountry}
            holidayYear={holidayYear}
            onChangeMinSlots={(rowId, kind, nextValue) => {
              setMinSlotsByRowId((prev) => ({
                ...prev,
                [rowId]: {
                  ...(prev[rowId] ?? { weekday: 0, weekend: 0 }),
                  [kind]: Math.max(0, Math.floor(nextValue)),
                },
              }));
            }}
            onRenameClass={(rowId, nextName) => {
              setRows((prev) =>
                prev.map((row) =>
                  row.id === rowId ? { ...row, name: nextName } : row,
                ),
              );
            }}
            onRemoveClass={(rowId) => {
              setRows((prev) => prev.filter((row) => row.id !== rowId));
              setMinSlotsByRowId((prev) => {
                const next = { ...prev };
                delete next[rowId];
                return next;
              });
              setSlotOverridesByKey((prev) => {
                const next: Record<string, number> = {};
                for (const [key, value] of Object.entries(prev)) {
                  if (!key.startsWith(`${rowId}__`)) next[key] = value;
                }
                return next;
              });
              setClinicians((prev) =>
                prev.map((clinician) => ({
                  ...clinician,
                  qualifiedClassIds: clinician.qualifiedClassIds.filter((id) => id !== rowId),
                  preferredClassIds: clinician.preferredClassIds.filter((id) => id !== rowId),
                })),
              );
              setAssignmentMap((prev) => {
                const next = new Map(prev);
                for (const key of next.keys()) {
                  if (key.startsWith(`${rowId}__`)) next.delete(key);
                }
                return next;
              });
            }}
            onAddClass={() => {
              const id = `class-${Date.now().toString(36)}`;
              setRows((prev) => {
                const classRows = prev.filter((row) => row.kind === "class");
                const poolRows = prev.filter((row) => row.kind === "pool");
                const classCount = classRows.length;
                const color = CLASS_COLORS[classCount % CLASS_COLORS.length];
                return [
                  ...classRows,
                  { id, name: "New Class", kind: "class", dotColorClass: color },
                  ...poolRows,
                ];
              });
              setMinSlotsByRowId((prev) => ({
                ...prev,
                [id]: { weekday: 1, weekend: 1 },
              }));
            }}
            onReorderClass={(fromId, toId) => {
              setRows((prev) => {
                const classRows = prev.filter((row) => row.kind === "class");
                const poolRows = prev.filter((row) => row.kind === "pool");
                const fromIndex = classRows.findIndex((row) => row.id === fromId);
                const toIndex = classRows.findIndex((row) => row.id === toId);
                if (fromIndex === -1 || toIndex === -1) return prev;
                const nextClasses = [...classRows];
                const [moved] = nextClasses.splice(fromIndex, 1);
                nextClasses.splice(toIndex, 0, moved);
                return [...nextClasses, ...poolRows];
              });
            }}
            onRenamePool={(rowId, nextName) => {
              setRows((prev) =>
                prev.map((row) =>
                  row.id === rowId ? { ...row, name: nextName } : row,
                ),
              );
            }}
            onAddClinician={(name) => {
              const slug = name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)/g, "");
              const id = `clin-${slug || "user"}-${Date.now().toString(36)}`;
              setClinicians((prev) => [
                ...prev,
                {
                  id,
                  name,
                  qualifiedClassIds: [],
                  preferredClassIds: [],
                  vacations: [],
                },
              ]);
            }}
            onEditClinician={(clinicianId) => setEditingClinicianId(clinicianId)}
            onRemoveClinician={(clinicianId) => {
              setClinicians((prev) =>
                prev.filter((clinician) => clinician.id !== clinicianId),
              );
              setAssignmentMap((prev) => {
                const next = new Map<string, Assignment[]>();
                for (const [key, list] of prev.entries()) {
                  const filtered = list.filter(
                    (assignment) => assignment.clinicianId !== clinicianId,
                  );
                  if (filtered.length > 0) next.set(key, filtered);
                }
                return next;
              });
              setEditingClinicianId((current) =>
                current === clinicianId ? "" : current,
              );
            }}
            onChangeHolidayCountry={setHolidayCountry}
            onChangeHolidayYear={setHolidayYear}
            onFetchHolidays={handleFetchHolidays}
            onAddHoliday={handleAddHoliday}
            onRemoveHoliday={handleRemoveHoliday}
          />
          <AdminUsersPanel
            isAdmin={currentUser.role === "admin"}
          />
        </>
      ) : (
        <HelpView />
      )}

      <ClinicianEditModal
        open={editingClinicianId !== ""}
        onClose={() => setEditingClinicianId("")}
        clinician={editingClinician ?? null}
        classRows={classRows}
        onToggleQualification={handleToggleQualification}
        onReorderQualification={handleReorderQualification}
        onAddVacation={handleAddVacation}
        onUpdateVacation={handleUpdateVacation}
        onRemoveVacation={handleRemoveVacation}
      />

      <IcalExportModal
        open={exportOpen}
        onClose={closeExportModal}
        clinicians={clinicians.map((clinician) => ({ id: clinician.id, name: clinician.name }))}
        defaultStartISO={toISODate(weekStart)}
        defaultEndISO={toISODate(weekEndInclusive)}
        onDownloadAll={handleDownloadIcalAll}
        onDownloadClinician={handleDownloadIcalClinician}
        publishStatus={icalPublishStatus}
        publishLoading={icalPublishLoading}
        publishError={icalPublishError}
        onPublish={handlePublishSubscription}
        onRotate={handleRotateSubscription}
        onUnpublish={handleUnpublishSubscription}
        defaultPdfStartISO={currentWeekStartISO}
        onExportPdf={handleExportPdfBatch}
        pdfExporting={pdfExporting}
        pdfProgress={pdfProgress}
        pdfError={pdfError}
        webStatus={webPublishStatus}
        webLoading={webPublishLoading}
        webError={webPublishError}
        onWebPublish={handleWebPublish}
        onWebRotate={handleWebRotate}
        onWebUnpublish={handleWebUnpublish}
      />

      {solverNotice ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 shadow-lg dark:border-amber-500/40 dark:bg-amber-900/40 dark:text-amber-200">
          {solverNotice}
        </div>
      ) : null}

    </div>
  );
}
