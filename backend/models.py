from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

RowKind = Literal["class", "pool"]
Role = Literal["admin", "user"]
ThenType = Literal["shiftRow", "off"]


class UserPublic(BaseModel):
    username: str
    role: Role
    active: bool


class UserCreateRequest(BaseModel):
    username: str
    password: str
    role: Role = "user"
    importState: Optional[Dict[str, Any]] = None


class UserUpdateRequest(BaseModel):
    active: Optional[bool] = None
    role: Optional[Role] = None
    password: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class Location(BaseModel):
    id: str
    name: str


class SubShift(BaseModel):
    id: str
    name: str
    order: Literal[1, 2, 3]
    startTime: Optional[str] = None
    endTime: Optional[str] = None
    endDayOffset: Optional[int] = None
    hours: Optional[float] = None


class WorkplaceRow(BaseModel):
    id: str
    name: str
    kind: RowKind
    dotColorClass: str
    locationId: Optional[str] = None
    subShifts: List[SubShift] = Field(default_factory=list)


class VacationRange(BaseModel):
    id: str
    startISO: str
    endISO: str


class Holiday(BaseModel):
    dateISO: str
    name: str


class Clinician(BaseModel):
    id: str
    name: str
    qualifiedClassIds: List[str]
    preferredClassIds: List[str] = []
    vacations: List[VacationRange]
    workingHoursPerWeek: Optional[float] = None


class Assignment(BaseModel):
    id: str
    rowId: str
    dateISO: str
    clinicianId: str


class MinSlots(BaseModel):
    weekday: int
    weekend: int


class AppState(BaseModel):
    locations: List[Location] = Field(default_factory=list)
    locationsEnabled: bool = True
    rows: List[WorkplaceRow]
    clinicians: List[Clinician]
    assignments: List[Assignment]
    minSlotsByRowId: Dict[str, MinSlots]
    slotOverridesByKey: Dict[str, int] = Field(default_factory=dict)
    holidayCountry: Optional[str] = None
    holidayYear: Optional[int] = None
    holidays: List[Holiday] = Field(default_factory=list)
    publishedWeekStartISOs: List[str] = Field(default_factory=list)
    solverSettings: Dict[str, Any] = Field(default_factory=dict)
    solverRules: List[Dict[str, Any]] = Field(default_factory=list)


class UserStateExport(BaseModel):
    version: int = 1
    exportedAt: str
    sourceUser: str
    state: AppState


class SolveDayRequest(BaseModel):
    dateISO: str
    only_fill_required: bool = False


class SolveDayResponse(BaseModel):
    dateISO: str
    assignments: List[Assignment]
    notes: List[str]


class SolverSettings(BaseModel):
    allowMultipleShiftsPerDay: bool = False
    enforceSameLocationPerDay: bool = False
    onCallRestEnabled: bool = False
    onCallRestClassId: Optional[str] = None
    onCallRestDaysBefore: int = 1
    onCallRestDaysAfter: int = 1


class SolverRule(BaseModel):
    id: str
    name: str
    enabled: bool = True
    ifShiftRowId: str
    dayDelta: Literal[-1, 1]
    thenType: ThenType
    thenShiftRowId: Optional[str] = None


class SolveWeekRequest(BaseModel):
    startISO: str
    endISO: Optional[str] = None
    only_fill_required: bool = False


class SolveWeekResponse(BaseModel):
    startISO: str
    endISO: str
    assignments: List[Assignment]
    notes: List[str]


class IcalPublishRequest(BaseModel):
    pass


class IcalPublishAllLink(BaseModel):
    subscribeUrl: str


class IcalPublishClinicianLink(BaseModel):
    clinicianId: str
    clinicianName: str
    subscribeUrl: str


class IcalPublishStatus(BaseModel):
    published: bool
    all: Optional[IcalPublishAllLink] = None
    clinicians: List[IcalPublishClinicianLink] = Field(default_factory=list)


class WebPublishStatus(BaseModel):
    published: bool
    token: Optional[str] = None
