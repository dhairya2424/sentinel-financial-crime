from __future__ import annotations

import copy
from collections.abc import Iterable, Mapping
from typing import Any

from app.detection.base import RuleConfig

PROFILE_WEIGHTS = {"access_anomaly": 0.35, "action_sensitivity": 0.25, "temporal_proximity": 0.25, "employee_off_hours": 0.15}
ALLOWED_ROLES = {
    "tx.approve": ["teller", "manager", "finance_ops"],
    "limit.change": ["manager", "finance_ops"],
    "beneficiary.add": ["teller", "manager", "finance_ops"],
    "profile.edit": ["manager", "finance_ops", "analyst"],
}
ACTION_SENSITIVITY = {"tx.approve": 1.0, "limit.change": 0.9, "beneficiary.add": 0.8, "profile.edit": 0.6, "export.data": 0.7}
BUSINESS_HOURS = ["09:00", "19:00"]
EDIT_ACTIONS = ["profile.edit", "beneficiary.add", "limit.change"]

DEFAULTS: dict[str, dict[str, Any]] = {
    "R-CIRC": {
        "name": "Circular transfer",
        "params": {"window_hours": 72, "min_cycle_amount": 500000, "min_length": 3, "max_length": 6, "history_min": 5},
        "weights": {"linkage_depth": 0.25, "amount": 0.35, "temporal_proximity": 0.25, "account_velocity": 0.15},
    },
    "R-STRUCT": {
        "name": "Transaction structuring",
        "params": {
            "reporting_threshold": 50000,
            "band_floor_ratio": 0.8,
            "window_hours": 24,
            "min_in_band": 3,
            "total_multiple": 1.5,
            "baseline_multiple": 3,
        },
        "weights": {"sub_threshold_ratio": 0.35, "velocity_vs_baseline": 0.25, "total_amount": 0.25, "destination_spread": 0.15},
    },
    "R-PROFILE_ROLE": {
        "name": "Role-action mismatch",
        "params": {
            "allowed_roles": ALLOWED_ROLES,
            "action_sensitivity": ACTION_SENSITIVITY,
            "revocation_window_hours": 48,
            "business_hours": BUSINESS_HOURS,
        },
        "weights": PROFILE_WEIGHTS,
    },
    "R-PROFILE_FLOW": {
        "name": "Edit-then-flow correlation",
        "params": {
            "correlation_window_hours": 48,
            "reporting_threshold": 50000,
            "flow_amount_ratio": 0.8,
            "edit_actions": EDIT_ACTIONS,
            "amount_trigger_actions": ["beneficiary.add", "limit.change"],
            "allowed_roles": ALLOWED_ROLES,
            "action_sensitivity": ACTION_SENSITIVITY,
            "business_hours": BUSINESS_HOURS,
        },
        "weights": PROFILE_WEIGHTS,
    },
    "R-VELOCITY": {
        "name": "Transfer velocity",
        "params": {"ratio_trigger": 5, "full_at_ratio": 10, "cap": 0.40, "standalone_min_score": 60},
        "weights": {"account_velocity": 1.0},
    },
    "R-OFFHOURS": {
        "name": "Off-hours employee action",
        "params": {"start": "00:00", "end": "05:00", "cap": 0.25, "standalone_min_score": 60},
        "weights": {"employee_off_hours": 1.0},
    },
    "R-DORMANT": {
        "name": "Dormant reactivation",
        "params": {
            "idle_days": 90,
            "reporting_threshold": 50000,
            "amount_ratio": 0.8,
            "window_hours": 48,
            "cap": 0.45,
            "standalone_min_score": 60,
        },
        "weights": {"dormancy_gap": 1.0},
    },
}

PRIMARY_CODES = ("R-CIRC", "R-STRUCT", "R-PROFILE_ROLE", "R-PROFILE_FLOW")
SUPPORTING_CODES = ("R-VELOCITY", "R-OFFHOURS", "R-DORMANT")
TENANT_OVERRIDES = {"reporting_threshold": ("R-STRUCT", "R-PROFILE_FLOW", "R-DORMANT"), "min_cycle_amount": ("R-CIRC",)}


def default_config(code: str) -> RuleConfig:
    spec = DEFAULTS[code]
    return RuleConfig(
        code=code,
        name=spec["name"],
        version=0,
        enabled=True,
        params=copy.deepcopy(spec["params"]),
        weights=dict(spec["weights"]),
    )


def resolve_rule_configs(rows: Iterable[Any] = (), tenant_config: Mapping[str, Any] | None = None) -> dict[str, RuleConfig]:
    """Defaults, then tenant-level overrides, then the latest `rules` row per code."""
    configs = {code: default_config(code) for code in DEFAULTS}
    for key, codes in TENANT_OVERRIDES.items():
        if tenant_config and key in tenant_config:
            for code in codes:
                configs[code].params[key] = tenant_config[key]
    latest: dict[str, Any] = {}
    for row in rows:
        if row.code in configs and (row.code not in latest or row.version > latest[row.code].version):
            latest[row.code] = row
    for code, row in latest.items():
        base = configs[code]
        configs[code] = RuleConfig(
            code=code,
            name=row.name or base.name,
            version=row.version,
            enabled=row.enabled,
            params={**base.params, **(row.params or {})},
            weights={**base.weights, **(row.weights or {})},
        )
    return configs


async def load_rule_configs(session: Any, tenant_id: str) -> dict[str, RuleConfig]:
    from sqlalchemy import select

    from app.models import Rule, Tenant

    tenant = await session.get(Tenant, tenant_id)
    rows = (await session.scalars(select(Rule).where(Rule.tenant_id == tenant_id))).all()
    return resolve_rule_configs(rows, tenant.config if tenant else None)
