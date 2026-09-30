"""T-INT-08: new evidence extends the same alert; re-detecting old evidence changes nothing."""

from datetime import UTC, datetime, timedelta

from .conftest import TENANT_A, pipeline_drained, poll


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def tx(world, suffix: str, src: str, dst: str, ts: datetime, amount: str = "210000.00") -> dict:
    return {
        "kind": "transaction",
        "id": f"{world.tx}_{suffix}",
        "from_account_id": src,
        "to_account_id": dst,
        "amount": amount,
        "channel": "neft",
        "value_ts": iso(ts),
    }


def test_t_int_08_overlapping_extension_grows_the_same_alert(client, world):
    now = datetime.now(UTC).replace(microsecond=0)
    a, b, c = world.account, world.other_account, f"{world.account}_c"
    h = world.bearer(TENANT_A)
    loop = [tx(world, "d1", a, b, now - timedelta(hours=3)), tx(world, "d2", b, c, now - timedelta(hours=2)), tx(world, "d3", c, a, now - timedelta(hours=1))]
    assert client.post("/v1/ingest/events", json={"events": loop}, headers=h).json()["accepted"] == 3

    def alerts():
        return client.get("/v1/alerts", params={"rule": "R-CIRC", "entity": a}, headers=h).json()["items"]

    first, _ = poll(alerts)
    assert len(first) == 1 and first[0]["occurrence_count"] == 1
    alert_id = first[0]["id"]

    # A later A->B closes a tighter loop (B->C, C->A, A->B): one new leg of evidence for the same situation.
    extension = tx(world, "d4", a, b, now - timedelta(minutes=54))
    assert client.post("/v1/ingest/events", json={"events": [extension]}, headers=h).json()["accepted"] == 1
    grown, _ = poll(lambda: [x for x in alerts() if x["occurrence_count"] == 2])
    assert [x["id"] for x in alerts()] == [alert_id]
    detail = client.get(f"/v1/alerts/{alert_id}", headers=h).json()
    assert detail["occurrence_count"] == 2
    assert sorted(e["ref_id"] for e in detail["evidence"]) == sorted([*(e["id"] for e in loop), extension["id"]])
    assert detail["window_end"] >= iso(now - timedelta(minutes=54)).replace("Z", "+00:00")

    # Unrelated small transfers re-run detection over the same loop; nothing new, so nothing changes.
    noise = [tx(world, "d5", a, None, now - timedelta(minutes=30), amount="100.00"), tx(world, "d6", a, None, now - timedelta(minutes=20), amount="100.00")]
    assert client.post("/v1/ingest/events", json={"events": noise}, headers=h).json()["accepted"] == 2
    poll(pipeline_drained)
    after = client.get(f"/v1/alerts/{alert_id}", headers=h).json()
    assert after["occurrence_count"] == 2 and len(after["evidence"]) == 4
