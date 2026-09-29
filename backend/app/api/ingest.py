from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, require_role
from app.db import get_db
from app.ids import new_id
from app.schemas.ingest import AccessRightEvent, AccessRightGrant, IngestBatch, IngestError, IngestResponse
from app.services.ingest import ingest_events

router = APIRouter(prefix="/ingest", tags=["ingest"])
ingest_role = require_role("admin", "investigator")


class AccessRightCreated(BaseModel):
    id: str
    employee_id: str
    entitlement: str


@router.post("/events", status_code=status.HTTP_202_ACCEPTED, response_model=IngestResponse)
async def ingest(batch: IngestBatch, user: CurrentUser = Depends(ingest_role), db: AsyncSession = Depends(get_db)) -> IngestResponse:
    result = await ingest_events(db, user.tenant_id, list(batch.events), user.id)
    return IngestResponse(
        accepted=len(result.accepted),
        skipped=result.skipped,
        failed=result.failed,
        batch_id=result.batch_id,
        errors=[IngestError(id=i, error=e) for i, e in result.errors],
        skipped_ids=result.skipped_ids,
    )


@router.post("/access-rights", status_code=status.HTTP_201_CREATED, response_model=AccessRightCreated)
async def grant_access(
    body: AccessRightGrant, user: CurrentUser = Depends(ingest_role), db: AsyncSession = Depends(get_db)
) -> AccessRightCreated:
    event = AccessRightEvent(kind="access_right", id=new_id("ar"), **body.model_dump())
    result = await ingest_events(db, user.tenant_id, [event], user.id)
    if not result.accepted:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=result.errors[0][1] if result.errors else "access right could not be recorded")
    return AccessRightCreated(id=event.id, employee_id=event.employee_id, entitlement=event.entitlement)
