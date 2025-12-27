import { cx } from "../../lib/classNames";

type EmptySlotPillProps = {
  label?: string;
  onRemove?: () => void;
  variant?: "default" | "ghost";
  showAddIcon?: boolean;
  className?: string;
};

export default function EmptySlotPill({
  label = "Open Slot",
  onRemove,
  variant = "default",
  showAddIcon = false,
  className,
}: EmptySlotPillProps) {
  return (
    <div
      className={cx(
        "no-print group/empty relative w-full rounded-xl border border-dashed px-2 py-1 text-center text-[11px] font-normal leading-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]",
        variant === "ghost"
          ? "border-slate-200 bg-slate-50/60 text-slate-400 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
          : "border-slate-300 bg-slate-100/70 text-slate-600 dark:border-slate-600 dark:bg-slate-800/70 dark:text-slate-300",
        className,
      )}
    >
      {label}
      {showAddIcon ? (
        <span className="no-print absolute right-1 top-0 -translate-y-1/2">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[12px] font-semibold text-slate-500 shadow-sm dark:bg-slate-700 dark:text-slate-300">
            +
          </span>
        </span>
      ) : null}
      {onRemove ? (
        <span
          role="button"
          aria-label="Remove open slot"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className={cx(
            "no-print absolute right-1 top-0 -translate-y-1/2 cursor-pointer opacity-0 transition-opacity",
            "group-hover/empty:opacity-100",
          )}
        >
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-[12px] font-semibold text-slate-500 shadow-sm dark:bg-slate-700 dark:text-slate-300">
            -
          </span>
        </span>
      ) : null}
    </div>
  );
}
