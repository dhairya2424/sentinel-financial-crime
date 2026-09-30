"""Secrets and supply-chain guards (docs/08 §2 T1/T10, §9; docs/06 §4): no JWT_SECRET default outside dev, no .env in
git, and the secret-scan config CI runs."""

import subprocess
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import DEV_JWT_SECRET, Settings

REPO = Path(__file__).resolve().parents[3]


def settings(**env) -> Settings:
    return Settings(_env_file=None, **env)


@pytest.mark.parametrize("env", ["production", "staging", "test"])
def test_jwt_secret_has_no_default_outside_dev(env):
    with pytest.raises(ValidationError, match="JWT_SECRET is required"):
        settings(ENV=env, JWT_SECRET="")


def test_production_refuses_a_short_secret():
    with pytest.raises(ValidationError, match="at least 32"):
        settings(ENV="production", JWT_SECRET="x" * 31)
    assert settings(ENV="production", JWT_SECRET="x" * 32).JWT_SECRET == "x" * 32


def test_the_dev_fallback_exists_only_in_dev():
    assert settings(ENV="dev", JWT_SECRET="").JWT_SECRET == DEV_JWT_SECRET
    assert settings(ENV="production", JWT_SECRET="y" * 40).JWT_SECRET != DEV_JWT_SECRET


def _git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, check=True).stdout


def test_env_files_are_ignored_and_never_tracked():
    assert _git("check-ignore", "backend/.env").strip() == "backend/.env"
    assert _git("check-ignore", "frontend/.env").strip() == "frontend/.env"
    tracked = [p for p in _git("ls-files").splitlines() if Path(p).name == ".env" or (Path(p).name.endswith(".env") and not p.endswith(".env.example"))]
    assert tracked == []


def test_example_env_holds_no_secret():
    for example in ("backend/.env.example", "frontend/.env.example"):
        lines = (REPO / example).read_text(encoding="utf-8").splitlines()
        secrets = [line for line in lines if line.startswith("JWT_SECRET=") and line.strip() != "JWT_SECRET="]
        assert secrets == [], example


def test_gitleaks_config_extends_the_default_rules():
    config = (REPO / ".gitleaks.toml").read_text(encoding="utf-8")
    assert "useDefault = true" in config
    assert "[allowlist]" in config
