[CmdletBinding()]
param(
    [string]$SshHost = 'macmini',
    [string]$Branch = 'master'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$remoteScript = Join-Path $PSScriptRoot 'deploy-macmini-release.sh'

function Invoke-GitText {
    param([Parameter(Mandatory)][string[]]$Arguments)

    $output = & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Git 命令失败：git $($Arguments -join ' ')"
    }
    return ($output | Out-String).Trim()
}

Push-Location $projectRoot
try {
    $trackedChanges = Invoke-GitText -Arguments @(
        'status',
        '--porcelain',
        '--untracked-files=no'
    )
    if ($trackedChanges) {
        throw "存在未提交的已跟踪文件，拒绝部署：`n$trackedChanges"
    }

    $currentBranch = Invoke-GitText -Arguments @('branch', '--show-current')
    if ($currentBranch -ne $Branch) {
        throw "当前分支为 $currentBranch，部署要求分支为 $Branch。"
    }

    & git fetch origin $Branch
    if ($LASTEXITCODE -ne 0) {
        throw "无法刷新 origin/$Branch。"
    }
    $localCommit = Invoke-GitText -Arguments @('rev-parse', 'HEAD')
    $originCommit = Invoke-GitText -Arguments @('rev-parse', "origin/$Branch")
    if ($localCommit -ne $originCommit) {
        throw "本地 HEAD 尚未与 origin/$Branch 同步，请先 push。"
    }

    Write-Host "准备部署 $($localCommit.Substring(0, 7)) 到 $SshHost。"
    Get-Content -LiteralPath $remoteScript -Raw -Encoding UTF8 |
        & ssh `
            -o ServerAliveInterval=30 `
            -o ServerAliveCountMax=6 `
            $SshHost `
            "PUMP_DEPLOY_BRANCH=$Branch /bin/zsh -s"
    if ($LASTEXITCODE -ne 0) {
        throw "Mac Mini 发布失败，退出码：$LASTEXITCODE。"
    }
} finally {
    Pop-Location
}
