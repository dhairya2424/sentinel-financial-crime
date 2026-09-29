"""Real-data entry: registering customers, accounts and employees, and ingest refusing to invent stand-in rows."""

import pytest

from app.graph.service import graph_service

from .conftest import TENANT_A, TENANT_B


@pytest.fixture(scope="module")
def registered(client, world) -> dict:
    h = world.bearer(TENANT_A)
    cust = client.post("/v1/entities/customers", json={"name": "Meera Kulkarni", "external_ref": f"CIF-{world.suffix}"}, headers=h)
    assert cust.status_code == 201, cust.text
    number = "55" + "".join(str(int(c, 16) % 10) for c in world.suffix[:8]) + "4321"
    acct = client.post("/v1/entities/accounts", json={"customer_id": cust.json()["id"], "account_number": number, "type": "current"}, headers=h)
    assert acct.status_code == 201, acct.text
    emp = client.post("/v1/entities/employees", json={"name": "Rohan Deshpande", "external_ref": f"E-{world.suffix}", "role": "teller"}, headers=h)
    assert emp.status_code == 201, emp.text
    return {"customer": cust.json(), "account": acct.json(), "employee": emp.json(), "number": number}


def test_registered_entities_are_searchable_and_on_the_graph(client, world, registered):
    hits = client.get("/v1/graph/search", params={"q": "Meera Kulkarni"}, headers=world.bearer(TENANT_A)).json()
    assert registered["customer"]["id"] in [h["id"] for h in hits]
    g = graph_service.graph(TENANT_A)
    assert g.has_edge(registered["customer"]["id"], registered["account"]["id"])
    assert g.nodes[registered["employee"]["id"]]["label"] == "Rohan Deshpande"


def test_account_number_is_stored_masked_only(registered):
    label = registered["account"]["label"]
    assert label == "X" * (len(registered["number"]) - 4) + "4321"
    assert registered["number"] not in str(registered)[: str(registered).index("'number'")]


def test_duplicate_customer_reference_is_409(client, world, registered):
    r = client.post("/v1/entities/customers", json={"name": "Someone Else", "external_ref": f"CIF-{world.suffix}"}, headers=world.bearer(TENANT_A))
    assert r.status_code == 409 and "already exists" in r.json()["detail"]


def test_account_for_a_foreign_tenants_customer_is_rejected(client, world, registered):
    body = {"customer_id": registered["customer"]["id"], "account_number": "123456789012"}
    r = client.post("/v1/entities/accounts", json=body, headers=world.bearer(TENANT_B))
    assert r.status_code == 422 and "not registered" in r.json()["detail"]


def test_viewer_cannot_register(client, world):
    r = client.post("/v1/entities/customers", json={"name": "Viewer Try", "external_ref": "CIF-VIEW"}, headers=world.bearer(TENANT_A, "viewer"))
    assert r.status_code == 403


def test_ingest_rejects_an_unregistered_account_with_a_reason(client, world, registered):
    event = {
        "kind": "transaction",
        "id": f"{world.tx}_unreg",
        "from_account_id": registered["account"]["id"],
        "to_account_id": f"acct_nobody_{world.suffix}",
        "amount": "500.00",
        "value_ts": "2026-09-24T09:00:00Z",
    }
    body = client.post("/v1/ingest/events", json={"events": [event]}, headers=world.bearer(TENANT_A)).json()
    assert body["accepted"] == 0 and body["failed"] == 1
    assert body["errors"] == [{"id": event["id"], "error": f"account acct_nobody_{world.suffix} is not registered"}]
    assert client.get("/v1/graph/search", params={"q": "unresolved"}, headers=world.bearer(TENANT_A)).json() == []


def test_one_sided_transfer_to_an_outside_bank_is_accepted(client, world, registered):
    event = {
        "kind": "transaction",
        "id": f"{world.tx}_outside",
        "from_account_id": registered["account"]["id"],
        "amount": "1200.00",
        "channel": "neft",
        "value_ts": "2026-09-24T10:00:00Z",
    }
    r = client.post("/v1/ingest/events", json={"events": [event]}, headers=world.bearer(TENANT_A))
    assert r.json()["accepted"] == 1, r.text


def test_action_on_an_unregistered_target_or_foreign_session_is_rejected(client, world, registered):
    base = {"kind": "employee_action", "employee_id": registered["employee"]["id"], "action_type": "profile.edit", "event_ts": "2026-09-24T11:00:00Z"}
    events = [
        {**base, "id": f"{world.action}_ghost", "target_type": "customer", "target_id": f"cust_ghost_{world.suffix}"},
        {**base, "id": f"{world.action}_sess", "target_type": "customer", "target_id": registered["customer"]["id"], "session_id": world.session},
    ]
    body = client.post("/v1/ingest/events", json={"events": events}, headers=world.bearer(TENANT_A)).json()
    assert body["failed"] == 2
    reasons = {e["id"]: e["error"] for e in body["errors"]}
    assert reasons[f"{world.action}_ghost"] == f"customer cust_ghost_{world.suffix} is not registered"
    assert reasons[f"{world.action}_sess"] == f"session {world.session} belongs to another employee"


def test_preview_renders_a_transfer_as_the_timeline_would_without_saving(client, world, registered):
    event = {
        "kind": "transaction",
        "id": f"{world.tx}_preview",
        "from_account_id": registered["account"]["id"],
        "amount": "240000.00",
        "channel": "neft",
        "value_ts": "2026-09-24T12:00:00Z",
    }
    body = client.post("/v1/timeline/preview", json={"event": event}, headers=world.bearer(TENANT_A, "viewer")).json()
    assert body["problem"] is None
    assert body["viewpoint"]["id"] == registered["customer"]["id"]
    assert body["item"]["title"] == "Outgoing NEFT debit" and body["item"]["direction"] == "out" and body["item"]["value"] == "240000.00"
    raw = client.get(f"/v1/timeline/raw/transaction/{event['id']}", headers=world.bearer(TENANT_A))
    assert raw.status_code == 404


def test_preview_reports_an_unregistered_reference_in_ingest_words(client, world, registered):
    event = {
        "kind": "employee_action",
        "id": f"{world.action}_preview",
        "employee_id": registered["employee"]["id"],
        "action_type": "limit.change",
        "target_type": "account",
        "target_id": f"acct_ghost_{world.suffix}",
        "after_state": {"daily_transfer_limit": 900000},
        "event_ts": "2026-09-24T12:00:00Z",
    }
    body = client.post("/v1/timeline/preview", json={"event": event}, headers=world.bearer(TENANT_A)).json()
    assert body["item"] is None and body["problem"] == f"account acct_ghost_{world.suffix} is not registered"
    event["target_id"] = registered["account"]["id"]
    body = client.post("/v1/timeline/preview", json={"event": event}, headers=world.bearer(TENANT_A)).json()
    assert body["item"]["title"] == "Changed transfer limit to ₹9,00,000"
    assert body["item"]["actor"] == {"id": registered["employee"]["id"], "name": "Rohan Deshpande"}
    assert body["viewpoint"]["id"] == registered["customer"]["id"]


def test_lookup_finds_accounts_by_holder_name_and_summary_counts(client, world, registered):
    hits = client.get("/v1/entities/lookup", params={"type": "account", "q": "Meera"}, headers=world.bearer(TENANT_A)).json()
    assert [h["id"] for h in hits] == [registered["account"]["id"]] and hits[0]["detail"] == "Meera Kulkarni · current"
    assert client.get("/v1/entities/lookup", params={"type": "account", "q": "Meera"}, headers=world.bearer(TENANT_B)).json() == []
    counts = client.get("/v1/entities/summary", headers=world.bearer(TENANT_A)).json()
    assert counts["customers"] >= 3 and counts["employees"] >= 2 and set(counts) >= {"transactions", "sessions", "access_rights"}
