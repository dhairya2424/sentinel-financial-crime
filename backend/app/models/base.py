from sqlalchemy import DateTime, text
from sqlalchemy.orm import DeclarativeBase, mapped_column

EMPTY_JSON = text("'{}'::jsonb")
NOW = text("now()")
TS = DateTime(timezone=True)


class Base(DeclarativeBase):
    pass


def created_at():
    return mapped_column(TS, nullable=False, server_default=NOW)
