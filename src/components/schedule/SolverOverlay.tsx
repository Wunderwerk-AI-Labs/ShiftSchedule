import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Assignment } from "../../api/client";

export type LiveSolution = {
  solution_num: number;
  time_ms: number;
  objective: number;
  assignments?: Assignment[];
};

type SolverOverlayProps = {
  isVisible: boolean;
  progress: { current: number; total: number } | null;
  elapsedMs: number;
  solveRange: { startISO: string; endISO: string } | null;
  displayedRange: { startISO: string; endISO: string };
  onAbort: () => void;
  liveSolutions?: LiveSolution[];
};

const formatDuration = (valueMs: number) => {
  const totalSeconds = Math.max(0, Math.floor(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const formatEuropeanDate = (dateISO: string) => {
  const [year, month, day] = dateISO.split("-");
  if (!year || !month || !day) return dateISO;
  return `${day}.${month}.${year}`;
};

// Check if two date ranges overlap
const rangesOverlap = (
  range1: { startISO: string; endISO: string },
  range2: { startISO: string; endISO: string },
): boolean => {
  return range1.startISO <= range2.endISO && range1.endISO >= range2.startISO;
};

// Minimal live chart for solutions - inverted so better (lower) scores appear higher, with log scale
function LiveSolutionChart({ solutions, elapsedMs }: { solutions: LiveSolution[]; elapsedMs: number }) {
  if (solutions.length === 0) return null;

  const chartWidth = 500;
  const chartHeight = 140;
  const padding = { top: 15, right: 15, bottom: 25, left: 55 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Time range: 0 to max(elapsedMs, last solution time) + some padding
  const maxTimeMs = Math.max(elapsedMs, ...solutions.map((s) => s.time_ms)) * 1.1;
  const maxTimeSec = maxTimeMs / 1000;

  // Get min/max objectives (min is best)
  const minObjective = Math.min(...solutions.map((s) => s.objective));
  const maxObjective = Math.max(...solutions.map((s) => s.objective));

  // Calculate distances from minimum (for log scale)
  // Transform: distance from best = objective - minObjective
  const maxDistance = maxObjective - minObjective;
  const logMaxDistance = maxDistance > 0 ? Math.log10(maxDistance + 1) : 1;

  // Build path points with step function (each solution extends to the next one's time)
  // Y-axis is INVERTED with LOG SCALE: lower objective (better) = higher on chart
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < solutions.length; i++) {
    const s = solutions[i];
    // Distance from best (0 for best solution, larger for worse)
    const distance = s.objective - minObjective;
    // Log scale: compress large differences
    const logDistance = distance > 0 ? Math.log10(distance + 1) : 0;
    // Invert: best (logDistance=0) at top, worst at bottom
    const normalized = 1 - logDistance / logMaxDistance;

    const x = padding.left + (s.time_ms / 1000 / maxTimeSec) * innerWidth;
    const y = padding.top + (1 - normalized) * innerHeight;

    points.push({ x, y });

    // Extend horizontally to next solution or to current time
    const nextTime = i < solutions.length - 1 ? solutions[i + 1].time_ms : elapsedMs;
    const nextX = padding.left + (nextTime / 1000 / maxTimeSec) * innerWidth;
    points.push({ x: nextX, y });
  }

  const linePath =
    points.length > 0
      ? `M ${points.map((p) => `${p.x},${p.y}`).join(" L ")}`
      : "";

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={chartWidth} height={chartHeight} className="overflow-visible">
        {/* Grid lines */}
        <line
          x1={padding.left}
          y1={chartHeight - padding.bottom}
          x2={chartWidth - padding.right}
          y2={chartHeight - padding.bottom}
          stroke="currentColor"
          strokeOpacity={0.2}
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={chartHeight - padding.bottom}
          stroke="currentColor"
          strokeOpacity={0.2}
        />

        {/* Solution line */}
        {linePath && (
          <path d={linePath} fill="none" stroke="#6366f1" strokeWidth={2} />
        )}

        {/* Solution dots */}
        {points
          .filter((_, i) => i % 2 === 0)
          .map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={3} fill="#6366f1" />
          ))}

        {/* Y-axis label */}
        <text
          x={padding.left - 8}
          y={chartHeight / 2}
          textAnchor="middle"
          transform={`rotate(-90, ${padding.left - 8}, ${chartHeight / 2})`}
          className="fill-current text-[9px] opacity-50"
        >
          Score
        </text>

        {/* Y-axis values: top = best (min), bottom = worst (max) */}
        <text
          x={padding.left - 4}
          y={padding.top + 3}
          textAnchor="end"
          className="fill-current text-[9px] opacity-60"
        >
          {minObjective}
        </text>
        <text
          x={padding.left - 4}
          y={chartHeight - padding.bottom}
          textAnchor="end"
          className="fill-current text-[9px] opacity-60"
        >
          {maxObjective}
        </text>

        {/* X-axis label */}
        <text
          x={chartWidth / 2}
          y={chartHeight - 2}
          textAnchor="middle"
          className="fill-current text-[9px] opacity-50"
        >
          Time (s)
        </text>

        {/* Time markers */}
        <text
          x={padding.left}
          y={chartHeight - 8}
          textAnchor="start"
          className="fill-current text-[9px] opacity-40"
        >
          0
        </text>
        <text
          x={chartWidth - padding.right}
          y={chartHeight - 8}
          textAnchor="end"
          className="fill-current text-[9px] opacity-40"
        >
          {maxTimeSec.toFixed(1)}
        </text>
      </svg>
      <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
        <span>Solutions: {solutions.length}</span>
        <span>Best: {minObjective}</span>
      </div>
    </div>
  );
}

function ChevronIcon({ className, expanded }: { className?: string; expanded: boolean }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`${className} transition-transform ${expanded ? "rotate-180" : ""}`}
    >
      <path
        fillRule="evenodd"
        d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatImprovement(current: number, previous: number): string {
  const diff = current - previous;
  const pct = (diff / Math.abs(previous)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

export default function SolverOverlay({
  isVisible,
  progress,
  elapsedMs,
  solveRange,
  displayedRange,
  onAbort,
  liveSolutions = [],
}: SolverOverlayProps) {
  const [gridElement, setGridElement] = useState<HTMLElement | null>(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);

  // Check if the displayed week overlaps with the solve range
  const hasOverlap =
    isVisible && solveRange && rangesOverlap(solveRange, displayedRange);

  // Find the schedule grid element once when overlay becomes visible
  useEffect(() => {
    if (!hasOverlap) {
      setGridElement(null);
      return;
    }

    const grid = document.querySelector('[data-schedule-grid="true"]') as HTMLElement | null;
    setGridElement(grid);
  }, [hasOverlap]);

  // Don't render if no overlap or no grid element
  if (!hasOverlap || !gridElement) return null;

  const dateRangeLabel = solveRange
    ? `${formatEuropeanDate(solveRange.startISO)} – ${formatEuropeanDate(solveRange.endISO)}`
    : null;

  return createPortal(
    <div
      className="absolute inset-0 z-[100] flex items-center justify-center overflow-hidden"
      style={{
        pointerEvents: "auto",
      }}
    >
      {/* Semi-transparent overlay without backdrop-blur to avoid bleeding */}
      <div className="absolute inset-0 bg-white/70 dark:bg-slate-900/70" />

      {/* Content panel - 90% width of calendar */}
      <div
        className="relative z-10 mx-4 flex max-w-[90%] flex-col items-center gap-5 rounded-2xl border border-slate-200 bg-white px-8 py-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        {/* Animated spinner */}
        <div className="relative h-14 w-14">
          <svg
            className="h-14 w-14 animate-spin"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="32"
              cy="32"
              r="28"
              stroke="currentColor"
              strokeWidth="4"
              className="text-slate-200 dark:text-slate-700"
            />
            <path
              d="M32 4a28 28 0 0 1 28 28"
              stroke="currentColor"
              strokeWidth="4"
              strokeLinecap="round"
              className="text-indigo-500"
            />
          </svg>
        </div>

        {/* Title and date range */}
        <div className="flex flex-col items-center gap-1">
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
            Optimizing Schedule
          </h3>
          {dateRangeLabel && (
            <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400">
              {dateRangeLabel}
            </p>
          )}
          <p className="mt-1 text-center text-xs text-slate-500 dark:text-slate-400">
            Schedule is locked during optimization
          </p>
        </div>

        {/* Live solutions chart */}
        {liveSolutions.length > 0 && (
          <LiveSolutionChart solutions={liveSolutions} elapsedMs={elapsedMs} />
        )}

        {/* Collapsible Details section */}
        {liveSolutions.length > 0 && (
          <div className="w-full max-w-md">
            <button
              type="button"
              onClick={() => setDetailsExpanded(!detailsExpanded)}
              className="flex w-full items-center justify-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
            >
              <span>Details</span>
              <ChevronIcon className="h-4 w-4" expanded={detailsExpanded} />
            </button>
            {detailsExpanded && (
              <div className="mt-2 max-h-32 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-xs">
                  <thead className="sticky top-0">
                    <tr className="bg-slate-50 dark:bg-slate-800">
                      <th className="px-2 py-1 text-left font-medium text-slate-600 dark:text-slate-300">#</th>
                      <th className="px-2 py-1 text-right font-medium text-slate-600 dark:text-slate-300">Time</th>
                      <th className="px-2 py-1 text-right font-medium text-slate-600 dark:text-slate-300">Score</th>
                      <th className="px-2 py-1 text-right font-medium text-slate-600 dark:text-slate-300">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {liveSolutions.map((sol, i) => {
                      const prevObj = i > 0 ? liveSolutions[i - 1].objective : sol.objective;
                      return (
                        <tr
                          key={sol.solution_num}
                          className={i % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50/50 dark:bg-slate-800/50"}
                        >
                          <td className="px-2 py-1 text-slate-700 dark:text-slate-200">{sol.solution_num}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {formatMs(sol.time_ms)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {sol.objective}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-slate-500 dark:text-slate-400">
                            {i === 0 ? "—" : formatImprovement(sol.objective, prevObj)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Elapsed time */}
        <div className="text-sm text-slate-500 dark:text-slate-400">
          {formatDuration(elapsedMs)}
        </div>

        {/* Action button - changes to "Apply Solution" once a solution is found */}
        {liveSolutions.length > 0 ? (
          <button
            type="button"
            onClick={onAbort}
            className="rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-sm font-medium text-indigo-600 transition-colors hover:border-indigo-300 hover:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:border-indigo-700 dark:hover:bg-indigo-900"
          >
            Apply Solution
          </button>
        ) : (
          <button
            type="button"
            onClick={onAbort}
            className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-1.5 text-sm font-medium text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-100 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300 dark:hover:border-rose-700 dark:hover:bg-rose-900"
          >
            Abort
          </button>
        )}
      </div>
    </div>,
    gridElement,
  );
}
