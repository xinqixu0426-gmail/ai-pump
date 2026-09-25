'use strict';
/**
 * SEC-R0 — Contain Leaked Internal Secret and Close JWT Bypass on Write Routes.
 *
 * 全部用例都打**真实 HTTP 路由**（启动真实 api.cjs + 独立临时数据库），
 * 不使用中间件返回值断言：
 *   A. 有效 Owner JWT                        → 依既有业务规则放行写入
 *   B. 仅 x-internal-secret                  → 业务写被拒（403 INTERNAL_WRITE_FORBIDDEN）
 *   C. 已泄露/过期的 internal secret          → 被拒（401）
 *   D. 未认证                                → 被拒（401）
 *   E. 已认证非 owner（Owner-only 路由）      → 被拒（403，AI 入口）
 *   F. 内部只读（GET）                        → 保持可用（明确保留的内部通道）
 *   G. 内部写 + 专用机器写凭据                → 放行（合法内部自动化保持可用）
 * 并直接在数据库里核对：被拒的写入没有产生任何业务数据。
 */
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const jwt = require('jsonwebtoken');

const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');

const ROOT = path.resolve(__dirname, '..');
const INTERNAL_SECRET = 'sec-r0-synthetic-internal-secret';
const INTERNAL_WRITE_SECRET = 'sec-r0-synthetic-internal-write-secret-0123456789';
const LEAKED_OLD_SECRET = 'sec-r0-historical-leaked-placeholder-value';
const JWT_SECRET = 'sec-r0-synthetic-jwt-secret';
const OWNER_PASSWORD = 'sec-r0-synthetic-owner-password-0123456789abcdef';
const OWNER_SUBJECT = 'sec_r0_owner_subject';

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

async function waitForReady(baseUrl, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
            if (response.ok) return;
        } catch { /* keep waiting */ }
        await new Promise(resolve => setTimeout(resolve, 300));
    }
    throw new Error('SEC_R0_RUNTIME_NOT_READY');
}

async function startRuntime() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-r0-'));
    const port = await freePort();
    const env = {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        PUMP_TEST_DATABASE_PATH: path.join(directory, 'sec-r0.db'),
        INTERNAL_SECRET,
        INTERNAL_WRITE_SECRET,
        JWT_SECRET,
        ACCESS_PASSWORD: 'sec-r0-access-password',
        PUMP_OWNER_ACCESS_PASSWORD: OWNER_PASSWORD,
        PUMP_OWNER_SUBJECT: OWNER_SUBJECT,
        AI_V5_OWNER_SUBJECTS: JSON.stringify([OWNER_SUBJECT]),
        AI_NATIVE_MODE: 'owner',
        AI_NATIVE_WRITE_ENABLED: 'false',
        DB_BACKUP_DIR: path.join(directory, 'backups'),
        DB_BACKUP_MIRROR_DIR: '',
        KNOWLEDGE_VECTOR_ENABLED: 'false',
        KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED: 'false',
        KNOWLEDGE_HYBRID_SEARCH_ENABLED: 'false',
        KNOWLEDGE_AUTO_SYNC_ENABLED: 'false',
        AI_OBSERVABILITY_ENABLED: 'false',
        MCP_ENABLED: 'false',
    };
    const child = spawn(process.execPath, ['api.cjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const baseUrl = `http://127.0.0.1:${port}`;
    try {
        await waitForReady(baseUrl);
    } catch (error) {
        child.kill('SIGKILL');
        throw new Error(`${error.message}\n${output.slice(-1500)}`);
    }
    return {
        baseUrl,
        dbPath: env.PUMP_TEST_DATABASE_PATH,
        output: () => output,
        close: async () => {
            child.kill('SIGTERM');
            await new Promise(resolve => child.once('exit', resolve));
            fs.rmSync(directory, { recursive: true, force: true });
        },
    };
}

const partBody = model => ({ model, category: 'SEC-R0', price: 1, supplier: 'SEC-R0' });

async function postPart(baseUrl, headers, model) {
    const response = await fetch(`${baseUrl}/api/parts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(partBody(model)),
    });
    let body = null;
    try { body = await response.json(); } catch { /* non-JSON */ }
    return { status: response.status, body };
}

/**
 * 核对某个写入标记是否真的存在于业务数据中。
 * 注意：创建零件时命名规则会把 model 重写为 `${category}-${model}`，因此不能用「输入 model 全等」
 * 判断；改用「返回数据中是否出现该唯一标记」（标记会被保留在 naming.spec.specification 里）。
 */
async function apiPartExists(baseUrl, marker) {
    const response = await fetch(`${baseUrl}/api/parts?keyword=${encodeURIComponent(marker)}`, {
        headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    assert.equal(response.status, 200, '内部只读必须可用于核对');
    const body = await response.json();
    return JSON.stringify(body?.data ?? {}).includes(marker);
}

test('SEC-R0 内部密钥不再单独授权业务写；内部只读与合法内部自动化保持可用', async t => {
    const runtime = await startRuntime();
    t.after(() => runtime.close());
    const { baseUrl } = runtime;

    const ownerToken = issueOwnerToken(OWNER_PASSWORD, {
        ACCESS_PASSWORD: 'sec-r0-access-password',
        JWT_SECRET,
        PUMP_OWNER_ACCESS_PASSWORD: OWNER_PASSWORD,
        PUMP_OWNER_SUBJECT: OWNER_SUBJECT,
        AI_V5_OWNER_SUBJECTS: JSON.stringify([OWNER_SUBJECT]),
    });
    assert.ok(ownerToken, 'Owner 凭据必须可签发');

    // A. 有效 Owner JWT → 依既有业务规则放行
    const ownerWrite = await postPart(baseUrl, { cookie: `token=${ownerToken}` }, 'SEC-R0-OWNER-JWT');
    assert.equal(ownerWrite.status, 200, JSON.stringify(ownerWrite.body));
    assert.equal(ownerWrite.body?.success, true);
    assert.equal(await apiPartExists(baseUrl, 'SEC-R0-OWNER-JWT'), true, 'Owner 写入应真正落库');

    // B. 仅 x-internal-secret → 业务写被拒
    const internalOnly = await postPart(baseUrl, { 'x-internal-secret': INTERNAL_SECRET }, 'SEC-R0-INTERNAL-ONLY');
    assert.equal(internalOnly.status, 403, JSON.stringify(internalOnly.body));
    assert.equal(internalOnly.body?.code, 'INTERNAL_WRITE_FORBIDDEN');
    assert.equal(await apiPartExists(baseUrl, 'SEC-R0-INTERNAL-ONLY'), false, '被拒的写入不得产生业务数据');

    // C. 已泄露/过期 internal secret → 被拒
    const leaked = await postPart(baseUrl, { 'x-internal-secret': LEAKED_OLD_SECRET }, 'SEC-R0-LEAKED-SECRET');
    assert.equal(leaked.status, 401, JSON.stringify(leaked.body));
    assert.equal(await apiPartExists(baseUrl, 'SEC-R0-LEAKED-SECRET'), false);

    // D. 未认证 → 被拒
    const anonymous = await postPart(baseUrl, {}, 'SEC-R0-ANONYMOUS');
    assert.equal(anonymous.status, 401);
    assert.equal(await apiPartExists(baseUrl, 'SEC-R0-ANONYMOUS'), false);

    // F. 内部只读（GET）→ 保持可用（明确保留的内部通道）
    const internalRead = await fetch(`${baseUrl}/api/parts`, { headers: { 'x-internal-secret': INTERNAL_SECRET } });
    assert.equal(internalRead.status, 200, '内部只读必须保持可用');

    // G. 内部写 + 专用机器写凭据 → 放行（合法内部自动化保持可用）
    const internalWrite = await postPart(baseUrl, {
        'x-internal-secret': INTERNAL_SECRET,
        'x-internal-write-secret': INTERNAL_WRITE_SECRET,
    }, 'SEC-R0-INTERNAL-SCOPED-WRITE');
    assert.equal(internalWrite.status, 200, JSON.stringify(internalWrite.body));
    assert.equal(await apiPartExists(baseUrl, 'SEC-R0-INTERNAL-SCOPED-WRITE'), true, '持专用写凭据的内部自动化必须仍能写入');
});

test('SEC-R0 非 owner 在 Owner-only 路由被拒（AI 入口），业务写不因此获得 Owner 语义', async t => {
    const runtime = await startRuntime();
    t.after(() => runtime.close());
    const { baseUrl } = runtime;

    const adminOnly = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' });
    const chat = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `token=${adminOnly}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: '现在的管理待办有哪些' }] }),
    });
    assert.equal(chat.status, 403, 'Owner-only 路由必须拒绝非 owner');
    const chatBody = await chat.json();
    assert.equal(chatBody.code, 'AI_OWNER_ONLY');
});

test('SEC-R0 专用写凭据的配置约束（长度与互异性）在真实运行环境中生效', async t => {
    const runtime = await startRuntime();
    t.after(() => runtime.close());
    const { baseUrl } = runtime;

    // 提供「与 INTERNAL_SECRET 相同」的写凭据必须无效（配置被拒绝 → fail closed）
    const sameAsRead = await postPart(baseUrl, {
        'x-internal-secret': INTERNAL_SECRET,
        'x-internal-write-secret': INTERNAL_SECRET,
    }, 'SEC-R0-SAME-SECRET');
    assert.equal(sameAsRead.status, 403, '写凭据不得与内部共享密钥相同');
    assert.equal(await apiPartExists(baseUrl, 'SEC-R0-SAME-SECRET'), false);

    // 过短的写凭据必须无效
    const tooShort = await postPart(baseUrl, {
        'x-internal-secret': INTERNAL_SECRET,
        'x-internal-write-secret': 'short',
    }, 'SEC-R0-SHORT-SECRET');
    assert.equal(tooShort.status, 403);
    assert.equal(await apiPartExists(baseUrl, 'SEC-R0-SHORT-SECRET'), false);
});
