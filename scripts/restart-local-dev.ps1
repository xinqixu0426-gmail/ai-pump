$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$ports = @(3000, 3002)
$logDir = Join-Path $root 'logs'
$apiOut = Join-Path $logDir 'local-api.out.log'
$apiErr = Join-Path $logDir 'local-api.error.log'
$webOut = Join-Path $logDir 'local-web.out.log'
$webErr = Join-Path $logDir 'local-web.error.log'

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$listeners = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

foreach ($listenerPid in $listeners) {
    Stop-Process -Id $listenerPid -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

$apiProcess = Start-Process `
    -FilePath 'node.exe' `
    -ArgumentList @('api.cjs') `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $apiOut `
    -RedirectStandardError $apiErr `
    -PassThru

$webProcess = Start-Process `
    -FilePath 'npm.cmd' `
    -ArgumentList @('--prefix', 'apps/web-next', 'run', 'dev:primary') `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $webOut `
    -RedirectStandardError $webErr `
    -PassThru

Start-Sleep -Seconds 8

$activeListeners = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue |
    Select-Object LocalPort, State, OwningProcess |
    Sort-Object LocalPort

Write-Host "API pid: $($apiProcess.Id), logs: $apiOut / $apiErr"
Write-Host "Web pid: $($webProcess.Id), logs: $webOut / $webErr"
$activeListeners | Format-Table -AutoSize
