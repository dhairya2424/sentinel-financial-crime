"""Dashboard metrics (PRD E1): the same payload the dashboard channel carries every 15 s."""

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, get_current_user
from app.db import get_db
from app.services.dashboard import metrics

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/metrics")
async def dashboard_metrics(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict[str, Any]:
    return await metrics(db, user.tenant_id)
