"""Shared interpretation of personal work patterns for scoring and tools."""


def daily_target_minutes(clinician, window=None):
    pattern = clinician.workPattern
    contract = clinician.workingHoursPerWeek
    if pattern and pattern.dailyHours is not None:
        target = round(pattern.dailyHours * 60)
    elif contract is not None and contract > 0:
        days = pattern.daysPerWeek if pattern and pattern.daysPerWeek else 5
        target = round(contract * 60 / days)
        if not pattern or not pattern.daysPerWeek:
            target = min(target, 600)  # preserve the legacy default
    else:
        target = 480
    if window is not None:
        target = min(target, max(60, window[2]-window[1]))
    return max(60, target)


def daily_min_minutes(clinician, window=None):
    pattern = clinician.workPattern
    if pattern and (pattern.dailyHours is not None or pattern.daysPerWeek is not None):
        return max(1, daily_target_minutes(clinician, window)//2)
    if window is not None:
        return max(1, (window[2]-window[1])//2)
    contract = clinician.workingHoursPerWeek
    if contract is not None and contract > 0:
        return max(1, round(contract*60/5)//2)
    return None
