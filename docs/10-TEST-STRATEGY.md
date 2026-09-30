# 10 — Test Strategy & Case Catalog

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0 | **Targets:** NFR-05 detection ≥90%, NFR-06 FP ≤10%, NFR-01 alert ≤5s p95, NFR-07 audit 100%
**EO coverage:** primary proof of **EO-4** (suspicious + legitimate accuracy/FP); also supplies "Proven by" tests for EO-1 (T-GRPH, T-INT-09), EO-2 (T-RISK), EO-3 (T-INT-11..16), EO-5 (T-FE-01..05) per [PRD §1.4](01-PRD.md). Final Gate fails if any EO row lacks green tests.

---

## 1. Test Pyramid & Tooling

```
        ┌────────────────────┐
        │  Scenario E2E (5)  │  seeded suspicious + legitimate corpora → metrics report
        ├────────────────────┤
        │ Integration (≈20)  │  pytest + live PG/Redis (compose), WS tests
        ├────────────────────┤
        │  Unit (≈40+)       │  rules, risk, graph, auth — offline dataclasses
        ├────────────────────┤
        │ Frontend (≈15)     │  Vitest + Testing Library (EvidencePanel guards)
        └────────────────────┘
CI gates: pytest -q | npm test | typecheck | lint | gitleaks | pip-audit | npm audit
```

| Layer | Runner | Isolation | Network |
|---|---|---|---|
| Unit | pytest | none needed | no |
| Integration | pytest -m integration | compose PG/Redis, flushed per session | localhost only |
| Scenario | pytest tests/scenarios --metrics | dedicated schema/tenant per run | localhost only |
| Frontend | Vitest + jsdom | mock fetch/WS | no |

**Conventions:** test IDs = `T-<area>-<nn>` (catalog below); fixtures in `conftest.py` (`planted_cycle_factory`, `structuring_factory`, `two_tenant_env`); every test tenant-scoped; no test depends on another's data.

## 2. Coverage Gates (CI-enforced)

| Suite | Command | Gate |
|---|---|---|
| Backend unit | `pytest tests/unit -q` | 100% pass |
| Backend integration | `pytest tests/integration -q` | 100% pass |
| Scenarios | `pytest tests/scenarios -q --metrics` | report PASS (all three metrics) |
| Frontend | `npm run test` | 100% pass |
| Types/lint | `npm run typecheck && npm run lint` | 0 errors |
| Coverage (backend) | `coverage run -m pytest tests/unit` | ≥80% line on `detection/`, `risk/` |

## 3. Unit Test Catalog — Detection & Risk

| ID | Area | Case | Expect |
|---|---|---|---|
| T-DET-01 | R-CIRC | A→B→C→A, 200k legs, 4h | 1 Hit; evidence=3 tx; explanation contains `loop` |
| T-DET-02 | R-CIRC | same edges over 10 days | 0 Hit (span > window) |
| T-DET-03 | R-CIRC | A→B→A only | 0 Hit (len<3) |
| T-DET-04 | R-CIRC | 3-cycle totaling ₹400k (< min) | 0 Hit |
| T-DET-05 | R-CIRC | 6-cycle within window & min | Hit with linkage_depth=`6 hops` |
| T-STRUCT-01 | R-STRUCT | 6× ₹48k → same beneficiary, 6h, baseline 0 | Hit; factors present |
| T-STRUCT-02 | R-STRUCT | only 2 such tx | 0 Hit |
| T-STRUCT-03 | R-STRUCT | 3× ₹60k (above threshold) | 0 Hit (not just-under) |
| T-STRUCT-04 | R-STRUCT | 4× ₹48k but total < 1.5×50k impossible with 4×48 — use 3× ₹40k =120k ≥75k | Hit; validates total rule |
| T-STRUCT-05 | R-STRUCT | baseline 300/30d (10/day), now 4 tx (not ≥3× the daily mean) | 0 Hit (fixture corrected, ADR-015; 10/30d + 4 tx now **hits** at 12× baseline) |
| T-PROF-01 | R-PROFILE_ROLE | `analyst` performs `tx.approve` | Hit; access_anomaly raw mentions analyst |
| T-PROF-02 | R-PROFILE_ROLE | `finance_ops` performs `tx.approve` w/ entitlement | 0 Hit |
| T-PROF-03 | R-PROFILE_ROLE | `manager` has role OK but entitlement revoked | Hit (entitlement branch) |
| T-PROF-04 | R-PROFILE_FLOW | limit.change 03:15 → circular flow in 12h same customer | Hit; temporal_proximity >0 |
| T-PROF-05 | R-PROFILE_FLOW | profile.edit → normal ₹1k tx in 12h | 0 Hit |
| T-PROF-06 | R-PROFILE_FLOW | edit then circular flow after 60h | 0 Hit (window) |
| T-SUPP-01 | R-VELOCITY | 10× baseline rate | Factor attached (cap 0.40) |
| T-SUPP-02 | R-OFFHOURS | action at 02:00 tenant tz | Factor attached (cap 0.25) |
| T-SUPP-03 | R-DORMANT | 90d idle + ₹90k | Factor (cap 0.45); standalone if composite ≥60 |
| T-RISK-01 | Banding | score 39/40/69/70/84/85 | low/medium/medium/high/high/critical |
| T-RISK-02 | Aggregation | same factor name two hits | max contribution kept |
| T-RISK-03 | Invariant | hand-broken factors | `ExplainabilityError` raised |
| T-RISK-04 | Explanation | composed string | contains amounts, ids, rule words |
| T-RISK-05 | Supporting merge | primary + supporting on same entity | supporting factors inflate score, band may rise |

## 4. Unit Test Catalog — Graph & Auth

| ID | Case | Expect |
|---|---|---|
| T-GRPH-01 | rebuild from fixture SQL | node/edge counts match per type |
| T-GRPH-02 | planted 3-cycle `cycles()` | returns path containing requested node |
| T-GRPH-03 | neighbors depth=2 | 2-hop only; no 3rd-hop nodes |
| T-GRPH-04 | edge_types filter | TRANSFER-only returns no PROFILE_CHANGE |
| T-GRPH-05 | apply_event same tx twice | edge count unchanged (idempotent) |
| T-GRPH-06 | tenant B query on tenant A graph | empty/404 |
| T-AUTH-01 | valid JWT | `require_role` passes |
| T-AUTH-02 | expired JWT | 401 |
| T-AUTH-03 | tampered signature | 401 |
| T-AUTH-04 | viewer on mutate route | 403 |
| T-AUTH-05 | foreign-tenant JWT on resource | 404 (not 403) |

## 5. Integration Test Catalog

| ID | Case | Expect |
|---|---|---|
| T-INT-01 | ingest docs example batch | 202 `{accepted>0}` |
| T-INT-02 | duplicate event id re-ingest | skipped counts, no dup rows |
| T-INT-03 | batch of 501 | 422 |
| T-INT-04 | extra unknown field | 422 |
| T-INT-05 | planted cycle → poll alerts | R-CIRC ≤5000ms; evidence ≥3; band high/critical |
| T-INT-06 | WS subscribe + ingest | `alert.created` received <5s |
| T-INT-07 | WS wrong-tenant channel | rejected |
| T-INT-08 | overlapping window extension | occurrence_count=2, same alert id, evidence grows |
| T-INT-09 | timeline merge | tx + profile.edit DESC; actor populated |
| T-INT-10 | cross-tenant sweep (all GETs) | 404 each |
| T-INT-11 | case create + group_by_entities | expands shared-entity alerts ≤50 |
| T-INT-12 | assign: manager OK / investigator-to-other 403 / viewer 403 | per matrix |
| T-INT-13 | close w/o note | 422; w/ note → alert statuses propagate |
| T-INT-14 | invalid transition open→escalated | 400 |
| T-INT-15 | export JSON | digest 64 hex; evidence non-empty; stable digest on re-export |
| T-INT-16 | export HTML | `text/html`, contains case_number |
| T-INT-17 | rule PUT weights sum ≠1 | 422; version+1 on success |
| T-INT-18 | audit rows after journey | all mandatory actions present |
| T-INT-19 | ops replay failure_id | replayed_at set, events applied |
| T-INT-20 | dashboard metrics after alert | critical_24h increments |

## 6. Scenario Catalog (detection accuracy & FP)

| ID | Scenario | Planted by | Expected rule(s) | Pass criteria |
|---|---|---|---|---|
| S1 | Circular ₹600k / 4h / 3 accts | `seed.suspicious --only S1` | R-CIRC | alert band ∈ med+ within 10s |
| S2 | 6× ₹48k structured | `--only S2` | R-STRUCT | alert band ∈ med+ |
| S3 | analyst tx.approve ₹200k | `--only S3` | R-PROFILE_ROLE | alert band ∈ med+ |
| S4 | 03:15 edit → circular | `--only S4` | R-PROFILE_FLOW ∪ R-CIRC | ≥1 expected code |
| S5 | dormant + off-hours ₹90k | `--only S5` | R-DORMANT ∪ R-OFFHOURS | ≥1 expected code |
| L1–L20 | 200 customers × 90d benign | `seed.legitimate` | none required | FP rate ≤10% of customers w/ band≥medium |

**Metric definitions (exact):**
- `detection_rate` = detected scenarios / 5 (a scenario counts once even if multiple alerts).
- `false_positive_rate` = (# distinct customers with ≥1 alert band≥medium on legitimate corpus) / (# customers seeded).
- `alert_latency` = wall time from last ingested event of scenario → first matching alert row (`detected_at − ingested_at_of_last_event`); report p50/p95 across scenarios.

**FP triage protocol:** if FP >10%, metrics runner prints top offenders (rule + explanation + entities); tune rule params in `rules` table (not code) and re-run; log each tuning decision in docs/07 Reconciliation Log.

## 7. Frontend Test Catalog

| ID | Case | Expect |
|---|---|---|
| T-FE-01..04 | EvidencePanel loading/loaded/error/empty | `evidence-panel` testid present in all 4 |
| T-FE-05 | regression guard | no `dismiss-evidence` / `hide-evidence` element exists |
| T-FE-06 | factor table | raw_value + composite sum rendered |
| T-FE-07 | AlertInbox WS prepend | new alert row appears on channel message |
| T-FE-08 | Timeline order | DESC by ts |
| T-FE-09 | Timeline actor chip | present when actor≠null |
| T-FE-10 | Graph node aria-label | `${type} ${label}` |
| T-FE-11 | Cycle toggle | calls cycles endpoint, badge class applied |
| T-FE-12 | Case status dropdown | invalid transitions disabled |
| T-FE-13 | Close-case validation | <10 chars blocked client-side; 422 surfaced |
| T-FE-14 | Route guards | viewer redirected from /admin/rules |
| T-FE-15 | WS reconnect banner | shown on disconnect mock |

## 8. Performance Verification (NFR-01/02/03)

| Check | Method | Budget |
|---|---|---|
| ingest→WS alert | T-INT-05/06 timings, logged spans | p95 ≤5000ms |
| graph 2-hop | pytest bench fixture 10k nodes | p95 ≤500ms |
| alert list API | 30-run curl timing | p95 ≤300ms |
| graph rebuild | startup log | ≤30000ms for 100k rows |
| export ≤500 evidence | T-INT-15 timing | ≤5000ms |

**Measured (2026-09-30, P3 gate)** with `python -m tests.perf.bench_nfr` against the running stack (API + PostgreSQL 16 + Redis 7 in Docker, one Windows 11 dev laptop). It uses throwaway tenants that are deleted after the run.

| Check | n | p50 ms | p95 ms | max ms | Budget | Result |
|---|---|---|---|---|---|---|
| ingest → WS `alert.created` (3-leg loop, public API, real WebSocket) | 20 | 117 | 200 | 200 | p95 ≤ 5000 | PASS |
| graph 2-hop (`neighbors`, depth 2) on 10,000 nodes / 90,000 transfers | 200 | 17 | 21 | 24 | p95 ≤ 500 | PASS |
| alert list API (`GET /v1/alerts`, warm connection) | 30 | 20 | 23 | 24 | p95 ≤ 300 | PASS |
| graph rebuild from PostgreSQL, 100,000 rows | 1 | 2274 | 2274 | 2274 | ≤ 30000 | PASS |
| export ≤ 500 evidence | — | — | — | — | ≤ 5000 | not built yet (P4 case export) |

Single-run cross-checks: T-INT-05 ingest→alert 124–177 ms, T-INT-06 ≈ 195 ms, S1 re-plant publish→alert 86 ms (`test_demo_replant.py`). The 2-hop figure is the in-process graph call. The HTTP route adds serialisation, so the ≤500 budget has headroom for it.

## 9. Test Data Management

- All synthetic; **no production data** in repo.
- Scenario seeds are deterministic given `--seed` flag (documented in seed modules) for reproducible CI.
- Integration DB reset: `docker compose down -v` in CI job; locally, tests use `tenant_test_*` IDs and clean up in fixtures.
- Seed scripts double as test fixtures (single source of scenario truth: `app/seed/suspicious.py`).

## 10. Exit Mapping

| Gate | Required tests green |
|---|---|
| P0 | T-AUTH-*, smoke health |
| P1 | T-INT-01..04, T-INT-09, T-INT-10 (timeline), T-FE-08/09 |
| P2 | T-GRPH-01..06, T-FE-10/11 |
| P3 | T-DET-*, T-RISK-*, T-INT-05..08, T-FE-01..07 |
| P4 | T-INT-11..16, T-FE-12/13 |
| P5 | full matrix + S1–S5/L metrics PASS + perf budgets |
