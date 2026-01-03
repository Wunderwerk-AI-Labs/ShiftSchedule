from backend.state import _default_state, _normalize_state


def test_solver_settings_tolerance_defaulted() -> None:
    state = _default_state()
    state.solverSettings = {}  # Empty settings - deprecated keys were removed
    normalized, _changed = _normalize_state(state)
    assert normalized.solverSettings["workingHoursToleranceHours"] == 5


def test_preferred_working_times_invalid_normalizes_to_default_times() -> None:
    state = _default_state()
    state.clinicians[0].preferredWorkingTimes = {
        "mon": {"startTime": "25:00", "endTime": "12:00", "requirement": "mandatory"}
    }
    normalized, _changed = _normalize_state(state)
    monday = normalized.clinicians[0].preferredWorkingTimes["mon"]
    assert monday.requirement == "mandatory"
    assert monday.startTime == "07:00"
    assert monday.endTime == "17:00"
