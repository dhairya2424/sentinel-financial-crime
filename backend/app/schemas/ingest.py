from datetime import datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

ActionType = Literal["login", "logout", "profile.edit", "beneficiary.add", "limit.change", "tx.approve", "export.data"]
TargetType = Literal["customer", "account", "transaction", "employee", "system"]
Channel = Literal["upi", "neft", "rtgs", "atm", "pos", "internal"]
EntityId = Annotated[str, Field(min_length=3, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")]


class _Event(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class TransactionEvent(_Event):
    kind: Literal["transaction"]
    id: Annotated[str, Field(pattern=r"^tx_[A-Za-z0-9_\-]+$", max_length=64)]
    from_account_id: EntityId | None = None
    to_account_id: EntityId | None = None
    amount: Annotated[Decimal, Field(gt=0, max_digits=18, decimal_places=2)]
    currency: Annotated[str, Field(min_length=3, max_length=3)] = "INR"
    direction: Literal["debit", "credit"] = "debit"
    channel: Channel | None = None
    reference_no: Annotated[str, Field(max_length=64)] | None = None
    status: Literal["pending", "completed", "failed"] = "completed"
    value_ts: AwareDatetime
    raw: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _has_account(self) -> "TransactionEvent":
        if not self.from_account_id and not self.to_account_id:
            raise ValueError("a transaction needs from_account_id or to_account_id")
        if self.from_account_id and self.from_account_id == self.to_account_id:
            raise ValueError("from_account_id and to_account_id must differ")
        return self


class EmployeeActionEvent(_Event):
    kind: Literal["employee_action"]
    id: Annotated[str, Field(pattern=r"^act_[A-Za-z0-9_\-]+$", max_length=64)]
    employee_id: EntityId
    session_id: EntityId | None = None
    action_type: ActionType
    target_type: TargetType
    target_id: EntityId
    before_state: dict[str, Any] | None = None
    after_state: dict[str, Any] | None = None
    ip_address: Annotated[str, Field(max_length=64)] | None = None
    event_ts: AwareDatetime
    raw: dict[str, Any] | None = None


class AccessRightEvent(_Event):
    kind: Literal["access_right"]
    id: Annotated[str, Field(pattern=r"^ar_[A-Za-z0-9_\-]+$", max_length=64)]
    employee_id: EntityId
    entitlement: Annotated[str, Field(min_length=2, max_length=64)]
    scope: Annotated[str, Field(max_length=64)] | None = None
    granted_at: AwareDatetime
    revoked_at: AwareDatetime | None = None
    granted_by: EntityId | None = None
    source: Annotated[str, Field(max_length=32)] = "iam"


class SessionEvent(_Event):
    kind: Literal["session"]
    id: Annotated[str, Field(pattern=r"^sess_[A-Za-z0-9_\-]+$", max_length=64)]
    employee_id: EntityId
    ip_address: Annotated[str, Field(max_length=64)] | None = None
    device: Annotated[str, Field(max_length=128)] | None = None
    started_at: AwareDatetime
    ended_at: AwareDatetime | None = None
    outcome: Literal["success", "fail", "lockout"] = "success"


Event = Annotated[
    TransactionEvent | EmployeeActionEvent | AccessRightEvent | SessionEvent,
    Field(discriminator="kind"),
]


class IngestBatch(_Event):
    events: Annotated[list[Event], Field(min_length=1, max_length=500)]


class IngestError(BaseModel):
    id: str
    error: str


class IngestResponse(BaseModel):
    accepted: int
    skipped: int
    failed: int
    batch_id: str
    errors: list[IngestError] = []
    skipped_ids: list[str] = []


class AccessRightGrant(_Event):
    employee_id: EntityId
    entitlement: Annotated[str, Field(min_length=2, max_length=64)]
    scope: Annotated[str, Field(max_length=64)] | None = None
    granted_at: AwareDatetime
    revoked_at: AwareDatetime | None = None
    granted_by: EntityId | None = None


def event_time(event: TransactionEvent | EmployeeActionEvent | AccessRightEvent | SessionEvent) -> datetime:
    if isinstance(event, TransactionEvent):
        return event.value_ts
    if isinstance(event, EmployeeActionEvent):
        return event.event_ts
    if isinstance(event, AccessRightEvent):
        return event.revoked_at or event.granted_at
    return event.started_at
