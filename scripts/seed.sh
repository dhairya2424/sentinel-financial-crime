#!/usr/bin/env sh
# Seed a fresh stack (docs/11 §2): demo logins, rule defaults, and the planted demo loop. Idempotent.
#   scripts/seed.sh           # inside the running compose api container
#   scripts/seed.sh --local   # with backend/'s Python (activate its venv first)
# No invented customers or transfers: everything else in tenant_demo comes from real entry (Add data / ingest API).
set -eu
cd "$(dirname "$0")/.."
if [ "${1:-}" = "--local" ]; then
  py() { (cd backend && python -m "$@"); }
else
  py() { docker compose exec -T api python -m "$@"; }
fi
py app.seed.users
py app.seed.rules
py app.seed.demo_loop
