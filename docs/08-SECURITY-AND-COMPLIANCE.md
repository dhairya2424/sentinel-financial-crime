# 08 — Security & Compliance

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0 | **Scope:** v1 demo-to-production posture; controls map to docs/01 NFR-07/08 and docs/02 §10

---

## 1. Assets & Data Classification

| Class | Examples | Storage | Notes |
|---|---|---|---|
| **Restricted — PII/financial** | customer names, account no (masked), transaction amounts, employee names/roles | PostgreSQL | Encrypt at rest (cloud disk encryption / `pgcrypto` not required for demo; required for prod) |
| **Restricted — credentials** | bcrypt password hashes, JWT signing secret | PG / env (secret manager in prod) | Never in repo, logs, or exports |
| **Confidential — investigative** | alerts, evidence snapshots, case notes, exports | PG + export files | Access limited by RBAC; exports carry digest for tamper-evidence |
| **Operational** | metrics, audit metadata | PG / logs | Logs must NOT contain full evidence payloads or tokens |

**Masking rule:** account numbers stored only as `account_no_masked` (docs/05 §3); raw PANs never stored. Evidence `snapshot` captures masked fields only.

## 2. Threat Model (STRIDE vs. Trust Boundaries)

```
[Browser] --HTTPS--> [FastAPI] --SQL--> [PostgreSQL]
    |                   |-----> [Redis]
    |---- WSS ----------> [WS Hub]
[Ingest client] --HTTPS--> [FastAPI /v1/ingest]
```

| # | Threat | STRIDE | Impact | Mitigation (v1) | Residual |
|---|---|---|---|---|---|
| T1 | Stolen/forged JWT → data access | Spoofing | High | HS256 with `JWT_SECRET` from env (≥32 chars enforced at boot in prod), 30-min expiry, refresh rotation, role check per route, tenant claim checked against resource | Stolen live token valid ≤30 min — prod: add refresh reuse detection |
| T2 | Cross-tenant data leak | Info disclosure | Critical | `tenant_id` on every table; repository-layer predicate; JWT tenant ≠ resource → **404** (no existence oracle); integration sweep test (docs/05 §7) | Low if repository discipline holds — CI test guards |
| T3 | SQL injection via search/filters | Tampering | Critical | SQLAlchemy bound params only; no raw string concat; PG search uses `ILIKE` with escaped `%_` | Low |
| T4 | Malicious ingest flood / oversized batch | DoS | Medium | Batch ≤500 (422 above), Pydantic `extra=forbid`, per-route role gate; prod: rate limit (100 req/min/IP on /ingest) + mTLS/API-key for ingest clients | Demo has no rate limit — documented |
| T5 | Evidence tampering after alert | Tampering | High | Evidence snapshots frozen at alert time (`alert_evidence.snapshot`); export SHA-256 digest recorded on case; audit_log append-only | DB admin can still alter — prod: ship digest to WORM store |
| T6 | Analyst views alert without evidence (regulatory gap) | Repudiation | High | EvidencePanel always mounted (Vitest guard); server always returns `explanation` + `risk_factors` non-null (Pydantic required); invariant Σcontrib=score asserted pre-persist | Low |
| T7 | Insider (reviewer) snoops unrelated cases | Info disclosure | Medium | RBAC: viewer read-scoped; case assign restricted (manager/investigator self); audit every mutation with actor | Prod: per-team case partitions |
| T8 | XSS via seeded names/notes rendered in React | Tampering | Medium | React default escaping; no `dangerouslySetInnerHTML` except HTML export server-side (Jinja autoescape); CSP header in nginx | Low |
| T9 | WS channel eavesdrop cross-tenant | Info disclosure | High | Channel name must embed JWT tenant; server rejects subscribe to foreign channel; token required on connect | Low |
| T10 | Secret leakage in repo/history | Info disclosure | High | `.env` git-ignored; `.env.example` placeholders only; gitleaks in CI (P5-A); JWT_SECRET no default when `ENV=production` | Rotate if leak: see Runbook §6 |

## 3. Authentication & Session Design

- **Issuer flow:** `POST /v1/auth/login` (email + tenant_id + password) → access JWT (30 min) + refresh JWT (12 h). Refresh: single-use rotation recommended (v1: reuse-tolerant, flagged in backlog).
- **JWT claims (exact):** `sub` (user id), `tenant_id`, `role`, `exp`, `iat`, `iss=sentinel`. No PII in claims.
- **Password policy (enforced at seeding + any user-create API):** ≥10 chars, mixed classes; bcrypt cost ≥12.
- **Service/ingest auth (v1):** investigator/admin JWT. **Prod hardening (documented, out of v1 scope):** dedicated machine clients with rotating API keys or mTLS — ingest is write-critical and should not share human JWTs.
- **Logout:** client discards tokens (v1 stateless — no server denylist; 30-min window accepted for demo).

## 4. Authorization Matrix (normative — enforced by `require_role`)

| Route group | viewer | investigator | manager | admin |
|---|---|---|---|---|
| Read: alerts, cases, graph, timeline, rules, dashboard | ✅ | ✅ | ✅ | ✅ |
| alert.acknowledge, alert.link-case | ❌ | ✅ | ✅ | ✅ |
| case.create, case.notes, case.close (own/assigned) | ❌ | ✅ | ✅ | ✅ |
| case.assign (to others) | ❌ | ❌ (self only) | ✅ | ✅ |
| case.export | ❌ | ✅ | ✅ | ✅ |
| ingest.* | ❌ | ✅ | ❌ | ✅ |
| rules.write, ops.replay, user mgmt | ❌ | ❌ | ❌ | ✅ |
| auth.refresh / me | ✅ | ✅ | ✅ | ✅ |

**Enforcement rules:** backend dependency on every mutation route (UI hiding is cosmetic); tests: parametrized role-matrix test in P5-A asserts every ❌ → 403 and every ✅ → non-403.

## 5. Audit Requirements (NFR-07)

Every state change writes `audit_log` row: `actor_user|system`, `action`, `object_type/id`, `detail` JSON (from→to for status changes), `created_at`.

**Mandatory audit actions (checked by test):** `login`, `login_failed`, `ingest.batch`, `alert.ack`, `alert.link`, `case.create`, `case.assign`, `case.note`, `case.status`, `case.export`, `rule.update`, `ops.replay`, `graph.rebuild` (admin repair of the in-memory graph, added in P2-A), `entity.create` (a customer, account or employee registered through `/v1/entities`, added with the Add data screen), `case.update` (priority or description changed, with from/to), `demo.replant` (the S1 demo loop re-planted by `app.seed.suspicious`, with the alerts it removed and the events it replayed).

Audit table is append-only: no UPDATE/DELETE API; DB role in prod should deny DML on `audit_log` except INSERT (migration note).

## 6. Evidence & Export Security

- Export accessible investigator+ and audited (`case.export` + digest).
- Bundle contains **snapshots only** (no live DB cursors); digest = SHA-256 over canonical JSON excluding `generated_at` (stable re-export test in P4-A).
- HTML export: autoescaped templates; served as attachment (`Content-Disposition`), `X-Content-Type-Options: nosniff`.
- Export files are client-downloaded (never stored server-side in v1) — reduces at-rest exposure.

## 7. Network & Transport

- Demo: localhost HTTP/WS acceptable; **production checklist:** TLS 1.2+ termination, HSTS, WSS only, CORS allowlist (no `*` with credentials), security headers (CSP, X-Frame-Options DENY, Referrer-Policy), DB on private subnet, Redis not exposed publicly, ingest via private link.

## 8. Data Retention & Privacy

| Data | v1 retention | Prod recommendation |
|---|---|---|
| transactions / actions | seed-dependent | Regulatory: 5–8 years (jurisdiction-specific) — partition by month |
| alerts + evidence | until case closed + 90d | Same as transactions; evidence snapshots must outlive source mutation |
| audit_log | lifetime of tenant | WORM / append-only partition, 7+ years |
| sessions (employee logins) | 90 days | 1 year |
| case exports | client-side | If stored: encrypted bucket + retention tag |

Right-to-erasure conflicts with AML record-keeping — customer deletion requests must tombstone PII, not delete transaction history (note for prod; out of v1).

## 9. Vulnerability & Supply-Chain Hygiene

- CI: `gitleaks detect` (secrets), `pip-audit` + `npm audit --production` (deps) — failures block merge (P5-A).
- Pin major versions in requirements/package-lock committed.
- No `dangerouslySetInnerHTML` in app code (grep gate in lint rule or review checklist).

## 10. Compliance Mapping (illustrative — not legal advice)

| Control area | Platform support |
|---|---|
| Explainable decisions (regulator challenge) | Mandatory explanation + factor decomposition; evidence freeze; digest |
| Four-eyes / segregation of duties | Role matrix; assign ≠ close rules; full audit |
| Suspicious activity follow-up | Case lifecycle + export bundle for SAR/STR workflows (manual filing in v1) |
| Access review of insider risk data | RBAC + audit of every read-critical mutation; prod: periodic access recertification |

## 11. Security Testing (wired into test strategy)

| Test | Where | Phase |
|---|---|---|
| Tenant isolation sweep (all read endpoints) | `tests/integration/test_tenant_isolation.py` | P1, extended P5-A |
| Role matrix parametrized | `tests/integration/test_role_matrix.py` | P5-A |
| JWT tamper/expired/foreign-tenant | `tests/unit/test_auth.py` | P0 |
| Ingest size/extra-field validation | `tests/integration/test_ingest_abuse.py` | P5-A |
| Secret scan | CI gitleaks | P5-A |
| Evidence-panel mandatory (regulatory UX) | frontend Vitest | P3-C |
