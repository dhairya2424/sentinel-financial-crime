"""T-INT-11..16 and T-INT-18: case lifecycle, role rules, evidence export and the audit trail (docs/10 §5)."""

import asyncio
import hashlib
import json
import re
import time
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.ids import new_id
from app.models import Alert, AlertEvidence

from .conftest import TENANT_A, TENANT_B

NOTE = "Confirmed with the branch: the loop was a layering attempt."


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


async def _insert_alerts(specs: list[tuple[str, list[str], str, int]]) -> None:
    """Alerts as the pipeline stores them: frozen transaction snapshots as evidence (ADR-004)."""
    own = create_async_engine(get_settings().DATABASE_URL, poolclass=NullPool)
    now = datetime.now(UTC)
    async with AsyncSession(own) as db, db.begin():
        for alert_id, entities, band, score in specs:
            db.add(
                Alert(
                    id=alert_id,
                    tenant_id=TENANT_A,
                    rule_code="R-CIRC",
                    rule_version=1,
                    title="Circular transfer across 3 accounts",
                    explanation="₹4,20,000 moved in a loop across 3 accounts within 6h.",
                    risk_score=score,
                    risk_band=band,
                    risk_factors=[
                        {"name": "linkage_depth", "raw_value": "3 hops", "weight": 0.25, "contribution": 0.25},
                        {"name": "amount", "raw_value": "no baseline", "weight": 0.35, "contribution": 0.175},
                    ],
                    entity_ids=entities,
                    window_start=now - timedelta(hours=6),
                    window_end=now,
                    dedup_key=f"test:{alert_id}",
                )
            )
            await db.flush()
            for leg in (1, 2):
                db.add(
                    AlertEvidence(
                        id=new_id("ev"),
                        tenant_id=TENANT_A,
                        alert_id=alert_id,
                        evidence_type="transaction",
                        ref_id=f"{alert_id}_tx{leg}",
                        snapshot={"id": f"{alert_id}_tx{leg}", "amount": "210000.00", "from_account_id": entities[0], "to_account_id": entities[-1], "value_ts": iso(now)},
                    )
                )
    await own.dispose()


@pytest.fixture(scope="module")
def make_alerts(world):
    def make(*entity_sets: list[str], band: str = "high", score: int = 74) -> list[str]:
        ids = [new_id("alert") for _ in entity_sets]
        asyncio.run(_insert_alerts([(i, e, band, score) for i, e in zip(ids, entity_sets, strict=True)]))
        return ids

    return make


@pytest.fixture(scope="module")
def activity(client, world) -> None:
    """One real transfer between the case's accounts, so the graph snapshot and the timeline have something to show."""
    event = {
        "kind": "transaction",
        "id": f"{world.tx}_case",
        "from_account_id": world.account,
        "to_account_id": world.other_account,
        "amount": "1500.00",
        "channel": "upi",
        "value_ts": iso(datetime.now(UTC) - timedelta(hours=1)),
    }
    r = client.post("/v1/ingest/events", json={"events": [event]}, headers=world.bearer(TENANT_A))
    assert r.status_code == 202 and r.json()["accepted"] == 1, r.text


def create(client, world, role: str = "investigator", **body):
    return client.post("/v1/cases", json={"title": "Loop through payee accounts", **body}, headers=world.bearer(TENANT_A, role))


def patch(client, world, case_id: str, role: str = "investigator", **body):
    return client.patch(f"/v1/cases/{case_id}", json=body, headers=world.bearer(TENANT_A, role))


def test_t_int_11_create_from_two_alerts_and_group_by_shared_entities(client, world, make_alerts):
    a1, a2 = make_alerts([world.account, world.customer], [world.other_account], band="critical", score=88)
    r = create(client, world, alert_ids=[a1, a2])
    assert r.status_code == 201, r.text
    case = r.json()
    assert re.fullmatch(rf"CASE-{datetime.now(UTC).year}-\d{{4}}", case["case_number"])
    assert case["status"] == "open" and case["priority"] == "critical" and case["alert_count"] == 2
    assert {a["id"]: a["status"] for a in case["alerts"]} == {a1: "linked_to_case", a2: "linked_to_case"}
    assert case["alerts"][0]["entities"], "linked alerts carry the names people know"

    # Grouping: b1 names the account; b2 shares it; b3 shares nothing with b1 and stays out.
    b1, b2, b3 = make_alerts([world.account], [world.account, f"{world.account}_c"], [f"acct_elsewhere_{world.suffix}"])
    grouped = create(client, world, alert_ids=[b1], group_by_entities=True).json()
    assert {a["id"] for a in grouped["alerts"]} == {b1, b2}
    assert int(grouped["case_number"].rsplit("-", 1)[1]) == int(case["case_number"].rsplit("-", 1)[1]) + 1

    assert create(client, world, alert_ids=[a1]).status_code == 409, "an alert already in a case cannot start another"
    assert create(client, world, alert_ids=["alert_nope"]).status_code == 404
    assert create(client, world, role="viewer", alert_ids=[b3]).status_code == 403


def test_t_int_12_assign_follows_the_role_matrix(client, world):
    case = create(client, world).json()
    target = {"assignee_id": "usr_itest_investigator"}
    assert client.post(f"/v1/cases/{case['id']}/assign", json={"assignee_id": "usr_itest_manager"}, headers=world.bearer(TENANT_A)).status_code == 403
    assert client.post(f"/v1/cases/{case['id']}/assign", json=target, headers=world.bearer(TENANT_A, "viewer")).status_code == 403
    assert client.post(f"/v1/cases/{case['id']}/assign", json={"assignee_id": "usr_itest_viewer"}, headers=world.bearer(TENANT_A, "manager")).status_code == 422
    r = client.post(f"/v1/cases/{case['id']}/assign", json=target, headers=world.bearer(TENANT_A, "manager"))
    assert r.status_code == 200, r.text
    assert r.json()["assignee_id"] == "usr_itest_investigator" and r.json()["status"] == "in_review"
    assert r.json()["assignee_name"] == "Itest investigator"

    mine = create(client, world).json()
    assert client.post(f"/v1/cases/{mine['id']}/assign", json=target, headers=world.bearer(TENANT_A)).status_code == 200, "self-assign is allowed"
    queue = client.get("/v1/cases", params={"assignee": "me", "status": "in_review"}, headers=world.bearer(TENANT_A)).json()["items"]
    assert {case["id"], mine["id"]} <= {c["id"] for c in queue}


def test_t_int_13_close_needs_a_note_and_carries_the_verdict_to_alerts(client, world, make_alerts):
    a1, a2 = make_alerts([world.account], [world.other_account])
    case = create(client, world, alert_ids=[a1, a2]).json()
    assert patch(client, world, case["id"], status="closed_confirmed", close_note=NOTE).status_code == 403, "never reviewed: a manager's call"
    assert patch(client, world, case["id"], status="in_review").status_code == 200

    missing = patch(client, world, case["id"], status="closed_confirmed")
    assert missing.status_code == 422 and missing.json()["detail"] == "close_note required (>=10 chars)"
    assert patch(client, world, case["id"], status="closed_confirmed", close_note="   too short ").status_code == 422

    closed = patch(client, world, case["id"], status="closed_confirmed", close_note=NOTE)
    assert closed.status_code == 200, closed.text
    body = closed.json()
    assert body["status"] == "closed_confirmed" and body["closed_at"] is not None
    assert {a["status"] for a in body["alerts"]} == {"closed_confirmed"}
    assert body["notes"][-1]["body"] == NOTE
    for alert_id in (a1, a2):
        assert client.get(f"/v1/alerts/{alert_id}", headers=world.bearer(TENANT_A)).json()["status"] == "closed_confirmed"

    (b1,) = make_alerts([world.account])
    fp = create(client, world, alert_ids=[b1]).json()
    r = patch(client, world, fp["id"], role="manager", status="closed_false_positive", close_note="Salary sweep between own accounts.")
    assert r.status_code == 200 and r.json()["alerts"][0]["status"] == "closed_false_positive"


def test_t_int_14_transitions_only_move_forward(client, world):
    case = create(client, world).json()
    bad = patch(client, world, case["id"], status="escalated")
    assert bad.status_code == 400 and bad.json()["detail"] == "a case cannot move from open to escalated"
    assert patch(client, world, case["id"], status="open").status_code == 400, "a no-op is refused"
    assert patch(client, world, case["id"], status="in_review").status_code == 200
    assert patch(client, world, case["id"], status="escalated", priority="critical").json()["priority"] == "critical"
    assert patch(client, world, case["id"], status="in_review").status_code == 400, "no way back"
    assert patch(client, world, case["id"], status="closed_false_positive", close_note="Known payroll pattern, verified.").status_code == 200
    assert patch(client, world, case["id"], priority="low").status_code == 409, "closed is final"
    assert client.post(f"/v1/cases/{case['id']}/notes", json={"body": "late"}, headers=world.bearer(TENANT_A)).status_code == 409


@pytest.fixture(scope="module")
def exported_case(client, world, make_alerts, activity) -> dict:
    a1, a2 = make_alerts([world.account, world.customer, world.other_account], [world.other_account])
    case = create(client, world, alert_ids=[a1, a2], description="Two linked alerts on the payee side.").json()
    note = client.post(f"/v1/cases/{case['id']}/notes", json={"body": "Holder says <script>alert(1)</script> was a gift."}, headers=world.bearer(TENANT_A))
    assert note.status_code == 201, note.text
    return case


def test_t_int_15_json_export_is_complete_and_its_digest_is_stable(client, world, exported_case):
    url = f"/v1/cases/{exported_case['id']}/export"
    assert client.get(url, headers=world.bearer(TENANT_A, "viewer")).status_code == 403
    started = time.perf_counter()
    first = client.get(url, params={"format": "json"}, headers=world.bearer(TENANT_A))
    elapsed = (time.perf_counter() - started) * 1000
    print(f"\nT-INT-15 export latency: {elapsed:.0f} ms")
    assert first.status_code == 200 and elapsed < 5000
    assert first.headers["content-disposition"] == f'attachment; filename="sentinel-case-{exported_case["case_number"]}.json"'
    assert first.headers["x-content-type-options"] == "nosniff"
    bundle = first.json()
    digest = bundle["digest_sha256"]
    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    rest = {k: v for k, v in bundle.items() if k not in ("generated_at", "generated_by", "digest_sha256")}
    assert hashlib.sha256(json.dumps(rest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest() == digest
    assert set(bundle) >= {"case", "generated_at", "generated_by", "alerts", "graph_snapshot", "timeline", "notes", "audit", "digest_sha256"}
    assert bundle["generated_by"]["id"] == "usr_itest_investigator"
    assert bundle["alerts"][0]["evidence"] and bundle["alerts"][0]["evidence"][0]["snapshot"]["amount"] == "210000.00"
    assert bundle["alerts"][0]["risk_factors"][1]["imputed"] is True
    assert bundle["graph_snapshot"]["nodes"] and world.account in bundle["graph_snapshot"]["focus"]
    assert any(i["ref_id"] == f"{world.tx}_case" for i in bundle["timeline"])
    assert bundle["evidence_count"] == 4 and bundle["evidence_truncated"] is False

    again = client.get(url, params={"format": "json"}, headers=world.bearer(TENANT_A, "manager")).json()
    assert again["digest_sha256"] == digest, "ADR-008: unchanged data, same digest, whoever exports"
    assert client.get(f"/v1/cases/{exported_case['id']}", headers=world.bearer(TENANT_A)).json()["export_digest"] == digest

    client.post(f"/v1/cases/{exported_case['id']}/notes", json={"body": "Asked the bank for KYC copies."}, headers=world.bearer(TENANT_A))
    assert client.get(url, headers=world.bearer(TENANT_A)).json()["digest_sha256"] != digest, "a new note is new content"


def test_t_int_16_html_export_is_a_printable_escaped_attachment(client, world, exported_case):
    r = client.get(f"/v1/cases/{exported_case['id']}/export", params={"format": "html"}, headers=world.bearer(TENANT_A))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    assert r.headers["content-disposition"] == f'attachment; filename="sentinel-case-{exported_case["case_number"]}.html"'
    assert r.headers["x-content-type-options"] == "nosniff"
    html = r.text
    assert html.startswith("<!doctype html>") and "<html" in html and exported_case["case_number"] in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html and "<script>alert(1)" not in html, "docs/08 T8: user text is escaped"
    assert "@media print" in html and "linkage_depth" in html and "neutral default" in html


def test_t_int_18_the_journey_leaves_every_mandatory_audit_row(client, world, make_alerts):
    (a1,) = make_alerts([world.account])
    case = create(client, world, alert_ids=[a1]).json()
    manager = world.bearer(TENANT_A, "manager")
    assert client.post(f"/v1/cases/{case['id']}/assign", json={"assignee_id": "usr_itest_investigator"}, headers=manager).status_code == 200
    assert client.post(f"/v1/cases/{case['id']}/notes", json={"body": "Called the holder."}, headers=world.bearer(TENANT_A)).status_code == 201
    assert patch(client, world, case["id"], status="closed_confirmed", close_note=NOTE).status_code == 200
    assert client.get(f"/v1/cases/{case['id']}/export", headers=world.bearer(TENANT_A)).status_code == 200
    trail = client.get(f"/v1/cases/{case['id']}", headers=world.bearer(TENANT_A)).json()["audit"]
    actions = {r["action"] for r in trail}
    assert {"case.create", "alert.link", "case.assign", "case.note", "case.status", "case.export"} <= actions
    status_row = next(r for r in trail if r["action"] == "case.status")
    assert status_row["detail"]["from"] == "in_review" and status_row["detail"]["to"] == "closed_confirmed" and status_row["actor_name"] == "Itest investigator"
    assign_row = next(r for r in trail if r["action"] == "case.assign")
    assert assign_row["actor_user"] == "usr_itest_manager" and assign_row["detail"]["status"] == {"from": "open", "to": "in_review"}


def test_case_changes_are_announced_on_the_cases_channel(client, world):
    token = world.bearer(TENANT_A)["Authorization"].split()[1]
    case = create(client, world).json()
    with client.websocket_connect(f"/v1/ws?token={token}") as ws:
        ws.send_json({"op": "subscribe", "channels": [f"cases:{TENANT_A}"]})
        assert ws.receive_json()["type"] == "subscribed"
        assert patch(client, world, case["id"], status="in_review").status_code == 200
        msg = ws.receive_json()
    assert msg["channel"] == f"cases:{TENANT_A}" and msg["type"] == "case.updated"
    assert msg["data"]["id"] == case["id"] and msg["data"]["status"] == "in_review"
    assert set(msg["data"]) == {"id", "status", "assignee_id", "updated_at"}


def test_cases_stay_inside_their_tenant(client, world):
    case = create(client, world).json()
    other = world.bearer(TENANT_B)
    assert client.get(f"/v1/cases/{case['id']}", headers=other).status_code == 404
    assert client.get(f"/v1/cases/{case['id']}/export", headers=other).status_code == 404
    assert case["id"] not in [c["id"] for c in client.get("/v1/cases", headers=other).json()["items"]]


def test_t_int_20_dashboard_metrics_reflect_cases_and_alerts(client, world, make_alerts):
    """T-INT-20: a new critical alert increments critical_24h (and alerts_24h) by exactly one."""
    before = client.get("/v1/dashboard/metrics", headers=world.bearer(TENANT_A, "viewer")).json()
    make_alerts([world.account], band="critical", score=90)
    assert client.post("/v1/cases", json={"title": "Dashboard count"}, headers=world.bearer(TENANT_A)).status_code == 201
    m = client.get("/v1/dashboard/metrics", headers=world.bearer(TENANT_A, "viewer"))
    assert m.status_code == 200, m.text
    data = m.json()
    assert set(data) >= {"open_cases", "critical_24h", "high_24h", "alerts_24h", "fp_rate_7d", "top_entities", "ingest"}
    assert data["critical_24h"] == before["critical_24h"] + 1 and data["alerts_24h"] == before["alerts_24h"] + 1
    assert data["open_cases"] == before["open_cases"] + 1 and data["alerts_24h"] >= data["critical_24h"] + data["high_24h"]
    assert data["fp_rate_7d"] is None or 0 <= data["fp_rate_7d"] <= 1
    assert data["top_entities"][0]["entity_id"] == world.account and data["top_entities"][0]["label"] == f"XXXXIT{world.suffix}"
    assert set(data["ingest"]) == {"events_per_min", "lag_ms", "backlog"}
    assert set(data["totals"]) == {"events", "entities", "alerts", "cases", "exported_cases"}
    assert data["totals"]["alerts"] >= data["alerts_24h"] and data["totals"]["cases"] >= data["open_cases"]
    assert data["totals"]["entities"] >= 3, "the itest customers and accounts"
    assert set(data["detection"]) == {"latency_p95_ms", "latency_samples"}


def test_assignees_lists_people_who_can_work_a_case(client, world):
    for role in ("viewer", "investigator", "manager"):
        r = client.get("/v1/users/assignees", headers=world.bearer(TENANT_A, role))
        assert r.status_code == 200, r.text
        people = {p["id"]: p for p in r.json()}
        assert {"usr_itest_investigator", "usr_itest_manager", "usr_itest_admin"} <= set(people)
        assert "usr_itest_viewer" not in people and set(next(iter(people.values()))) == {"id", "full_name", "role"}
    assert "usr_itest_investigator" not in {p["id"] for p in client.get("/v1/users/assignees", headers=world.bearer(TENANT_B)).json()}
