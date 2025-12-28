from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, Iterable, Optional

SHIFT_ROW_SEPARATOR = "::"


def _escape_text(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("\r\n", "\n")
        .replace("\r", "\n")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )


def _format_dtstamp(dt: datetime) -> str:
    utc = dt.astimezone(timezone.utc).replace(microsecond=0)
    return utc.strftime("%Y%m%dT%H%M%SZ")


def _iso_to_yyyymmdd(date_iso: str) -> str:
    return date_iso.replace("-", "")


def _add_days_iso(date_iso: str, days: int) -> str:
    year, month, day_ = (int(part) for part in date_iso.split("-"))
    next_date = date(year, month, day_)  # noqa: DTZ011
    next_date = next_date.fromordinal(next_date.toordinal() + days)
    return next_date.isoformat()


def _fold_ical_line(line: str) -> str:
    first_limit = 75
    next_limit = 74  # continuation lines start with a single space

    segments: list[str] = []
    current = ""
    current_limit = first_limit
    for ch in line:
        if current and len((current + ch).encode("utf-8")) > current_limit:
            segments.append(current)
            current = ch
            current_limit = next_limit
        else:
            current += ch
    if current:
        segments.append(current)

    if not segments:
        return line

    out = segments[0]
    for seg in segments[1:]:
        out += "\r\n " + seg
    return out


def _fold_lines(lines: Iterable[str]) -> str:
    return "\r\n".join(_fold_ical_line(line) for line in lines) + "\r\n"


def _parse_shift_row_id(row_id: str) -> tuple[str, Optional[str]]:
    if SHIFT_ROW_SEPARATOR not in row_id:
        return row_id, None
    class_id, sub_shift_id = row_id.split(SHIFT_ROW_SEPARATOR, 1)
    return class_id, sub_shift_id or None


def _resolve_sub_shift_name(row: Dict[str, Any], sub_shift_id: Optional[str]) -> Optional[str]:
    sub_shifts = row.get("subShifts") or []
    if not sub_shift_id:
        sub_shift_id = "s1"
    for shift in sub_shifts:
        if shift.get("id") == sub_shift_id:
            return shift.get("name") or None
    return None


def generate_ics(
    app_state: Dict[str, Any],
    published_week_start_isos: Optional[list[str]],
    cal_name: str,
    *,
    clinician_id: Optional[str] = None,
    dtstamp: Optional[datetime] = None,
) -> str:
    rows = app_state.get("rows") or []
    clinicians = app_state.get("clinicians") or []
    assignments = app_state.get("assignments") or []
    published_weeks = {iso for iso in (published_week_start_isos or []) if isinstance(iso, str)}

    row_by_id: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        row_id = row.get("id")
        if not row_id:
            continue
        row_by_id[row_id] = row

    clinician_name_by_id: Dict[str, str] = {}
    vacation_ranges_by_clinician: Dict[str, list[tuple[str, str]]] = {}
    for clinician in clinicians:
        clinician_key = clinician.get("id")
        if not clinician_key:
            continue
        clinician_name_by_id[clinician_key] = clinician.get("name") or clinician_key
        vacations = clinician.get("vacations") or []
        ranges: list[tuple[str, str]] = []
        for vacation in vacations:
            start = vacation.get("startISO")
            end = vacation.get("endISO")
            if isinstance(start, str) and isinstance(end, str) and start and end:
                ranges.append((start, end))
        vacation_ranges_by_clinician[clinician_key] = ranges

    stamp = dtstamp or datetime.now(timezone.utc)

    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//ShiftSchedule//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape_text(cal_name)}",
    ]

    for assignment in assignments:
        row_id = assignment.get("rowId")
        if not row_id:
            continue
        class_id, sub_shift_id = _parse_shift_row_id(row_id)
        row = row_by_id.get(class_id)
        if not row or row.get("kind") != "class":
            continue

        date_iso = assignment.get("dateISO")
        if not isinstance(date_iso, str):
            continue

        if published_weeks:
            try:
                date_value = date.fromisoformat(date_iso)
            except ValueError:
                continue
            week_start = (date_value - timedelta(days=date_value.weekday())).isoformat()
            if week_start not in published_weeks:
                continue
        else:
            continue

        assignment_clinician_id = assignment.get("clinicianId")
        if clinician_id and assignment_clinician_id != clinician_id:
            continue
        # The UI treats vacations as an override that removes class assignments from the schedule
        # (even if the raw assignment exists in persisted state). Mirror that behavior here.
        if assignment_clinician_id in vacation_ranges_by_clinician:
            for start, end in vacation_ranges_by_clinician[assignment_clinician_id]:
                if start <= date_iso <= end:
                    assignment_clinician_id = None
                    break
        if not assignment_clinician_id:
            continue
        clinician_name = clinician_name_by_id.get(
            assignment_clinician_id, assignment_clinician_id or "Unknown"
        )
        row_name = row.get("name") or class_id or "Section"
        sub_shift_name = _resolve_sub_shift_name(row, sub_shift_id)
        assignment_id = assignment.get("id") or f"{date_iso}-{row_id}-{assignment_clinician_id}"

        summary = (
            f"{row_name} ({sub_shift_name}) - {clinician_name}"
            if sub_shift_name
            else f"{row_name} - {clinician_name}"
        )
        start = _iso_to_yyyymmdd(date_iso)
        end = _iso_to_yyyymmdd(_add_days_iso(date_iso, 1))
        uid = f"{assignment_id}@shiftschedule"

        lines.extend(
            [
                "BEGIN:VEVENT",
                f"UID:{_escape_text(uid)}",
                f"DTSTAMP:{_format_dtstamp(stamp)}",
                f"DTSTART;VALUE=DATE:{start}",
                f"DTEND;VALUE=DATE:{end}",
                f"SUMMARY:{_escape_text(summary)}",
                "END:VEVENT",
            ]
        )

    lines.append("END:VCALENDAR")
    return _fold_lines(lines)
