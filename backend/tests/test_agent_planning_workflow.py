"""Behavioral regressions for proposal selection, revisions and search scope."""
import json

from backend.agent.tools import PlanToolExecutor
from backend.models import TemplateBlock
from backend.scoring import build_scoring_context
from .conftest import make_app_state, make_assignment, make_clinician, make_template_slot, make_workplace_row

MON = "2026-01-05"
TUE = "2026-01-06"


def run(executor, name, **arguments):
    response = executor.execute(name, arguments, "test")
    assert not response.is_error, response.content
    return json.loads(response.content)


def executor(state=None, seed=None, end=MON):
    state = state or make_app_state()
    return PlanToolExecutor(state, build_scoring_context(state, MON, end, only_fill_required=True), seed or [])


def section_state(clinicians, slots, sections):
    state = make_app_state(clinicians=clinicians, slots=slots,
                           rows=[make_workplace_row(s, s) for s in sections])
    state.weeklyTemplate.blocks = [TemplateBlock(id=s, sectionId=s, requiredSlots=0) for s in sections]
    return state


def test_blocks_rank_seventh_candidate_before_limiting_response():
    clinicians = [make_clinician(f"a{i}", f"A-only {i}", ["A"], working_hours_per_week=40) for i in range(6)]
    clinicians += [make_clinician("ab", "Full block", ["A", "B"], working_hours_per_week=40)]
    clinicians += [make_clinician(f"b{i}", f"B-only {i}", ["B"], working_hours_per_week=40) for i in range(7)]
    ex = executor(section_state(clinicians, [
        make_template_slot("A", block_id="A", start_time="08:00", end_time="09:00"),
        make_template_slot("B", block_id="B", start_time="09:00", end_time="12:00"),
    ], ["A", "B"]))
    options = run(ex, "suggest_day_blocks", dateISO=MON)
    assert options["section"] == "A"
    assert options["evaluated_candidates"] == 7
    assert len(options["candidates"]) == 6
    best = options["candidates"][0]
    assert best["clinicianId"] == "Full block"
    assert best["block_hours"] == 4
    accepted = run(ex, "apply_proposal", proposal_id=best["proposal_id"])
    assert accepted["applied"]
    assert accepted["next"]["result"]["day_complete"]
    assert ex.best_quality[:3] == (0, 0, 0)


def test_proposal_retry_never_reapplies_changes_or_reuses_old_next_options():
    ex = executor()
    options = run(ex, "suggest_day_blocks", dateISO=MON)
    proposal_id = options["candidates"][0]["proposal_id"]
    first = run(ex, "apply_proposal", proposal_id=proposal_id)
    accepted_count = ex.moves_accepted
    again = run(ex, "apply_proposal", proposal_id=proposal_id)
    assert first["applied"] and not again["applied"]
    assert again["already_applied"]
    assert ex.moves_accepted == accepted_count
    assert "next" not in again


def test_other_day_change_invalidates_proposal_and_negative_search_cache():
    state = make_app_state(slots=[
        make_template_slot("mon"), make_template_slot("tue", col_band_id="col-tue-1"),
    ])
    ex = executor(state, end=TUE)
    old = run(ex, "suggest_day_blocks", dateISO=MON)
    repeated = run(ex, "suggest_day_blocks", dateISO=MON)
    assert repeated["cached"]
    assert repeated["candidates"][0]["proposal_id"] == old["candidates"][0]["proposal_id"]
    run(ex, "apply_moves", moves=[{"action": "assign", "slot_key": f"tue__{TUE}", "clinicianId": "clin-1"}])
    stale = run(ex, "apply_proposal", proposal_id=old["candidates"][0]["proposal_id"])
    assert stale["stale_proposal"] and not stale["applied"]
    current = run(ex, "suggest_day_blocks", dateISO=MON)
    assert not current["cached"]
    assert current["plan_revision"] > old["plan_revision"]
    history = run(ex, "get_search_history")
    assert any(not item["current"] for item in history["searches"])


def chain_fixture():
    state = section_state([
        make_clinician("a", "Alice", ["A", "B"], working_hours_per_week=40),
        make_clinician("b", "Bob", ["B", "C"], working_hours_per_week=40),
        make_clinician("c", "Cara", ["C"], working_hours_per_week=40),
    ], [make_template_slot(s, block_id=s) for s in ("A", "B", "C")], ["A", "B", "C"])
    state.solverSettings["agentNeighborhoodSearch"] = True
    return executor(state, [make_assignment("draft-1", "B", MON, "a", source="solver"),
                            make_assignment("draft-2", "C", MON, "b", source="solver")])


def test_shallow_rescue_reports_search_scope_instead_of_infeasibility():
    ex = chain_fixture()
    result = run(ex, "suggest_rescue_moves", dateISO=MON)
    assert result["rescues"] == []
    assert result["no_rescue_found"]
    assert "truly_unfillable" not in result
    assert result["search_scope"]["relocated_assignments"] == 1


def test_neighborhood_finds_joint_chain_that_shallow_rescue_misses():
    ex = chain_fixture()
    result = run(ex, "repair_neighborhood", dateISO=MON)
    assert result["search_status"] == "improvement_found"
    assert len(ex.current) == 2  # searching itself never edits the draft
    applied = run(ex, "apply_proposal", proposal_id=result["proposals"][0]["proposal_id"])
    assert applied["applied"]
    assert ex.best_quality[:2] == (0, 0)
    assert len(ex.current) == 3


def test_neighborhood_releases_weekly_hours_across_days_atomically():
    clinicians = [make_clinician("a", "Alice", ["A", "B"], working_hours_per_week=8),
                  make_clinician("b", "Bob", ["B", "C"], working_hours_per_week=8),
                  make_clinician("c", "Cara", ["C"], working_hours_per_week=8)]
    for clinician in clinicians:
        clinician.workingHoursToleranceHours = 0
    state = section_state(clinicians, [
        make_template_slot("A", block_id="A", col_band_id="col-tue-1"),
        make_template_slot("B", block_id="B"),
        make_template_slot("C", block_id="C", col_band_id="col-tue-1"),
    ], ["A", "B", "C"])
    state.solverSettings["agentNeighborhoodSearch"] = True
    ex = executor(state, [make_assignment("draft-1", "B", MON, "a", source="solver"),
                          make_assignment("draft-2", "C", TUE, "b", source="solver")], end=TUE)
    assert run(ex, "suggest_rescue_moves", dateISO=TUE)["rescues"] == []
    result = run(ex, "repair_neighborhood", dateISO=TUE)
    assert result["proposals"]
    assert run(ex, "apply_proposal", proposal_id=result["proposals"][0]["proposal_id"])["applied"]
    assert ex.best_quality[:2] == (0, 0)
    assert all(ex._week_hours(c.id, MON) == 8 for c in clinicians)


def test_neighborhood_preserves_fixed_entries():
    ex = chain_fixture()
    state = ex.state.model_copy(deep=True)
    state.assignments = list(ex.current.values())
    fixed = executor(state)
    result = run(fixed, "repair_neighborhood", dateISO=MON)
    assert not result["proposals"]
    assert fixed.current == {}
    assert fixed.fixed_assignments == state.assignments


def test_neighborhood_deadline_returns_unsearched_status_without_changes():
    ex = chain_fixture()
    ex.wall_deadline = 1
    result = run(ex, "repair_neighborhood", dateISO=MON)
    assert result["search_status"] == "budget_exhausted"
    assert result["not_searched"] == [MON]
    assert len(ex.current) == 2


def test_disabled_experiment_cannot_be_invoked_by_guessing_the_tool_name():
    ex = executor()
    reply = ex.execute("repair_neighborhood", {"dateISO": MON}, "test")
    assert "disabled" in json.loads(reply.content)["error"]
    assert not ex.current


def test_evicted_proposal_is_regenerated_on_cached_search():
    ex = executor()
    old = run(ex, "suggest_day_blocks", dateISO=MON)
    ex.workflow.proposals.clear()  # simulate bounded storage eviction
    new = run(ex, "suggest_day_blocks", dateISO=MON)
    assert not new["cached"]
    assert new["candidates"][0]["proposal_id"] != old["candidates"][0]["proposal_id"]
    assert run(ex, "apply_proposal", proposal_id=new["candidates"][0]["proposal_id"])["applied"]


def test_failure_to_get_next_suggestion_does_not_disguise_success(monkeypatch):
    ex = executor()
    offered = run(ex, "suggest_day_blocks", dateISO=MON)["candidates"][0]
    def broken(_):
        raise RuntimeError("suggestion unavailable")
    monkeypatch.setattr(ex, "_tool_suggest_day_blocks", broken)
    result = run(ex, "apply_proposal", proposal_id=offered["proposal_id"])
    assert result["applied"] and ex.current
    assert "error" in result["next"]["result"]
    assert run(ex, "apply_proposal", proposal_id=offered["proposal_id"])["already_applied"]


def test_neighborhood_gate_rejects_cross_boundary_rest_conflict():
    from backend.models import Assignment
    state = section_state([make_clinician("a", "Alice", ["A", "Duty"], working_hours_per_week=40)],
                          [make_template_slot("A", block_id="A"),
                           make_template_slot("Duty", block_id="Duty", col_band_id="col-tue-1")], ["A", "Duty"])
    state.solverSettings.update(agentNeighborhoodSearch=True, onCallRestEnabled=True,
                               onCallRestClassId="Duty", onCallRestDaysBefore=1, onCallRestDaysAfter=1)
    state.assignments = [Assignment(id="fixed-duty", rowId="Duty", dateISO=TUE, clinicianId="a", source="manual")]
    ex = executor(state)
    result = run(ex, "repair_neighborhood", dateISO=MON)
    assert not result["proposals"]
    assert not ex.current
