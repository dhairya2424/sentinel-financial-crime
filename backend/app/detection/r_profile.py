from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from app.detection.base import (
    ActionRecord,
    EmployeeProfile,
    Factor,
    Hit,
    RuleConfig,
    RuleContext,
    TransferRecord,
    format_duration,
    format_inr,
    local_hhmm,
    make_factor,
    unique,
    within_hours,
)

ROLE_CODE = "R-PROFILE_ROLE"
FLOW_CODE = "R-PROFILE_FLOW"


def _off_hours_factor(ts: datetime, tz: ZoneInfo, cfg: RuleConfig) -> Factor:
    start, end = cfg.params["business_hours"]
    inside = within_hours(ts, tz, start, end)
    word = "within" if inside else "outside"
    return make_factor(
        "employee_off_hours", f"{local_hhmm(ts, tz)} {word} {start}-{end}", cfg.weights["employee_off_hours"], 0.0 if inside else 1.0
    )


def _sensitivity_factor(action_type: str, cfg: RuleConfig) -> Factor:
    return make_factor(
        "action_sensitivity",
        action_type,
        cfg.weights["action_sensitivity"],
        cfg.params["action_sensitivity"].get(action_type, 0.5),
    )


def _access_gap(action_type: str, employee: EmployeeProfile, cfg: RuleConfig) -> tuple[bool, bool, list[str] | None]:
    allowed = cfg.params["allowed_roles"].get(action_type)
    if allowed is None:
        return True, True, None
    return employee.role in allowed, action_type in employee.active_entitlements, allowed


def evaluate_role_mismatch(action: ActionRecord, employee: EmployeeProfile, cfg: RuleConfig, tz: ZoneInfo) -> Hit | None:
    role_ok, entitled, allowed = _access_gap(action.action_type, employee, cfg)
    if allowed is None or (role_ok and entitled):
        return None
    w = cfg.weights
    allowed_text = ", ".join(allowed)
    if not role_ok and not entitled:
        access_raw, access_norm = f"{employee.role} lacks {action.action_type} (allowed: {allowed_text})", 1.0
    elif not role_ok:
        access_raw, access_norm = f"{employee.role} not permitted to {action.action_type} (allowed: {allowed_text})", 0.7
    else:
        access_raw, access_norm = f"{employee.role} lacks an active {action.action_type} entitlement", 0.7

    revoked_at = employee.revoked_entitlements.get(action.action_type)
    if not entitled and revoked_at and revoked_at <= action.ts:
        gap = action.ts - revoked_at
        horizon = timedelta(hours=cfg.params["revocation_window_hours"])
        temporal = make_factor(
            "temporal_proximity", f"{format_duration(gap)} after entitlement revoked", w["temporal_proximity"], 1 - gap / horizon
        )
        access_raw += f", revoked {format_duration(gap)} earlier"
    elif not entitled:
        temporal = make_factor("temporal_proximity", "no grant on record", w["temporal_proximity"], 0.5)
    else:
        temporal = make_factor("temporal_proximity", "no recent access change", w["temporal_proximity"], 0.0)

    factors = [
        make_factor("access_anomaly", access_raw, w["access_anomaly"], access_norm),
        _sensitivity_factor(action.action_type, cfg),
        temporal,
        _off_hours_factor(action.ts, tz, cfg),
    ]
    if not role_ok:
        explanation = (
            f"Employee {employee.name} (role: {employee.role}) performed '{action.action_type}' on "
            f"{action.target_type} {action.target_id} — outside permitted roles [{allowed_text}]."
        )
    else:
        explanation = (
            f"Employee {employee.name} (role: {employee.role}) performed '{action.action_type}' on "
            f"{action.target_type} {action.target_id} without an active '{action.action_type}' entitlement."
        )
    evidence = [("employee_action", action.act_id)]
    if action.target_type == "transaction":
        evidence.append(("transaction", action.target_id))
    return Hit(
        pattern_code=ROLE_CODE,
        title=f"{employee.role} performed {action.action_type} outside their access",
        entity_ids=unique([employee.id, action.customer_id, action.target_id]),
        factors=factors,
        evidence_refs=evidence,
        window_start=action.ts,
        window_end=action.ts,
        explanation=explanation,
    )


def evaluate_edit_then_flow(
    edit: ActionRecord,
    employee: EmployeeProfile,
    downstream: Iterable[TransferRecord],
    customer_accounts: set[str],
    flagged_tx_ids: set[str],
    cfg: RuleConfig,
    tz: ZoneInfo,
) -> Hit | None:
    p = cfg.params
    if edit.action_type not in p["edit_actions"] or not edit.customer_id:
        return None
    horizon = timedelta(hours=p["correlation_window_hours"])
    large = Decimal(str(p["reporting_threshold"])) * Decimal(str(p["flow_amount_ratio"]))
    amount_counts = edit.action_type in p.get("amount_trigger_actions", p["edit_actions"])
    triggering = sorted(
        (
            t
            for t in downstream
            if t.from_acct in customer_accounts
            and timedelta(0) <= t.ts - edit.ts <= horizon
            and (t.tx_id in flagged_tx_ids or (amount_counts and t.amount >= large))
        ),
        key=lambda t: t.ts,
    )
    if not triggering:
        return None

    w = cfg.weights
    role_ok, entitled, _ = _access_gap(edit.action_type, employee, cfg)
    if role_ok and entitled:
        access = make_factor(
            "access_anomaly", f"{employee.role} holds {edit.action_type}; edit preceded flagged flow", w["access_anomaly"], 0.4
        )
    else:
        access = make_factor(
            "access_anomaly", f"{employee.role} lacks {edit.action_type} access for this edit", w["access_anomaly"], 1.0
        )
    gap = triggering[0].ts - edit.ts
    total = sum((t.amount for t in triggering), Decimal(0))
    factors = [
        access,
        _sensitivity_factor(edit.action_type, cfg),
        make_factor(
            "temporal_proximity", f"{format_duration(gap)} between edit and first flagged transfer", w["temporal_proximity"], 1 - gap / horizon
        ),
        _off_hours_factor(edit.ts, tz, cfg),
    ]
    explanation = (
        f"Employee {employee.name} (role: {employee.role}) performed '{edit.action_type}' on customer {edit.customer_id} "
        f"at {local_hhmm(edit.ts, tz)}. The same customer's transfers of {format_inr(total)} followed within "
        f"{format_duration(gap)}: {', '.join(t.tx_id for t in triggering)}."
    )
    return Hit(
        pattern_code=FLOW_CODE,
        title="Profile edit followed by suspicious transfers",
        entity_ids=unique([employee.id, edit.customer_id, *(t.from_acct for t in triggering)]),
        factors=factors,
        evidence_refs=[("employee_action", edit.act_id), *(("transaction", t.tx_id) for t in triggering)],
        window_start=edit.ts,
        window_end=triggering[-1].ts,
        explanation=explanation,
    )


class RoleMismatchRule:
    code = ROLE_CODE

    def evaluate(self, ctx: RuleContext) -> list[Hit]:
        cfg = ctx.config(ROLE_CODE)
        hits = []
        for action in ctx.actions.actions:
            employee = ctx.actions.employees.get(action.employee_id)
            if employee and (hit := evaluate_role_mismatch(action, employee, cfg, ctx.tz)):
                hits.append(hit)
        return hits


class EditThenFlowRule:
    code = FLOW_CODE

    def evaluate(self, ctx: RuleContext) -> list[Hit]:
        cfg = ctx.config(FLOW_CODE)
        hits = []
        for action in ctx.actions.actions:
            employee = ctx.actions.employees.get(action.employee_id)
            if not employee or not action.customer_id:
                continue
            accounts = ctx.transfers.accounts_of(action.customer_id)
            hit = evaluate_edit_then_flow(
                action, employee, ctx.transfers.transfers, accounts, ctx.flagged_tx_ids, cfg, ctx.tz
            )
            if hit:
                hits.append(hit)
        return hits
