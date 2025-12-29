import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cx } from "../../lib/classNames";
import { toISODate } from "../../lib/date";

type VacationRange = { id: string; startISO: string; endISO: string };

type VacationOverviewModalProps = {
  open: boolean;
  onClose: () => void;
  clinicians: Array<{
    id: string;
    name: string;
    vacations: VacationRange[];
  }>;
  onSelectClinician: (clinicianId: string) => void;
};

const DAY_WIDTH = 20;
const LEFT_COLUMN_WIDTH = 200;
const BAR_HEIGHT = 16;
const YEAR_RANGE = 3;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, monthIndex: number) => {
  const base = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][monthIndex] ?? 30;
  return monthIndex === 1 && isLeapYear(year) ? base + 1 : base;
};

const daysInYear = (year: number) => (isLeapYear(year) ? 366 : 365);

const parseISODate = (value: string) => {
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
};

const dateToDayIndexInTimeline = (
  dateISO: string,
  startYear: number,
  endYear: number,
) => {
  const parsed = parseISODate(dateISO);
  if (!parsed) return null;
  const dateMs = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const startMs = Date.UTC(startYear, 0, 1);
  const endMs = Date.UTC(endYear, 11, 31);
  if (dateMs < startMs || dateMs > endMs) return null;
  return Math.floor((dateMs - startMs) / MS_PER_DAY);
};

const clipRangeToTimeline = (
  startISO: string,
  endISO: string,
  startYear: number,
  endYear: number,
) => {
  const start = parseISODate(startISO);
  const end = parseISODate(endISO);
  if (!start || !end) return null;
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  if (endMs < startMs) return null;
  const timelineStartMs = Date.UTC(startYear, 0, 1);
  const timelineEndMs = Date.UTC(endYear, 11, 31);
  const clippedStart = Math.max(startMs, timelineStartMs);
  const clippedEnd = Math.min(endMs, timelineEndMs);
  if (clippedStart > clippedEnd) return null;
  const startIndex = Math.floor((clippedStart - timelineStartMs) / MS_PER_DAY);
  const endIndex = Math.floor((clippedEnd - timelineStartMs) / MS_PER_DAY);
  return { startIndex, endIndex };
};

export default function VacationOverviewModal({
  open,
  onClose,
  clinicians,
  onSelectClinician,
}: VacationOverviewModalProps) {
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [visibleYear, setVisibleYear] = useState(currentYear);
  const [pendingScrollToToday, setPendingScrollToToday] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedYear(currentYear);
    setPendingScrollToToday(true);
  }, [open, currentYear]);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const rangeStartYear = selectedYear - Math.floor(YEAR_RANGE / 2);
  const rangeEndYear = rangeStartYear + YEAR_RANGE - 1;
  const yearSpans = useMemo(() => {
    const spans: Array<{ year: number; days: number }> = [];
    for (let year = rangeStartYear; year <= rangeEndYear; year += 1) {
      spans.push({ year, days: daysInYear(year) });
    }
    return spans;
  }, [rangeStartYear, rangeEndYear]);
  const monthSpans = useMemo(() => {
    const spans: Array<{ label: string; days: number; year: number }> = [];
    for (let year = rangeStartYear; year <= rangeEndYear; year += 1) {
      for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
        spans.push({
          label: MONTH_LABELS[monthIndex],
          days: daysInMonth(year, monthIndex),
          year,
        });
      }
    }
    return spans;
  }, [rangeStartYear, rangeEndYear]);
  const totalDays = useMemo(() => {
    let sum = 0;
    for (const span of yearSpans) sum += span.days;
    return sum;
  }, [yearSpans]);
  const totalWidth = totalDays * DAY_WIDTH;
  const resolveYearForDayIndex = useCallback(
    (dayIndex: number) => {
      let remaining = dayIndex;
      for (const span of yearSpans) {
        if (remaining < span.days) return span.year;
        remaining -= span.days;
      }
      return yearSpans[yearSpans.length - 1]?.year ?? rangeStartYear;
    },
    [yearSpans, rangeStartYear],
  );
  const todayIndex = useMemo(() => {
    if (currentYear < rangeStartYear || currentYear > rangeEndYear) return null;
    return dateToDayIndexInTimeline(
      toISODate(new Date()),
      rangeStartYear,
      rangeEndYear,
    );
  }, [currentYear, rangeStartYear, rangeEndYear]);
  const vacationSegmentsByClinician = useMemo(() => {
    const map = new Map<
      string,
      Array<{ id: string; left: number; width: number }>
    >();
    for (const clinician of clinicians) {
      const segments: Array<{ id: string; left: number; width: number }> = [];
      for (const vacation of clinician.vacations) {
        const clipped = clipRangeToTimeline(
          vacation.startISO,
          vacation.endISO,
          rangeStartYear,
          rangeEndYear,
        );
        if (!clipped) continue;
        const width = (clipped.endIndex - clipped.startIndex + 1) * DAY_WIDTH;
        segments.push({
          id: vacation.id,
          left: clipped.startIndex * DAY_WIDTH,
          width,
        });
      }
      map.set(clinician.id, segments);
    }
    return map;
  }, [clinicians, rangeStartYear, rangeEndYear]);

  const handleJumpToToday = () => {
    if (selectedYear !== currentYear) {
      setSelectedYear(currentYear);
    }
    setPendingScrollToToday(true);
  };

  useEffect(() => {
    if (!open) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const updateVisibleYear = () => {
      const visibleWidth = Math.max(0, container.clientWidth - LEFT_COLUMN_WIDTH);
      const centerIndex = Math.max(
        0,
        Math.floor((container.scrollLeft + visibleWidth / 2) / DAY_WIDTH),
      );
      const nextYear = resolveYearForDayIndex(centerIndex);
      setVisibleYear((prev) => (prev === nextYear ? prev : nextYear));
    };
    updateVisibleYear();
    container.addEventListener("scroll", updateVisibleYear, { passive: true });
    return () => container.removeEventListener("scroll", updateVisibleYear);
  }, [open, resolveYearForDayIndex]);

  useEffect(() => {
    if (!open) return;
    if (!pendingScrollToToday) return;
    if (todayIndex === null) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const target =
      LEFT_COLUMN_WIDTH + todayIndex * DAY_WIDTH - container.clientWidth / 2;
    window.requestAnimationFrame(() => {
      container.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
    });
    setPendingScrollToToday(false);
  }, [open, pendingScrollToToday, todayIndex]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-40">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-900/40 backdrop-blur-[1px] dark:bg-slate-950/50"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative mx-auto h-full w-full max-w-screen-2xl px-4 py-6 sm:px-6">
        <div className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 px-6 py-4 dark:border-slate-800">
            <div>
              <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Vacation Overview
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Year planner for clinician vacations.
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleJumpToToday}
                className={cx(
                  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700",
                  "hover:bg-slate-50 active:bg-slate-100",
                  "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
                )}
              >
                Today
              </button>
              <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                <button
                  type="button"
                  onClick={() => setSelectedYear((prev) => prev - 1)}
                  className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                  aria-label="Previous year"
                >
                  -
                </button>
                <span className="min-w-[96px] text-center font-semibold">
                  {rangeStartYear}-{rangeEndYear}
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedYear((prev) => prev + 1)}
                  className="rounded-full px-2 py-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-300 dark:hover:text-slate-100"
                  aria-label="Next year"
                >
                  +
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                className={cx(
                  "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900",
                  "hover:bg-slate-50 active:bg-slate-100",
                  "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
                )}
              >
                Close
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <div ref={scrollContainerRef} className="h-full overflow-auto">
              <div className="relative min-w-max">
                {typeof todayIndex === "number" ? (
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-20"
                    style={{
                      left: LEFT_COLUMN_WIDTH + todayIndex * DAY_WIDTH,
                    }}
                  >
                    <div className="h-full w-px bg-rose-400/80" />
                    <div className="absolute top-1 -translate-x-1/2 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600 shadow-sm dark:bg-rose-900/40 dark:text-rose-200">
                      Today
                    </div>
                  </div>
                ) : null}

                <div className="sticky top-0 z-30 bg-white dark:bg-slate-900">
                  <div className="flex border-b border-slate-200 dark:border-slate-800">
                    <div
                      className="sticky left-0 z-40 border-r border-slate-200 bg-white px-3 py-2 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                      style={{ width: LEFT_COLUMN_WIDTH }}
                    >
                      <div className="text-[10px] uppercase tracking-wide">Year</div>
                      <div className="text-sm font-semibold text-slate-700 dark:text-slate-100">
                        {visibleYear}
                      </div>
                    </div>
                    <div
                      className="flex border-r border-slate-100 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:text-slate-300"
                      style={{ width: totalWidth }}
                    >
                      {yearSpans.map((span) => (
                        <div
                          key={span.year}
                          className="flex items-center justify-center border-r border-slate-100 dark:border-slate-800"
                          style={{ width: span.days * DAY_WIDTH }}
                        >
                          {span.year}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex border-b border-slate-200 dark:border-slate-800">
                    <div
                      className="sticky left-0 z-40 border-r border-slate-200 bg-white px-3 py-3 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
                      style={{ width: LEFT_COLUMN_WIDTH }}
                    >
                      Clinicians
                    </div>
                    <div className="flex" style={{ width: totalWidth }}>
                      {monthSpans.map((month) => (
                        <div
                          key={`${month.year}-${month.label}`}
                          className="flex items-center justify-center border-r border-slate-100 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400"
                          style={{ width: month.days * DAY_WIDTH }}
                        >
                          {month.label}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex border-b border-slate-200 dark:border-slate-800">
                    <div
                      className="sticky left-0 z-40 border-r border-slate-200 bg-white px-3 py-2 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-900"
                      style={{ width: LEFT_COLUMN_WIDTH }}
                    >
                      Days
                    </div>
                    <div className="flex" style={{ width: totalWidth }}>
                      {monthSpans.map((month) => (
                        <div key={`${month.year}-${month.label}`} className="flex">
                          {Array.from({ length: month.days }).map((_, idx) => (
                            <div
                              key={`${month.year}-${month.label}-${idx + 1}`}
                              className="flex h-7 items-center justify-center border-r border-slate-100 text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500"
                              style={{ width: DAY_WIDTH }}
                            >
                              {idx + 1}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  {clinicians.map((clinician) => {
                    const segments =
                      vacationSegmentsByClinician.get(clinician.id) ?? [];
                    return (
                      <div
                        key={clinician.id}
                        className="flex items-center border-b border-slate-100 dark:border-slate-800"
                      >
                        <div
                          className="sticky left-0 z-10 border-r border-slate-200 bg-white px-3 py-2 text-sm font-normal text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                          style={{ width: LEFT_COLUMN_WIDTH }}
                        >
                          <span className="block truncate">{clinician.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => onSelectClinician(clinician.id)}
                          className="relative flex h-10 flex-shrink-0 items-center px-2"
                          style={{ width: totalWidth }}
                        >
                          <div
                            className="relative w-full rounded-full bg-slate-200 dark:bg-slate-800"
                            style={{ height: BAR_HEIGHT }}
                          >
                            {segments.map((segment) => (
                              <div
                                key={segment.id}
                                className="absolute top-0 rounded-full bg-emerald-500"
                                style={{
                                  left: segment.left,
                                  width: segment.width,
                                  height: BAR_HEIGHT,
                                }}
                              />
                            ))}
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
