# agent.md — Weekly Schedule System (Current State)

This repo is a doctors/clinicians scheduling system with a React frontend and a FastAPI backend + OR-Tools solver. It is local-first and stores state in SQLite via the API.

---

## 1) Tech Stack
Frontend
- React 18 + TypeScript
- Vite
- Tailwind CSS

Backend
- FastAPI + Uvicorn
- OR-Tools CP-SAT
- SQLite persistence (per-user JSON state rows)
- Auth: python-jose (JWT), passlib (password hashing)

---

## 2) Core UI
Top bar
- Title, Settings button (ghost/outlined), theme toggle, avatar (outlined circle).
- Open slots badge lives in the schedule card header (green when all slots filled).
- Responsive: stacks on small screens; avatar row moves below the main controls.

Schedule card
- Week navigator lives inside the card header; range label uses DD.MM.YYYY (or DD.MM.YYYY – DD.MM.YYYY); Today button sits next to the arrows.
- On mobile, the schedule renders a single day with a day navigator (label between arrows, Today next to them).
- Today is shown by circling the day number in the header.
- Week starts Monday; weekend/holiday styling is header-only: weekend header light gray, holiday header light lavender; holiday name is a tiny purple label under the day.
- Mobile: grid uses touch scrolling and slightly tighter paddings.
- Control row between class rows and pool rows with icon buttons:
  - Only necessary, Distribute all, Reset to free (week and per day), with tooltips.

Rows
- Class rows (editable, reorderable priority): MRI, CT, Sonography, Conventional, On Call, etc.
- Pool rows (editable names, not deletable): Distribution Pool (id: pool-not-allocated), Manual Pool (id: pool-manual), Vacation (id: pool-vacation).
- Pool rows appear below a separator line.
- Row labels are uppercase, no colored dots, truncate around 20 characters (tighter on mobile).
- Vacation row background stays the same gray even on weekends/holidays.

Cells
- Multiple clinician pills per cell, sorted by surname.
- Empty slots shown as gray dashed pills based on min slots; plus/minus badges are gray; label is not bold.
- Drag and drop is same-day only; invalid drops (wrong day or outside the grid) snap back instantly.
- Dragging into or out of Vacation updates the clinician vacation ranges.
- Eligible target cells for a dragged clinician show a green border.
- Ineligible manual assignment is allowed, with a yellow warning icon.
- No eligible classes shows a red warning icon.
- Warning tooltips show only when hovering the icon itself.
- Hovering a class cell highlights eligible clinicians for that class on the same date (desktop only); highlight stays when hovering a pill and is cleared while dragging.

Pills
- Compact blue pill, normal font weight; eligible hover highlight uses green background + green border (no extra thickness).
- Warning icons are small circular badges at top-right of the pill.
- Drag preview uses the normal pill style (highlight removed).

---

## 3) Settings
Classes
- Reorder by drag handle to set priority.
- Rename, remove, add.
- Min slots split into weekday vs weekend/holiday.

Pools
- Rename pool rows (Distribution Pool, Vacation). No deletion.

Clinicians
- List with Add Clinician and Edit buttons.
- Editing uses the same modal as clicking a pill in the calendar.

Clinician Editor (modal)
- Eligible classes list is ordered. Drag to set priority (this order is also the preference list).
- Add eligible classes via dropdown + Add button; remove via per-row Remove button.
- Vacation management uses compact DD.MM.YYYY inputs with a dash between start and end.
- Past vacations collapsed in a <details>.
- Modal body is scrollable for long vacation lists.

Holidays
- Year selector with stepper buttons.
- Country picker with flag emoji (top EU countries + CH, LU), alphabetical.
- "Load Holidays" fetches from https://date.nager.at/api/v3/PublicHolidays.
- Add holidays manually; list shows DD.MM.YYYY dates (input accepts DD.MM.YYYY or ISO).
- Holidays behave like weekends in solver + min slot logic and show in the calendar header.

Admin user management
- User export: admin can download a user state JSON (export includes metadata + AppState).
- User import: create user form accepts an export JSON to seed the new user's state.

Hover highlight issue (remote)
- Root cause: pills had both blue and emerald classes at once; Tailwind CSS order kept the blue background even when `isHighlighted` was true.
- Fix: use mutually exclusive class sets in `AssignmentPill` so emerald styles fully replace blue.
- Symptom: cell hover worked but pills did not turn green; fixed after frontend rebuild.

Hover stuck after drag (local/remote)
- Root cause: CSS `:hover` (group-hover) sometimes stays active after a drag cancel, leaving ghost slots or cell backgrounds stuck.
- Fix: drive ghost slot visibility and cell hover background from `hoveredClassCell` state instead of CSS hover.

Drag preview styling
- Drag image uses a cloned pill; if it was highlighted, the clone kept emerald classes.
- Fix: strip all emerald classes on clone and re-apply the normal blue classes during drag start.

---

## 4) Data Model (Shared Concept)
```ts
type RowKind = "class" | "pool";

type WorkplaceRow = {
  id: string;
  name: string;
  kind: RowKind;
  dotColorClass: string;
};

type VacationRange = { id: string; startISO: string; endISO: string };

type Clinician = {
  id: string;
  name: string;
  qualifiedClassIds: string[];
  preferredClassIds: string[];
  vacations: VacationRange[];
};

type Assignment = {
  id: string;
  rowId: string;
  dateISO: string;
  clinicianId: string;
};

type MinSlotsByRowId = Record<string, { weekday: number; weekend: number }>;

type Holiday = { dateISO: string; name: string };
```

---

## 5) Scheduling Logic (Frontend)
- Vacation override: for each date, if clinician is on vacation, they appear in Vacation pool and their class assignment is suppressed.
- Distribution Pool: any clinician not assigned to a class and not on vacation appears here.
- Assignments stored in a map (rowId + dateISO -> list of assignments).
- Drag and drop only within the same day.
- Clicking a class cell increments the per-day slot override (adds an "Open Slot"); remove via the minus badge.

---

## 6) Solver (Backend, OR-Tools)
Endpoint: `POST /v1/solve`
Payload:
```json
{ "dateISO": "YYYY-MM-DD", "only_fill_required": true|false }
```

Behavior
- Uses only clinicians currently in Distribution Pool (unassigned and not on vacation).
- Hard constraints:
  - Qualification required.
  - Vacation overrides assignment.
  - Manual assignments remain in place; solver adds only from the pool.
- Objective:
  - Prioritize coverage by class order (top of class list is highest).
  - Minimize missing required slots.
  - If `only_fill_required=false`, add extras.
  - Preferred classes (order of eligible classes) is a lower-weight tie breaker.

---

## 7) Backend State + Persistence
Backend stores one JSON blob per user in SQLite:
```json
{
  "rows": [...],
  "clinicians": [...],
  "assignments": [...],
  "minSlotsByRowId": {...},
  "holidayCountry": "DE",
  "holidayYear": 2025,
  "holidays": [{ "dateISO": "2025-12-25", "name": "Christmas Day" }]
}
```
Table: `app_state` (id = username). Legacy row id `"state"` is migrated to `"jk"`.

Endpoints
- `GET /health`
- `POST /auth/login`
- `GET /auth/me`
- `GET /auth/users` (admin only)
- `GET /auth/users/{username}/export` (admin only)
- `POST /auth/users` (admin only, also seeds new user's state from creator)
- `PATCH /auth/users/{username}` (admin only, supports password reset)
- `DELETE /auth/users/{username}` (admin only)
- `GET /v1/state`
- `POST /v1/state`
- `POST /v1/solve`

---

## 8) Auth Model (Backend + Frontend)
- JWT auth; frontend stores token in `localStorage` key `authToken`.
- Admin user is created on startup if `ADMIN_USERNAME`/`ADMIN_PASSWORD` are set and the user does not already exist.
- Creating a user in the admin panel copies the creator's current state as the new user's initial state.
- Login is case-sensitive (`admin` is lowercase).
- Login screen includes show/hide password toggle.

---

## 9) Running Locally (Step-by-step)
Prereqs
- Python 3.9+
- Node 18+

Auth env (required for login):
```bash
export ADMIN_USERNAME=admin
export ADMIN_PASSWORD=change-me
export JWT_SECRET=change-me-too
```

Step 1: install backend deps
```bash
python3 -m pip install -r backend/requirements.txt
```

Step 2: install frontend deps
```bash
npm install
```

Step 3: start backend (Terminal 1)
```bash
python3 -m uvicorn backend.main:app --host localhost --port 8000
```

Step 4: start frontend (Terminal 2)
```bash
npm run dev -- --host localhost --port 5173
```

Step 5: open the app
- http://localhost:5173

If a port is already in use
- Backend: pick another port, then set `VITE_API_URL` for the frontend:
```bash
python3 -m uvicorn backend.main:app --host localhost --port 8001
VITE_API_URL=http://localhost:8001 npm run dev -- --host localhost --port 5173
```
- Frontend: pick another port with `--port 5175` and open that URL in the browser.

If the UI says "Solver service is not responding"
- Check backend health: `curl http://localhost:8000/health`
- Ensure `VITE_API_URL` matches the backend host/port.
- If backend logs show 401 on `/v1/solve`, the auth token is invalid (often after a JWT secret change). Log out/in.
- If using a non-localhost host (LAN or remote), set CORS explicitly:
```bash
CORS_ALLOW_ORIGINS=http://my-host:5173 python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Env note
- `export ...` in a terminal is session-only (not permanent).

Stopping servers
- Press Ctrl+C in each terminal.

Deployment note
- Build the frontend with `VITE_API_URL=https://your-api.example.com npm run build`, then serve `dist/`.
- Run the backend behind a reverse proxy (or public host) and set `CORS_ALLOW_ORIGINS` to your frontend origin.

---

## 10) Key Files
Frontend
- `src/pages/WeeklySchedulePage.tsx` (main state + logic)
- `src/components/schedule/ScheduleGrid.tsx`
- `src/components/schedule/ClinicianEditor.tsx`
- `src/components/schedule/ClinicianEditModal.tsx`
- `src/components/schedule/SettingsView.tsx`
- `src/components/schedule/RowLabel.tsx`
- `src/components/schedule/AssignmentPill.tsx`
- `src/api/client.ts`

Backend
- `backend/main.py`
- `backend/requirements.txt`
- `backend/schedule.db`

---

## 11) Notes for New Agents
- The calendar is the source of truth for edits; Settings manages class priority + min slots + pool names + clinician list.
- Pool ids: Distribution Pool = `pool-not-allocated`, Manual Pool = `pool-manual`, Vacation = `pool-vacation`.
- Keep drag restricted to same day.
- Mobile single-day view uses `useMediaQuery("(max-width: 640px)")` with `displayDays`; week-level calculations still use `fullWeekDays`.
- `ScheduleGrid` supports variable day counts (dynamic `gridTemplateColumns`, last column determined by index).
- Hover highlighting is desktop-only (no hover on mobile) and uses `AssignmentPill` `isHighlighted`.
- HTML5 drag-and-drop does not work on mobile; touch DnD would require a new library or alternate UX.
- If you change the solver API, update `src/api/client.ts` and `WeeklySchedulePage.tsx`.
- Legacy row id `pool-not-working` is filtered out on load.

---

## 12) Current Hetzner Deployment (IP-only)
- Server IP: `46.224.114.183`
- Path: `/opt/shiftschedule`
- Stack: `docker compose -f docker-compose.ip.yml up -d --build`
- Frontend: `http://46.224.114.183`
- Backend: `http://46.224.114.183:8000`
- Data lives in the `backend_data` volume; you can update only the frontend without touching the DB.
- Typical frontend update: rsync repo to `/opt/shiftschedule`, then `docker compose -f docker-compose.ip.yml build frontend` and `up -d frontend`.
