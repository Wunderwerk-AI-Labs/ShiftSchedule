"""Small, deterministic UI receipts; never serialize raw tool output or revalidate."""


def tool_receipt(name: str, result: dict, *, failed: bool = False) -> dict:
    if failed or result.get("error"):
        return {"summary": "Check failed; the agent can adjust its request.", "outcome": "error"}
    if name in ("apply_moves", "apply_proposal"):
        if result.get("dry_run"):
            text = "Trial passed the rule check." if result.get("valid") else "Trial rejected by the rule check."
        elif result.get("already_applied"):
            text = "This proposal was already applied; no additional change."
        elif result.get("applied"):
            text = "Changes checked and applied to the working draft."
        else:
            text = "Changes not applied; the working draft was kept."
        return {"summary": text, "outcome": "ok" if result.get("applied") or result.get("valid") or result.get("already_applied") else "warning"}

    parts = []
    for field in ("candidates", "rescues", "offers", "proposals"):
        if isinstance(result.get(field), list):
            count = len(result[field])
            # An empty bounded search is not proof that staffing is impossible.
            parts.append(f"{count} {'option' if count == 1 else 'options'} returned" if count else "No option found in this search")
            break
    if isinstance(result.get("open_positions"), int):
        parts.append(f"Open positions on this day: {result['open_positions']}")
    if isinstance(result.get("open_slot_count"), int):
        parts.append(f"Open positions in the working draft: {result['open_slot_count']}")
    if isinstance(result.get("new_hard_violations"), int):
        parts.append(f"New hard rule violations: {result['new_hard_violations']}")
    partial = bool(result.get("next_cursor") or result.get("not_searched") or result.get("search_status") in ("incomplete", "budget_exhausted"))
    if partial:
        parts.append("More options remain unchecked")
    if result.get("cached"):
        parts.append("Reused a check of the unchanged plan")
    return {"summary": ". ".join(parts) + "." if parts else "Check completed.",
            "outcome": "warning" if partial else "ok"}
