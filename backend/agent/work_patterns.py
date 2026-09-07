"""Soft workday targets, counted by assignment start date (including night duties).

A partial week's known excess is conclusive; its apparent deficit is not.
Whole weeks use integer bounds and an aggregate bound for fractional averages.
Holidays/vacations reduce the target pro rata over Mon–Fri (over all seven days
for targets above five). This is a preference convention, never a legal limit.
"""
from collections import defaultdict
from datetime import date, timedelta
from math import ceil, floor


def workday_metrics(executor, working):
    ctx = executor.ctx
    configured = [c for c in executor.state.clinicians if c.workPattern and c.workPattern.daysPerWeek is not None]
    configured_ids = {c.id for c in configured}
    weeks = sorted({date.fromisoformat(d) - timedelta(days=date.fromisoformat(d).weekday())
                    for d in ctx.target_day_isos})
    fixed = getattr(executor, "_workday_fixed_context", None)
    if fixed is None:
        fixed = defaultdict(set)
        for a in executor.fixed_assignments:
            if a.clinicianId not in configured_ids or a.rowId.startswith("pool-") or a.rowId not in ctx.all_slot_intervals:
                continue
            day = date.fromisoformat(a.dateISO)
            week = day - timedelta(days=day.weekday())
            if week in weeks:
                fixed[(a.clinicianId, week)].add(day)
        executor._workday_fixed_context = dict(fixed)
    worked = defaultdict(set, {key: set(days) for key, days in fixed.items()})
    for a in working:
        if a.clinicianId not in configured_ids or a.rowId.startswith("pool-") or a.rowId not in ctx.all_slot_intervals:
            continue
        day = date.fromisoformat(a.dateISO)
        week = day - timedelta(days=day.weekday())
        worked[(a.clinicianId, week)].add(day)
    holidays = {h.dateISO for h in executor.state.holidays}
    details = []
    averages = []
    deviation = unavoidable = 0
    for c in configured:
        target = c.workPattern.daysPerWeek
        complete_count = complete_target = complete_actual = 0
        complete_deviation = 0
        for week in weeks:
            dates = [week + timedelta(days=i) for i in range(7)]
            complete = all(d.isoformat() in ctx.target_date_set for d in dates)
            baseline = dates[:5] if target <= 5 else dates
            absent = sum(d.isoformat() in holidays or any(v.startISO <= d.isoformat() <= v.endISO for v in c.vacations)
                         for d in baseline)
            expected = target * (len(baseline) - absent) / len(baseline)
            lower, upper = floor(expected + 1e-8), ceil(expected - 1e-8)
            actual, fixed_count = len(worked[(c.id, week)]), len(fixed.get((c.id, week), ()))
            excess = max(0, actual - upper)
            missing = max(0, lower - actual) if complete else 0
            fixed_excess = max(0, fixed_count - upper)
            deviation += excess + missing
            unavoidable += fixed_excess
            if complete:
                complete_count += 1
                complete_target += expected
                complete_actual += actual
                complete_deviation += excess + missing
            details.append({"clinicianId": executor._alias(c.id), "weekStartISO": week.isoformat(),
                            "actual_days": actual, "fixed_days": fixed_count,
                            "target_days": round(expected, 3), "target_min_days": lower, "target_max_days": upper,
                            "assessment": "complete_week" if complete else "known_excess_only",
                            "deviation_days": excess + missing, "fixed_excess_days": fixed_excess})
        # 2.5 days/week permits 2 or 3 in each week, but two weeks should total 5.
        # Do not count the same deviation twice.
        if complete_count > 1:
            aggregate = max(0, floor(complete_target + 1e-8) - complete_actual,
                            complete_actual - ceil(complete_target - 1e-8))
            additional = max(0, aggregate - complete_deviation)
            deviation += additional
            averages.append({"clinicianId": executor._alias(c.id), "weeks": complete_count,
                             "actual_days": complete_actual, "target_days": round(complete_target, 3),
                             "additional_deviation_days": additional})
    return {"workday_deviation_days": deviation,
            "workday_fixed_excess_days": unavoidable,
            "workday_patterns": details,
            "workday_averages": averages,
            "workday_count_convention": "Assignment starting dates; partial weeks assessed for known excess only; vacation/holiday targets pro rata."}
