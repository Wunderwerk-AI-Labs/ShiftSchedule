import { test, expect } from "@playwright/test";

/**
 * Full Workflow E2E Test - BIG HOSPITAL
 *
 * This test simulates a large university radiology department:
 * 1. Logs in as admin
 * 2. Deletes the test user if it exists
 * 3. Creates a new test user
 * 4. Logs in as the test user via API
 * 5. Sets up a complex radiology schedule via API:
 *    - 3 locations (Main Hospital, Outpatient Center, Emergency)
 *    - 15 sections with modality+anatomy combinations:
 *      * MRI: Neuro, MSK, Abdomen, Cardiac (4)
 *      * CT: Neuro, Thorax, Abdomen, Trauma (4)
 *      * Sono: Abdomen, Vascular, MSK (3)
 *      * X-Ray: Chest, MSK, Fluoroscopy (3)
 *      * On-Call (1)
 *    - 3 time slots per day (08-12, 12-16, 16-20)
 *    - ~50 slots per weekday across all locations
 *    - Realistic vacation schedules for 10 physicians
 * 6. Creates 40 physicians with varying eligibilities:
 *    - 10 senior radiologists (all sections)
 *    - 10 MRI & CT specialists
 *    - 10 Sono & X-Ray specialists
 *    - 10 Emergency/On-Call specialists
 * 7. Runs automated allocation for 1 week and 4 weeks
 * 8. Takes screenshots at each step
 *
 * Shift structure (non-overlapping 8-20, allowing multiple shifts per day):
 * - Column 1 (Early): 08:00-12:00
 * - Column 2 (Midday): 12:00-16:00
 * - Column 3 (Late): 16:00-20:00
 */

const API_BASE = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:8000";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "tE7vcYMzC7ycXXV234s";
const TEST_USER = "Test";
const TEST_PASSWORD = "Test";

// Helper to attach a screenshot
async function attachScreenshot(
  page: import("@playwright/test").Page,
  testInfo: import("@playwright/test").TestInfo,
  name: string,
) {
  const buffer = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body: buffer, contentType: "image/png" });
}

// Helper to login via UI
async function loginViaUI(
  page: import("@playwright/test").Page,
  username: string,
  password: string,
) {
  await page.goto("/");
  await page.waitForSelector("#login-username", { timeout: 10000 });
  await page.fill("#login-username", username);
  await page.fill("#login-password", password);
  await page.click('button[type="submit"]');
  // Wait for the main app to load
  await page.waitForSelector('[data-schedule-grid="true"]', { timeout: 15000 });
}

// Helper to logout
async function logout(page: import("@playwright/test").Page) {
  // Click on user avatar to show dropdown
  const avatar = page.locator('[data-user-menu-trigger="true"]');
  if ((await avatar.count()) > 0) {
    await avatar.click();
    await page.click("text=Log out");
    await page.waitForSelector("#login-username", { timeout: 10000 });
  }
}

// Generate the complete application state with 20 radiologists and comprehensive template
function generateRadiologyState() {
  // Define locations - Large University Hospital
  const locations = [
    { id: "loc-main", name: "Main Building" },
    { id: "loc-outpatient", name: "Outpatient Center" },
    { id: "loc-emergency", name: "Emergency Department" },
  ];

  // Define modalities with anatomical subspecialties
  // This creates a realistic large radiology department with ~50 shifts per day
  const modalityDefinitions = [
    {
      modality: "MRI",
      color: "bg-blue-400",
      locationId: "loc-main",
      anatomies: [
        { id: "neuro", name: "Neuro", abbrev: "Neuro" },
        { id: "msk", name: "MSK", abbrev: "MSK" },
        { id: "abd", name: "Abdomen", abbrev: "Abd" },
        { id: "cardio", name: "Cardiac", abbrev: "Card" },
      ],
    },
    {
      modality: "CT",
      color: "bg-green-400",
      locationId: "loc-main",
      anatomies: [
        { id: "neuro", name: "Neuro", abbrev: "Neuro" },
        { id: "thorax", name: "Thorax", abbrev: "Thor" },
        { id: "abd", name: "Abdomen", abbrev: "Abd" },
        { id: "trauma", name: "Trauma", abbrev: "Trau" },
      ],
    },
    {
      modality: "Sono",
      color: "bg-purple-400",
      locationId: "loc-outpatient",
      anatomies: [
        { id: "abd", name: "Abdomen", abbrev: "Abd" },
        { id: "vascular", name: "Vascular", abbrev: "Vasc" },
        { id: "msk", name: "MSK", abbrev: "MSK" },
      ],
    },
    {
      modality: "XR",
      color: "bg-yellow-400",
      locationId: "loc-outpatient",
      anatomies: [
        { id: "chest", name: "Chest", abbrev: "Chest" },
        { id: "msk", name: "MSK", abbrev: "MSK" },
        { id: "fluoro", name: "Fluoroscopy", abbrev: "Fluoro" },
      ],
    },
  ];

  // Build rows (sections) from modality + anatomy combinations
  const rows: Array<{
    id: string;
    name: string;
    kind: "pool" | "class";
    dotColorClass: string;
    locationId?: string;
    subShifts?: Array<{
      id: string;
      name: string;
      order: number;
      startTime: string;
      endTime: string;
      endDayOffset: number;
    }>;
  }> = [
    {
      id: "pool-rest-day",
      name: "Rest Day",
      kind: "pool" as const,
      dotColorClass: "bg-slate-200",
    },
    {
      id: "pool-vacation",
      name: "Vacation",
      kind: "pool" as const,
      dotColorClass: "bg-amber-200",
    },
  ];

  // Generate class rows for each modality+anatomy combination
  modalityDefinitions.forEach((mod) => {
    mod.anatomies.forEach((anat) => {
      rows.push({
        id: `class-${mod.modality.toLowerCase()}-${anat.id}`,
        name: `${mod.modality} ${anat.name}`,
        kind: "class" as const,
        dotColorClass: mod.color,
        locationId: mod.locationId,
        subShifts: [
          {
            id: `${mod.modality.toLowerCase()}-${anat.id}-morning`,
            name: "Morning",
            order: 1,
            startTime: "07:00",
            endTime: "14:00",
            endDayOffset: 0,
          },
          {
            id: `${mod.modality.toLowerCase()}-${anat.id}-afternoon`,
            name: "Afternoon",
            order: 2,
            startTime: "14:00",
            endTime: "21:00",
            endDayOffset: 0,
          },
        ],
      });
    });
  });

  // Add On-Call section
  rows.push({
    id: "class-oncall",
    name: "On-Call",
    kind: "class" as const,
    dotColorClass: "bg-red-400",
    locationId: "loc-emergency",
    subShifts: [
      {
        id: "oncall-day",
        name: "Day On-Call",
        order: 1,
        startTime: "08:00",
        endTime: "20:00",
        endDayOffset: 0,
      },
      {
        id: "oncall-night",
        name: "Night On-Call",
        order: 2,
        startTime: "20:00",
        endTime: "08:00",
        endDayOffset: 1,
      },
    ],
  });

  // Get all class IDs for qualification assignment
  const allClassIds = rows.filter((r) => r.kind === "class").map((r) => r.id);
  const mriClassIds = allClassIds.filter((id) => id.startsWith("class-mri"));
  const ctClassIds = allClassIds.filter((id) => id.startsWith("class-ct"));
  const sonoClassIds = allClassIds.filter((id) => id.startsWith("class-sono"));
  const xrClassIds = allClassIds.filter((id) => id.startsWith("class-xr"));

  // Define 40 radiologists for the big hospital with varying qualifications
  const physicianNames = [
    // Senior radiologists (0-9) - all sections
    "Anna Schmidt",
    "Bernd Mueller",
    "Clara Weber",
    "David Fischer",
    "Elena Wagner",
    "Frank Becker",
    "Greta Hoffmann",
    "Hans Schneider",
    "Iris Koch",
    "Johann Richter",
    // MRI & CT specialists (10-19)
    "Katharina Wolf",
    "Lars Zimmermann",
    "Maria Braun",
    "Niklas Hartmann",
    "Olivia Kraus",
    "Peter Lange",
    "Quirin Schulz",
    "Rita Meyer",
    "Stefan Werner",
    "Tanja Fuchs",
    // Sono & X-Ray specialists (20-29)
    "Ulrike Neumann",
    "Viktor Baumann",
    "Wiebke Krause",
    "Xaver Schulze",
    "Yvonne Huber",
    "Zacharias Otto",
    "Amelie Schwarz",
    "Benjamin Keller",
    "Carla Vogt",
    "Dennis Winter",
    // Emergency/On-Call specialists (30-39)
    "Eva Sommer",
    "Florian Haas",
    "Gabriele Vogel",
    "Heinrich Schreiber",
    "Ingrid Berger",
    "Jakob Lorenz",
    "Kira Stein",
    "Lukas Engel",
    "Michaela Frank",
    "Norbert Kaiser",
  ];

  // Helper to generate vacation dates relative to today
  const today = new Date();
  const addDays = (date: Date, days: number) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result.toISOString().split("T")[0];
  };

  // Assign qualifications based on groups:
  // 0-9: All sections (senior radiologists) - qualified for everything
  // 10-19: MRI & CT specialists
  // 20-29: Sono & X-Ray specialists
  // 30-39: On-Call + CT Trauma specialists (emergency)
  const clinicians = physicianNames.map((name, i) => {
    let qualifiedClassIds: string[];
    if (i < 10) {
      // Senior radiologists - all sections
      qualifiedClassIds = [...allClassIds];
    } else if (i < 20) {
      // MRI & CT specialists
      qualifiedClassIds = [...mriClassIds, ...ctClassIds];
    } else if (i < 30) {
      // Sono & X-Ray specialists
      qualifiedClassIds = [...sonoClassIds, ...xrClassIds];
    } else {
      // Emergency/On-Call specialists - CT Trauma + On-Call + some versatility
      qualifiedClassIds = [
        "class-oncall",
        "class-ct-trauma",
        "class-ct-abd",
        ...xrClassIds,
      ];
    }

    // Add realistic vacation schedules for some clinicians (spread across groups)
    const vacations: Array<{ id: string; startISO: string; endISO: string }> =
      [];

    // Senior radiologists vacations
    // Anna Schmidt (0): 2-week vacation starting next week
    if (i === 0) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 7),
        endISO: addDays(today, 21),
      });
    }
    // Clara Weber (2): Long weekend this week
    if (i === 2) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 4),
        endISO: addDays(today, 6),
      });
    }
    // Frank Becker (5): 1 week vacation in 2 weeks
    if (i === 5) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 14),
        endISO: addDays(today, 21),
      });
    }

    // MRI & CT specialists vacations
    // Katharina Wolf (10): Single day off tomorrow
    if (i === 10) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 1),
        endISO: addDays(today, 1),
      });
    }
    // Maria Braun (12): 3-week summer vacation starting in 3 weeks
    if (i === 12) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 21),
        endISO: addDays(today, 42),
      });
    }
    // Olivia Kraus (14): Conference next week (3 days)
    if (i === 14) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 7),
        endISO: addDays(today, 9),
      });
    }

    // Sono & X-Ray specialists vacations
    // Wiebke Krause (22): Holiday break in 4 weeks
    if (i === 22) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 28),
        endISO: addDays(today, 35),
      });
    }
    // Amelie Schwarz (26): 1 week next month
    if (i === 26) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 30),
        endISO: addDays(today, 37),
      });
    }

    // Emergency specialists vacations
    // Florian Haas (31): Weekend off
    if (i === 31) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 5),
        endISO: addDays(today, 6),
      });
    }
    // Kira Stein (36): 2 weeks in 2 weeks
    if (i === 36) {
      vacations.push({
        id: `vac-${i}-1`,
        startISO: addDays(today, 14),
        endISO: addDays(today, 28),
      });
    }

    return {
      id: `clin-${i + 1}`,
      name,
      qualifiedClassIds,
      preferredClassIds: qualifiedClassIds.slice(0, 1), // Prefer first qualification
      vacations,
      workingHoursPerWeek: 40,
    };
  });

  // Build weekly template with 3 columns per day and non-overlapping shifts
  const dayTypes = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

  // Template blocks for each modality+anatomy section
  // MRI blocks (blue shades)
  const mriBlocks = [
    { id: "block-mri-neuro", sectionId: "class-mri-neuro", label: "MRI Neuro", color: "#93C5FD" },
    { id: "block-mri-msk", sectionId: "class-mri-msk", label: "MRI MSK", color: "#60A5FA" },
    { id: "block-mri-abd", sectionId: "class-mri-abd", label: "MRI Abd", color: "#3B82F6" },
    { id: "block-mri-cardio", sectionId: "class-mri-cardio", label: "MRI Card", color: "#2563EB" },
  ];

  // CT blocks (green shades)
  const ctBlocks = [
    { id: "block-ct-neuro", sectionId: "class-ct-neuro", label: "CT Neuro", color: "#86EFAC" },
    { id: "block-ct-thorax", sectionId: "class-ct-thorax", label: "CT Thor", color: "#4ADE80" },
    { id: "block-ct-abd", sectionId: "class-ct-abd", label: "CT Abd", color: "#22C55E" },
    { id: "block-ct-trauma", sectionId: "class-ct-trauma", label: "CT Trau", color: "#16A34A" },
  ];

  // Sono blocks (purple shades)
  const sonoBlocks = [
    { id: "block-sono-abd", sectionId: "class-sono-abd", label: "Sono Abd", color: "#C4B5FD" },
    { id: "block-sono-vascular", sectionId: "class-sono-vascular", label: "Sono Vasc", color: "#A78BFA" },
    { id: "block-sono-msk", sectionId: "class-sono-msk", label: "Sono MSK", color: "#8B5CF6" },
  ];

  // X-Ray blocks (yellow shades)
  const xrBlocks = [
    { id: "block-xr-chest", sectionId: "class-xr-chest", label: "XR Chest", color: "#FDE047" },
    { id: "block-xr-msk", sectionId: "class-xr-msk", label: "XR MSK", color: "#FACC15" },
    { id: "block-xr-fluoro", sectionId: "class-xr-fluoro", label: "XR Fluoro", color: "#EAB308" },
  ];

  // On-Call block (red)
  const oncallBlock = { id: "block-oncall", sectionId: "class-oncall", label: "On-Call", color: "#FCA5A5" };

  const blocks = [
    ...mriBlocks,
    ...ctBlocks,
    ...sonoBlocks,
    ...xrBlocks,
    oncallBlock,
  ].map((b) => ({ ...b, requiredSlots: 1 }));

  // Generate template locations with slots
  // Each location has 3 columns per day representing specific time slots:
  // - Column 1 (Early): 08:00-12:00
  // - Column 2 (Midday): 12:00-16:00
  // - Column 3 (Late): 16:00-20:00
  // This allows clinicians to work multiple non-overlapping shifts per day
  // On-Call is separate and can overlap with regular shifts
  const templateLocations = locations.map((loc) => {
    // Define row bands (sections/rows in the grid)
    const rowBands = [
      { id: `${loc.id}-row-1`, label: "Primary", order: 1 },
      { id: `${loc.id}-row-2`, label: "Secondary", order: 2 },
      { id: `${loc.id}-row-3`, label: "Support", order: 3 },
    ];

    // Define column bands - 3 columns per day representing time slots
    const colBands: Array<{
      id: string;
      label: string;
      order: number;
      dayType: (typeof dayTypes)[number];
    }> = [];

    dayTypes.forEach((dayType) => {
      // Column 1: Early shift (08:00-12:00)
      colBands.push({
        id: `${loc.id}-col-${dayType}-1`,
        label: "08-12",
        order: 1,
        dayType,
      });
      // Column 2: Midday shift (12:00-16:00)
      colBands.push({
        id: `${loc.id}-col-${dayType}-2`,
        label: "12-16",
        order: 2,
        dayType,
      });
      // Column 3: Late shift (16:00-20:00)
      colBands.push({
        id: `${loc.id}-col-${dayType}-3`,
        label: "16-20",
        order: 3,
        dayType,
      });
    });

    // Generate slots - Big hospital with ~50 slots per weekday
    // Layout: Main has MRI+CT, Outpatient has Sono+XR, Emergency has On-Call+CT Trauma
    const slots: Array<{
      id: string;
      locationId: string;
      rowBandId: string;
      colBandId: string;
      blockId: string;
      requiredSlots: number;
      startTime: string;
      endTime: string;
      endDayOffset: number;
    }> = [];

    let slotCounter = 0;
    const isWeekend = (d: string) => d === "sat" || d === "sun";

    // Time columns: 08-12, 12-16, 16-20
    const timeSlots = [
      { col: 1, start: "08:00", end: "12:00" },
      { col: 2, start: "12:00", end: "16:00" },
      { col: 3, start: "16:00", end: "20:00" },
    ];

    // Main Hospital: All MRI subspecialties (4) + All CT subspecialties (4)
    // = 8 sections × 3 time slots × 7 days = ~168 slots/week at this location
    if (loc.id === "loc-main") {
      // MRI subspecialties in rows 1-4
      const mriBlockIds = ["block-mri-neuro", "block-mri-msk", "block-mri-abd", "block-mri-cardio"];
      // CT subspecialties in rows 5-8
      const ctBlockIds = ["block-ct-neuro", "block-ct-thorax", "block-ct-abd", "block-ct-trauma"];

      dayTypes.forEach((dayType) => {
        timeSlots.forEach((ts) => {
          // MRI slots (4 subspecialties)
          mriBlockIds.forEach((blockId, rowIdx) => {
            slots.push({
              id: `slot-${loc.id}-${slotCounter++}`,
              locationId: loc.id,
              rowBandId: `${loc.id}-row-${(rowIdx % 3) + 1}`,
              colBandId: `${loc.id}-col-${dayType}-${ts.col}`,
              blockId,
              requiredSlots: isWeekend(dayType) ? 1 : 1,
              startTime: ts.start,
              endTime: ts.end,
              endDayOffset: 0,
            });
          });
          // CT slots (4 subspecialties)
          ctBlockIds.forEach((blockId, rowIdx) => {
            slots.push({
              id: `slot-${loc.id}-${slotCounter++}`,
              locationId: loc.id,
              rowBandId: `${loc.id}-row-${(rowIdx % 3) + 1}`,
              colBandId: `${loc.id}-col-${dayType}-${ts.col}`,
              blockId,
              requiredSlots: isWeekend(dayType) ? 1 : 1,
              startTime: ts.start,
              endTime: ts.end,
              endDayOffset: 0,
            });
          });
        });
      });
    }

    // Outpatient Center: Sono (3 subspecialties) + X-Ray (3 subspecialties)
    // = 6 sections × 3 time slots × 5 weekdays = 90 slots/week
    if (loc.id === "loc-outpatient") {
      const sonoBlockIds = ["block-sono-abd", "block-sono-vascular", "block-sono-msk"];
      const xrBlockIds = ["block-xr-chest", "block-xr-msk", "block-xr-fluoro"];

      dayTypes.forEach((dayType) => {
        // Skip weekends for outpatient
        if (isWeekend(dayType)) return;

        timeSlots.forEach((ts) => {
          // Sono slots (3 subspecialties)
          sonoBlockIds.forEach((blockId, rowIdx) => {
            slots.push({
              id: `slot-${loc.id}-${slotCounter++}`,
              locationId: loc.id,
              rowBandId: `${loc.id}-row-${(rowIdx % 3) + 1}`,
              colBandId: `${loc.id}-col-${dayType}-${ts.col}`,
              blockId,
              requiredSlots: 1,
              startTime: ts.start,
              endTime: ts.end,
              endDayOffset: 0,
            });
          });
          // X-Ray slots (3 subspecialties)
          xrBlockIds.forEach((blockId, rowIdx) => {
            slots.push({
              id: `slot-${loc.id}-${slotCounter++}`,
              locationId: loc.id,
              rowBandId: `${loc.id}-row-${(rowIdx % 3) + 1}`,
              colBandId: `${loc.id}-col-${dayType}-${ts.col}`,
              blockId,
              requiredSlots: 1,
              startTime: ts.start,
              endTime: ts.end,
              endDayOffset: 0,
            });
          });
        });
      });
    }

    // Emergency: On-Call coverage (all days including weekends)
    // = 1 section × 3 time slots × 7 days = 21 slots/week
    if (loc.id === "loc-emergency") {
      dayTypes.forEach((dayType) => {
        timeSlots.forEach((ts) => {
          slots.push({
            id: `slot-${loc.id}-${slotCounter++}`,
            locationId: loc.id,
            rowBandId: `${loc.id}-row-1`,
            colBandId: `${loc.id}-col-${dayType}-${ts.col}`,
            blockId: "block-oncall",
            requiredSlots: 1,
            startTime: ts.start,
            endTime: ts.end,
            endDayOffset: 0,
          });
        });
      });
    }

    return {
      locationId: loc.id,
      rowBands,
      colBands,
      slots,
    };
  });

  // Build minSlotsByRowId for solver
  const minSlotsByRowId: Record<string, { weekday: number; weekend: number }> =
    {};
  rows.forEach((row) => {
    if (row.kind === "class" && row.subShifts) {
      row.subShifts.forEach((subShift) => {
        minSlotsByRowId[`${row.id}::${subShift.id}`] = {
          weekday: 1,
          weekend: 1,
        };
      });
    }
  });

  return {
    locations,
    locationsEnabled: true,
    rows,
    clinicians,
    assignments: [],
    minSlotsByRowId,
    slotOverridesByKey: {},
    weeklyTemplate: {
      version: 4,
      blocks,
      locations: templateLocations,
    },
    holidays: [],
    publishedWeekStartISOs: [],
    solverSettings: {
      enforceSameLocationPerDay: false,
      onCallRestEnabled: false, // Disabled to allow maximum slot coverage
      onCallRestClassId: "class-oncall",
      onCallRestDaysBefore: 0,
      onCallRestDaysAfter: 0,
      workingHoursToleranceHours: 10, // Increased tolerance for better distribution
    },
    solverRules: [],
  };
}

test.describe("Full Workflow - Radiology Schedule Setup", () => {
  test.setTimeout(300000); // 5 minutes for the full test

  test("complete radiology schedule setup and automated planning", async ({
    page,
    request,
  }, testInfo) => {
    // Step 1: Login as admin via API
    console.log("Step 1: Logging in as admin...");
    const adminLoginResponse = await request.post(`${API_BASE}/auth/login`, {
      data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
    });

    if (!adminLoginResponse.ok()) {
      console.log(
        "Admin login failed:",
        adminLoginResponse.status(),
        await adminLoginResponse.text(),
      );
      test.skip(true, "Admin credentials not configured for E2E test");
      return;
    }

    const adminLoginData = (await adminLoginResponse.json()) as {
      access_token?: string;
    };
    const adminToken = adminLoginData.access_token!;
    console.log("Admin login successful");

    // Step 2: Check if test user exists and delete if so
    console.log("Step 2: Checking for existing test user...");
    const usersResponse = await request.get(`${API_BASE}/auth/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const users = (await usersResponse.json()) as Array<{ username: string }>;
    const testUserExists = users.some(
      (u) => u.username.toLowerCase() === TEST_USER.toLowerCase(),
    );

    if (testUserExists) {
      console.log("Test user exists, deleting...");
      await request.delete(`${API_BASE}/auth/users/${TEST_USER}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }

    // Step 3: Create the test user
    console.log("Step 3: Creating test user...");
    const createUserResponse = await request.post(`${API_BASE}/auth/users`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        username: TEST_USER,
        password: TEST_PASSWORD,
        is_admin: false,
      },
    });

    expect(createUserResponse.ok()).toBeTruthy();
    console.log("Test user created successfully");

    // Step 4: Login as test user via API to get token
    console.log("Step 4: Logging in as test user via API...");
    const testUserLoginResponse = await request.post(`${API_BASE}/auth/login`, {
      data: { username: TEST_USER, password: TEST_PASSWORD },
    });
    expect(testUserLoginResponse.ok()).toBeTruthy();

    const testUserLoginData = (await testUserLoginResponse.json()) as {
      access_token?: string;
    };
    const testUserToken = testUserLoginData.access_token!;
    console.log("Test user API login successful");

    // Step 5: Set up the complete radiology schedule via API
    console.log("Step 5: Setting up BIG HOSPITAL radiology schedule via API...");
    console.log("  - Creating 3 locations (Main, Outpatient, Emergency)");
    console.log("  - Creating 15 sections (MRI×4, CT×4, Sono×3, XR×3, On-Call)");
    console.log("  - Creating 40 radiologists with varying qualifications");
    console.log("  - Creating 3 time slots per day (08-12, 12-16, 16-20)");
    console.log("  - Target: ~50 slots per weekday across all modalities");
    console.log("  - Adding realistic vacation schedules for 10 physicians");

    const radiologyState = generateRadiologyState();

    const stateResponse = await request.post(`${API_BASE}/v1/state`, {
      headers: { Authorization: `Bearer ${testUserToken}` },
      data: radiologyState,
    });

    if (!stateResponse.ok()) {
      console.log(
        "Failed to set state:",
        stateResponse.status(),
        await stateResponse.text(),
      );
    }
    expect(stateResponse.ok()).toBeTruthy();
    console.log("Radiology schedule set up successfully via API");

    // Count total slots
    const totalSlots = radiologyState.weeklyTemplate.locations.reduce(
      (sum, loc) => sum + loc.slots.length,
      0,
    );
    console.log(`Total template slots created: ${totalSlots}`);
    console.log(`Total clinicians created: ${radiologyState.clinicians.length}`);

    // Step 6: Login via UI to see the result
    console.log("Step 6: Logging in via UI to view the schedule...");
    await loginViaUI(page, TEST_USER, TEST_PASSWORD);
    await attachScreenshot(page, testInfo, "01-test-user-logged-in");

    // Step 7: View the schedule setup
    console.log("Step 7: Viewing the schedule...");
    await page.waitForTimeout(1000);
    await attachScreenshot(page, testInfo, "02-schedule-view");

    // Step 8: Open Settings to verify the setup
    console.log("Step 8: Opening Settings to verify setup...");
    await page.click('button:has-text("Settings")');
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await page.waitForTimeout(500);
    await attachScreenshot(page, testInfo, "03-settings-view");

    // Check Clinicians tab
    await page.click("text=Clinicians");
    await page.waitForTimeout(500);
    await attachScreenshot(page, testInfo, "04-clinicians-view");

    // Check Weekly Template
    await page.click("text=Weekly Calendar Template");
    await page.waitForTimeout(500);
    await attachScreenshot(page, testInfo, "05-weekly-template-view");

    // Step 9: Go back to calendar and run automated planning
    console.log("Step 9: Going back to calendar view...");
    await page.click('button:has-text("Back")');
    await page.waitForSelector('[data-schedule-grid="true"]', {
      timeout: 10000,
    });
    await attachScreenshot(page, testInfo, "06-calendar-view");

    // Step 10: Run automated planning for current week
    console.log("Step 10: Running automated planning...");

    // Click on Current week button to set the range
    const currentWeekBtn = page.locator('button:has-text("Current week")');
    if ((await currentWeekBtn.count()) > 0) {
      await currentWeekBtn.click();
      await page.waitForTimeout(500);
    }

    // Select "Distribute all people" strategy for maximum coverage
    const distributeAllBtn = page.locator(
      'button:has-text("Distribute all people")',
    );
    if ((await distributeAllBtn.count()) > 0) {
      await distributeAllBtn.click();
      await page.waitForTimeout(300);
    }
    await attachScreenshot(page, testInfo, "07-current-week-selected");

    // Find and click the Run button
    const runBtn = page.locator('button:has-text("Run")');
    if ((await runBtn.count()) > 0) {
      console.log("Running solver for 1 week with 'Distribute all people'...");
      await runBtn.click();
      // Wait for planning to complete
      await page.waitForTimeout(10000);
    }
    await attachScreenshot(page, testInfo, "08-planning-1-week-complete");

    // Step 11: Run automated planning for 4 weeks
    console.log("Step 11: Running automated planning for 4 weeks...");

    // Click "Next 4 weeks" button if available
    const next4WeeksBtn = page.locator('button:has-text("Next 4 weeks")');
    if ((await next4WeeksBtn.count()) > 0) {
      await next4WeeksBtn.click();
      await page.waitForTimeout(500);
    } else {
      // Extend the date range manually
      const endInput = page.locator('input[type="date"]').last();
      if ((await endInput.count()) > 0) {
        const fourWeeksFromNow = new Date();
        fourWeeksFromNow.setDate(fourWeeksFromNow.getDate() + 28);
        const endDate = fourWeeksFromNow.toISOString().split("T")[0];
        await endInput.fill(endDate);
      }
    }

    if ((await runBtn.count()) > 0) {
      console.log("Running solver for 4 weeks...");
      await runBtn.click();
      // Wait for 4-week planning to complete (longer timeout)
      await page.waitForTimeout(30000);
    }
    await attachScreenshot(page, testInfo, "09-planning-4-weeks-complete");

    // Step 12: Navigate through weeks to see assignments
    console.log("Step 12: Viewing assignments across weeks...");

    // Click next week button a few times
    const nextWeekBtn = page.locator('button[aria-label="Next week"]');
    for (let i = 0; i < 3; i++) {
      if ((await nextWeekBtn.count()) > 0) {
        await nextWeekBtn.click();
        await page.waitForTimeout(500);
      }
    }
    await attachScreenshot(page, testInfo, "10-week-navigation");

    // Final screenshot of the completed schedule
    console.log("Step 13: Taking final screenshots...");
    await attachScreenshot(page, testInfo, "11-final-schedule");

    // Logout
    console.log("Step 14: Logging out...");
    await logout(page);
    await attachScreenshot(page, testInfo, "12-logged-out");

    console.log("Full workflow test completed successfully!");
    console.log(`Created ${radiologyState.clinicians.length} radiologists`);
    console.log(`Created ${totalSlots} template slots across 3 locations`);
    console.log("Ran automated allocation for 1 week and 4 weeks");
  });
});
