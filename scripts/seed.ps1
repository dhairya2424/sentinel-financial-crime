# Seed a fresh stack (docs/11 §2): demo logins, rule defaults, and the planted demo loop. Idempotent.
#   scripts\seed.ps1          # inside the running compose api container
#   scripts\seed.ps1 -Local   # with backend\.venv
# No invented customers or transfers: everything else in tenant_demo comes from real entry (Add data / ingest API).
param([switch]$Local)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$python = Join-Path (Resolve-Path 'backend') '.venv\Scripts\python.exe'
foreach ($module in 'app.seed.users', 'app.seed.rules', 'app.seed.demo_loop') {
    if ($Local) {
        Push-Location backend
        try { & $python -m $module } finally { Pop-Location }
    } else {
        docker compose exec -T api python -m $module
    }
    if ($LASTEXITCODE -ne 0) { throw "$module failed ($LASTEXITCODE)" }
}
