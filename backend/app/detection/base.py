from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal, Protocol
from zoneinfo import ZoneInfo

EvidenceType = Literal["transaction", "employee_action", "access_right", "session"]
EvidenceRef = tuple[EvidenceType, str]


@dataclass(frozen=True)
class Factor:
    name: str
    raw_value: str
    weight: float
    contribution: float

    def as_dict(self) -> dict[str, str | float]:
        return {
            "name": self.name,
            "raw_value": self.raw_value,
            "weight": self.weight,
            "contribution": self.contribution,
        }


@dataclass
class Hit:
    pattern_code: str
    title: str
    entity_ids: list[str]
    factors: list[Factor]
    evidence_refs: list[EvidenceRef]
    window_start: datetime
    window_end: datetime
    explanation: str

    @property
    def score(self) -> int:
        return max(0, min(100, round(sum(f.contribution for f in self.factors) * 100)))


@dataclass(frozen=True)
class TransferRecord:
    tx_id: str
    from_acct: str | None
    to_acct: str | None
    amount: Decimal
    ts: datetime
    channel: str | None = None


@dataclass(frozen=True)
class AccountProfile:
    account_id: str
    customer_id: str | None = None
    baseline_30d_count: int = 0
    baseline_30d_amount: Decimal = Decimal(0)
    last_activity_at: datetime | None = None


@dataclass
class TransferWindow:
    transfers: list[TransferRecord]
    accounts: dict[str, AccountProfile] = field(default_factory=dict)

    def customer_of(self, account_id: str | None) -> str | None:
        if account_id is None:
            return None
        profile = self.accounts.get(account_id)
        return profile.customer_id if profile else None

    def accounts_of(self, customer_id: str) -> set[str]:
        return {a.account_id for a in self.accounts.values() if a.customer_id == customer_id}


@dataclass(frozen=True)
class ActionRecord:
    act_id: str
    employee_id: str
    action_type: str
    target_type: str
    target_id: str
    ts: datetime
    customer_id: str | None = None


@dataclass(frozen=True, eq=False)
class EmployeeProfile:
    id: str
    name: str
    role: str
    active_entitlements: frozenset[str] = frozenset()
    revoked_entitlements: dict[str, datetime] = field(default_factory=dict)


@dataclass
class ActionWindow:
    actions: list[ActionRecord]
    employees: dict[str, EmployeeProfile] = field(default_factory=dict)


@dataclass(frozen=True, eq=False)
class RuleConfig:
    code: str
    name: str
    version: int
    enabled: bool
    params: dict
    weights: dict[str, float]


@dataclass
class RuleContext:
    tenant_id: str
    configs: dict[str, RuleConfig]
    transfers: TransferWindow = field(default_factory=lambda: TransferWindow([]))
    actions: ActionWindow = field(default_factory=lambda: ActionWindow([]))
    timezone: str = "Asia/Kolkata"
    flagged_tx_ids: set[str] = field(default_factory=set)

    def config(self, code: str) -> RuleConfig:
        return self.configs[code]

    @property
    def tz(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


class Rule(Protocol):
    code: str

    def evaluate(self, ctx: RuleContext) -> list[Hit]: ...


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def make_factor(name: str, raw_value: str, weight: float, norm: float) -> Factor:
    return Factor(name=name, raw_value=raw_value, weight=weight, contribution=round(weight * clamp01(norm), 4))


def format_inr(amount: Decimal | int | float) -> str:
    value = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    whole = int(value)
    paise = int((value - whole) * 100)
    digits = str(abs(whole))
    head, tail = digits[:-3], digits[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    grouped = ",".join([*groups, tail]) if groups else tail
    sign = "-" if whole < 0 else ""
    return f"{sign}₹{grouped}" + (f".{paise:02d}" if paise else "")


def format_k(amount: Decimal) -> str:
    thousands = Decimal(amount) / 1000
    return f"{thousands.normalize():f}k"


def format_duration(delta: timedelta) -> str:
    hours = delta.total_seconds() / 3600
    if hours < 1:
        return f"{round(delta.total_seconds() / 60)}m"
    if hours < 48:
        text = f"{hours:.1f}".rstrip("0").rstrip(".")
        return f"{text}h"
    return f"{int(hours // 24)}d {int(hours % 24)}h"


def local_hhmm(ts: datetime, tz: ZoneInfo) -> str:
    return ts.astimezone(tz).strftime("%H:%M")


def within_hours(ts: datetime, tz: ZoneInfo, start: str, end: str) -> bool:
    local = ts.astimezone(tz).strftime("%H:%M")
    return start <= local < end if start < end else local >= start or local < end


def unique(items: list[str | None]) -> list[str]:
    seen: dict[str, None] = {}
    for item in items:
        if item:
            seen.setdefault(item, None)
    return list(seen)
