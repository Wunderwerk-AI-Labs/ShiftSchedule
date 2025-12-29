import { useEffect, useMemo, useState } from "react";
import { cx } from "../../lib/classNames";
import { toISODate } from "../../lib/date";

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
      `Reset assignments to the Distribution Pool for ${label}?`,
    );
    if (!confirmed) return;
    onReset({ startISO: range.startISO, endISO: range.endISO });
  };

  return (
    <div className="w-fit max-w-full rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950 sm:px-6">
      <div className="flex flex-col gap-4">
        <div className="-mt-7 inline-flex self-start rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-normal text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          Automated Shift Planning
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <div className="text-xs font-normal uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Timeframe (inclusive)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={startInput}
                onChange={(event) => {
                  setHasTouched(true);
                  setStartInput(event.target.value);
                  setLocalError(null);
                }}
                placeholder="Start DD.MM.YYYY"
                disabled={isRunning}
                className={cx(
                  "w-36 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                  "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:[color-scheme:dark]",
                )}
              />
              <input
                type="text"
                value={endInput}
                onChange={(event) => {
                  setHasTouched(true);
                  setEndInput(event.target.value);
                  setLocalError(null);
                }}
                placeholder="End DD.MM.YYYY"
                disabled={isRunning}
                className={cx(
                  "w-36 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                  "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:[color-scheme:dark]",
                )}
              />
              <button
                type="button"
                onClick={handleUseVisibleWeek}
                disabled={isRunning}
                className={cx(
                  "rounded-full border px-3 py-1.5 text-[11px] font-normal",
                  visibleWeekActive
                    ? "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-400/60 dark:bg-sky-900/30 dark:text-sky-100"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                Use visible week
              </button>
              <button
                type="button"
                onClick={handleUseToday}
                disabled={isRunning}
                className={cx(
                  "rounded-full border px-3 py-1.5 text-[11px] font-normal",
                  todayActive
                    ? "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-400/60 dark:bg-sky-900/30 dark:text-sky-100"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                Today
              </button>
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
                className={cx(
                  "rounded-full border px-3 py-1.5 text-xs font-normal",
                  strategy === "fill"
                    ? "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-400/60 dark:bg-sky-900/30 dark:text-sky-100"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                Fill open slots only
              </button>
              <button
                type="button"
                onClick={() => setStrategy("distribute")}
                disabled={isRunning}
                className={cx(
                  "rounded-full border px-3 py-1.5 text-xs font-normal",
                  strategy === "distribute"
                    ? "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-400/60 dark:bg-sky-900/30 dark:text-sky-100"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                Distribute all people from Distribution Pool
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
              className={cx(
                "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-normal text-slate-900 shadow-sm",
                "hover:bg-slate-50 active:bg-slate-100",
                "disabled:cursor-not-allowed disabled:opacity-70",
                "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
              )}
            >
              {isRunning ? "Planning..." : "Run automated planning"}
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
              className={cx(
                "rounded-xl border border-slate-200 px-4 py-2 text-sm font-normal text-slate-700",
                "hover:bg-slate-50 active:bg-slate-100",
                "disabled:cursor-not-allowed disabled:opacity-60",
                "dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800",
              )}
            >
              Reset to Distribution Pool...
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
