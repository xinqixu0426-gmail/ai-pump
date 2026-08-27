const fs = require('node:fs');
const path = require('node:path');
const {
    APPLY_CONFIRMATION,
    APPROVE_WRITE_CONFIRMATION,
    ROLLBACK_CONFIRMATION,
    executeIdentityChange,
    executeRollback,
    identitySummary,
    listIdentityBackups,
    readEnvArtifact,
    verifyLiveIdentities,
} = require('./mcp-identity-config.cjs');

function parseArguments(argv) {
    const [command = 'status', ...rest] = argv;
    const options = {};
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index];
        if (!token.startsWith('--')) throw new Error(`无法识别的参数: ${token}`);
        const key = token.slice(2);
        if (key === 'token') {
            throw new Error('禁止通过 --token 传递凭证；请使用 --token-stdin 或 --token-env');
        }
        const next = rest[index + 1];
        if (!next || next.startsWith('--')) {
            options[key] = true;
            continue;
        }
        options[key] = next;
        index += 1;
    }
    return { command, options };
}

function value(options, key, { required = false } = {}) {
    const selected = options[key];
    if (selected === undefined) {
        if (required) throw new Error(`必须提供 --${key}`);
        return undefined;
    }
    if (selected === true || !String(selected).trim()) {
        throw new Error(`--${key} 必须提供值`);
    }
    return String(selected).trim();
}

function booleanOption(options, key) {
    return options[key] === true;
}

function resolveEnvFile(options) {
    return path.resolve(process.cwd(), value(options, 'env-file') || '.env');
}

function readToken(options) {
    const fromStdin = booleanOption(options, 'token-stdin');
    const envName = value(options, 'token-env');
    if (fromStdin === Boolean(envName)) {
        throw new Error('新增或轮换必须且只能选择 --token-stdin 或 --token-env <变量名>');
    }
    if (fromStdin) return fs.readFileSync(0, 'utf8').trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName)) {
        throw new Error('--token-env 必须是合法环境变量名');
    }
    const token = process.env[envName];
    if (!token) throw new Error(`环境变量未设置: ${envName}`);
    return token;
}

function publicResult(result) {
    return JSON.parse(JSON.stringify(result));
}

function usage() {
    return '用法: status|add|rotate|revoke|approve-write|grant-write|revoke-write|verify|list-backups|rollback；'
        + `一般写入确认 ${APPLY_CONFIRMATION}；首次批准写工具确认 ${APPROVE_WRITE_CONFIRMATION}；`
        + `回滚确认 ${ROLLBACK_CONFIRMATION}`;
}

async function main() {
    const { command, options } = parseArguments(process.argv.slice(2));
    if (command === '--help' || command === 'help') {
        console.log(usage());
        return;
    }
    const envFile = resolveEnvFile(options);
    const backupRoot = value(options, 'backup-root');
    let result;

    if (command === 'status') {
        result = {
            success: true,
            command,
            envFile,
            ...identitySummary(readEnvArtifact(envFile).env),
        };
    } else if (['add', 'rotate', 'revoke', 'approve-write', 'grant-write', 'revoke-write'].includes(command)) {
        result = executeIdentityChange({
            command,
            envFile,
            backupRoot,
            clientId: value(options, 'client-id', { required: true }),
            token: ['add', 'rotate'].includes(command) ? readToken(options) : undefined,
            tool: ['approve-write', 'grant-write', 'revoke-write'].includes(command)
                ? value(options, 'tool', { required: true })
                : undefined,
            apply: booleanOption(options, 'apply'),
            confirmation: value(options, 'confirm'),
        });
        result = { success: true, envFile, ...result };
    } else if (command === 'verify') {
        const artifact = readEnvArtifact(envFile);
        const config = identitySummary(artifact.env);
        const url = value(options, 'url');
        const expectedRaw = value(options, 'expect-tool-count');
        let expectedToolCount;
        if (expectedRaw !== undefined) {
            expectedToolCount = Number(expectedRaw);
            if (!Number.isInteger(expectedToolCount) || expectedToolCount < 0) {
                throw new Error('--expect-tool-count 必须是非负整数');
            }
        }
        const timeoutRaw = value(options, 'timeout-ms');
        const timeoutMs = timeoutRaw === undefined ? 15000 : Number(timeoutRaw);
        if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120000) {
            throw new Error('--timeout-ms 必须是 1000-120000 的整数');
        }
        const live = url ? await verifyLiveIdentities({
            env: artifact.env,
            url,
            host: value(options, 'host'),
            clientId: value(options, 'client-id'),
            protocolVersion: value(options, 'protocol-version') || '2025-06-18',
            expectedToolCount,
            expectConfiguredCatalog: booleanOption(options, 'expect-configured-catalog'),
            timeoutMs,
        }) : [];
        result = {
            success: config.valid && live.every(item => item.success),
            command,
            envFile,
            config,
            live,
        };
        if (!result.success) process.exitCode = 1;
    } else if (command === 'list-backups') {
        result = {
            success: true,
            command,
            envFile,
            backups: listIdentityBackups(envFile, backupRoot),
        };
    } else if (command === 'rollback') {
        result = executeRollback({
            envFile,
            backupRoot,
            file: value(options, 'file'),
            latest: booleanOption(options, 'latest'),
            apply: booleanOption(options, 'apply'),
            confirmation: value(options, 'confirm'),
        });
        result = { success: true, envFile, ...result };
    } else {
        throw new Error(usage());
    }

    console.log(JSON.stringify(publicResult(result), null, 2));
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
