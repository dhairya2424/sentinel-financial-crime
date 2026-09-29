from datetime import date, timedelta
from decimal import Decimal

from app.seed.legitimate import BAND_FLOOR, THRESHOLD, LegitimateGenerator, verify

END = date(2026, 9, 28)


def build(seed: int = 7):
    return LegitimateGenerator("tenant_demo", 30, 15, 30, seed, END).build()


def test_corpus_is_deterministic_for_a_seed():
    a, b = build(), build()
    assert [t["id"] for t in a.transactions] == [t["id"] for t in b.transactions]
    assert a.actions == b.actions


def test_l_corpus_raises_no_detection_hits():
    """L1–L20 (docs/10 §6): benign corpus stays under the false-positive target."""
    hits, flagged = verify(build(), {"reporting_threshold": int(THRESHOLD)})
    assert hits == []
    assert flagged == 0


def test_corpus_shape_matches_contracts():
    corpus = build()
    assert not any(BAND_FLOOR <= t["amount"] < THRESHOLD for t in corpus.transactions)
    assert {a["action_type"] for a in corpus.actions} <= {"profile.edit", "beneficiary.add", "limit.change", "tx.approve", "export.data"}
    assert all(t["id"].startswith("tx_") and t["value_ts"].tzinfo for t in corpus.transactions)
    assert any(a["action_type"] == "profile.edit" and a["target_type"] == "customer" for a in corpus.actions)


def test_verify_detects_a_planted_cycle():
    corpus = build()
    a, b, c = (acct["id"] for acct in corpus.accounts[:3])
    start = corpus.transactions[-1]["value_ts"]
    for i, (src, dst) in enumerate([(a, b), (b, c), (c, a)]):
        corpus.transactions.append(
            {
                "id": f"tx_planted{i}",
                "from_account_id": src,
                "to_account_id": dst,
                "amount": Decimal("200000"),
                "value_ts": start + timedelta(hours=i),
                "channel": "neft",
                "status": "completed",
            }
        )
    hits, _ = verify(corpus, {"reporting_threshold": int(THRESHOLD)})
    assert [h.pattern_code for h in hits] == ["R-CIRC"]
