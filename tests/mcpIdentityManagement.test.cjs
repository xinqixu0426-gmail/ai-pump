const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dotenv = require('dotenv');
const {
    APPLY_CONFIRMATION,
    ROLLBACK_CONFIRMATION,
    executeIdentityChange,
    executeRollback,
    identitySummary,
    listIdentityBackups,
    planIdentityChange,
    quoteEnvValue,
    verifyLiveIdentities,
} = require('../scripts/mcp-identity-config.cjs');

const TOKEN_HERMES = 'hermes-token-0123456789abcdef0123456789';
const TOKEN_CODEX = 'codex-token-0123456789abcdef01234567890';
const TOKEN_CLAUDE = 'claude-token-0123456789abcdef0123456789';
const TOKEN_ROTATED = 'rotated-token-0123456789abcdef01234567';

function envText(overrides = {}) {
    const values = {
        MCP_ENABLED: 'true',
        MCP_SERVICE_TOKENS: JSON.stringify({
            hermes: TOKEN_HERMES,
            codex: TOKEN_CODEX,
        }),
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'hermes',
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
            hermes: ['sync_factory_knowledge'],
        }),
        MCP_RATE_LIMIT_PER_MINUTE: '60',
        MCP_MAX_RESULT_BYTES: '262144',
        ...overrides,
    };
    return Object.entries(values)
        .map(([name, value]) => `${name}=${quoteEnvValue(value)}`)
        .join('\n') + '\n';
}

function tempFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-identities-'));
    const envFile = path.join(root, '.env');
    fs.writeFileSync(envFile, envText(), { mode: 0o600 });
    return {
        root,
        envFile,
        backupRoot: path.join(root, 'identity-backups'),
        cleanup() {
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}

test('MCP 身份管理：状态只输出身份和权限，不泄露 token', () => {
    const summary = identitySummary(dotenv.parse(envText()));
    assert.equal(summary.valid, true);
    assert.equal(summary.identityCount, 2);
    assert.deepEqual(summary.identities, [
        { clientId: 'codex', access: 'read-only', writeTools: [] },
        {
            clientId: 'hermes',
            access: 'read-write',
            writeTools: ['sync_factory_knowledge'],
        },
    ]);
    const serialized = JSON.stringify(summary);
    assert.equal(serialized.includes(TOKEN_HERMES), false);
    assert.equal(serialized.includes(TOKEN_CODEX), false);
});

test('MCP 身份管理：新增默认 dry-run 且计划不包含 token', () => {
    const fixture = tempFixture();
    try {
        const before = fs.readFileSync(fixture.envFile, 'utf8');
        const result = executeIdentityChange({
            command: 'add',
            envFile: fixture.envFile,
            clientId: 'claude-code',
            token: TOKEN_CLAUDE,
            backupRoot: fixture.backupRoot,
        });
        assert.equal(result.applied, false);
        assert.equal(result.change, 'identity-added');
        assert.equal(fs.readFileSync(fixture.envFile, 'utf8'), before);
        assert.deepEqual(listIdentityBackups(fixture.envFile, fixture.backupRoot), []);
        assert.equal(JSON.stringify(result).includes(TOKEN_CLAUDE), false);
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理：写入要求固定确认词且失败前不创建备份', () => {
    const fixture = tempFixture();
    try {
        assert.throws(() => executeIdentityChange({
            command: 'rotate',
            envFile: fixture.envFile,
            clientId: 'codex',
            token: TOKEN_ROTATED,
            apply: true,
            confirmation: 'yes',
            backupRoot: fixture.backupRoot,
        }), new RegExp(APPLY_CONFIRMATION));
        assert.deepEqual(listIdentityBackups(fixture.envFile, fixture.backupRoot), []);
        assert.equal(
            JSON.parse(dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8')).MCP_SERVICE_TOKENS).codex,
            TOKEN_CODEX
        );
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理：轮换原子写入、保留权限并生成受限备份', () => {
    const fixture = tempFixture();
    try {
        const result = executeIdentityChange({
            command: 'rotate',
            envFile: fixture.envFile,
            clientId: 'hermes',
            token: TOKEN_ROTATED,
            apply: true,
            confirmation: APPLY_CONFIRMATION,
            backupRoot: fixture.backupRoot,
            now: new Date('2026-08-17T12:00:00.000Z'),
        });
        const env = dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8'));
        const tokens = JSON.parse(env.MCP_SERVICE_TOKENS);
        assert.equal(result.applied, true);
        assert.equal(tokens.hermes, TOKEN_ROTATED);
        assert.equal(tokens.codex, TOKEN_CODEX);
        assert.equal(env.MCP_WRITE_CLIENT_IDS, 'hermes');
        assert.deepEqual(JSON.parse(env.MCP_WRITE_TOOL_ALLOWLISTS), {
            hermes: ['sync_factory_knowledge'],
        });
        assert.equal(fs.existsSync(result.backup), true);
        assert.equal(fs.readFileSync(result.backup, 'utf8').includes(TOKEN_HERMES), true);
        assert.equal(JSON.stringify(result).includes(TOKEN_HERMES), false);
        if (process.platform !== 'win32') {
            assert.equal((fs.statSync(result.backup).mode & 0o777), 0o600);
            assert.equal((fs.statSync(fixture.envFile).mode & 0o777), 0o600);
        }
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理：撤销身份同时清除写权限并关闭空写灰度', () => {
    const planned = planIdentityChange({
        command: 'revoke',
        envText: envText(),
        clientId: 'hermes',
    });
    const env = dotenv.parse(planned.nextText);
    assert.deepEqual(JSON.parse(env.MCP_SERVICE_TOKENS), { codex: TOKEN_CODEX });
    assert.equal(env.MCP_WRITE_ENABLED, 'false');
    assert.equal(env.MCP_WRITE_CLIENT_IDS, '');
    assert.deepEqual(JSON.parse(env.MCP_WRITE_TOOL_ALLOWLISTS), {});
    assert.deepEqual(planned.plan.removedWriteTools, ['sync_factory_knowledge']);
    assert.equal(planned.plan.writeDisabled, true);
    assert.equal(planned.plan.after.valid, true);
});

test('MCP 身份管理：按身份授予和撤销单个写工具且不扩大其他权限', () => {
    const granted = planIdentityChange({
        command: 'grant-write',
        envText: envText(),
        clientId: 'codex',
        tool: 'sync_factory_knowledge',
    });
    const grantedEnv = dotenv.parse(granted.nextText);
    assert.equal(grantedEnv.MCP_WRITE_ENABLED, 'true');
    assert.deepEqual(grantedEnv.MCP_WRITE_CLIENT_IDS.split(','), ['hermes', 'codex']);
    assert.deepEqual(JSON.parse(grantedEnv.MCP_WRITE_TOOL_ALLOWLISTS), {
        hermes: ['sync_factory_knowledge'],
        codex: ['sync_factory_knowledge'],
    });
    assert.equal(granted.plan.change, 'write-tool-granted');
    assert.equal(granted.plan.tool, 'sync_factory_knowledge');
    assert.deepEqual(granted.plan.after.identities.find(item => item.clientId === 'codex'), {
        clientId: 'codex',
        access: 'read-write',
        writeTools: ['sync_factory_knowledge'],
    });

    const revoked = planIdentityChange({
        command: 'revoke-write',
        envText: granted.nextText,
        clientId: 'codex',
        tool: 'sync_factory_knowledge',
    });
    const revokedEnv = dotenv.parse(revoked.nextText);
    assert.equal(revokedEnv.MCP_WRITE_CLIENT_IDS, 'hermes');
    assert.deepEqual(JSON.parse(revokedEnv.MCP_WRITE_TOOL_ALLOWLISTS), {
        hermes: ['sync_factory_knowledge'],
    });
    assert.equal(revoked.plan.change, 'write-tool-revoked');
    assert.equal(revoked.plan.writeDisabled, false);
});

test('MCP 身份管理：写工具授权拒绝未知工具、未知身份和重复授权', () => {
    assert.throws(() => planIdentityChange({
        command: 'grant-write',
        envText: envText(),
        clientId: 'codex',
        tool: 'unknown_write_tool',
    }), /不在当前灰度集合/);
    assert.throws(() => planIdentityChange({
        command: 'grant-write',
        envText: envText(),
        clientId: 'codex',
        tool: 'create_order',
    }), /不在当前灰度集合/);
    assert.throws(() => planIdentityChange({
        command: 'grant-write',
        envText: envText(),
        clientId: 'missing-agent',
        tool: 'sync_factory_knowledge',
    }), /identity 不存在/);
    assert.throws(() => planIdentityChange({
        command: 'grant-write',
        envText: envText(),
        clientId: 'hermes',
        tool: 'sync_factory_knowledge',
    }), /写工具已授权/);
});

test('MCP 身份管理：拒绝重复 token、原 token 轮换和旧单 token 写配置', () => {
    assert.throws(() => planIdentityChange({
        command: 'add',
        envText: envText(),
        clientId: 'claude-code',
        token: TOKEN_CODEX,
    }), /不同 MCP clientId 不能复用同一个 token/);
    assert.throws(() => planIdentityChange({
        command: 'rotate',
        envText: envText(),
        clientId: 'codex',
        token: TOKEN_CODEX,
    }), /必须与当前 token 不同/);
    assert.throws(() => planIdentityChange({
        command: 'add',
        envText: 'MCP_ENABLED=true\nMCP_CLIENT_ID=legacy\nMCP_TOKEN=legacy-token-0123456789abcdef0123456789\n',
        clientId: 'new-agent',
        token: TOKEN_CLAUDE,
    }), /只支持 MCP_SERVICE_TOKENS/);
});

test('MCP 身份管理：回滚默认预览，固定确认后恢复并创建安全备份', () => {
    const fixture = tempFixture();
    try {
        const changed = executeIdentityChange({
            command: 'rotate',
            envFile: fixture.envFile,
            clientId: 'codex',
            token: TOKEN_ROTATED,
            apply: true,
            confirmation: APPLY_CONFIRMATION,
            backupRoot: fixture.backupRoot,
            now: new Date('2026-08-17T12:00:00.000Z'),
        });
        const preview = executeRollback({
            envFile: fixture.envFile,
            backupRoot: fixture.backupRoot,
            file: changed.backup,
        });
        assert.equal(preview.applied, false);
        assert.equal(
            JSON.parse(dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8')).MCP_SERVICE_TOKENS).codex,
            TOKEN_ROTATED
        );
        assert.throws(() => executeRollback({
            envFile: fixture.envFile,
            backupRoot: fixture.backupRoot,
            file: changed.backup,
            apply: true,
            confirmation: APPLY_CONFIRMATION,
        }), new RegExp(ROLLBACK_CONFIRMATION));
        const restored = executeRollback({
            envFile: fixture.envFile,
            backupRoot: fixture.backupRoot,
            file: changed.backup,
            apply: true,
            confirmation: ROLLBACK_CONFIRMATION,
            now: new Date('2026-08-17T12:01:00.000Z'),
        });
        assert.equal(restored.applied, true);
        assert.equal(
            JSON.parse(dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8')).MCP_SERVICE_TOKENS).codex,
            TOKEN_CODEX
        );
        assert.equal(fs.existsSync(restored.safetyBackup), true);
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理：live verify 逐身份握手和列目录但不返回凭证', async () => {
    const seenTokens = [];
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            seenTokens.push(String(request.headers.authorization || '').replace(/^Bearer\s+/, ''));
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const result = body.method === 'initialize'
                ? {
                    protocolVersion: '2025-06-18',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'test-mcp', version: '1.0.0' },
                }
                : { tools: [{ name: 'read_one' }, { name: 'read_two' }] };
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        const result = await verifyLiveIdentities({
            env: dotenv.parse(envText()),
            url: `http://127.0.0.1:${address.port}/mcp`,
            expectedToolCount: 2,
        });
        assert.deepEqual(result, [
            {
                clientId: 'hermes',
                initialized: true,
                toolsListed: true,
                toolCount: 2,
                toolCountMatches: true,
                success: true,
            },
            {
                clientId: 'codex',
                initialized: true,
                toolsListed: true,
                toolCount: 2,
                toolCountMatches: true,
                success: true,
            },
        ]);
        assert.deepEqual(seenTokens, [TOKEN_HERMES, TOKEN_HERMES, TOKEN_CODEX, TOKEN_CODEX]);
        const serialized = JSON.stringify(result);
        assert.equal(serialized.includes(TOKEN_HERMES), false);
        assert.equal(serialized.includes(TOKEN_CODEX), false);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test('MCP 身份管理：2026 live verify 使用官方 SDK 会话并核对协商版本', async () => {
    const server = http.createServer((request, response) => {
        if (request.method === 'DELETE') {
            response.writeHead(200).end();
            return;
        }
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (body.method === 'notifications/initialized') {
                response.writeHead(202).end();
                return;
            }
            const result = body.method === 'server/discover'
                ? {
                    supportedVersions: ['2026-07-28'],
                    capabilities: { tools: {} },
                    serverInfo: { name: 'test-mcp-modern', version: '1.0.0' },
                }
                : {
                    resultType: 'complete',
                    ttlMs: 0,
                    cacheScope: 'private',
                    tools: [
                        { name: 'read_one', inputSchema: { type: 'object' } },
                        { name: 'write_one', inputSchema: { type: 'object' } },
                    ],
                };
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        const result = await verifyLiveIdentities({
            env: dotenv.parse(envText()),
            url: `http://127.0.0.1:${address.port}/mcp`,
            clientId: 'codex',
            protocolVersion: '2026-07-28',
            expectedToolCount: 2,
        });
        assert.deepEqual(result, [{
            clientId: 'codex',
            initialized: true,
            toolsListed: true,
            protocolVersion: '2026-07-28',
            protocolMatches: true,
            toolCount: 2,
            toolCountMatches: true,
            success: true,
        }]);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test('MCP 身份管理 CLI：显式拒绝命令行明文 token 且错误不回显值', () => {
    const fixture = tempFixture();
    try {
        const cli = path.resolve(__dirname, '..', 'scripts', 'manage-mcp-identities.cjs');
        const secret = 'should-never-be-echoed-0123456789abcdef';
        const result = spawnSync(process.execPath, [
            cli,
            'rotate',
            '--env-file', fixture.envFile,
            '--client-id', 'codex',
            '--token', secret,
        ], { encoding: 'utf8' });
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /禁止通过 --token/);
        assert.equal(result.stderr.includes(secret), false);
        assert.equal(result.stdout.includes(secret), false);
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理 CLI：help 正常退出并列出安全确认词', () => {
    const cli = path.resolve(__dirname, '..', 'scripts', 'manage-mcp-identities.cjs');
    const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    assert.match(
        result.stdout,
        /status\|add\|rotate\|revoke\|grant-write\|revoke-write\|verify\|list-backups\|rollback/
    );
    assert.match(result.stdout, new RegExp(APPLY_CONFIRMATION));
    assert.match(result.stdout, new RegExp(ROLLBACK_CONFIRMATION));
});

test('MCP 身份管理 CLI：stdin 预览和显式确认写入均保持脱敏', () => {
    const fixture = tempFixture();
    try {
        const cli = path.resolve(__dirname, '..', 'scripts', 'manage-mcp-identities.cjs');
        const baseArgs = [
            cli,
            'rotate',
            '--env-file', fixture.envFile,
            '--backup-root', fixture.backupRoot,
            '--client-id', 'codex',
            '--token-stdin',
        ];
        const preview = spawnSync(process.execPath, baseArgs, {
            encoding: 'utf8',
            input: TOKEN_ROTATED,
        });
        assert.equal(preview.status, 0);
        assert.equal(JSON.parse(preview.stdout).applied, false);
        assert.equal(preview.stdout.includes(TOKEN_ROTATED), false);
        assert.equal(
            JSON.parse(dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8')).MCP_SERVICE_TOKENS).codex,
            TOKEN_CODEX
        );

        const applied = spawnSync(process.execPath, [
            ...baseArgs,
            '--apply',
            '--confirm', APPLY_CONFIRMATION,
        ], {
            encoding: 'utf8',
            input: TOKEN_ROTATED,
        });
        assert.equal(applied.status, 0);
        assert.equal(JSON.parse(applied.stdout).applied, true);
        assert.equal(applied.stdout.includes(TOKEN_ROTATED), false);
        assert.equal(
            JSON.parse(dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8')).MCP_SERVICE_TOKENS).codex,
            TOKEN_ROTATED
        );
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理 CLI：写工具授权默认预览且确认后原子写入', () => {
    const fixture = tempFixture();
    try {
        const cli = path.resolve(__dirname, '..', 'scripts', 'manage-mcp-identities.cjs');
        const args = [
            cli,
            'grant-write',
            '--env-file', fixture.envFile,
            '--backup-root', fixture.backupRoot,
            '--client-id', 'codex',
            '--tool', 'sync_factory_knowledge',
        ];
        const preview = spawnSync(process.execPath, args, { encoding: 'utf8' });
        assert.equal(preview.status, 0);
        assert.equal(JSON.parse(preview.stdout).applied, false);
        assert.equal(dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8')).MCP_WRITE_CLIENT_IDS, 'hermes');

        const applied = spawnSync(process.execPath, [
            ...args,
            '--apply',
            '--confirm', APPLY_CONFIRMATION,
        ], { encoding: 'utf8' });
        assert.equal(applied.status, 0);
        assert.equal(JSON.parse(applied.stdout).applied, true);
        const env = dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8'));
        assert.deepEqual(env.MCP_WRITE_CLIENT_IDS.split(','), ['hermes', 'codex']);
        assert.deepEqual(JSON.parse(env.MCP_WRITE_TOOL_ALLOWLISTS).codex, [
            'sync_factory_knowledge',
        ]);
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理 Mac Mini 包装器：凭证只走 stdin 或受控环境变量', () => {
    const scriptPath = path.resolve(__dirname, '..', 'scripts', 'manage-mcp-identities-macmini.ps1');
    const script = fs.readFileSync(scriptPath, 'utf8');
    assert.match(script, /--token-stdin/);
    assert.match(script, /GetEnvironmentVariable\(\$ClientTokenEnvVar, 'User'\)/);
    assert.match(script, /SetEnvironmentVariable\(\$ClientTokenEnvVar/);
    assert.match(script, /APPLY_MCP_IDENTITY_CHANGE/);
    assert.match(script, /ROLLBACK_MCP_IDENTITY_CHANGE/);
    assert.match(script, /grant-write/);
    assert.match(script, /revoke-write/);
    assert.doesNotMatch(script, /--token\s+\$/);
    assert.doesNotMatch(script, /Write-(Output|Host).*Token/i);
});

test('MCP 身份管理 Mac Mini 包装器：Windows PowerShell 5.1 可解析无 BOM 脚本', () => {
    const scriptPath = path.resolve(__dirname, '..', 'scripts', 'manage-mcp-identities-macmini.ps1');
    if (process.platform !== 'win32') {
        const script = fs.readFileSync(scriptPath, 'utf8');
        assert.doesNotMatch(script, /[^\x00-\x7F]/);
        return;
    }
    const command = '$tokens = $null; $errors = $null; '
        + '[void][System.Management.Automation.Language.Parser]::ParseFile('
        + '$env:MCP_IDENTITY_SCRIPT, [ref]$tokens, [ref]$errors); '
        + 'if ($errors.Count -gt 0) { '
        + '$errors | ForEach-Object { [Console]::Error.WriteLine($_.Message) }; exit 1 }';
    const result = spawnSync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command', command,
    ], {
        encoding: 'utf8',
        env: { ...process.env, MCP_IDENTITY_SCRIPT: scriptPath },
    });
    assert.equal(result.status, 0, result.stderr);
});
