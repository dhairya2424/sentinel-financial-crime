# 11 — Operations Runbook

**Product:** Sentinel — Financial Crime & Insider Risk Intelligence Platform
**Version:** 1.0 | **Audience:** operators, on-call, demo facilitators

---

## 1. Environments

| Env | Purpose | Provisioning | Data |
|---|---|---|---|
| `dev` | Local development | `docker compose up` | seeds, wipe freely |
| `demo` | Hackathon/judge demo | compose on demo laptop or single VM | committed seed recipe (below) |
| `staging` | Pre-prod validation | compose/VM + TLS | anonymized scenario data |
| `prod` | *(not in v1 scope — checklist in §9)* | orchestrated, HA PG/Redis | real/synthetic feed |

Config source: environment variables per docs/06 §4; `.env` never committed.

## 2. Standard Commands

```bash
# Start full stack (dev/demo)
docker compose up --build -d
docker compose ps                      # all healthy

# Backend only (hot reload)
cd backend && uvicorn app.main:app --reload --port 8000

# Frontend only
cd frontend && npm run dev             # :5173, proxies not required in dev (VITE_API_URL)

# Database
alembic upgrade head                   # apply migrations
alembic downgrade base                 # EMERGENCY only, destroys schema
docker compose down -v                 # RESET dev DB (destroys data!)

# Seed (order matters)
python -m app.seed.users
python -m app.seed.rules
python -m app.seed.legitimate --customers 50 --days 90
python -m app.seed.suspicious --only S1,S2,S3,S4,S5   # demo scenarios
python -m app.seed --scenario mixed                     # combined convenience

# Tests / quality
pytest tests/unit -q
pytest tests/integration -q
pytest tests/scenarios -q --metrics
npm run test && npm run typecheck && npm run lint

# Logs
docker compose logs -f api | Select-Object -Last 200    # PowerShell
docker compose logs -f web
```

**Default logins (dev/demo only):** `investigator@demo.dev`, `manager@demo.dev`, `admin@demo.dev`, `viewer@demo.dev` — password `Demo!23456`, tenant `tenant_demo` (ADR-013). The seed refuses to run with `ENV=production`.

**Host port clash (Windows):** if native PostgreSQL/Redis services already own 5432/6379, create a root `.env` with `PG_HOST_PORT=5433` and `REDIS_HOST_PORT=6380`, and point `backend/.env` `DATABASE_URL`/`REDIS_URL` at those ports. Compose defaults remain 5432/6379.

## 3. Service Architecture & Ports

| Service | Port | Depends on | Health |
|---|---|---|---|
| postgres | 5432 | — | `pg_isready -U sentinel` |
| redis | 6379 | — | `redis-cli ping` → PONG |
| api (uvicorn) | 8000 | pg, redis | `GET /v1/ops/health` → db/redis `ok` |
| web (vite dev / nginx) | 5173 dev / 80 demo | api | loads `/login` |

## 4. Health & Monitoring

| Signal | Source | Healthy | Alert when |
|---|---|---|---|
| API up | `/v1/ops/health` | 200, db+redis `ok` | 2 consecutive fails / down 60s |
| Pipeline | `/v1/ops/health.pipeline` | `errors` flat, `processed` increasing under load | errors increasing; stream_lag_ms >10000 |
| WS clients | `ws_clients` | >0 during demo | drops to 0 while users active |
| Ingest failures | `ingest_failures` where `replayed_at IS NULL` | 0 | >0 for >5 min |
| Alert latency | logged spans p95 | ≤5000ms | p95 >10000ms |
| Disk (PG volume) | host | <80% | >85% |
| JVM-less metrics | Redis stream length | drains | `events` stream grows unbounded |

**v1 observability:** structured JSON logs to stdout (levels INFO/WARN/ERROR), ops endpoint counters. No Prometheus in v1 — see §9.

**Log fields (every pipeline log):** `ts`, `level`, `event`, `tenant_id`, `event_id`, `rule_code?`, `latency_ms?`. **Never log:** JWTs, passwords, full evidence snapshots (log `alert_id` instead).

## 5. Common Incidents

### INC-1: API down
1. `docker compose ps` — restart api: `docker compose restart api`.
2. Check logs for traceback (migrations missing? run `alembic upgrade head`).
3. If config error: verify `.env` (JWT_SECRET set, DATABASE_URL reachable).
4. Verify `/v1/ops/health`; re-run smoke login curl.

### INC-2: Alerts not appearing (detection stall)
1. `/v1/ops/health` → `pipeline.processed` advancing? If frozen:
2. `docker compose logs api | grep -i "pipeline\|consumer"` — look for exceptions (poison message).
3. Check Redis stream: `docker compose exec redis redis-cli XINFO STREAM events`.
4. Check `SELECT count(*) FROM ingest_failures WHERE replayed_at IS NULL`.
5. Restart consumer path: `docker compose restart api` (consumer rebuilds graph at startup — note rebuild duration).
6. After fix: replay failures: `POST /v1/ops/replay-batch {failure_id}` as admin.

### INC-3: Graph empty / wrong
1. Startup rebuild may still be running (watch logs for `graph rebuild`).
2. If stale: restart api (rebuild is the v1 repair action; no partial-desync repair needed because rebuild is authoritative).
3. Verify seed ran with data: `SELECT count(*) FROM transactions`.

### INC-4: WebSocket clients stuck "reconnecting"
1. Confirm api up; if behind nginx in demo container, check `/v1/ws` proxy upgrade headers (`Upgrade`/`Connection`) in nginx conf.
2. Token expired (30 min) → user re-login; banner should clear on reconnect.
3. Frontend backoff is exponential to 30s — wait or refresh page.

### INC-5: False-positive flood in demo
1. Do NOT delete alerts mid-demo (audit integrity).
2. Pause ingest (stop seed replay).
3. Re-tune: admin `PUT /v1/rules/{code}` raise threshold/window; re-run `pytest tests/scenarios --metrics` after demo.
4. Document tuning in docs/07 Reconciliation Log.

### INC-6: Slow detection (latency >5s)
1. Check host CPU (demo laptops); stop frontend HMR if needed.
2. `pipeline.lag_ms` — if Redis backlog high, restart api to reprocess (idempotent dedup protects alert table).
3. Graph rebuild time at boot should be <30s — if much larger, verify no accidental cartesian seed.

### INC-7: Suspected secret leak
1. Rotate: set new `JWT_SECRET` (all tokens invalidate — users re-login); rotate DB password if involved.
2. Remove from git history if committed (`git filter-repo`), force-coord with team.
3. gitleaks: `gitleaks detect --source . -v`.
4. Write incident note in team channel.

## 6. Backup & Restore (dev/demo)

```bash
# Backup
docker compose exec postgres pg_dump -U sentinel -d sentinel -Fc > backup_$(Get-Date -Format yyyyMMdd).dump
# Restore
docker compose exec -T postgres pg_restore -U sentinel -d sentinel --clean --if-exists < backup.dump
```
- Demo day: take backup after seed completes (pre-demo snapshot for quick reset).
- Redis is ephemeral in v1 (no persistence required) — losing it only pauses delivery of not-yet-consumed events; PG is source of truth.

## 7. Deploy (demo VM recipe)

1. Install Docker Engine + compose plugin; open 80/443 (web), do not expose 5432/6379 publicly.
2. Clone repo; copy `.env.example` → `.env`; set `JWT_SECRET` (32+ random bytes), `ENV=production`.
3. `docker compose up --build -d`; wait healthy.
4. Seed once: users, rules, legitimate, suspicious (§2).
5. Smoke: login curl + open `https://<host>/login`.
6. TLS: terminate with Caddy/Traefik or `certbot` + nginx; force HTTPS; WSS on same vhost with proxy upgrade.

## 8. Release Procedure

1. CI green on main (all §2 test gates).
2. Tag `vX.Y.Z`; note docs reconciliation status (docs/07 log).
3. Deploy to staging → run scenario metrics smoke → promote.
4. Migration policy: forward-only in release window; never edit an applied migration — add a new one.
5. Rollback: redeploy previous image; DB rollback only via documented down migration + data restore (avoid in prod).

## 9. Production Hardening Checklist (out of v1 scope)

- [ ] HA: PG managed service + replicas; Redis Sentinel/Cluster; ≥2 API replicas behind LB (consumer: single active leader or partitioned streams per tenant)
- [ ] Secrets: Vault/cloud secret manager; no env files on disk
- [ ] Observability: Prometheus metrics (pipeline latency histogram, alert counts by band), Grafana dashboards, log shipping, PagerDuty on health SLO burn
- [ ] SLOs: availability 99.9%; alert latency p95 <5s; daily error budget review
- [ ] Ingest auth: mTLS or HMAC-signed service credentials (docs/08 §7)
- [ ] Rate limiting + WAF at edge; per-tenant quotas
- [ ] WORM export store for case bundles + digest anchoring
- [ ] DR: PITR for PG, quarterly restore drills, RPO ≤5min RTO ≤1h
- [ ] Security: external pen test, dependency auto-update (Dependabot), annual access review
- [ ] Compliance: retention jobs per docs/08 §8, legal hold flag support

## 10. Demo-Day Checklist (T-30 min)

- [ ] `docker compose ps` all healthy; `/v1/ops/health` ok
- [ ] Fresh seed run completed; metrics report PASS printed (for Q&A ammo)
- [ ] Login smoke as investigator
- [ ] Plant S1 live in second terminal (for "real-time" moment during demo)
- [ ] WS connected (green badge), no reconnect banner
- [ ] Export a case once (JSON downloads cleanly)
- [ ] Backup snapshot taken
- [ ] Screenshots fallback saved (in case of venue Wi-Fi loss)
