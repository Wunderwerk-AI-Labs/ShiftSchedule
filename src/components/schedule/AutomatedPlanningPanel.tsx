import { useEffect, useMemo, useState } from "react";
import {
  buttonPrimary,
  buttonSecondary,
  getPillToggleClasses,
  pillLabel,
} from "../../lib/buttonStyles";
import { cx } from "../../lib/classNames";
import { toISODate } from "../../lib/date";
import CustomDatePicker from "./CustomDatePicker";

type AutomatedPlanningPanelProps = {
  weekStartISO: string;
  weekEndISO: string;
  isRunning: boolean;
  progress: { current: number; total: number } | null;
  startedAt: number | null;
  lastRunTotalDays: number | null;
  lastRunDurationMs: number | null;
  error: string | null;
  onRun: (args: { startISO: string; endISO: string; onlyFillRequired: boolean }) => void;
  onReset: (args: { startISO: string; endISO: string }) => void;
};

const formatEuropeanDate = (dateISO: string) => {
  const [year, month, day] = dateISO.split("-");
  if (!year || !month || !day) return dateISO;
  return `${day}.${month}.${year}`;
};

const parseEuropeanDate = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;
  const [, dayRaw, monthRaw, yearRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month) {
    return null;
  }
  return `${yearRaw.padStart(4, "0")}-${monthRaw.padStart(2, "0")}-${dayRaw.padStart(
    2,
    "0",
  )}`;
};

export default function AutomatedPlanningPanel({
  weekStartISO,
  weekEndISO,
  isRunning,
  progress,
  startedAt,
  lastRunTotalDays,
  lastRunDurationMs,
  error,
  onRun,
  onReset,
}: AutomatedPlanningPanelProps) {
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [hasTouched, setHasTouched] = useState(false);
  const [strategy, setStrategy] = useState<"fill" | "distribute">("fill");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (hasTouched) return;
    setStartInput(formatEuropeanDate(weekStartISO));
    setEndInput(formatEuropeanDate(weekEndISO));
  }, [weekStartISO, weekEndISO, hasTouched]);

  const [elapsedLabel, setElapsedLabel] = useState("0:00");
  const formatDuration = (valueMs: number) => {
    const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  };
  useEffect(() => {
    if (!isRunning || !startedAt) {
      setElapsedLabel("0:00");
      return;
    }
    const update = () => {
      const elapsedMs = Date.now() - startedAt;
      setElapsedLabel(formatDuration(elapsedMs));
    };
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [isRunning, startedAt]);

  const progressLabel = useMemo(() => {
    if (!progress) return null;
    if (isRunning && progress.current === 0) {
      const estimate =
        typeof lastRunDurationMs === "number" &&
        typeof lastRunTotalDays === "number" &&
        lastRunTotalDays > 0
          ? ` • ETA ~${formatDuration(
              (lastRunDurationMs / lastRunTotalDays) * progress.total,
            )}`
          : "";
      return `Solving full range (${progress.total} days) • ${elapsedLabel}${estimate}`;
    }
    return `${progress.current}/${progress.total} days planned`;
  }, [progress, isRunning, elapsedLabel, lastRunDurationMs, lastRunTotalDays]);

  const parseRange = () => {
    const startISO = parseEuropeanDate(startInput);
    const endISO = parseEuropeanDate(endInput);
    if (!startISO || !endISO) {
      setLocalError("Use DD.MM.YYYY for the timeframe.");
      return null;
    }
    if (startISO > endISO) {
      setLocalError("Start date must be on or before end date.");
      return null;
    }
    setLocalError(null);
    return { startISO, endISO };
  };

  const visibleWeekActive = useMemo(() => {
    const startISO = parseEuropeanDate(startInput);
    const endISO = parseEuropeanDate(endInput);
    if (!startISO || !endISO) return false;
    return startISO === weekStartISO && endISO === weekEndISO;
  }, [startInput, endInput, weekStartISO, weekEndISO]);

  const todayActive = useMemo(() => {
    const startISO = parseEuropeanDate(startInput);
    const endISO = parseEuropeanDate(endInput);
    if (!startISO || !endISO) return false;
    const todayISO = toISODate(new Date());
    return startISO === todayISO && endISO === todayISO;
  }, [startInput, endInput]);

  const handleUseVisibleWeek = () => {
    setHasTouched(false);
    setStartInput(formatEuropeanDate(weekStartISO));
    setEndInput(formatEuropeanDate(weekEndISO));
    setLocalError(null);
  };

  const handleUseToday = () => {
    const todayISO = toISODate(new Date());
    const formatted = formatEuropeanDate(todayISO);
    setHasTouched(true);
    setStartInput(formatted);
    setEndInput(formatted);
    setLocalError(null);
  };

  const handleRun = () => {
    const range = parseRange();
    if (!range) return;
    onRun({
      startISO: range.startISO,
      endISO: range.endISO,
      onlyFillRequired: strategy === "fill",
    });
  };

  const handleReset = () => {
    const range = parseRange();
    if (!range) return;
    const label = `${formatEuropeanDate(range.startISO)} - ${formatEuropeanDate(
      range.endISO,
    )}`;
    const confirmed = window.confirm(
      `Reset assignments for ${label}?`,
    );
    if (!confirmed) return;
    onReset({ startISO: range.startISO, endISO: range.endISO });
  };

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:max-w-xs sm:px-4">
      <div className="flex flex-col gap-4">
        <div className={cx("-mt-7 inline-flex self-start", pillLabel.base)}>
          Automated Shift Planning
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <div className="text-xs font-normal uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Timeframe
              </div>
              <button
                type="button"
                onClick={handleUseVisibleWeek}
                disabled={isRunning}
                className={getPillToggleClasses(visibleWeekActive)}
              >
                Current week
              </button>
              <button
                type="button"
                onClick={handleUseToday}
                disabled={isRunning}
                className={getPillToggleClasses(todayActive)}
              >
                Today
              </button>
            </div>
            <div className="flex items-center gap-2">
              <CustomDatePicker
                value={startInput}
                onChange={(value) => {
                  setHasTouched(true);
                  setStartInput(value);
                  setLocalError(null);
                }}
                placeholder="Start"
                disabled={isRunning}
                className="w-[120px]"
              />
              <span className="text-xs font-semibold text-slate-400">–</span>
              <CustomDatePicker
                value={endInput}
                onChange={(value) => {
                  setHasTouched(true);
                  setEndInput(value);
                  setLocalError(null);
                }}
                placeholder="End"
                disabled={isRunning}
                className="w-[120px]"
              />
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div className="text-xs font-normal uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Strategy
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setStrategy("fill")}
                disabled={isRunning}
                className={getPillToggleClasses(strategy === "fill")}
              >
                Fill open slots
              </button>
              <button
                type="button"
                onClick={() => setStrategy("distribute")}
                disabled={isRunning}
                className={getPillToggleClasses(strategy === "distribute")}
              >
                Distribute all
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={handleRun}
              disabled={isRunning}
              className={buttonPrimary.base}
            >
              {isRunning ? "Planning..." : "Run"}
            </button>
            {progressLabel ? (
              <div className="text-xs font-normal text-slate-500 dark:text-slate-300">
                {progressLabel}
              </div>
            ) : null}
          </div>
          <div className="flex sm:justify-end">
            <button
              type="button"
              onClick={handleReset}
              disabled={isRunning}
              className={buttonSecondary.base}
            >
              Reset
            </button>
          </div>
        </div>
      </div>
      {localError || error ? (
        <div className="mt-3 text-xs font-normal text-rose-600 dark:text-rose-200">
          {localError ?? error}
        </div>
      ) : null}
    </div>
  );
}
