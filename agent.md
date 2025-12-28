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
- Title is clickable and returns to calendar view.
- Button order (left → right): Settings, Help, Theme toggle, User avatar.
- Settings/Help buttons turn into a highlighted **Back** state when active.
- Open slots badge lives in the schedule card header (green when all slots filled).
- Responsive: stacks on small screens; avatar row moves below the main controls.

Schedule card
- Week navigator lives inside the card header; range label uses DD.MM.YYYY (or DD.MM.YYYY – DD.MM.YYYY); Today button sits next to the arrows.
- On mobile, the schedule renders a single day with a day navigator (label between arrows, Today next to them).
- Today is shown by circling the day number in the header.
- Week starts Monday; weekend/holiday styling is header-only: weekend header light gray, holiday header light lavender; holiday name is a tiny purple label under the day.
- Mobile: grid uses touch scrolling and slightly tighter paddings.
- Automated shift planning and Export are separate panels in the schedule view; Export panel opens the same modal as before.
- Control row between section rows and pool rows with icon buttons:
  - Only necessary, Distribute all, Reset to free (week and per day), with tooltips.
- Week publication uses a **Publish** toggle pill in the header, placed to the right of the Open Slots badge.

Rows
- Section rows (editable, reorderable priority): MRI, CT, Sonography, Conventional, On Call, etc.
- Each section expands into 1-3 shift rows in the grid; the section name shows once, shift labels are indented, and the time range + location (if enabled) are right-aligned.
- Pool rows (editable names, not deletable): Distribution Pool (id: pool-not-allocated), Reserve Pool (id: pool-manual), Vacation (id: pool-vacation).
- Pool rows appear below a separator line.
- Row labels are uppercase, no colored dots, truncate around 20 characters (tighter on mobile).
- Vacation row background stays the same gray even on weekends/holidays.

Cells
- Multiple clinician pills per cell, sorted by surname.
- Empty slots shown as gray dashed pills based on min slots; plus/minus badges are gray; label is not bold.
- Drag and drop is same-day only; invalid drops (wrong day or outside the grid) snap back instantly.
- Dragging into or out of Vacation updates the clinician vacation ranges.
- Eligible target cells for a dragged clinician use a pale green background (consistent with the green "Open Slots" badge when count is 0).
- Ineligible manual assignment is allowed, with a yellow warning icon.
- No eligible sections shows a red warning icon.
- Warning tooltips show only when hovering the icon itself.
- Hovering a section cell highlights eligible clinicians for that section on the same date (desktop only); highlight stays when hovering a pill and is cleared while dragging.

Pills
- Compact blue pill, normal font weight; eligible hover highlight uses green background + green border (no extra thickness).
- Warning icons are small circular badges at top-right of the pill.
- Drag preview uses the normal pill style (highlight removed).

---

## 3) Settings
Sections and Shifts
- Reorder by drag handle to set priority.
- Rename, remove, add.
- Location selector per section (in the section header).
- Sub-shifts per section: 1-3, named, ordered, with editable start/end times and end-day offset (+0–+3 days).
- Time inputs accept HH:MM (24h) and show inline validation (red border) on invalid values.
- Min slots split into weekday vs weekend/holiday per sub-shift.
- Add Section button is full-width with dashed outline at the bottom of the panel.
- Add Shift button is full-width with dashed outline under each section’s shifts.

Locations
- Add, rename, delete (delete blocked while referenced by any section).
- Default location always exists (id: loc-default).
- Toggle in panel header enables/disables locations; when disabled, all sections use Default and location labels are hidden.

Pools
- Rename pool rows (Distribution Pool, Vacation). No deletion.

Clinicians
- List with Add Clinician and Edit buttons (Add uses a dashed, full-width button below the list).
- Editing uses the same modal as clicking a pill in the calendar.
- Optional working hours per week field (contract hours).

Clinician Editor (modal)
- Eligible sections list is ordered. Drag to set priority (this order is also the preference list).
- Add eligible sections via dropdown + Add button; remove via per-row Remove button.
- Vacation management uses compact DD.MM.YYYY inputs with a dash between start and end.
- Past vacations collapsed in a <details>.
- Modal body is scrollable for long vacation lists.

Holidays
- Year selector with stepper buttons.
- Country picker with flag emoji (top EU countries + CH, LU), alphabetical.
- "Load Holidays" fetches from https://date.nager.at/api/v3/PublicHolidays.
- Add holidays manually; list shows DD.MM.YYYY dates (input accepts DD.MM.YYYY or ISO).
- Add Holiday button is a dashed, full-width button below the list and opens an inline add panel.
- Holidays behave like weekends in solver + min slot logic and show in the calendar header.

Admin user management
- User export: admin can download a user state JSON (export includes metadata + AppState).
- User import: create user form accepts an export JSON to seed the new user's state.

iCal (download + subscription feed)
- The Export panel button opens a modal:
  - Primary tabs: **PDF**, **iCal**, **Web**.
  - iCal has a secondary toggle for **Subscription** (default) vs **Download**.
  - Subscriptions include **only weeks marked Published** in the schedule view (week toggle above the grid).

PDF export (server-side, Playwright)
- Print-only routes:
  - `/print/week?start=YYYY-MM-DD`
  - `/print/weeks?start=YYYY-MM-DD&weeks=N` (multiple pages in one PDF)
- Backend endpoints:
  - `GET /v1/pdf/week?start=YYYY-MM-DD` (single week)
  - `GET /v1/pdf/weeks?start=YYYY-MM-DD&weeks=N` (combined PDF)
- PDF render specifics:
  - A4 landscape with background colors.
  - Auto-scale to fit the full table on the page.
  - Open Slots badge, Publish toggle, and Open Slot pills are hidden in PDF.
- The print route sets `window.__PDF_READY__ = true` after data loads + two rAFs; backend waits for that signal.
- Export UI:
  - PDF tab accepts start week + number of weeks (max 55).
  - User can choose **one combined PDF** or **individual files**.
- Env var `FRONTEND_BASE_URL` is used by the backend to reach the frontend for PDF rendering:
  - Domain setup: `https://$DOMAIN`
  - IP-only setup: `http://SERVER_IP`
- Print CSS lives in `src/index.css` (A4 landscape, `print-color-adjust`, overflow visible, no-print elements hidden).

iCal download (frontend-only)
- Supports:
  - "All clinicians" (one `.ics` file containing many events across many dates)
  - Individual clinician `.ics` files
  - A date range filter (Start/End) shown/entered as `DD.MM.YYYY` (empty = all dates)
- Implementation details:
  - Only section assignments are exported (pool rows are ignored).
  - Events are all-day (`DTSTART;VALUE=DATE` / `DTEND;VALUE=DATE` with end = +1 day).
  - Range parsing accepts `DD.MM.YYYY` (and also `YYYY-MM-DD`), swaps Start/End if reversed, and disables download on invalid input.
- Files: `src/lib/ical.ts`, `src/components/schedule/IcalExportModal.tsx`, wiring in `src/pages/WeeklySchedulePage.tsx`.

Subscribable iCal feed (cryptic URL)
- Publication scope is controlled by `publishedWeekStartISOs` in user state:
  - Array of Monday ISO strings (YYYY-MM-DD) for weeks that are released.
  - If empty, the feed is valid but has **zero** events.
- Backend stores tokens in SQLite:
  - `ical_publications` (one token per user, all clinicians).
  - `ical_clinician_publications` (one token per clinician per user).
- Public endpoint (no JWT): `GET /v1/ical/{token}.ics`
  - Returns `text/calendar; charset=utf-8`
  - Only section assignments are included (pool rows ignored)
  - Only weeks listed in `publishedWeekStartISOs` are included
  - Clinician tokens return only that clinician’s assignments
  - Vacation override is applied: assignments are skipped on days where the clinician is on vacation (the UI hides these too, but raw assignments can remain in persisted state).
  - Bug fix: clinician-specific feeds must not reuse/overwrite the `clinician_id` filter variable in `backend/ical.py`; otherwise every link returns the last clinician’s events.

Known issues / fixes
- ICS clinician filter bug: avoid shadowing `clinician_id` in `backend/ical.py` (use a different loop variable for clinicians). Symptom was that every clinician link returned the same clinician’s events.
  - All-day events; UID is stable (`assignment.id@shiftschedule`) so clients update instead of duplicating
  - HTTP caching: sets `ETag` + `Last-Modified` and supports conditional GET (returns 304 when unchanged)
- Authenticated endpoints (JWT required):
  - `GET /v1/ical/publish` (status, includes all + per-clinician URLs when published)
  - `POST /v1/ical/publish` (enable links; keeps existing tokens)
  - `POST /v1/ical/publish/rotate` (new tokens for all + clinicians; old URLs become 404)
  - `DELETE /v1/ical/publish` (unpublish; URL becomes 404)
- Subscription UI behavior:
  - Status is a **Links active** toggle; turning it off unpublishes.
  - **Refresh links** rotates tokens after confirmation.
  - All clinicians link is shown in the same list as individual clinicians.
  - Links are auto-refreshed when the Export modal opens (no separate “Update links” button).
- Subscribe URL base:
  - Backend uses env var `PUBLIC_BASE_URL` if set (recommended for production behind HTTPS). For the domain+Caddy setup in this repo (backend behind `/api`), set `PUBLIC_BASE_URL=https://$DOMAIN/api`.
  - Otherwise it falls back to `request.base_url` (works for local dev).
- Local verification:
  - Publish via UI, then `curl -i "<subscribeUrl>"` should return 200 + calendar data.
  - Re-run with `If-None-Match` or `If-Modified-Since` should return 304 if unchanged.
  - Note: Many real calendar clients (especially Apple Calendar on devices) strongly prefer HTTPS for subscriptions.

Public web view (share link)
- Public route: `/public/:token?start=YYYY-MM-DD` (no login).
- Backend table: `web_publications` (one token per user; rotation invalidates old link).
- Auth endpoints:
  - `GET /v1/web/publish` (status)
  - `POST /v1/web/publish` (enable)
  - `POST /v1/web/publish/rotate` (new token)
  - `DELETE /v1/web/publish` (disable)
- Public data endpoint: `GET /v1/web/{token}/week?start=YYYY-MM-DD`
  - Returns `published:false` if the week is not in `publishedWeekStartISOs`.
  - When published: returns rows, clinicians, assignments (section rows only, within week), min slots, slot overrides, holidays.
  - Vacation override is applied (assignments hidden on vacation days).
  - HTTP caching: `ETag` + `Last-Modified` with conditional 304.
- Export modal → **Web** tab:
  - Links active toggle, refresh link (confirm), copyable public URL.
  - URL uses `${window.location.origin}/public/<token>`.
  - If a week is unpublished, the public page shows “This week is not published yet.” but keeps navigation visible.

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

type Location = {
  id: string;
  name: string;
};

type SubShift = {
  id: string;
  name: string;
  order: 1 | 2 | 3;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  endDayOffset?: number; // 0-3
};

type WorkplaceRow = {
  id: string;
  name: string;
  kind: RowKind;
  dotColorClass: string;
  locationId?: string;
  subShifts?: SubShift[];
};

type VacationRange = { id: string; startISO: string; endISO: string };

type Clinician = {
  id: string;
  name: string;
  qualifiedClassIds: string[];
  preferredClassIds: string[];
  vacations: VacationRange[];
  workingHoursPerWeek?: number;
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

Shift row IDs
- Section assignments use shiftRowId: `${classId}::${subShiftId}` (example: `mri::s1`).
- Pool rows continue using their plain pool IDs.
- UI uses “section”, but internal ids and RowKind still use `class` for compatibility.

---

## 5) Scheduling Logic (Frontend)
- Vacation override: for each date, if clinician is on vacation, they appear in Vacation pool and their section assignment is suppressed.
- Distribution Pool: any clinician not assigned to a section and not on vacation appears here.
- Assignments stored in a map (rowId + dateISO -> list of assignments); section rows use shiftRowId.
- Drag and drop only within the same day.
- Clicking a section sub-shift cell increments the per-day slot override for that shiftRowId (adds an "Open Slot"); remove via the minus badge.

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
- Targets shiftRowIds for section sub-shifts; priority is section order first, then sub-shift order.
- Qualification + preference checks still use the parent class id (not shiftRowId).
- Objective:
  - Prioritize coverage by section order (top of section list is highest).
  - Minimize missing required slots.
  - If `only_fill_required=false`, add extras.
  - Preferred sections (order of eligible sections) is a lower-weight tie breaker.

---

## 7) Backend State + Persistence
Backend stores one JSON blob per user in SQLite:
```json
{
  "locations": [{ "id": "loc-default", "name": "Default" }],
  "locationsEnabled": true,
  "rows": [...],
  "clinicians": [...],
  "assignments": [...],
  "minSlotsByRowId": {...},
  "publishedWeekStartISOs": ["2025-12-22"],
  "holidayCountry": "DE",
  "holidayYear": 2025,
  "holidays": [{ "dateISO": "2025-12-25", "name": "Christmas Day" }]
}
```
State normalization on load
- Ensures `locations` exists (adds loc-default).
- Ensures section rows have `locationId` and `subShifts` (defaults to 08:00–16:00, endDayOffset 0).
- If locations are disabled, section locations are forced to the default location.
- Migrates section assignments + min slots + slot overrides from classId to shiftRowId (`classId::s1`).
Table: `app_state` (id = username). Legacy row id `"state"` is migrated to `"jk"`. The table now also has an `updated_at` column which is bumped on every `POST /v1/state` save.

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
- `GET /v1/ical/publish`
- `POST /v1/ical/publish`
- `POST /v1/ical/publish/rotate`
- `DELETE /v1/ical/publish`
- `GET /v1/ical/{token}.ics` (public, no JWT)

---

## 8) Auth Model (Backend + Frontend)
- JWT auth; frontend stores token in `localStorage` key `authToken`.
- Admin user is created on startup if `ADMIN_USERNAME`/`ADMIN_PASSWORD` are set and the user does not already exist.
- Set `ADMIN_PASSWORD_RESET=true` to force-reset the admin password on startup (useful for local dev DBs).
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
- `src/lib/shiftRows.ts` (shiftRowId helpers + state normalization)

Backend
- `backend/main.py`
- `backend/requirements.txt`
- `backend/schedule.db`

---

## 11) Notes for New Agents
- The calendar is the source of truth for edits; Settings manages section priority + min slots + pool names + clinician list.
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
- SSH user: `root`
- Path: `/opt/shiftschedule`
- Stack: `docker compose -f docker-compose.ip.yml up -d --build`
- Frontend: `http://46.224.114.183`
- Backend: `http://46.224.114.183:8000`
- Data lives in the `backend_data` volume; you can update only the frontend without touching the DB.
- Typical frontend update: rsync repo to `/opt/shiftschedule`, then `docker compose -f docker-compose.ip.yml build frontend` and `up -d frontend`.

### Remote setup checklist (smooth deploy)
- Ensure `/opt/shiftschedule/.env` exists before running compose. If you use `rsync --delete`, exclude `.env` or recreate it after sync.
- Required `.env` values for IP-only setup:
  - `ADMIN_USERNAME=admin`
  - `ADMIN_PASSWORD=change-me`
  - `JWT_SECRET=change-me-too`
  - `JWT_EXPIRE_MINUTES=720` (avoid empty string; backend crashes on startup)
  - `VITE_API_URL=http://46.224.114.183:8000`
  - `PUBLIC_BASE_URL=http://46.224.114.183/api`
  - `APP_ORIGIN=http://46.224.114.183`
- If login fails and you need a forced reset, set `ADMIN_PASSWORD_RESET=true` in `.env` and restart backend, then remove/disable it after login works.
- After changing `VITE_API_URL`, rebuild the frontend container: `docker compose -f docker-compose.ip.yml up -d --build frontend`.
- iCal subscription endpoints require `/api` proxying in the frontend nginx config; otherwise `/api/v1/ical/*.ics` returns HTML and Apple Calendar rejects it.

## 13) Domain Deployment (Caddy + HTTPS)
- Stack: `docker compose up -d --build` (uses `docker-compose.yml` + Caddy).
- `.env` required for domain setup:
  - `DOMAIN=shiftplanner.wunderwerk.ai`
  - `LETSENCRYPT_EMAIL=daniel.truhn@gmail.com`
  - `ADMIN_USERNAME=admin`
  - `ADMIN_PASSWORD=<prod password>`
  - `JWT_SECRET=<prod secret>`
  - `JWT_EXPIRE_MINUTES=720` (avoid empty string)
- Caddy handles TLS + `/api` proxying. Frontend uses `VITE_API_URL=/api` so no extra env needed.
- `PUBLIC_BASE_URL` is set in `docker-compose.yml` as `https://${DOMAIN}/api` (don’t leave it blank).
- If admin login fails after switching stacks, the existing DB user may still have the old password. Reset via:
  - `docker compose exec -T backend python - << 'PY' ...` (update `users` table in `/data/schedule.db`).
