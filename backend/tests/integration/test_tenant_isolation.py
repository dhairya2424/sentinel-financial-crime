import asyncio

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


@pytest.fixture(scope="module")
def owned(client, world, seeded) -> dict[str, str]:
    """An alert and a case owned by tenant A, for the full T-INT-10 sweep."""
    from app.ids import new_id

    from .test_cases_api import _insert_alerts

    alert_id = new_id("alert")
    asyncio.run(_insert_alerts([(alert_id, [world.account, world.other_account], "high", 74)]))
    r = client.post("/v1/cases", json={"title": "Tenant A case", "alert_ids": [alert_id]}, headers=world.bearer(TENANT_A))
    assert r.status_code == 201, r.text
    return {"alert": alert_id, "case": r.json()["id"]}


def read_paths(world, owned) -> list[str]:
    return [
        *paths(world),
        f"/v1/alerts/{owned['alert']}",
        f"/v1/alerts/{owned['alert']}/graph",
        f"/v1/cases/{owned['case']}",
        f"/v1/graph/entity/{world.customer}",
        f"/v1/graph/entity/{world.account}",
        f"/v1/graph/entity/{world.employee}",
        f"/v1/graph/neighbors?node_id={world.account}&depth=2",
        f"/v1/graph/cycles?node_id={world.account}",
    ]


def test_owner_tenant_reads_every_swept_path(client, world, owned):
    for path in read_paths(world, owned):
        r = client.get(path, headers=world.bearer(TENANT_A, "viewer"))
        assert r.status_code == 200, (path, r.status_code, r.text)


@pytest.mark.parametrize("role", ["viewer", "investigator", "manager", "admin"])
def test_t_int_10_full_sweep_every_read_is_404_across_tenants(client, world, owned, role):
    """T-INT-10 full sweep (docs/08 §2 T2/T9, ADR-011): alerts, cases, graph entity/neighbors/cycles and timeline of
    tenant A read from tenant B -> 404 each, with nothing of A in the body."""
    for path in read_paths(world, owned):
        r = client.get(path, headers=world.bearer(TENANT_B, role))
        assert r.status_code == 404, (path, role, r.status_code, r.text)
        assert "Integration" not in r.text and world.account not in r.text.replace(path, "")
    if role != "viewer":
        r = client.get(f"/v1/cases/{owned['case']}/export?format=json", headers=world.bearer(TENANT_B, role))
        assert r.status_code == 404, (role, r.text)


def test_t_int_10_lists_and_search_never_show_another_tenant(client, world, owned):
    b = world.bearer(TENANT_B, "admin")
    assert client.get(f"/v1/alerts?entity={world.account}", headers=b).json()["items"] == []
    assert owned["alert"] not in client.get("/v1/alerts?limit=200", headers=b).text
    assert owned["case"] not in client.get("/v1/cases", headers=b).text
    assert client.get("/v1/graph/search", params={"q": "Integration"}, headers=b).json() == []
    assert "usr_itest_admin" not in client.get("/v1/users/assignees", headers=b).text
    assert client.get("/v1/users/usr_itest_admin", headers=b).status_code == 404


def test_t_int_10_cross_tenant_mutations_are_404(client, world, owned):
    b, manager = world.bearer(TENANT_B, "investigator"), world.bearer(TENANT_B, "manager")
    attempts = [
        ("POST", f"/v1/alerts/{owned['alert']}/acknowledge", None, b),
        ("POST", f"/v1/alerts/{owned['alert']}/link-case", {"case_id": owned["case"]}, b),
        ("POST", f"/v1/cases/{owned['case']}/notes", {"body": "Snooping from another bank."}, b),
        ("PATCH", f"/v1/cases/{owned['case']}", {"status": "in_review"}, b),
        ("POST", f"/v1/cases/{owned['case']}/assign", {"assignee_id": "usr_itest_investigator"}, manager),
    ]
    for method, path, body, headers in attempts:
        r = client.request(method, path, json=body, headers=headers)
        assert r.status_code == 404, (method, path, r.status_code, r.text)
    detail = client.get(f"/v1/alerts/{owned['alert']}", headers=world.bearer(TENANT_A)).json()
    assert detail["status"] == "linked_to_case"
    case = client.get(f"/v1/cases/{owned['case']}", headers=world.bearer(TENANT_A)).json()
    assert case["status"] == "open" and case["notes"] == []
