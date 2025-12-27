import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { cx } from "../../lib/classNames";

type PdfExportModalProps = {
  open: boolean;
  onClose: () => void;
  defaultStartISO: string;
  onExport: (args: { startISO: string; weeks: number }) => void;
  exporting: boolean;
  progress?: { current: number; total: number } | null;
  error?: string | null;
};

const isoToEuropean = (dateISO: string) => {
  const [year, month, day] = dateISO.split("-");
  if (!year || !month || !day) return dateISO;
  return `${day}.${month}.${year}`;
};

const parseDateInput = (value: string) => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { iso: undefined as string | undefined, valid: false };
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return { iso: trimmed, valid: true };
  const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!dotMatch) return { iso: undefined as string | undefined, valid: false };
  const [, dayRaw, monthRaw, yearRaw] = dotMatch;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
    return { iso: undefined as string | undefined, valid: false };
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return { iso: undefined as string | undefined, valid: false };
  }
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return { iso: `${yyyy}-${mm}-${dd}`, valid: true };
};

export default function PdfExportModal({
  open,
  onClose,
  defaultStartISO,
  onExport,
  exporting,
  progress,
  error,
}: PdfExportModalProps) {
  const [startText, setStartText] = useState("");
  const [weeksText, setWeeksText] = useState("2");

  useEffect(() => {
    if (!open) return;
    setStartText(isoToEuropean(defaultStartISO));
    setWeeksText("2");
  }, [defaultStartISO, open]);

  const validation = useMemo(() => {
    const parsed = parseDateInput(startText);
    const weeks = Number(weeksText);
    return {
      startValid: parsed.valid,
      startISO: parsed.iso,
      weeksValid: Number.isFinite(weeks) && weeks >= 1 && weeks <= 24,
      weeks: Math.trunc(weeks),
    };
  }, [startText, weeksText]);

  const canSubmit = validation.startValid && validation.weeksValid && !exporting;

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-900/30 backdrop-blur-[1px] dark:bg-slate-950/50"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative mx-auto mt-24 w-full max-w-xl px-6">
        <div className="flex max-h-[80vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 dark:border-slate-800">
            <div>
              <div className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Export multiple weeks
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Export multiple weeks as separate PDF files.
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={exporting}
              className={cx(
                "rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900",
                "hover:bg-slate-50 active:bg-slate-100",
                "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              Close
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                  Start week (DD.MM.YYYY)
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD.MM.YYYY"
                  value={startText}
                  onChange={(e) => setStartText(e.target.value)}
                  className={cx(
                    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900",
                    "focus:border-sky-300 focus:outline-none",
                    "dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                    !validation.startValid && "border-rose-300 bg-rose-50/50",
                  )}
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                  Number of weeks
                </span>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={weeksText}
                  onChange={(e) => setWeeksText(e.target.value)}
                  className={cx(
                    "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900",
                    "focus:border-sky-300 focus:outline-none",
                    "dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                    !validation.weeksValid && "border-rose-300 bg-rose-50/50",
                  )}
                />
              </label>
            </div>

            {!validation.startValid || !validation.weeksValid ? (
              <div className="mt-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
                Enter a valid start date and a number of weeks (1–24).
              </div>
            ) : null}

            {error ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/30 dark:text-rose-200">
                {error}
              </div>
            ) : null}

            {progress ? (
              <div className="mt-3 text-xs font-semibold text-slate-600 dark:text-slate-300">
                Exporting {progress.current} of {progress.total} weeks…
              </div>
            ) : null}

            <div className="mt-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!validation.startISO) return;
                  onExport({ startISO: validation.startISO, weeks: validation.weeks });
                }}
                disabled={!canSubmit}
                className={cx(
                  "inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900",
                  "hover:bg-slate-50 active:bg-slate-100",
                  "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                Export
              </button>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                PDFs will download one by one.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
