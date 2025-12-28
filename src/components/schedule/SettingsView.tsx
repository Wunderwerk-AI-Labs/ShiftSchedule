import { useState } from "react";
import { cx } from "../../lib/classNames";
import { Location, WorkplaceRow } from "../../data/mockData";
import type { Holiday } from "../../api/client";
import {
  buildShiftRowId,
  DEFAULT_LOCATION_ID,
  normalizeSubShifts,
} from "../../lib/shiftRows";

type SettingsViewProps = {
  classRows: WorkplaceRow[];
  poolRows: WorkplaceRow[];
  locations: Location[];
  locationsEnabled: boolean;
  minSlotsByRowId: Record<string, { weekday: number; weekend: number }>;
  clinicians: Array<{ id: string; name: string }>;
  holidays: Holiday[];
  holidayCountry: string;
  holidayYear: number;
  onChangeMinSlots: (
    rowId: string,
    kind: "weekday" | "weekend",
    nextValue: number,
  ) => void;
  onRenameClass: (rowId: string, nextName: string) => void;
  onRemoveClass: (rowId: string) => void;
  onAddClass: () => void;
  onReorderClass: (fromId: string, toId: string) => void;
  onChangeClassLocation: (rowId: string, locationId: string) => void;
  onSetSubShiftCount: (rowId: string, nextCount: number) => void;
  onRenameSubShift: (rowId: string, subShiftId: string, nextName: string) => void;
  onRemoveSubShift: (rowId: string, subShiftId: string) => void;
  onUpdateSubShiftStartTime: (
    rowId: string,
    subShiftId: string,
    nextStartTime: string,
  ) => void;
  onUpdateSubShiftEndTime: (
    rowId: string,
    subShiftId: string,
    nextEndTime: string,
  ) => void;
  onUpdateSubShiftEndDayOffset: (
    rowId: string,
    subShiftId: string,
    nextOffset: number,
  ) => void;
  onRenamePool: (rowId: string, nextName: string) => void;
  onAddLocation: (name: string) => void;
  onRenameLocation: (locationId: string, nextName: string) => void;
  onRemoveLocation: (locationId: string) => void;
  onToggleLocationsEnabled: () => void;
  onAddClinician: (name: string, workingHoursPerWeek?: number) => void;
  onEditClinician: (clinicianId: string) => void;
  onRemoveClinician: (clinicianId: string) => void;
  onChangeHolidayCountry: (countryCode: string) => void;
  onChangeHolidayYear: (year: number) => void;
  onFetchHolidays: (countryCode: string, year: number) => Promise<void>;
  onAddHoliday: (holiday: Holiday) => void;
  onRemoveHoliday: (holiday: Holiday) => void;
};

export default function SettingsView({
  classRows,
  poolRows,
  locations,
  locationsEnabled,
  minSlotsByRowId,
  clinicians,
  holidays,
  holidayCountry,
  holidayYear,
  onChangeMinSlots,
  onRenameClass,
  onRemoveClass,
  onAddClass,
  onReorderClass,
  onChangeClassLocation,
  onSetSubShiftCount,
  onRenameSubShift,
  onRemoveSubShift,
  onUpdateSubShiftStartTime,
  onUpdateSubShiftEndTime,
  onUpdateSubShiftEndDayOffset,
  onRenamePool,
  onAddLocation,
  onRenameLocation,
  onRemoveLocation,
  onToggleLocationsEnabled,
  onAddClinician,
  onEditClinician,
  onRemoveClinician,
  onChangeHolidayCountry,
  onChangeHolidayYear,
  onFetchHolidays,
  onAddHoliday,
  onRemoveHoliday,
}: SettingsViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [newLocationName, setNewLocationName] = useState("");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [newClinicianName, setNewClinicianName] = useState("");
  const [newClinicianHours, setNewClinicianHours] = useState("");
  const [showNewClinician, setShowNewClinician] = useState(false);
  const [shiftTimeDrafts, setShiftTimeDrafts] = useState<Record<string, string>>({});
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [showNewHoliday, setShowNewHoliday] = useState(false);
  const [isFetchingHolidays, setIsFetchingHolidays] = useState(false);
  const [holidayError, setHolidayError] = useState<string | null>(null);
  const [holidayInputError, setHolidayInputError] = useState<string | null>(null);
  const locationPanelDisabled = !locationsEnabled;
  const countryOptions = [
    { code: "FR", label: "France 🇫🇷" },
    { code: "DE", label: "Germany 🇩🇪" },
    { code: "IT", label: "Italy 🇮🇹" },
    { code: "LU", label: "Luxembourg 🇱🇺" },
    { code: "NL", label: "Netherlands 🇳🇱" },
    { code: "PL", label: "Poland 🇵🇱" },
    { code: "RO", label: "Romania 🇷🇴" },
    { code: "RU", label: "Russia 🇷🇺" },
    { code: "ES", label: "Spain 🇪🇸" },
    { code: "CH", label: "Switzerland 🇨🇭" },
    { code: "UA", label: "Ukraine 🇺🇦" },
    { code: "GB", label: "United Kingdom 🇬🇧" },
  ];
  const normalizedCountry = holidayCountry.toUpperCase();
  const hasCountryOption = countryOptions.some(
    (option) => option.code === normalizedCountry,
  );
  const holidayYearPrefix = `${holidayYear}-`;
  const holidaysForYear = holidays
    .filter((holiday) => holiday.dateISO.startsWith(holidayYearPrefix))
    .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  const makeShiftKey = (rowId: string, shiftId: string, field: "start" | "end") =>
    `${rowId}__${shiftId}__${field}`;
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
  const isInvalidTimeDraft = (rowId: string, shiftId: string, field: "start" | "end") => {
    const key = makeShiftKey(rowId, shiftId, field);
    const draft = shiftTimeDrafts[key];
    if (draft === undefined) return false;
    return !normalizeTimeInput(draft);
  };
  const parseHolidayDate = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const dotMatch = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (dotMatch) {
      const [, dayRaw, monthRaw, yearRaw] = dotMatch;
      const day = Number(dayRaw);
      const month = Number(monthRaw);
      const year = Number(yearRaw);
      if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) {
        return null;
      }
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month) {
        return null;
      }
      return `${yearRaw.padStart(4, "0")}-${monthRaw.padStart(2, "0")}-${dayRaw.padStart(
        2,
        "0",
      )}`;
    }
    const textMatch = trimmed.match(
      /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\s*,?\s+(\d{4})$/,
    );
    if (textMatch) {
      const [, dayRaw, monthRaw, yearRaw] = textMatch;
      const monthKey = monthRaw.toLowerCase();
      const monthMap: Record<string, number> = {
        jan: 1,
        january: 1,
        feb: 2,
        february: 2,
        mar: 3,
        march: 3,
        apr: 4,
        april: 4,
        may: 5,
        jun: 6,
        june: 6,
        jul: 7,
        july: 7,
        aug: 8,
        august: 8,
        sep: 9,
        sept: 9,
        september: 9,
        oct: 10,
        october: 10,
        nov: 11,
        november: 11,
        dec: 12,
        december: 12,
      };
      const month = monthMap[monthKey];
      const day = Number(dayRaw);
      const year = Number(yearRaw);
      if (!month || !Number.isFinite(day) || !Number.isFinite(year)) return null;
      const date = new Date(Date.UTC(year, month - 1, day));
      if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month) {
        return null;
      }
      return `${yearRaw}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    return null;
  };
  const formatHolidayDate = (dateISO: string) => {
    const [year, month, day] = dateISO.split("-");
    if (!year || !month || !day) return dateISO;
    return `${day}.${month}.${year}`;
  };
  const poolNoteById: Record<string, string> = {
    "pool-not-allocated": "Pool from which people are distributed to workplaces.",
    "pool-manual": "Reserve pool of people that will not be automatically distributed.",
    "pool-vacation":
      "People on vacation. Drag in or out of this row to update vacations.",
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="flex items-start justify-between gap-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
            Settings
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Configure sites, shifts, pools, people, and holidays for your schedule.
          </p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Locations
            </div>
            <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Manage locations used by each section.
            </div>
            {locationPanelDisabled ? (
              <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Locations are disabled. All sections use the default location.
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Enabled
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={locationsEnabled}
              onClick={() => {
                if (locationsEnabled) {
                  const ok = window.confirm(
                    "Disable locations? All sections will reset to the default location and must be re-selected when re-enabled.",
                  );
                  if (!ok) return;
                }
                onToggleLocationsEnabled();
              }}
              className={cx(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                locationsEnabled
                  ? "bg-emerald-500"
                  : "bg-slate-300 dark:bg-slate-700",
              )}
            >
              <span
                className={cx(
                  "inline-block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform",
                  locationsEnabled && "translate-x-[22px]",
                )}
              />
            </button>
          </div>
        </div>
        <div
          className={cx(
            "mt-4 flex flex-wrap gap-3",
            locationPanelDisabled && "opacity-60",
          )}
        >
          <input
            type="text"
            value={newLocationName}
            onChange={(e) => setNewLocationName(e.target.value)}
            placeholder="New location name"
            disabled={locationPanelDisabled}
            className={cx(
              "w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
              "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
              "disabled:cursor-not-allowed disabled:opacity-70",
            )}
          />
          <button
            type="button"
            onClick={() => {
              if (locationPanelDisabled) return;
              const trimmed = newLocationName.trim();
              if (!trimmed) return;
              onAddLocation(trimmed);
              setNewLocationName("");
              setLocationError(null);
            }}
            disabled={locationPanelDisabled}
            className={cx(
              "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm",
              "hover:bg-slate-50 active:bg-slate-100",
              "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
              "disabled:cursor-not-allowed disabled:opacity-70",
            )}
          >
            Add Location
          </button>
        </div>
        {locationError ? (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-900/30 dark:text-rose-200">
            {locationError}
          </div>
        ) : null}
        <div className={cx("mt-4 space-y-3", locationPanelDisabled && "opacity-60")}>
          {locations.map((location) => (
            <div key={location.id} className="flex items-center gap-4">
              <input
                type="text"
                value={location.name}
                onChange={(event) => {
                  onRenameLocation(location.id, event.target.value);
                  setLocationError(null);
                }}
                disabled={locationPanelDisabled}
                className={cx(
                  "w-full max-w-sm rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                  "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                  "disabled:cursor-not-allowed disabled:opacity-70",
                )}
              />
              <button
                type="button"
                onClick={() => {
                  if (locationPanelDisabled) return;
                  if (location.id === DEFAULT_LOCATION_ID) {
                    setLocationError("Default location cannot be deleted.");
                    return;
                  }
                  const usedBy = classRows
                    .filter((row) => row.locationId === location.id)
                    .map((row) => row.name);
                  if (usedBy.length > 0) {
                    setLocationError(
                      `Location is still used by: ${usedBy.join(", ")}.`,
                    );
                    return;
                  }
                  onRemoveLocation(location.id);
                  setLocationError(null);
                }}
                disabled={locationPanelDisabled}
                className={cx(
                  "rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600",
                  "hover:bg-rose-50 hover:text-rose-700",
                  "dark:border-rose-500/40 dark:text-rose-200 dark:hover:bg-rose-900/30",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Sections and Shifts
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Set section order, shift details, and required staffing.
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-4">
            {classRows.map((row, index) => {
              const subShifts = normalizeSubShifts(row.subShifts);
              const subShiftCount = subShifts.length;
              return (
                <div
                  key={row.id}
                  className={cx(
                    "rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60",
                    dragOverId === row.id && "border-sky-200 bg-sky-50 dark:bg-sky-950/40",
                  )}
                  onDragOver={(event) => {
                    if (!draggingId) return;
                    if (draggingId === row.id) return;
                    event.preventDefault();
                    setDragOverId(row.id);
                  }}
                  onDragLeave={() => {
                    setDragOverId((prev) => (prev === row.id ? null : prev));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const fromId = draggingId || event.dataTransfer.getData("text/plain");
                    if (!fromId || fromId === row.id) {
                      setDragOverId(null);
                      return;
                    }
                    onReorderClass(fromId, row.id);
                    setDraggingId(null);
                    setDragOverId(null);
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">
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
                        className="cursor-grab rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        aria-label={`Reorder ${row.name}`}
                      >
                        ≡
                      </button>
                      <input
                        type="text"
                        value={row.name}
                        onChange={(e) => onRenameClass(row.id, e.target.value)}
                        className={cx(
                          "min-w-[180px] rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                          "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                        )}
                      />
                      {locationsEnabled ? (
                        <select
                          value={row.locationId ?? DEFAULT_LOCATION_ID}
                          onChange={(event) => onChangeClassLocation(row.id, event.target.value)}
                          className={cx(
                            "h-9 rounded-xl border border-slate-200 px-3 text-sm font-normal text-slate-700",
                            "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                          )}
                        >
                          {locations.map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => onRemoveClass(row.id)}
                        className={cx(
                          "grid h-7 w-7 place-items-center rounded-full border border-rose-200 text-sm font-semibold text-rose-600",
                          "hover:bg-rose-50 hover:text-rose-700",
                          "dark:border-rose-500/40 dark:text-rose-200 dark:hover:bg-rose-900/30",
                        )}
                        aria-label={`Remove ${row.name}`}
                      >
                        −
                      </button>
                    </div>
                  </div>

                  <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="grid grid-cols-[auto_2fr_1fr_1fr_1fr_1fr_auto] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    <div>Shift</div>
                    <div>Name</div>
                    <div>Start</div>
                    <div>End</div>
                    <div>Min Slots (Weekday)</div>
                    <div>Min Slots (Weekend)</div>
                    <div />
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {subShifts.map((shift) => {
                      const shiftRowId = buildShiftRowId(row.id, shift.id);
                      return (
                        <div
                          key={shift.id}
                          className="grid grid-cols-[auto_2fr_1fr_1fr_1fr_1fr_auto] items-center gap-3 px-4 py-3 text-sm dark:bg-slate-900/70"
                        >
                          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                            {shift.order}
                          </div>
                          <input
                              type="text"
                              value={shift.name}
                              onChange={(event) =>
                                onRenameSubShift(row.id, shift.id, event.target.value)
                              }
                              className={cx(
                                "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                                "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                            )}
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="HH:MM"
                            value={
                              shiftTimeDrafts[makeShiftKey(row.id, shift.id, "start")] ??
                              shift.startTime
                            }
                            onChange={(event) => {
                              const key = makeShiftKey(row.id, shift.id, "start");
                              setShiftTimeDrafts((prev) => ({
                                ...prev,
                                [key]: event.target.value,
                              }));
                            }}
                            onBlur={() => {
                              const key = makeShiftKey(row.id, shift.id, "start");
                              const next = shiftTimeDrafts[key];
                              if (next === undefined) return;
                              const normalized = normalizeTimeInput(next);
                              if (normalized) {
                                onUpdateSubShiftStartTime(row.id, shift.id, normalized);
                              }
                              setShiftTimeDrafts((prev) => {
                                const { [key]: _unused, ...rest } = prev;
                                return rest;
                              });
                            }}
                            className={cx(
                              "w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                              "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]",
                              isInvalidTimeDraft(row.id, shift.id, "start") &&
                                "border-rose-300 text-rose-700 focus:border-rose-400 dark:border-rose-500/60 dark:text-rose-200",
                            )}
                          />
                          <div className="relative w-24">
                            <input
                              type="text"
                              inputMode="numeric"
                              placeholder="HH:MM"
                              value={
                                shiftTimeDrafts[makeShiftKey(row.id, shift.id, "end")] ??
                                shift.endTime
                              }
                              onChange={(event) => {
                                const key = makeShiftKey(row.id, shift.id, "end");
                                setShiftTimeDrafts((prev) => ({
                                  ...prev,
                                  [key]: event.target.value,
                                }));
                              }}
                              onBlur={() => {
                                const key = makeShiftKey(row.id, shift.id, "end");
                                const next = shiftTimeDrafts[key];
                                if (next === undefined) return;
                                const normalized = normalizeTimeInput(next);
                                if (normalized) {
                                  onUpdateSubShiftEndTime(row.id, shift.id, normalized);
                                }
                                setShiftTimeDrafts((prev) => {
                                  const { [key]: _unused, ...rest } = prev;
                                  return rest;
                                });
                              }}
                              className={cx(
                                "w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                                "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]",
                                isInvalidTimeDraft(row.id, shift.id, "end") &&
                                  "border-rose-300 text-rose-700 focus:border-rose-400 dark:border-rose-500/60 dark:text-rose-200",
                              )}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const current = shift.endDayOffset ?? 0;
                                const next = (current + 1) % 4;
                                onUpdateSubShiftEndDayOffset(row.id, shift.id, next);
                              }}
                              className={cx(
                                "absolute left-2 top-full -mt-1 text-[9px] font-semibold uppercase tracking-wide text-slate-400",
                                "hover:text-slate-600",
                                "dark:text-slate-500 dark:hover:text-slate-300",
                              )}
                            >
                              +{shift.endDayOffset ?? 0}{" "}
                              {(shift.endDayOffset ?? 0) <= 1 ? "day" : "days"}
                            </button>
                          </div>
                            <input
                              type="number"
                              min={0}
                              value={minSlotsByRowId[shiftRowId]?.weekday ?? 0}
                              onChange={(event) => {
                                const raw = Number(event.target.value);
                                onChangeMinSlots(
                                  shiftRowId,
                                  "weekday",
                                  Number.isFinite(raw) ? raw : 0,
                                );
                              }}
                              className={cx(
                                "w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                                "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]",
                              )}
                            />
                            <input
                              type="number"
                              min={0}
                              value={minSlotsByRowId[shiftRowId]?.weekend ?? 0}
                              onChange={(event) => {
                                const raw = Number(event.target.value);
                                onChangeMinSlots(
                                  shiftRowId,
                                  "weekend",
                                  Number.isFinite(raw) ? raw : 0,
                                );
                              }}
                              className={cx(
                                "w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                                "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]",
                              )}
                            />
                            <button
                              type="button"
                              onClick={() => onRemoveSubShift(row.id, shift.id)}
                              disabled={subShiftCount <= 1}
                              className={cx(
                                "grid h-7 w-7 place-items-center rounded-full border border-rose-200 text-sm font-semibold text-rose-600",
                                "hover:bg-rose-50 hover:text-rose-700",
                                "disabled:cursor-not-allowed disabled:opacity-40",
                                "dark:border-rose-500/40 dark:text-rose-200 dark:hover:bg-rose-900/30",
                              )}
                              aria-label={`Remove ${row.name} shift ${shift.order}`}
                            >
                              −
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => onSetSubShiftCount(row.id, subShiftCount + 1)}
                      disabled={subShiftCount >= 3}
                      className={cx(
                        "w-full rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-3 py-2 text-xs font-semibold text-slate-700",
                        "hover:bg-slate-100 active:bg-slate-200/60",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        "dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800",
                      )}
                    >
                      Add Shift
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={onAddClass}
              className={cx(
                "w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-3 text-sm font-semibold text-slate-700",
                "hover:bg-slate-100 active:bg-slate-200/60",
                "dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800",
              )}
            >
              Add Section
            </button>
          </div>
        </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="text-base font-semibold text-slate-900 dark:text-slate-100">Pools</div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Label the system pools used for distribution and vacation.
          </div>
          <div className="mt-4 space-y-3">
            {poolRows.map((row) => (
              <div key={row.id} className="flex items-center gap-4">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => onRenamePool(row.id, e.target.value)}
                  className={cx(
                    "w-full max-w-sm rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                    "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                  )}
                />
                <span className="text-xs font-semibold text-slate-400 dark:text-slate-500">
                  {poolNoteById[row.id] ?? "Pool"}
                </span>
              </div>
            ))}
          </div>
        </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                People
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Add clinicians and open their details for editing.
              </div>
            </div>
          </div>
          <div className="mt-5 divide-y divide-slate-200 rounded-xl border border-slate-200 dark:border-slate-800 dark:divide-slate-800">
            {clinicians.map((clinician) => (
              <div
                key={clinician.id}
                className="flex items-center justify-between gap-4 px-4 py-3 dark:bg-slate-900/70"
              >
                <div className="text-sm font-normal text-slate-900 dark:text-slate-100">
                  {clinician.name}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onEditClinician(clinician.id)}
                    className={cx(
                      "rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600",
                      "hover:bg-slate-50 hover:text-slate-900",
                      "dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                    )}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveClinician(clinician.id)}
                    className={cx(
                      "rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600",
                      "hover:bg-rose-50 hover:text-rose-700",
                      "dark:border-rose-500/40 dark:text-rose-200 dark:hover:bg-rose-900/30",
                    )}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowNewClinician(true)}
              className={cx(
                "w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700",
                "hover:bg-slate-50 active:bg-slate-100",
                "dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800",
              )}
            >
              Add Person
            </button>
          </div>
          {showNewClinician ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                New person
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  value={newClinicianName}
                  onChange={(e) => setNewClinicianName(e.target.value)}
                  placeholder="Person name"
                  className={cx(
                    "w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                    "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                  )}
                />
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={newClinicianHours}
                  onChange={(event) => setNewClinicianHours(event.target.value)}
                  placeholder="Hours/week"
                  className={cx(
                    "w-32 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                    "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]",
                  )}
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmed = newClinicianName.trim();
                    if (!trimmed) return;
                    const hoursValue = newClinicianHours.trim();
                    const parsed = hoursValue ? Number(hoursValue) : null;
                    if (hoursValue && !Number.isFinite(parsed)) return;
                    const workingHours =
                      parsed !== null ? Math.max(0, parsed) : undefined;
                    onAddClinician(trimmed, workingHours);
                    setNewClinicianName("");
                    setNewClinicianHours("");
                    setShowNewClinician(false);
                  }}
                  className={cx(
                    "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm",
                    "hover:bg-slate-50 active:bg-slate-100",
                    "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
                  )}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewClinician(false);
                    setNewClinicianName("");
                    setNewClinicianHours("");
                  }}
                  className={cx(
                    "rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600",
                    "hover:bg-slate-50 hover:text-slate-900",
                    "dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                  )}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Holidays
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Load public holidays and maintain the calendar list.
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Year
              </span>
              <div
                className={cx(
                  "inline-flex h-10 items-center rounded-full border border-slate-200 bg-white px-1 shadow-sm",
                  "dark:border-slate-700 dark:bg-slate-900/60",
                )}
              >
                <button
                  type="button"
                  onClick={() => onChangeHolidayYear(Math.max(1970, holidayYear - 1))}
                  className={cx(
                    "grid h-8 w-8 place-items-center rounded-full text-sm font-semibold text-slate-600",
                    "hover:bg-slate-100 active:bg-slate-200/80",
                    "dark:text-slate-300 dark:hover:bg-slate-800/70",
                  )}
                  aria-label="Previous year"
                >
                  {"<"}
                </button>
                <div className="min-w-[72px] text-center text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {holidayYear}
                </div>
                <button
                  type="button"
                  onClick={() => onChangeHolidayYear(holidayYear + 1)}
                  className={cx(
                    "grid h-8 w-8 place-items-center rounded-full text-sm font-semibold text-slate-600",
                    "hover:bg-slate-100 active:bg-slate-200/80",
                    "dark:text-slate-300 dark:hover:bg-slate-800/70",
                  )}
                  aria-label="Next year"
                >
                  {">"}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Preload holidays
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={normalizedCountry}
                onChange={(event) =>
                  onChangeHolidayCountry(event.target.value.toUpperCase())
                }
                className={cx(
                  "h-10 w-56 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                  "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                )}
              >
                {!hasCountryOption ? (
                  <option value={normalizedCountry}>{normalizedCountry}</option>
                ) : null}
                {countryOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={async () => {
                  setHolidayError(null);
                  setIsFetchingHolidays(true);
                  try {
                    await onFetchHolidays(normalizedCountry, holidayYear);
                  } catch (error) {
                    setHolidayError(
                      error instanceof Error
                        ? error.message
                        : "Failed to fetch holidays.",
                    );
                  } finally {
                    setIsFetchingHolidays(false);
                  }
                }}
                className={cx(
                  "h-10 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm",
                  "hover:bg-slate-50 active:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70",
                  "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
                )}
                disabled={!normalizedCountry || isFetchingHolidays}
              >
                {isFetchingHolidays ? "Loading..." : "Load Holidays"}
              </button>
            </div>
            {holidayError ? (
              <div className="text-xs font-semibold text-rose-600 dark:text-rose-200">
                {holidayError}
              </div>
            ) : null}
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              List of holidays that will be added to the calendar
            </div>
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:border-slate-800 dark:divide-slate-800">
            {holidaysForYear.length === 0 ? (
              <div className="px-4 py-4 text-sm text-slate-500 dark:text-slate-300">
                No holidays added for this year yet.
              </div>
            ) : (
              holidaysForYear.map((holiday) => (
                <div
                  key={`${holiday.dateISO}-${holiday.name}`}
                  className="grid grid-cols-[120px_1fr_auto] items-center gap-4 px-4 py-3 dark:bg-slate-900/70"
                >
                  <div className="text-sm font-normal text-slate-900 dark:text-slate-100">
                    {formatHolidayDate(holiday.dateISO)}
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">
                    {holiday.name}
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveHoliday(holiday)}
                    className={cx(
                      "rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600",
                      "hover:bg-slate-50 hover:text-slate-900",
                      "dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                    )}
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
            </div>
          </div>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowNewHoliday(true)}
              className={cx(
                "w-full rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700",
                "hover:bg-slate-50 active:bg-slate-100",
                "dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100 dark:hover:bg-slate-800",
              )}
            >
              Add Holiday
            </button>
          </div>
          {showNewHoliday ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                New holiday
              </div>
              <div className="mt-3 flex flex-wrap gap-3">
                <input
                  type="text"
                  value={newHolidayDate}
                  onChange={(event) => {
                    setNewHolidayDate(event.target.value);
                    setHolidayInputError(null);
                  }}
                  placeholder="DD.MM.YYYY"
                  className={cx(
                    "w-40 rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                    "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]",
                    holidayInputError &&
                      "border-rose-300 text-rose-700 focus:border-rose-400 dark:border-rose-500/60 dark:text-rose-200",
                  )}
                />
                <input
                  type="text"
                  value={newHolidayName}
                  onChange={(event) => setNewHolidayName(event.target.value)}
                  placeholder="Holiday name"
                  className={cx(
                    "w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-900",
                    "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                    holidayInputError &&
                      "border-rose-300 text-rose-700 focus:border-rose-400 dark:border-rose-500/60 dark:text-rose-200",
                  )}
                />
                <button
                  type="button"
                  onClick={() => {
                    const trimmedName = newHolidayName.trim();
                    const parsedDate = parseHolidayDate(newHolidayDate);
                    if (!parsedDate || !trimmedName) {
                      setHolidayInputError(
                        "Use DD.MM.YYYY or 27th Dec 2025 for the date.",
                      );
                      return;
                    }
                    onAddHoliday({ dateISO: parsedDate, name: trimmedName });
                    setNewHolidayDate("");
                    setNewHolidayName("");
                    setHolidayInputError(null);
                    setShowNewHoliday(false);
                  }}
                  className={cx(
                    "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm",
                    "hover:bg-slate-50 active:bg-slate-100",
                    "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
                  )}
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewHoliday(false);
                    setNewHolidayDate("");
                    setNewHolidayName("");
                    setHolidayInputError(null);
                  }}
                  className={cx(
                    "rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600",
                    "hover:bg-slate-50 hover:text-slate-900",
                    "dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                  )}
                >
                  Cancel
                </button>
              </div>
              {holidayInputError ? (
                <div className="mt-2 text-xs font-semibold text-rose-600 dark:text-rose-200">
                  {holidayInputError}
                </div>
              ) : null}
            </div>
          ) : null}
      </div>
    </div>
  );
}
