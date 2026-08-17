param(
    [ValidateSet('status', 'add', 'rotate', 'revoke', 'grant-write', 'revoke-write', 'verify', 'list-backups', 'rollback')]
    [string]$Action = 'status',
    [string]$ClientId,
    [string]$Tool,
    [string]$ClientTokenEnvVar,
    [switch]$UseExistingToken,
    [switch]$Apply,
    [string]$BackupFile,
    [switch]$Latest,
    [string]$SshHost = 'macmini',
    [string]$RemoteRoot = '~/pump-cost-accounting-system',
    [int]$ExpectedToolCount = 45
)

$ErrorActionPreference = 'Stop'
$applyConfirmation = 'APPLY_MCP_IDENTITY_CHANGE'
$rollbackConfirmation = 'ROLLBACK_MCP_IDENTITY_CHANGE'

if ($SshHost -notmatch '^[a-zA-Z0-9._-]+$') { throw 'Invalid SshHost' }
if ($RemoteRoot -notmatch '^[~a-zA-Z0-9_./-]+$') { throw 'Invalid RemoteRoot' }
if ($ClientId -and $ClientId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$') {
    throw 'Invalid ClientId'
}
if ($Tool -and $Tool -notmatch '^[a-z][a-z0-9_]{0,63}$') { throw 'Invalid Tool' }
if ($ClientTokenEnvVar -and $ClientTokenEnvVar -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
    throw 'Invalid ClientTokenEnvVar'
}
if ($BackupFile -and $BackupFile -notmatch '^[/~a-zA-Z0-9_ .-]+$') {
    throw 'Invalid BackupFile'
}
if ($ExpectedToolCount -lt 0 -or $ExpectedToolCount -gt 1000) {
    throw 'ExpectedToolCount must be an integer from 0 to 1000'
}

function New-McpToken {
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Invoke-MacMini {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string]$StdinValue
    )
    if ($PSBoundParameters.ContainsKey('StdinValue')) {
        $output = $StdinValue | & ssh $SshHost $Command
    } else {
        $output = & ssh $SshHost $Command
    }
    if ($LASTEXITCODE -ne 0) { throw "Mac Mini command failed with exit code $LASTEXITCODE" }
    return ($output -join "`n")
}

function IdentityCommand {
    param([string]$Arguments)
    return "cd $RemoteRoot && /opt/homebrew/bin/node scripts/manage-mcp-identities.cjs $Arguments"
}

function Restart-Api {
    $command = "cd $RemoteRoot && /bin/launchctl kickstart -k system/com.pumpfactory.api"
    $command += " && for i in {1..60}; do /usr/bin/curl -fsS http://127.0.0.1:3002/api/health/ready >/dev/null && exit 0; /bin/sleep 1; done; exit 1"
    Invoke-MacMini -Command $command | Out-Null
}

function Verify-AllIdentities {
    $args = "verify --env-file .env --url http://127.0.0.1:3002/mcp"
    $args += " --host xuxinqi.xin --expect-tool-count $ExpectedToolCount"
    $raw = Invoke-MacMini -Command (IdentityCommand $args)
    $result = $raw | ConvertFrom-Json
    if (-not $result.success) { throw 'MCP identity live verification failed' }
    return $result
}

function Restore-RemoteBackup {
    param([Parameter(Mandatory = $true)][string]$File)
    if ($File -notmatch '^[/~a-zA-Z0-9_ .-]+$') { throw 'Invalid remote backup path' }
    $args = "rollback --env-file .env --file '$File' --apply --confirm $rollbackConfirmation"
    Invoke-MacMini -Command (IdentityCommand $args) | Out-Null
    Restart-Api
}

function Read-RemoteIdentityToken {
    param([Parameter(Mandatory = $true)][string]$Identity)
    $source = @'
const fs = require('fs');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync('.env'));
const tokens = JSON.parse(env.MCP_SERVICE_TOKENS || '{}');
const token = String(tokens[process.argv[1]] || '');
if (!token) process.exit(2);
process.stdout.write(token);
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($source))
    $command = "cd $RemoteRoot && /opt/homebrew/bin/node -e `"eval(Buffer.from('$encoded','base64').toString())`" $Identity"
    $token = Invoke-MacMini -Command $command
    if ([string]::IsNullOrWhiteSpace($token)) { throw 'Client token was not found after rollback' }
    return $token
}

if ($Action -in @('add', 'rotate', 'revoke', 'grant-write', 'revoke-write') -and -not $ClientId) {
    throw "$Action requires -ClientId"
}
if ($Action -in @('grant-write', 'revoke-write') -and -not $Tool) {
    throw "$Action requires -Tool"
}
if ($Action -in @('add', 'rotate') -and -not $ClientTokenEnvVar) {
    throw "$Action requires -ClientTokenEnvVar"
}
if ($Action -eq 'rollback' -and $Apply -and (-not $ClientId -or -not $ClientTokenEnvVar)) {
    throw 'rollback -Apply requires -ClientId and -ClientTokenEnvVar'
}

$oldUserToken = if ($ClientTokenEnvVar) {
    [Environment]::GetEnvironmentVariable($ClientTokenEnvVar, 'User')
} else { $null }
$newToken = $null
$remoteResult = $null

if ($Action -in @('add', 'rotate')) {
    if ($UseExistingToken) {
        $newToken = $oldUserToken
        if ([string]::IsNullOrWhiteSpace($newToken)) {
            throw "User environment variable is not set: $ClientTokenEnvVar"
        }
    } else {
        $newToken = New-McpToken
    }
    $args = "$Action --env-file .env --client-id $ClientId --token-stdin"
    if ($Apply) { $args += " --apply --confirm $applyConfirmation" }
    $raw = Invoke-MacMini -Command (IdentityCommand $args) -StdinValue $newToken
    $remoteResult = $raw | ConvertFrom-Json
} elseif ($Action -eq 'revoke') {
    $args = "revoke --env-file .env --client-id $ClientId"
    if ($Apply) { $args += " --apply --confirm $applyConfirmation" }
    $raw = Invoke-MacMini -Command (IdentityCommand $args)
    $remoteResult = $raw | ConvertFrom-Json
} elseif ($Action -in @('grant-write', 'revoke-write')) {
    $args = "$Action --env-file .env --client-id $ClientId --tool $Tool"
    if ($Apply) { $args += " --apply --confirm $applyConfirmation" }
    $raw = Invoke-MacMini -Command (IdentityCommand $args)
    $remoteResult = $raw | ConvertFrom-Json
} elseif ($Action -eq 'rollback') {
    $selector = if ($BackupFile) { "--file '$BackupFile'" } elseif ($Latest) { '--latest' } else {
        throw 'rollback requires -BackupFile or -Latest'
    }
    $args = "rollback --env-file .env $selector"
    if ($Apply) { $args += " --apply --confirm $rollbackConfirmation" }
    $raw = Invoke-MacMini -Command (IdentityCommand $args)
    $remoteResult = $raw | ConvertFrom-Json
} elseif ($Action -eq 'verify') {
    $remoteResult = Verify-AllIdentities
} else {
    $raw = Invoke-MacMini -Command (IdentityCommand "$Action --env-file .env")
    $remoteResult = $raw | ConvertFrom-Json
}

if (-not $Apply -or $Action -notin @('add', 'rotate', 'revoke', 'grant-write', 'revoke-write', 'rollback')) {
    $remoteResult | ConvertTo-Json -Depth 20
    exit 0
}

try {
    if ($Action -in @('add', 'rotate')) {
        [Environment]::SetEnvironmentVariable($ClientTokenEnvVar, $newToken, 'User')
    } elseif ($Action -eq 'revoke' -and $ClientTokenEnvVar) {
        [Environment]::SetEnvironmentVariable($ClientTokenEnvVar, $null, 'User')
    } elseif ($Action -eq 'rollback') {
        $restoredToken = Read-RemoteIdentityToken -Identity $ClientId
        [Environment]::SetEnvironmentVariable($ClientTokenEnvVar, $restoredToken, 'User')
    }
    Restart-Api
    $verified = Verify-AllIdentities
} catch {
    $rollbackSource = if ($remoteResult.backup) {
        [string]$remoteResult.backup
    } elseif ($remoteResult.safetyBackup) {
        [string]$remoteResult.safetyBackup
    } else { $null }
    if ($rollbackSource) {
        Restore-RemoteBackup -File $rollbackSource
    }
    if ($ClientTokenEnvVar) {
        [Environment]::SetEnvironmentVariable($ClientTokenEnvVar, $oldUserToken, 'User')
    }
    throw
}

[ordered]@{
    success = $true
    action = $Action
    clientId = $ClientId
    tool = $Tool
    applied = $true
    backup = if ($remoteResult.backup) { $remoteResult.backup } else { $remoteResult.safetyBackup }
    clientEnvironmentUpdated = [bool]$ClientTokenEnvVar
    verifiedIdentities = @($verified.live | ForEach-Object { $_.clientId })
} | ConvertTo-Json -Depth 10
