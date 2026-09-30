#!/usr/bin/env sh
# Suspicious scenarios (docs/11 §2, docs/10 §6) against the running API:
#  1. S1 live in tenant_demo: re-plants the demo loop and waits for its R-CIRC alert in the Alert Inbox.
#  2. S1-S5 in throwaway tenants through the running API; prints the scenario report and deletes the tenants.
#   scripts/replay-suspicious.sh [--local] [--with-legit]   (--with-legit adds the 200-customer corpus, ~20 min)
set -eu
cd "$(dirname "$0")/.."
local=""; legit="--skip-legit"
for arg in "$@"; do
  case "$arg" in
    --local) local=1 ;;
    --with-legit) legit="" ;;
    *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done
if [ -n "$local" ]; then
  (cd backend && python -m app.seed.suspicious --only S1)
  (cd backend && SCENARIO_API=http://localhost:8000 python -m tests.scenarios.metrics_runner $legit)
else
  docker compose exec -T api python -m app.seed.suspicious --only S1
  docker compose exec -T -e SCENARIO_API=http://127.0.0.1:8000 api python -m tests.scenarios.metrics_runner $legit
fi
