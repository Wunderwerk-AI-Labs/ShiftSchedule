# Test Plan - Shift Schedule Application

This document outlines the test strategy, coverage areas, and execution instructions for the Shift Schedule application.

---

## 1. Test Layers Overview

| Layer | Framework | Location | Purpose |
|-------|-----------|----------|---------|
| Backend Unit | pytest | `backend/tests/` | State normalization, solver logic, utilities |
| Backend Integration | pytest | `backend/tests/` | API endpoints, database operations |
| Frontend Unit | Vitest | `src/**/*.test.ts(x)` | Pure functions, helpers, utilities |
| Frontend Component | Vitest | `src/**/*.test.tsx` | React component behavior |
| End-to-End | Playwright | `e2e/*.spec.ts` | Full user journeys |

---

## 2. Running Tests

### Backend Tests (pytest)

```bash
# Install dev dependencies
pip install -r backend/requirements-dev.txt

# Run all backend tests
python3 -m pytest backend/tests/ -v

# Run specific test file
python3 -m pytest backend/tests/test_state_normalization.py -v

# Run with coverage
python3 -m pytest backend/tests/ --cov=backend --cov-report=html
```

### Frontend Unit Tests (Vitest)

```bash
# Run once
npm test

# Watch mode
npm run test:watch

# With coverage
npm test -- --coverage
```

### End-to-End Tests (Playwright)

```bash
# Ensure backend and frontend are running first
# Backend: python3 -m uvicorn backend.main:app --port 8000
# Frontend: npm run dev

# Run E2E tests
npm run test:e2e

# Run specific test file
npx playwright test e2e/app.spec.ts

# Debug mode
npx playwright test --debug

# Show report
npx playwright show-report
```

### Required Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PLAYWRIGHT_BASE_URL` | `http://127.0.0.1:5173` | Frontend URL for E2E |
| `PLAYWRIGHT_API_URL` | `http://localhost:8000` | Backend URL for E2E |
| `E2E_USERNAME` | `testuser` | Test user username |
| `E2E_PASSWORD` | `sdjhfl34-wfsdfwsd2` | Test user password |
| `ADMIN_USERNAME` | - | Admin user for backend |
| `ADMIN_PASSWORD` | - | Admin password for backend |
| `JWT_SECRET` | - | JWT signing secret |

---

## 3. Coverage by Feature

### 3.1 State Normalization & Migration

**Backend Tests** (`backend/tests/test_state_normalization.py`):
- [x] Remove deprecated pool rows (`pool-not-allocated`, `pool-manual`)
- [x] Remove assignments to deprecated pools
- [x] Preserve Rest Day pool (`pool-rest-day`)
- [x] Preserve Vacation pool (`pool-vacation`)
- [x] Remove deprecated solver settings (`allowMultipleShiftsPerDay`, `showDistributionPool`, `showReservePool`)
- [x] Normalize solver settings defaults
- [x] Handle legacy state formats gracefully

**Frontend Tests** (`src/lib/shiftRows.test.ts`):
- [x] `normalizeAppState()` removes deprecated pools
- [x] `normalizeAppState()` preserves valid pools
- [x] `parseShiftRowId()` and `buildShiftRowId()` round-trip correctly

### 3.2 Solver Logic

**Backend Tests** (`backend/tests/test_solver.py`):
- [x] Day solver creates assignments only for template slots
- [x] Solver respects clinician qualifications
- [x] Solver blocks vacation days
- [x] Solver blocks rest days (when on-call rest enabled)
- [x] Solver enforces same-location-per-day (when enabled)
- [x] Solver prevents time overlaps (overlapping intervals forbidden)
- [x] Solver allows touching intervals (end == start)
- [x] Manual assignments remain fixed
- [x] Infeasible configurations return safe responses

### 3.3 Time Interval Logic

**Backend Tests** (`backend/tests/test_solver_time.py`):
- [x] Time parsing (`_parse_time_to_minutes()`)
- [x] Slot interval building (`_build_slot_interval()`)
- [x] Day offset handling

**Frontend Tests** (`src/lib/schedule.test.ts`):
- [x] `intervalsOverlap()` edge cases
- [x] `buildShiftInterval()` with day offsets
- [x] Pool rows return null interval

### 3.4 Assignment Rendering

**Frontend Tests** (`src/lib/schedule.test.ts`):
- [x] `buildRenderedAssignmentMap()` filters vacation days
- [x] `buildRenderedAssignmentMap()` handles on-call rest days
- [x] No Distribution Pool references in output

### 3.5 iCal Export

**Backend Tests** (`backend/tests/test_ical.py`):
- [x] `_escape_text()` escapes special characters
- [x] `_fold_ical_line()` wraps long lines per RFC 5545
- [x] `_format_dtstamp()` produces valid timestamps
- [x] Calendar generation produces valid iCal format
- [x] Only section assignments included (no pool rows)
- [x] Vacation days filter out assignments

**Backend Integration Tests** (`backend/tests/test_ical_routes.py`):
- [x] Invalid token returns 404
- [x] Unpublished weeks return empty calendar
- [x] Published weeks return events
- [x] Token rotation invalidates old tokens
- [x] ETag/Last-Modified headers for caching
- [x] Conditional GET returns 304 when unchanged

### 3.6 Public Web View

**Backend Tests** (`backend/tests/test_web.py`):
- [x] Unpublished week returns `published: false`
- [x] Published week returns schedule data
- [x] Invalid token returns 404
- [x] Token rotation invalidates old tokens
- [x] ETag caching works correctly

### 3.7 PDF Export

**E2E Tests** (`e2e/app.spec.ts`):
- [x] PDF export produces valid PDF
- [x] One page per week
- [x] Print layout fits A4 page

### 3.8 Pool Removal Regression Tests

**Backend Tests**:
- [x] Distribution Pool (`pool-not-allocated`) is removed from state
- [x] Reserve Pool (`pool-manual`) is removed from state
- [x] No assignment rowId equals deprecated pool IDs
- [x] Solver does not reference pools

**Frontend Tests**:
- [x] `DEPRECATED_POOL_IDS` set excludes deprecated pools
- [x] Normalization removes deprecated pools

**E2E Tests** (`e2e/pool-removal.spec.ts`):
- [x] Distribution Pool not rendered in UI
- [x] Reserve Pool not rendered in UI
- [x] Settings view shows only Rest Day and Vacation pools
- [x] Schedule grid has no deprecated pool rows

---

## 4. Intentionally Not Covered

The following areas are explicitly excluded from automated testing:

1. **Visual styling** - Covered by manual review; snapshot tests avoided for maintainability
2. **PDF visual accuracy** - Only validates PDF generation, not pixel-perfect layout
3. **Real external API calls** - Holiday API (date.nager.at) is mocked in tests
4. **Browser compatibility** - Playwright runs Chromium only; cross-browser testing is manual
5. **Performance benchmarks** - Not part of functional test suite
6. **Mobile touch interactions** - HTML5 drag-and-drop doesn't support mobile

---

## 5. Test Data & Fixtures

### Backend Fixtures (`backend/tests/conftest.py`)

```python
@pytest.fixture
def default_clinician() -> Clinician:
    """Single clinician with basic qualifications."""

@pytest.fixture
def default_state(default_clinician) -> AppState:
    """Minimal valid AppState with one clinician and one slot."""

@pytest.fixture
def state_with_deprecated_pools() -> AppState:
    """State containing Distribution and Reserve pools for migration testing."""

@pytest.fixture
def test_client() -> TestClient:
    """FastAPI test client with auth token."""
```

### Frontend Fixtures

Test utilities are imported from `@testing-library/react` and custom helpers in test files.

### E2E Fixtures (`e2e/fixtures.ts`)

- Extended Playwright test with diagnostics
- Automatic secret redaction
- Screenshot utilities
- Auth token helpers

---

## 6. CI Integration

Tests are designed to be CI-friendly:

- **Deterministic**: No reliance on real time or external services
- **Isolated**: Each test cleans up after itself
- **Fast**: Unit tests complete in seconds
- **Parallel-safe**: E2E tests use serial execution where needed

### Recommended CI Pipeline

```yaml
test:
  steps:
    - name: Backend Tests
      run: |
        pip install -r backend/requirements-dev.txt
        python3 -m pytest backend/tests/ -v

    - name: Frontend Tests
      run: npm test

    - name: E2E Tests
      run: |
        npm run dev &
        python3 -m uvicorn backend.main:app &
        npx wait-on http://localhost:5173 http://localhost:8000/health
        npm run test:e2e
```

---

## 7. Future Work

Areas identified for future test expansion:

1. **Component tests for ClinicianEditor** - Complex form interactions
2. **Template builder E2E tests** - More comprehensive slot placement scenarios
3. **Solver performance tests** - Benchmark large schedule solving
4. **Accessibility tests** - Verify WCAG compliance
5. **API contract tests** - OpenAPI schema validation

---

## 8. Changelog

| Date | Author | Changes |
|------|--------|---------|
| 2026-01-03 | Claude | Initial test plan created |
| 2026-01-03 | Claude | Added pool removal regression tests |
| 2026-01-03 | Claude | Added iCal and web API tests |
