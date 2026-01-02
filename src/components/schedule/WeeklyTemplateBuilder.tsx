import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { cx } from "../../lib/classNames";
import { DAY_TYPES, DAY_TYPE_LABELS } from "../../lib/dayTypes";
import { DEFAULT_LOCATION_ID } from "../../lib/shiftRows";
import type {
  DayType,
  Location,
  TemplateBlock,
  TemplateColBand,
  TemplateRowBand,
  TemplateSlot,
  WeeklyCalendarTemplate,
  WeeklyTemplateLocation,
  WorkplaceRow,
} from "../../api/client";

type WeeklyTemplateBuilderProps = {
  template: WeeklyCalendarTemplate;
  locations: Location[];
  rows: WorkplaceRow[];
  onChange: (nextTemplate: WeeklyCalendarTemplate) => void;
  onCreateSection: (name: string) => string;
  onUpdateSectionColor: (sectionId: string, color: string | null) => void;
  onAddLocation: (name: string) => void;
  onRenameLocation: (locationId: string, nextName: string) => void;
  onRemoveLocation: (locationId: string) => void;
  onReorderLocations: (nextOrder: string[]) => void;
};

const createId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeTimeInput = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const formatTime = (value?: string) => {
  if (!value) return "";
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return value;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
};

const clampOffset = (value: number) => Math.max(0, Math.min(3, Math.trunc(value)));

const emptyTemplateLocation = (locationId: string): WeeklyTemplateLocation => ({
  locationId,
  rowBands: [],
  colBands: [],
  slots: [],
});

const sortByOrder = <T extends { order: number }>(items: T[]) =>
  [...items].sort((a, b) => a.order - b.order);

const BLOCK_COLOR_OPTIONS: Array<{ id: string; color: string | null }> = [
  { id: "none", color: null },
  { id: "rose", color: "#FDE2E4" },
  { id: "coral", color: "#FFD9C9" },
  { id: "peach", color: "#FFE8D6" },
  { id: "apricot", color: "#FFEFD1" },
  { id: "butter", color: "#FFF4C1" },
  { id: "lime", color: "#EEF6C8" },
  { id: "mint", color: "#E6F7D9" },
  { id: "seafoam", color: "#DDF6EE" },
  { id: "sky", color: "#D9F0FF" },
  { id: "periwinkle", color: "#DEE8FF" },
  { id: "lavender", color: "#E8E1F5" },
];

export default function WeeklyTemplateBuilder({
  template,
  locations,
  rows,
  onChange,
  onCreateSection,
  onUpdateSectionColor,
  onAddLocation,
  onRenameLocation,
  onRemoveLocation,
  onReorderLocations,
}: WeeklyTemplateBuilderProps) {
  const classRows = useMemo(
    () => rows.filter((row) => row.kind === "class"),
    [rows],
  );
  const sectionNameById = useMemo(
    () => new Map(classRows.map((row) => [row.id, row.name])),
    [classRows],
  );
  const blocks = template.blocks ?? [];
  const blockById = useMemo(
    () => new Map(blocks.map((block) => [block.id, block])),
    [blocks],
  );
  const sectionColorById = useMemo(
    () =>
      new Map(
        rows
          .filter((row) => row.kind === "class")
          .map((row) => [row.id, row.blockColor]),
      ),
    [rows],
  );

  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const [timeDrafts, setTimeDrafts] = useState<Record<string, string>>({});
  const [activeSlotId, setActiveSlotId] = useState<string | null>(null);
  const [slotEditorMode, setSlotEditorMode] = useState<"time" | "required">("time");
  const [slotEditorAnchor, setSlotEditorAnchor] = useState<DOMRect | null>(null);
  const [slotEditorPosition, setSlotEditorPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const slotEditorRef = useRef<HTMLDivElement | null>(null);
  const [showAddBlockPicker, setShowAddBlockPicker] = useState(false);
  const [newBlockName, setNewBlockName] = useState("");
  const [pendingDeleteLocationId, setPendingDeleteLocationId] = useState<string | null>(null);
  const [hoveredDeleteLocationId, setHoveredDeleteLocationId] = useState<string | null>(null);
  const [pendingDeleteColumn, setPendingDeleteColumn] = useState<{
    dayType: DayType;
    index: number;
  } | null>(null);
  const [hoveredColumn, setHoveredColumn] = useState<{
    dayType: DayType;
    index: number;
  } | null>(null);
  const [hoveredDeleteColumn, setHoveredDeleteColumn] = useState<{
    dayType: DayType;
    index: number;
  } | null>(null);
  const [hoveredRowBandId, setHoveredRowBandId] = useState<string | null>(null);
  const [hoveredDeleteRowBand, setHoveredDeleteRowBand] = useState<{
    locationId: string;
    rowBandId: string;
  } | null>(null);
  const [activeAddCell, setActiveAddCell] = useState<{
    locationId: string;
    rowBandId: string;
    colBandId: string;
  } | null>(null);
  const [addCellAnchor, setAddCellAnchor] = useState<DOMRect | null>(null);
  const [addCellPosition, setAddCellPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const addCellRef = useRef<HTMLDivElement | null>(null);
  const [activeBlockColorId, setActiveBlockColorId] = useState<string | null>(null);
  const [blockColorPopoverPosition, setBlockColorPopoverPosition] = useState({
    top: 0,
    left: 0,
  });
  const [draggingBlockId, setDraggingBlockId] = useState<string | null>(null);
  const [dragOverBlockId, setDragOverBlockId] = useState<string | null>(null);
  const [activeDayType, setActiveDayType] = useState<DayType>("mon");
  const visibleDayTypes = useMemo(() => DAY_TYPES, []);
  const gridScrollRef = useRef<HTMLDivElement | null>(null);

  const isInvalidTimeDraft = (key: string) => {
    const value = timeDrafts[key];
    if (value === undefined) return false;
    if (value.trim() === "") return false;
    return normalizeTimeInput(value) === null;
  };

  const updateTemplateLocation = (
    locationId: string,
    updater: (location: WeeklyTemplateLocation) => WeeklyTemplateLocation,
  ) => {
    const existing = template.locations.find((loc) => loc.locationId === locationId);
    const base = existing ?? emptyTemplateLocation(locationId);
    const updated = updater(base);
    const order = new Map(locations.map((loc, index) => [loc.id, index]));
    const nextLocations = [
      ...template.locations.filter((loc) => loc.locationId !== locationId),
      updated,
    ].sort(
      (a, b) => (order.get(a.locationId) ?? 0) - (order.get(b.locationId) ?? 0),
    );
    onChange({ ...template, locations: nextLocations });
  };

  useEffect(() => {
    if (!activeSlotId) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-slot-time-editor]")) return;
      if (target.closest(`[data-slot-time-trigger="${activeSlotId}"]`)) return;
      if (target.closest(`[data-slot-required-trigger="${activeSlotId}"]`)) return;
      setActiveSlotId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeSlotId]);

  useEffect(() => {
    if (!activeSlotId) {
      setSlotEditorAnchor(null);
      setSlotEditorPosition(null);
    }
  }, [activeSlotId]);

  useLayoutEffect(() => {
    if (!activeSlotId || !slotEditorAnchor) return;
    const panel = slotEditorRef.current;
    if (!panel) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const padding = 8;
    const maxLeft = Math.max(padding, window.innerWidth - width - padding);
    const left = Math.min(Math.max(slotEditorAnchor.left, padding), maxLeft);
    let top = slotEditorAnchor.bottom + padding;
    if (top + height > window.innerHeight - padding) {
      top = slotEditorAnchor.top - height - padding;
    }
    if (top < padding) {
      top = padding;
    }
    setSlotEditorPosition({ top, left });
  }, [activeSlotId, slotEditorAnchor, slotEditorMode]);

  useEffect(() => {
    if (!activeAddCell) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("[data-add-block-panel]")) return;
      if (target.closest("[data-add-block-trigger]")) return;
      setActiveAddCell(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeAddCell]);

  useEffect(() => {
    if (!activeBlockColorId) return;
    const handler = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(
          `[data-block-color-picker="${activeBlockColorId}"]`,
        )
      ) {
        return;
      }
      if (
        target.closest(
          `[data-block-color-trigger="${activeBlockColorId}"]`,
        )
      ) {
        return;
      }
      setActiveBlockColorId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activeBlockColorId]);

  useEffect(() => {
    setActiveAddCell(null);
    setActiveSlotId(null);
  }, [activeDayType]);

  useEffect(() => {
    if (!activeAddCell) {
      setAddCellAnchor(null);
      setAddCellPosition(null);
    }
  }, [activeAddCell]);

  useLayoutEffect(() => {
    if (!activeAddCell || !addCellAnchor) return;
    const panel = addCellRef.current;
    if (!panel) return;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const padding = 8;
    const maxLeft = Math.max(padding, window.innerWidth - width - padding);
    const left = Math.min(Math.max(addCellAnchor.left, padding), maxLeft);
    let top = addCellAnchor.bottom + padding;
    if (top + height > window.innerHeight - padding) {
      top = addCellAnchor.top - height - padding;
    }
    if (top < padding) {
      top = padding;
    }
    setAddCellPosition({ top, left });
  }, [activeAddCell, addCellAnchor]);

  useEffect(() => {
    if (!showAddBlockPicker) return;
    setNewBlockName("");
  }, [showAddBlockPicker]);

  const updateAllLocations = (
    updater: (location: WeeklyTemplateLocation) => WeeklyTemplateLocation,
  ) => {
    const order = new Map(locations.map((loc, index) => [loc.id, index]));
    const nextLocations = locations.map((loc) => {
      const existing = template.locations.find(
        (item) => item.locationId === loc.id,
      );
      const base = existing ?? emptyTemplateLocation(loc.id);
      return updater(base);
    });
    nextLocations.sort(
      (a, b) => (order.get(a.locationId) ?? 0) - (order.get(b.locationId) ?? 0),
    );
    onChange({ ...template, locations: nextLocations });
  };

  const sharedColumnCounts = useMemo(() => {
    const counts = new Map<DayType, number>();
    for (const dayType of DAY_TYPES) {
      counts.set(dayType, 0);
    }
    for (const location of template.locations ?? []) {
      for (const dayType of DAY_TYPES) {
        const count = location.colBands.filter((band) => band.dayType === dayType).length;
        counts.set(dayType, Math.max(counts.get(dayType) ?? 0, count));
      }
    }
    return counts;
  }, [template.locations]);

  useEffect(() => {
    let needsUpdate = false;
    const nextLocations = locations.map((loc) => {
      const existing = template.locations.find((item) => item.locationId === loc.id);
      const base = existing ?? emptyTemplateLocation(loc.id);
      let nextColBands = base.colBands;
      for (const dayType of DAY_TYPES) {
        const dayBands = sortByOrder(
          nextColBands.filter((band) => band.dayType === dayType),
        );
        const targetCount = sharedColumnCounts.get(dayType) ?? dayBands.length;
        if (dayBands.length < targetCount) {
          const additions: TemplateColBand[] = [];
          for (let i = dayBands.length; i < targetCount; i += 1) {
            additions.push({
              id: createId("col"),
              label: "",
              order: i + 1,
              dayType,
            });
          }
          nextColBands = [...nextColBands, ...additions];
          needsUpdate = true;
        }
      }
      return needsUpdate ? { ...base, colBands: nextColBands } : base;
    });
    if (!needsUpdate) return;
    const order = new Map(locations.map((loc, index) => [loc.id, index]));
    nextLocations.sort(
      (a, b) => (order.get(a.locationId) ?? 0) - (order.get(b.locationId) ?? 0),
    );
    onChange({ ...template, locations: nextLocations });
  }, [locations, sharedColumnCounts, template, onChange]);

  const updateBlocks = (updater: (blocks: TemplateBlock[]) => TemplateBlock[]) => {
    const nextBlocks = updater(blocks);
    if (nextBlocks === blocks) return;
    onChange({ ...template, blocks: nextBlocks });
  };

  const reorderBlocks = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    updateBlocks((prev) => {
      const fromIndex = prev.findIndex((block) => block.id === fromId);
      const toIndex = prev.findIndex((block) => block.id === toId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleUpdateBlockColor = (blockId: string, color: string | null) => {
    const block = blockById.get(blockId);
    if (!block) return;
    onUpdateSectionColor(block.sectionId, color);
    updateBlocks((prev) =>
      prev.map((item) =>
        item.sectionId === block.sectionId
          ? { ...item, color: color ?? undefined }
          : item,
      ),
    );
  };

  const handleAddBlock = (sectionId: string) => {
    const nextBlock: TemplateBlock = {
      id: createId("block"),
      sectionId,
      label: "",
      requiredSlots: 0,
      color: undefined,
    };
    updateBlocks((prev) => [...prev, nextBlock]);
  };

  const handleDeleteBlock = (blockId: string) => {
    if (
      !window.confirm(
        "Delete this block? Any placed slots using it will be removed from the grid.",
      )
    ) {
      return;
    }
    onChange({
      ...template,
      blocks: blocks.filter((block) => block.id !== blockId),
      locations: template.locations.map((location) => ({
        ...location,
        slots: location.slots.filter((slot) => slot.blockId !== blockId),
      })),
    });
  };

  const findSlot = (
    location: WeeklyTemplateLocation,
    rowBandId: string,
    colBandId: string,
  ) =>
    location.slots.find(
      (slot) => slot.rowBandId === rowBandId && slot.colBandId === colBandId,
    );

  const findSlotById = (locationId: string, slotId: string) => {
    const location = template.locations.find((loc) => loc.locationId === locationId);
    const slot = location?.slots.find((item) => item.id === slotId) ?? null;
    return { location, slot };
  };

  const assignBlockToCell = (
    locationId: string,
    rowBandId: string,
    colBandId: string,
    blockId: string,
  ) => {
    const baseLocation =
      template.locations.find((loc) => loc.locationId === locationId) ??
      emptyTemplateLocation(locationId);
    const colBand = baseLocation.colBands.find((band) => band.id === colBandId);
    const colIndex = colBand
      ? getLocationColBandIndex(baseLocation, colBandId)
      : null;
    const columnTime =
      colBand && colIndex !== null
        ? columnTimeByKey.get(`${colBand.dayType}-${colIndex}`) ?? null
        : null;
    let createdSlotId: string | null = null;
    updateTemplateLocation(locationId, (location) => {
      const slot = findSlot(location, rowBandId, colBandId);
      if (!slot) {
        const nextSlot: TemplateSlot = {
          id: createId("slot"),
          locationId,
          rowBandId,
          colBandId,
          blockId,
          requiredSlots: 1,
          startTime: columnTime?.startTime ?? "",
          endTime: columnTime?.endTime ?? "",
          endDayOffset: columnTime?.endDayOffset ?? 0,
        };
        createdSlotId = nextSlot.id;
        return { ...location, slots: [...location.slots, nextSlot] };
      }
      if (slot.blockId === blockId) return location;
      return {
        ...location,
        slots: location.slots.map((item) =>
          item.id === slot.id ? { ...item, blockId } : item,
        ),
      };
    });
    if (createdSlotId && !columnTime) {
      setSlotEditorMode("time");
      setActiveSlotId(createdSlotId);
    }
    return createdSlotId;
  };

  const handleDropBlock = (
    event: DragEvent<HTMLDivElement>,
    locationId: string,
    rowBandId: string,
    colBandId: string,
    blockId: string,
  ) => {
    event.preventDefault();
    assignBlockToCell(locationId, rowBandId, colBandId, blockId);
  };

  const moveSlotToCell = (
    slotId: string,
    sourceLocationId: string,
    targetLocationId: string,
    rowBandId: string,
    colBandId: string,
  ) => {
    if (
      sourceLocationId === targetLocationId &&
      findSlot(
        template.locations.find((loc) => loc.locationId === targetLocationId) ??
          emptyTemplateLocation(targetLocationId),
        rowBandId,
        colBandId,
      )?.id === slotId
    ) {
      return;
    }
    const targetLocation =
      template.locations.find((loc) => loc.locationId === targetLocationId) ??
      emptyTemplateLocation(targetLocationId);
    const existingTargetSlot = findSlot(targetLocation, rowBandId, colBandId);
    if (existingTargetSlot && existingTargetSlot.id !== slotId) return;
    const { slot } = findSlotById(sourceLocationId, slotId);
    if (!slot) return;
    if (sourceLocationId === targetLocationId) {
      updateTemplateLocation(sourceLocationId, (location) => ({
        ...location,
        slots: location.slots.map((item) =>
          item.id === slotId
            ? { ...item, rowBandId, colBandId, locationId: targetLocationId }
            : item,
        ),
      }));
      return;
    }
    updateAllLocations((location) => {
      if (location.locationId === sourceLocationId) {
        return {
          ...location,
          slots: location.slots.filter((item) => item.id !== slotId),
        };
      }
      if (location.locationId === targetLocationId) {
        return {
          ...location,
          slots: [
            ...location.slots.filter((item) => item.id !== slotId),
            {
              ...slot,
              locationId: targetLocationId,
              rowBandId,
              colBandId,
            },
          ],
        };
      }
      return location;
    });
  };

  const handleDeleteSlot = (locationId: string, slotId: string) => {
    updateTemplateLocation(locationId, (location) => ({
      ...location,
      slots: location.slots.filter((slot) => slot.id !== slotId),
    }));
    if (activeSlotId === slotId) {
      setActiveSlotId(null);
    }
  };

  const handleUpdateSlotTime = (
    locationId: string,
    slotId: string,
    updates: Partial<TemplateSlot>,
  ) => {
    updateTemplateLocation(locationId, (location) => ({
      ...location,
      slots: location.slots.map((slot) =>
        slot.id === slotId ? { ...slot, ...updates } : slot,
      ),
    }));
  };

  const handleAddRowBand = (locationId: string) => {
    updateTemplateLocation(locationId, (location) => {
      const next: TemplateRowBand = {
        id: createId("row"),
        label: "",
        order: location.rowBands.length + 1,
      };
      return { ...location, rowBands: [...location.rowBands, next] };
    });
  };

  const handleLocationOrderChange = (locationId: string, rawValue: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return;
    const targetIndex = Math.max(1, Math.trunc(parsed));
    const nextOrder = [...locations.map((loc) => loc.id)];
    const fromIndex = nextOrder.indexOf(locationId);
    if (fromIndex === -1) return;
    const clampedIndex = Math.min(targetIndex, nextOrder.length) - 1;
    nextOrder.splice(fromIndex, 1);
    nextOrder.splice(clampedIndex, 0, locationId);
    onReorderLocations(nextOrder);
  };

  const handleDeleteRowBand = (locationId: string, rowBandId: string) => {
    updateTemplateLocation(locationId, (location) => ({
      ...location,
      rowBands: location.rowBands
        .filter((band) => band.id !== rowBandId)
        .map((band, index) => ({ ...band, order: index + 1 })),
      slots: location.slots.filter((slot) => slot.rowBandId !== rowBandId),
    }));
  };

  const handleRenameRowBand = (
    locationId: string,
    rowBandId: string,
    label: string,
  ) => {
    updateTemplateLocation(locationId, (location) => ({
      ...location,
      rowBands: location.rowBands.map((band) =>
        band.id === rowBandId ? { ...band, label } : band,
      ),
    }));
  };

  const handleAddColBand = (dayType: DayType) => {
    const maxCount = sharedColumnCounts.get(dayType) ?? 0;
    updateAllLocations((location) => {
      const next: TemplateColBand = {
        id: createId("col"),
        label: "",
        order: maxCount + 1,
        dayType,
      };
      return { ...location, colBands: [...location.colBands, next] };
    });
  };

  const handleDeleteColBand = (dayType: DayType, bandIndex: number) => {
    updateAllLocations((location) => {
      const dayBands = sortByOrder(
        location.colBands.filter((band) => band.dayType === dayType),
      );
      const target = dayBands[bandIndex];
      if (!target) return location;
      const remaining = location.colBands.filter((band) => band.id !== target.id);
      const normalizedDay = sortByOrder(
        remaining.filter((band) => band.dayType === dayType),
      ).map((band, index) => ({ ...band, order: index + 1 }));
      const otherBands = remaining.filter((band) => band.dayType !== dayType);
      return {
        ...location,
        colBands: [...otherBands, ...normalizedDay],
        slots: location.slots.filter((slot) => slot.colBandId !== target.id),
      };
    });
  };


  const renderBlockCard = (
    block: TemplateBlock,
    slot: TemplateSlot | null,
    onTimeClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void,
    onRequiredClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void,
  ) => {
    const sectionName = sectionNameById.get(block.sectionId) ?? "Section";
    const requiredSlots = slot?.requiredSlots ?? 0;
    const hasTime = !!slot?.startTime && !!slot?.endTime;
    const blockColor = sectionColorById.get(block.sectionId) ?? block.color;
    const blockStyle = blockColor ? { backgroundColor: blockColor } : undefined;
    const timeLabel = hasTime
      ? `${formatTime(slot?.startTime)} - ${formatTime(slot?.endTime)}${
          (slot?.endDayOffset ?? 0) > 0 ? ` +${slot?.endDayOffset}d` : ""
        }`
      : "Choose time";
    return (
      <div
        className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        style={blockStyle}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{sectionName}</span>
          <button
            type="button"
            data-slot-required-trigger={slot?.id}
            onClick={onRequiredClick}
            className="rounded-md bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {requiredSlots}
          </button>
        </div>
        <button
          className={cx(
            "block w-full text-left text-[10px]",
            hasTime
              ? "text-slate-500 dark:text-slate-400"
              : "font-semibold text-rose-500",
            onTimeClick && "text-left",
          )}
          type="button"
          data-slot-time-trigger={slot?.id}
          onClick={onTimeClick}
          disabled={!onTimeClick}
        >
          {timeLabel}
        </button>
      </div>
    );
  };

  const renderSlotTimeEditor = (locationId: string, slot: TemplateSlot) => {
    return (
      <div
        ref={slotEditorRef}
        data-slot-time-editor
        className="fixed z-50 w-[260px] rounded-xl border border-slate-200 bg-white p-3 text-[11px] text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        style={
          slotEditorPosition
            ? { top: slotEditorPosition.top, left: slotEditorPosition.left }
            : undefined
        }
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold">
            {slotEditorMode === "required" ? "Required slots" : "Slot time"}
          </span>
          <button
            type="button"
            onClick={() => setActiveSlotId(null)}
            className="text-slate-400 hover:text-slate-500"
          >
            x
          </button>
        </div>
        {slotEditorMode === "required" ? (
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Required
            </label>
            <input
              type="number"
              min={0}
              className="mt-1 w-24 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              value={slot.requiredSlots ?? 0}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                const value = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
                handleUpdateSlotTime(locationId, slot.id, { requiredSlots: value });
              }}
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            <input
              className={cx(
                "w-20 rounded border px-2 py-1 text-[11px]",
                isInvalidTimeDraft(`${slot.id}-start`)
                  ? "border-rose-300"
                  : "border-slate-200",
                "dark:border-slate-700 dark:bg-slate-950",
              )}
              placeholder="08:00"
              value={timeDrafts[`${slot.id}-start`] ?? slot.startTime ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                setTimeDrafts((prev) => ({
                  ...prev,
                  [`${slot.id}-start`]: value,
                }));
                if (!value.trim()) {
                  handleUpdateSlotTime(locationId, slot.id, { startTime: "" });
                  return;
                }
                const normalized = normalizeTimeInput(value);
                if (!normalized) return;
                handleUpdateSlotTime(locationId, slot.id, { startTime: normalized });
              }}
            />
            <span className="pt-1">-</span>
            <div className="flex flex-col items-start">
              <input
                className={cx(
                  "w-20 rounded border px-2 py-1 text-[11px]",
                  isInvalidTimeDraft(`${slot.id}-end`)
                    ? "border-rose-300"
                    : "border-slate-200",
                  "dark:border-slate-700 dark:bg-slate-950",
                )}
                placeholder="16:00"
                value={timeDrafts[`${slot.id}-end`] ?? slot.endTime ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setTimeDrafts((prev) => ({
                    ...prev,
                    [`${slot.id}-end`]: value,
                  }));
                  if (!value.trim()) {
                    handleUpdateSlotTime(locationId, slot.id, { endTime: "" });
                    return;
                  }
                  const normalized = normalizeTimeInput(value);
                  if (!normalized) return;
                  handleUpdateSlotTime(locationId, slot.id, { endTime: normalized });
                }}
              />
              <select
                className="mt-1 rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                value={slot.endDayOffset ?? 0}
                onChange={(event) => {
                  const value = clampOffset(Number(event.target.value));
                  handleUpdateSlotTime(locationId, slot.id, { endDayOffset: value });
                }}
              >
                {[0, 1, 2, 3].map((option) => (
                  <option key={option} value={option}>
                    +{option}d
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAddBlockPanel = () => {
    if (!activeAddCell || (!addCellPosition && !addCellAnchor)) return null;
    const fallbackTop = addCellAnchor ? addCellAnchor.bottom + 8 : 0;
    const fallbackLeft = addCellAnchor ? addCellAnchor.left : 0;
    return (
      <div
        ref={addCellRef}
        data-add-block-panel
        className="fixed z-50 min-w-[220px] rounded-xl border border-slate-200 bg-white p-2 text-[11px] shadow-lg dark:border-slate-700 dark:bg-slate-950"
        style={{
          top: addCellPosition?.top ?? fallbackTop,
          left: addCellPosition?.left ?? fallbackLeft,
        }}
      >
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-100">
          Add block
          <button
            type="button"
            onClick={() => setActiveAddCell(null)}
            className="text-[10px] font-semibold text-slate-400 hover:text-slate-500"
          >
            x
          </button>
        </div>
        {blocks.length === 0 ? (
          <div className="mt-2 text-[10px] text-slate-400">
            Create a section block first.
          </div>
        ) : (
          <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
            {blocks.map((block) => {
              const sectionName =
                sectionNameById.get(block.sectionId) ?? "Section";
              return (
                <button
                  key={block.id}
                  type="button"
                  className="rounded-lg border border-slate-200 px-2 py-1 text-left text-[10px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                  onClick={() => {
                    if (!activeAddCell) return;
                    assignBlockToCell(
                      activeAddCell.locationId,
                      activeAddCell.rowBandId,
                      activeAddCell.colBandId,
                      block.id,
                    );
                    setActiveAddCell(null);
                  }}
                >
                  {sectionName}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const getLocationColBandByIndex = (
    location: WeeklyTemplateLocation,
    dayType: DayType,
    index: number,
  ) => {
    const dayBands = sortByOrder(
      location.colBands.filter((band) => band.dayType === dayType),
    );
    return dayBands[index] ?? null;
  };

  const getLocationColBandIndex = (
    location: WeeklyTemplateLocation,
    colBandId: string,
  ) => {
    const colBand = location.colBands.find((band) => band.id === colBandId);
    if (!colBand) return null;
    const dayBands = sortByOrder(
      location.colBands.filter((band) => band.dayType === colBand.dayType),
    );
    const index = dayBands.findIndex((band) => band.id === colBandId);
    return index === -1 ? null : index;
  };

  const columnTimeByKey = useMemo(() => {
    const map = new Map<
      string,
      { startTime: string; endTime: string; endDayOffset: number } | null
    >();
    for (const dayType of DAY_TYPES) {
      const maxCount = sharedColumnCounts.get(dayType) ?? 0;
      for (let colIndex = 0; colIndex < maxCount; colIndex += 1) {
        let time: { startTime: string; endTime: string; endDayOffset: number } | null =
          null;
        let hasSlot = false;
        let invalid = false;
        for (const location of template.locations ?? []) {
          const colBand = getLocationColBandByIndex(location, dayType, colIndex);
          if (!colBand) continue;
          for (const slot of location.slots) {
            if (slot.colBandId !== colBand.id) continue;
            hasSlot = true;
            const startTime = slot.startTime?.trim() ?? "";
            const endTime = slot.endTime?.trim() ?? "";
            const endDayOffset =
              typeof slot.endDayOffset === "number" ? slot.endDayOffset : 0;
            if (!startTime || !endTime) {
              invalid = true;
              break;
            }
            if (!time) {
              time = { startTime, endTime, endDayOffset };
            } else if (
              time.startTime !== startTime ||
              time.endTime !== endTime ||
              time.endDayOffset !== endDayOffset
            ) {
              invalid = true;
              break;
            }
          }
          if (invalid) break;
        }
        map.set(
          `${dayType}-${colIndex}`,
          hasSlot && !invalid ? time : null,
        );
      }
    }
    return map;
  }, [sharedColumnCounts, template.locations]);

  const formatColumnTimeLabel = (time: {
    startTime: string;
    endTime: string;
    endDayOffset: number;
  }) =>
    `${formatTime(time.startTime)} - ${formatTime(time.endTime)}${
      time.endDayOffset > 0 ? ` +${time.endDayOffset}d` : ""
    }`;

  const highlightedLocationId =
    pendingDeleteLocationId ?? hoveredDeleteLocationId ?? null;

  const hasSlotsInColumn = (dayType: DayType, bandIndex: number) =>
    locations.some((location) => {
      const templateLocation =
        template.locations.find((loc) => loc.locationId === location.id) ??
        emptyTemplateLocation(location.id);
      const colBand = getLocationColBandByIndex(
        templateLocation,
        dayType,
        bandIndex,
      );
      if (!colBand) return false;
      return templateLocation.slots.some((slot) => slot.colBandId === colBand.id);
    });

  const headerLocation =
    template.locations.find((loc) => loc.locationId === locations[0]?.id) ??
    template.locations[0] ??
    null;

  const headerColBandsByDay = useMemo(() => {
    const map = new Map<DayType, TemplateColBand[]>();
    for (const dayType of DAY_TYPES) {
      const bands = headerLocation
        ? sortByOrder(
            headerLocation.colBands.filter((band) => band.dayType === dayType),
          )
        : [];
      const targetCount = sharedColumnCounts.get(dayType) ?? bands.length;
      const padded = [...bands];
      while (padded.length < targetCount) {
        padded.push({
          id: createId("col"),
          label: "",
          order: padded.length + 1,
          dayType,
        });
      }
      map.set(dayType, padded);
    }
    return map;
  }, [headerLocation, sharedColumnCounts]);

  const gridColumns = visibleDayTypes.reduce(
    (sum, dayType) => sum + Math.max(sharedColumnCounts.get(dayType) ?? 0, 1),
    0,
  );

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="mb-3 overflow-x-auto">
          <div className="flex min-w-max gap-2">
            {DAY_TYPES.map((dayType) => (
              <button
                key={dayType}
                type="button"
                onClick={() => {
                  setActiveDayType(dayType);
                  const container = gridScrollRef.current;
                  if (!container) return;
                  const target = container.querySelector(
                    `[data-template-day-header="${dayType}"]`,
                  ) as HTMLElement | null;
                  if (!target) return;
                  target.scrollIntoView({
                    behavior: "smooth",
                    inline: "start",
                    block: "nearest",
                  });
                }}
                data-template-day-toggle={dayType}
                className={cx(
                  "rounded-full border px-3 py-1 text-[10px] font-semibold",
                  activeDayType === dayType
                    ? "border-slate-400 bg-slate-100 text-slate-700"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50",
                  "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
                )}
              >
                {DAY_TYPE_LABELS[dayType]}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto" ref={gridScrollRef}>
          <div
            className="grid text-[11px]"
            style={{
              gridTemplateColumns: `minmax(180px, 220px) repeat(${gridColumns}, minmax(140px, 1fr))`,
            }}
            onMouseMove={(event) => {
              const target = event.target as HTMLElement | null;
              if (!target) return;
              const columnEl = target.closest("[data-column-key]") as HTMLElement | null;
              if (!columnEl) {
                if (hoveredColumn) setHoveredColumn(null);
              } else {
                const dayType = columnEl.dataset.dayType as DayType | undefined;
                const colIndex = columnEl.dataset.colIndex;
                if (!dayType || colIndex === undefined) return;
                const next = { dayType, index: Number(colIndex) };
                if (
                  hoveredColumn?.dayType !== next.dayType ||
                  hoveredColumn?.index !== next.index
                ) {
                  setHoveredColumn(next);
                }
              }
              const rowEl = target.closest("[data-row-band-id]") as HTMLElement | null;
              const rowBandId = rowEl?.dataset.rowBandId ?? null;
              if (rowBandId !== hoveredRowBandId) {
                setHoveredRowBandId(rowBandId);
              }
            }}
            onMouseLeave={() => {
              setHoveredColumn(null);
              setHoveredRowBandId(null);
            }}
          >
            <div className="border-b border-r border-slate-200 bg-slate-50 p-2 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60">
              <button
                type="button"
                onClick={() => onAddLocation("Location Placeholder")}
                className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                + Location
              </button>
            </div>
            {visibleDayTypes.map((dayType) => {
              const dayBands = headerColBandsByDay.get(dayType) ?? [];
              const columnCount = Math.max(dayBands.length, 1);
              const columnTimes = Array.from({ length: columnCount }, (_, colIndex) =>
                columnTimeByKey.get(`${dayType}-${colIndex}`) ?? null,
              );
              const hasColumnTimes = columnTimes.some((time) => !!time);
              return (
                <div
                  key={`shared-${dayType}-header`}
                  className="flex items-center justify-between border-b border-r-2 border-slate-300 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200"
                  style={{ gridColumn: `span ${columnCount}` }}
                  data-template-day-header={dayType}
                >
                  <div className="flex w-full flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span>{DAY_TYPE_LABELS[dayType]}</span>
                      <button
                        type="button"
                        onClick={() => handleAddColBand(dayType)}
                        className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        aria-label={`Add ${DAY_TYPE_LABELS[dayType]} column`}
                      >
                        Add column
                      </button>
                    </div>
                    {hasColumnTimes ? (
                      <div
                        className="grid text-[9px] font-semibold text-slate-400"
                        style={{
                          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                        }}
                      >
                        {columnTimes.map((time, colIndex) => (
                          <div
                            key={`${dayType}-time-${colIndex}`}
                            className="truncate text-center leading-tight"
                          >
                            {time ? formatColumnTimeLabel(time) : ""}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {locations.map((location, locationIndex) => {
              const templateLocation =
                template.locations.find((loc) => loc.locationId === location.id) ??
                emptyTemplateLocation(location.id);
              const rowBands = sortByOrder(templateLocation.rowBands);
              const slotByKey = new Map(
                templateLocation.slots.map((slot) => [
                  `${slot.rowBandId}__${slot.colBandId}`,
                  slot,
                ]),
              );
              const showDivider = locationIndex > 0;
              const isLocationHighlighted = highlightedLocationId === location.id;
              return (
                <Fragment key={location.id}>
                  {showDivider ? (
                    <div
                      className="col-span-full border-t-2 border-slate-300 dark:border-slate-700"
                      aria-hidden="true"
                    />
                  ) : null}
                  <div
                    className={cx(
                      "col-span-full border-b border-slate-200 bg-white px-2 py-2 dark:border-slate-800 dark:bg-slate-950",
                      isLocationHighlighted && "ring-2 ring-rose-400 ring-inset",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <select
                        value={locationIndex + 1}
                        onChange={(event) =>
                          handleLocationOrderChange(location.id, event.target.value)
                        }
                        className="w-14 rounded border border-slate-200 px-1 py-0.5 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      >
                        {Array.from({ length: locations.length }, (_, index) => (
                          <option key={index + 1} value={index + 1}>
                            {index + 1}
                          </option>
                        ))}
                      </select>
                      <input
                        className="w-40 rounded border border-slate-200 px-2 py-1 text-[11px] font-normal text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        value={location.name}
                        onChange={(event) =>
                          onRenameLocation(location.id, event.target.value)
                        }
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (locations.length <= 1) {
                            window.alert("At least one location is required.");
                            return;
                          }
                          setPendingDeleteLocationId(location.id);
                          window.setTimeout(() => {
                            const confirmed = window.confirm(
                              "Delete this location and all of its rows/slots?",
                            );
                            setPendingDeleteLocationId(null);
                            if (!confirmed) return;
                            onRemoveLocation(location.id);
                          }, 0);
                        }}
                        onMouseEnter={() =>
                          setHoveredDeleteLocationId(location.id)
                        }
                        onMouseLeave={() =>
                          setHoveredDeleteLocationId((prev) =>
                            prev === location.id ? null : prev,
                          )
                        }
                        className="rounded-full border border-slate-200 px-2 py-0.5 text-[10px] font-semibold text-rose-500 hover:text-rose-600 dark:border-slate-700 dark:text-rose-300"
                      >
                        Delete Location
                      </button>
                    </div>
                  </div>
                  {rowBands.map((band, rowIndex) => (
                    <Fragment key={`${location.id}-${band.id}`}>
                      {(() => {
                        const isRowHighlighted =
                          hoveredDeleteRowBand?.locationId === location.id &&
                          hoveredDeleteRowBand?.rowBandId === band.id;
                        const isRowHovered = hoveredRowBandId === band.id;
                        return (
                      <div
                        className={cx(
                          "group relative z-10 flex items-center overflow-visible border-b border-r border-slate-200 bg-white p-2 pl-12 pr-3 dark:border-slate-800 dark:bg-slate-950",
                          isLocationHighlighted && "ring-2 ring-rose-400 ring-inset",
                          isRowHighlighted && "ring-2 ring-rose-400 ring-inset",
                        )}
                        data-row-band-id={band.id}
                      >
                        <div className="flex w-full items-center gap-2">
                          <input
                            value={band.label ?? ""}
                            onChange={(event) =>
                              handleRenameRowBand(
                                location.id,
                                band.id,
                                event.target.value,
                              )
                            }
                            placeholder="Row label"
                            className="flex-1 w-full min-w-0 rounded border border-slate-200 px-2 py-1 text-[11px] font-normal text-slate-700 placeholder:text-slate-400 focus:border-sky-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          />
                          <div className="absolute left-0 top-0 bottom-0 z-20 flex items-center justify-center">
                            <button
                              type="button"
                              onClick={() => {
                                const hasSlots = templateLocation.slots.some(
                                  (slot) => slot.rowBandId === band.id,
                                );
                                if (
                                  hasSlots &&
                                  !window.confirm(
                                    "Delete this row? Any slots in this row will be removed.",
                                  )
                                ) {
                                  return;
                                }
                                handleDeleteRowBand(location.id, band.id);
                              }}
                              onMouseEnter={() =>
                                setHoveredDeleteRowBand({
                                  locationId: location.id,
                                  rowBandId: band.id,
                                })
                              }
                              onMouseLeave={() => setHoveredDeleteRowBand(null)}
                              data-testid={`delete-row-${location.id}-${band.id}`}
                              className={cx(
                                "rounded-full border border-slate-200 bg-white px-1 py-1 text-[10px] font-semibold text-rose-500 shadow-sm transition-opacity hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900 dark:text-rose-300",
                                isRowHovered ? "opacity-100" : "opacity-0",
                              )}
                              style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)" }}
                              aria-label="Delete row"
                            >
                              Delete row
                            </button>
                          </div>
                        </div>
                      </div>
                        );
                      })()}

                    {visibleDayTypes.map((dayType) => {
                        const targetCount = Math.max(
                          sharedColumnCounts.get(dayType) ?? 0,
                          1,
                        );
                        return Array.from({ length: targetCount }).map((_, colIndex) => {
                          const isLastInDay = colIndex === targetCount - 1;
                          const colBand = getLocationColBandByIndex(
                            templateLocation,
                            dayType,
                            colIndex,
                          );
                          const key = colBand ? `${band.id}__${colBand.id}` : null;
                          const slot = key ? slotByKey.get(key) : null;
                          const block = slot ? blockById.get(slot.blockId) : null;
                          const dragKey = `${location.id}-${band.id}-${colBand?.id ?? dayType}-${colIndex}`;
                          const isHighlightedColumn =
                            (pendingDeleteColumn?.dayType === dayType &&
                              pendingDeleteColumn.index === colIndex) ||
                            (hoveredDeleteColumn?.dayType === dayType &&
                              hoveredDeleteColumn.index === colIndex);
                          const isRowHighlighted =
                            hoveredDeleteRowBand?.locationId === location.id &&
                            hoveredDeleteRowBand?.rowBandId === band.id;
                          const showColumnDeleteButton =
                            locationIndex === 0 && rowIndex === 0 && !!colBand;
                          const isColumnHovered =
                            hoveredColumn?.dayType === dayType &&
                            hoveredColumn.index === colIndex;
                          return (
                            <div
                              key={`${location.id}-${band.id}-${dayType}-${colIndex}`}
                              className={cx(
                                "relative border-b border-r border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950",
                                isLastInDay &&
                                  "border-r-2 border-r-slate-300 dark:border-r-slate-700",
                                dragOverCell === dragKey &&
                                  "ring-2 ring-emerald-300 ring-inset",
                                isLocationHighlighted &&
                                  "ring-2 ring-rose-400 ring-inset",
                                isRowHighlighted &&
                                  "ring-2 ring-rose-400 ring-inset",
                                isHighlightedColumn &&
                                  "ring-2 ring-rose-400 ring-inset",
                              )}
                              data-column-key={`${dayType}-${colIndex}`}
                              data-row-band-id={band.id}
                              data-day-type={dayType}
                              data-col-index={colIndex}
                              data-add-block-trigger={!slot ? "true" : undefined}
                              onClick={(event) => {
                                if (!colBand || slot) return;
                                event.stopPropagation();
                                const anchor = event.currentTarget.getBoundingClientRect();
                                setActiveSlotId(null);
                                setAddCellAnchor(anchor);
                                setAddCellPosition({
                                  top: anchor.bottom + 8,
                                  left: anchor.left,
                                });
                                setActiveAddCell({
                                  locationId: location.id,
                                  rowBandId: band.id,
                                  colBandId: colBand.id,
                                });
                              }}
                              onDragOver={(event) => {
                                if (!colBand) return;
                                event.preventDefault();
                                setDragOverCell(dragKey);
                              }}
                              onDragLeave={() => {
                                setDragOverCell((prev) =>
                                  prev === dragKey ? null : prev,
                                );
                              }}
                              onDrop={(event) => {
                                setDragOverCell(null);
                                if (!colBand) return;
                                const slotPayload = event.dataTransfer.getData(
                                  "application/x-slot-move",
                                );
                                if (slotPayload) {
                                  try {
                                    const parsed = JSON.parse(slotPayload) as {
                                      slotId: string;
                                      locationId: string;
                                    };
                                    if (parsed?.slotId && parsed?.locationId) {
                                      moveSlotToCell(
                                        parsed.slotId,
                                        parsed.locationId,
                                        location.id,
                                        band.id,
                                        colBand.id,
                                      );
                                      return;
                                    }
                                  } catch {
                                    // ignore invalid drag payload
                                  }
                                }
                                const blockId = event.dataTransfer.getData(
                                  "application/x-block-id",
                                );
                                if (!blockId) return;
                                handleDropBlock(
                                  event,
                                  location.id,
                                  band.id,
                                  colBand.id,
                                  blockId,
                                );
                              }}
                            >
                              {showColumnDeleteButton ? (
                                <div className="absolute left-2 right-2 -top-3 flex justify-center">
                                  <button
                                    type="button"
                                    className={cx(
                                      "rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-500 shadow-sm transition-opacity hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900",
                                      isColumnHovered ? "opacity-100" : "opacity-0",
                                    )}
                                    data-testid={`delete-column-${dayType}-${colIndex}`}
                                    onMouseEnter={() =>
                                      setHoveredDeleteColumn({
                                        dayType,
                                        index: colIndex,
                                      })
                                    }
                                    onMouseLeave={() =>
                                      setHoveredDeleteColumn((prev) =>
                                        prev?.dayType === dayType &&
                                        prev?.index === colIndex
                                          ? null
                                          : prev,
                                      )
                                    }
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      const dayBands =
                                        headerColBandsByDay.get(dayType) ?? [];
                                      if (dayBands.length <= 1) {
                                        window.alert(
                                          "Each day needs at least one column.",
                                        );
                                        return;
                                      }
                                      const hasEntries = hasSlotsInColumn(
                                        dayType,
                                        colIndex,
                                      );
                                      if (!hasEntries) {
                                        handleDeleteColBand(dayType, colIndex);
                                        return;
                                      }
                                      setPendingDeleteColumn({
                                        dayType,
                                        index: colIndex,
                                      });
                                      window.setTimeout(() => {
                                        const confirmed = window.confirm(
                                          "Delete this column? Any slots in this column will be removed.",
                                        );
                                        setPendingDeleteColumn(null);
                                        if (!confirmed) return;
                                        handleDeleteColBand(dayType, colIndex);
                                      }, 0);
                                    }}
                                  >
                                    Delete Column
                                  </button>
                                </div>
                              ) : null}
                              {block && slot ? (
                                <div
                                  className="group relative"
                                  draggable
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = "move";
                                    event.dataTransfer.setData(
                                      "application/x-slot-move",
                                      JSON.stringify({
                                        slotId: slot.id,
                                        locationId: location.id,
                                      }),
                                    );
                                  }}
                                >
                                  {renderBlockCard(
                                    block,
                                    slot,
                                    (event) => {
                                      event.stopPropagation();
                                      setSlotEditorMode("time");
                                      setSlotEditorAnchor(
                                        event.currentTarget.getBoundingClientRect(),
                                      );
                                      setActiveSlotId(slot.id);
                                    },
                                    (event) => {
                                      event.stopPropagation();
                                      setSlotEditorMode("required");
                                      setSlotEditorAnchor(
                                        event.currentTarget.getBoundingClientRect(),
                                      );
                                      setActiveSlotId(slot.id);
                                    },
                                  )}
                                  <div className="absolute -top-2 left-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleDeleteSlot(location.id, slot.id);
                                      }}
                                      className="rounded-full border border-slate-200 bg-white px-1 text-[10px] font-semibold text-rose-500 shadow-sm hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900"
                                      aria-label="Remove slot"
                                    >
                                      x
                                    </button>
                                  </div>
                                  {activeSlotId === slot.id
                                    ? renderSlotTimeEditor(location.id, slot)
                                    : null}
                                </div>
                              ) : (
                                <div className="text-[10px] text-slate-400 dark:text-slate-600">
                                  {colBand ? "Drop a block or click to add a block." : ""}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })}
                    </Fragment>
                  ))}
                  <div
                    className={cx(
                      "border-b border-r border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950",
                      isLocationHighlighted && "ring-2 ring-rose-400 ring-inset",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => handleAddRowBand(location.id)}
                      className="w-full rounded-full border border-dashed border-slate-300 bg-slate-50 px-3 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200"
                    >
                      Add row
                    </button>
                  </div>
                  {visibleDayTypes.map((dayType) => {
                    const targetCount = Math.max(
                      sharedColumnCounts.get(dayType) ?? 0,
                      1,
                    );
                    return Array.from({ length: targetCount }).map((_, colIndex) => {
                      const isLastInDay = colIndex === targetCount - 1;
                      const isHighlightedColumn =
                        (pendingDeleteColumn?.dayType === dayType &&
                          pendingDeleteColumn.index === colIndex) ||
                        (hoveredDeleteColumn?.dayType === dayType &&
                          hoveredDeleteColumn.index === colIndex);
                      const showColumnDeleteButton =
                        locationIndex === 0 && rowBands.length === 0;
                      const isColumnHovered =
                        hoveredColumn?.dayType === dayType &&
                        hoveredColumn.index === colIndex;
                      return (
                        <div
                          key={`${location.id}-add-row-${dayType}-${colIndex}`}
                          className={cx(
                            "relative border-b border-r border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-950",
                            isLastInDay &&
                              "border-r-2 border-r-slate-300 dark:border-r-slate-700",
                            isLocationHighlighted &&
                              "ring-2 ring-rose-400 ring-inset",
                            isHighlightedColumn &&
                              "ring-2 ring-rose-400 ring-inset",
                          )}
                          data-column-key={`${dayType}-${colIndex}`}
                          data-day-type={dayType}
                          data-col-index={colIndex}
                          aria-hidden={showColumnDeleteButton ? undefined : "true"}
                        >
                          {showColumnDeleteButton ? (
                            <div className="absolute left-2 right-2 top-1 flex justify-center">
                              <button
                                type="button"
                                className={cx(
                                  "rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-rose-500 shadow-sm transition-opacity hover:text-rose-600 dark:border-slate-700 dark:bg-slate-900",
                                  isColumnHovered ? "opacity-100" : "opacity-0",
                                )}
                                data-testid={`delete-column-${dayType}-${colIndex}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  const dayBands =
                                    headerColBandsByDay.get(dayType) ?? [];
                                  if (dayBands.length <= 1) {
                                    window.alert(
                                      "Each day needs at least one column.",
                                    );
                                    return;
                                  }
                                  const hasEntries = hasSlotsInColumn(
                                    dayType,
                                    colIndex,
                                  );
                                  if (!hasEntries) {
                                    handleDeleteColBand(dayType, colIndex);
                                    return;
                                  }
                                  setPendingDeleteColumn({
                                    dayType,
                                    index: colIndex,
                                  });
                                  window.setTimeout(() => {
                                    const confirmed = window.confirm(
                                      "Delete this column? Any slots in this column will be removed.",
                                    );
                                    setPendingDeleteColumn(null);
                                    if (!confirmed) return;
                                    handleDeleteColBand(dayType, colIndex);
                                  }, 0);
                                }}
                              >
                                Delete Column
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    });
                  })}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div className="w-full rounded-3xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-950 lg:min-w-56 lg:w-fit lg:max-w-[22rem] self-start sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-slate-700 dark:text-slate-100">
            Section blocks
          </div>
          <button
            type="button"
            onClick={() => setShowAddBlockPicker((prev) => !prev)}
            className="rounded-full border border-dashed border-slate-300 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200"
          >
            + Add block
          </button>
        </div>
        {showAddBlockPicker ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-[11px] dark:border-slate-800 dark:bg-slate-900/60">
            <input
              className="w-48 rounded border border-slate-200 px-2 py-1 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              placeholder="Section name"
              value={newBlockName}
              onChange={(event) => setNewBlockName(event.target.value)}
            />
            <button
              type="button"
              onClick={() => {
                const trimmed = newBlockName.trim();
                if (!trimmed) return;
                const sectionId = onCreateSection(trimmed);
                handleAddBlock(sectionId);
                setShowAddBlockPicker(false);
              }}
              className="rounded-full border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setShowAddBlockPicker(false)}
              className="text-[10px] font-semibold text-slate-400 hover:text-slate-500"
            >
              Cancel
            </button>
          </div>
        ) : null}
        <div className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
          Drag to reorder. Top blocks get higher solver priority.
        </div>
        <div className="mt-2 flex flex-col gap-1.5">
          {blocks.map((block) => {
            const sectionName = sectionNameById.get(block.sectionId) ?? "Section";
            const blockColor = sectionColorById.get(block.sectionId) ?? block.color;
            const customColorValue = blockColor ?? "#ffffff";
            return (
              <div
                key={block.id}
                className="group relative"
                onDragOver={(event) => {
                  const activeId =
                    draggingBlockId ||
                    event.dataTransfer.getData("application/x-block-id");
                  if (!activeId || activeId === block.id) return;
                  event.preventDefault();
                  setDragOverBlockId(block.id);
                }}
                onDragLeave={() => {
                  setDragOverBlockId((prev) => (prev === block.id ? null : prev));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const activeId =
                    draggingBlockId ||
                    event.dataTransfer.getData("application/x-block-id");
                  if (!activeId || activeId === block.id) return;
                  reorderBlocks(activeId, block.id);
                  setDraggingBlockId(null);
                  setDragOverBlockId(null);
                }}
              >
                <div
                  className={cx(
                    "flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold shadow-sm",
                    "border-slate-200 bg-white text-slate-600",
                    "dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200",
                    dragOverBlockId === block.id && "border-sky-300 bg-sky-50",
                  )}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copyMove";
                    event.dataTransfer.setData("application/x-block-id", block.id);
                    setDraggingBlockId(block.id);
                    setDragOverBlockId(null);
                  }}
                  onDragEnd={() => {
                    setDraggingBlockId(null);
                    setDragOverBlockId(null);
                  }}
                >
                  <button
                    type="button"
                    data-block-color-trigger={block.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      const padding = 8;
                      const panelWidth = 180;
                      const panelHeight = 120;
                      let nextLeft = rect.left;
                      let nextTop = rect.bottom + 8;
                      if (nextLeft + panelWidth + padding > window.innerWidth) {
                        nextLeft = window.innerWidth - panelWidth - padding;
                      }
                      if (nextTop + panelHeight + padding > window.innerHeight) {
                        nextTop = rect.top - panelHeight - 8;
                      }
                      nextLeft = Math.max(padding, nextLeft);
                      nextTop = Math.max(padding, nextTop);
                      setBlockColorPopoverPosition({ top: nextTop, left: nextLeft });
                      setActiveBlockColorId((prev) =>
                        prev === block.id ? null : block.id,
                      );
                    }}
                    className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
                    aria-label="Select block color"
                  >
                    <span
                      className={cx(
                        "h-3 w-3 rounded-full",
                        !blockColor && "border border-slate-300",
                      )}
                      style={blockColor ? { backgroundColor: blockColor } : undefined}
                    />
                  </button>
                  <span className="whitespace-nowrap">{sectionName}</span>
                </div>
                {activeBlockColorId === block.id ? (
                  <div
                    data-block-color-picker={block.id}
                    className="fixed z-50 rounded-lg border border-slate-200 bg-white p-2 text-[10px] shadow-lg dark:border-slate-700 dark:bg-slate-900"
                    style={{
                      top: blockColorPopoverPosition.top,
                      left: blockColorPopoverPosition.left,
                    }}
                  >
                    <div className="grid grid-cols-4 gap-1">
                      {BLOCK_COLOR_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"
                          onClick={() => {
                            handleUpdateBlockColor(block.id, option.color);
                            setActiveBlockColorId(null);
                          }}
                          aria-label="Set block color"
                        >
                          <span
                            className={cx(
                              "h-3 w-3 rounded-full",
                              option.color === null && "border border-slate-300",
                            )}
                            style={
                              option.color ? { backgroundColor: option.color } : undefined
                            }
                          />
                        </button>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[10px] font-semibold text-slate-500 dark:text-slate-300">
                        Custom
                      </span>
                      <label className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                        <input
                          type="color"
                          value={customColorValue}
                          onChange={(event) => {
                            handleUpdateBlockColor(block.id, event.target.value);
                            setActiveBlockColorId(null);
                          }}
                          className="h-5 w-5 cursor-pointer appearance-none rounded-full bg-transparent p-0"
                          aria-label="Custom block color"
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => handleDeleteBlock(block.id)}
                  className="absolute -top-2 left-2 rounded-full border border-slate-200 bg-white px-1 text-[10px] font-semibold text-rose-500 opacity-0 shadow-sm transition-opacity hover:text-rose-600 group-hover:opacity-100 dark:border-slate-700 dark:bg-slate-900"
                  aria-label="Delete block"
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {renderAddBlockPanel()}
    </div>
  );
}
