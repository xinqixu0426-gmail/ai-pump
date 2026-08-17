const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const {
    getMcpWriteClientIds,
    getMcpWriteToolsForClient,
    isMcpWriteEnabled,
    parseMcpServiceTokens,
    parseMcpWriteToolAllowlists,
    validateMcpConfiguration,
} = require('../api/services/environment.cjs');

const APPLY_CONFIRMATION = 'APPLY_MCP_IDENTITY_CHANGE';
const ROLLBACK_CONFIRMATION = 'ROLLBACK_MCP_IDENTITY_CHANGE';
const CLIENT_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertClientId(clientId) {
    const normalized = String(clientId || '').trim();
    if (!CLIENT_ID_RE.test(normalized)) {
        throw new Error('clientId 必须由字母、数字、点、下划线或短横线组成，长度不超过 64');
    }
    return normalized;
}

function parseCanonicalTokenMap(env) {
    const raw = String(env.MCP_SERVICE_TOKENS || '').trim();
    if (!raw) {
        if (
            Object.prototype.hasOwnProperty.call(env, 'MCP_TOKEN')
            || Object.prototype.hasOwnProperty.call(env, 'HERMES_MCP_TOKEN')
        ) {
            throw new Error('身份管理写操作只支持 MCP_SERVICE_TOKENS；请先迁移旧单 token 配置');
        }
        return {};
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('MCP_SERVICE_TOKENS 必须是 clientId 到 token 的 JSON 对象');
    }
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('MCP_SERVICE_TOKENS 必须是 clientId 到 token 的 JSON 对象');
    }
    return { ...parsed };
}

function quoteEnvValue(value) {
    return `'${String(value)
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')}'`;
}

function setEnvValue(text, name, value) {
    if (!ENV_NAME_RE.test(name)) throw new Error(`环境变量名不合法: ${name}`);
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const line = `${name}=${quoteEnvValue(value)}`;
    const matcher = new RegExp(`^${name}=.*$`, 'm');
    if (matcher.test(text)) return text.replace(matcher, line);
    const suffix = text && !text.endsWith('\n') && !text.endsWith('\r') ? newline : '';
    return `${text}${suffix}${line}${newline}`;
}

function readEnvArtifact(envFile) {
    const resolved = path.resolve(envFile);
    const text = fs.readFileSync(resolved, 'utf8');
    return {
        path: resolved,
        text,
        env: dotenv.parse(text),
        mode: fs.statSync(resolved).mode & 0o777,
    };
}

function identitySummary(env) {
    const writeClientIds = new Set(getMcpWriteClientIds(env));
    let entries = [];
    let source = 'none';
    try {
        entries = parseMcpServiceTokens(env);
        if (String(env.MCP_SERVICE_TOKENS || '').trim()) source = 'MCP_SERVICE_TOKENS';
        else if (Object.prototype.hasOwnProperty.call(env, 'MCP_TOKEN')) source = 'MCP_TOKEN';
        else if (Object.prototype.hasOwnProperty.call(env, 'HERMES_MCP_TOKEN')) {
            source = 'HERMES_MCP_TOKEN';
        }
    } catch (error) {
        return {
            valid: false,
            errors: [error.message],
            source: 'invalid',
            identityCount: 0,
            identities: [],
        };
    }
    const errors = validateMcpConfiguration(env);
    return {
        valid: errors.length === 0,
        errors,
        source,
        identityCount: entries.length,
        identities: entries
            .map(({ clientId }) => ({
                clientId,
                access: writeClientIds.has(clientId) && isMcpWriteEnabled(env)
                    ? 'read-write'
                    : 'read-only',
                writeTools: getMcpWriteToolsForClient(clientId, env),
            }))
            .sort((left, right) => left.clientId.localeCompare(right.clientId)),
    };
}

function validateTokenInput(token) {
    const normalized = String(token || '').trim();
    if (normalized.length < 32) throw new Error('MCP token 至少需要 32 个字符');
    return normalized;
}

function planIdentityChange({ command, envText, clientId, token }) {
    if (!['add', 'rotate', 'revoke'].includes(command)) {
        throw new Error(`不支持的身份变更命令: ${command}`);
    }
    const normalizedClientId = assertClientId(clientId);
    const env = dotenv.parse(envText);
    const tokens = parseCanonicalTokenMap(env);
    const exists = Object.prototype.hasOwnProperty.call(tokens, normalizedClientId);
    const writeClientIds = getMcpWriteClientIds(env);
    const allowlists = parseMcpWriteToolAllowlists(env);
    const removedWriteTools = allowlists[normalizedClientId] || [];
    let nextText = envText;
    let writeDisabled = false;

    if (command === 'add') {
        if (exists) throw new Error(`MCP identity 已存在: ${normalizedClientId}`);
        tokens[normalizedClientId] = validateTokenInput(token);
    } else if (command === 'rotate') {
        if (!exists) throw new Error(`MCP identity 不存在: ${normalizedClientId}`);
        const nextToken = validateTokenInput(token);
        if (String(tokens[normalizedClientId]) === nextToken) {
            throw new Error('轮换后的 token 必须与当前 token 不同');
        }
        tokens[normalizedClientId] = nextToken;
    } else {
        if (!exists) throw new Error(`MCP identity 不存在: ${normalizedClientId}`);
        delete tokens[normalizedClientId];
        const nextWriteClientIds = writeClientIds.filter(id => id !== normalizedClientId);
        delete allowlists[normalizedClientId];
        nextText = setEnvValue(nextText, 'MCP_WRITE_CLIENT_IDS', nextWriteClientIds.join(','));
        nextText = setEnvValue(
            nextText,
            'MCP_WRITE_TOOL_ALLOWLISTS',
            JSON.stringify(allowlists)
        );
        if (isMcpWriteEnabled(env) && nextWriteClientIds.length === 0) {
            nextText = setEnvValue(nextText, 'MCP_WRITE_ENABLED', 'false');
            writeDisabled = true;
        }
    }

    nextText = setEnvValue(nextText, 'MCP_SERVICE_TOKENS', JSON.stringify(tokens));
    const nextEnv = dotenv.parse(nextText);
    const errors = validateMcpConfiguration(nextEnv);
    if (errors.length > 0) throw new Error(errors.join('；'));

    return {
        nextText,
        plan: {
            command,
            clientId: normalizedClientId,
            change: command === 'add' ? 'identity-added'
                : command === 'rotate' ? 'credential-rotated'
                    : 'identity-revoked',
            removedWriteTools: command === 'revoke' ? removedWriteTools : [],
            writeDisabled,
            before: identitySummary(env),
            after: identitySummary(nextEnv),
        },
    };
}

function safeSegment(value) {
    return String(value || 'identity').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}

function timestampForFile(date = new Date()) {
    return date.toISOString().replace(/[:.]/g, '-');
}

function defaultBackupRoot(envFile) {
    return path.join(path.dirname(path.resolve(envFile)), 'backups', 'config', 'mcp-identities');
}

function createEnvBackup(artifact, {
    backupRoot = defaultBackupRoot(artifact.path),
    reason = 'change',
    clientId = 'identity',
    now,
} = {}) {
    const resolvedRoot = path.resolve(backupRoot);
    fs.mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
    try {
        fs.chmodSync(resolvedRoot, 0o700);
    } catch {
        // Windows permission bits are advisory; the backup still inherits the user profile ACL.
    }
    const filename = `.env-before-mcp-${safeSegment(reason)}-${safeSegment(clientId)}-${timestampForFile(now)}`;
    const backupPath = path.join(resolvedRoot, filename);
    fs.writeFileSync(backupPath, artifact.text, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    try {
        fs.chmodSync(backupPath, 0o600);
    } catch {
        // See directory note above.
    }
    return backupPath;
}

function atomicWriteEnv(envFile, text, mode = 0o600) {
    const resolved = path.resolve(envFile);
    const tempPath = `${resolved}.mcp-identities-${process.pid}-${crypto.randomUUID()}.tmp`;
    const targetMode = process.platform === 'win32' ? mode : 0o600;
    try {
        fs.writeFileSync(tempPath, text, { encoding: 'utf8', mode: targetMode });
        try {
            fs.chmodSync(tempPath, targetMode);
        } catch {
            // Windows permission bits are advisory.
        }
        fs.renameSync(tempPath, resolved);
    } finally {
        if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
    }
}

function executeIdentityChange({
    command,
    envFile,
    clientId,
    token,
    apply = false,
    confirmation,
    backupRoot,
    now,
}) {
    const artifact = readEnvArtifact(envFile);
    const planned = planIdentityChange({
        command,
        envText: artifact.text,
        clientId,
        token,
    });
    if (!apply) return { applied: false, backup: null, ...planned.plan };
    if (confirmation !== APPLY_CONFIRMATION) {
        throw new Error(`写入必须提供 --confirm ${APPLY_CONFIRMATION}`);
    }
    const backup = createEnvBackup(artifact, {
        backupRoot,
        reason: command,
        clientId,
        now,
    });
    atomicWriteEnv(artifact.path, planned.nextText, artifact.mode);
    return { applied: true, backup, ...planned.plan };
}

function listIdentityBackups(envFile, backupRoot = defaultBackupRoot(envFile)) {
    const resolvedRoot = path.resolve(backupRoot);
    if (!fs.existsSync(resolvedRoot)) return [];
    return fs.readdirSync(resolvedRoot, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.startsWith('.env-before-mcp-'))
        .map(entry => {
            const backupPath = path.join(resolvedRoot, entry.name);
            const stat = fs.statSync(backupPath);
            return {
                path: backupPath,
                name: entry.name,
                createdAt: stat.mtime.toISOString(),
                mode: (stat.mode & 0o777).toString(8).padStart(3, '0'),
            };
        })
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function selectedBackup({ envFile, backupRoot, file, latest }) {
    if (file) return path.resolve(file);
    if (latest) {
        const backup = listIdentityBackups(envFile, backupRoot)[0];
        if (!backup) throw new Error('没有找到 MCP identity 配置备份');
        return backup.path;
    }
    throw new Error('回滚必须提供 --file <备份路径> 或 --latest');
}

function planRollback({ envFile, backupRoot, file, latest }) {
    const current = readEnvArtifact(envFile);
    const backupPath = selectedBackup({ envFile, backupRoot, file, latest });
    const backup = readEnvArtifact(backupPath);
    const errors = validateMcpConfiguration(backup.env);
    if (errors.length > 0) throw new Error(`备份中的 MCP 配置无效: ${errors.join('；')}`);
    return {
        current,
        backup,
        plan: {
            command: 'rollback',
            source: backup.path,
            before: identitySummary(current.env),
            after: identitySummary(backup.env),
        },
    };
}

function executeRollback({
    envFile,
    backupRoot,
    file,
    latest = false,
    apply = false,
    confirmation,
    now,
}) {
    const planned = planRollback({ envFile, backupRoot, file, latest });
    if (!apply) return { applied: false, safetyBackup: null, ...planned.plan };
    if (confirmation !== ROLLBACK_CONFIRMATION) {
        throw new Error(`回滚必须提供 --confirm ${ROLLBACK_CONFIRMATION}`);
    }
    const safetyBackup = createEnvBackup(planned.current, {
        backupRoot,
        reason: 'rollback-safety',
        clientId: 'all',
        now,
    });
    atomicWriteEnv(planned.current.path, planned.backup.text, planned.current.mode);
    return { applied: true, safetyBackup, ...planned.plan };
}

function parseRpcPayload(text) {
    const trimmed = String(text || '').trim();
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    const rows = trimmed.split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .filter(Boolean);
    if (rows.length === 0) throw new Error('MCP 响应不是 JSON 或 SSE data');
    return JSON.parse(rows.at(-1));
}

async function rpcCall({
    url,
    token,
    method,
    params,
    id,
    protocolVersion,
    host,
    timeoutMs,
}) {
    const headers = {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': protocolVersion,
    };
    if (host) headers.Host = host;
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return {
        status: response.status,
        payload: response.ok ? parseRpcPayload(text) : null,
    };
}

async function verifyLiveIdentities({
    env,
    url,
    host,
    clientId,
    protocolVersion = '2025-06-18',
    expectedToolCount,
    timeoutMs = 15000,
}) {
    const entries = parseMcpServiceTokens(env)
        .filter(entry => !clientId || entry.clientId === clientId);
    if (clientId && entries.length === 0) throw new Error(`MCP identity 不存在: ${clientId}`);
    const results = [];
    let requestId = 1;
    for (const entry of entries) {
        const initialized = await rpcCall({
            url,
            token: entry.token,
            method: 'initialize',
            params: {
                protocolVersion,
                capabilities: {},
                clientInfo: { name: 'mcp-identity-verifier', version: '1.0.0' },
            },
            id: requestId,
            protocolVersion,
            host,
            timeoutMs,
        });
        requestId += 1;
        const listed = await rpcCall({
            url,
            token: entry.token,
            method: 'tools/list',
            params: {},
            id: requestId,
            protocolVersion,
            host,
            timeoutMs,
        });
        requestId += 1;
        const tools = listed.payload?.result?.tools || [];
        const toolCountMatches = expectedToolCount === undefined
            || tools.length === expectedToolCount;
        results.push({
            clientId: entry.clientId,
            initialized: initialized.status === 200 && !initialized.payload?.error,
            toolsListed: listed.status === 200 && !listed.payload?.error,
            toolCount: tools.length,
            toolCountMatches,
            success: initialized.status === 200
                && listed.status === 200
                && !initialized.payload?.error
                && !listed.payload?.error
                && toolCountMatches,
        });
    }
    return results;
}

module.exports = {
    APPLY_CONFIRMATION,
    ROLLBACK_CONFIRMATION,
    assertClientId,
    atomicWriteEnv,
    createEnvBackup,
    defaultBackupRoot,
    executeIdentityChange,
    executeRollback,
    identitySummary,
    listIdentityBackups,
    parseCanonicalTokenMap,
    planIdentityChange,
    planRollback,
    quoteEnvValue,
    readEnvArtifact,
    setEnvValue,
    verifyLiveIdentities,
};
