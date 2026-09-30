import asyncio
import os

import pytest

from tests.scenarios.harness import LegitimateResult, ScenarioResult, run_legitimate, run_suspicious
from tests.scenarios.metrics_runner import legit_settings, report

_cache: dict[str, object] = {}


@pytest.fixture(scope="session")
def suspicious() -> dict[str, ScenarioResult]:
    """S1–S5 planted once per session, each in its own throwaway tenant."""
    if "suspicious" not in _cache:
        _cache["suspicious"] = {r.sid: r for r in asyncio.run(run_suspicious())}
    return _cache["suspicious"]


@pytest.fixture(scope="session")
def legitimate() -> LegitimateResult:
    """The L1–L20 corpus run through the pipeline once per session, in its own throwaway tenant."""
    if "legitimate" not in _cache:
        _cache["legitimate"] = asyncio.run(run_legitimate(**legit_settings()))
    return _cache["legitimate"]


def pytest_terminal_summary(terminalreporter, config):
    if config.getoption("--metrics") and ("suspicious" in _cache or "legitimate" in _cache):
        text, _ = report(list(_cache.get("suspicious", {}).values()), _cache.get("legitimate"), float(os.environ.get("LEGIT_TOLERANCE", "0.10")))
        terminalreporter.write_line("")
        for line in text.splitlines():
            terminalreporter.write_line(line)
