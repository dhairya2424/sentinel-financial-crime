import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.auth.jwt import create_access_token, create_refresh_token, decode
from app.config import get_settings
from app.main import app
from app.seed.users import DEMO_PASSWORD, seed

TENANT = get_settings().TENANT_DEFAULT
FOREIGN_TENANT = "tenant_foreign"


@pytest.fixture(scope="module")
def client():
    asyncio.run(seed())
    with TestClient(app) as c:
        yield c


def _login(client: TestClient, role: str) -> dict:
    r = client.post("/v1/auth/login", json={"email": f"{role}@demo.dev", "password": DEMO_PASSWORD, "tenant_id": TENANT})
    assert r.status_code == 200, r.text
    return r.json()


def _bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_t_auth_01_valid_jwt_passes_require_role(client):
    """T-AUTH-01: valid JWT -> require_role passes; claims are exactly the docs/08 §3 set."""
    inv = _login(client, "investigator")
    claims = decode(inv["access_token"])
    assert set(claims) == {"sub", "tenant_id", "role", "exp", "iat", "iss"}
    assert claims["iss"] == "sentinel" and claims["role"] == "investigator" and claims["tenant_id"] == TENANT
    assert claims["exp"] - claims["iat"] == get_settings().JWT_ACCESS_MIN * 60

    me = client.get("/v1/auth/me", headers=_bearer(inv["access_token"]))
    assert me.status_code == 200 and me.json()["role"] == "investigator"

    admin = _login(client, "admin")
    r = client.get("/v1/users", headers=_bearer(admin["access_token"]))
    assert r.status_code == 200
    assert {u["email"] for u in r.json()} >= {"admin@demo.dev", "viewer@demo.dev"}


def test_t_auth_02_expired_jwt_is_401(client):
    """T-AUTH-02: expired JWT -> 401."""
    inv = _login(client, "investigator")["user"]
    stale = create_access_token(inv["id"], TENANT, "investigator", now=datetime.now(UTC) - timedelta(hours=2))
    r = client.get("/v1/auth/me", headers=_bearer(stale))
    assert r.status_code == 401
    assert r.json()["code"] == "unauthorized"


def test_t_auth_03_tampered_signature_is_401(client):
    """T-AUTH-03: tampered signature -> 401 (also: a refresh token is not accepted as an access token)."""
    tokens = _login(client, "investigator")
    header, payload, sig = tokens["access_token"].split(".")
    flipped = sig[:-2] + ("AA" if sig[-2:] != "AA" else "BB")
    assert client.get("/v1/auth/me", headers=_bearer(f"{header}.{payload}.{flipped}")).status_code == 401
    assert client.get("/v1/auth/me", headers=_bearer(tokens["refresh_token"])).status_code == 401
    assert client.get("/v1/auth/me").status_code == 401

    refreshed = client.post("/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert refreshed.status_code == 200
    assert client.get("/v1/auth/me", headers=_bearer(refreshed.json()["access_token"])).status_code == 200
    assert client.post("/v1/auth/refresh", json={"refresh_token": tokens["access_token"]}).status_code == 401


def test_t_auth_04_viewer_on_mutate_route_is_403(client):
    """T-AUTH-04: viewer on a mutate route -> 403 and nothing is written."""
    viewer = _login(client, "viewer")
    body = {"email": "should.not.exist@demo.dev", "full_name": "Nope", "role": "admin", "password": "Str0ng!Pass"}
    r = client.post("/v1/users", json=body, headers=_bearer(viewer["access_token"]))
    assert r.status_code == 403
    assert r.json() == {"detail": "insufficient role", "code": "forbidden"}

    admin = _login(client, "admin")
    emails = {u["email"] for u in client.get("/v1/users", headers=_bearer(admin["access_token"])).json()}
    assert "should.not.exist@demo.dev" not in emails


def test_password_policy_enforced_without_exemptions(client):
    """docs/08 §3 policy applies to every create path, and bcrypt's 72-byte limit never surfaces as a 500."""
    admin = _login(client, "admin")
    for weak in ("Short!1a", "alllowercase123", "x" * 73 + "A1!"):
        body = {"email": "weak@demo.dev", "full_name": "Weak", "role": "viewer", "password": weak}
        r = client.post("/v1/users", json=body, headers=_bearer(admin["access_token"]))
        assert r.status_code == 422 and r.json()["code"] == "validation_error"
        assert weak not in r.text

    overlong = {"email": "admin@demo.dev", "password": "A1!" + "x" * 100, "tenant_id": TENANT}
    assert client.post("/v1/auth/login", json=overlong).status_code == 401


def test_t_auth_05_foreign_tenant_jwt_is_404_not_403(client):
    """T-AUTH-05: foreign-tenant JWT on a resource -> 404, never 403 (ADR-011)."""
    admin = _login(client, "admin")
    target_id = admin["user"]["id"]

    own = client.get(f"/v1/users/{target_id}", headers=_bearer(admin["access_token"]))
    assert own.status_code == 200

    foreign = create_access_token("usr_foreign_admin", FOREIGN_TENANT, "admin")
    r = client.get(f"/v1/users/{target_id}", headers=_bearer(foreign))
    assert r.status_code == 404
    assert r.json()["code"] == "not_found"

    missing = client.get("/v1/users/usr_does_not_exist", headers=_bearer(admin["access_token"]))
    assert missing.status_code == 404 and missing.json() == r.json()

    foreign_refresh = create_refresh_token(target_id, FOREIGN_TENANT, "admin")
    assert client.post("/v1/auth/refresh", json={"refresh_token": foreign_refresh}).status_code == 401
