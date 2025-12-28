export type RowKind = "class" | "pool";

export type Location = {
  id: string;
  name: string;
};

export type SubShift = {
  id: string;
  name: string;
  order: 1 | 2 | 3;
  startTime: string;
  endTime: string;
  endDayOffset?: number;
  hours?: number;
};

export type WorkplaceRow = {
  id: string;
  name: string;
  kind: RowKind;
  dotColorClass: string;
  locationId?: string;
  subShifts?: SubShift[];
};

export type VacationRange = {
  id: string;
  startISO: string;
  endISO: string;
};

export type Holiday = {
  dateISO: string;
  name: string;
};

export type Clinician = {
  id: string;
  name: string;
  qualifiedClassIds: string[];
  preferredClassIds: string[];
  vacations: VacationRange[];
  workingHoursPerWeek?: number;
};

export type Assignment = {
  id: string;
  rowId: string;
  dateISO: string;
  clinicianId: string;
};

export type MinSlots = { weekday: number; weekend: number };

export type AppState = {
  locations?: Location[];
  locationsEnabled?: boolean;
  rows: WorkplaceRow[];
  clinicians: Clinician[];
  assignments: Assignment[];
  minSlotsByRowId: Record<string, MinSlots>;
  slotOverridesByKey?: Record<string, number>;
  holidayCountry?: string;
  holidayYear?: number;
  holidays?: Holiday[];
  publishedWeekStartISOs?: string[];
};

export type UserStateExport = {
  version: number;
  exportedAt: string;
  sourceUser: string;
  state: AppState;
};

export type UserRole = "admin" | "user";

export type AuthUser = {
  username: string;
  role: UserRole;
  active: boolean;
};

export type IcalPublishStatus = {
  published: boolean;
  all?: { subscribeUrl: string };
  clinicians?: Array<{
    clinicianId: string;
    clinicianName: string;
    subscribeUrl: string;
  }>;
};

export type WebPublishStatus = {
  published: boolean;
  token?: string;
};

export type PublicWebWeekResponse = {
  published: boolean;
  weekStartISO: string;
  weekEndISO: string;
  locations?: Location[];
  locationsEnabled?: boolean;
  rows?: WorkplaceRow[];
  clinicians?: Clinician[];
  assignments?: Assignment[];
  minSlotsByRowId?: Record<string, MinSlots>;
  slotOverridesByKey?: Record<string, number>;
  holidays?: Holiday[];
};

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const TOKEN_STORAGE_KEY = "authToken";
const AUTH_EXPIRED_EVENT = "auth-expired";

function readToken() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAuthToken(token: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearAuthToken() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function handleUnauthorized() {
  clearAuthToken();
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

function buildHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const token = readToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function login(username: string, password: string): Promise<{
  access_token: string;
  token_type: string;
  user: AuthUser;
}> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({ username, password }),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to login: ${res.status}`);
  }
  return res.json();
}

export async function getCurrentUser(): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to fetch user: ${res.status}`);
  }
  return res.json();
}

export async function listUsers(): Promise<AuthUser[]> {
  const res = await fetch(`${API_BASE}/auth/users`, {
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to list users: ${res.status}`);
  }
  return res.json();
}

export async function createUser(payload: {
  username: string;
  password: string;
  role?: UserRole;
  importState?: AppState | UserStateExport;
}): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/users`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to create user: ${res.status}`);
  }
  return res.json();
}

export async function exportUserState(username: string): Promise<UserStateExport> {
  const res = await fetch(
    `${API_BASE}/auth/users/${encodeURIComponent(username)}/export`,
    {
      headers: buildHeaders(),
    },
  );
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to export user: ${res.status}`);
  }
  return res.json();
}

export async function updateUser(
  username: string,
  payload: { active?: boolean; role?: UserRole; password?: string },
): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/auth/users/${encodeURIComponent(username)}`, {
    method: "PATCH",
    headers: buildHeaders(),
    body: JSON.stringify(payload),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to update user: ${res.status}`);
  }
  return res.json();
}

export async function deleteUser(username: string): Promise<void> {
  const res = await fetch(`${API_BASE}/auth/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to delete user: ${res.status}`);
  }
}

export async function getState(): Promise<AppState> {
  const res = await fetch(`${API_BASE}/v1/state`, {
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to fetch state: ${res.status}`);
  }
  return res.json();
}

export async function saveState(state: AppState): Promise<AppState> {
  const res = await fetch(`${API_BASE}/v1/state`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(state),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to save state: ${res.status}`);
  }
  return res.json();
}

export async function solveDay(
  dateISO: string,
  options?: { onlyFillRequired?: boolean },
): Promise<{
  dateISO: string;
  assignments: Assignment[];
  notes: string[];
}> {
  const res = await fetch(`${API_BASE}/v1/solve`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      dateISO,
      only_fill_required: options?.onlyFillRequired ?? false,
    }),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to solve day: ${res.status}`);
  }
  return res.json();
}

export async function getIcalPublishStatus(): Promise<IcalPublishStatus> {
  const res = await fetch(`${API_BASE}/v1/ical/publish`, {
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to fetch iCal status: ${res.status}`);
  }
  return res.json();
}

export async function publishIcal(): Promise<IcalPublishStatus> {
  const res = await fetch(`${API_BASE}/v1/ical/publish`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({}),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to publish iCal: ${res.status}`);
  }
  return res.json();
}

export async function rotateIcalToken(): Promise<IcalPublishStatus> {
  const res = await fetch(`${API_BASE}/v1/ical/publish/rotate`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({}),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to rotate iCal token: ${res.status}`);
  }
  return res.json();
}

export async function unpublishIcal(): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/ical/publish`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to unpublish iCal: ${res.status}`);
  }
}

export async function exportWeekPdf(startISO: string): Promise<Blob> {
  const res = await fetch(
    `${API_BASE}/v1/pdf/week?start=${encodeURIComponent(startISO)}`,
    {
      headers: buildHeaders(),
    },
  );
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to export PDF: ${res.status}`);
  }
  return res.blob();
}

export async function getWebPublishStatus(): Promise<WebPublishStatus> {
  const res = await fetch(`${API_BASE}/v1/web/publish`, {
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to fetch web publish status: ${res.status}`);
  }
  return res.json();
}

export async function publishWeb(): Promise<WebPublishStatus> {
  const res = await fetch(`${API_BASE}/v1/web/publish`, {
    method: "POST",
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to publish web link: ${res.status}`);
  }
  return res.json();
}

export async function rotateWeb(): Promise<WebPublishStatus> {
  const res = await fetch(`${API_BASE}/v1/web/publish/rotate`, {
    method: "POST",
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to rotate web link: ${res.status}`);
  }
  return res.json();
}

export async function unpublishWeb(): Promise<void> {
  const res = await fetch(`${API_BASE}/v1/web/publish`, {
    method: "DELETE",
    headers: buildHeaders(),
  });
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to unpublish web link: ${res.status}`);
  }
}

export async function getPublicWebWeek(
  token: string,
  weekStartISO: string,
): Promise<PublicWebWeekResponse> {
  const res = await fetch(
    `${API_BASE}/v1/web/${encodeURIComponent(token)}/week?start=${encodeURIComponent(
      weekStartISO,
    )}`,
  );
  if (res.status === 404) {
    const error = new Error("Link not found") as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch public schedule: ${res.status}`);
  }
  return res.json();
}

export async function exportWeeksPdf(startISO: string, weeks: number): Promise<Blob> {
  const res = await fetch(
    `${API_BASE}/v1/pdf/weeks?start=${encodeURIComponent(startISO)}&weeks=${encodeURIComponent(
      String(weeks),
    )}`,
    {
      headers: buildHeaders(),
    },
  );
  if (res.status === 401) handleUnauthorized();
  if (!res.ok) {
    throw new Error(`Failed to export PDF: ${res.status}`);
  }
  return res.blob();
}
