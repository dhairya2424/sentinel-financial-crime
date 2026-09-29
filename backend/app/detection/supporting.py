from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.detection.base import (
    ActionWindow,
    EvidenceRef,
    Factor,
    RuleConfig,
    TransferRecord,
    TransferWindow,
    clamp01,
    format_inr,
    local_hhmm,
    unique,
    within_hours,
)


@dataclass
class SupportSignal:
    code: str
    entity_ids: list[str]
    factor: Factor
    evidence_refs: list[EvidenceRef]
    window_start: datetime
    window_end: datetime
    explanation: str


def _capped(name: str, raw: str, cap: float, norm: float) -> Factor:
    return Factor(name=name, raw_value=raw, weight=cap, contribution=round(cap * clamp01(norm), 4))


def _by_account(window: TransferWindow) -> dict[str, list[TransferRecord]]:
    grouped: dict[str, list[TransferRecord]] = defaultdict(list)
    for t in window.transfers:
        for acct in {t.from_acct, t.to_acct} - {None}:
            grouped[acct].append(t)
    for txs in grouped.values():
        txs.sort(key=lambda t: t.ts)
    return grouped


def velocity_signals(window: TransferWindow, cfg: RuleConfig) -> list[SupportSignal]:
    p = cfg.params
    signals = []
    for acct, txs in _by_account(window).items():
        profile = window.accounts.get(acct)
        if not profile or profile.baseline_30d_count <= 0 or len(txs) < 2:
            continue
        hours = max((txs[-1].ts - txs[0].ts).total_seconds() / 3600, 1.0)
        ratio = (len(txs) / hours) / (profile.baseline_30d_count / (30 * 24))
        if ratio <= p["ratio_trigger"]:
            continue
        norm = (ratio - p["ratio_trigger"]) / (p["full_at_ratio"] - p["ratio_trigger"])
        signals.append(
            SupportSignal(
                code="R-VELOCITY",
                entity_ids=unique([acct, profile.customer_id]),
                factor=_capped("account_velocity", f"{ratio:.1f}x baseline", p["cap"], norm),
                evidence_refs=[("transaction", t.tx_id) for t in txs],
                window_start=txs[0].ts,
                window_end=txs[-1].ts,
                explanation=f"Account {acct} moved {len(txs)} transfers at {ratio:.1f}× its usual hourly rate.",
            )
        )
    return signals


def offhours_signals(actions: ActionWindow, cfg: RuleConfig, tz: ZoneInfo) -> list[SupportSignal]:
    p = cfg.params
    signals = []
    for action in actions.actions:
        if not within_hours(action.ts, tz, p["start"], p["end"]):
            continue
        local = local_hhmm(action.ts, tz)
        signals.append(
            SupportSignal(
                code="R-OFFHOURS",
                entity_ids=unique([action.employee_id, action.customer_id, action.target_id]),
                factor=_capped("employee_off_hours", f"{local} within {p['start']}-{p['end']}", p["cap"], 1.0),
                evidence_refs=[("employee_action", action.act_id)],
                window_start=action.ts,
                window_end=action.ts,
                explanation=(
                    f"Employee {action.employee_id} performed '{action.action_type}' at {local}, "
                    f"inside the {p['start']}-{p['end']} quiet hours."
                ),
            )
        )
    return signals


def dormant_signals(window: TransferWindow, cfg: RuleConfig) -> list[SupportSignal]:
    p = cfg.params
    large = Decimal(str(p["reporting_threshold"])) * Decimal(str(p["amount_ratio"]))
    idle = timedelta(days=p["idle_days"])
    burst = timedelta(hours=p["window_hours"])
    signals = []
    for acct, txs in _by_account(window).items():
        profile = window.accounts.get(acct)
        if not profile or profile.last_activity_at is None:
            continue
        gap = txs[0].ts - profile.last_activity_at
        if gap < idle:
            continue
        large_txs = [t for t in txs if t.ts - txs[0].ts <= burst and t.amount >= large]
        if not large_txs:
            continue
        moved = sum((t.amount for t in large_txs), Decimal(0))
        signals.append(
            SupportSignal(
                code="R-DORMANT",
                entity_ids=unique([acct, profile.customer_id]),
                factor=_capped("dormancy_gap", f"{gap.days} days idle", p["cap"], gap / idle),
                evidence_refs=[("transaction", t.tx_id) for t in large_txs],
                window_start=large_txs[0].ts,
                window_end=large_txs[-1].ts,
                explanation=f"Account {acct} was idle for {gap.days} days, then moved {format_inr(moved)} within {p['window_hours']}h.",
            )
        )
    return signals
