"""Ingest abuse and injection (docs/08 §11; threats T3, T4): T-INT-03 batch of 501, T-INT-04 unknown field."""

import pytest

from .conftest import TENANT_A, pipeline_drained, poll


def tx(world, n: int, **extra) -> dict:
    return {"kind": "transaction", "id": f"{world.tx}_abuse_{n}", "from_account_id": world.account, "to_account_id": world.other_account,
            "amount": "10.00", "value_ts": "2026-09-23T12:00:00Z", **extra}


def post(client, world, body) -> tuple[int, dict]:
    r = client.post("/v1/ingest/events", json=body, headers=world.bearer(TENANT_A))
    return r.status_code, r.json()


def test_t_int_03_a_batch_of_501_is_rejected_whole(client, world):
    """T-INT-03: more than 500 events -> 422 and nothing is stored (500 is the cap, docs/05 §7)."""
    status, body = post(client, world, {"events": [tx(world, n) for n in range(501)]})
    assert status == 422 and body["code"] == "validation_error"
    assert any(e.get("type") == "too_long" for e in body["detail"])
    timeline = client.get(f"/v1/timeline/account/{world.account}", headers=world.bearer(TENANT_A)).json()
    assert not [i for i in timeline["items"] if i["ref_id"].startswith(f"{world.tx}_abuse_")]


def test_t_int_04_an_unknown_field_is_rejected(client, world):
    """T-INT-04: extra fields are forbidden on the event and on the batch -> 422."""
    status, body = post(client, world, {"events": [tx(world, 1, is_admin=True)]})
    assert status == 422 and any(e["type"] == "extra_forbidden" for e in body["detail"])
    status, body = post(client, world, {"events": [tx(world, 2)], "tenant_id": "tenant_other"})
    assert status == 422 and any(e["type"] == "extra_forbidden" for e in body["detail"])


def _event(event_id: str, **fields) -> dict:
    return {"events": [{"kind": "transaction", "id": event_id, "to_account_id": "acct_x", "amount": "5", "value_ts": "2026-09-23T12:00:00Z", **fields}]}


@pytest.mark.parametrize(
    ("label", "body"),
    [
        ("empty batch", {"events": []}),
        ("no events key", {}),
        ("unknown kind", {"events": [{"kind": "wire", "id": "tx_x"}]}),
        ("negative amount", _event("tx_neg", amount="-5")),
        ("naive timestamp", _event("tx_naive", value_ts="2026-09-23T12:00:00")),
        ("bad id prefix", _event("cust_1")),
        ("id with SQL", _event("tx_1'; DROP TABLE transactions;--")),
        ("oversized id", _event("tx_" + "a" * 80)),
        ("self transfer", _event("tx_self", from_account_id="acct_x")),
    ],
)
def test_malformed_batches_are_422(client, world, label, body):
    status, _ = post(client, world, body)
    assert status == 422, label


def test_a_batch_of_exactly_500_is_accepted(client, world):
    status, body = post(client, world, {"events": [tx(world, n) for n in range(500)]})
    assert status == 202 and body["accepted"] == 500 and body["failed"] == 0
    poll(pipeline_drained, timeout=90, interval=0.5)  # leave no backlog for the latency tests that follow


@pytest.mark.parametrize("q", ["I_tegration", "Integ%tion", "%", "' OR '1'='1", "x%' OR 1=1 --", "\\", "Integration%'; DROP TABLE customers; --"])
def test_t3_search_treats_input_as_text(client, world, q):
    """T3: search input is a bound, escaped ILIKE value: % and _ are literal characters, not wildcards, and SQL in the
    query matches nothing (a wildcard would have let "I_tegration" or "Integ%tion" find "Integration Customer")."""
    r = client.get("/v1/graph/search", params={"q": q}, headers=world.bearer(TENANT_A))
    assert r.status_code in (200, 422), (q, r.text)
    if r.status_code == 200:
        assert r.json() == [], (q, r.json())
    assert client.get("/v1/graph/search", params={"q": "Integration"}, headers=world.bearer(TENANT_A)).json(), "the plain name is found"
