/**
 * E2E tests for pool removal verification.
 *
 * These tests verify that:
 * - Distribution Pool is not rendered in the UI
 * - Reserve Pool is not rendered in the UI
 * - Settings view shows only Rest Day and Vacation pools
 * - Schedule grid has no deprecated pool rows
 */

import { expect, test } from "./fixtures";
import { fetchAuthToken, seedAuthToken } from "./utils/auth";

const API_BASE = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:8000";
const UI_USERNAME = process.env.E2E_USERNAME ?? "testuser";
const UI_PASSWORD = process.env.E2E_PASSWORD ?? "sdjhfl34-wfsdfwsd2";

const toISODate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const startOfWeek = (date: Date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
};

const DAY_TYPES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun", "holiday"] as const;

const getDayTypeForISO = (dateISO: string) => {
  const [year, month, day] = dateISO.split("-").map((value) => Number(value));
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  const idx = date.getUTCDay();
  const byIndex = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
  return byIndex[idx] ?? "mon";
};

/**
 * Build a valid test state WITH deprecated pools included.
 * This simulates loading legacy data that still has deprecated pools.
 */
const buildStateWithDeprecatedPools = (dateISO: string) => {
  const classRows = [
    {
      id: "class-1",
      name: "MRI",
      kind: "class",
      dotColorClass: "bg-slate-200",
      locationId: "loc-default",
      subShifts: [
        { id: "s1", name: "Shift 1", order: 1, startTime: "08:00", endTime: "16:00", endDayOffset: 0 },
      ],
    },
  ];

  // Include deprecated pools in the state (simulating legacy data)
  const rows = [
    ...classRows,
    { id: "pool-not-allocated", name: "Distribution Pool", kind: "pool", dotColorClass: "bg-slate-200" },
    { id: "pool-manual", name: "Reserve Pool", kind: "pool", dotColorClass: "bg-slate-200" },
    { id: "pool-rest-day", name: "Rest Day", kind: "pool", dotColorClass: "bg-slate-200" },
    { id: "pool-vacation", name: "Vacation", kind: "pool", dotColorClass: "bg-emerald-500" },
  ];

  // Include assignments to deprecated pools
  const assignments = [
    { id: "a1", rowId: "pool-not-allocated", dateISO, clinicianId: "clin-1" },
    { id: "a2", rowId: "pool-manual", dateISO, clinicianId: "clin-1" },
  ];

  const blocks = [
    { id: "block-class-1", sectionId: "class-1", requiredSlots: 1 },
  ];

  const colBands = DAY_TYPES.map((dayType, idx) => ({
    id: `col-${dayType}-1`,
    label: "",
    order: 1,
    dayType,
  }));

  const slots = DAY_TYPES.map((dayType) => ({
    id: `class-1::s1__${dayType}`,
    locationId: "loc-default",
    rowBandId: "row-1",
    colBandId: `col-${dayType}-1`,
    blockId: "block-class-1",
    requiredSlots: 1,
    startTime: "08:00",
    endTime: "16:00",
    endDayOffset: 0,
  }));

  return {
    locations: [{ id: "loc-default", name: "Default" }],
    locationsEnabled: true,
    rows,
    clinicians: [
      {
        id: "clin-1",
        name: "Dr. Test",
        qualifiedClassIds: ["class-1"],
        preferredClassIds: [],
        vacations: [],
      },
    ],
    assignments,
    minSlotsByRowId: { "class-1::s1": { weekday: 1, weekend: 1 } },
    slotOverridesByKey: {},
    weeklyTemplate: {
      version: 4,
      blocks,
      locations: [
        {
          locationId: "loc-default",
          rowBands: [{ id: "row-1", label: "Row 1", order: 1 }],
          colBands,
          slots,
        },
      ],
    },
    holidays: [],
    // Include deprecated solver settings
    solverSettings: {
      enforceSameLocationPerDay: false,
      onCallRestEnabled: false,
      allowMultipleShiftsPerDay: true, // DEPRECATED
      showDistributionPool: true, // DEPRECATED
      showReservePool: true, // DEPRECATED
    },
    solverRules: [],
    publishedWeekStartISOs: [],
  };
};

test.describe("Pool Removal - UI Verification", () => {
  test.beforeEach(async ({ page }) => {
    // Clear any existing auth state
    await page.context().clearCookies();
  });

  test("Distribution Pool is not rendered in schedule grid", async ({ page }) => {
    const today = startOfWeek(new Date());
    const dateISO = toISODate(today);

    // Get auth token and seed state with deprecated pools
    const token = await fetchAuthToken(UI_USERNAME, UI_PASSWORD);
    const state = buildStateWithDeprecatedPools(dateISO);

    // Save state via API
    const saveResponse = await fetch(`${API_BASE}/v1/state`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
    });
    expect(saveResponse.ok).toBe(true);

    // Login via UI
    await page.goto("/");
    await page.fill('[data-testid="username-input"]', UI_USERNAME);
    await page.fill('[data-testid="password-input"]', UI_PASSWORD);
    await page.click('[data-testid="login-button"]');
    await page.waitForURL(/\/schedule/);

    // Wait for schedule grid to load
    await page.waitForSelector('[data-testid="schedule-grid"]', { timeout: 10000 });

    // Verify Distribution Pool is not in the DOM
    const distributionPoolRow = await page.$('[data-row-id="pool-not-allocated"]');
    expect(distributionPoolRow).toBeNull();

    // Verify the text "Distribution Pool" is not visible
    const distributionPoolText = await page.locator("text=Distribution Pool").count();
    expect(distributionPoolText).toBe(0);
  });

  test("Reserve Pool is not rendered in schedule grid", async ({ page }) => {
    const today = startOfWeek(new Date());
    const dateISO = toISODate(today);

    const token = await fetchAuthToken(UI_USERNAME, UI_PASSWORD);
    const state = buildStateWithDeprecatedPools(dateISO);

    await fetch(`${API_BASE}/v1/state`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
    });

    await page.goto("/");
    await page.fill('[data-testid="username-input"]', UI_USERNAME);
    await page.fill('[data-testid="password-input"]', UI_PASSWORD);
    await page.click('[data-testid="login-button"]');
    await page.waitForURL(/\/schedule/);
    await page.waitForSelector('[data-testid="schedule-grid"]', { timeout: 10000 });

    // Verify Reserve Pool is not in the DOM
    const reservePoolRow = await page.$('[data-row-id="pool-manual"]');
    expect(reservePoolRow).toBeNull();

    // Verify the text "Reserve Pool" is not visible
    const reservePoolText = await page.locator("text=Reserve Pool").count();
    expect(reservePoolText).toBe(0);
  });

  test("Rest Day and Vacation pools are still visible", async ({ page }) => {
    const today = startOfWeek(new Date());
    const dateISO = toISODate(today);

    const token = await fetchAuthToken(UI_USERNAME, UI_PASSWORD);
    const state = buildStateWithDeprecatedPools(dateISO);

    await fetch(`${API_BASE}/v1/state`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
    });

    await page.goto("/");
    await page.fill('[data-testid="username-input"]', UI_USERNAME);
    await page.fill('[data-testid="password-input"]', UI_PASSWORD);
    await page.click('[data-testid="login-button"]');
    await page.waitForURL(/\/schedule/);
    await page.waitForSelector('[data-testid="schedule-grid"]', { timeout: 10000 });

    // Rest Day pool should be visible
    const restDayText = await page.locator("text=Rest Day").count();
    expect(restDayText).toBeGreaterThan(0);

    // Vacation pool should be visible
    const vacationText = await page.locator("text=Vacation").count();
    expect(vacationText).toBeGreaterThan(0);
  });

  test("deprecated pool assignments are removed on state load", async ({ page }) => {
    const today = startOfWeek(new Date());
    const dateISO = toISODate(today);

    const token = await fetchAuthToken(UI_USERNAME, UI_PASSWORD);
    const state = buildStateWithDeprecatedPools(dateISO);

    // Save state with deprecated pool assignments
    await fetch(`${API_BASE}/v1/state`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
    });

    // Load state and verify assignments are cleaned up
    const loadResponse = await fetch(`${API_BASE}/v1/state`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const loadedState = await loadResponse.json();

    // Check that no assignments reference deprecated pools
    const assignmentRowIds = (loadedState.assignments ?? []).map(
      (a: { rowId: string }) => a.rowId,
    );
    expect(assignmentRowIds).not.toContain("pool-not-allocated");
    expect(assignmentRowIds).not.toContain("pool-manual");
  });

  test("deprecated solver settings are removed on state load", async ({ page }) => {
    const today = startOfWeek(new Date());
    const dateISO = toISODate(today);

    const token = await fetchAuthToken(UI_USERNAME, UI_PASSWORD);
    const state = buildStateWithDeprecatedPools(dateISO);

    // Save state with deprecated solver settings
    await fetch(`${API_BASE}/v1/state`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
    });

    // Load state and verify settings are cleaned up
    const loadResponse = await fetch(`${API_BASE}/v1/state`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const loadedState = await loadResponse.json();

    // Check that deprecated settings are removed
    expect(loadedState.solverSettings).not.toHaveProperty("allowMultipleShiftsPerDay");
    expect(loadedState.solverSettings).not.toHaveProperty("showDistributionPool");
    expect(loadedState.solverSettings).not.toHaveProperty("showReservePool");
  });

  test("deprecated pool rows are removed from state on load", async ({ page }) => {
    const today = startOfWeek(new Date());
    const dateISO = toISODate(today);

    const token = await fetchAuthToken(UI_USERNAME, UI_PASSWORD);
    const state = buildStateWithDeprecatedPools(dateISO);

    // Save state with deprecated pools
    await fetch(`${API_BASE}/v1/state`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(state),
    });

    // Load state and verify pool rows are cleaned up
    const loadResponse = await fetch(`${API_BASE}/v1/state`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const loadedState = await loadResponse.json();

    // Check that deprecated pool rows are removed
    const rowIds = (loadedState.rows ?? []).map((r: { id: string }) => r.id);
    expect(rowIds).not.toContain("pool-not-allocated");
    expect(rowIds).not.toContain("pool-manual");

    // Valid pools should still exist
    expect(rowIds).toContain("pool-rest-day");
    expect(rowIds).toContain("pool-vacation");
  });
});
