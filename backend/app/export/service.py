"""Case evidence export (PRD D3, docs/05 §6 bundle, ADR-004, ADR-008, docs/08 §6).

The bundle carries only frozen evidence snapshots, the graph around the case's entities, their merged timeline, the
notes and the decision history. `digest_sha256` is SHA-256 over the canonical JSON of the bundle without
`generated_at`, `generated_by` and the digest itself. Canonical means keys sorted, separators `(",", ":")` and UTF-8,
so exporting unchanged data again, by anyone, gives the same digest. To verify a downloaded file, drop those three
keys and hash `json.dumps(rest, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.

Exports themselves are audited (`case.export`) but left out of the bundle's audit list, or each export would change
the next one's digest.
"""

import hashlib
import json
from dataclasses import asdict
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.alerts import _entities, _factors, _labels
from app.api.graph import _ensure_graph
from app.auth.deps import CurrentUser
from app.cases.service import _case, _names, case_audit, case_notes, case_row, linked_alerts
from app.detection.base import format_inr
from app.graph.service import graph_service
from app.models import AlertEvidence, Case
from app.services.timeline import build_timeline

GRAPH_NODE_CAP = 300
TIMELINE_CAP = 200
EVIDENCE_TARGET = 500  # PRD D3: ≤ 500 records export within 5 s
EVIDENCE_CAP = 5_000  # beyond this the bundle is cut and says so; evidence is never dropped below it
UNHASHED = ("generated_at", "generated_by", "digest_sha256")
ENTITY_TYPES = {"cust_": "customer", "acct_": "account", "emp_": "employee"}

_templates = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=select_autoescape(default=True, default_for_string=True),  # docs/08 §2 T8: names and notes are user text
    trim_blocks=True,
    lstrip_blocks=True,
)
_templates.filters["inr"] = lambda v: format_inr(v) if v not in (None, "") else ""


def _native(value: Any) -> Any:
    """JSON-ready values with one fixed spelling per type, so the digest does not depend on the serializer."""
    return json.loads(json.dumps(value, default=_default, ensure_ascii=False))


def _default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat().replace("+00:00", "Z")
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, "model_dump"):
        return value.model_dump()
    raise TypeError(f"{type(value).__name__} is not JSON serialisable")


def canonical(bundle: dict[str, Any]) -> bytes:
    return json.dumps({k: v for k, v in bundle.items() if k not in UNHASHED}, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def digest_of(bundle: dict[str, Any]) -> str:
    return hashlib.sha256(canonical(bundle)).hexdigest()


async def _alerts(db: AsyncSession, case: Case) -> tuple[list[dict[str, Any]], int, bool]:
    alerts = await linked_alerts(db, case.tenant_id, case.id)
    evidence = (
        list(
            await db.scalars(
                select(AlertEvidence)
                .where(AlertEvidence.alert_id.in_([a.id for a in alerts]), AlertEvidence.tenant_id == case.tenant_id)
                .order_by(AlertEvidence.alert_id, AlertEvidence.evidence_type, AlertEvidence.ref_id)
                .limit(EVIDENCE_CAP + 1)
            )
        )
        if alerts
        else []
    )
    truncated = len(evidence) > EVIDENCE_CAP
    by_alert: dict[str, list[dict[str, Any]]] = {}
    for e in evidence[:EVIDENCE_CAP]:
        by_alert.setdefault(e.alert_id, []).append({"type": e.evidence_type, "ref_id": e.ref_id, "snapshot": e.snapshot, "captured_at": e.captured_at})
    labels = await _labels(db, case.tenant_id, {i for a in alerts for i in a.entity_ids})
    out = []
    for a in alerts:
        items = by_alert.get(a.id, [])
        amounts = [Decimal(str(i["snapshot"]["amount"])) for i in items if i["type"] == "transaction" and "amount" in i["snapshot"]]
        out.append(
            {
                "id": a.id,
                "rule_code": a.rule_code,
                "rule_version": a.rule_version,
                "title": a.title,
                "explanation": a.explanation,
                "risk_score": a.risk_score,
                "risk_band": a.risk_band,
                "risk_factors": _factors(list(a.risk_factors)),
                "status": a.status,
                "entity_ids": list(a.entity_ids),
                "entities": _entities(a, labels),
                "amount_total": str(sum(amounts, Decimal(0))) if amounts else None,
                "window_start": a.window_start,
                "window_end": a.window_end,
                "detected_at": a.detected_at,
                "occurrence_count": a.occurrence_count,
                "evidence": items,
            }
        )
    return out, min(len(evidence), EVIDENCE_CAP), truncated


async def _graph(db: AsyncSession, tenant_id: str, entity_ids: list[str]) -> dict[str, Any]:
    """The case's entities and their direct neighbours (any relation), capped at 300 nodes, in a fixed order."""
    await _ensure_graph(db, tenant_id)
    g = graph_service.graph(tenant_id)
    seeds = sorted(e for e in set(entity_ids) if e in g)
    chosen = list(seeds)
    seen = set(seeds)
    truncated = False
    for node in seeds:
        for other in sorted(set(g.successors(node)) | set(g.predecessors(node))):
            if other in seen:
                continue
            if len(chosen) >= GRAPH_NODE_CAP:
                truncated = True
                break
            seen.add(other)
            chosen.append(other)
    sub = graph_service.subgraph(tenant_id, chosen)
    return {
        "nodes": sorted(sub["nodes"], key=lambda n: n["id"]),
        "edges": sorted(sub["edges"], key=lambda e: (e["id"], e["source"], e["target"])),
        "focus": seeds,
        "truncated": truncated,
    }


async def _timeline(db: AsyncSession, tenant_id: str, entity_ids: list[str]) -> list[dict[str, Any]]:
    """The last 200 events across the case's customers, accounts and employees, each once, newest first."""
    merged: dict[tuple[str, str], dict[str, Any]] = {}
    for entity_id in sorted(set(entity_ids)):
        kind = next((t for p, t in ENTITY_TYPES.items() if entity_id.startswith(p)), None)
        if kind is None:
            continue
        items, _ = await build_timeline(db, tenant_id, kind, entity_id, limit=TIMELINE_CAP)  # type: ignore[arg-type]
        for item in items:
            merged.setdefault((item.event_kind, item.ref_id), {**asdict(item), "viewpoint": entity_id})
    ordered = sorted(merged.values(), key=lambda i: (i["ts"], i["ref_id"]), reverse=True)
    return ordered[:TIMELINE_CAP]


async def build_bundle(db: AsyncSession, user: CurrentUser, case_id: str) -> dict[str, Any]:
    case = await _case(db, user.tenant_id, case_id)
    alerts, evidence_count, truncated = await _alerts(db, case)
    entity_ids = [e for a in alerts for e in a["entity_ids"]]
    names = await _names(db, user.tenant_id, {case.assignee_id, case.created_by, user.id})
    case_part = {k: v for k, v in case_row(case).items() if k != "export_digest"}  # the digest is an output, never an input
    case_part |= {"assignee_name": names.get(case.assignee_id or ""), "created_by_name": names.get(case.created_by)}
    bundle = _native(
        {
            "case": case_part,
            "generated_at": datetime.now(UTC),
            "generated_by": {"id": user.id, "name": names.get(user.id), "role": user.role},
            "alerts": alerts,
            "evidence_count": evidence_count,
            "evidence_truncated": truncated,
            "graph_snapshot": await _graph(db, user.tenant_id, entity_ids),
            "timeline": await _timeline(db, user.tenant_id, entity_ids),
            "notes": await case_notes(db, user.tenant_id, case.id),
            "audit": await case_audit(db, user.tenant_id, case.id, [a["id"] for a in alerts], include_exports=False),
        }
    )
    bundle["digest_sha256"] = digest_of(bundle)
    return bundle


def render_html(bundle: dict[str, Any]) -> str:
    return _templates.get_template("case_report.html").render(b=bundle)
