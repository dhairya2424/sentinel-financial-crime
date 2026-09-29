from collections import Counter
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.graph.service import (
    AccountRow,
    ActionRow,
    CustomerRow,
    EmployeeRow,
    GraphRows,
    GraphService,
    RightRow,
    TransactionRow,
)

T = datetime(2026, 9, 20, 10, 0, tzinfo=UTC)
GRANTED = T - timedelta(days=400)
TENANT_A, TENANT_B = "tenant_a", "tenant_b"


def fixture_rows() -> GraphRows:
    return GraphRows(
        customers=[CustomerRow("cust_1", "Asha Rao", "CIF1"), CustomerRow("cust_2", "Bina Shah", "CIF2"), CustomerRow("cust_3", "Chet Iyer", "CIF3")],
        accounts=[
            AccountRow("acct_1", "cust_1", "XXXX0001", "savings", GRANTED),
            AccountRow("acct_2", "cust_2", "XXXX0002", "savings", GRANTED),
            AccountRow("acct_3", "cust_3", "XXXX0003", "savings", GRANTED),
            AccountRow("acct_4", "cust_1", "XXXX0004", "current", GRANTED),
        ],
        employees=[EmployeeRow("emp_1", "Mira Manager", "manager"), EmployeeRow("emp_2", "Ravi Analyst", "analyst")],
        transactions=[
            TransactionRow("tx_1", "acct_1", "acct_2", Decimal("200000.00"), T, "neft"),
            TransactionRow("tx_2", "acct_2", "acct_3", Decimal("200000.00"), T + timedelta(hours=1), "neft"),
            TransactionRow("tx_3", "acct_3", "acct_1", Decimal("200000.00"), T + timedelta(hours=2), "neft"),
            TransactionRow("tx_4", "acct_1", "acct_4", Decimal("5000.00"), T + timedelta(hours=3), "internal"),
            TransactionRow("tx_5", "acct_1", None, Decimal("90000.00"), T + timedelta(hours=4), "rtgs"),
        ],
        rights=[
            RightRow("ar_1", "emp_1", "profile.edit", "branch:PUNE-01", GRANTED),
            RightRow("ar_2", "emp_1", "tx.approve", "branch:PUNE-01", GRANTED),
            RightRow("ar_3", "emp_2", "profile.edit", "acct_3", GRANTED),
        ],
        actions=[
            ActionRow("act_1", "emp_1", "profile.edit", "customer", "cust_1", T - timedelta(hours=5)),
            ActionRow("act_2", "emp_1", "tx.approve", "transaction", "tx_5", T + timedelta(hours=4)),
            ActionRow("act_3", "emp_2", "profile.edit", "customer", "cust_2", T - timedelta(hours=6)),
        ],
    )


EXPECTED_EDGES = {"TRANSFER": 4, "ACCOUNT_HOLDER": 4, "EMPLOYEE_ACCESS": 4, "PROFILE_CHANGE": 2, "EMPLOYEE_ACTION": 1}


@pytest.fixture
def service() -> GraphService:
    svc = GraphService()
    svc.load_rows(TENANT_A, fixture_rows())
    return svc


def edge_types(result: dict) -> Counter:
    return Counter(e["type"] for e in result["edges"])


def test_t_grph_01_rebuild_matches_source_counts(service):
    """T-GRPH-01: node and per-type edge counts equal what the source rows imply."""
    stats = service.load_rows(TENANT_A, fixture_rows())
    assert stats.nodes == 3 + 4 + 2 + 1
    assert stats.edges == EXPECTED_EDGES
    g = service.graph(TENANT_A)
    assert g.nodes["tx_5"]["type"] == "transaction"
    assert g.nodes["acct_1"]["label"] == "XXXX0001" and g.nodes["cust_1"]["label"] == "Asha Rao"
    assert not any(d["type"] == "TRANSFER" and d["tx_id"] == "tx_5" for _, _, d in g.edges(data=True))


def test_access_edges_follow_exercised_or_scoped_entitlements(service):
    g = service.graph(TENANT_A)
    access = sorted((u, v, d["entitlement"]) for u, v, d in g.edges(data=True) if d["type"] == "EMPLOYEE_ACCESS")
    assert access == [
        ("emp_1", "acct_1", "tx.approve"),
        ("emp_1", "cust_1", "profile.edit"),
        ("emp_2", "acct_3", "profile.edit"),
        ("emp_2", "cust_2", "profile.edit"),
    ]


def test_t_grph_02_planted_cycle_is_found_through_the_requested_node(service):
    """T-GRPH-02: A->B->C->A within the window is returned, starting at the requested node, legs in time order."""
    result = service.cycles(TENANT_A, "acct_2", 72, until=T + timedelta(hours=3))
    assert result == {"cycles": [["acct_2", "acct_3", "acct_1"]], "legs": [["tx_1", "tx_2", "tx_3"]]}
    assert service.cycles(TENANT_A, "acct_1", 72, until=T + timedelta(hours=3))["cycles"] == [["acct_1", "acct_2", "acct_3"]]


def test_cycles_respect_window_and_leg_order(service):
    assert service.cycles(TENANT_A, "acct_1", 72, until=T + timedelta(days=10))["cycles"] == []
    reversed_rows = fixture_rows()
    reversed_rows.transactions[1] = TransactionRow("tx_2", "acct_2", "acct_3", Decimal("200000.00"), T - timedelta(hours=1), "neft")
    svc = GraphService()
    svc.load_rows(TENANT_A, reversed_rows)
    assert svc.cycles(TENANT_A, "acct_1", 72, until=T + timedelta(hours=3))["cycles"] == []


def test_t_grph_03_depth_two_returns_two_hops_only(service):
    """T-GRPH-03: depth=2 around a customer reaches its accounts' counterparties but no third-hop node."""
    result = service.neighbors(TENANT_A, "cust_1", 2)
    depth = {n["id"]: n["depth"] for n in result["nodes"]}
    assert depth["cust_1"] == 0 and depth["acct_1"] == 1 and depth["emp_1"] == 1
    assert depth["acct_2"] == 2 and depth["acct_3"] == 2 and depth["tx_5"] == 2
    assert "cust_2" not in depth and "cust_3" not in depth
    assert max(depth.values()) == 2
    one_hop = {n["id"] for n in service.neighbors(TENANT_A, "cust_1", 1)["nodes"]}
    assert one_hop == {"cust_1", "acct_1", "acct_4", "emp_1"}


def test_t_grph_04_edge_type_filter(service):
    """T-GRPH-04: excluding TRANSFER removes transfer edges; TRANSFER-only returns no PROFILE_CHANGE."""
    no_transfer = service.neighbors(TENANT_A, "acct_1", 2, {"ACCOUNT_HOLDER", "EMPLOYEE_ACCESS", "PROFILE_CHANGE", "EMPLOYEE_ACTION"})
    assert "TRANSFER" not in edge_types(no_transfer)
    assert "acct_2" not in {n["id"] for n in no_transfer["nodes"]}
    transfer_only = service.neighbors(TENANT_A, "acct_1", 2, {"TRANSFER"})
    assert set(edge_types(transfer_only)) == {"TRANSFER"}


def test_t_grph_05_apply_event_is_idempotent(service):
    """T-GRPH-05: applying the same transaction twice leaves the edge count unchanged."""
    event = {"id": "tx_9", "from_account_id": "acct_2", "to_account_id": "acct_4", "amount": Decimal("1200.00"), "value_ts": T, "channel": "upi"}
    before = service.graph(TENANT_A).number_of_edges()
    service.apply_event(TENANT_A, "transaction", event)
    assert service.graph(TENANT_A).number_of_edges() == before + 1
    service.apply_event(TENANT_A, "transaction", event)
    assert service.graph(TENANT_A).number_of_edges() == before + 1


def test_apply_event_resolves_approvals_and_revocations(service):
    service.apply_event(
        TENANT_A,
        "employee_action",
        {"id": "act_9", "employee_id": "emp_1", "action_type": "tx.approve", "target_type": "transaction", "target_id": "tx_10", "event_ts": T},
    )
    service.apply_event(TENANT_A, "transaction", {"id": "tx_10", "from_account_id": "acct_4", "amount": "70000.00", "value_ts": T})
    g = service.graph(TENANT_A)
    assert g.has_edge("emp_1", "acct_4", key="ar_2>acct_4")
    service.apply_event(
        TENANT_A,
        "access_right",
        {"id": "ar_2", "employee_id": "emp_1", "entitlement": "tx.approve", "scope": "branch:PUNE-01", "granted_at": GRANTED, "revoked_at": T},
    )
    assert not any(d["type"] == "EMPLOYEE_ACCESS" and d["entitlement"] == "tx.approve" for _, _, d in g.out_edges("emp_1", data=True))


def test_t_grph_06_other_tenants_cannot_see_the_graph(service):
    """T-GRPH-06: tenant A's graph is invisible when querying as tenant B."""
    assert service.neighbors(TENANT_B, "acct_1", 1) is None
    assert service.cycles(TENANT_B, "acct_1", 72) is None
    assert service.search(TENANT_B, "Asha", {"customer"}, 20) == []
    assert service.subgraph(TENANT_B, ["acct_1"]) == {"nodes": [], "edges": []}
    assert service.search(TENANT_A, "asha", {"customer"}, 20) == [("customer", "cust_1", "Asha Rao")]


def test_subgraph_and_output_shape(service):
    snap = service.subgraph(TENANT_A, ["acct_1", "acct_2", "missing"])
    assert {n["id"] for n in snap["nodes"]} == {"acct_1", "acct_2"}
    (edge,) = snap["edges"]
    assert edge == {
        "id": "tx_1",
        "source": "acct_1",
        "target": "acct_2",
        "type": "TRANSFER",
        "props": {"amount": "200000.00", "ts": T.isoformat(), "tx_id": "tx_1", "channel": "neft"},
    }
