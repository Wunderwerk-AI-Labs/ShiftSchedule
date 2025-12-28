import { cx } from "../../lib/classNames";

type AssignmentPillProps = {
  name: string;
  showNoEligibilityWarning?: boolean;
  showIneligibleWarning?: boolean;
  isHighlighted?: boolean;
  isDragging?: boolean;
  className?: string;
};

export default function AssignmentPill({
  name,
  showNoEligibilityWarning,
  showIneligibleWarning,
  isHighlighted = false,
  isDragging = false,
  className,
}: AssignmentPillProps) {
  const showHighlight = isHighlighted && !isDragging;
  return (
    <div
      data-assignment-pill="true"
      className={cx(
        "group/pill relative w-full rounded-xl border px-1.5 py-0.5 text-[11px] font-normal leading-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]",
        "transition-colors hover:z-10",
        showHighlight
          ? "border-emerald-300 bg-emerald-100/80 text-emerald-900 hover:border-emerald-300 hover:bg-emerald-100/80 dark:border-emerald-500/60 dark:bg-emerald-900/40 dark:text-emerald-100 dark:hover:border-emerald-500/60 dark:hover:bg-emerald-900/40"
          : "border-sky-200 bg-sky-50 text-sky-800 hover:border-sky-300 hover:bg-sky-100 dark:border-sky-500/40 dark:bg-sky-900/40 dark:text-sky-100 dark:hover:border-sky-400/60 dark:hover:bg-sky-900/60",
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
              No eligible sections defined yet.
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
