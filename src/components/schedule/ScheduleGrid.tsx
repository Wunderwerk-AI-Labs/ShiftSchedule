import type { DayType, SolverSettings } from "../../api/client";
import type { RenderedAssignment, TimeRange } from "../../lib/schedule";
import { cx } from "../../lib/classNames";
import { formatDayHeader, toISODate } from "../../lib/date";
import {
  FREE_POOL_ID,
  REST_DAY_POOL_ID,
  buildShiftInterval,
  formatTimeRangeLabel,
  intervalsOverlap,
} from "../../lib/schedule";
import { getDayType } from "../../lib/dayTypes";
import AssignmentPill from "./AssignmentPill";
import EmptySlotPill from "./EmptySlotPill";
import RowLabel from "./RowLabel";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, MouseEvent as ReactMouseEvent, SetStateAction } from "react";
import type { ScheduleRow } from "../../lib/shiftRows";

type ScheduleGridProps = {
  leftHeaderTitle: string;
  weekDays: Date[];
  dayColumns?: {
    date: Date;
    dateISO: string;
    dayType: DayType;
    colOrder: number;
    isFirstInDay: boolean;
    dayIndex: number;
    columnIndex: number;
    columnTimeLabel?: string;
    columnHasMixedTimes?: boolean;
  }[];
  rows: ScheduleRow[];
  assignmentMap: Map<string, RenderedAssignment[]>;
  header?: React.ReactNode;
  holidayDates?: Set<string>;
  holidayNameByDate?: Record<string, string>;
  readOnly?: boolean;
  solverSettings?: SolverSettings;
  getClinicianName: (clinicianId: string) => string;
  getIsQualified: (clinicianId: string, rowId: string) => boolean;
  getHasEligibleClasses: (clinicianId: string) => boolean;
  onCellClick: (args: { row: ScheduleRow; date: Date }) => void;
  onClinicianClick?: (clinicianId: string) => void;
  enableSlotOverrides?: boolean;
  onMoveWithinDay: (args: {
    dateISO: string;
    fromRowId: string;
    toRowId: string;
    assignmentId: string;
    clinicianId: string;
  }) => void;
  separatorBeforeRowIds?: string[];
  locationSeparatorRowIds?: string[];
  minSlotsByRowId?: Record<string, { weekday: number; weekend: number }>;
  slotOverridesByKey?: Record<string, number>;
  onRemoveEmptySlot?: (args: { rowId: string; dateISO: string }) => void;
  violatingAssignmentKeys?: Set<string>;
  highlightedAssignmentKeys?: Set<string>;
  highlightOpenSlots?: boolean;
};

export default function ScheduleGrid({
  leftHeaderTitle,
  weekDays,
  dayColumns,
  rows,
  assignmentMap,
  header,
  holidayDates,
  holidayNameByDate,
  readOnly = false,
  solverSettings,
  getClinicianName,
  getIsQualified,
  getHasEligibleClasses,
  onCellClick,
  onClinicianClick,
  enableSlotOverrides = true,
  onMoveWithinDay,
  separatorBeforeRowIds = [],
  locationSeparatorRowIds = [],
  minSlotsByRowId = {},
  slotOverridesByKey = {},
  onRemoveEmptySlot,
  violatingAssignmentKeys,
  highlightedAssignmentKeys,
  highlightOpenSlots = false,
}: ScheduleGridProps) {
  type DayColumn = NonNullable<ScheduleGridProps["dayColumns"]>[number];
  const columns: DayColumn[] =
    dayColumns ??
    weekDays.map((date, index): DayColumn => {
      const dateISO = toISODate(date);
      return {
        date,
        dateISO,
        dayType: getDayType(dateISO, holidayDates),
        colOrder: 1,
        isFirstInDay: true,
        dayIndex: index,
        columnIndex: index,
        columnTimeLabel: undefined,
      };
    });
  const uniqueDayCount = useMemo(
    () => new Set(columns.map((column) => column.dateISO)).size,
    [columns],
  );
  const dayGroups = useMemo(() => {
    const groups: Array<{
      date: Date;
      dateISO: string;
      columns: typeof columns;
    }> = [];
    const byDate = new Map<
      string,
      { date: Date; dateISO: string; columns: typeof columns }
    >();
    for (const column of columns) {
      const existing = byDate.get(column.dateISO);
      if (existing) {
        existing.columns.push(column);
        continue;
      }
      const next = { date: column.date, dateISO: column.dateISO, columns: [column] };
      byDate.set(column.dateISO, next);
      groups.push(next);
    }
    return groups;
  }, [columns]);
  const showBlockTimes = useMemo(() => {
    const columnsWithSlots = new Set<string>();
    for (const row of rows) {
      if (row.kind !== "class") continue;
      if (row.slotRows?.length) {
        for (const slotRow of row.slotRows) {
          if (!slotRow.dayType) continue;
          const key = `${slotRow.dayType}-${slotRow.colBandOrder ?? 1}`;
          columnsWithSlots.add(key);
        }
        continue;
      }
      if (row.dayType) {
        const key = `${row.dayType}-${row.colBandOrder ?? 1}`;
        columnsWithSlots.add(key);
      }
    }
    if (columnsWithSlots.size === 0) return false;
    const hasMixedTimes = columns.some((column) => column.columnHasMixedTimes);
    if (hasMixedTimes) return true;
    return columns.some((column) => {
      const key = `${column.dayType}-${column.colOrder}`;
      return columnsWithSlots.has(key) && !column.columnTimeLabel;
    });
  }, [columns, rows]);
  const rowKindById = useMemo(() => {
    const map = new Map<string, "class" | "pool">();
    for (const row of rows) {
      map.set(row.id, row.kind);
      row.slotRows?.forEach((slotRow) => map.set(slotRow.id, slotRow.kind));
    }
    return map;
  }, [rows]);
  const [dragState, setDragState] = useState<{
    dragging: {
      rowId: string;
      dateISO: string;
      assignmentId: string;
      clinicianId: string;
    } | null;
    dragOverKey: string | null;
  }>({ dragging: null, dragOverKey: null });
  const dayHeaderRef = useRef<HTMLDivElement | null>(null);
  const [dayHeaderHeight, setDayHeaderHeight] = useState(0);
  const [hoveredClassCell, setHoveredClassCell] = useState<{
    rowId: string;
    dateISO: string;
  } | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const hoveredClassCellRef = useRef<{ rowId: string; dateISO: string } | null>(
    null,
  );
  const todayISO = toISODate(new Date());
  const isSingleDay = uniqueDayCount === 1;
  const dayColumnMin = isSingleDay ? 140 : 120;
  const leftColumn = isSingleDay ? "minmax(96px, 140px)" : "max-content";
  const shiftIntervalsByRowId = useMemo(() => {
    const map = new Map<string, TimeRange>();
    for (const row of rows) {
      const interval = buildShiftInterval(row);
      if (interval) map.set(row.id, interval);
      if (row.slotRows?.length) {
        row.slotRows.forEach((slotRow) => {
          const slotInterval = buildShiftInterval(slotRow);
          if (slotInterval) map.set(slotRow.id, slotInterval);
        });
      }
    }
    return map;
  }, [rows]);
  const columnIntervalsByKey = useMemo(() => {
    const map = new Map<string, { interval?: TimeRange; mixed: boolean }>();
    const registerRow = (slotRow: ScheduleRow) => {
      if (slotRow.kind !== "class") return;
      if (!slotRow.dayType || !slotRow.colBandOrder) return;
      const interval = shiftIntervalsByRowId.get(slotRow.id);
      if (!interval) return;
      const key = `${slotRow.dayType}-${slotRow.colBandOrder}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { interval, mixed: false });
        return;
      }
      if (!existing.interval) return;
      if (
        existing.interval.start !== interval.start ||
        existing.interval.end !== interval.end
      ) {
        map.set(key, { interval: existing.interval, mixed: true });
      }
    };
    for (const row of rows) {
      if (row.slotRows?.length) {
        row.slotRows.forEach(registerRow);
      } else {
        registerRow(row);
      }
    }
    return map;
  }, [rows, shiftIntervalsByRowId]);
  const { assignedIntervalsByDate, unknownIntervalsByDate } = useMemo(() => {
    const assignedByDate = new Map<string, Map<string, TimeRange[]>>();
    const unknownByDate = new Map<string, Set<string>>();
    for (const [key, list] of assignmentMap.entries()) {
      const [rowId, dateISO] = key.split("__");
      if (!rowId || !dateISO) continue;
      const rowKind =
        rowKindById.get(rowId) ?? (rowId.startsWith("pool-") ? "pool" : "class");
      if (rowKind !== "class") continue;
      const interval = shiftIntervalsByRowId.get(rowId);
      for (const assignment of list) {
        if (!interval) {
          const unknownSet = unknownByDate.get(dateISO) ?? new Set<string>();
          unknownSet.add(assignment.clinicianId);
          unknownByDate.set(dateISO, unknownSet);
          continue;
        }
        let clinicianMap = assignedByDate.get(dateISO);
        if (!clinicianMap) {
          clinicianMap = new Map<string, TimeRange[]>();
          assignedByDate.set(dateISO, clinicianMap);
        }
        const intervals = clinicianMap.get(assignment.clinicianId) ?? [];
        intervals.push(interval);
        clinicianMap.set(assignment.clinicianId, intervals);
      }
    }
    return { assignedIntervalsByDate: assignedByDate, unknownIntervalsByDate: unknownByDate };
  }, [assignmentMap, rowKindById, shiftIntervalsByRowId]);
  const poolSegmentsByDate = useMemo(() => {
    if (!solverSettings?.allowMultipleShiftsPerDay) {
      return new Map<string, { interval: TimeRange; label: string }[]>();
    }
    const result = new Map<string, { interval: TimeRange; label: string }[]>();
    for (const group of dayGroups) {
      if (group.columns.length <= 1) continue;
      const segments: { interval: TimeRange; label: string }[] = [];
      let isConsistent = true;
      for (const column of group.columns) {
        const key = `${column.dayType}-${column.colOrder}`;
        const meta = columnIntervalsByKey.get(key);
        if (!meta || meta.mixed || !meta.interval) {
          isConsistent = false;
          break;
        }
        const label =
          column.columnTimeLabel ??
          formatTimeRangeLabel(meta.interval.start, meta.interval.end);
        segments.push({ interval: meta.interval, label });
      }
      if (isConsistent && segments.length > 1) {
        result.set(group.dateISO, segments);
      }
    }
    return result;
  }, [dayGroups, columnIntervalsByKey, solverSettings?.allowMultipleShiftsPerDay]);
  const setHoveredCell = (next: { rowId: string; dateISO: string } | null) => {
    hoveredClassCellRef.current = next;
    setHoveredClassCell(next);
  };

  const clearHoveredCell = () => {
    if (readOnly) return;
    if (!hoveredClassCellRef.current) return;
    hoveredClassCellRef.current = null;
    setHoveredClassCell(null);
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (readOnly) return;
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

  useLayoutEffect(() => {
    const node = dayHeaderRef.current;
    if (!node) return;
    const update = () => {
      const nextHeight = node.getBoundingClientRect().height;
      setDayHeaderHeight(nextHeight);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [dayGroups.length]);

  return (
    <div className="schedule-grid mx-auto w-full max-w-7xl px-4 pb-8 sm:px-6 sm:pb-10 print:max-w-none print:px-0 print:pb-0">
      <div
        data-schedule-shell="true"
        className="relative mt-4 rounded-2xl border-2 border-slate-900/80 bg-white p-[2px] shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:mt-6 sm:rounded-3xl"
      >
        <div className="relative rounded-[calc(1.5rem-2px)] bg-white dark:bg-slate-900 overflow-hidden">
          {header ? (
            <div className="relative z-20 rounded-t-[calc(1.5rem-2px)] bg-white px-4 py-3 dark:bg-slate-900 sm:px-6 sm:py-4">
              {header}
            </div>
          ) : null}
          <div className="relative overflow-hidden rounded-b-[calc(1.5rem-2px)]">
            <div
              className="calendar-scroll relative z-10 h-auto max-h-none overflow-x-auto overflow-y-hidden touch-pan-x [-webkit-overflow-scrolling:touch]"
            >
              <div className="min-w-full w-full">
                <div
                  ref={gridRef}
                  data-schedule-grid="true"
                  className="grid"
                  onMouseMove={readOnly ? undefined : handleMouseMove}
                  onMouseLeave={readOnly ? undefined : clearHoveredCell}
                  style={{
                    gridTemplateColumns: `${leftColumn} repeat(${Math.max(
                      columns.length,
                      1,
                    )}, minmax(${dayColumnMin}px, 1fr))`,
                  }}
                >
                  <div className="sticky top-0 z-30 flex items-center border-r-2 border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900 sm:px-4">
                    <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      {leftHeaderTitle}
                    </div>
                  </div>

                {dayGroups.map((group, groupIndex) => {
                  const { dateISO } = group;
                  const { weekday, dayOfMonth } = formatDayHeader(group.date);
                  const isLastGroup = groupIndex === dayGroups.length - 1;
                  const holidayName = holidayNameByDate?.[dateISO];
                  const isHoliday =
                    Boolean(holidayName) || (holidayDates?.has(dateISO) ?? false);
                  const isWeekend =
                    group.date.getDay() === 0 || group.date.getDay() === 6;
                  const isToday = dateISO === todayISO;
                  const isOtherDay =
                    !!dragState.dragging && dragState.dragging.dateISO !== dateISO;
                  const isActiveDay =
                    !!dragState.dragging && dragState.dragging.dateISO === dateISO;
                  return (
                    <div
                      key={`day-${dateISO}`}
                      ref={groupIndex === 0 ? dayHeaderRef : undefined}
                      className={cx(
                        "sticky top-0 z-30 relative border-r-2 border-slate-300 px-3 py-2 text-center overflow-visible dark:border-slate-700 sm:px-4",
                        isHoliday
                          ? "bg-[#F3E8FF] dark:bg-slate-800"
                          : isWeekend
                            ? "bg-[#F3F4F6] dark:bg-slate-800"
                            : "bg-slate-50 dark:bg-slate-900",
                        isActiveDay && "bg-sky-50",
                        isOtherDay && "bg-slate-200/70 text-slate-400 opacity-60",
                        isLastGroup
                          ? "border-r-0"
                          : "border-r-2 border-slate-300 dark:border-slate-700",
                      )}
                      style={{ gridColumn: `span ${group.columns.length}` }}
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

                <div
                  className="sticky z-20 border-b border-r-2 border-slate-300 bg-white px-3 py-1 dark:border-slate-700 dark:bg-slate-900 sm:px-4"
                  style={{ top: dayHeaderHeight }}
                />
                {columns.map((column, index) => {
                  const { dateISO } = column;
                  const isLastCol = index === columns.length - 1;
                  const nextColumn = columns[index + 1];
                  const isDayDivider =
                    !isLastCol && nextColumn?.dateISO !== column.dateISO;
                  const holidayName = holidayNameByDate?.[dateISO];
                  const isHoliday =
                    Boolean(holidayName) || (holidayDates?.has(dateISO) ?? false);
                  const isWeekend =
                    column.date.getDay() === 0 || column.date.getDay() === 6;
                  const isOtherDay =
                    !!dragState.dragging && dragState.dragging.dateISO !== dateISO;
                  const isActiveDay =
                    !!dragState.dragging && dragState.dragging.dateISO === dateISO;
                  const timeLabel = column.columnTimeLabel;
                  return (
                    <div
                      key={`time-${dateISO}-${column.colOrder}-${index}`}
                      className={cx(
                        "sticky z-20 border-b border-r-2 border-slate-300 px-3 py-1 text-center text-[9px] font-semibold text-slate-400 dark:border-slate-700 sm:px-4",
                        isHoliday
                          ? "bg-[#F3E8FF] dark:bg-slate-800"
                          : isWeekend
                            ? "bg-[#F3F4F6] dark:bg-slate-800"
                            : "bg-slate-50 dark:bg-slate-900",
                        isActiveDay && "bg-sky-50",
                        isOtherDay && "bg-slate-200/70 text-slate-400 opacity-60",
                        isDayDivider &&
                          "border-solid border-r-2 border-slate-300 dark:border-slate-700",
                        { "border-r-0": isLastCol },
                      )}
                      style={{
                        top: dayHeaderHeight,
                        borderRightStyle: isDayDivider ? "solid" : "dashed",
                      }}
                    >
                      {timeLabel ?? ""}
                    </div>
                  );
                })}

                {rows.map((row, index) => {
                  const showSeparator = separatorBeforeRowIds.includes(row.id);
                  const showLocationSeparator =
                    locationSeparatorRowIds.includes(row.id);
                  const nextRow = rows[index + 1];
                  const nextRowId = nextRow?.id;
                  const suppressBottomBorder =
                    !!nextRowId && separatorBeforeRowIds.includes(nextRowId);
                  const isSubShiftContinuation = false;
                  const hasNextSubShift = false;
                  return (
                    <Fragment key={row.id}>
                      {showLocationSeparator ? <LocationSeparatorRow /> : null}
                      {showSeparator ? <SeparatorRow /> : null}
                      <RowSection
                        row={row}
                        dayColumns={columns}
                        assignmentMap={assignmentMap}
                        solverSettings={solverSettings}
                        getClinicianName={getClinicianName}
                        getIsQualified={getIsQualified}
                        getHasEligibleClasses={getHasEligibleClasses}
                        onCellClick={onCellClick}
                        onClinicianClick={onClinicianClick}
                        enableSlotOverrides={enableSlotOverrides}
                        onMoveWithinDay={onMoveWithinDay}
                        dragState={dragState}
                        setDragState={setDragState}
                        hoveredClassCell={hoveredClassCell}
                        setHoveredCell={setHoveredCell}
                        suppressBottomBorder={suppressBottomBorder}
                        isSubShiftContinuation={isSubShiftContinuation}
                        hasNextSubShift={hasNextSubShift}
                        minSlotsByRowId={minSlotsByRowId}
                        slotOverridesByKey={slotOverridesByKey}
                        onRemoveEmptySlot={onRemoveEmptySlot}
                        showBlockTimes={showBlockTimes}
                        readOnly={readOnly}
                        shiftIntervalsByRowId={shiftIntervalsByRowId}
                        poolSegmentsByDate={poolSegmentsByDate}
                        assignedIntervalsByDate={assignedIntervalsByDate}
                        unknownIntervalsByDate={unknownIntervalsByDate}
                        violatingAssignmentKeys={violatingAssignmentKeys}
                        highlightedAssignmentKeys={highlightedAssignmentKeys}
                        highlightOpenSlots={highlightOpenSlots}
                        rowKindById={rowKindById}
                      />
                    </Fragment>
                  );
                })}
                </div>
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
  dayColumns,
  assignmentMap,
  solverSettings,
  getClinicianName,
  getIsQualified,
  getHasEligibleClasses,
  onCellClick,
  onClinicianClick,
  enableSlotOverrides,
  onMoveWithinDay,
  dragState,
  setDragState,
  hoveredClassCell,
  setHoveredCell,
  suppressBottomBorder,
  minSlotsByRowId,
  slotOverridesByKey,
  onRemoveEmptySlot,
  isSubShiftContinuation,
  hasNextSubShift,
  showBlockTimes,
  readOnly = false,
  shiftIntervalsByRowId,
  poolSegmentsByDate,
  assignedIntervalsByDate,
  unknownIntervalsByDate,
  violatingAssignmentKeys,
  highlightedAssignmentKeys,
  highlightOpenSlots,
  rowKindById,
}: {
  row: ScheduleRow;
  dayColumns: {
    date: Date;
    dateISO: string;
    dayType: DayType;
    colOrder: number;
    isFirstInDay: boolean;
    dayIndex: number;
    columnIndex: number;
    columnTimeLabel?: string;
    columnHasMixedTimes?: boolean;
  }[];
  assignmentMap: Map<string, RenderedAssignment[]>;
  solverSettings?: SolverSettings;
  getClinicianName: (clinicianId: string) => string;
  getIsQualified: (clinicianId: string, rowId: string) => boolean;
  getHasEligibleClasses: (clinicianId: string) => boolean;
  onCellClick: (args: { row: ScheduleRow; date: Date }) => void;
  onClinicianClick?: (clinicianId: string) => void;
  enableSlotOverrides: boolean;
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
  suppressBottomBorder: boolean;
  minSlotsByRowId?: Record<string, { weekday: number; weekend: number }>;
  slotOverridesByKey: Record<string, number>;
  onRemoveEmptySlot?: (args: { rowId: string; dateISO: string }) => void;
  isSubShiftContinuation: boolean;
  hasNextSubShift: boolean;
  showBlockTimes: boolean;
  readOnly?: boolean;
  shiftIntervalsByRowId: Map<string, TimeRange>;
  poolSegmentsByDate: Map<string, { interval: TimeRange; label: string }[]>;
  assignedIntervalsByDate: Map<string, Map<string, TimeRange[]>>;
  unknownIntervalsByDate: Map<string, Set<string>>;
  violatingAssignmentKeys?: Set<string>;
  highlightedAssignmentKeys?: Set<string>;
  highlightOpenSlots?: boolean;
  rowKindById: Map<string, "class" | "pool">;
}) {
  const rowBg =
    row.id === "pool-vacation"
      ? "bg-slate-200/80 dark:bg-slate-800/80"
      : row.id === "pool-manual" || row.id === "pool-rest-day"
        ? "bg-slate-50/70 dark:bg-slate-900/70"
        : "bg-white dark:bg-slate-900";
  const isDistributionPoolRow = row.id === FREE_POOL_ID;
  const isManualPoolRow = row.id === "pool-manual";
  const isRestDayPoolRow = row.id === "pool-rest-day";
  const hideBottomBorder = row.kind === "class" && hasNextSubShift;
  const borderBottomClass =
    suppressBottomBorder || hideBottomBorder
          ? "border-b-0"
          : row.id === "pool-vacation"
            ? "border-b-0"
            : "border-b border-slate-200 dark:border-slate-800";
  const subShiftSeparatorClass = isSubShiftContinuation
    ? "border-t border-slate-200 dark:border-slate-700"
    : "";
  const subShiftSeparatorStyle = isSubShiftContinuation
    ? { borderTopStyle: "dashed" as const }
    : undefined;
  const applyDragImage = (
    source: HTMLElement,
    event: ReactMouseEvent<HTMLElement> | DragEvent,
  ) => {
    const dragRoot =
      source.closest<HTMLElement>('[data-assignment-pill="true"]') ?? source;
    const clone = dragRoot.cloneNode(true) as HTMLElement;
    const pill = clone.matches('[data-assignment-pill="true"]')
      ? clone
      : clone.querySelector<HTMLElement>('[data-assignment-pill="true"]');
    if (pill) {
      pill.classList.remove(
        "border-2",
        "border-emerald-500",
        "border-emerald-300",
        "border-sky-200",
        "border-sky-300",
        "border-sky-500/40",
        "bg-sky-50",
        "bg-sky-100",
        "bg-sky-50/60",
        "bg-sky-100/80",
        "dark:bg-sky-900/40",
        "dark:bg-sky-900/60",
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
        "border-2",
        "border-slate-900",
        "bg-sky-200",
        "text-slate-900",
        "dark:border-slate-100",
        "dark:bg-sky-700/60",
        "dark:text-sky-50",
      );
    }
    clone.style.position = "absolute";
    clone.style.top = "-9999px";
    clone.style.left = "-9999px";
    clone.style.pointerEvents = "none";
    clone.style.width = `${dragRoot.offsetWidth}px`;
    clone.style.height = `${dragRoot.offsetHeight}px`;
    document.body.appendChild(clone);
    const dragEvent = event as DragEvent;
    dragEvent.dataTransfer?.setDragImage(
      clone,
      dragRoot.offsetWidth / 2,
      dragRoot.offsetHeight / 2,
    );
    window.setTimeout(() => clone.remove(), 0);
  };
  const dayGroups = useMemo(() => {
    const groups: Array<{
      date: Date;
      dateISO: string;
      dayType: DayType;
      columns: typeof dayColumns;
    }> = [];
    const byDate = new Map<
      string,
      { date: Date; dateISO: string; dayType: DayType; columns: typeof dayColumns }
    >();
    for (const column of dayColumns) {
      const existing = byDate.get(column.dateISO);
      if (existing) {
        existing.columns.push(column);
        continue;
      }
      const next = {
        date: column.date,
        dateISO: column.dateISO,
        dayType: column.dayType,
        columns: [column],
      };
      byDate.set(column.dateISO, next);
      groups.push(next);
    }
    return groups;
  }, [dayColumns]);
  const restDayByDate = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const [key, list] of assignmentMap.entries()) {
      const [rowId, dateISO] = key.split("__");
      if (rowId !== REST_DAY_POOL_ID || !dateISO) continue;
      const set = map.get(dateISO) ?? new Set<string>();
      list.forEach((item) => set.add(item.clinicianId));
      map.set(dateISO, set);
    }
    return map;
  }, [assignmentMap]);
  const canDropAssignment = (
    payload: {
      rowId: string;
      assignmentId: string;
      clinicianId: string;
      dateISO: string;
    },
    targetRowId: string,
    targetDateISO: string,
  ) => {
    const targetKind = rowKindById.get(targetRowId);
    if (targetKind === "pool") return true;
    const restSet = restDayByDate.get(targetDateISO);
    if (restSet?.has(payload.clinicianId)) return false;
    const assignedIntervals =
      assignedIntervalsByDate
        .get(targetDateISO)
        ?.get(payload.clinicianId) ?? [];
    const currentInterval =
      payload.dateISO === targetDateISO
        ? shiftIntervalsByRowId.get(payload.rowId) ?? null
        : null;
    let effectiveIntervals = assignedIntervals;
    if (currentInterval && payload.rowId !== targetRowId) {
      let removed = false;
      effectiveIntervals = assignedIntervals.filter((interval) => {
        if (removed) return true;
        const matches =
          interval.start === currentInterval.start &&
          interval.end === currentInterval.end;
        if (matches) {
          removed = true;
          return false;
        }
        return true;
      });
    }
    const hasUnknown =
      unknownIntervalsByDate
        .get(targetDateISO)
        ?.has(payload.clinicianId) ?? false;
    const hasAny = effectiveIntervals.length > 0 || hasUnknown;
    if (!solverSettings?.allowMultipleShiftsPerDay) {
      return !hasAny;
    }
    if (!hasAny) return true;
    if (hasUnknown) return false;
    const targetInterval = shiftIntervalsByRowId.get(targetRowId);
    if (!targetInterval) return false;
    return !effectiveIntervals.some((interval) =>
      intervalsOverlap(interval, targetInterval),
    );
  };
  return (
    <>
      <div
        className={cx(
          "row border-r-2 border-slate-300 py-1 dark:border-slate-700 sm:py-1",
          borderBottomClass,
          subShiftSeparatorClass,
          rowBg,
        )}
        style={subShiftSeparatorStyle}
      >
        <RowLabel row={row} />
      </div>
      {row.kind === "pool"
        ? dayGroups.map((group, groupIndex) => {
            const { dateISO } = group;
            const isLastGroup = groupIndex === dayGroups.length - 1;
            const isDayDivider = !isLastGroup;
            const cellKey = `${row.id}__${dateISO}__pool`;
            const assignments = assignmentMap.get(`${row.id}__${dateISO}`) ?? [];
            const sortedAssignments =
              assignments.length > 1
                ? [...assignments].sort((a, b) => {
                    const nameA = getClinicianName(a.clinicianId);
                    const nameB = getClinicianName(b.clinicianId);
                    const surnameA =
                      nameA.trim().split(/\s+/).slice(-1)[0] ?? nameA;
                    const surnameB =
                      nameB.trim().split(/\s+/).slice(-1)[0] ?? nameB;
                    const bySurname = surnameA.localeCompare(surnameB);
                    return bySurname !== 0 ? bySurname : nameA.localeCompare(nameB);
                  })
                : assignments;
            const isOtherDay =
              !!dragState.dragging && dragState.dragging.dateISO !== dateISO;
            const isActiveDay =
              !!dragState.dragging && dragState.dragging.dateISO === dateISO;
            const cellBgClass = isOtherDay
              ? "bg-slate-200/70 text-slate-400 opacity-60"
              : rowBg;
            const poolSegments = isDistributionPoolRow
              ? poolSegmentsByDate.get(dateISO)
              : undefined;

            return (
              <button
                key={cellKey}
                type="button"
                onDragOver={
                  readOnly
                    ? undefined
                    : (e) => {
                        if (!dragState.dragging) return;
                        e.preventDefault();
                        if (dragState.dragging.dateISO !== dateISO) {
                          setDragState((s) =>
                            s.dragOverKey ? { ...s, dragOverKey: null } : s,
                          );
                          return;
                        }
                        if (!canDropAssignment(dragState.dragging, row.id, dateISO)) {
                          e.dataTransfer.dropEffect = "none";
                          setDragState((s) =>
                            s.dragOverKey ? { ...s, dragOverKey: null } : s,
                          );
                          return;
                        }
                        e.dataTransfer.dropEffect = "move";
                        setDragState((s) =>
                          s.dragOverKey === cellKey
                            ? s
                            : { ...s, dragOverKey: cellKey },
                        );
                      }
                }
                onDragLeave={
                  readOnly
                    ? undefined
                    : () => {
                        setDragState((s) =>
                          s.dragOverKey === cellKey
                            ? { ...s, dragOverKey: null }
                            : s,
                        );
                      }
                }
                onDrop={
                  readOnly
                    ? undefined
                    : (e) => {
                        e.preventDefault();
                        const raw = e.dataTransfer.getData(
                          "application/x-schedule-cell",
                        );
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
                          if (!canDropAssignment(payload, row.id, dateISO)) return;
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
                      }
                }
                data-schedule-cell="true"
                data-row-id={row.id}
                data-row-kind={row.kind}
                data-date-iso={dateISO}
                className={cx(
                  "row group relative border-r border-slate-200 p-0.5 text-left dark:border-slate-800 sm:p-1",
                  borderBottomClass,
                  subShiftSeparatorClass,
                  cellBgClass,
                  isDayDivider && "border-r-2 border-slate-300 dark:border-slate-700",
                  { "border-r-0": !isDayDivider },
                )}
                style={{
                  ...subShiftSeparatorStyle,
                  borderRightStyle: "solid",
                  gridColumn: `span ${group.columns.length}`,
                }}
              >
                {sortedAssignments.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {sortedAssignments.map((assignment) => {
                      const isDraggingAssignment =
                        dragState.dragging?.assignmentId === assignment.id &&
                        dragState.dragging?.rowId === row.id &&
                        dragState.dragging?.dateISO === dateISO;
                      const isDragFocus =
                        !!dragState.dragging &&
                        dragState.dragging.dateISO === dateISO &&
                        dragState.dragging.clinicianId === assignment.clinicianId;
                      const assignedIntervals =
                        assignedIntervalsByDate
                          .get(dateISO)
                          ?.get(assignment.clinicianId) ?? [];
                      const hasUnknownInterval =
                        unknownIntervalsByDate
                          .get(dateISO)
                          ?.has(assignment.clinicianId) ?? false;
                      const showPoolSegments =
                        !isDragFocus && !isDraggingAssignment;
                      const timeSegments =
                        showPoolSegments && poolSegments && poolSegments.length > 1
                          ? poolSegments.map((segment, index) => ({
                              label: segment.label || `col-${index + 1}`,
                              kind:
                                hasUnknownInterval ||
                                assignedIntervals.some((interval) =>
                                  intervalsOverlap(interval, segment.interval),
                                )
                                  ? ("taken" as const)
                                  : ("free" as const),
                            }))
                          : undefined;
                      const violationKey = `${assignment.rowId}__${assignment.dateISO}__${assignment.clinicianId}`;
                      return (
                        <AssignmentPill
                          key={assignment.id}
                          name={getClinicianName(assignment.clinicianId)}
                          timeSegments={timeSegments}
                          showNoEligibilityWarning={
                            !getHasEligibleClasses(assignment.clinicianId)
                          }
                          isViolation={violatingAssignmentKeys?.has(violationKey)}
                          isDragging={isDraggingAssignment}
                          isDragFocus={isDragFocus || isDraggingAssignment}
                          draggable={!readOnly}
                          onClick={
                            readOnly || !onClinicianClick
                              ? undefined
                              : (e) => {
                                  e.stopPropagation();
                                  onClinicianClick(assignment.clinicianId);
                                }
                          }
                          onDragStart={
                            readOnly
                              ? undefined
                              : (e) => {
                                  e.stopPropagation();
                                  e.dataTransfer.effectAllowed = "move";
                                  applyDragImage(e.currentTarget, e);
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
                                }
                          }
                          onDragEnd={
                            readOnly
                              ? undefined
                              : () =>
                                  setDragState({ dragging: null, dragOverKey: null })
                          }
                          className={cx(
                            !readOnly && "cursor-grab active:cursor-grabbing",
                            isDraggingAssignment && "opacity-0",
                          )}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </button>
            );
          })
        : dayColumns.map((column, index) => {
        const { dateISO, dayType, colOrder } = column;
        const isLastCol = index === dayColumns.length - 1;
        const nextColumn = dayColumns[index + 1];
        const isDayDivider =
          !isLastCol && nextColumn?.dateISO !== column.dateISO;
        const cellKey = `${row.id}__${dateISO}__${colOrder}__${index}`;
        const isHoliday = dayType === "holiday";
        const isWeekend =
          isHoliday || dayType === "sat" || dayType === "sun";
        const isHoverDate = hoveredClassCell?.dateISO === dateISO;
        const slotRow =
          row.kind === "class" && row.slotRows?.length
            ? row.slotRows.find(
                (slot) =>
                  slot.dayType === dayType && slot.colBandOrder === colOrder,
              )
            : row;
        const activeRow = slotRow ?? row;
        const resolvedMinSlots =
          minSlotsByRowId?.[activeRow.id] ??
          minSlotsByRowId?.[row.id] ?? { weekday: 0, weekend: 0 };
        const baseRequired =
          typeof activeRow.requiredSlots === "number"
            ? activeRow.requiredSlots
            : isWeekend
              ? resolvedMinSlots.weekend
              : resolvedMinSlots.weekday;
        const slotOverride =
          slotOverridesByKey[`${activeRow.id}__${dateISO}`] ?? 0;
        const isColumnMatch =
          row.kind !== "class"
            ? column.isFirstInDay
            : row.slotRows?.length
              ? !!slotRow
              : row.dayType
                ? row.dayType === dayType &&
                  (row.colBandOrder ?? 1) === colOrder
                : column.isFirstInDay;
        const isCellActive = isColumnMatch;
        const rowInterval = shiftIntervalsByRowId.get(activeRow.id) ?? null;
        const rowTimeLabel = rowInterval
          ? formatTimeRangeLabel(rowInterval.start, rowInterval.end)
          : undefined;
        const effectiveRowTimeLabel = showBlockTimes ? rowTimeLabel : undefined;
        const assignments = isCellActive
          ? assignmentMap.get(`${activeRow.id}__${dateISO}`) ?? []
          : [];
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
        const targetSlots = isCellActive
          ? Math.max(0, baseRequired + slotOverride)
          : 0;
        const emptySlots =
          row.kind === "class" && isCellActive
            ? Math.max(0, targetSlots - assignments.length)
            : 0;
        const isOtherDay = !!dragState.dragging && dragState.dragging.dateISO !== dateISO;
        const isActiveDay = !!dragState.dragging && dragState.dragging.dateISO === dateISO;
        const showQualified =
          !readOnly &&
          !!dragState.dragging &&
          isActiveDay &&
          row.kind === "class" &&
          isCellActive &&
          getIsQualified(dragState.dragging.clinicianId, activeRow.id) &&
          canDropAssignment(dragState.dragging, activeRow.id, dateISO);

        const isHoveredCell =
          hoveredClassCell?.rowId === activeRow.id &&
          hoveredClassCell?.dateISO === dateISO;
        const cellBgClass = isOtherDay
          ? "bg-slate-200/70 text-slate-400 opacity-60"
          : row.kind === "class" && !isCellActive
            ? "bg-white text-slate-300 dark:bg-slate-900 dark:text-slate-500"
          : isHoveredCell
            ? "bg-slate-50/70 dark:bg-slate-800/50"
              : row.kind === "class" && isWeekend
                ? "bg-white dark:bg-slate-900"
                : rowBg;

        return (
          <button
            key={cellKey}
            type="button"
            onClick={
              readOnly ||
              !enableSlotOverrides ||
              (row.kind === "class" && !isCellActive)
                ? undefined
                : () => onCellClick({ row: activeRow, date: column.date })
            }
            onDragOver={
              readOnly
                ? undefined
                : (e) => {
                    if (!dragState.dragging) return;
                    e.preventDefault();
                    if (dragState.dragging.dateISO !== dateISO) {
                      setDragState((s) =>
                        s.dragOverKey ? { ...s, dragOverKey: null } : s,
                      );
                      return;
                    }
                    if (!canDropAssignment(dragState.dragging, activeRow.id, dateISO)) {
                      e.dataTransfer.dropEffect = "none";
                      setDragState((s) =>
                        s.dragOverKey ? { ...s, dragOverKey: null } : s,
                      );
                      return;
                    }
                    if (row.kind === "class" && !isCellActive) {
                      e.dataTransfer.dropEffect = "move";
                      setDragState((s) =>
                        s.dragOverKey ? { ...s, dragOverKey: null } : s,
                      );
                      return;
                    }
                    e.dataTransfer.dropEffect = "move";
                    setDragState((s) =>
                      s.dragOverKey === cellKey
                        ? s
                        : { ...s, dragOverKey: cellKey },
                    );
                  }
            }
            onDragLeave={
              readOnly
                ? undefined
                : () => {
                  setDragState((s) =>
                    s.dragOverKey === cellKey ? { ...s, dragOverKey: null } : s,
                  );
                }
            }
            onDrop={
              readOnly
                ? undefined
                : (e) => {
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
                      if (payload.rowId === activeRow.id) return;
                      if (!canDropAssignment(payload, activeRow.id, dateISO)) return;
                      if (row.kind === "class" && !isCellActive) {
                        e.dataTransfer.dropEffect = "move";
                        setDragState({ dragging: null, dragOverKey: null });
                        return;
                      }
                      onMoveWithinDay({
                        dateISO,
                        fromRowId: payload.rowId,
                        toRowId: activeRow.id,
                        assignmentId: payload.assignmentId,
                        clinicianId: payload.clinicianId,
                      });
                    } finally {
                      setDragState({ dragging: null, dragOverKey: null });
                    }
                  }
            }
            data-schedule-cell="true"
            data-row-id={activeRow.id}
            data-row-kind={row.kind}
            data-date-iso={dateISO}
            className={cx(
              "row group relative border-r border-slate-200 p-0.5 text-left dark:border-slate-800 sm:p-1",
              borderBottomClass,
              subShiftSeparatorClass,
              cellBgClass,
              isDayDivider &&
                "border-solid border-r-2 border-slate-300 dark:border-slate-700",
              { "border-r-0": isLastCol },
            )}
            style={{
              ...subShiftSeparatorStyle,
              borderRightStyle: isDayDivider ? "solid" : "dashed",
            }}
          >
            {(() => {
              const showSlotPanel = row.kind === "class" && isCellActive;
              const hasHighlightedViolation =
                showSlotPanel &&
                !!highlightedAssignmentKeys &&
                assignments.some((assignment) =>
                  highlightedAssignmentKeys.has(
                    `${assignment.rowId}__${assignment.dateISO}__${assignment.clinicianId}`,
                  ),
                );
              const cellContent = (
                <>
                  {sortedAssignments.length > 0 ? (
                    sortedAssignments.map((assignment) => {
                    const isDraggingAssignment =
                      dragState.dragging?.assignmentId === assignment.id &&
                      dragState.dragging?.rowId === activeRow.id &&
                      dragState.dragging?.dateISO === dateISO;
                    const isDragFocus =
                      !!dragState.dragging &&
                      dragState.dragging.dateISO === dateISO &&
                      dragState.dragging.clinicianId === assignment.clinicianId;
                    const timeLabel = undefined;
                    const timeSegments = undefined;
                    const violationKey = `${assignment.rowId}__${assignment.dateISO}__${assignment.clinicianId}`;
                    return (
                      <AssignmentPill
                        key={assignment.id}
                        name={getClinicianName(assignment.clinicianId)}
                        timeLabel={timeLabel}
                        timeSegments={timeSegments}
                        showNoEligibilityWarning={
                          !getHasEligibleClasses(assignment.clinicianId)
                        }
                        showIneligibleWarning={
                          row.kind === "class" &&
                          !getIsQualified(assignment.clinicianId, activeRow.id)
                        }
                        isHighlighted={false}
                        isViolation={violatingAssignmentKeys?.has(violationKey)}
                        isDragging={isDraggingAssignment}
                        isDragFocus={isDragFocus || isDraggingAssignment}
                        draggable={!readOnly}
                        onDragStart={
                          readOnly
                            ? undefined
                            : (e) => {
                                e.stopPropagation();
                                setHoveredCell(null);
                                e.dataTransfer.effectAllowed = "move";
                                applyDragImage(e.currentTarget, e);
                                e.dataTransfer.setData(
                                  "application/x-schedule-cell",
                                  JSON.stringify({
                                    rowId: activeRow.id,
                                    dateISO,
                                    assignmentId: assignment.id,
                                    clinicianId: assignment.clinicianId,
                                  }),
                                );
                                setDragState({
                                  dragging: {
                                    rowId: activeRow.id,
                                    dateISO,
                                    assignmentId: assignment.id,
                                    clinicianId: assignment.clinicianId,
                                  },
                                  dragOverKey: null,
                                });
                              }
                        }
                        onClick={
                          readOnly || !onClinicianClick
                            ? undefined
                            : (e) => {
                                e.stopPropagation();
                                onClinicianClick(assignment.clinicianId);
                              }
                        }
                        onDragEnd={
                          readOnly
                            ? undefined
                            : () =>
                                setDragState({ dragging: null, dragOverKey: null })
                        }
                        className={cx(
                          !readOnly && "cursor-grab active:cursor-grabbing",
                          isDraggingAssignment && "opacity-0",
                        )}
                      />
                    );
                })
              ) : null}
                  {emptySlots > 0
                ? Array.from({ length: emptySlots }).map((_, idx) => (
                    <EmptySlotPill
                      key={`${cellKey}-empty-${idx}`}
                      onRemove={
                        !readOnly && onRemoveEmptySlot && row.kind === "class"
                          ? () =>
                              onRemoveEmptySlot({
                                rowId: activeRow.id,
                                dateISO,
                              })
                          : undefined
                      }
                      className={
                        highlightOpenSlots
                          ? "border-2 border-rose-500 bg-rose-50 text-rose-700 ring-2 ring-rose-200/80 dark:border-rose-400/80 dark:bg-rose-900/30 dark:text-rose-100 dark:ring-rose-500/40"
                          : undefined
                      }
                    />
                  ))
                  : assignments.length === 0 && row.kind === "class" && isCellActive
                  ? !readOnly && enableSlotOverrides && (
                      <EmptySlotPill
                        key={`${cellKey}-empty-ghost`}
                        variant="ghost"
                        showAddIcon
                        className={cx(
                          "opacity-0 transition-opacity",
                          highlightOpenSlots &&
                            "border-2 border-rose-400 bg-rose-50/70 text-rose-600 ring-2 ring-rose-200/70 dark:border-rose-500/70 dark:bg-rose-900/30 dark:text-rose-200 dark:ring-rose-500/40",
                          hoveredClassCell?.rowId === activeRow.id &&
                            hoveredClassCell?.dateISO === dateISO &&
                            "opacity-100",
                          dragState.dragging && "opacity-0 pointer-events-none",
                        )}
                    />
                  )
                : null}
                </>
              );
              return showSlotPanel ? (
                <div
                  className={cx(
                    "h-full w-full min-h-[48px] rounded-lg border bg-white/95 px-2 py-0.5 shadow-sm dark:bg-slate-950",
                    hasHighlightedViolation
                      ? "border-2 border-rose-500 dark:border-rose-400"
                      : showQualified
                        ? "border-2 border-slate-900 dark:border-slate-100"
                        : "border-slate-200 dark:border-slate-700",
                  )}
                  style={
                    activeRow.blockColor
                      ? { backgroundColor: activeRow.blockColor }
                      : undefined
                  }
                >
                  <div className="flex flex-col gap-0.5 text-[10px] font-semibold text-slate-600 dark:text-slate-200">
                    <span className="truncate">
                      {activeRow.sectionName ?? activeRow.name}
                    </span>
                    {effectiveRowTimeLabel ? (
                      <span className="text-[10px] font-medium text-slate-400 dark:text-slate-400">
                        {effectiveRowTimeLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-col gap-1">{cellContent}</div>
                </div>
              ) : (
                <div className="flex flex-col gap-1">{cellContent}</div>
              );
            })()}
          </button>
        );
      })}
    </>
  );
}

function SeparatorRow() {
  return (
    <div
      className="row h-0 border-t border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
      style={{ gridColumn: "1 / -1" }}
    />
  );
}

function LocationSeparatorRow() {
  return (
    <div
      className="row h-0 border-t-2 border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900"
      style={{ gridColumn: "1 / -1" }}
    />
  );
}
