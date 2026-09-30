"""SENTINEL SCENARIO REPORT: detection rate, false-positive rate and alert latency against their targets (docs/10 §6, §8).

    python -m tests.scenarios.metrics_runner                  # S1–S5 and the 200-customer, 90-day legitimate corpus
    python -m tests.scenarios.metrics_runner --only S1,S3     # a subset of scenarios; --skip-legit leaves out the corpus
    pytest tests/scenarios -q --metrics                        # the same report after the scenario tests (or -m metrics)

Exits non-zero when any metric fails, so CI can gate on it. Every run uses throwaway tenants and deletes them.
LEGIT_CUSTOMERS / LEGIT_DAYS change the corpus size, LEGIT_TOLERANCE the false-positive limit (default 0.10).
"""

import argparse
import asyncio
import logging
import os
import sys

from tests.scenarios.harness import SCENARIO_IDS, LegitimateResult, ScenarioResult, run_legitimate, run_suspicious

DETECTION_TARGET = 0.90
LATENCY_P95_MS = 5000
RULE = "=" * 60


def legit_settings() -> dict[str, int]:
    return {"customers": int(os.environ.get("LEGIT_CUSTOMERS", "200")), "days": int(os.environ.get("LEGIT_DAYS", "90"))}


def pct(samples: list[float], p: float) -> float:
    """Nearest-rank percentile, as in tests/perf/bench_nfr.py."""
    ordered = sorted(samples)
    return ordered[max(0, min(len(ordered) - 1, round(p / 100 * len(ordered) + 0.5) - 1))]


def verdict(ok: bool) -> str:
    return "PASS" if ok else "FAIL"


def offender_lines(legit: LegitimateResult, top: int = 5) -> list[str]:
    return [
        f"  {o.customer_id}  {o.rule_code} {o.band} {o.score}  entities={','.join(o.entity_ids[:4])}\n      {o.explanation[:300]}"
        for o in legit.offenders[:top]
    ]


def report(scenarios: list[ScenarioResult], legit: LegitimateResult | None, tolerance: float = 0.10) -> tuple[str, bool]:
    lines = [f"{'=' * 17} SENTINEL SCENARIO REPORT {'=' * 17}"]
    ok = True
    if scenarios:
        detected = sum(r.detected for r in scenarios)
        if len(scenarios) == len(SCENARIO_IDS):
            rate = detected / len(SCENARIO_IDS)
            passed = rate >= DETECTION_TARGET
            lines.append(f"detection_rate: {detected}/{len(SCENARIO_IDS)} ({rate:.0%})   [target >={DETECTION_TARGET:.0%}] {verdict(passed)}")
        else:
            passed = detected == len(scenarios)
            lines.append(f"detected: {detected}/{len(scenarios)} of the scenarios run   [subset: the >={DETECTION_TARGET:.0%} gate needs all five] {verdict(passed)}")
        ok &= passed
    if legit is not None:
        passed = legit.rate <= tolerance
        ok &= passed
        lines.append(
            f"false_positive_rate: {legit.rate:.1%} ({legit.flagged}/{legit.customers} customers)   [target <={tolerance:.0%}] {verdict(passed)}"
        )
        lines.append(f"  corpus: {legit.customers} customers, {legit.events} events through the pipeline in {legit.seconds}s; alerts by band {legit.bands or '{}'}")
        if not passed:
            lines.append("  top offenders (docs/10 §6 triage: tune the rules table, re-run, log the decision):")
            lines.extend(offender_lines(legit))
    if scenarios:
        latencies = [r.latency_ms for r in scenarios if r.latency_ms is not None]
        if latencies:
            p50, p95 = pct(latencies, 50), pct(latencies, 95)
            passed = p95 <= LATENCY_P95_MS
            lines.append(f"alert_latency_p50_ms: {p50:.0f} / p95_ms: {p95:.0f}   [target p95<={LATENCY_P95_MS}] {verdict(passed)}")
        else:
            passed = False
            lines.append(f"alert_latency: no scenario detected   [target p95<={LATENCY_P95_MS}] FAIL")
        ok &= passed
        lines.append("")
        lines.append(f"{'id':<4}{'scenario':<42}{'rule hit':<16}{'band':<10}{'score':>5}{'latency ms':>12}")
        for r in scenarios:
            hit = r.rule_hit or ("error" if r.error else "none")
            latency = f"{r.latency_ms:.0f}" if r.latency_ms is not None else "-"
            lines.append(f"{r.sid:<4}{r.title[:41]:<42}{hit:<16}{(r.band or '-'):<10}{(r.score if r.score is not None else '-'):>5}{latency:>12}")
            if r.error:
                lines.append(f"    {r.error[:200]}")
            elif r.via and r.via != "rule":
                lines.append(f"    matched as a {r.via}")
    lines.append(RULE)
    lines.append(f"overall: {verdict(ok)}")
    return "\n".join(lines), ok


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # titles carry ₹, × and →; Windows consoles default to cp1252
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--only", help="comma-separated scenario ids, e.g. S1,S3")
    parser.add_argument("--skip-legit", action="store_true", help="leave out the legitimate corpus")
    args = parser.parse_args()
    logging.disable(logging.INFO)
    only = tuple(s.strip().upper() for s in args.only.split(",")) if args.only else SCENARIO_IDS
    unknown = set(only) - set(SCENARIO_IDS)
    if unknown:
        parser.error(f"unknown scenario(s): {', '.join(sorted(unknown))}")
    scenarios = asyncio.run(run_suspicious(only))
    legit = None if args.skip_legit else asyncio.run(run_legitimate(**legit_settings()))
    text, ok = report(scenarios, legit, float(os.environ.get("LEGIT_TOLERANCE", "0.10")))
    print(text)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
