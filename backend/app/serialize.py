from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import inspect


def json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def row_to_dict(row: Any) -> dict[str, Any]:
    """Every mapped column of an ORM row as JSON-safe values (used for evidence snapshots and raw views)."""
    mapper = inspect(row).mapper
    return {col.key: json_value(getattr(row, col.key)) for col in mapper.column_attrs}
