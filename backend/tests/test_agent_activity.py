import json

from backend.agent.activity import tool_receipt
from .conftest import make_app_state, make_clinician
from .test_agent_tools import _make_executor, MON


def test_partial_and_cached_searches_are_not_presented_as_infeasible():
    receipt = tool_receipt("suggest_rescue_moves", {"rescues": [], "next_cursor": "page2", "cached": True})
    assert receipt["outcome"] == "warning"
    assert "No option found in this search" in receipt["summary"]
    assert "More options remain unchecked" in receipt["summary"]
    assert "unchanged plan" in receipt["summary"]
    assert tool_receipt("suggest_day_blocks", {"candidates": [{}, {}]})["summary"] == "2 options returned."


def test_receipts_distinguish_trial_rejection_retry_and_new_violations():
    assert "Trial passed" in tool_receipt("apply_moves", {"dry_run": True, "valid": True})["summary"]
    assert "already applied" in tool_receipt("apply_proposal", {"already_applied": True})["summary"]
    assert tool_receipt("apply_proposal", {"stale_proposal": True})["outcome"] == "warning"
    receipt = tool_receipt("get_plan_overview", {"new_hard_violations": 0, "hard_violations_not_yours": 125, "open_slot_count": 3})
    assert "New hard rule violations: 0" in receipt["summary"]
    assert "125" not in receipt["summary"]


def test_start_is_visible_before_handler_and_failure_gets_a_receipt(monkeypatch):
    ex = _make_executor(make_app_state(clinicians=[make_clinician("c1", "Schmit")]))
    events = []
    ex.on_activity = lambda kind, data: events.append((kind, data))

    def fail(args):
        assert events[-1][0] == "tool_start"
        raise ValueError("private diagnostic")

    monkeypatch.setattr(ex, "_tool_overview", fail)
    result = ex.execute("get_plan_overview", {}, "call1")
    assert result.is_error
    assert [kind for kind, _ in events] == ["tool_start", "tool_result"]
    assert events[0][1]["activity_id"] == events[1][1]["activity_id"]
    assert events[1][1]["outcome"] == "error"
    assert events[1][1]["duration_ms"] >= 0
    assert "private diagnostic" not in json.dumps(events)


def test_malformed_arguments_and_broken_ui_hook_do_not_crash_the_solver():
    ex = _make_executor(make_app_state(clinicians=[make_clinician("c1", "Schmit")]))
    result = ex.execute("get_day_priorities", {"dateISO": [MON]}, "bad")
    assert result.is_error
    def fail_hook(*_):
        raise RuntimeError("UI disconnected")
    ex.on_activity = fail_hook
    assert not ex.execute("get_day_priorities", {"dateISO": MON}, "good").is_error
