[CmdletBinding()]
param(
    [string]$SshHost = 'macmini',
    [string]$Branch = 'master',
    [ValidateRange(1, 5)][int]$MaxSshAttempts = 3,
    [ValidateRange(1, 60)][int]$RetryDelaySeconds = 5,
    # 2026-09-19 负责人决定：生产 MCP 全领域只读验收默认不参与发布阻断（生产配方数不足，
    # 且 MCP 可能被弃用）。需要恢复该步时传 -McpAcceptance enabled。
    [ValidateSet('disabled', 'enabled')][string]$McpAcceptance = 'disabled'
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
    for ($attempt = 1; $attempt -le $MaxSshAttempts; $attempt += 1) {
        if ($attempt -gt 1) {
            Write-Host "正在重试 Mac Mini SSH 发布（$attempt/$MaxSshAttempts）..."
        }
        $sshProcess = Start-Process `
            -FilePath 'ssh' `
            -ArgumentList @(
                '-o', 'ConnectTimeout=20',
                '-o', 'ServerAliveInterval=30',
                '-o', 'ServerAliveCountMax=6',
                $SshHost,
                "PUMP_DEPLOY_BRANCH=$Branch PUMP_DEPLOY_MCP_ACCEPTANCE=$McpAcceptance /bin/zsh -s"
            ) `
            -RedirectStandardInput $remoteScript `
            -NoNewWindow `
            -Wait `
            -PassThru
        if ($sshProcess.ExitCode -eq 0) {
            break
        }
        if ($sshProcess.ExitCode -ne 255 -or $attempt -eq $MaxSshAttempts) {
            throw "Mac Mini 发布失败，退出码：$($sshProcess.ExitCode)，尝试次数：$attempt。"
        }
        Write-Warning "SSH 隧道连接失败（退出码 255），$RetryDelaySeconds 秒后自动重试。远端发布脚本具备提交校验，可安全重放。"
        Start-Sleep -Seconds $RetryDelaySeconds
    }
} finally {
    Pop-Location
}
