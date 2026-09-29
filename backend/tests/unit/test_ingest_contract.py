import pytest
from pydantic import ValidationError

from app.schemas.ingest import IngestBatch

DOC_TRANSACTION = {
    "kind": "transaction",
    "id": "tx_01H0000000000000000000001",
    "from_account_id": "acct_1",
    "to_account_id": "acct_2",
    "amount": "150000.00",
    "direction": "debit",
    "channel": "upi",
    "value_ts": "2026-09-22T10:31:00Z",
}
DOC_EMPLOYEE_ACTION = {
    "kind": "employee_action",
    "id": "act_01H0000000000000000000001",
    "employee_id": "emp_507",
    "action_type": "profile.edit",
    "target_type": "customer",
    "target_id": "cust_1042",
    "before_state": {"limit": 50000},
    "after_state": {"limit": 500000},
    "event_ts": "2026-09-22T10:30:00Z",
    "session_id": "sess_9",
}


def test_t_int_01_accepts_both_docs_examples():
    """T-INT-01 (contract part): both docs/05 §6 examples validate as one batch."""
    batch = IngestBatch.model_validate({"events": [DOC_TRANSACTION, DOC_EMPLOYEE_ACTION]})
    assert [e.kind for e in batch.events] == ["transaction", "employee_action"]


def test_t_int_03_rejects_a_batch_over_500():
    """T-INT-03 (contract part): 501 events -> validation error."""
    events = [{**DOC_TRANSACTION, "id": f"tx_{i:05d}"} for i in range(501)]
    with pytest.raises(ValidationError):
        IngestBatch.model_validate({"events": events})
    assert len(IngestBatch.model_validate({"events": events[:500]}).events) == 500


def test_t_int_04_rejects_unknown_fields():
    """T-INT-04: an extra field on an event or on the envelope is rejected (extra="forbid")."""
    with pytest.raises(ValidationError):
        IngestBatch.model_validate({"events": [{**DOC_TRANSACTION, "surprise": 1}]})
    with pytest.raises(ValidationError):
        IngestBatch.model_validate({"events": [DOC_TRANSACTION], "extra": True})


@pytest.mark.parametrize("amount", ["0", "-5.00", "10.001"])
def test_rejects_non_positive_or_over_precise_amounts(amount):
    with pytest.raises(ValidationError):
        IngestBatch.model_validate({"events": [{**DOC_TRANSACTION, "amount": amount}]})
