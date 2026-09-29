from collections.abc import AsyncIterator
from typing import TypeVar

from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

engine = create_async_engine(get_settings().DATABASE_URL, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

S = TypeVar("S", bound=Select)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session


def tenant_scope(stmt: S, model: type, tenant_id: str) -> S:
    """Every repository query MUST pass through this (or an equivalent tenant_id
    predicate). Rows from other tenants are treated as non-existent (ADR-011)."""
    return stmt.where(model.tenant_id == tenant_id)
