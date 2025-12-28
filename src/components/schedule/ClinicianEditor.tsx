import { useEffect, useState } from "react";
import { cx } from "../../lib/classNames";

type ClinicianEditorProps = {
  clinician: {
    id: string;
    name: string;
    qualifiedClassIds: string[];
    vacations: Array<{ id: string; startISO: string; endISO: string }>;
  };
  classRows: Array<{ id: string; name: string }>;
  onToggleQualification: (clinicianId: string, classId: string) => void;
  onReorderQualification: (
    clinicianId: string,
    fromClassId: string,
    toClassId: string,
  ) => void;
  onAddVacation: (clinicianId: string) => void;
  onUpdateVacation: (
    clinicianId: string,
    vacationId: string,
    updates: { startISO?: string; endISO?: string },
  ) => void;
  onRemoveVacation: (clinicianId: string, vacationId: string) => void;
};

export default function ClinicianEditor({
  clinician,
  classRows,
  onToggleQualification,
  onReorderQualification,
  onAddVacation,
  onUpdateVacation,
  onRemoveVacation,
}: ClinicianEditorProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [vacationDrafts, setVacationDrafts] = useState<Record<string, string>>(
    {},
  );
  const eligibleIds = clinician.qualifiedClassIds;
  const eligibleRows = eligibleIds
    .map((id) => classRows.find((row) => row.id === id))
    .filter((row): row is { id: string; name: string } => Boolean(row));
  const availableRows = classRows.filter((row) => !eligibleIds.includes(row.id));
  const [selectedClassId, setSelectedClassId] = useState("");
  const now = new Date();
  const todayISO = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  )
    .toISOString()
    .slice(0, 10);
  const sortedVacations = [...clinician.vacations].sort((a, b) =>
    a.startISO.localeCompare(b.startISO),
  );
  const pastVacations = sortedVacations.filter((v) => v.endISO < todayISO);
  const upcomingVacations = sortedVacations.filter((v) => v.endISO >= todayISO);

  const formatEuropeanDate = (dateISO: string) => {
    const [year, month, day] = dateISO.split("-");
    if (!year || !month || !day) return dateISO;
    return `${day}.${month}.${year}`;
  };

  const parseEuropeanDateInput = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
      if (
        date.getUTCFullYear() === Number(year) &&
        date.getUTCMonth() + 1 === Number(month) &&
        date.getUTCDate() === Number(day)
      ) {
        return `${year}-${month}-${day}`;
      }
      return null;
    }
    const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (!match) return null;
    const [, day, month, year] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
      date.getUTCFullYear() !== Number(year) ||
      date.getUTCMonth() + 1 !== Number(month) ||
      date.getUTCDate() !== Number(day)
    ) {
      return null;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  };

  const getDraftKey = (vacationId: string, field: "startISO" | "endISO") =>
    `${vacationId}-${field}`;

  const getVacationInputValue = (
    vacationId: string,
    field: "startISO" | "endISO",
    dateISO: string,
  ) => {
    const key = getDraftKey(vacationId, field);
    return vacationDrafts[key] ?? formatEuropeanDate(dateISO);
  };

  const clearVacationDraft = (key: string) => {
    setVacationDrafts((prev) => {
      if (!(key in prev)) return prev;
      const { [key]: _unused, ...rest } = prev;
      return rest;
    });
  };

  useEffect(() => {
    if (availableRows.length === 0) {
      if (selectedClassId) setSelectedClassId("");
      return;
    }
    if (!availableRows.some((row) => row.id === selectedClassId)) {
      setSelectedClassId(availableRows[0].id);
    }
  }, [availableRows, selectedClassId]);

  return (
    <div>
      <div className="relative mt-4 rounded-2xl border-2 border-sky-200 bg-sky-50/60 px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)] dark:border-sky-500/40 dark:bg-sky-900/20">
        <div className="absolute -top-3 left-4 rounded-full border border-sky-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-sky-600 dark:border-sky-500/40 dark:bg-slate-900 dark:text-sky-200">
          Eligible Sections
        </div>
        <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Drag to set priority, toggle to add or remove.
        </div>
        <div className="mt-4 space-y-2">
          {eligibleRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
              No eligible sections selected yet.
            </div>
          ) : (
            eligibleRows.map((row, index) => (
              <div
                key={row.id}
                className={cx(
                  "flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
                  dragOverId === row.id && "border-sky-300 bg-sky-50",
                )}
                onDragOver={(event) => {
                  if (!draggingId || draggingId === row.id) return;
                  event.preventDefault();
                  setDragOverId(row.id);
                }}
                onDragLeave={() => {
                  setDragOverId((prev) => (prev === row.id ? null : prev));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const fromId =
                    draggingId || event.dataTransfer.getData("text/plain");
                  if (!fromId || fromId === row.id) {
                    setDragOverId(null);
                    return;
                  }
                  onReorderQualification(clinician.id, fromId, row.id);
                  setDraggingId(null);
                  setDragOverId(null);
                }}
              >
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                  {index + 1}
                </span>
                <button
                  type="button"
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", row.id);
                    setDraggingId(row.id);
                  }}
                  onDragEnd={() => {
                    setDraggingId(null);
                    setDragOverId(null);
                  }}
                  className="cursor-grab rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  aria-label={`Reorder ${row.name}`}
                >
                  ≡
                </button>
                <span className="flex-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {row.name}
                </span>
                <button
                  type="button"
                  onClick={() => onToggleQualification(clinician.id, row.id)}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>
        {availableRows.length > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Add section
            </div>
            <select
              value={selectedClassId}
              onChange={(event) => setSelectedClassId(event.target.value)}
              className={cx(
                "rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700",
                "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
              )}
            >
              {availableRows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                if (!selectedClassId) return;
                onToggleQualification(clinician.id, selectedClassId);
              }}
              className={cx(
                "rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50",
                "dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800",
              )}
            >
              Add
            </button>
          </div>
        ) : null}
      </div>

      <div className="relative mt-6 rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 px-4 py-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.8)] dark:border-emerald-500/40 dark:bg-emerald-900/20">
        <div className="absolute -top-3 left-4 rounded-full border border-emerald-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:border-emerald-500/40 dark:bg-slate-900 dark:text-emerald-200">
          Vacation
        </div>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Vacation periods</div>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Define ranges to move the user into Vacation automatically.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onAddVacation(clinician.id)}
            className={cx(
              "rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600",
              "hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
            )}
          >
            Add Vacation
          </button>
        </div>

        <div className="mt-4 space-y-2">
          {upcomingVacations.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-300">
              No upcoming vacations.
            </div>
          ) : (
            upcomingVacations.map((vacation) => (
              <div
                key={vacation.id}
                className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900"
              >
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD.MM.YYYY"
                  value={getVacationInputValue(
                    vacation.id,
                    "startISO",
                    vacation.startISO,
                  )}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    const key = getDraftKey(vacation.id, "startISO");
                    setVacationDrafts((prev) => ({
                      ...prev,
                      [key]: nextValue,
                    }));
                    const parsed = parseEuropeanDateInput(nextValue);
                    if (parsed) {
                      onUpdateVacation(clinician.id, vacation.id, {
                        startISO: parsed,
                      });
                    }
                  }}
                  onBlur={() =>
                    clearVacationDraft(getDraftKey(vacation.id, "startISO"))
                  }
                  className={cx(
                    "rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-900",
                    "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
                  )}
                />
                <span className="text-xs font-semibold text-slate-400">–</span>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="DD.MM.YYYY"
                  value={getVacationInputValue(
                    vacation.id,
                    "endISO",
                    vacation.endISO,
                  )}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    const key = getDraftKey(vacation.id, "endISO");
                    setVacationDrafts((prev) => ({
                      ...prev,
                      [key]: nextValue,
                    }));
                    const parsed = parseEuropeanDateInput(nextValue);
                    if (parsed) {
                      onUpdateVacation(clinician.id, vacation.id, {
                        endISO: parsed,
                      });
                    }
                  }}
                  onBlur={() =>
                    clearVacationDraft(getDraftKey(vacation.id, "endISO"))
                  }
                  className={cx(
                    "rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-900",
                    "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
                  )}
                />
                <button
                  type="button"
                  onClick={() => onRemoveVacation(clinician.id, vacation.id)}
                  className={cx(
                    "ml-auto rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600",
                    "hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                  )}
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </div>

        {pastVacations.length > 0 ? (
          <details className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
              Past vacations ({pastVacations.length})
            </summary>
            <div className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Past vacations are hidden by default. Expand to view or edit.
            </div>
            <div className="mt-3 space-y-2">
              {pastVacations.map((vacation) => (
                <div
                  key={vacation.id}
                  className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                >
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="DD.MM.YYYY"
                    value={getVacationInputValue(
                      vacation.id,
                      "startISO",
                      vacation.startISO,
                    )}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      const key = getDraftKey(vacation.id, "startISO");
                      setVacationDrafts((prev) => ({
                        ...prev,
                        [key]: nextValue,
                      }));
                      const parsed = parseEuropeanDateInput(nextValue);
                      if (parsed) {
                        onUpdateVacation(clinician.id, vacation.id, {
                          startISO: parsed,
                        });
                      }
                    }}
                    onBlur={() =>
                      clearVacationDraft(getDraftKey(vacation.id, "startISO"))
                    }
                    className={cx(
                      "rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-900",
                      "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
                    )}
                  />
                  <span className="text-xs font-semibold text-slate-400">–</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="DD.MM.YYYY"
                    value={getVacationInputValue(
                      vacation.id,
                      "endISO",
                      vacation.endISO,
                    )}
                    onChange={(e) => {
                      const nextValue = e.target.value;
                      const key = getDraftKey(vacation.id, "endISO");
                      setVacationDrafts((prev) => ({
                        ...prev,
                        [key]: nextValue,
                      }));
                      const parsed = parseEuropeanDateInput(nextValue);
                      if (parsed) {
                        onUpdateVacation(clinician.id, vacation.id, {
                          endISO: parsed,
                        });
                      }
                    }}
                    onBlur={() =>
                      clearVacationDraft(getDraftKey(vacation.id, "endISO"))
                    }
                    className={cx(
                      "rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-900",
                      "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => onRemoveVacation(clinician.id, vacation.id)}
                    className={cx(
                      "ml-auto rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600",
                      "hover:bg-slate-50 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                    )}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );
}
