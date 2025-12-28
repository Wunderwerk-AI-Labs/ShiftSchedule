import { createPortal } from "react-dom";
import { cx } from "../../lib/classNames";
import ClinicianEditor from "./ClinicianEditor";

type ClinicianEditModalProps = {
  open: boolean;
  onClose: () => void;
  clinician: {
    id: string;
    name: string;
    qualifiedClassIds: string[];
    vacations: Array<{ id: string; startISO: string; endISO: string }>;
    workingHoursPerWeek?: number;
  } | null;
  classRows: Array<{ id: string; name: string }>;
  onToggleQualification: (clinicianId: string, classId: string) => void;
  onReorderQualification: (
    clinicianId: string,
    fromClassId: string,
    toClassId: string,
  ) => void;
  onUpdateWorkingHours: (clinicianId: string, workingHoursPerWeek?: number) => void;
  onAddVacation: (clinicianId: string) => void;
  onUpdateVacation: (
    clinicianId: string,
    vacationId: string,
    updates: { startISO?: string; endISO?: string },
  ) => void;
  onRemoveVacation: (clinicianId: string, vacationId: string) => void;
};

export default function ClinicianEditModal({
  open,
  onClose,
  clinician,
  classRows,
  onToggleQualification,
  onReorderQualification,
  onUpdateWorkingHours,
  onAddVacation,
  onUpdateVacation,
  onRemoveVacation,
}: ClinicianEditModalProps) {
  if (!open || !clinician) return null;

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
                Edit {clinician.name}
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Update eligible sections and vacations.
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
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Working hours per week
              </div>
              <div className="mt-2 flex items-center gap-3">
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={clinician.workingHoursPerWeek ?? ""}
                  onChange={(event) => {
                    const raw = event.target.value.trim();
                    if (!raw) {
                      onUpdateWorkingHours(clinician.id, undefined);
                      return;
                    }
                    const parsed = Number(raw);
                    if (!Number.isFinite(parsed)) return;
                    onUpdateWorkingHours(clinician.id, Math.max(0, parsed));
                  }}
                  placeholder="Hours/week"
                  className={cx(
                    "w-36 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900",
                    "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:[color-scheme:dark]",
                  )}
                />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Optional, can be left blank. Denotes the number of working hours according to
                  the contract.
                </span>
              </div>
            </div>
            <ClinicianEditor
              clinician={clinician}
              classRows={classRows}
              onToggleQualification={onToggleQualification}
              onReorderQualification={onReorderQualification}
              onAddVacation={onAddVacation}
              onUpdateVacation={onUpdateVacation}
              onRemoveVacation={onRemoveVacation}
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
