import pytest

from .conftest import TENANT_A


def batch(world) -> dict:
    return {
        "events": [
            {
                "kind": "transaction",
                "id": world.tx,
                "from_account_id": world.account,
                "to_account_id": world.other_account,
                "amount": "150000.00",
                "direction": "debit",
                "channel": "upi",
                "value_ts": "2026-09-22T10:31:00Z",
            },
            {
                "kind": "employee_action",
                "id": world.action,
                "employee_id": world.employee,
                "action_type": "profile.edit",
                "target_type": "customer",
                "target_id": world.customer,
                "before_state": {"limit": 50000},
                "after_state": {"limit": 500000},
                "event_ts": "2026-09-22T10:30:00Z",
                "session_id": world.session,
            },
        ]
    }


@pytest.fixture(scope="module")
def first_ingest(client, world) -> dict:
    r = client.post("/v1/ingest/events", json=batch(world), headers=world.bearer(TENANT_A))
    assert r.status_code == 202, r.text
    return r.json()


def test_t_int_01_docs_example_batch_is_accepted(first_ingest):
    """T-INT-01: the docs/05 §6 example batch -> 202 {accepted > 0}."""
    assert first_ingest["accepted"] == 2
    assert first_ingest["skipped"] == 0 and first_ingest["failed"] == 0
    assert first_ingest["batch_id"]


def test_t_int_02_duplicate_ids_are_skipped_not_duplicated(client, world, first_ingest):
    """T-INT-02: re-ingesting the same event ids is counted as skipped and adds no rows."""
    r = client.post("/v1/ingest/events", json=batch(world), headers=world.bearer(TENANT_A))
    assert r.status_code == 202, r.text
    assert r.json()["accepted"] == 0 and r.json()["skipped"] == 2
    assert r.json()["skipped_ids"] == [world.action, world.tx]
    items = client.get(f"/v1/timeline/customer/{world.customer}", headers=world.bearer(TENANT_A)).json()["items"]
    assert [i["ref_id"] for i in items].count(world.tx) == 1


def test_t_int_03_batch_over_500_is_rejected(client, world):
    """T-INT-03: a batch of 501 events -> 422."""
    event = batch(world)["events"][0]
    events = [{**event, "id": f"{world.tx}_{i}"} for i in range(501)]
    r = client.post("/v1/ingest/events", json={"events": events}, headers=world.bearer(TENANT_A))
    assert r.status_code == 422


def test_t_int_04_unknown_field_is_rejected(client, world):
    """T-INT-04: an extra unknown field -> 422."""
    event = {**batch(world)["events"][0], "id": f"{world.tx}_extra", "surprise": True}
    r = client.post("/v1/ingest/events", json={"events": [event]}, headers=world.bearer(TENANT_A))
    assert r.status_code == 422


def test_ingest_requires_admin_or_investigator(client, world):
    r = client.post("/v1/ingest/events", json=batch(world), headers=world.bearer(TENANT_A, "viewer"))
    assert r.status_code == 403


def test_t_int_09_timeline_merges_transaction_and_profile_edit(client, world, first_ingest):
    """T-INT-09: 1 tx + 1 employee profile.edit on the same customer -> merged, newest first, actor set."""
    r = client.get(f"/v1/timeline/customer/{world.customer}", headers=world.bearer(TENANT_A))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["entity"] == {"type": "customer", "id": world.customer, "label": "Integration Customer", "detail": f"IT-{world.suffix}"}

    items = body["items"]
    assert [i["ref_id"] for i in items] == [world.tx, world.action]
    assert [i["ts"] for i in items] == sorted((i["ts"] for i in items), reverse=True)

    tx, edit = items
    assert tx["category"] == "transaction" and tx["actor"] is None
    assert tx["value"] == "150000.00" and tx["direction"] == "out"
    assert edit["category"] == "profile_change"
    assert edit["actor"] == {"id": world.employee, "name": "Integration Employee"}
    assert edit["title"] == "Edited profile · limit"
    assert edit["target_label"] == "Integration Customer"


def test_timeline_category_filter_and_raw_record(client, world, first_ingest):
    headers = world.bearer(TENANT_A)
    only_changes = client.get(f"/v1/timeline/customer/{world.customer}?categories=profile_change", headers=headers).json()
    assert [i["ref_id"] for i in only_changes["items"]] == [world.action]

    raw = client.get(f"/v1/timeline/raw/employee_action/{world.action}", headers=headers)
    assert raw.status_code == 200
    assert raw.json()["source_table"] == "employee_actions"
    assert raw.json()["record"]["after_state"] == {"limit": 500000}

    bad = client.get(f"/v1/timeline/customer/{world.customer}?categories=nonsense", headers=headers)
    assert bad.status_code == 422
