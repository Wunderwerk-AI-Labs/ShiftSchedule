# agent.md — Weekly Schedule System (Current State)

This repo is a doctors/clinicians scheduling system with a React frontend and a FastAPI backend + OR-Tools solver. It is local-first and stores state in SQLite via the API.

---

## Quick Start for New Agents
Where to look first
- UI logic + state: `src/pages/WeeklySchedulePage.tsx`
- Grid rendering + drag/drop: `src/components/schedule/ScheduleGrid.tsx`
- Template builder (Settings → Weekly Calendar Template): `src/components/schedule/WeeklyTemplateBuilder.tsx`
- Shared calendar layout helpers (main/public/print): `src/lib/calendarView.ts`
- Slot/template normalization + row building: `src/lib/shiftRows.ts`
- Rendered assignment map + pool logic + overlaps: `src/lib/schedule.ts`
- Backend normalization + persistence: `backend/state.py`, `backend/db.py`
- Solver: `backend/solver.py`
- E2E tests + diagnostics: `e2e/fixtures.ts`, `e2e/app.spec.ts`, `e2e/colband-explosion.spec.ts`
- API client: `src/api/client.ts`
- Settings UI: `src/components/schedule/SettingsView.tsx`

Where to verify behavior
- UI rules, drag/drop, overlaps: `src/components/schedule/ScheduleGrid.tsx`, `src/lib/schedule.ts`
- Template/slot migration: `src/lib/shiftRows.ts` and `backend/state.py`
- Solver constraints: `backend/solver.py`
- Public/published views: `src/pages/PublicWeekPage.tsx`, `backend/web.py`
  - Public + print routes use the same calendar layout helpers as the main view (`src/lib/calendarView.ts`).

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
- Calendar grid should not scroll vertically; it expands and the page scrolls. Horizontal scrolling remains.
- Automated shift planning and Export are separate panels in the schedule view; Export panel opens the same modal as before.
- Vacation Planner panel sits between Automated Shift Planning and Export; it opens the full-screen Vacation Overview.
- Control row between section rows and pool rows with icon buttons:
  - Only necessary, Distribute all, Reset to free (week and per day), with tooltips.
- Week publication uses a **Publish** toggle pill in the header, placed to the right of the Open Slots badge.
- Rule violations badge sits next to Open Slots only when violations exist; click to see details and highlight the related pills (red).

Rows
- Sections are stored as class rows (MRI, CT, Sonography, On Call, etc.) and are selected inside template blocks (no separate section/shift panel).
- Calendar view groups template slots by location + row band (one row per row band with at least one placed slot); row labels show the row label centered with the location name directly beneath it.
- Per day, additional sub-columns appear for day columns that have slots; header shows `Col N` for extra columns, and pool rows render only in the first column per day.
- Pool rows (editable names, not deletable): Rest Day (id: pool-rest-day), Vacation (id: pool-vacation).
- **Deprecated pools (removed)**: Distribution Pool (pool-not-allocated) and Reserve Pool (pool-manual) were removed. State normalization automatically removes these rows and any assignments to them on load.
- Pool rows appear below a separator line.
- Row labels are uppercase, no colored dots, truncate around 20 characters (tighter on mobile).
- Vacation row background stays the same gray even on weekends/holidays.

Cells
- Each active class cell shows a small panel with the section name and time at the top; open slots and assignments render inside that panel.
- Multiple clinician pills per cell, sorted by surname.
- Empty slots shown as gray dashed pills based on the template required count per day type (fallback to legacy min slots); plus/minus badges are gray; label is not bold.
- Drag and drop is same-day only; invalid drops (wrong day or outside the grid) snap back instantly.
- Drag/drop does not block rule-violating placements (same-day location mix, multiple shifts); solver enforces rules but manual overrides are allowed and shown in red. Overlap within the same day is blocked by drag/drop (uses time intervals).
- Drag-to-remove: dragging a clinician pill outside the grid removes the assignment.
- Dragging into or out of Vacation updates the clinician vacation ranges.
- Clinician Picker: clicking an open slot shows a popover with eligible clinicians; warnings show "Already in slot" (priority) or "Not qualified".
- Eligible target cells for a dragged clinician use a pale green background (consistent with the green "Open Slots" badge when count is 0).
- Ineligible manual assignment is allowed, with a yellow warning icon.
- No eligible sections shows a red warning icon.
- Warning tooltips show only when hovering the icon itself.
- Hovering a section cell highlights eligible clinicians for that section on the same date (desktop only); highlight stays when hovering a pill and is cleared while dragging.

Pills
- Compact blue pill, normal font weight; eligible hover highlight uses green background + green border (no extra thickness).
- Name abbreviation: if a clinician's name doesn't fit, it is progressively abbreviated ("First Last" → "F. Last" → "F. L." → "FL"); full name shown on hover. Disambiguates when siblings would collide (e.g., "Da. Truhn" vs "D. Turner").
- Warning icons are small circular badges at top-right of the pill.
- Drag preview uses the normal pill style (highlight removed).
- Assignment pills show only the name; time is shown in the section block header or the column header (when consistent).
- Distribution Pool pills show only the remaining free time segments.
- Rule-violation pills render in red automatically.
- While dragging a clinician, all other pills for the same clinician on the same day turn darker blue with a black outline; the dragged pill uses the same style.
- Smoke test (API): `API_BASE=http://127.0.0.1:8000 ADMIN_USERNAME=admin ADMIN_PASSWORD=<pass> node scripts/smoke-api.mjs`

---

## 3) Settings
Section Blocks (Weekly Calendar Template)
- Section blocks are just section names; time, end-day offset, and required slots are set per placed slot in the grid.
- Add block by name; delete via the small x in the block list (no clone/gear).
- Drag blocks into the grid or click an empty cell to add; placed blocks can be dragged to move.
- Empty grid cells show "Drop a block or click to add a block."
- Multiple shifts are represented by multiple blocks (no sub-shift editor).

Weekly Calendar Template
- Single calendar with locations stacked; day-type columns are shared across locations (Mon..Sun + Holiday).
- Per-day columns: add columns for a specific day; delete via a hover-only "Delete Column" button at the top of the first row (confirm only if the column has slots; column outlines red on hover/confirm).
- Row bands are simple rows with an editable row label in the left header cell; Add row is a full-width dashed button below each location; row delete confirms only if the row has slots.
- Section blocks sidebar stays visible while scrolling the template grid (sticky at all sizes; scrolls with the template grid container).
- Blocks live in `weeklyTemplate.blocks` and slots reference `blockId`.
- Slots define time range, end-day offset, and required slots (single value); blocks carry only the section reference.
- Holiday day type always overrides weekdays at runtime (no fallback).
- Settings views that use section dropdowns (solver on-call rest, clinician eligible sections) are filtered to sections that exist as current template blocks.
- Copy Day: button in template builder copies all columns and slots from one day type to another; requires confirmation checkbox if target has existing content.

Locations
- Manage locations inside the calendar template (top-left "+ Location" button).
- Location order uses a dropdown; names are edited inline.
- Delete location (confirm) is allowed even for the default location; the next location becomes the new default (`loc-default`) and slot locationIds are updated.

Pools
- Rename pool rows (Distribution Pool, Reserve Pool, Rest Day, Vacation). No deletion.
- Rest Day pool is used to park clinicians before/after on-call duty when the setting is enabled.
- Pool visibility is a UI filter only: class assignments are never hidden by rest-day/vacation logic.
- If a clinician is marked off on a date, any pool assignment for that date is re-routed to the Rest Day pool in the UI (so they stay visible).

Slots / Template integrity
- Invalid slot assignments are repaired on load:
  - If a slot references a block/section that no longer exists or the slot dayType does not match the assignment date's dayType, the assignment is moved to the Distribution Pool.
  - This is enforced in both frontend normalization (`src/lib/shiftRows.ts`) and backend normalization (`backend/state.py`).
- ColBand explosion safeguard: max 50 colBands per day type (MAX_COLBANDS_PER_DAY). If exceeded, extra colBands are blocked and logged. Safeguard is enforced in:
  - `src/lib/shiftRows.ts` (normalizeTemplateColBands)
  - `src/components/schedule/WeeklyTemplateBuilder.tsx` (sanitizeLocations)
  - `src/pages/WeeklySchedulePage.tsx` (setWeeklyTemplate wrapper blocks saves over 500 total colBands)

Clinicians
- List with Add Clinician and Edit buttons (Add uses a dashed, full-width button below the list).
- Editing uses the same modal as clicking a pill in the calendar.
- Optional working hours per week field (contract hours).

Clinician Editor (modal)
- Panel order: Eligible Sections → Vacations → Preferred Working Times.
- Eligible sections list is ordered. Drag to set priority (this order is also the preference list).
- Add eligible sections via dropdown + Add button; remove via per-row Remove button.
- Vacation management uses compact DD.MM.YYYY inputs with a dash between start and end.
- Past vacations collapsed in a <details>.
- Modal body is scrollable for long vacation lists.
- Preferred working times persist per clinician as `preferredWorkingTimes` (mon..sun with startTime/endTime + requirement none/preference/mandatory).
- Mandatory windows are hard solver constraints; preference windows add a small solver reward.
- Week solver nudges total assigned minutes toward `workingHoursPerWeek` within the tolerance (manual assignments count toward totals).

Holidays
- Year selector with stepper buttons.
- Country picker with flag emoji (top EU countries + CH, LU), alphabetical.
- "Load Holidays" fetches from https://date.nager.at/api/v3/PublicHolidays.
- Add holidays manually; list shows DD.MM.YYYY dates (input accepts DD.MM.YYYY or ISO).
- Add Holiday button is a dashed, full-width button below the list and opens an inline add panel.
- Holidays behave like weekends in solver + min slot logic and show in the calendar header.

Solver Settings
- Toggle: Enforce same location per day.
- Multiple shifts per day are always allowed (removed setting); only actual time overlaps are blocked.
- On-call rest days: toggle + section selector + days before/after. When enabled, solver enforces rest days and the UI places clinicians into the Rest Day pool.
- On-call rest days dropdown only shows sections that exist as current template section blocks.
- Working hours tolerance (hours) is stored as `solverSettings.workingHoursToleranceHours` (default 5).
- Rule violations are evaluated for the current week and surfaced in the header badge; affected pills are shown in red.
- Violations include: rest-day conflicts, same-day location mismatches (when enforced), and overlapping shift times.
- Automated planning runs the week solver over the selected date range in one call and shows an ETA based on the last run's per-day duration.

Testing
- Frontend unit/component tests: Vitest + Testing Library (`npm run test` runs `src/**/*.test.{ts,tsx}` only).
- Backend tests: pytest (dev deps in `backend/requirements-dev.txt`), run `python3 -m pytest backend/tests`.
- E2E tests: Playwright specs in `e2e/` (`npm run test:e2e`).
  - Uses API login and seeds `localStorage.authToken`.
  - Resets state before each test and restores original state after the suite.
  - Env: `E2E_USERNAME`, `E2E_PASSWORD`, `PLAYWRIGHT_API_URL`, `PLAYWRIGHT_BASE_URL`.
  - Defaults to `testuser` / `sdjhfl34-wfsdfwsd2` when `E2E_USERNAME`/`E2E_PASSWORD` are unset.
  - `test:e2e` script includes `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64` for Apple Silicon.
  - Default non-admin test user for local E2E: `testuser` / `sdjhfl34-wfsdfwsd2` (set `ENABLE_E2E_TEST_USER=0` to disable creation, do not use in production).
  - In sandboxed runs, Playwright may need escalated permissions to access `localhost:8000` and launch Chromium (otherwise EPERM/permission-denied errors).
  - Diagnostics on failure: console, page errors, failed requests, >=400 responses, screenshot, HTML snapshot, and trace (see `e2e/fixtures.ts`).
  - PDF export test calls `/v1/pdf/week` and asserts the generated PDF has exactly one page.
  - Print layout test opens `/print/week` in print media and asserts the scaled schedule fits within one A4 page (portrait or landscape) and fills at least 70% of one dimension.
  - ColBand explosion tests (`e2e/colband-explosion.spec.ts`): verify colBand counts stay stable through settings, Copy Day, column operations, and solver runs; checks for console explosion errors.

Dev server restart
- Kill existing servers via `lsof -nP -iTCP:8000 -sTCP:LISTEN` and `lsof -nP -iTCP:5173 -sTCP:LISTEN`, then `kill <pid>`.
- Start backend: `python3 -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000 > logs/dev-backend.log 2>&1 &`
- Start frontend: `npm run dev -- --host 127.0.0.1 --port 5173 > logs/dev-frontend.log 2>&1 &`
- In this sandbox, use `setopt NO_BG_NICE` when starting background jobs to avoid `nice(5) failed` errors.
- Health checks from within the sandbox can fail with “Operation not permitted”; verify from the browser instead.
- Reason: background jobs may be auto-niced; the sandbox blocks `nice(5)`, so disable background niceness before launching servers.

Vacation Overview
- Open via the Vacation Planner panel in the main schedule view.
- Full-screen year grid: clinicians as rows, day numbers across the year, month headers span their days.
- Grey bar per clinician; green segments for vacation ranges (clipped to the selected year).
- A thin vertical Today marker appears only when viewing the current year.
- Multi-year timeline: year row stays visible and updates as you scroll; there is a "Today" jump button.
- Clicking a clinician row opens the Clinician Editor modal scrolled to vacations.

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
- Print pages (`src/pages/PrintWeekPage.tsx`, `src/pages/PrintWeeksPage.tsx`) scale the full schedule table to fit one A4 landscape page using a fixed 6mm margin + safety factor; multi-week export waits for each page layout before `__PDF_READY__`.
- Backend endpoints:
  - `GET /v1/pdf/week?start=YYYY-MM-DD` (single week)
  - `GET /v1/pdf/weeks?start=YYYY-MM-DD&weeks=N` (combined PDF)
- PDF render specifics:
  - Always A4 landscape with background colors.
  - Content is top-aligned and horizontally centered within the printable area.
  - Auto-scale to fit the full table on the page (never scales up above 1x).
  - Margins are 6mm on all sides.
  - Multi-week export uses the max width/height across all `.print-page` grids.
  - Open Slots badge, Publish toggle, and Open Slot pills are hidden in PDF.
- The print route sets `window.__PDF_READY__ = true` after data loads + two rAFs; backend waits for that signal.
- Export UI:
  - PDF tab accepts start week + number of weeks (max 55).
  - User can choose **one combined PDF** or **individual files**.
- Env var `FRONTEND_BASE_URL` is used by the backend to reach the frontend for PDF rendering:
  - Domain setup: `https://$DOMAIN`
  - IP-only setup: `http://SERVER_IP`
- Print CSS lives in `src/index.css` (`print-color-adjust`, overflow visible, no-print elements hidden).

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

Slot override key parsing
- `slotOverridesByKey` keys are `slotId__dateISO` (e.g., `slot-1__2026-01-05`).
- Backend validates date portion; malformed keys with day types instead of dates (e.g., `slot-1__mon`) are skipped.

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

type DayType = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun" | "holiday";

type TemplateRowBand = {
  id: string;
  order: number;
  label?: string;
};

type TemplateColBand = { id: string; label?: string; order: number; dayType: DayType };

type TemplateBlock = {
  id: string;
  sectionId: string;
  label?: string;
  requiredSlots: number; // legacy; slots carry requiredSlots
};

type TemplateSlot = {
  id: string; // used as Assignment.rowId
  locationId: string;
  rowBandId: string;
  colBandId: string;
  blockId: string;
  requiredSlots?: number;
  startTime?: string;
  endTime?: string;
  endDayOffset?: number;
};

type WeeklyTemplateLocation = {
  locationId: string;
  rowBands: TemplateRowBand[];
  colBands: TemplateColBand[];
  slots: TemplateSlot[];
};

type WeeklyCalendarTemplate = {
  version: 4;
  blocks: TemplateBlock[];
  locations: WeeklyTemplateLocation[];
};

type Holiday = { dateISO: string; name: string };

type SolverSettings = {
  enforceSameLocationPerDay: boolean;
  onCallRestEnabled: boolean;
  onCallRestClassId?: string;
  onCallRestDaysBefore: number;
  onCallRestDaysAfter: number;
  workingHoursToleranceHours?: number;
};
```

Slot IDs
- Section assignments use TemplateSlot ids (Assignment.rowId = TemplateSlot.id); pool rows continue using their plain pool IDs.
- Default template generation uses legacy shiftRowId values (`classId::subShiftId`, e.g. `mri::s1`) for slot ids so existing assignments survive.
- UI uses “section”, but internal ids and RowKind still use `class` for compatibility.

---

## 5) Scheduling Logic (Frontend)
- Vacation override: for each date, if clinician is on vacation, they appear in Vacation pool and their section assignment is suppressed.
- Multiple shifts per day are always allowed; time overlap detection prevents assigning the same clinician to overlapping shift intervals.
- Rest Day Pool (pool-rest-day): if on-call rest days are enabled, clinicians assigned to the on-call section are placed into Rest Day on the configured days before/after (fallback to Reserve if Rest Day is missing).
- Assignments stored in a map (rowId + dateISO -> list of assignments); section rows use template slot ids.
- Drag and drop only within the same day; manual overrides are allowed even if they violate solver rules.
- Clicking a section slot cell increments the per-day slot override for that slot id (adds an "Open Slot"); remove via the minus badge.
- Day type is `holiday` if the date is in holidays; otherwise it is the weekday. Holiday settings always override weekday settings.
- Overlap checks use time intervals (start/end + endDayOffset); shift order is not used for overlap decisions. These checks feed solver constraints and UI violation detection.
- Drag/drop also prevents placing a clinician into overlapping time slots on the same day.

---

## 6) Solver (Backend, OR-Tools)
Endpoints:
- `POST /v1/solve` (single day)
- `POST /v1/solve/week` (range solver; accepts `startISO` and optional `endISO`)
Payloads:
```json
{ "dateISO": "YYYY-MM-DD", "only_fill_required": true|false }
```
```json
{ "startISO": "YYYY-MM-DD", "only_fill_required": true|false }
```

Behavior
- Day solver (`/v1/solve`) uses only clinicians in Distribution Pool (unassigned + not on vacation).
- Week solver (`/v1/solve/week`) considers all clinicians not on vacation; manual assignments are treated as fixed.
- Range solves include a 1-day context window on both ends for rest-day constraints; rest rules only enforce inside the selected range and emit a warning note if boundary days are already assigned.
- Hard constraints:
  - Qualification required.
  - Vacation overrides assignment.
  - Manual assignments remain in place; solver adds additional assignments as needed.
  - Overlap checks use time intervals (start/end + endDayOffset), not shift order.
  - Multiple shifts per day are allowed as long as they don't overlap in time.
  - "Enforce same location per day" blocks mixing locations on the same day.
  - On-call rest days: if enabled, clinicians assigned to the selected on-call section must be unassigned on the configured days before/after.
- Targets template slot ids; order weights follow location order + row band order + column band order.
- Qualification + preference checks use slot.sectionId (the parent section).
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
  "solverSettings": {
    "enforceSameLocationPerDay": false,
    "onCallRestEnabled": false,
    "onCallRestClassId": "on-call",
    "onCallRestDaysBefore": 1,
    "onCallRestDaysAfter": 1,
    "workingHoursToleranceHours": 5
  },
  "solverRules": [],
  "publishedWeekStartISOs": ["2025-12-22"],
  "holidayCountry": "DE",
  "holidayYear": 2025,
  "holidays": [{ "dateISO": "2025-12-25", "name": "Christmas Day" }]
}
```
Note: `solverRules` is legacy and not used by the current UI/solver, but remains in state for compatibility.
`weeklyTemplate` (v4) is stored alongside the state and is the source of truth for schedule rows; `slotOverridesByKey` keys are `slotId__dateISO`.
State normalization on load
- Ensures `locations` exists (adds loc-default).
- Ensures section rows have `locationId` and `subShifts` (defaults to 08:00–16:00, endDayOffset 0).
- `locationsEnabled` is legacy; if false in older data, normalization forces default location usage and sets it back to true.
- Generates/normalizes `weeklyTemplate` v4; if missing, builds a default template from sections + sub-shifts (slot ids use legacy shiftRowIds).
- Filters assignments + slot overrides to existing template slot ids (and pool rows).
- Template slot assignment ids (e.g. `slot-1`) are preserved during normalization in both frontend and backend.
- Ensures `solverSettings` defaults, clamps on-call rest day values, and fixes invalid on-call class ids.
- Ensures the Rest Day pool exists (pool-rest-day), inserted after Reserve Pool.
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
- `POST /v1/solve/week`
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

Codex CLI sandbox note (local dev)
- You may see `operation not permitted` when binding to ports (8000/5173) if the sandbox disallows it.
- Fix: rerun the start commands with escalated permissions, or use a Python `subprocess.Popen(..., start_new_session=True)` wrapper to launch in the background.
- Also avoid `nohup` in this environment; it can trigger permission errors.

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
- If backend logs show a validation error for `solverSettings` fields, restart the backend so the updated models load.
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
- `src/components/schedule/WeeklyTemplateBuilder.tsx` (template grid, Copy Day, colBand safeguards)
- `src/components/schedule/ClinicianPickerPopover.tsx` (open slot click → clinician selection)
- `src/components/schedule/RowLabel.tsx`
- `src/components/schedule/AssignmentPill.tsx`
- `src/components/schedule/VacationOverviewModal.tsx`
- `src/api/client.ts`
- `src/lib/shiftRows.ts` (weeklyTemplate normalization, colBand safeguards, legacy shiftRowId helpers)
- `src/lib/schedule.ts` (rendered assignment map, time intervals, Rest Day pool logic)

Backend
- `backend/main.py` (app setup + router wiring)
- `backend/models.py` (Pydantic models)
- `backend/constants.py` (shared constants)
- `backend/db.py` (SQLite schema + connection helpers)
- `backend/state.py` (state normalization, defaults, persistence)
- `backend/auth.py` (JWT auth + admin endpoints)
- `backend/web.py` (public web publish endpoints)
- `backend/pdf.py` (PDF export endpoints)
- `backend/ical_routes.py` (iCal endpoints)
- `backend/publication.py` (tokens + caching helpers)
- `backend/solver.py` (solver endpoint + logic)
- `backend/state_routes.py` (health + state endpoints)
- `backend/requirements.txt`
- `backend/schedule.db`

---

## 11) Notes for New Agents
- The calendar is the source of truth for edits; Settings manages section priority + min slots + pool names + clinician list.
- Pool ids: Distribution Pool = `pool-not-allocated`, Reserve Pool = `pool-manual`, Rest Day = `pool-rest-day`, Vacation = `pool-vacation`.
- Keep drag restricted to same day; manual overrides are allowed even if they violate solver rules.
- Mobile single-day view uses `useMediaQuery("(max-width: 640px)")` with `displayDays`; week-level calculations still use `fullWeekDays`.
- `ScheduleGrid` supports variable day counts (dynamic `gridTemplateColumns`, last column determined by index).
- Hover highlighting is desktop-only (no hover on mobile) and uses `AssignmentPill` `isHighlighted`.
- HTML5 drag-and-drop does not work on mobile; touch DnD would require a new library or alternate UX.
- If you change the solver API, update `src/api/client.ts` and `WeeklySchedulePage.tsx`.
- Legacy row id `pool-not-working` is filtered out on load.

---

## 12) Current Hetzner Deployment (Domain, default)
- Server IP: `46.224.114.183`
- SSH user: `root`
- Path: `/opt/shiftschedule`
- Stack: `docker compose up -d --build` (uses `docker-compose.yml` + Caddy).
- Frontend: `https://shiftplanner.wunderwerk.ai`
- Backend: `https://shiftplanner.wunderwerk.ai/api`
- Data lives in the `backend_data` volume; you can update only the frontend without touching the DB.
- Typical frontend update: rsync repo to `/opt/shiftschedule`, then `docker compose build frontend` and `up -d frontend`.

### Remote setup checklist (smooth deploy)
- Ensure `/opt/shiftschedule/.env` exists before running compose. If you use `rsync --delete`, exclude `.env` or recreate it after sync.
- Required `.env` values for domain setup:
  - `DOMAIN=shiftplanner.wunderwerk.ai`
  - `LETSENCRYPT_EMAIL=daniel.truhn@gmail.com`
  - `ADMIN_USERNAME=admin`
  - `ADMIN_PASSWORD=change-me`
  - `JWT_SECRET=change-me-too`
  - `JWT_EXPIRE_MINUTES=720` (avoid empty string; backend crashes on startup)
- `PUBLIC_BASE_URL` is set in `docker-compose.yml` as `https://${DOMAIN}/api` (don’t leave it blank).
- If login fails and you need a forced reset, set `ADMIN_PASSWORD_RESET=true` in `.env` and restart backend, then remove/disable it after login works.
- iCal subscription endpoints require `/api` proxying in the frontend nginx config; otherwise `/api/v1/ical/*.ics` returns HTML and Apple Calendar rejects it.
- Domain stack uses Caddy on ports 80/443; stop the IP-only stack first to avoid port conflicts.
- After deploy, always verify:
  - `curl -s -o /dev/null -w "%{http_code}" https://shiftplanner.wunderwerk.ai` (expect 200)
  - `curl -s -o /dev/null -w "%{http_code}" https://shiftplanner.wunderwerk.ai/api/health` (expect 200)
- Before deploy, run `npm run build` locally to catch TypeScript build errors that unit/E2E tests may not cover.

## 13) IP-only Deployment (optional)
- Stack: `docker compose -f docker-compose.ip.yml up -d --build`
- Frontend: `http://46.224.114.183`
- Backend: `http://46.224.114.183:8000`
- IP-only stack binds port 80 directly; it conflicts with Caddy, so only run one stack at a time.
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
