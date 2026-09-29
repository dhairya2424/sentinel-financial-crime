from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import audit
from app.auth.deps import CurrentUser, Role, get_current_user, not_found
from app.auth.jwt import TokenError, create_access_token, create_refresh_token, decode
from app.auth.passwords import verify_password
from app.db import get_db, tenant_scope
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str
    password: str
    tenant_id: str


class RefreshRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    refresh_token: str


class UserOut(BaseModel):
    id: str
    email: str
    role: Role
    tenant_id: str
    full_name: str

    @classmethod
    def of(cls, u: User) -> "UserOut":
        return cls(id=u.id, email=u.email, role=u.role, tenant_id=u.tenant_id, full_name=u.full_name)


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserOut


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


async def _active_user(db: AsyncSession, tenant_id: str, user_id: str) -> User | None:
    stmt = tenant_scope(select(User).where(User.id == user_id, User.is_active.is_(True)), User, tenant_id)
    return await db.scalar(stmt)


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> LoginResponse:
    stmt = tenant_scope(select(User).where(User.email == body.email.strip().lower()), User, body.tenant_id)
    user = await db.scalar(stmt)
    ok = verify_password(body.password, user.password_hash if user else None)
    if not user or not ok or not user.is_active:
        audit.log(db, body.tenant_id, "login_failed", object_type="user", object_id=user.id if user else None,
                  detail={"email": body.email.strip().lower()})
        await db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid credentials")
    audit.log(db, user.tenant_id, "login", actor_user=user.id, object_type="user", object_id=user.id)
    await db.commit()
    return LoginResponse(
        access_token=create_access_token(user.id, user.tenant_id, user.role),
        refresh_token=create_refresh_token(user.id, user.tenant_id, user.role),
        user=UserOut.of(user),
    )


@router.post("/refresh", response_model=AccessTokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)) -> AccessTokenResponse:
    try:
        claims = decode(body.refresh_token, "refresh")
    except TokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid or expired refresh token") from None
    user = await _active_user(db, claims["tenant_id"], claims["sub"])
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="invalid or expired refresh token")
    return AccessTokenResponse(access_token=create_access_token(user.id, user.tenant_id, user.role))


@router.get("/me", response_model=UserOut)
async def me(current: CurrentUser = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> UserOut:
    user = await _active_user(db, current.tenant_id, current.id)
    if not user:
        raise not_found("user")
    return UserOut.of(user)
