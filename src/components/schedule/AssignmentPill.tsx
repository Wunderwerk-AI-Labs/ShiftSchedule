import { cx } from "../../lib/classNames";

type AssignmentPillProps = {
  name: string;
  showNoEligibilityWarning?: boolean;
  showIneligibleWarning?: boolean;
  isHighlighted?: boolean;
  className?: string;
};

export default function AssignmentPill({
  name,
  showNoEligibilityWarning,
  showIneligibleWarning,
  isHighlighted = false,
  className,
}: AssignmentPillProps) {
  return (
    <div
      data-assignment-pill="true"
      className={cx(
        "group/pill relative w-full rounded-xl border border-sky-500 bg-sky-50 px-1.5 py-0.5 text-[11px] font-normal leading-4 text-sky-800 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]",
        "transition-colors",
        isHighlighted
          ? "hover:border-emerald-500 hover:bg-emerald-100"
          : "hover:border-sky-600 hover:bg-sky-100",
        "hover:z-10",
        isHighlighted
          ? "dark:hover:border-emerald-300 dark:hover:bg-emerald-900/70"
          : "dark:border-sky-400 dark:bg-sky-900/40 dark:text-sky-100 dark:hover:border-sky-300 dark:hover:bg-sky-900/60",
        isHighlighted &&
          "border-emerald-500 bg-emerald-100 text-emerald-950 dark:border-emerald-300 dark:bg-emerald-900/70 dark:text-emerald-50",
        className,
      )}
    >
      <div className="flex items-center justify-center gap-1 truncate">
        <span className="truncate text-center">{name}</span>
        {showNoEligibilityWarning ? (
          <span className="group/warn absolute right-1 top-0 -translate-y-1/2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-rose-300 text-[10px] font-semibold text-rose-700 shadow-sm">
              !
            </span>
            <span className="pointer-events-none absolute right-0 top-full z-30 mt-1 w-max rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 opacity-0 shadow-sm transition-opacity duration-75 group-hover/warn:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              No eligible classes defined yet.
            </span>
          </span>
        ) : showIneligibleWarning ? (
          <span className="group/warn absolute right-1 top-0 -translate-y-1/2">
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-200 text-[10px] font-semibold text-amber-700 shadow-sm">
              !
            </span>
            <span className="pointer-events-none absolute right-0 top-full z-30 mt-1 w-max rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 opacity-0 shadow-sm transition-opacity duration-75 group-hover/warn:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
              Not eligible for this slot.
            </span>
          </span>
        ) : null}
      </div>
    </div>
  );
}
