import { Assignment, WorkplaceRow } from "../../data/mockData";
import { cx } from "../../lib/classNames";
import { formatDayHeader, toISODate } from "../../lib/date";
import AssignmentPill from "./AssignmentPill";
import EmptySlotPill from "./EmptySlotPill";
import RowLabel from "./RowLabel";
import { useEffect, useRef, useState } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";

type ScheduleGridProps = {
  leftHeaderTitle: string;
  weekDays: Date[];
  rows: WorkplaceRow[];
  assignmentMap: Map<string, Assignment[]>;
  header?: React.ReactNode;
  holidayDates?: Set<string>;
  holidayNameByDate?: Record<string, string>;
  getClinicianName: (clinicianId: string) => string;
  getIsQualified: (clinicianId: string, rowId: string) => boolean;
  getHasEligibleClasses: (clinicianId: string) => boolean;
  onCellClick: (args: { row: WorkplaceRow; date: Date }) => void;
  onClinicianClick?: (clinicianId: string) => void;
  onAutoAllocateDay?: (dateISO: string, options?: { onlyFillRequired?: boolean }) => void;
  onResetDay?: (dateISO: string) => void;
  onAutoAllocateWeek?: (options?: { onlyFillRequired?: boolean }) => void;
  onResetWeek?: () => void;
  onMoveWithinDay: (args: {
    dateISO: string;
    fromRowId: string;
    toRowId: string;
    assignmentId: string;
    clinicianId: string;
  }) => void;
  separatorBeforeRowIds?: string[];
  minSlotsByRowId?: Record<string, { weekday: number; weekend: number }>;
  slotOverridesByKey?: Record<string, number>;
  onRemoveEmptySlot?: (args: { rowId: string; dateISO: string }) => void;
};

export default function ScheduleGrid({
  leftHeaderTitle,
  weekDays,
  rows,
  assignmentMap,
  header,
  holidayDates,
  holidayNameByDate,
  getClinicianName,
  getIsQualified,
  getHasEligibleClasses,
  onCellClick,
  onClinicianClick,
  onAutoAllocateDay,
  onResetDay,
  onAutoAllocateWeek,
  onResetWeek,
  onMoveWithinDay,
  separatorBeforeRowIds = [],
  minSlotsByRowId = {},
  slotOverridesByKey = {},
  onRemoveEmptySlot,
}: ScheduleGridProps) {
  const [dragState, setDragState] = useState<{
    dragging: {
      rowId: string;
      dateISO: string;
      assignmentId: string;
      clinicianId: string;
    } | null;
    dragOverKey: string | null;
  }>({ dragging: null, dragOverKey: null });
  const [hoveredClassCell, setHoveredClassCell] = useState<{
    rowId: string;
    dateISO: string;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const hoveredClassCellRef = useRef<{ rowId: string; dateISO: string } | null>(
    null,
  );
  const todayISO = toISODate(new Date());
  const isSingleDay = weekDays.length === 1;
  const dayColumnMin = isSingleDay ? 140 : 120;
  const leftColumn = isSingleDay ? "minmax(96px, 140px)" : "max-content";

  const setHoveredCell = (next: { rowId: string; dateISO: string } | null) => {
    hoveredClassCellRef.current = next;
    setHoveredClassCell(next);
  };

  const clearHoveredCell = () => {
    if (!hoveredClassCellRef.current) return;
    hoveredClassCellRef.current = null;
    setHoveredClassCell(null);
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (dragState.dragging) {
      clearHoveredCell();
      return;
    }
    const target = event.target as HTMLElement | null;
    const cell = target?.closest<HTMLElement>('[data-schedule-cell="true"]');
    if (!cell || cell.dataset.rowKind !== "class") {
      clearHoveredCell();
      return;
    }
    const rowId = cell.dataset.rowId;
    const dateISO = cell.dataset.dateIso;
    if (!rowId || !dateISO) {
      clearHoveredCell();
      return;
    }
    const prev = hoveredClassCellRef.current;
    if (prev && prev.rowId === rowId && prev.dateISO === dateISO) return;
    setHoveredCell({ rowId, dateISO });
  };

  useEffect(() => {
    if (!dragState.dragging) return;
    const handleWindowDragOver = (event: DragEvent) => {
      const target = event.target as HTMLElement | null;
      const inGrid = target?.closest?.('[data-schedule-grid="true"]');
      if (inGrid) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    };
    const handleWindowDrop = (event: DragEvent) => {
      const target = event.target as HTMLElement | null;
      const inGrid = target?.closest?.('[data-schedule-grid="true"]');
      if (inGrid) return;
      event.preventDefault();
      setDragState({ dragging: null, dragOverKey: null });
    };
    window.addEventListener("dragover", handleWindowDragOver);
    window.addEventListener("drop", handleWindowDrop);
    return () => {
      window.removeEventListener("dragover", handleWindowDragOver);
      window.removeEventListener("drop", handleWindowDrop);
    };
  }, [dragState.dragging]);

  return (
    <div className="schedule-grid mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 sm:pb-10">
      <div
        className="relative mt-4 rounded-2xl border-2 border-slate-900/80 bg-white p-[2px] shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:mt-6 sm:rounded-3xl"
      >
        <div
          className="relative overflow-hidden rounded-[calc(1.5rem-2px)] bg-white dark:bg-slate-900"
        >
          {header ? (
            <div className="relative z-0 bg-white px-4 py-3 dark:bg-slate-900 sm:px-6 sm:py-4">
              {header}
            </div>
          ) : null}
          <div
            className="calendar-scroll relative z-10 overflow-x-auto overflow-y-auto touch-pan-x touch-pan-y [-webkit-overflow-scrolling:touch] sm:overflow-visible"
          >
            <div className="min-w-full w-full">
              <div
                ref={gridRef}
                data-schedule-grid="true"
                className="grid"
                onMouseMove={handleMouseMove}
                onMouseLeave={clearHoveredCell}
                style={{
                  gridTemplateColumns: `${leftColumn} repeat(${Math.max(
                    weekDays.length,
                    1,
                  )}, minmax(${dayColumnMin}px, 1fr))`,
                }}
              >
                <div className="flex items-center border-b border-r border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 sm:px-4">
                  <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {leftHeaderTitle}
                  </div>
                </div>

                {weekDays.map((d, index) => {
                  const dateISO = toISODate(d);
                  const { weekday, dayOfMonth } = formatDayHeader(d);
                  const isLastCol = index === weekDays.length - 1;
                  const holidayName = holidayNameByDate?.[dateISO];
                  const isHoliday =
                    Boolean(holidayName) || (holidayDates?.has(dateISO) ?? false);
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  const isToday = dateISO === todayISO;
                  const isOtherDay =
                    !!dragState.dragging && dragState.dragging.dateISO !== dateISO;
                  const isActiveDay =
                    !!dragState.dragging && dragState.dragging.dateISO === dateISO;
                  return (
                    <div
                      key={dateISO}
                      className={cx(
                        "relative border-b border-r border-slate-200 px-3 py-2 text-center overflow-visible dark:border-slate-800 sm:px-4",
                        isHoliday
                          ? "bg-[#F3E8FF] dark:bg-slate-800"
                          : isWeekend
                            ? "bg-[#F3F4F6] dark:bg-slate-800"
                            : "bg-slate-50 dark:bg-slate-900",
                        isActiveDay && "bg-sky-50",
                        isOtherDay && "bg-slate-200/70 text-slate-400 opacity-60",
                        { "border-r-0": isLastCol },
                      )}
                    >
                      <div className="flex flex-col items-center justify-center gap-1">
                        <div className="flex items-center justify-center gap-2">
                          <div className="text-[12px] font-semibold tracking-wide text-slate-500 dark:text-slate-300">
                            {weekday}
                          </div>
                          <div className="text-[12px] font-normal tracking-wide text-slate-900 dark:text-slate-100">
                            {isToday ? (
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-900 text-slate-900 dark:border-slate-100 dark:text-slate-100">
                                {dayOfMonth}
                              </span>
                            ) : (
                              dayOfMonth
                            )}
                          </div>
                        </div>
                        {holidayName ? (
                          <div className="max-w-[12ch] truncate text-[9px] font-normal text-purple-700 dark:text-purple-200">
                            {holidayName}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}

                {rows.map((row) => (
                  <RowSection
                    key={row.id}
                    row={row}
                    weekDays={weekDays}
                    assignmentMap={assignmentMap}
                    getClinicianName={getClinicianName}
                    getIsQualified={getIsQualified}
                    getHasEligibleClasses={getHasEligibleClasses}
                    onCellClick={onCellClick}
                    onClinicianClick={onClinicianClick}
                    onAutoAllocateDay={onAutoAllocateDay}
                    onAutoAllocateWeek={onAutoAllocateWeek}
                    onResetDay={onResetDay}
                    onResetWeek={onResetWeek}
                    onMoveWithinDay={onMoveWithinDay}
                    dragState={dragState}
                    setDragState={setDragState}
                    hoveredClassCell={hoveredClassCell}
                    setHoveredCell={setHoveredCell}
                    showSeparator={separatorBeforeRowIds.includes(row.id)}
                    minSlots={minSlotsByRowId[row.id] ?? { weekday: 0, weekend: 0 }}
                    slotOverridesByKey={slotOverridesByKey}
                    onRemoveEmptySlot={onRemoveEmptySlot}
                    holidayDates={holidayDates}
                    holidayNameByDate={holidayNameByDate}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RowSection({
  row,
  weekDays,
  assignmentMap,
  getClinicianName,
  getIsQualified,
  getHasEligibleClasses,
  onCellClick,
  onClinicianClick,
  onAutoAllocateDay,
  onAutoAllocateWeek,
  onResetDay,
  onResetWeek,
  onMoveWithinDay,
  dragState,
  setDragState,
  hoveredClassCell,
  setHoveredCell,
  showSeparator,
  minSlots,
  slotOverridesByKey,
  onRemoveEmptySlot,
  holidayDates,
  holidayNameByDate,
}: {
  row: WorkplaceRow;
  weekDays: Date[];
  assignmentMap: Map<string, Assignment[]>;
  getClinicianName: (clinicianId: string) => string;
  getIsQualified: (clinicianId: string, rowId: string) => boolean;
  getHasEligibleClasses: (clinicianId: string) => boolean;
  onCellClick: (args: { row: WorkplaceRow; date: Date }) => void;
  onClinicianClick?: (clinicianId: string) => void;
  onAutoAllocateDay?: (dateISO: string, options?: { onlyFillRequired?: boolean }) => void;
  onAutoAllocateWeek?: (options?: { onlyFillRequired?: boolean }) => void;
  onResetDay?: (dateISO: string) => void;
  onResetWeek?: () => void;
  onMoveWithinDay: (args: {
    dateISO: string;
    fromRowId: string;
    toRowId: string;
    assignmentId: string;
    clinicianId: string;
  }) => void;
  dragState: {
    dragging: {
      rowId: string;
      dateISO: string;
      assignmentId: string;
      clinicianId: string;
    } | null;
    dragOverKey: string | null;
  };
  setDragState: Dispatch<
    SetStateAction<{
      dragging: {
        rowId: string;
        dateISO: string;
        assignmentId: string;
        clinicianId: string;
      } | null;
      dragOverKey: string | null;
    }>
  >;
  hoveredClassCell: { rowId: string; dateISO: string } | null;
  setHoveredCell: (next: { rowId: string; dateISO: string } | null) => void;
  showSeparator: boolean;
  minSlots: { weekday: number; weekend: number };
  slotOverridesByKey: Record<string, number>;
  onRemoveEmptySlot?: (args: { rowId: string; dateISO: string }) => void;
  holidayDates?: Set<string>;
  holidayNameByDate?: Record<string, string>;
}) {
  const rowBg =
    row.id === "pool-vacation"
      ? "bg-slate-200/80 dark:bg-slate-800/80"
      : row.id === "pool-manual"
        ? "bg-slate-50/70 dark:bg-slate-900/70"
        : "bg-white dark:bg-slate-900";
  const shouldInsertControlRow = showSeparator;
  const isDistributionPoolRow = row.id === "pool-not-allocated";
  const isManualPoolRow = row.id === "pool-manual";
  const borderBottomClass =
    row.id === "pool-vacation"
      ? "border-b-0"
      : isDistributionPoolRow
        ? "border-b-2 border-slate-200 dark:border-slate-800"
        : isManualPoolRow
          ? "border-b-2 border-slate-200 dark:border-slate-800"
          : "border-b border-slate-200 dark:border-slate-800";
  return (
    <>
      {shouldInsertControlRow ? (
        <ControlRow
          weekDays={weekDays}
          onAutoAllocateDay={onAutoAllocateDay}
          onAutoAllocateWeek={onAutoAllocateWeek}
          onResetDay={onResetDay}
          onResetWeek={onResetWeek}
          holidayDates={holidayDates}
        />
      ) : null}
      <div
        className={cx(
          "row border-r border-slate-200 py-1 dark:border-slate-800 sm:py-1",
          borderBottomClass,
          rowBg,
        )}
      >
        <RowLabel row={row} />
      </div>
      {weekDays.map((date, index) => {
        const dateISO = toISODate(date);
        const isLastCol = index === weekDays.length - 1;
        const key = `${row.id}__${dateISO}`;
        const assignments = assignmentMap.get(key) ?? [];
        const sortedAssignments =
          assignments.length > 1
            ? [...assignments].sort((a, b) => {
                const nameA = getClinicianName(a.clinicianId);
                const nameB = getClinicianName(b.clinicianId);
                const surnameA = nameA.trim().split(/\s+/).slice(-1)[0] ?? nameA;
                const surnameB = nameB.trim().split(/\s+/).slice(-1)[0] ?? nameB;
                const bySurname = surnameA.localeCompare(surnameB);
                return bySurname !== 0 ? bySurname : nameA.localeCompare(nameB);
              })
            : assignments;
        const isHoliday = holidayDates?.has(dateISO) ?? false;
        const isWeekend = isHoliday || date.getDay() === 0 || date.getDay() === 6;
        const isHoverDate = hoveredClassCell?.dateISO === dateISO;
        const minSlotsForDate = isWeekend ? minSlots.weekend : minSlots.weekday;
        const slotOverride = slotOverridesByKey[key] ?? 0;
        const targetSlots = Math.max(0, minSlotsForDate + slotOverride);
        const emptySlots =
          row.kind === "class"
            ? Math.max(0, targetSlots - assignments.length)
            : 0;
        const isOtherDay = !!dragState.dragging && dragState.dragging.dateISO !== dateISO;
        const isActiveDay = !!dragState.dragging && dragState.dragging.dateISO === dateISO;
        const showQualified =
          !!dragState.dragging &&
          isActiveDay &&
          row.kind === "class" &&
          getIsQualified(dragState.dragging.clinicianId, row.id);

        const isHoveredCell =
          hoveredClassCell?.rowId === row.id &&
          hoveredClassCell?.dateISO === dateISO;
        const cellBgClass = isOtherDay
          ? "bg-slate-200/70 text-slate-400 opacity-60"
          : showQualified
            ? "bg-emerald-50/70 dark:bg-emerald-900/30"
            : isHoveredCell
              ? "bg-slate-50/70 dark:bg-slate-800/50"
              : row.kind === "class" && isWeekend
                ? "bg-white dark:bg-slate-900"
                : rowBg;

        return (
          <button
            key={key}
            type="button"
            onClick={() => onCellClick({ row, date })}
            onDragOver={(e) => {
              if (!dragState.dragging) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragState.dragging.dateISO !== dateISO) {
                setDragState((s) => (s.dragOverKey ? { ...s, dragOverKey: null } : s));
                return;
              }
              setDragState((s) => (s.dragOverKey === key ? s : { ...s, dragOverKey: key }));
            }}
            onDragLeave={() => {
              setDragState((s) => (s.dragOverKey === key ? { ...s, dragOverKey: null } : s));
            }}
            onDrop={(e) => {
              e.preventDefault();
              const raw = e.dataTransfer.getData("application/x-schedule-cell");
              if (!raw) return;
              try {
                const payload = JSON.parse(raw) as {
                  rowId: string;
                  dateISO: string;
                  assignmentId: string;
                  clinicianId: string;
                };
                if (payload.dateISO !== dateISO) return;
                if (payload.rowId === row.id) return;
                onMoveWithinDay({
                  dateISO,
                  fromRowId: payload.rowId,
                  toRowId: row.id,
                  assignmentId: payload.assignmentId,
                  clinicianId: payload.clinicianId,
                });
              } finally {
                setDragState({ dragging: null, dragOverKey: null });
              }
            }}
            data-schedule-cell="true"
            data-row-id={row.id}
            data-row-kind={row.kind}
            data-date-iso={dateISO}
            className={cx(
              "row group relative border-r border-slate-200 px-2 py-1 text-left dark:border-slate-800 sm:px-3 sm:py-1",
              borderBottomClass,
              cellBgClass,
              { "border-r-0": isLastCol },
            )}
          >
            <div className="flex flex-col gap-1">
              {sortedAssignments.length > 0 ? (
                sortedAssignments.map((assignment) => {
                  const isDraggingAssignment =
                    dragState.dragging?.assignmentId === assignment.id &&
                    dragState.dragging?.rowId === row.id &&
                    dragState.dragging?.dateISO === dateISO;
                  return (
                    <div
                      key={assignment.id}
                      draggable
                      onDragStart={(e) => {
                        e.stopPropagation();
                        setHoveredCell(null);
                        e.dataTransfer.effectAllowed = "move";
                        const source = e.currentTarget;
                        const clone = source.cloneNode(true) as HTMLElement;
                        const pill = clone.querySelector<HTMLElement>(
                          '[data-assignment-pill="true"]',
                        );
                        if (pill) {
                          pill.classList.remove(
                            "border-emerald-500",
                            "border-emerald-300",
                            "bg-emerald-100",
                            "bg-emerald-100/80",
                            "text-emerald-950",
                            "text-emerald-900",
                            "dark:border-emerald-300",
                            "dark:border-emerald-500/60",
                            "dark:bg-emerald-900/70",
                            "dark:bg-emerald-900/40",
                            "dark:text-emerald-50",
                            "dark:text-emerald-100",
                          );
                          pill.classList.add(
                            "border-sky-200",
                            "bg-sky-50",
                            "text-sky-800",
                            "dark:border-sky-500/40",
                            "dark:bg-sky-900/40",
                            "dark:text-sky-100",
                          );
                        }
                        clone.style.position = "absolute";
                        clone.style.top = "-9999px";
                        clone.style.left = "-9999px";
                        clone.style.pointerEvents = "none";
                        clone.style.width = `${source.offsetWidth}px`;
                        clone.style.height = `${source.offsetHeight}px`;
                        document.body.appendChild(clone);
                        e.dataTransfer.setDragImage(
                          clone,
                          source.offsetWidth / 2,
                          source.offsetHeight / 2,
                        );
                        window.setTimeout(() => clone.remove(), 0);
                        e.dataTransfer.setData(
                          "application/x-schedule-cell",
                          JSON.stringify({
                            rowId: row.id,
                            dateISO,
                            assignmentId: assignment.id,
                            clinicianId: assignment.clinicianId,
                          }),
                        );
                        setDragState({
                          dragging: {
                            rowId: row.id,
                            dateISO,
                            assignmentId: assignment.id,
                            clinicianId: assignment.clinicianId,
                          },
                          dragOverKey: null,
                        });
                      }}
                      onClick={(e) => {
                        if (!onClinicianClick) return;
                        e.stopPropagation();
                        onClinicianClick(assignment.clinicianId);
                      }}
                      onDragEnd={() => setDragState({ dragging: null, dragOverKey: null })}
                      className={cx(
                        "w-full cursor-grab active:cursor-grabbing",
                        isDraggingAssignment && "opacity-0",
                      )}
                    >
                      <AssignmentPill
                        name={getClinicianName(assignment.clinicianId)}
                        showNoEligibilityWarning={
                          !getHasEligibleClasses(assignment.clinicianId)
                        }
                        showIneligibleWarning={
                          row.kind === "class" &&
                          !getIsQualified(assignment.clinicianId, row.id)
                        }
                        isHighlighted={
                          !!isHoverDate &&
                          !!hoveredClassCell &&
                          getIsQualified(assignment.clinicianId, hoveredClassCell.rowId)
                        }
                        isDragging={isDraggingAssignment}
                      />
                    </div>
                  );
                })
              ) : null}
              {emptySlots > 0
                ? Array.from({ length: emptySlots }).map((_, idx) => (
                    <EmptySlotPill
                      key={`${key}-empty-${idx}`}
                      onRemove={
                        onRemoveEmptySlot && row.kind === "class"
                          ? () =>
                              onRemoveEmptySlot({
                                rowId: row.id,
                                dateISO,
                              })
                          : undefined
                      }
                    />
                  ))
                : assignments.length === 0 && row.kind === "class"
                  ? (
                      <EmptySlotPill
                        key={`${key}-empty-ghost`}
                        variant="ghost"
                        showAddIcon
                        className={cx(
                          "opacity-0 transition-opacity",
                          hoveredClassCell?.rowId === row.id &&
                            hoveredClassCell?.dateISO === dateISO &&
                            "opacity-100",
                          dragState.dragging && "opacity-0 pointer-events-none",
                        )}
                      />
                    )
                  : null}
            </div>
          </button>
        );
      })}
    </>
  );
}

function Tooltip({ children }: { children: string }) {
  return (
    <span
      className={cx(
        "pointer-events-none absolute top-9 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 shadow-sm",
        "opacity-0 transition-opacity duration-75 group-hover:opacity-100",
      )}
    >
      {children}
    </span>
  );
}

function ControlRow({
  weekDays,
  onAutoAllocateDay,
  onAutoAllocateWeek,
  onResetDay,
  onResetWeek,
  holidayDates,
}: {
  weekDays: Date[];
  onAutoAllocateDay?: (dateISO: string, options?: { onlyFillRequired?: boolean }) => void;
  onAutoAllocateWeek?: (options?: { onlyFillRequired?: boolean }) => void;
  onResetDay?: (dateISO: string) => void;
  onResetWeek?: () => void;
  holidayDates?: Set<string>;
}) {
  return (
    <>
      <div className="no-print border-b border-r border-slate-200 bg-white px-5 py-3 overflow-visible dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <ControlButton
            label="Only necessary (week)"
            onClick={() => onAutoAllocateWeek?.({ onlyFillRequired: true })}
          >
            <ArrowUpIcon className="h-7 w-7" />
          </ControlButton>
          <ControlButton
            label="Distribute all (week)"
            onClick={() => onAutoAllocateWeek?.({ onlyFillRequired: false })}
          >
            <ArrowUpDoubleIcon className="h-7 w-7" />
          </ControlButton>
          <ControlButton label="Reset to free (week)" onClick={() => onResetWeek?.()}>
            <ArrowDownDoubleIcon className="h-7 w-7" />
          </ControlButton>
        </div>
      </div>
      {weekDays.map((day, index) => {
        const dateISO = toISODate(day);
        const isLastCol = index === weekDays.length - 1;
        return (
          <div
            key={`control-${dateISO}`}
            className={cx(
              "no-print border-b border-r border-slate-200 px-4 py-3 text-center overflow-visible dark:border-slate-800",
              "bg-white dark:bg-slate-900",
              { "border-r-0": isLastCol },
            )}
          >
            <div className="flex items-center justify-center gap-2">
              <ControlButton
                label="Only necessary (day)"
                onClick={() => onAutoAllocateDay?.(dateISO, { onlyFillRequired: true })}
              >
                <ArrowUpIcon className="h-7 w-7" />
              </ControlButton>
              <ControlButton
                label="Distribute all (day)"
                onClick={() => onAutoAllocateDay?.(dateISO, { onlyFillRequired: false })}
              >
                <ArrowUpDoubleIcon className="h-7 w-7" />
              </ControlButton>
              <ControlButton label="Reset to free (day)" onClick={() => onResetDay?.(dateISO)}>
                <ArrowDownDoubleIcon className="h-7 w-7" />
              </ControlButton>
            </div>
          </div>
        );
      })}
    </>
  );
}

function ControlButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "group relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500",
        "hover:bg-slate-50 hover:text-slate-700",
        "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700",
      )}
      aria-label={label}
    >
      {children}
      <Tooltip>{label}</Tooltip>
    </button>
  );
}

function ArrowUpDoubleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M8 16 12 12l4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 11 12 7l4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowUpIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M8 14 12 10l4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowDownIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M8 10 12 14l4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowDownDoubleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M8 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 13l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
