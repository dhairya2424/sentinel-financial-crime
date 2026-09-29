from __future__ import annotations

from dataclasses import replace

from app.detection.base import Factor, Hit

TOLERANCE = 0.011


class ExplainabilityError(ValueError):
    pass


def band_for(score: int) -> str:
    if score >= 85:
        return "critical"
    if score >= 70:
        return "high"
    if score >= 40:
        return "medium"
    return "low"


def assert_explainability(score: int, factors: list[Factor]) -> None:
    total = sum(f.contribution for f in factors)
    if not factors or abs(total - score / 100) > TOLERANCE:
        raise ExplainabilityError(f"factor contributions sum to {total:.4f}, score {score} implies {score / 100:.2f}")


def aggregate_factors(hits: list[Hit]) -> tuple[int, str, list[Factor]]:
    """Max-merge factors by name across connected hits. When the merged sum exceeds 1.0, contributions are
    scaled proportionally so they still add up to the (clamped) score and no factor is silently dropped."""
    merged: dict[str, Factor] = {}
    for hit in hits:
        for factor in hit.factors:
            current = merged.get(factor.name)
            if current is None or factor.contribution > current.contribution:
                merged[factor.name] = factor
    factors = sorted(merged.values(), key=lambda f: -f.contribution)
    total = sum(f.contribution for f in factors)
    if total > 1.0:
        factors = [replace(f, contribution=round(f.contribution / total, 4)) for f in factors]
    score = max(0, min(100, round(sum(f.contribution for f in factors) * 100)))
    assert_explainability(score, factors)
    return score, band_for(score), factors


def compose_explanation(hits: list[Hit]) -> str:
    ordered = sorted(hits, key=lambda h: -h.score)
    return " | ".join(h.explanation for h in ordered)
