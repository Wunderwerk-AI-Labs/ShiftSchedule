"""Revision-bound proposals and bounded search memory for one planning run.

Only the executor owns assignments. This module stores instructions for
already checked moves, never a second mutable copy of the calendar.
"""
from collections import OrderedDict, deque
from copy import deepcopy
import json


SEARCH_TOOLS = {
    "suggest_day_blocks", "suggest_rescue_moves", "suggest_balance_moves",
    "repair_neighborhood", "analyze_bottlenecks", "explain_unfilled",
}


class InspectionBudgetExhausted(Exception):
    def __init__(self, day):
        self.result = {"search_status": "incomplete", "not_searched": [day],
                       "note": "Inspection time budget exhausted. Candidate counts and completion were not established."}


class PlanningWorkflow:
    def __init__(self, executor):
        self.executor = executor
        self.revision = 0
        self.proposals = OrderedDict()
        self.proposal_counter = 0
        self.search_counter = 0
        self.searches = deque(maxlen=80)
        self.cache = OrderedDict()
        self.cache_budgets = {}

    def changed(self):
        self.revision += 1
        # Deliberately conservative: even a change on another day can alter
        # weekly hours or rest constraints. Never reuse old negative results.
        self.cache.clear()
        self.cache_budgets.clear()

    def search(self, name, arguments, handler):
        key = (name, json.dumps(arguments, sort_keys=True, separators=(",", ":")))
        budget_before = self.executor._tool_seconds_left()
        if key in self.cache:
            result = deepcopy(self.cache[key])
            def ids(value):
                if isinstance(value, dict):
                    if "proposal_id" in value:
                        yield value["proposal_id"]
                    for child in value.values():
                        yield from ids(child)
                elif isinstance(value, list):
                    for child in value:
                        yield from ids(child)
            more_budget = (result.get("search_status") in ("incomplete", "budget_exhausted")
                           and budget_before > self.cache_budgets[key] + 1)
            if not more_budget and all(proposal_id in self.proposals for proposal_id in ids(result)):
                result["cached"] = True
                return result
            # Bounded proposal storage may evict an old offer before its
            # cached search. Regenerate it instead of returning unusable IDs.
            del self.cache[key]
        try:
            result = handler(arguments)
        except InspectionBudgetExhausted as exc:
            result = dict(exc.result)
            field = {"suggest_day_blocks": "candidates", "suggest_rescue_moves": "rescues",
                     "suggest_balance_moves": "offers", "repair_neighborhood": "proposals",
                     "analyze_bottlenecks": "bottlenecks", "explain_unfilled": "explanations"}.get(name)
            if field:
                result[field] = []
        if "error" in result:
            return result
        self.search_counter += 1
        result = {**result, "plan_revision": self.revision,
                  "search_id": f"search-{self.search_counter}", "cached": False}
        self.searches.append({
            "search_id": result["search_id"], "tool": name,
            "arguments": deepcopy(arguments), "plan_revision": self.revision,
            "status": result.get("search_status", "completed"),
            "offers": len(result.get("candidates", result.get("rescues", result.get("offers", result.get("proposals", []))))),
            "not_searched": result.get("not_searched", []),
        })
        # Repeating the same incomplete search with LESS remaining time
        # cannot extend it. Changed parameters, plan or an increased budget
        # allow another attempt without treating repetition as progress.
        self.cache[key] = deepcopy(result)
        self.cache_budgets[key] = budget_before
        while len(self.cache) > 80:
            expired, _ = self.cache.popitem(last=False)
            self.cache_budgets.pop(expired, None)
        return result

    def propose(self, moves, *, next_tool, next_args, preview=None):
        if preview is None:
            preview = self.executor._tool_apply_moves({"moves": moves, "dry_run": True})
        if not preview.get("valid"):
            return {}
        self.proposal_counter += 1
        proposal_id = f"proposal-{self.proposal_counter}"
        self.proposals[proposal_id] = {
            "revision": self.revision, "moves": deepcopy(moves),
            "next_tool": next_tool, "next_args": deepcopy(next_args),
            "applied": False,
        }
        while len(self.proposals) > 256:
            self.proposals.popitem(last=False)
        return {"proposal_id": proposal_id, "plan_revision": self.revision,
                "quality_after": preview.get("quality_after"),
                "improves_best": preview.get("improves_best", False)}

    def apply(self, arguments):
        proposal_id = arguments.get("proposal_id")
        proposal = self.proposals.get(proposal_id)
        if proposal is None:
            return {"applied": False, "error": "Unknown or expired proposal; request fresh suggestions."}
        if proposal["applied"]:
            return {"applied": False, "already_applied": True, "proposal_id": proposal_id,
                    "plan_revision": self.revision, "verification": self.executor._overview()}
        if proposal["revision"] != self.revision:
            return {"applied": False, "stale_proposal": True,
                    "plan_revision": self.revision,
                    "note": "The plan changed. Request fresh suggestions before applying this proposal."}
        result = self.executor._tool_apply_moves({"moves": proposal["moves"]})
        if not result.get("applied"):
            return result
        proposal["applied"] = True
        result.update({"proposal_id": proposal_id, "plan_revision": self.revision})
        next_args = proposal["next_args"]
        if next_args.get("duty_pass"):
            ex = self.executor
            counts = ex._counts_by_instance(ex._working_list())
            duties = sorted((inst for inst in ex.ctx.instances.values()
                             if inst.section_id == ex.ctx.settings.onCallRestClassId
                             and counts.get(inst.slot_key, 0) < inst.target),
                            key=lambda inst: (inst.date_iso, inst.start, inst.slot_key))
            if not duties:
                result["next"] = {"tool": "suggest_day_blocks", "result": {"duty_complete": True}}
                return result
            next_args = {"slot_key": ex._alias_slot_key(duties[0].slot_key), "single": True}
        # A failed follow-up inspection must never disguise a successful
        # mutation as a failed tool call (which would invite an unsafe retry).
        from .provider import ToolResult
        followup: ToolResult = self.executor.execute(
            proposal["next_tool"], next_args, "proposal-followup"
        )
        result["next"] = {"tool": proposal["next_tool"],
                          "result": json.loads(followup.content)}
        return result

    def summary(self, *, current_only=False):
        rows = [dict(row, current=row["plan_revision"] == self.revision)
                for row in self.searches]
        if current_only:
            rows = [row for row in rows if row["current"]]
        return {"plan_revision": self.revision, "searches": rows[-30:],
                "note": "Only current=true results describe this plan. No bounded search proves global infeasibility."}

    def review_day(self, day):
        """Run required checks in code before accepting a model's end-turn."""
        ex = self.executor
        if ex._tool_seconds_left() <= 5:
            return {"complete": False, "reason": "Review budget exhausted", "proposals": []}
        counts = ex._counts_by_instance(ex._working_list())
        gaps = any(i.date_iso == day and counts.get(i.slot_key, 0) < i.target for i in ex.ctx.instances.values())
        checks = []
        if gaps:
            checks.append(("suggest_rescue_moves", "rescues"))
            if ex.ctx.settings.agentNeighborhoodSearch:
                checks.append(("repair_neighborhood", "proposals"))
        checks.append(("suggest_balance_moves", "offers"))
        for name, field in checks:
            reply = ex.execute(name, {"dateISO": day}, "required-day-review")
            data = json.loads(reply.content)
            if reply.is_error or "error" in data or data.get("search_status") in ("incomplete", "budget_exhausted"):
                return {"complete": False, "reason": f"{name} was not fully checked", "proposals": []}
            proposals = [p["proposal_id"] for p in data.get(field, []) if p.get("proposal_id") and p.get("improves_best")]
            if proposals:
                return {"complete": False, "reason": f"{name} found a checked improvement",
                        "proposals": proposals[:3]}
        return {"complete": True, "reason": "Required bounded checks completed", "proposals": []}
