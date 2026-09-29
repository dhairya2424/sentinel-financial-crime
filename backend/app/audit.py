from typing import Any, Literal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog

ActorKind = Literal["user", "system", "pipeline"]


def log(
    db: AsyncSession,
    tenant_id: str,
    action: str,
    *,
    actor_user: str | None = None,
    actor_kind: ActorKind | None = None,
    object_type: str | None = None,
    object_id: str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    """Append-only audit row (docs/08 §5). Joins the caller's transaction; the caller commits."""
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user=actor_user,
            actor_kind=actor_kind or ("user" if actor_user else "system"),
            action=action,
            object_type=object_type,
            object_id=object_id,
            detail=detail or {},
        )
    )
