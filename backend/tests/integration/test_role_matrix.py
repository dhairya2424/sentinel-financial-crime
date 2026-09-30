"""docs/08 §4 authorization matrix, every row x every role (docs/08 §11, threat T7): each ❌ is 403, each ✅ is not.

Role checks run before any lookup, so a mutation aimed at an id that does not exist still proves the gate: a denied
role gets 403, an allowed one gets past the gate to a 404 or 422. Rows that need a real object (case assignment)
create one.
"""

from dataclasses import dataclass
from typing import Any

import pytest

from .conftest import ROLES, TENANT_A

ALL = frozenset(ROLES)
ACTORS = frozenset({"admin", "manager", "investigator"})
INGEST = frozenset({"admin", "investigator"})
ADMIN = frozenset({"admin"})


@dataclass(frozen=True)
class Row:
    group: str
    method: str
    path: str
    allowed: frozenset[str]
    body: Any = None


def matrix(world) -> list[Row]:
    event = {"kind": "transaction", "id": f"{world.tx}_rbac", "from_account_id": world.account, "to_account_id": world.other_account,
             "amount": "10.00", "value_ts": "2026-09-23T11:00:00Z"}
    return [
        Row("read: alerts", "GET", "/v1/alerts", ALL),
        Row("read: alert detail", "GET", "/v1/alerts/alert_missing", ALL),
        Row("read: cases", "GET", "/v1/cases", ALL),
        Row("read: case detail", "GET", "/v1/cases/case_missing", ALL),
        Row("read: graph search", "GET", "/v1/graph/search?q=Integration", ALL),
        Row("read: graph entity", "GET", f"/v1/graph/entity/{world.customer}", ALL),
        Row("read: graph neighbors", "GET", f"/v1/graph/neighbors?node_id={world.account}", ALL),
        Row("read: timeline", "GET", f"/v1/timeline/customer/{world.customer}", ALL),
        Row("read: rules", "GET", "/v1/rules", ALL),
        Row("read: dashboard", "GET", "/v1/dashboard/metrics", ALL),
        Row("read: assignees", "GET", "/v1/users/assignees", ALL),
        Row("read: entity summary", "GET", "/v1/entities/summary", ALL),
        Row("alert.acknowledge", "POST", "/v1/alerts/alert_missing/acknowledge", ACTORS),
        Row("alert.link-case", "POST", "/v1/alerts/alert_missing/link-case", ACTORS, {"case_id": "case_missing"}),
        Row("case.create", "POST", "/v1/cases", ACTORS, {"title": ""}),
        Row("case.notes", "POST", "/v1/cases/case_missing/notes", ACTORS, {"body": "Spoke to the branch manager."}),
        Row("case.close", "PATCH", "/v1/cases/case_missing", ACTORS, {"status": "closed_confirmed", "close_note": "Confirmed with the branch."}),
        Row("case.export", "GET", "/v1/cases/case_missing/export?format=json", ACTORS),
        Row("ingest.events", "POST", "/v1/ingest/events", INGEST, {"events": [event]}),
        Row("ingest.access-rights", "POST", "/v1/ingest/access-rights", INGEST, {"employee_id": "emp_missing", "entitlement": "tx.approve", "granted_at": "2026-09-01T09:00:00Z"}),
        Row("ingest.entities", "POST", "/v1/entities/customers", INGEST, {"name": "x"}),
        Row("rules.write", "PUT", "/v1/rules/R-CIRC", ADMIN, {"weights": {"amount": 2.0}}),
        Row("ops.replay", "POST", "/v1/ops/replay-batch", ADMIN, {"failure_id": "fail_missing"}),
        Row("graph.rebuild", "POST", "/v1/graph/rebuild", ADMIN),
        Row("user mgmt: list", "GET", "/v1/users", ADMIN),
        Row("user mgmt: read", "GET", "/v1/users/usr_missing", ADMIN),
        Row("user mgmt: create", "POST", "/v1/users", ADMIN, {"email": "not-an-email"}),
        Row("auth.me", "GET", "/v1/auth/me", ALL),
    ]


class _Names:
    tx = account = other_account = customer = "x"


ROW_NAMES = [r.group for r in matrix(_Names())]


@pytest.mark.parametrize("role", ROLES)
@pytest.mark.parametrize("index", range(len(ROW_NAMES)), ids=ROW_NAMES)
def test_role_matrix_row(client, world, index, role):
    """docs/08 §4: ❌ -> 403; ✅ -> anything but 403 (and never 401: the token is valid)."""
    row = matrix(world)[index]
    r = client.request(row.method, row.path, json=row.body, headers=world.bearer(TENANT_A, role))
    if role in row.allowed:
        assert r.status_code not in (401, 403), (row.group, role, r.status_code, r.text)
    else:
        assert r.status_code == 403, (row.group, role, r.status_code, r.text)
        assert r.json()["code"] == "forbidden"


def test_auth_refresh_is_open_to_every_role(client):
    """auth.refresh is ✅ for all roles: a bad refresh token is refused as 401, never as a role failure."""
    assert client.post("/v1/auth/refresh", json={"refresh_token": "not-a-token"}).status_code in (401, 422)


@pytest.fixture(scope="module")
def own_case(client, world) -> str:
    r = client.post("/v1/cases", json={"title": "Role matrix case"}, headers=world.bearer(TENANT_A, "investigator"))
    assert r.status_code == 201, r.text
    return r.json()["id"]


@pytest.mark.parametrize(
    ("role", "assignee", "expect"),
    [
        ("viewer", "usr_itest_viewer", 403),
        ("investigator", "usr_itest_manager", 403),
        ("investigator", "usr_itest_investigator", 200),
        ("manager", "usr_itest_manager", 200),
        ("admin", "usr_itest_investigator", 200),
    ],
)
def test_case_assign_row(client, world, own_case, role, assignee, expect):
    """case.assign: manager/admin assign to anyone; an investigator only to themselves; a viewer never (T-INT-12)."""
    r = client.post(f"/v1/cases/{own_case}/assign", json={"assignee_id": assignee}, headers=world.bearer(TENANT_A, role))
    assert r.status_code == expect, (role, assignee, r.text)


def test_unauthenticated_requests_are_401_on_every_row(client, world):
    for row in matrix(world):
        r = client.request(row.method, row.path, json=row.body)
        assert r.status_code == 401, (row.group, r.status_code)
