import pytest

from .conftest import TENANT_A, TENANT_B


@pytest.fixture(scope="module")
def seeded(client, world) -> None:
    events = [
        {
            "kind": "transaction",
            "id": f"{world.tx}_iso",
            "from_account_id": world.account,
            "to_account_id": world.other_account,
            "amount": "2500.00",
            "value_ts": "2026-09-23T09:00:00Z",
        },
        {
            "kind": "employee_action",
            "id": f"{world.action}_iso",
            "employee_id": world.employee,
            "action_type": "profile.edit",
            "target_type": "customer",
            "target_id": world.customer,
            "after_state": {"email": "new@example.in"},
            "event_ts": "2026-09-23T08:00:00Z",
        },
    ]
    r = client.post("/v1/ingest/events", json={"events": events}, headers=world.bearer(TENANT_A))
    assert r.status_code == 202, r.text


def paths(world) -> list[str]:
    return [
        f"/v1/timeline/customer/{world.customer}",
        f"/v1/timeline/account/{world.account}",
        f"/v1/timeline/employee/{world.employee}",
        f"/v1/timeline/raw/transaction/{world.tx}_iso",
        f"/v1/timeline/raw/employee_action/{world.action}_iso",
    ]


def test_owner_tenant_can_read_every_timeline_path(client, world, seeded):
    for path in paths(world):
        r = client.get(path, headers=world.bearer(TENANT_A))
        assert r.status_code == 200, (path, r.text)


@pytest.mark.parametrize("role", ["investigator", "viewer", "admin"])
def test_t_int_10_foreign_tenant_gets_404_on_every_timeline_path(client, world, seeded, role):
    """T-INT-10 (timeline sweep): tenant B reading tenant A's entities and records -> 404 each (ADR-011, never 403)."""
    for path in paths(world):
        r = client.get(path, headers=world.bearer(TENANT_B, role))
        assert r.status_code == 404, (path, r.status_code, r.text)
        assert world.customer not in r.text and "Integration" not in r.text


def test_foreign_ingest_cannot_attach_to_another_tenants_account(client, world, seeded):
    event = {
        "kind": "transaction",
        "id": f"{world.tx}_foreign",
        "from_account_id": world.account,
        "to_account_id": f"{world.other_account}_b",
        "amount": "10.00",
        "value_ts": "2026-09-23T10:00:00Z",
    }
    r = client.post("/v1/ingest/events", json={"events": [event]}, headers=world.bearer(TENANT_B))
    assert r.status_code == 202, r.text
    assert r.json()["accepted"] == 0 and r.json()["failed"] == 1
    owner = client.get(f"/v1/timeline/account/{world.account}", headers=world.bearer(TENANT_A)).json()
    assert f"{world.tx}_foreign" not in [i["ref_id"] for i in owner["items"]]


def test_unauthenticated_timeline_read_is_401(client, world):
    assert client.get(f"/v1/timeline/customer/{world.customer}").status_code == 401
