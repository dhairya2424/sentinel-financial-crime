from decimal import Decimal

import pytest

from app.services.timeline import action_title, transaction_title


@pytest.mark.parametrize(
    ("narration", "counterparty", "direction", "expected"),
    [
        ("ATM CASH WITHDRAWAL", None, "out", "ATM cash withdrawal"),
        ("UPI SWIGGY", None, "out", "UPI payment · Swiggy"),
        ("POS D-MART", None, "out", "Card payment · D-mart"),
        ("SALARY SEP 2026 INFOSYS", "Infosys", "in", "Salary credit · Infosys"),
        ("TRANSFER TO ISHA SHARMA", "Isha Sharma", "out", "Transfer to Isha Sharma"),
        ("TRANSFER TO KARAN APTE", "Karan Apte", "in", "Incoming transfer"),
        ("RTGS MUTUAL FUND SIP", None, "out", "RTGS · Mutual fund SIP"),
        ("HOME LOAN EMI", None, "out", "Home loan EMI"),
        (None, None, "in", "Incoming NEFT credit"),
        (None, None, "internal", "Transfer between own accounts"),
    ],
)
def test_transaction_titles_read_like_a_statement(narration, counterparty, direction, expected):
    assert transaction_title(narration, counterparty, direction, "neft") == expected


def test_action_titles_name_the_change():
    assert action_title("profile.edit", {"address": "a"}, {"address": "b"}, None) == "Edited profile · address"
    assert action_title("beneficiary.add", None, {"added": {"name": "Isha Sharma"}}, None) == "Added beneficiary · Isha Sharma"
    assert action_title("limit.change", {"daily_transfer_limit": 100000}, {"daily_transfer_limit": 150000}, None) == (
        "Changed transfer limit to ₹1,50,000"
    )
    assert action_title("tx.approve", None, {"status": "approved"}, Decimal("147000.00")) == "Approved transfer of ₹1,47,000"
    assert action_title("tx.approve", None, None, None) == "Approved transfer"
