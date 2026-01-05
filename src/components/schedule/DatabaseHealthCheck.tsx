import { useState } from "react";
import { checkDatabaseHealth, type DatabaseHealthCheckResult, type DatabaseHealthIssue } from "../../api/client";
import { cx } from "../../lib/classNames";

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function WarningIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ErrorIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className}
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function IssueCard({ issue }: { issue: DatabaseHealthIssue }) {
  const [expanded, setExpanded] = useState(false);

  const typeLabels: Record<string, string> = {
    orphaned_assignment: "Orphaned Assignments",
    slot_collision: "Slot Collisions",
    duplicate_assignment: "Duplicate Assignments",
    colband_explosion: "ColBand Overflow",
  };

  const isError = issue.severity === "error";

  return (
    <div
      className={cx(
        "rounded-lg border p-3",
        isError
          ? "border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20"
          : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20"
      )}
    >
      <div className="flex items-start gap-2">
        {isError ? (
          <ErrorIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />
        ) : (
          <WarningIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={cx(
                "text-xs font-medium uppercase tracking-wide",
                isError ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"
              )}
            >
              {typeLabels[issue.type] || issue.type}
            </span>
            <span
              className={cx(
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                isError
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
              )}
            >
              {isError ? "Error" : "Warning"}
            </span>
          </div>
          <p
            className={cx(
              "mt-1 text-sm",
              isError ? "text-rose-700 dark:text-rose-300" : "text-amber-700 dark:text-amber-300"
            )}
          >
            {issue.message}
          </p>
          {Object.keys(issue.details).length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className={cx(
                "mt-2 text-xs font-medium",
                isError
                  ? "text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-200"
                  : "text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200"
              )}
            >
              {expanded ? "Hide Details" : "Show Details"}
            </button>
          )}
          {expanded && (
            <pre className="mt-2 max-h-40 overflow-auto rounded bg-white/50 p-2 text-xs text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              {JSON.stringify(issue.details, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DatabaseHealthCheck() {
  const [result, setResult] = useState<DatabaseHealthCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runHealthCheck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await checkDatabaseHealth();
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run health check");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Database Health Check
        </h3>
        <button
          type="button"
          onClick={runHealthCheck}
          disabled={loading}
          className={cx(
            "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            loading
              ? "cursor-not-allowed bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500"
              : "bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-400 dark:hover:bg-indigo-900/50"
          )}
        >
          {loading ? "Checking..." : "Run Check"}
        </button>
      </div>

      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        Check for data integrity issues like orphaned assignments, slot collisions, and database inconsistencies.
      </p>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-300">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-3">
          {/* Status banner */}
          <div
            className={cx(
              "flex items-center gap-2 rounded-lg p-3",
              result.healthy
                ? "bg-emerald-50 dark:bg-emerald-900/20"
                : "bg-slate-100 dark:bg-slate-800"
            )}
          >
            {result.healthy ? (
              <>
                <CheckIcon className="h-5 w-5 text-emerald-500" />
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  Database is healthy
                </span>
              </>
            ) : (
              <>
                <WarningIcon className="h-5 w-5 text-amber-500" />
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {result.issues.length} issue{result.issues.length !== 1 ? "s" : ""} found
                </span>
              </>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-3 text-center dark:bg-slate-800">
            <div>
              <div className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                {result.stats.totalAssignments}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Assignments
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                {result.stats.totalSlots}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Slots
              </div>
            </div>
            <div>
              <div className="text-lg font-semibold text-slate-700 dark:text-slate-200">
                {result.stats.totalClinicians}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Clinicians
              </div>
            </div>
          </div>

          {/* Issues */}
          {result.issues.length > 0 && (
            <div className="space-y-2">
              {result.issues.map((issue, index) => (
                <IssueCard key={index} issue={issue} />
              ))}
            </div>
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          Click "Run Check" to analyze your database
        </div>
      )}
    </div>
  );
}
