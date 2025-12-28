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
  onUpdateSubShiftHours: (
    rowId: string,
    subShiftId: string,
    nextHours: number,
  ) => void;
  onRenamePool: (rowId: string, nextName: string) => void;
  onAddLocation: (name: string) => void;
  onRenameLocation: (locationId: string, nextName: string) => void;
  onRemoveLocation: (locationId: string) => void;
  onAddClinician: (name: string) => void;
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
  onUpdateSubShiftHours,
  onRenamePool,
  onAddLocation,
  onRenameLocation,
  onRemoveLocation,
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
  const [newHolidayDate, setNewHolidayDate] = useState("");
  const [newHolidayName, setNewHolidayName] = useState("");
  const [isFetchingHolidays, setIsFetchingHolidays] = useState(false);
  const [holidayError, setHolidayError] = useState<string | null>(null);
  const [holidayInputError, setHolidayInputError] = useState<string | null>(null);
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
      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
              Settings
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Define sub-shifts, locations, and minimum required slots per shift.
            </p>
          </div>
          <button
            type="button"
            onClick={onAddClass}
            className={cx(
              "inline-flex items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm",
              "hover:bg-slate-50 active:bg-slate-100",
              "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
            )}
          >
            Add Class
          </button>
        </div>

        <div className="mt-6 space-y-4">
          {classRows.map((row, index) => {
            const subShifts = normalizeSubShifts(row.subShifts);
            const subShiftCount = subShifts.length;
            return (
              <div
                key={row.id}
                className={cx(
                  "rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/60",
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
                        "min-w-[180px] rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
                        "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                      )}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        Location
                      </span>
                      <select
                        value={row.locationId ?? DEFAULT_LOCATION_ID}
                        onChange={(event) =>
                          onChangeClassLocation(row.id, event.target.value)
                        }
                        className={cx(
                          "h-9 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-900",
                          "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                        )}
                      >
                        {locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                        Sub-shifts
                      </span>
                      <select
                        value={subShiftCount}
                        onChange={(event) =>
                          onSetSubShiftCount(row.id, Number(event.target.value))
                        }
                        className={cx(
                          "h-9 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-900",
                          "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                        )}
                      >
                        {[1, 2, 3].map((count) => (
                          <option key={count} value={count}>
                            {count}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveClass(row.id)}
                      className={cx(
                        "rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600",
                        "hover:bg-slate-50 hover:text-slate-900",
                        "dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-slate-100",
                      )}
                    >
                      Remove
                    </button>
                  </div>
                </div>

                <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="grid grid-cols-[auto_2fr_1fr_1fr_1fr] gap-3 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                    <div>Shift</div>
                    <div>Name</div>
                    <div>Hours</div>
                    <div>Min Slots (Weekday)</div>
                    <div>Min Slots (Weekend)</div>
                  </div>
                  <div className="divide-y divide-slate-200 dark:divide-slate-800">
                    {subShifts.map((shift) => {
                      const shiftRowId = buildShiftRowId(row.id, shift.id);
                      return (
                        <div
                          key={shift.id}
                          className="grid grid-cols-[auto_2fr_1fr_1fr_1fr] items-center gap-3 px-4 py-3 text-sm dark:bg-slate-900/70"
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
                              "w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
                              "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                            )}
                          />
                          <input
                            type="number"
                            min={0}
                            value={shift.hours}
                            onChange={(event) => {
                              const raw = Number(event.target.value);
                              onUpdateSubShiftHours(
                                row.id,
                                shift.id,
                                Number.isFinite(raw) ? raw : 0,
                              );
                            }}
                            className={cx(
                              "w-20 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
                              "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]",
                            )}
                          />
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
                              "w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
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
                              "w-24 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
                              "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]",
                            )}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="text-base font-semibold text-slate-900 dark:text-slate-100">Pools</div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Rename pool rows (cannot be deleted).
          </div>
          <div className="mt-4 space-y-3">
            {poolRows.map((row) => (
              <div key={row.id} className="flex items-center gap-4">
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => onRenamePool(row.id, e.target.value)}
                  className={cx(
                    "w-full max-w-sm rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
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

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Locations
          </div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Create locations and assign classes to a single site.
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <input
              type="text"
              value={newLocationName}
              onChange={(e) => setNewLocationName(e.target.value)}
              placeholder="New location name"
              className={cx(
                "w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
                "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
              )}
            />
            <button
              type="button"
              onClick={() => {
                const trimmed = newLocationName.trim();
                if (!trimmed) return;
                onAddLocation(trimmed);
                setNewLocationName("");
                setLocationError(null);
              }}
              className={cx(
                "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm",
                "hover:bg-slate-50 active:bg-slate-100",
                "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
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
          <div className="mt-4 space-y-3">
            {locations.map((location) => (
              <div key={location.id} className="flex items-center gap-4">
                <input
                  type="text"
                  value={location.name}
                  onChange={(event) => {
                    onRenameLocation(location.id, event.target.value);
                    setLocationError(null);
                  }}
                  className={cx(
                    "w-full max-w-sm rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
                    "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
                  )}
                />
                <button
                  type="button"
                  onClick={() => {
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
                  className={cx(
                    "rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-600",
                    "hover:bg-rose-50 hover:text-rose-700",
                    "dark:border-rose-500/40 dark:text-rose-200 dark:hover:bg-rose-900/30",
                  )}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                People
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Manage people and open the same editor as in the calendar.
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <input
              type="text"
              value={newClinicianName}
              onChange={(e) => setNewClinicianName(e.target.value)}
              placeholder="New person name"
              className={cx(
                "w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
                "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
              )}
            />
            <button
              type="button"
              onClick={() => {
                const trimmed = newClinicianName.trim();
                if (!trimmed) return;
                onAddClinician(trimmed);
                setNewClinicianName("");
              }}
              className={cx(
                "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm",
                "hover:bg-slate-50 active:bg-slate-100",
                "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
              )}
            >
              Add Person
            </button>
          </div>
          <div className="mt-5 divide-y divide-slate-200 rounded-xl border border-slate-200 dark:border-slate-800 dark:divide-slate-800">
            {clinicians.map((clinician) => (
              <div
                key={clinician.id}
                className="flex items-center justify-between gap-4 px-4 py-3 dark:bg-slate-900/70"
              >
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
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
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Holidays
              </div>
              <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Choose a country and year, fetch public holidays, and adjust the list.
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
                  "h-10 w-56 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
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
              Add holiday
            </div>
            <div className="flex flex-wrap gap-3">
            <input
              type="text"
              value={newHolidayDate}
              onChange={(event) => {
                setNewHolidayDate(event.target.value);
                setHolidayInputError(null);
              }}
              placeholder="DD.MM.YYYY"
              className={cx(
                "w-40 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
                "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:[color-scheme:dark]",
              )}
            />
            <input
              type="text"
              value={newHolidayName}
              onChange={(event) => setNewHolidayName(event.target.value)}
              placeholder="Holiday name"
              className={cx(
                "w-full max-w-xs rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900",
                "focus:border-sky-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
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
              }}
              className={cx(
                "rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 shadow-sm",
                "hover:bg-slate-50 active:bg-slate-100",
                "dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
              )}
            >
              Add Holiday
            </button>
            {holidayInputError ? (
              <div className="text-xs font-semibold text-rose-600 dark:text-rose-200">
                {holidayInputError}
              </div>
            ) : null}
            </div>
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
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
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
        </div>
      </div>
    </div>
  );
}
