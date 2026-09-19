const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Mac Mini 一键发布：Windows 入口只部署已推送提交并通过 stdin 传递脚本', () => {
    const wrapper = read('scripts/deploy-macmini.ps1');
    const pkg = JSON.parse(read('package.json'));

    assert.match(pkg.scripts['deploy:macmini'], /deploy-macmini\.ps1/);
    assert.match(wrapper, /--untracked-files=no/);
    assert.match(wrapper, /origin\/\$Branch/);
    assert.match(wrapper, /Start-Process[\s\S]*-FilePath 'ssh'/);
    assert.match(wrapper, /-RedirectStandardInput \$remoteScript/);
    assert.doesNotMatch(wrapper, /Get-Content[\s\S]*\|\s*& ssh/);
    assert.match(wrapper, /ServerAliveInterval=30/);
    assert.match(wrapper, /MaxSshAttempts = 3/);
    assert.match(wrapper, /ConnectTimeout=20/);
    assert.match(wrapper, /ExitCode -ne 255/);
    assert.match(wrapper, /Start-Sleep -Seconds \$RetryDelaySeconds/);
    assert.match(wrapper, /\/bin\/zsh -s/);
    // 2026-09-19：生产 MCP 只读验收默认不参与发布阻断，可显式恢复。
    assert.match(wrapper, /\[ValidateSet\('disabled', 'enabled'\)\]\[string\]\$McpAcceptance = 'disabled'/);
    assert.match(wrapper, /PUMP_DEPLOY_MCP_ACCEPTANCE=\$McpAcceptance/);
});

test('Mac Mini 一键发布：备份、快进、门禁、重启和公网验收顺序固定', () => {
    const deploy = read('scripts/deploy-macmini-release.sh');
    const backupIndex = deploy.indexOf('db:backup:release');
    const pullIndex = deploy.indexOf('git pull --ff-only');
    const releaseGateIndex = deploy.indexOf('run verify:release');
    const restartIndex = deploy.indexOf('launchctl kickstart -k system/com.pumpfactory.api');
    const aiGateIndex = deploy.indexOf('run verify:ai-release');
    const publicIndex = deploy.indexOf('公网 API ready');

    assert.ok(backupIndex >= 0 && backupIndex < pullIndex);
    assert.ok(pullIndex < releaseGateIndex);
    assert.ok(releaseGateIndex < restartIndex);
    assert.ok(restartIndex < aiGateIndex);
    assert.ok(aiGateIndex < publicIndex);
    assert.doesNotMatch(deploy, /sudo\s+(?:-n\s+)?launchctl\s+kickstart/);
    assert.match(deploy, /release-code-gate-\$new_commit\.json/);
    assert.match(deploy, /startupBackup\?\.ok !== true/);
    assert.match(deploy, /gitCommit/);
    // MCP 只读验收只作为可选项存在：默认分支不得调用 verify:mcp-prod-read。
    assert.match(deploy, /\$\{PUMP_DEPLOY_MCP_ACCEPTANCE:-disabled\}/);
    assert.match(deploy, /McpAcceptance enabled/);
});

test('测试运行器：每个测试进程使用独立临时数据库而不是生产 pump.db', () => {
    const db = read('api/db.cjs');
    const runner = read('scripts/run-tests.cjs');

    assert.match(db, /process\.env\.NODE_ENV === 'test'/);
    assert.match(db, /PUMP_TEST_DATABASE_PATH/);
    assert.match(db, /\{pid\}/);
    assert.match(runner, /mkdtempSync/);
    assert.match(runner, /PUMP_TEST_DATABASE_PATH/);
    assert.match(runner, /pump-\{pid\}\.db/);
    assert.match(runner, /rmSync\(testDatabaseDir/);
});
