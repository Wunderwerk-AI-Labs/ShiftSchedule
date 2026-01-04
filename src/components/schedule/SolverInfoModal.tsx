import { useState } from "react";
import { createPortal } from "react-dom";
import type { SolverDebugInfo } from "../../api/client";
import { cx } from "../../lib/classNames";
import SolverDebugPanel from "./SolverDebugPanel";

export type SolverHistoryEntry = {
  id: string;
  startISO: string;
  endISO: string;
  startedAt: number;
  endedAt: number;
  status: "success" | "aborted" | "error";
  notes: string[];
  debugInfo?: SolverDebugInfo;
};

type SolverInfoModalProps = {
  isOpen: boolean;
  onClose: () => void;
  history: SolverHistoryEntry[];
  timeoutSeconds: number;
  onTimeoutChange: (seconds: number) => void;
};


const formatEuropeanDate = (dateISO: string) => {
  const [year, month, day] = dateISO.split("-");
  if (!year || !month || !day) return dateISO;
  return `${day}.${month}.${year}`;
};

const formatDateTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}.${month}. ${hours}:${minutes}`;
};

const formatDuration = (ms: number) => {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${minutes}m ${secs}s`;
};

function GearIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path d="M15.5 2A1.5 1.5 0 0014 3.5v13a1.5 1.5 0 001.5 1.5h1a1.5 1.5 0 001.5-1.5v-13A1.5 1.5 0 0016.5 2h-1zM9.5 6A1.5 1.5 0 008 7.5v9A1.5 1.5 0 009.5 18h1a1.5 1.5 0 001.5-1.5v-9A1.5 1.5 0 0010.5 6h-1zM3.5 10A1.5 1.5 0 002 11.5v5A1.5 1.5 0 003.5 18h1A1.5 1.5 0 006 16.5v-5A1.5 1.5 0 004.5 10h-1z" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
    </svg>
  );
}

function BackIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z"
        clipRule="evenodd"
      />
    </svg>
  );
}

type View = "info" | "detail";

export default function SolverInfoModal({
  isOpen,
  onClose,
  history,
  timeoutSeconds,
  onTimeoutChange,
}: SolverInfoModalProps) {
  const [view, setView] = useState<View>("info");
  const [selectedEntry, setSelectedEntry] = useState<SolverHistoryEntry | null>(null);

  if (!isOpen) return null;

  const handleClose = () => {
    setView("info");
    setSelectedEntry(null);
    onClose();
  };

  const handleViewDetail = (entry: SolverHistoryEntry) => {
    setSelectedEntry(entry);
    setView("detail");
  };

  const handleBack = () => {
    if (view === "detail") {
      setSelectedEntry(null);
      setView("info");
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <button
        className="absolute inset-0 cursor-default bg-slate-900/30 backdrop-blur-[1px]"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative mx-auto mt-16 w-full max-w-2xl px-4">
        <div
          role="dialog"
          aria-modal="true"
          className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="flex items-center gap-2">
              {view !== "info" && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <BackIcon className="h-5 w-5" />
                </button>
              )}
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
                {view === "info" && "About Automated Planning"}
                {view === "detail" && "Run Details"}
              </h2>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            >
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>

          {/* Content */}
          <div className="max-h-[70vh] overflow-auto p-4">
            {view === "info" && (
              <div className="flex flex-col gap-4">
                {/* Layman description */}
                <div className="flex flex-col gap-3 text-sm text-slate-600 dark:text-slate-300">
                  <p>
                    The automated planner uses an optimization algorithm to find the best
                    possible shift assignments for your team. It considers:
                  </p>
                  <ul className="ml-4 list-disc space-y-1.5 text-slate-500 dark:text-slate-400">
                    <li>Each clinician's qualifications and working hours</li>
                    <li>Vacation days and rest day requirements</li>
                    <li>Slot coverage requirements (minimum staffing)</li>
                    <li>Preferred time windows and continuous shift preferences</li>
                    <li>Fair distribution of workload across the team</li>
                  </ul>
                  <p>
                    The solver explores thousands of possible combinations to find an
                    assignment that satisfies all constraints while maximizing fairness
                    and preferences.
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Longer date ranges or more clinicians will require more time to solve.
                    You can abort at any time and keep the best solution found so far.
                  </p>
                </div>

                {/* Max Runtime setting */}
                <div className="flex flex-col gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    Max Runtime
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="3600"
                      value={timeoutSeconds}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        if (!isNaN(val) && val >= 1 && val <= 3600) {
                          onTimeoutChange(val);
                        }
                      }}
                      className="w-20 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-indigo-400 dark:focus:ring-indigo-400"
                    />
                    <span className="text-sm text-slate-500 dark:text-slate-400">seconds</span>
                  </div>
                </div>

                {/* Recent runs list */}
                {history.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      Recent Runs
                    </div>
                    {history.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => handleViewDetail(entry)}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600 dark:hover:bg-slate-700"
                      >
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                              {formatEuropeanDate(entry.startISO)} – {formatEuropeanDate(entry.endISO)}
                            </span>
                            <span
                              className={cx(
                                "rounded-full px-2 py-0.5 text-xs font-medium",
                                entry.status === "success" &&
                                  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
                                entry.status === "aborted" &&
                                  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
                                entry.status === "error" &&
                                  "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                              )}
                            >
                              {entry.status === "success" && "Completed"}
                              {entry.status === "aborted" && "Aborted"}
                              {entry.status === "error" && "Error"}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                            <span>{formatDateTime(entry.startedAt)}</span>
                            <span>•</span>
                            <span>{formatDuration(entry.endedAt - entry.startedAt)}</span>
                          </div>
                        </div>
                        <ChartIcon className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {view === "detail" && selectedEntry && (
              <div className="flex flex-col gap-4">
                {/* Summary */}
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div className="text-slate-500 dark:text-slate-400">Date Range</div>
                    <div className="font-medium text-slate-700 dark:text-slate-200">
                      {formatEuropeanDate(selectedEntry.startISO)} – {formatEuropeanDate(selectedEntry.endISO)}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">Started</div>
                    <div className="font-medium text-slate-700 dark:text-slate-200">
                      {formatDateTime(selectedEntry.startedAt)}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">Duration</div>
                    <div className="font-medium text-slate-700 dark:text-slate-200">
                      {formatDuration(selectedEntry.endedAt - selectedEntry.startedAt)}
                    </div>
                    <div className="text-slate-500 dark:text-slate-400">Status</div>
                    <div
                      className={cx(
                        "font-medium",
                        selectedEntry.status === "success" && "text-emerald-600 dark:text-emerald-400",
                        selectedEntry.status === "aborted" && "text-amber-600 dark:text-amber-400",
                        selectedEntry.status === "error" && "text-rose-600 dark:text-rose-400"
                      )}
                    >
                      {selectedEntry.status === "success" && "Completed"}
                      {selectedEntry.status === "aborted" && "Aborted"}
                      {selectedEntry.status === "error" && "Error"}
                    </div>
                  </div>
                </div>

                {/* Notes */}
                {selectedEntry.notes.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-amber-50 p-3 dark:border-slate-700 dark:bg-amber-900/20">
                    <div className="text-xs font-medium text-amber-700 dark:text-amber-400">
                      Notes
                    </div>
                    <ul className="mt-1 space-y-0.5 text-xs text-amber-600 dark:text-amber-300">
                      {selectedEntry.notes.map((note, i) => (
                        <li key={i}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Debug info */}
                {selectedEntry.debugInfo ? (
                  <SolverDebugPanel debugInfo={selectedEntry.debugInfo} />
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                    Detailed timing data not available for this run.
                    <br />
                    <span className="text-xs">
                      Enable DEBUG_SOLVER=true on the backend for full details.
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Info button component to trigger the modal
export function SolverInfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded p-0.5 text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
      title="About Automated Planning"
    >
      <GearIcon className="h-4 w-4" />
    </button>
  );
}
