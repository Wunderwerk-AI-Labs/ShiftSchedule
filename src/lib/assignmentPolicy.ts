import type { Assignment } from "../api/client";

/** Legacy/manual entries and explicitly fixed planner entries survive replanning. */
export const isProtectedAssignment = (assignment: Assignment): boolean =>
  assignment.source !== "solver" || assignment.locked === true;

export type AssignmentIdentity = Pick<Assignment, "id" | "rowId" | "dateISO">;
