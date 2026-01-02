import type {
  PreferredWorkingTime,
  PreferredWorkingTimeRequirement,
  PreferredWorkingTimes,
} from "../api/client";

const DEFAULT_START = "07:00";
const DEFAULT_END = "17:00";
const REQUIREMENTS = new Set<PreferredWorkingTimeRequirement>([
  "none",
  "preference",
  "mandatory",
]);

export const DEFAULT_PREFERRED_WORKING_TIMES: PreferredWorkingTimes = {
  mon: { startTime: DEFAULT_START, endTime: DEFAULT_END, requirement: "none" },
  tue: { startTime: DEFAULT_START, endTime: DEFAULT_END, requirement: "none" },
  wed: { startTime: DEFAULT_START, endTime: DEFAULT_END, requirement: "none" },
  thu: { startTime: DEFAULT_START, endTime: DEFAULT_END, requirement: "none" },
  fri: { startTime: DEFAULT_START, endTime: DEFAULT_END, requirement: "none" },
  sat: { startTime: DEFAULT_START, endTime: DEFAULT_END, requirement: "none" },
  sun: { startTime: DEFAULT_START, endTime: DEFAULT_END, requirement: "none" },
};

const parseTimeToMinutes = (value?: string) => {
  if (!value) return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const normalizeRequirement = (value: unknown): PreferredWorkingTimeRequirement => {
  if (typeof value !== "string") return "none";
  const trimmed = value.trim();
  return REQUIREMENTS.has(trimmed as PreferredWorkingTimeRequirement)
    ? (trimmed as PreferredWorkingTimeRequirement)
    : "none";
};

const normalizeDay = (
  raw: PreferredWorkingTime | undefined,
): PreferredWorkingTime => {
  const startCandidate = raw?.startTime ?? DEFAULT_START;
  const endCandidate = raw?.endTime ?? DEFAULT_END;
  const startMinutes = parseTimeToMinutes(startCandidate);
  const endMinutes = parseTimeToMinutes(endCandidate);
  let startTime = startMinutes === null ? DEFAULT_START : startCandidate;
  let endTime = endMinutes === null ? DEFAULT_END : endCandidate;
  const requirement = normalizeRequirement(raw?.requirement);
  if (
    startMinutes === null ||
    endMinutes === null ||
    (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes)
  ) {
    startTime = DEFAULT_START;
    endTime = DEFAULT_END;
  }
  return { startTime, endTime, requirement };
};

export const normalizePreferredWorkingTimes = (
  value?: Partial<Record<keyof PreferredWorkingTimes, PreferredWorkingTime>>,
): PreferredWorkingTimes => {
  const next: PreferredWorkingTimes = {
    mon: normalizeDay(value?.mon),
    tue: normalizeDay(value?.tue),
    wed: normalizeDay(value?.wed),
    thu: normalizeDay(value?.thu),
    fri: normalizeDay(value?.fri),
    sat: normalizeDay(value?.sat),
    sun: normalizeDay(value?.sun),
  };
  return next;
};
