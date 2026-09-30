# Suspicious scenarios (docs/11 §2, docs/10 §6) against the running API:
#  1. S1 live in tenant_demo: re-plants the demo loop and waits for its R-CIRC alert in the Alert Inbox.
#  2. S1-S5 in throwaway tenants through the running API; prints the scenario report and deletes the tenants.
#   scripts\replay-suspicious.ps1 [-Local] [-WithLegit]   (-WithLegit adds the 200-customer corpus, ~20 min)
param([switch]$Local, [switch]$WithLegit)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$runner = @('-m', 'tests.scenarios.metrics_runner')
if (-not $WithLegit) { $runner += '--skip-legit' }
if ($Local) {
    $python = Join-Path (Resolve-Path 'backend') '.venv\Scripts\python.exe'
    Push-Location backend
    try {
        & $python -m app.seed.suspicious --only S1
        if ($LASTEXITCODE -ne 0) { throw "S1 plant failed ($LASTEXITCODE)" }
        $env:SCENARIO_API = 'http://localhost:8000'
        & $python @runner
    } finally { Remove-Item Env:SCENARIO_API -ErrorAction SilentlyContinue; Pop-Location }
} else {
    docker compose exec -T api python -m app.seed.suspicious --only S1
    if ($LASTEXITCODE -ne 0) { throw "S1 plant failed ($LASTEXITCODE)" }
    docker compose exec -T -e SCENARIO_API=http://127.0.0.1:8000 api python @runner
}
if ($LASTEXITCODE -ne 0) { throw "scenario report FAILED ($LASTEXITCODE)" }
