import type { ScheduleRow } from "../../lib/shiftRows";
type RowLabelProps = {
  row: ScheduleRow;
};

export default function RowLabel({ row }: RowLabelProps) {
  const showVacationNote = row.id === "pool-vacation";
  const showSubShift = row.kind === "class" && row.subShiftName;
  const showParentLabel =
    row.kind === "class" && (!row.subShiftOrder || row.subShiftOrder === 1);
  const parentLabel = row.parentName ?? row.name;
  const formatTime = (value?: string) => {
    if (!value) return "";
    const match = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return value;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  };
  const subShiftTimeLabel =
    row.subShiftStartTime && row.subShiftEndTime
      ? `${formatTime(row.subShiftStartTime)} - ${formatTime(row.subShiftEndTime)}${
          row.subShiftEndDayOffset && row.subShiftEndDayOffset > 0
            ? ` +${row.subShiftEndDayOffset}d`
            : ""
        }`
      : "";
  return (
    <div className="group relative flex h-full items-center px-3 sm:px-4">
      {row.kind === "class" ? (
        <div className="flex w-full flex-col gap-0.5">
          {showParentLabel ? (
            <div className="flex w-full items-center gap-2">
              <span
                className="min-w-0 flex-1 truncate text-[11px] font-normal uppercase tracking-wide text-slate-600 dark:text-slate-300 sm:text-xs"
                title={parentLabel}
                style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
              >
                {parentLabel}
              </span>
              {row.locationName ? (
                <span className="ml-auto text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                  {row.locationName}
                </span>
              ) : null}
            </div>
          ) : null}
          {showSubShift ? (
            <span className="w-full pl-2 text-[11px] font-normal text-slate-500 dark:text-slate-400">
              <span className="flex w-full items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{row.subShiftName}</span>
                {subShiftTimeLabel ? (
                  <span className="ml-auto text-right tabular-nums">
                    {subShiftTimeLabel}
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}
        </div>
      ) : (
        <span
          className="max-w-[16ch] truncate text-[11px] font-normal uppercase tracking-wide text-slate-600 dark:text-slate-300 sm:max-w-[20ch] sm:text-xs"
          title={row.name}
          style={{ fontFamily: '"Inter", ui-sans-serif, system-ui, sans-serif' }}
        >
          {row.name}
        </span>
      )}
      {showVacationNote ? (
        <div className="pointer-events-none absolute left-4 top-full z-30 mt-2 w-max max-w-[260px] rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600 opacity-0 shadow-sm transition-opacity duration-75 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          Drag people in or out to update vacations automatically.
        </div>
      ) : null}
    </div>
  );
}
