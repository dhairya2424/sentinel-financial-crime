from datetime import UTC, datetime, timedelta
from decimal import Decimal

from app.detection.base import AccountProfile, TransferRecord
from app.detection.config import resolve_rule_configs

CONFIGS = resolve_rule_configs()
T0 = datetime(2026, 9, 22, 10, 0, tzinfo=UTC)


def h(hours: float) -> timedelta:
    return timedelta(hours=hours)


def tx(tx_id: str, src: str | None, dst: str | None, amount: int | str, ts: datetime) -> TransferRecord:
    return TransferRecord(tx_id=tx_id, from_acct=src, to_acct=dst, amount=Decimal(str(amount)), ts=ts)


def loop(amounts: list[int], offsets_h: list[float], accounts: list[str], start: datetime = T0, prefix: str = "tx") -> list[TransferRecord]:
    k = len(accounts)
    return [
        tx(f"{prefix}_{i + 1}", accounts[i], accounts[(i + 1) % k], amounts[i], start + h(offsets_h[i])) for i in range(k)
    ]


def profiles(*specs: AccountProfile) -> dict[str, AccountProfile]:
    return {p.account_id: p for p in specs}
