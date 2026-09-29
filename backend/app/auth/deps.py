from dataclasses import dataclass
from typing import Literal

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.jwt import TokenError, decode

Role = Literal["admin", "manager", "investigator", "viewer"]
ROLES: tuple[Role, ...] = ("admin", "manager", "investigator", "viewer")

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    tenant_id: str
    role: Role


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=detail, headers={"WWW-Authenticate": "Bearer"})


async def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> CurrentUser:
    if creds is None or creds.scheme.lower() != "bearer":
        raise _unauthorized("not authenticated")
    try:
        claims = decode(creds.credentials, "access")
    except TokenError:
        raise _unauthorized("invalid or expired token") from None
    if claims["role"] not in ROLES:
        raise _unauthorized("invalid role claim")
    return CurrentUser(id=claims["sub"], tenant_id=claims["tenant_id"], role=claims["role"])


def require_role(*roles: Role):
    allowed = frozenset(roles)

    async def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="insufficient role")
        return user

    return _dep


def not_found(kind: str = "resource") -> HTTPException:
    """ADR-011: a row owned by another tenant is reported exactly like a missing row."""
    return HTTPException(status.HTTP_404_NOT_FOUND, detail=f"{kind} not found")
