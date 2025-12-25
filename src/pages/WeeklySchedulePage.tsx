import { useEffect, useMemo, useState } from "react";
import ClinicianEditModal from "../components/schedule/ClinicianEditModal";
import ScheduleGrid from "../components/schedule/ScheduleGrid";
import SettingsView from "../components/schedule/SettingsView";
import TopBar from "../components/schedule/TopBar";
import WeekNavigator from "../components/schedule/WeekNavigator";
import { getState, saveState, solveDay } from "../api/client";
import {
  Assignment,
  assignments,
  buildAssignmentMap,
  Clinician,
  clinicians as defaultClinicians,
  defaultMinSlotsByRowId,
  WorkplaceRow,
  workplaceRows,
} from "../data/mockData";
import { addDays, addWeeks, startOfWeek, toISODate } from "../lib/date";

const CLASS_COLORS = [
  "bg-violet-500",
  "bg-cyan-500",
  "bg-fuchsia-500",
  "bg-amber-400",
  "bg-blue-600",
  "bg-rose-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-lime-500",
];
const MANUAL_POOL_ID = "pool-manual";
const USERS = [
  { id: "jk", label: "JK" },
  { id: "ml", label: "ML" },
];

export default function WeeklySchedulePage() {
  const [viewMode, setViewMode] = useState<"calendar" | "settings">("calendar");
  const [activeUserId, setActiveUserId] = useState(() => {
    if (typeof window === "undefined") return "jk";
    return window.localStorage.getItem("activeUserId") ?? "jk";
  });
  const [anchorDate, setAnchorDate] = useState<Date>(new Date());
  const [assignmentMap, setAssignmentMap] = useState<Map<string, Assignment[]>>(() =>
    buildAssignmentMap(assignments),
  );
  const [minSlotsByRowId, setMinSlotsByRowId] = useState<
    Record<string, { weekday: number; weekend: number }>
  >(defaultMinSlotsByRowId);
  const [slotOverridesByKey, setSlotOverridesByKey] = useState<
    Record<string, number>
  >({});
  const [clinicians, setClinicians] = useState<Clinician[]>(() =>
    defaultClinicians.map((clinician) => ({
      ...clinician,
      preferredClassIds: [...clinician.qualifiedClassIds],
    })),
  );
  const [editingClinicianId, setEditingClinicianId] = useState<string>("");
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadedUserId, setLoadedUserId] = useState<string>("");
  const [solverNotice, setSolverNotice] = useState<string | null>(null);

  const weekStart = useMemo(() => startOfWeek(anchorDate, 1), [anchorDate]);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekEndInclusive = useMemo(() => addDays(weekStart, 6), [weekStart]);

  const [rows, setRows] = useState<WorkplaceRow[]>(workplaceRows);
  const classRows = useMemo(() => rows.filter((r) => r.kind === "class"), [rows]);
  const poolRows = useMemo(() => rows.filter((r) => r.kind === "pool"), [rows]);
  const allRows = useMemo(() => [...classRows, ...poolRows], [classRows, poolRows]);
  const classRowIds = useMemo(() => classRows.map((r) => r.id), [classRows]);
  const poolsSeparatorId = poolRows[0]?.id ?? "";
  const clinicianNameById = useMemo(
    () => new Map(clinicians.map((clinician) => [clinician.id, clinician.name])),
    [clinicians],
  );
  const rowById = useMemo(
    () => new Map(allRows.map((row) => [row.id, row])),
    [allRows],
  );

  const renderAssignmentMap = useMemo(() => {
    const freePoolId = "pool-not-allocated";
    const vacationPoolId = "pool-vacation";
    const vacationByDate = new Map<string, Set<string>>();
    for (const clinician of clinicians) {
      for (const vacation of clinician.vacations) {
        let cursor = new Date(`${vacation.startISO}T00:00:00`);
        const end = new Date(`${vacation.endISO}T00:00:00`);
        while (cursor <= end) {
          const dateISO = toISODate(cursor);
          let set = vacationByDate.get(dateISO);
          if (!set) {
            set = new Set();
            vacationByDate.set(dateISO, set);
          }
          set.add(clinician.id);
          cursor = addDays(cursor, 1);
        }
      }
    }

    const next = new Map<string, Assignment[]>();
    const assignedByDate = new Map<string, Set<string>>();

    for (const [key, list] of assignmentMap.entries()) {
      const [rowId, dateISO] = key.split("__");
      if (!dateISO) {
        continue;
      }
      if (rowId === freePoolId || rowId === vacationPoolId) {
        continue;
      }

      const vacationSet = vacationByDate.get(dateISO);
      const filtered = list.filter(
        (item) => !vacationSet || !vacationSet.has(item.clinicianId),
      );
      if (filtered.length === 0) continue;
      next.set(key, [...filtered]);

      let set = assignedByDate.get(dateISO);
      if (!set) {
        set = new Set();
        assignedByDate.set(dateISO, set);
      }
      for (const item of filtered) set.add(item.clinicianId);
    }

    for (const date of weekDays) {
      const dateISO = toISODate(date);
      const assigned = assignedByDate.get(dateISO) ?? new Set<string>();
      const vacationSet = vacationByDate.get(dateISO) ?? new Set<string>();
      for (const clinician of clinicians) {
        if (assigned.has(clinician.id)) continue;
        const inVacation = vacationSet.has(clinician.id);
        const poolRowId = inVacation ? vacationPoolId : freePoolId;
        const key = `${poolRowId}__${dateISO}`;
        const item: Assignment = {
          id: `pool-${poolRowId}-${clinician.id}-${dateISO}`,
          rowId: poolRowId,
          dateISO,
          clinicianId: clinician.id,
        };
        const existing = next.get(key);
        if (existing) existing.push(item);
        else next.set(key, [item]);
      }
    }

    return next;
  }, [assignmentMap, weekDays, clinicians]);

  const isOnVacation = (clinicianId: string, dateISO: string) => {
    const clinician = clinicians.find((item) => item.id === clinicianId);
    if (!clinician) return false;
    return clinician.vacations.some(
      (vacation) => vacation.startISO <= dateISO && dateISO <= vacation.endISO,
    );
  };

  const getBaseSlotsForDate = (rowId: string, dateISO: string) => {
    const minSlots = minSlotsByRowId[rowId] ?? { weekday: 0, weekend: 0 };
    const date = new Date(`${dateISO}T00:00:00`);
    const isWeekend = date.getDay() === 0 || date.getDay() === 6;
    return isWeekend ? minSlots.weekend : minSlots.weekday;
  };

  const adjustSlotOverride = (rowId: string, dateISO: string, delta: number) => {
    const baseSlots = getBaseSlotsForDate(rowId, dateISO);
    setSlotOverridesByKey((prev) => {
      const key = `${rowId}__${dateISO}`;
      const current = prev[key] ?? 0;
      const nextValue = Math.max(-baseSlots, current + delta);
      if (nextValue === current) return prev;
      const next = { ...prev };
      if (nextValue === 0) {
        delete next[key];
      } else {
        next[key] = nextValue;
      }
      return next;
    });
  };

  const openSlotsCount = useMemo(() => {
    const dateISOs = weekDays.map(toISODate);
    let openSlots = 0;
    for (const rowId of classRowIds) {
      const minSlots = minSlotsByRowId[rowId] ?? { weekday: 0, weekend: 0 };
      for (const d of dateISOs) {
        const cell = assignmentMap.get(`${rowId}__${d}`) ?? [];
        const date = new Date(`${d}T00:00:00`);
        const isWeekend = date.getDay() === 0 || date.getDay() === 6;
        const baseRequired = isWeekend ? minSlots.weekend : minSlots.weekday;
        const override = slotOverridesByKey[`${rowId}__${d}`] ?? 0;
        const required = Math.max(0, baseRequired + override);
        if (required > cell.length) openSlots += required - cell.length;
      }
    }
    return openSlots;
  }, [weekDays, assignmentMap, classRowIds, minSlotsByRowId, slotOverridesByKey]);

  const editingClinician = useMemo(
    () => clinicians.find((clinician) => clinician.id === editingClinicianId),
    [clinicians, editingClinicianId],
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("activeUserId", activeUserId);
    }
  }, [activeUserId]);

  useEffect(() => {
    let alive = true;
    setHasLoaded(false);
    setLoadedUserId("");
    getState(activeUserId)
      .then((state) => {
        if (!alive) return;
        if (state.rows?.length) {
          const filteredRows = state.rows.filter((row) => row.id !== "pool-not-working");
          const hasManualPool = filteredRows.some((row) => row.id === MANUAL_POOL_ID);
          const nextRows = hasManualPool
            ? filteredRows
            : filteredRows.reduce<WorkplaceRow[]>((acc, row) => {
                acc.push(row);
                if (row.id === "pool-not-allocated") {
                  acc.push({
                    id: MANUAL_POOL_ID,
                    name: "Pool",
                    kind: "pool",
                    dotColorClass: "bg-slate-300",
                  });
                }
                return acc;
              }, []);
          if (!hasManualPool && nextRows.length === filteredRows.length) {
            nextRows.unshift({
              id: MANUAL_POOL_ID,
              name: "Pool",
              kind: "pool",
              dotColorClass: "bg-slate-300",
            });
          }
          setRows(nextRows);
          if (nextRows.length !== state.rows.length) {
            state.rows = nextRows;
          }
        }
        if (state.clinicians?.length) {
          setClinicians(
            state.clinicians.map((clinician) => ({
              ...clinician,
              preferredClassIds: [...clinician.qualifiedClassIds],
            })),
          );
        }
        if (state.assignments) {
          const filteredAssignments = state.assignments.filter(
            (assignment) => assignment.rowId !== "pool-not-working",
          );
          setAssignmentMap(buildAssignmentMap(filteredAssignments));
          state.assignments = filteredAssignments;
        }
        if (state.minSlotsByRowId) setMinSlotsByRowId(state.minSlotsByRowId);
        if (state.slotOverridesByKey) {
          setSlotOverridesByKey(state.slotOverridesByKey);
        }
      })
      .catch(() => {
        /* Backend optional during local-only dev */
      })
      .finally(() => {
        if (alive) {
          setLoadedUserId(activeUserId);
          setHasLoaded(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [activeUserId]);

  useEffect(() => {
    if (!hasLoaded || loadedUserId !== activeUserId) return;
    const toAssignments = () => {
      const out: Assignment[] = [];
      for (const list of assignmentMap.values()) {
        out.push(...list);
      }
      return out;
    };
    const payload = {
      rows,
      clinicians,
      assignments: toAssignments(),
      minSlotsByRowId,
      slotOverridesByKey,
    };
    const handle = window.setTimeout(() => {
      saveState(payload, activeUserId).catch(() => {
        /* Backend optional during local-only dev */
      });
    }, 500);
    return () => window.clearTimeout(handle);
  }, [
    rows,
    clinicians,
    assignmentMap,
    minSlotsByRowId,
    slotOverridesByKey,
    hasLoaded,
    activeUserId,
  ]);

  const handleToggleQualification = (clinicianId: string, classId: string) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        const hasClass = clinician.qualifiedClassIds.includes(classId);
        const nextQualified = hasClass
          ? clinician.qualifiedClassIds.filter((id) => id !== classId)
          : [...clinician.qualifiedClassIds, classId];
        return {
          ...clinician,
          qualifiedClassIds: nextQualified,
          preferredClassIds: [...nextQualified],
        };
      }),
    );
  };

  const handleReorderQualification = (
    clinicianId: string,
    fromClassId: string,
    toClassId: string,
  ) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        const fromIndex = clinician.qualifiedClassIds.indexOf(fromClassId);
        const toIndex = clinician.qualifiedClassIds.indexOf(toClassId);
        if (fromIndex === -1 || toIndex === -1) return clinician;
        const nextQualified = [...clinician.qualifiedClassIds];
        const [moved] = nextQualified.splice(fromIndex, 1);
        nextQualified.splice(toIndex, 0, moved);
        return {
          ...clinician,
          qualifiedClassIds: nextQualified,
          preferredClassIds: [...nextQualified],
        };
      }),
    );
  };

  const handleAddVacation = (clinicianId: string) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        const id = `vac-${Date.now().toString(36)}`;
        const start = addDays(new Date(), 7);
        const end = addDays(start, 1);
        return {
          ...clinician,
          vacations: [
            ...clinician.vacations,
            { id, startISO: toISODate(start), endISO: toISODate(end) },
          ],
        };
      }),
    );
  };

  const handleUpdateVacation = (
    clinicianId: string,
    vacationId: string,
    updates: { startISO?: string; endISO?: string },
  ) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        return {
          ...clinician,
          vacations: clinician.vacations.map((vacation) =>
            vacation.id === vacationId ? { ...vacation, ...updates } : vacation,
          ),
        };
      }),
    );
  };

  const handleRemoveVacation = (clinicianId: string, vacationId: string) => {
    setClinicians((prev) =>
      prev.map((clinician) => {
        if (clinician.id !== clinicianId) return clinician;
        return {
          ...clinician,
          vacations: clinician.vacations.filter((vacation) => vacation.id !== vacationId),
        };
      }),
    );
  };

  return (
    <div className="min-h-screen">
      <TopBar
        openSlotsCount={openSlotsCount}
        viewMode={viewMode}
        onToggleView={() =>
          setViewMode((prev) => (prev === "calendar" ? "settings" : "calendar"))
        }
        activeUserId={activeUserId}
        users={USERS}
        onSelectUser={(userId) => setActiveUserId(userId)}
      />

      {viewMode === "calendar" ? (
        <>
          <ScheduleGrid
            leftHeaderTitle=""
            weekDays={weekDays}
            rows={allRows}
            assignmentMap={renderAssignmentMap}
            header={
              <WeekNavigator
                variant="card"
                rangeStart={weekStart}
                rangeEndInclusive={weekEndInclusive}
                onPrevWeek={() => setAnchorDate((d) => addWeeks(d, -1))}
                onNextWeek={() => setAnchorDate((d) => addWeeks(d, 1))}
                onToday={() => setAnchorDate(new Date())}
              />
            }
            separatorBeforeRowIds={poolsSeparatorId ? [poolsSeparatorId] : []}
            minSlotsByRowId={minSlotsByRowId}
            getClinicianName={(id) => clinicianNameById.get(id) ?? "Unknown"}
            getHasEligibleClasses={(id) => {
              const clinician = clinicians.find((item) => item.id === id);
              return clinician ? clinician.qualifiedClassIds.length > 0 : false;
            }}
            getIsQualified={(clinicianId, rowId) => {
              const clinician = clinicians.find((item) => item.id === clinicianId);
              return clinician ? clinician.qualifiedClassIds.includes(rowId) : false;
            }}
            slotOverridesByKey={slotOverridesByKey}
            onRemoveEmptySlot={({ rowId, dateISO }) => {
              adjustSlotOverride(rowId, dateISO, -1);
            }}
            onAutoAllocateDay={(dateISO, options) => {
              solveDay(dateISO, {
                onlyFillRequired: options?.onlyFillRequired,
                userId: activeUserId,
              })
                .then((result) => {
                  if (result.notes.length > 0) {
                    setSolverNotice(result.notes[0]);
                    window.setTimeout(() => setSolverNotice(null), 4000);
                  }
                  if (!result.assignments.length) return;
                  setAssignmentMap((prev) => {
                    const next = new Map(prev);
                    for (const assignment of result.assignments) {
                      const key = `${assignment.rowId}__${assignment.dateISO}`;
                      const existing = next.get(key) ?? [];
                      const already = existing.some(
                        (item) =>
                          item.clinicianId === assignment.clinicianId &&
                          item.rowId === assignment.rowId &&
                          item.dateISO === assignment.dateISO,
                      );
                      if (!already) next.set(key, [...existing, assignment]);
                    }
                    return next;
                  });
                })
                .catch(() => {
                  setSolverNotice("Solver service is not responding.");
                  window.setTimeout(() => setSolverNotice(null), 4000);
                });
            }}
            onResetDay={(dateISO) => {
              setAssignmentMap((prev) => {
                const next = new Map(prev);
                for (const [key, list] of next.entries()) {
                  const [rowId, keyDate] = key.split("__");
                  if (keyDate !== dateISO) continue;
                  if (rowId.startsWith("pool-")) continue;
                  const filtered = list.filter((item) => isOnVacation(item.clinicianId, dateISO));
                  if (filtered.length === 0) next.delete(key);
                  else next.set(key, filtered);
                }
                return next;
              });
            }}
            onAutoAllocateWeek={(options) => {
              weekDays.forEach((day) => {
                const dateISO = toISODate(day);
                solveDay(dateISO, {
                  onlyFillRequired: options?.onlyFillRequired,
                  userId: activeUserId,
                })
                  .then((result) => {
                    if (result.notes.length > 0) {
                      setSolverNotice(result.notes[0]);
                      window.setTimeout(() => setSolverNotice(null), 4000);
                    }
                    if (!result.assignments.length) return;
                    setAssignmentMap((prev) => {
                      const next = new Map(prev);
                      for (const assignment of result.assignments) {
                        const key = `${assignment.rowId}__${assignment.dateISO}`;
                        const existing = next.get(key) ?? [];
                        const already = existing.some(
                          (item) =>
                            item.clinicianId === assignment.clinicianId &&
                            item.rowId === assignment.rowId &&
                            item.dateISO === assignment.dateISO,
                        );
                        if (!already) next.set(key, [...existing, assignment]);
                      }
                      return next;
                    });
                  })
                  .catch(() => {
                    setSolverNotice("Solver service is not responding.");
                    window.setTimeout(() => setSolverNotice(null), 4000);
                  });
              });
            }}
            onResetWeek={() => {
              setAssignmentMap((prev) => {
                const next = new Map(prev);
                for (const [key, list] of next.entries()) {
                  const [rowId, keyDate] = key.split("__");
                  if (!rowId || !keyDate) continue;
                  if (rowId.startsWith("pool-")) continue;
                  const filtered = list.filter((item) => isOnVacation(item.clinicianId, keyDate));
                  if (filtered.length === 0) next.delete(key);
                  else next.set(key, filtered);
                }
                return next;
              });
            }}
            onClinicianClick={(clinicianId) => setEditingClinicianId(clinicianId)}
            onCellClick={({ row, date }) => {
              if (row.kind !== "class") return;
              adjustSlotOverride(row.id, toISODate(date), 1);
            }}
            onMoveWithinDay={({
              dateISO,
              fromRowId,
              toRowId,
              assignmentId,
              clinicianId,
            }) => {
              setAssignmentMap((prev) => {
                const fromKey = `${fromRowId}__${dateISO}`;
                const toKey = `${toRowId}__${dateISO}`;
                if (fromKey === toKey) return prev;
                const fromRow = rowById.get(fromRowId);
                const toRow = rowById.get(toRowId);
                if (!fromRow || !toRow) return prev;

                const next = new Map(prev);
                const removeAssignment = (key: string, targetId: string) => {
                  const list = next.get(key) ?? [];
                  const nextList = list.filter((a) => a.id !== targetId);
                  if (nextList.length === 0) next.delete(key);
                  else next.set(key, nextList);
                };
                if (toRow.kind === "pool") {
                  const isManualPool = toRow.id === MANUAL_POOL_ID;
                  if (isManualPool) {
                    if (fromRow.kind === "class" || fromRow.id === MANUAL_POOL_ID) {
                      const fromList = next.get(fromKey) ?? [];
                      const moving = fromList.find((a) => a.id === assignmentId);
                      if (!moving) return prev;
                      removeAssignment(fromKey, assignmentId);
                      const toList = next.get(toKey) ?? [];
                      const already = toList.some((item) => item.clinicianId === clinicianId);
                      if (!already) {
                        next.set(toKey, [...toList, { ...moving, rowId: toRowId, dateISO }]);
                      }
                      return next;
                    }

                    const toList = next.get(toKey) ?? [];
                    const already = toList.some((item) => item.clinicianId === clinicianId);
                    if (!already) {
                      const newItem: Assignment = {
                        id: `pool-${toRowId}-${clinicianId}-${dateISO}`,
                        rowId: toRowId,
                        dateISO,
                        clinicianId,
                      };
                      next.set(toKey, [...toList, newItem]);
                    }
                    return next;
                  }

                  if (fromRow.kind === "class" || fromRow.id === MANUAL_POOL_ID) {
                    removeAssignment(fromKey, assignmentId);
                  }
                  return next;
                }

                if (fromRow.kind === "pool") {
                  if (fromRow.id === MANUAL_POOL_ID) {
                    removeAssignment(fromKey, assignmentId);
                  }
                  const alreadyAssigned = Array.from(next.entries()).some(([key, list]) => {
                    const keyDate = key.split("__")[1];
                    if (keyDate !== dateISO) return false;
                    return list.some((a) => a.clinicianId === clinicianId);
                  });
                  if (alreadyAssigned) return prev;
                  const toList = next.get(toKey) ?? [];
                  const newItem: Assignment = {
                    id: `as-${Date.now().toString(36)}-${clinicianId}`,
                    rowId: toRowId,
                    dateISO,
                    clinicianId,
                  };
                  next.set(toKey, [...toList, newItem]);
                  return next;
                }

                const fromList = next.get(fromKey) ?? [];
                const moving = fromList.find((a) => a.id === assignmentId);
                if (!moving) return prev;
                const nextFrom = fromList.filter((a) => a.id !== assignmentId);
                if (nextFrom.length === 0) next.delete(fromKey);
                else next.set(fromKey, nextFrom);
                const toList = next.get(toKey) ?? [];
                next.set(toKey, [...toList, { ...moving, rowId: toRowId, dateISO }]);
                return next;
              });
            }}
          />
        </>
      ) : (
        <SettingsView
          classRows={classRows}
          poolRows={poolRows}
          minSlotsByRowId={minSlotsByRowId}
          clinicians={clinicians}
          onChangeMinSlots={(rowId, kind, nextValue) => {
            setMinSlotsByRowId((prev) => ({
              ...prev,
              [rowId]: {
                ...(prev[rowId] ?? { weekday: 0, weekend: 0 }),
                [kind]: Math.max(0, Math.floor(nextValue)),
              },
            }));
          }}
          onRenameClass={(rowId, nextName) => {
            setRows((prev) =>
              prev.map((row) =>
                row.id === rowId ? { ...row, name: nextName } : row,
              ),
            );
          }}
          onRemoveClass={(rowId) => {
            setRows((prev) => prev.filter((row) => row.id !== rowId));
            setMinSlotsByRowId((prev) => {
              const next = { ...prev };
              delete next[rowId];
              return next;
            });
            setSlotOverridesByKey((prev) => {
              const next: Record<string, number> = {};
              for (const [key, value] of Object.entries(prev)) {
                if (!key.startsWith(`${rowId}__`)) next[key] = value;
              }
              return next;
            });
            setClinicians((prev) =>
              prev.map((clinician) => ({
                ...clinician,
                qualifiedClassIds: clinician.qualifiedClassIds.filter((id) => id !== rowId),
                preferredClassIds: clinician.preferredClassIds.filter((id) => id !== rowId),
              })),
            );
            setAssignmentMap((prev) => {
              const next = new Map(prev);
              for (const key of next.keys()) {
                if (key.startsWith(`${rowId}__`)) next.delete(key);
              }
              return next;
            });
          }}
          onAddClass={() => {
            const id = `class-${Date.now().toString(36)}`;
            setRows((prev) => {
              const classRows = prev.filter((row) => row.kind === "class");
              const poolRows = prev.filter((row) => row.kind === "pool");
              const classCount = classRows.length;
              const color = CLASS_COLORS[classCount % CLASS_COLORS.length];
              return [
                ...classRows,
                { id, name: "New Class", kind: "class", dotColorClass: color },
                ...poolRows,
              ];
            });
            setMinSlotsByRowId((prev) => ({
              ...prev,
              [id]: { weekday: 1, weekend: 1 },
            }));
          }}
          onReorderClass={(fromId, toId) => {
            setRows((prev) => {
              const classRows = prev.filter((row) => row.kind === "class");
              const poolRows = prev.filter((row) => row.kind === "pool");
              const fromIndex = classRows.findIndex((row) => row.id === fromId);
              const toIndex = classRows.findIndex((row) => row.id === toId);
              if (fromIndex === -1 || toIndex === -1) return prev;
              const nextClasses = [...classRows];
              const [moved] = nextClasses.splice(fromIndex, 1);
              nextClasses.splice(toIndex, 0, moved);
              return [...nextClasses, ...poolRows];
            });
          }}
          onRenamePool={(rowId, nextName) => {
            setRows((prev) =>
              prev.map((row) =>
                row.id === rowId ? { ...row, name: nextName } : row,
              ),
            );
          }}
          onAddClinician={(name) => {
            const slug = name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, "");
            const id = `clin-${slug || "user"}-${Date.now().toString(36)}`;
            setClinicians((prev) => [
              ...prev,
              {
                id,
                name,
                qualifiedClassIds: [],
                preferredClassIds: [],
                vacations: [],
              },
            ]);
          }}
          onEditClinician={(clinicianId) => setEditingClinicianId(clinicianId)}
          onRemoveClinician={(clinicianId) => {
            setClinicians((prev) => prev.filter((clinician) => clinician.id !== clinicianId));
            setAssignmentMap((prev) => {
              const next = new Map<string, Assignment[]>();
              for (const [key, list] of prev.entries()) {
                const filtered = list.filter(
                  (assignment) => assignment.clinicianId !== clinicianId,
                );
                if (filtered.length > 0) next.set(key, filtered);
              }
              return next;
            });
            setEditingClinicianId((current) =>
              current === clinicianId ? "" : current,
            );
          }}
        />
      )}

      <ClinicianEditModal
        open={editingClinicianId !== ""}
        onClose={() => setEditingClinicianId("")}
        clinician={editingClinician ?? null}
        classRows={classRows}
        onToggleQualification={handleToggleQualification}
        onReorderQualification={handleReorderQualification}
        onAddVacation={handleAddVacation}
        onUpdateVacation={handleUpdateVacation}
        onRemoveVacation={handleRemoveVacation}
      />

      {solverNotice ? (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 shadow-lg">
          {solverNotice}
        </div>
      ) : null}

    </div>
  );
}
