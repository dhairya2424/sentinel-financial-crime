from datetime import UTC, datetime, timedelta
from typing import Literal

import jwt

from app.config import get_settings

ALGORITHM = "HS256"
ISSUER = "sentinel"
TokenKind = Literal["access", "refresh"]


class TokenError(Exception):
    pass


def _key(kind: TokenKind) -> str:
    secret = get_settings().JWT_SECRET
    return secret if kind == "access" else f"{secret}:refresh"


def _encode(sub: str, tenant_id: str, role: str, ttl: timedelta, kind: TokenKind, now: datetime | None) -> str:
    issued = now or datetime.now(UTC)
    claims = {
        "sub": sub,
        "tenant_id": tenant_id,
        "role": role,
        "iat": int(issued.timestamp()),
        "exp": int((issued + ttl).timestamp()),
        "iss": ISSUER,
    }
    return jwt.encode(claims, _key(kind), algorithm=ALGORITHM)


def create_access_token(sub: str, tenant_id: str, role: str, now: datetime | None = None) -> str:
    ttl = timedelta(minutes=get_settings().JWT_ACCESS_MIN)
    return _encode(sub, tenant_id, role, ttl, "access", now)


def create_refresh_token(sub: str, tenant_id: str, role: str, now: datetime | None = None) -> str:
    ttl = timedelta(hours=get_settings().JWT_REFRESH_HOURS)
    return _encode(sub, tenant_id, role, ttl, "refresh", now)


def decode(token: str, kind: TokenKind = "access") -> dict:
    try:
        claims = jwt.decode(
            token,
            _key(kind),
            algorithms=[ALGORITHM],
            issuer=ISSUER,
            options={"require": ["exp", "iat", "iss", "sub"]},
        )
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc
    if not claims.get("tenant_id") or not claims.get("role"):
        raise TokenError("missing tenant_id or role claim")
    return claims
