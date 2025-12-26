import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";
import { cx } from "../../lib/classNames";

type IcalExportModalProps = {
  open: boolean;
  onClose: () => void;
  clinicians: Array<{ id: string; name: string }>;
  defaultStartISO: string;
  defaultEndISO: string;
  onDownloadAll: (range: { startISO?: string; endISO?: string }) => void;
  onDownloadClinician: (
    clinicianId: string,
    range: { startISO?: string; endISO?: string },
  ) => void;
};

export default function IcalExportModal({
  open,
  onClose,
  clinicians,
  defaultStartISO,
  defaultEndISO,
  onDownloadAll,
  onDownloadClinician,
}: IcalExportModalProps) {
  const [startText, setStartText] = useState<string>("");
  const [endText, setEndText] = useState<string>("");

  const isoToEuropean = (dateISO: string) => {
    const [year, month, day] = dateISO.split("-");
    if (!year || !month || !day) return dateISO;
    return `${day}.${month}.${year}`;
  };

  const parseDateInput = (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0) return { iso: undefined as string | undefined, valid: true };
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

  useEffect(() => {
    if (!open) return;
    setStartText(isoToEuropean(defaultStartISO));
    setEndText(isoToEuropean(defaultEndISO));
  }, [defaultEndISO, defaultStartISO, open]);

  const range = useMemo(() => {
    const parsedStart = parseDateInput(startText);
    const parsedEnd = parseDateInput(endText);
    const start = parsedStart.valid ? parsedStart.iso : undefined;
    const end = parsedEnd.valid ? parsedEnd.iso : undefined;
    if (start && end && start > end) {
      return { startISO: end, endISO: start };
    }
    return { startISO: start, endISO: end };
  }, [endText, startText]);

  const validation = useMemo(() => {
    const parsedStart = parseDateInput(startText);
    const parsedEnd = parseDateInput(endText);
    return {
      startValid: parsedStart.valid,
      endValid: parsedEnd.valid,
      hasError: !parsedStart.valid || !parsedEnd.valid,
    };
  }, [endText, startText]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-slate-900/30 backdrop-blur-[1px] dark:bg-slate-950/50"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative mx-auto mt-24 w-full max-w-2xl px-6">
        <div className="flex max-h-[80vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5 dark:border-slate-800">
            <div>
              <div className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                Download iCal (.ics)
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                One iCal file can contain multiple dates and multiple events.
              </div>
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

          <div className="min-h-0 overflow-y-auto px-6 py-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              Export your assignments as calendar events:
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Each assignment becomes an all-day event on that date.</li>
                <li>Only class assignments are exported (not pool rows).</li>
              </ul>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Time range
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setStartText(isoToEuropean(defaultStartISO));
                      setEndText(isoToEuropean(defaultEndISO));
                    }}
                    className={cx(
                      "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700",
                      "hover:bg-slate-50 active:bg-slate-100",
                      "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
                    )}
                  >
                    Current week
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStartText("");
                      setEndText("");
                    }}
                    className={cx(
                      "rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700",
                      "hover:bg-slate-50 active:bg-slate-100",
                      "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
                    )}
                  >
                    All dates
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-300">
                    Start (inclusive)
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
                    End (inclusive)
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="DD.MM.YYYY"
                    value={endText}
                    onChange={(e) => setEndText(e.target.value)}
                    className={cx(
                      "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900",
                      "focus:border-sky-300 focus:outline-none",
                      "dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                      !validation.endValid && "border-rose-300 bg-rose-50/50",
                    )}
                  />
                </label>
              </div>
              {validation.hasError ? (
                <div className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-300">
                  Invalid date format. Use DD.MM.YYYY.
                </div>
              ) : (
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Leave Start/End empty to export everything. If Start is after End,
                  the range is automatically swapped.
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Download
              </div>
              <button
                type="button"
                onClick={() => onDownloadAll(range)}
                disabled={validation.hasError}
                className={cx(
                  "inline-flex items-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900",
                  "hover:bg-slate-50 active:bg-slate-100",
                  "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                All clinicians (one file)
              </button>
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
              <div className="bg-white px-4 py-2 text-xs font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-300">
                Individual files
              </div>
              <div className="divide-y divide-slate-200 dark:divide-slate-800">
                {clinicians.map((clinician) => (
                  <div
                    key={clinician.id}
                    className="flex items-center justify-between gap-3 bg-white px-4 py-3 dark:bg-slate-900"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {clinician.name}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDownloadClinician(clinician.id, range)}
                      disabled={validation.hasError}
                      className={cx(
                        "inline-flex items-center rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-900",
                        "hover:bg-slate-50 active:bg-slate-100",
                        "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                      )}
                    >
                      Download
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">
              Tip: Import the downloaded <span className="font-semibold">.ics</span>{" "}
              file into your calendar app (Google Calendar, Apple Calendar, Outlook).
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
