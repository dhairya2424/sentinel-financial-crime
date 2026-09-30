from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import UserOut
from app.auth.deps import CurrentUser, Role, get_current_user, not_found, require_role
from app.auth.passwords import WeakPasswordError, check_policy, hash_password
from app.db import get_db, tenant_scope
from app.ids import new_id
from app.models import User

router = APIRouter(prefix="/users", tags=["users"])
admin_only = require_role("admin")


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str
    full_name: str
    role: Role
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or v.startswith("@") or v.endswith("@"):
            raise ValueError("invalid email")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        try:
            check_policy(v)
        except WeakPasswordError as exc:
            raise ValueError(str(exc)) from None
        return v


@router.get("", response_model=list[UserOut])
async def list_users(admin: CurrentUser = Depends(admin_only), db: AsyncSession = Depends(get_db)) -> list[UserOut]:
    rows = await db.scalars(tenant_scope(select(User).order_by(User.email), User, admin.tenant_id))
    return [UserOut.of(u) for u in rows]


class Assignee(BaseModel):
    id: str
    full_name: str
    role: Role


@router.get("/assignees", response_model=list[Assignee])
async def list_assignees(user: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> list[Assignee]:
    """Who can work a case (PRD D1): active investigators, managers and admins of the tenant. Names only, no emails."""
    stmt = select(User).where(User.is_active, User.role != "viewer").order_by(User.full_name)
    rows = await db.scalars(tenant_scope(stmt, User, user.tenant_id))
    return [Assignee(id=u.id, full_name=u.full_name, role=u.role) for u in rows]  # type: ignore[arg-type]


@router.get("/{user_id}", response_model=UserOut)
async def get_user(
    user_id: str, admin: CurrentUser = Depends(admin_only), db: AsyncSession = Depends(get_db)
) -> UserOut:
    user = await db.scalar(tenant_scope(select(User).where(User.id == user_id), User, admin.tenant_id))
    if not user:
        raise not_found("user")
    return UserOut.of(user)


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate, admin: CurrentUser = Depends(admin_only), db: AsyncSession = Depends(get_db)
) -> UserOut:
    user = User(
        id=new_id("usr"),
        tenant_id=admin.tenant_id,
        email=body.email,
        full_name=body.full_name,
        role=body.role,
        password_hash=hash_password(body.password),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, detail="email already exists in tenant") from None
    return UserOut.of(user)
