from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.auth.deps import CurrentUser, get_current_user, require_role
from app.db import get_db
from app.detection.base import RuleConfig
from app.detection.config import DEFAULTS, PRIMARY_CODES, load_rule_configs
from app.ids import new_id
from app.models import Rule

router = APIRouter(prefix="/rules", tags=["rules"])
admin_role = require_role("admin")
WEIGHT_TOLERANCE = 0.001


class RuleOut(BaseModel):
    code: str
    name: str
    kind: str
    version: int
    enabled: bool
    params: dict[str, Any]
    weights: dict[str, float]
    updated_by: str | None = None
    updated_at: datetime | None = None


class RuleUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    params: dict[str, Any] | None = None
    weights: dict[str, float] | None = None
    enabled: bool | None = None


def _out(config: RuleConfig, row: Rule | None) -> RuleOut:
    return RuleOut(
        code=config.code,
        name=config.name,
        kind="primary" if config.code in PRIMARY_CODES else "supporting",
        version=config.version,
        enabled=config.enabled,
        params=config.params,
        weights=config.weights,
        updated_by=row.updated_by if row else None,
        updated_at=row.updated_at if row else None,
    )


async def _latest_rows(db: AsyncSession, tenant_id: str) -> dict[str, Rule]:
    rows = (await db.scalars(select(Rule).where(Rule.tenant_id == tenant_id).order_by(Rule.code, Rule.version))).all()
    return {row.code: row for row in rows}


def _same_shape(default: Any, value: Any) -> bool:
    if isinstance(default, bool) or isinstance(value, bool):
        return isinstance(default, bool) and isinstance(value, bool)
    if isinstance(default, (int, float)):
        return isinstance(value, (int, float))
    return isinstance(value, type(default))


def _validate(code: str, body: RuleUpdate, current: RuleConfig) -> tuple[dict[str, Any], dict[str, float]]:
    errors: list[str] = []
    params = dict(current.params)
    for key, value in (body.params or {}).items():
        default = DEFAULTS[code]["params"].get(key)
        if key not in DEFAULTS[code]["params"]:
            errors.append(f"unknown param {key!r}")
        elif not _same_shape(default, value):
            errors.append(f"param {key!r} must be {type(default).__name__}")
        elif isinstance(value, (int, float)) and not isinstance(value, bool) and value < 0:
            errors.append(f"param {key!r} must not be negative")
        else:
            params[key] = value
    weights = dict(current.weights)
    if body.weights is not None:
        unknown = sorted(set(body.weights) - set(DEFAULTS[code]["weights"]))
        missing = sorted(set(DEFAULTS[code]["weights"]) - set(body.weights))
        if unknown:
            errors.append(f"unknown factor(s) {', '.join(unknown)}")
        if missing:
            errors.append(f"weights must name every factor; missing {', '.join(missing)}")
        if any(w < 0 for w in body.weights.values()):
            errors.append("weights must not be negative")
        weights = dict(body.weights)
    total = sum(weights.values())
    if abs(total - 1.0) > WEIGHT_TOLERANCE:
        errors.append(f"weights must sum to 1.0 (±{WEIGHT_TOLERANCE}); they sum to {total:.4f}")
    if errors:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="; ".join(errors))
    return params, weights


@router.get("", response_model=list[RuleOut])
async def list_rules(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[RuleOut]:
    """The version detection uses right now, per code: the latest `rules` row, else the built-in default (version 0)."""
    configs = await load_rule_configs(db, user.tenant_id)
    rows = await _latest_rows(db, user.tenant_id)
    return [_out(configs[code], rows.get(code)) for code in DEFAULTS]


@router.put("/{code}", response_model=RuleOut)
async def update_rule(code: str, body: RuleUpdate, user: CurrentUser = Depends(admin_role), db: AsyncSession = Depends(get_db)) -> RuleOut:
    if code not in DEFAULTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="rule not found")
    if body.params is None and body.weights is None and body.enabled is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="send at least one of params, weights, enabled")
    current = (await load_rule_configs(db, user.tenant_id))[code]
    params, weights = _validate(code, body, current)
    enabled = current.enabled if body.enabled is None else body.enabled
    changed = {
        key: {"from": before, "to": after}
        for key, before, after in (("params", current.params, params), ("weights", current.weights, weights), ("enabled", current.enabled, enabled))
        if before != after
    }
    if not changed:
        return _out(current, (await _latest_rows(db, user.tenant_id)).get(code))
    latest = await db.scalar(select(func.max(Rule.version)).where(Rule.tenant_id == user.tenant_id, Rule.code == code))
    row = Rule(
        id=new_id("rule"),
        tenant_id=user.tenant_id,
        code=code,
        name=current.name,
        enabled=enabled,
        params=params,
        weights=weights,
        version=(latest or 0) + 1,
        updated_by=user.id,
    )
    db.add(row)
    audit.log(
        db,
        user.tenant_id,
        "rule.update",
        actor_user=user.id,
        object_type="rule",
        object_id=code,
        detail={"from_version": current.version, "to_version": row.version, "changed": changed},
    )
    await db.commit()
    await db.refresh(row)
    config = RuleConfig(code=code, name=row.name, version=row.version, enabled=row.enabled, params=row.params, weights=row.weights)
    return _out(config, row)
