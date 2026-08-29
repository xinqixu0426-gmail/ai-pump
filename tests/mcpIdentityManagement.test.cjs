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
    APPROVE_WRITE_BATCH_CONFIRMATION,
    APPROVE_WRITE_CONFIRMATION,
    ROLLBACK_CONFIRMATION,
    executeIdentityChange,
    executeVerifiedIdentityChange,
    executeRollback,
    identitySummary,
    listIdentityBackups,
    planIdentityChange,
    quoteEnvValue,
    readEnvArtifact,
    verifyLiveIdentities,
} = require('../scripts/mcp-identity-config.cjs');
const {
    MCP_READ_ONLY_TOOL_NAMES,
} = require('../api/mcp/catalog.cjs');
const {
    MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES,
} = require('../scripts/mcp-write-acceptance-manifest.cjs');

const TOKEN_HERMES = 'hermes-token-0123456789abcdef0123456789';
const TOKEN_CODEX = 'codex-token-0123456789abcdef01234567890';
const TOKEN_CLAUDE = 'claude-token-0123456789abcdef0123456789';
const TOKEN_ROTATED = 'rotated-token-0123456789abcdef01234567';
const BATCH_TOOLS = [...MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES];

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

test('MCP 身份管理：可在升级前撤销已移出权威目录的旧写工具', () => {
    const legacyEnv = envText({
        MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
            hermes: ['sync_factory_knowledge', 'print_rotor_drawing'],
        }),
    });
    const revoked = planIdentityChange({
        command: 'revoke-write',
        envText: legacyEnv,
        clientId: 'hermes',
        tool: 'print_rotor_drawing',
    });
    const nextEnv = dotenv.parse(revoked.nextText);
    assert.deepEqual(JSON.parse(nextEnv.MCP_WRITE_TOOL_ALLOWLISTS), {
        hermes: ['sync_factory_knowledge'],
    });
    assert.equal(revoked.plan.after.valid, true);
});

test('MCP 身份管理：首次批准权威写工具只扩大目标身份', () => {
    const approved = planIdentityChange({
        command: 'approve-write',
        envText: envText(),
        clientId: 'hermes',
        tool: 'adjust_part_stock',
    });
    const env = dotenv.parse(approved.nextText);
    assert.equal(approved.plan.change, 'write-tool-approved');
    assert.equal(approved.plan.tool, 'adjust_part_stock');
    assert.deepEqual(JSON.parse(env.MCP_WRITE_TOOL_ALLOWLISTS), {
        hermes: ['sync_factory_knowledge', 'adjust_part_stock'],
    });
    assert.deepEqual(approved.plan.after.identities, [
        { clientId: 'codex', access: 'read-only', writeTools: [] },
        {
            clientId: 'hermes',
            access: 'read-write',
            writeTools: ['sync_factory_knowledge', 'adjust_part_stock'],
        },
    ]);
});

test('MCP 身份管理：批量首次批准在一个计划中完整扩大目标身份', () => {
    const approved = planIdentityChange({
        command: 'approve-write-batch',
        envText: envText(),
        clientId: 'hermes',
        tools: BATCH_TOOLS,
    });
    const env = dotenv.parse(approved.nextText);
    assert.equal(approved.plan.change, 'write-tools-approved-batch');
    assert.equal(approved.plan.tool, null);
    assert.deepEqual(approved.plan.tools, BATCH_TOOLS);
    assert.deepEqual(JSON.parse(env.MCP_WRITE_TOOL_ALLOWLISTS), {
        hermes: ['sync_factory_knowledge', ...BATCH_TOOLS],
    });
    assert.deepEqual(approved.plan.after.identities.find(item => item.clientId === 'codex'), {
        clientId: 'codex',
        access: 'read-only',
        writeTools: [],
    });
});

test('MCP 身份管理：批量首次批准对空、重复、未知和已灰度工具整批拒绝', () => {
    for (const tools of [
        [],
        ['create_order', 'create_order'],
        BATCH_TOOLS.slice(0, -1),
        ['create_order', 'unknown_write_tool'],
        ['create_order', 'search_parts'],
        ['create_order', 'sync_factory_knowledge'],
    ]) {
        assert.throws(() => planIdentityChange({
            command: 'approve-write-batch',
            envText: envText(),
            clientId: 'hermes',
            tools,
        }), /至少一个|不能重复|精确一致|不在权威目录|已进入灰度集合/);
    }
    assert.throws(() => planIdentityChange({
        command: 'approve-write-batch',
        envText: envText(),
        clientId: 'missing-agent',
        tools: BATCH_TOOLS,
    }), /identity 不存在/);
    assert.throws(() => planIdentityChange({
        command: 'approve-write-batch',
        envText: envText({
            MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
                hermes: ['sync_factory_knowledge', BATCH_TOOLS[0]],
            }),
        }),
        clientId: 'hermes',
        tools: BATCH_TOOLS,
    }), /已进入灰度集合/);
});

test('MCP 身份管理：批量首次批准只接受独立强确认并只创建一份备份', () => {
    const fixture = tempFixture();
    try {
        for (const confirmation of [APPLY_CONFIRMATION, APPROVE_WRITE_CONFIRMATION]) {
            assert.throws(() => executeIdentityChange({
                command: 'approve-write-batch',
                envFile: fixture.envFile,
                clientId: 'hermes',
                tools: BATCH_TOOLS,
                apply: true,
                confirmation,
                backupRoot: fixture.backupRoot,
            }), new RegExp(APPROVE_WRITE_BATCH_CONFIRMATION));
        }
        assert.deepEqual(listIdentityBackups(fixture.envFile, fixture.backupRoot), []);
        const applied = executeIdentityChange({
            command: 'approve-write-batch',
            envFile: fixture.envFile,
            clientId: 'hermes',
            tools: BATCH_TOOLS,
            apply: true,
            confirmation: APPROVE_WRITE_BATCH_CONFIRMATION,
            backupRoot: fixture.backupRoot,
        });
        assert.equal(applied.applied, true);
        assert.equal(listIdentityBackups(fixture.envFile, fixture.backupRoot).length, 1);
        assert.equal(fs.readFileSync(applied.backup, 'utf8'), envText());
        assert.deepEqual(
            JSON.parse(dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8')).MCP_WRITE_TOOL_ALLOWLISTS).hermes,
            ['sync_factory_knowledge', ...BATCH_TOOLS]
        );
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理：批量在线核验期间持续持锁且失败后整体恢复', async () => {
    const fixture = tempFixture();
    try {
        const original = fs.readFileSync(fixture.envFile, 'utf8');
        const phases = [];
        await assert.rejects(executeVerifiedIdentityChange({
            command: 'approve-write-batch',
            envFile: fixture.envFile,
            clientId: 'hermes',
            tools: BATCH_TOOLS,
            apply: true,
            confirmation: APPROVE_WRITE_BATCH_CONFIRMATION,
            backupRoot: fixture.backupRoot,
            verify: async ({ phase }) => {
                phases.push(phase);
                assert.throws(() => executeIdentityChange({
                    command: 'grant-write',
                    envFile: fixture.envFile,
                    clientId: 'codex',
                    tool: 'sync_factory_knowledge',
                    apply: true,
                    confirmation: APPLY_CONFIRMATION,
                    backupRoot: fixture.backupRoot,
                }), /配置变更正在执行/);
                if (phase === 'applied') throw new Error('simulated live verification failure');
                return { success: true };
            },
        }), /在线核验失败，已恢复原配置/);
        assert.deepEqual(phases, ['applied', 'rolled-back']);
        assert.equal(fs.readFileSync(fixture.envFile, 'utf8'), original);
        assert.equal(listIdentityBackups(fixture.envFile, fixture.backupRoot).length, 1);
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理：批量在线核验成功后才释放配置锁', async () => {
    const fixture = tempFixture();
    try {
        const applied = await executeVerifiedIdentityChange({
            command: 'approve-write-batch',
            envFile: fixture.envFile,
            clientId: 'hermes',
            tools: BATCH_TOOLS,
            apply: true,
            confirmation: APPROVE_WRITE_BATCH_CONFIRMATION,
            backupRoot: fixture.backupRoot,
            verify: async ({ phase }) => {
                assert.equal(phase, 'applied');
                assert.throws(() => executeIdentityChange({
                    command: 'grant-write',
                    envFile: fixture.envFile,
                    clientId: 'codex',
                    tool: 'sync_factory_knowledge',
                    apply: true,
                    confirmation: APPLY_CONFIRMATION,
                    backupRoot: fixture.backupRoot,
                }), /配置变更正在执行/);
                return { success: true, live: [{ clientId: 'hermes', success: true }] };
            },
        });
        assert.equal(applied.applied, true);
        assert.equal(applied.verification.success, true);
        assert.equal(listIdentityBackups(fixture.envFile, fixture.backupRoot).length, 1);
        const delegated = executeIdentityChange({
            command: 'grant-write',
            envFile: fixture.envFile,
            clientId: 'codex',
            tool: 'create_order',
            apply: true,
            confirmation: APPLY_CONFIRMATION,
            backupRoot: fixture.backupRoot,
        });
        assert.equal(delegated.applied, true);
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理：首次批准拒绝未知、只读、已灰度工具和未知身份', () => {
    for (const tool of ['unknown_write_tool', 'search_parts']) {
        assert.throws(() => planIdentityChange({
            command: 'approve-write',
            envText: envText(),
            clientId: 'hermes',
            tool,
        }), /不在权威目录/);
    }
    assert.throws(() => planIdentityChange({
        command: 'approve-write',
        envText: envText(),
        clientId: 'codex',
        tool: 'sync_factory_knowledge',
    }), /请使用 grant-write/);
    assert.throws(() => planIdentityChange({
        command: 'approve-write',
        envText: envText(),
        clientId: 'missing-agent',
        tool: 'adjust_part_stock',
    }), /identity 不存在/);
});

test('MCP 身份管理：首次批准使用独立强确认并在失败前不创建备份', () => {
    const fixture = tempFixture();
    try {
        for (const confirmation of ['yes', APPLY_CONFIRMATION]) {
            assert.throws(() => executeIdentityChange({
                command: 'approve-write',
                envFile: fixture.envFile,
                clientId: 'hermes',
                tool: 'adjust_part_stock',
                apply: true,
                confirmation,
                backupRoot: fixture.backupRoot,
            }), new RegExp(APPROVE_WRITE_CONFIRMATION));
        }
        assert.deepEqual(listIdentityBackups(fixture.envFile, fixture.backupRoot), []);
        const applied = executeIdentityChange({
            command: 'approve-write',
            envFile: fixture.envFile,
            clientId: 'hermes',
            tool: 'adjust_part_stock',
            apply: true,
            confirmation: APPROVE_WRITE_CONFIRMATION,
            backupRoot: fixture.backupRoot,
        });
        assert.equal(applied.applied, true);
        assert.equal(fs.existsSync(applied.backup), true);
        assert.equal(fs.readFileSync(applied.backup, 'utf8'), envText());
        const appliedEnv = dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8'));
        assert.equal(JSON.parse(appliedEnv.MCP_SERVICE_TOKENS).codex, TOKEN_CODEX);
        assert.deepEqual(
            JSON.parse(appliedEnv.MCP_WRITE_TOOL_ALLOWLISTS).hermes,
            ['sync_factory_knowledge', 'adjust_part_stock']
        );
        assert.equal(identitySummary(appliedEnv).valid, true);
        if (process.platform !== 'win32') {
            assert.equal((fs.statSync(applied.backup).mode & 0o777), 0o600);
        }
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理：并发配置锁存在时 fail-closed 且不创建备份', () => {
    const fixture = tempFixture();
    const lockPath = `${fixture.envFile}.mcp-identities.lock`;
    try {
        const before = fs.readFileSync(fixture.envFile, 'utf8');
        fs.writeFileSync(lockPath, 'another-process\n', { flag: 'wx' });
        assert.throws(() => executeIdentityChange({
            command: 'approve-write',
            envFile: fixture.envFile,
            clientId: 'hermes',
            tool: 'adjust_part_stock',
            apply: true,
            confirmation: APPROVE_WRITE_CONFIRMATION,
            backupRoot: fixture.backupRoot,
        }), /另一个 MCP identity 配置变更正在执行/);
        assert.equal(fs.readFileSync(fixture.envFile, 'utf8'), before);
        assert.deepEqual(listIdentityBackups(fixture.envFile, fixture.backupRoot), []);
    } finally {
        fs.rmSync(lockPath, { force: true });
        fixture.cleanup();
    }
});

test('MCP 身份管理：首次批准后可从对应备份完整回滚', () => {
    const fixture = tempFixture();
    try {
        const approved = executeIdentityChange({
            command: 'approve-write',
            envFile: fixture.envFile,
            clientId: 'hermes',
            tool: 'adjust_part_stock',
            apply: true,
            confirmation: APPROVE_WRITE_CONFIRMATION,
            backupRoot: fixture.backupRoot,
        });
        const restored = executeRollback({
            envFile: fixture.envFile,
            backupRoot: fixture.backupRoot,
            file: approved.backup,
            apply: true,
            confirmation: ROLLBACK_CONFIRMATION,
        });
        assert.equal(restored.applied, true);
        assert.equal(fs.readFileSync(fixture.envFile, 'utf8'), envText());
        assert.deepEqual(identitySummary(readEnvArtifact(fixture.envFile).env).identities, [
            { clientId: 'codex', access: 'read-only', writeTools: [] },
            {
                clientId: 'hermes',
                access: 'read-write',
                writeTools: ['sync_factory_knowledge'],
            },
        ]);
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理：回滚遇并发配置锁时不覆盖当前权限或创建安全备份', () => {
    const fixture = tempFixture();
    const lockPath = `${fixture.envFile}.mcp-identities.lock`;
    try {
        const approved = executeIdentityChange({
            command: 'approve-write',
            envFile: fixture.envFile,
            clientId: 'hermes',
            tool: 'adjust_part_stock',
            apply: true,
            confirmation: APPROVE_WRITE_CONFIRMATION,
            backupRoot: fixture.backupRoot,
        });
        const current = fs.readFileSync(fixture.envFile, 'utf8');
        const backupsBefore = listIdentityBackups(fixture.envFile, fixture.backupRoot);
        fs.writeFileSync(lockPath, 'another-process\n', { flag: 'wx' });
        assert.throws(() => executeRollback({
            envFile: fixture.envFile,
            backupRoot: fixture.backupRoot,
            file: approved.backup,
            apply: true,
            confirmation: ROLLBACK_CONFIRMATION,
        }), /另一个 MCP identity 配置变更正在执行/);
        assert.equal(fs.readFileSync(fixture.envFile, 'utf8'), current);
        assert.deepEqual(
            listIdentityBackups(fixture.envFile, fixture.backupRoot),
            backupsBefore
        );
    } finally {
        fs.rmSync(lockPath, { force: true });
        fixture.cleanup();
    }
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

test('MCP 身份管理：2025 精确目录按协议保持只读且忽略现代写 allowlist', async () => {
    const server = http.createServer((request, response) => {
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            const result = body.method === 'initialize'
                ? {
                    protocolVersion: '2025-06-18',
                    capabilities: { tools: {} },
                    serverInfo: { name: 'test-mcp', version: '1.0.0' },
                }
                : { tools: MCP_READ_ONLY_TOOL_NAMES.map(name => ({ name })) };
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
            protocolVersion: '2025-06-18',
            expectConfiguredCatalog: true,
        });
        assert.equal(result.every(item => item.success), true);
        assert.deepEqual(result.map(item => ({
            clientId: item.clientId,
            toolCount: item.toolCount,
            expectedToolCount: item.expectedToolCount,
            catalogMatches: item.catalogMatches,
        })), [
            {
                clientId: 'hermes',
                toolCount: MCP_READ_ONLY_TOOL_NAMES.length,
                expectedToolCount: MCP_READ_ONLY_TOOL_NAMES.length,
                catalogMatches: true,
            },
            {
                clientId: 'codex',
                toolCount: MCP_READ_ONLY_TOOL_NAMES.length,
                expectedToolCount: MCP_READ_ONLY_TOOL_NAMES.length,
                catalogMatches: true,
            },
        ]);
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

test('MCP 身份管理：2026 精确核对生产 50/49 异构目录和目录变异', async () => {
    let corruptCodexCatalog = null;
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
            const token = String(request.headers.authorization || '').replace(/^Bearer\s+/, '');
            let result;
            if (body.method === 'server/discover') {
                result = {
                    supportedVersions: ['2026-07-28'],
                    capabilities: { tools: {} },
                    serverInfo: { name: 'test-mcp-modern', version: '1.0.0' },
                };
            } else {
                const names = token === TOKEN_HERMES
                    ? [...MCP_READ_ONLY_TOOL_NAMES, 'sync_factory_knowledge', 'adjust_part_stock']
                    : [...MCP_READ_ONLY_TOOL_NAMES, 'sync_factory_knowledge'];
                if (token === TOKEN_CODEX) {
                    if (corruptCodexCatalog === 'same-count') {
                        names[names.length - 1] = 'unexpected_same_count_tool';
                    } else if (corruptCodexCatalog === 'duplicate') {
                        names.push(names[0]);
                    } else if (corruptCodexCatalog === 'missing') {
                        names.pop();
                    } else if (corruptCodexCatalog === 'extra') {
                        names.push('unexpected_extra_tool');
                    } else if (corruptCodexCatalog === 'empty') {
                        names.push('');
                    }
                }
                result = {
                    resultType: 'complete',
                    ttlMs: 0,
                    cacheScope: 'private',
                    tools: names.map(name => ({ name, inputSchema: { type: 'object' } })),
                };
            }
            response.writeHead(200, { 'Content-Type': 'application/json' });
            response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        const options = {
            env: dotenv.parse(envText({
                MCP_WRITE_CLIENT_IDS: 'hermes,codex',
                MCP_WRITE_TOOL_ALLOWLISTS: JSON.stringify({
                    hermes: ['sync_factory_knowledge', 'adjust_part_stock'],
                    codex: ['sync_factory_knowledge'],
                }),
            })),
            url: `http://127.0.0.1:${address.port}/mcp`,
            protocolVersion: '2026-07-28',
            expectConfiguredCatalog: true,
        };
        const valid = await verifyLiveIdentities(options);
        assert.deepEqual(valid.map(item => ({
            clientId: item.clientId,
            toolCount: item.toolCount,
            expectedToolCount: item.expectedToolCount,
            catalogMatches: item.catalogMatches,
            success: item.success,
        })), [
            {
                clientId: 'hermes',
                toolCount: MCP_READ_ONLY_TOOL_NAMES.length + 2,
                expectedToolCount: MCP_READ_ONLY_TOOL_NAMES.length + 2,
                catalogMatches: true,
                success: true,
            },
            {
                clientId: 'codex',
                toolCount: MCP_READ_ONLY_TOOL_NAMES.length + 1,
                expectedToolCount: MCP_READ_ONLY_TOOL_NAMES.length + 1,
                catalogMatches: true,
                success: true,
            },
        ]);

        corruptCodexCatalog = 'same-count';
        const invalid = await verifyLiveIdentities(options);
        const codex = invalid.find(item => item.clientId === 'codex');
        assert.equal(codex.toolCount, MCP_READ_ONLY_TOOL_NAMES.length + 1);
        assert.equal(codex.toolCountMatches, true);
        assert.equal(codex.catalogMatches, false);
        assert.deepEqual(codex.missingToolNames, ['sync_factory_knowledge']);
        assert.deepEqual(codex.unexpectedToolNames, ['unexpected_same_count_tool']);
        assert.equal(codex.success, false);

        for (const mode of ['duplicate', 'missing', 'extra', 'empty']) {
            corruptCodexCatalog = mode;
            const mutated = await verifyLiveIdentities(options);
            const item = mutated.find(result => result.clientId === 'codex');
            assert.equal(item.catalogMatches, false, mode);
            assert.equal(item.success, false, mode);
            if (mode === 'duplicate') assert.deepEqual(item.duplicateToolNames, ['full_calculate']);
            if (mode === 'missing') assert.deepEqual(item.missingToolNames, ['sync_factory_knowledge']);
            if (mode === 'extra') assert.deepEqual(item.unexpectedToolNames, ['unexpected_extra_tool']);
            if (mode === 'empty') assert.deepEqual(item.unexpectedToolNames, ['']);
        }
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
        /status\|add\|rotate\|revoke\|approve-write\|approve-write-batch\|grant-write\|revoke-write\|verify\|list-backups\|rollback/
    );
    assert.match(result.stdout, new RegExp(APPLY_CONFIRMATION));
    assert.match(result.stdout, new RegExp(APPROVE_WRITE_CONFIRMATION));
    assert.match(result.stdout, new RegExp(APPROVE_WRITE_BATCH_CONFIRMATION));
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

test('MCP 身份管理 CLI：首次批准默认预览且只接受独立确认词', () => {
    const fixture = tempFixture();
    try {
        const cli = path.resolve(__dirname, '..', 'scripts', 'manage-mcp-identities.cjs');
        const args = [
            cli,
            'approve-write',
            '--env-file', fixture.envFile,
            '--backup-root', fixture.backupRoot,
            '--client-id', 'hermes',
            '--tool', 'adjust_part_stock',
        ];
        const preview = spawnSync(process.execPath, args, { encoding: 'utf8' });
        assert.equal(preview.status, 0);
        assert.equal(JSON.parse(preview.stdout).applied, false);

        const wrong = spawnSync(process.execPath, [
            ...args, '--apply', '--confirm', APPLY_CONFIRMATION,
        ], { encoding: 'utf8' });
        assert.notEqual(wrong.status, 0);
        assert.match(wrong.stderr, new RegExp(APPROVE_WRITE_CONFIRMATION));

        const applied = spawnSync(process.execPath, [
            ...args, '--apply', '--confirm', APPROVE_WRITE_CONFIRMATION,
        ], { encoding: 'utf8' });
        assert.equal(applied.status, 0, applied.stderr);
        assert.equal(JSON.parse(applied.stdout).applied, true);
    } finally {
        fixture.cleanup();
    }
});

test('MCP 身份管理 CLI：批量首次批准整批预览并只接受批量确认词', () => {
    const fixture = tempFixture();
    try {
        const cli = path.resolve(__dirname, '..', 'scripts', 'manage-mcp-identities.cjs');
        const args = [
            cli,
            'approve-write-batch',
            '--env-file', fixture.envFile,
            '--backup-root', fixture.backupRoot,
            '--client-id', 'hermes',
            '--tools', BATCH_TOOLS.join(','),
        ];
        const preview = spawnSync(process.execPath, args, { encoding: 'utf8' });
        assert.equal(preview.status, 0, preview.stderr);
        const previewResult = JSON.parse(preview.stdout);
        assert.equal(previewResult.applied, false);
        assert.deepEqual(previewResult.tools, BATCH_TOOLS);

        const wrong = spawnSync(process.execPath, [
            ...args, '--apply', '--confirm', APPROVE_WRITE_CONFIRMATION,
            '--restart-and-verify',
        ], { encoding: 'utf8' });
        assert.notEqual(wrong.status, 0);
        assert.match(wrong.stderr, new RegExp(APPROVE_WRITE_BATCH_CONFIRMATION));

        const unverified = spawnSync(process.execPath, [
            ...args, '--apply', '--confirm', APPROVE_WRITE_BATCH_CONFIRMATION,
        ], { encoding: 'utf8' });
        assert.notEqual(unverified.status, 0);
        assert.match(unverified.stderr, /必须使用 --restart-and-verify/);
        assert.equal(listIdentityBackups(fixture.envFile, fixture.backupRoot).length, 0);
        assert.deepEqual(
            JSON.parse(dotenv.parse(fs.readFileSync(fixture.envFile, 'utf8')).MCP_WRITE_TOOL_ALLOWLISTS).hermes,
            ['sync_factory_knowledge']
        );
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
    assert.match(script, /APPROVE_NEW_MCP_WRITE_TOOL/);
    assert.match(script, /APPROVE_NEW_MCP_WRITE_TOOLS_BATCH/);
    assert.match(script, /ROLLBACK_MCP_IDENTITY_CHANGE/);
    assert.match(script, /grant-write/);
    assert.match(script, /approve-write/);
    assert.match(script, /approve-write-batch/);
    assert.match(script, /--tools/);
    assert.match(script, /--restart-and-verify/);
    assert.match(script, /revoke-write/);
    assert.match(script, /--expect-configured-catalog/);
    assert.doesNotMatch(script, /ExpectedToolCount/);
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
