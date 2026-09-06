"""Explainable optional quality profile, independent from hard-rule safety."""
from collections import defaultdict
from datetime import date, timedelta

from ..planning_preferences import daily_min_minutes, daily_target_minutes

CLASSIC_FIELDS = ("hard_violations_in_range", "open_required_slots", "short_days",
                  "soft_rule_violations", "hours_deviation_minutes", "preference_and_load_bonus")
BALANCED_FIELDS = ("hard_violations_in_range", "open_required_slots", "open_priority_points",
                   "uncomfortable_days", "discomfort_minutes", "soft_rule_violations",
                   "structured_wish_violations", "hours_deviation_minutes",
                   "duty_burden_penalty", "changed_existing_assignments", "negative_preference_bonus")
WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def extra_metrics(executor, working):
    ctx = executor.ctx
    minutes = defaultdict(int)
    counts = executor._counts_by_instance(working)
    full = executor.fixed_assignments + list(working)
    end = date.fromisoformat(ctx.end_iso)
    start = min(date.fromisoformat(ctx.start_iso), end-timedelta(days=27))
    burdens = defaultdict(lambda: defaultdict(int))
    opportunities = defaultdict(set)
    duty_section = ctx.settings.onCallRestClassId

    def categories(day, start_minutes, end_minutes, section):
        result = []
        if day.weekday() >= 5:
            result.append("weekend")
        if end_minutes > 1440 or start_minutes < 360 or end_minutes > 1320:
            result.append("night")
        if duty_section and section == duty_section:
            result.append("on_call")
        return result

    for assignment in full:
        if assignment.rowId.startswith("pool-"):
            continue
        interval = ctx.all_slot_intervals.get(assignment.rowId)
        if interval is None:
            continue
        day = date.fromisoformat(assignment.dateISO)
        section = ctx.section_by_slot_id.get(assignment.rowId)
        duration = max(0, interval[1]-interval[0])
        if assignment.dateISO in ctx.target_date_set:
            minutes[(assignment.clinicianId, assignment.dateISO)] += duration
        if start <= day <= end:
            for category in categories(day, interval[0], interval[1], section):
                burdens[category][assignment.clinicianId] += duration
                if assignment.dateISO not in ctx.target_date_set:
                    opportunities[category].add((assignment.dateISO, section, interval[0], interval[1]))
    # Include currently unfilled duties so eligible opportunity weights do
    # not change simply because another candidate was selected.
    for inst in ctx.instances.values():
        for category in categories(date.fromisoformat(inst.date_iso), inst.start, inst.end, inst.section_id):
            if inst.capacity:
                opportunities[category].add((inst.date_iso, inst.section_id, inst.start, inst.end))

    short = long = deficit = excess = wishes = 0
    wish_details = []
    for (cid, day), amount in minutes.items():
        clinician = executor.clinicians_by_id.get(cid)
        if clinician is None or amount <= 0:
            continue
        window = ctx.window_by_clinician_date.get((cid, day))
        minimum = daily_min_minutes(clinician, window)
        comfort = daily_target_minutes(clinician, window)+60
        if minimum is not None and amount < minimum:
            short += 1
            deficit += minimum-amount
        if amount > comfort:
            long += 1
            excess += amount-comfort
        pattern = clinician.workPattern
        if pattern and WEEKDAYS[date.fromisoformat(day).weekday()] in pattern.preferredDaysOff:
            wishes += 1
            wish_details.append({"clinicianId": executor._alias(cid), "dateISO": day, "wish": "preferred_day_off"})

    # Eligibility and historical opportunities are immutable during a run.
    # Cache their weights; full quality is evaluated for many candidate plans.
    weights = getattr(executor, "_duty_opportunity_weights", None)
    if weights is None:
        weights = {}
        for category in opportunities:
            for clinician in executor.state.clinicians:
                available_days = set()
                for day, section, slot_start, slot_end in opportunities[category]:
                    if section not in clinician.qualifiedClassIds or any(v.startISO <= day <= v.endISO for v in clinician.vacations):
                        continue
                    window = ctx.window_by_clinician_date.get((clinician.id, day))
                    if window and window[0] == "mandatory" and not (slot_start >= window[1] and slot_end <= window[2]):
                        continue
                    available_days.add(day)
                if available_days:
                    weights[(category, clinician.id)] = max(0.01, (clinician.workingHoursPerWeek or 40)/40 * len(available_days))
        executor._duty_opportunity_weights = weights
    burden_penalty = sum((burdens[category].get(cid, 0)/60)**2/weight
                         for (category, cid), weight in weights.items())
    reference = {(a.rowId, a.dateISO, a.clinicianId) for a in executor.reference_assignments}
    current = {(a.rowId, a.dateISO, a.clinicianId) for a in working}
    return {
        "open_priority_points": sum(max(0, i.target-counts.get(i.slot_key, 0))*i.order_weight for i in ctx.instances.values()),
        "short_days": short, "overlong_days": long, "uncomfortable_days": short+long,
        "short_day_deficit_minutes": deficit, "long_day_excess_minutes": excess,
        "discomfort_minutes": deficit+excess, "structured_wish_violations": wishes,
        "unfulfilled_structured_wishes": wish_details,
        "free_text_wishes_require_review": [executor._alias(c.id) for c in executor.state.clinicians if c.planningWishes],
        "duty_burden_penalty": round(100*burden_penalty),
        "duty_history_from": start.isoformat(), "duty_history_to": end.isoformat(),
        "changed_existing_assignments": len(reference.symmetric_difference(current)) if reference else 0,
    }
