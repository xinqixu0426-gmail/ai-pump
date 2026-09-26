'use strict';
/**
 * NATIVE-W2 —— 隔离运行时的「聊天 → 卡片 → 确认 → 核验」真实链路。
 *
 * 说明（诚实声明）：本仓库**没有浏览器测试框架**（无 playwright/puppeteer/vitest/jest），
 * 前端由 `lint` + `next build` 验证。因此本文件不写「假装是 UI 的 API 脚本」，而是：
 *   - 用真实 api.cjs（隔离 DB、隔离端口、flag=true）产生**真实 SSE 提案**；
 *   - 用**卡片组件所使用的同一批前端模块**处理它：
 *     `createWriteCard` / `toProposalCardModel` / `reduceWriteCard` /
 *     `confirmNativeWriteProposal`（与组件回调完全同一条代码路径）；
 *   - 断言卡片可见数值、确认请求体、成功/失败判定都来自服务端。
 * 唯一未被覆盖的是 React 渲染本身（无浏览器运行时），该层由 build/lint 保障。
 */
process.env.NODE_ENV = 'test';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const test = require('node:test');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');
const proposal = require('../apps/web-next/lib/ai-write-proposal.cjs');
const client = require('../apps/web-next/lib/ai-write-proposal-client.cjs');

const ROOT = path.resolve(__dirname, '..');
const MODEL = 'W2-6202轴承';
const OWNER_PASSWORD = 'w2-owner-password-0123456789abcdefghijkl';
const OWNER_SUBJECT = 'w2_owner_subject_value';
const ACCESS_PASSWORD = 'w2-access-password';
const JWT_SECRET = 'w2-synthetic-jwt-secret';
const INTERNAL_SECRET = 'w2-synthetic-internal-secret';
// 正式预览走 SEC-R0 的机器写凭据（缺失时预览会被 INTERNAL_WRITE_FORBIDDEN 拒绝）。
const INTERNAL_WRITE_SECRET = 'w2-synthetic-internal-write-secret-0123456789';

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

function apiEnv({ port, dbPath, dir, writeEnabled }) {
    return {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        PUMP_TEST_DATABASE_PATH: dbPath,
        DB_BACKUP_DIR: path.join(dir, 'backups'),
        DB_BACKUP_MIRROR_DIR: '',
        KNOWLEDGE_VECTOR_ENABLED: 'false',
        KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED: 'false',
        KNOWLEDGE_HYBRID_SEARCH_ENABLED: 'false',
        KNOWLEDGE_AUTO_SYNC_ENABLED: 'false',
        AI_OBSERVABILITY_ENABLED: 'false',
        MCP_ENABLED: 'false',
        MCP_WRITE_ENABLED: 'false',
        BEHIND_PROXY: 'false',
        AI_NATIVE_MODE: 'owner',
        AI_NATIVE_WRITE_ENABLED: writeEnabled ? 'true' : 'false',
        ACCESS_PASSWORD,
        JWT_SECRET,
        PUMP_OWNER_ACCESS_PASSWORD: OWNER_PASSWORD,
        PUMP_OWNER_SUBJECT: OWNER_SUBJECT,
        AI_V5_OWNER_SUBJECTS: JSON.stringify([OWNER_SUBJECT]),
        INTERNAL_SECRET,
        INTERNAL_WRITE_SECRET,
    };
}

async function waitForReady(baseUrl, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
            if (response.ok) return;
        } catch { /* keep waiting */ }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('W2_E2E_RUNTIME_NOT_READY');
}

async function startApi(env) {
    const child = spawn(process.execPath, ['api.cjs'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    const baseUrl = `http://127.0.0.1:${env.PORT}`;
    try { await waitForReady(baseUrl); } catch (error) {
        child.kill('SIGKILL');
        throw new Error(`${error.message}\n${output.slice(-2000)}`);
    }
    return { child, baseUrl, output: () => output };
}

async function stopApi(runtime) {
    runtime.child.kill('SIGTERM');
    await new Promise(resolve => runtime.child.once('exit', resolve));
}

function seed(dbPath, { stock = 350, message = `把 ${MODEL} 库存增加 100` } = {}) {
    const db = new Database(dbPath);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO parts (id, model, category, price, supplier, stock, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)')
        .run(9001, MODEL, '轴承', 12, 'W2', stock, now, now);
    db.prepare('INSERT INTO ai_conversations (id, owner_key, title, created_at, updated_at, deleted_at) VALUES (1,?,?,?,?,NULL)')
        .run('admin', 'W2 E2E', now, now);
    db.prepare('INSERT INTO ai_conversation_messages (id, conversation_id, role, content, created_at, updated_at) VALUES (1,1,?,?,?,?)')
        .run('user', message, now, now);
    db.close();
}

function ownerCookie() {
    return `token=${issueOwnerToken(OWNER_PASSWORD, {
        ACCESS_PASSWORD, JWT_SECRET, PUMP_OWNER_ACCESS_PASSWORD: OWNER_PASSWORD,
        PUMP_OWNER_SUBJECT: OWNER_SUBJECT, AI_V5_OWNER_SUBJECTS: JSON.stringify([OWNER_SUBJECT]),
    })}`;
}

/** 与 lib/ai.ts 里 nativeWriteProposalRequest 同语义的适配器（保留 status 与 code）。 */
function httpRequest(baseUrl, cookie) {
    const calls = [];
    const request = async (requestPath, options) => {
        calls.push({ path: requestPath, body: options?.body });
        const response = await fetch(`${baseUrl}${requestPath}`, {
            method: options.method,
            headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
            body: options.body,
        });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        return { status: response.status, body };
    };
    return { request, calls };
}

async function chat(baseUrl, { content, cookie, conversationId = 'chat-1' }) {
    const response = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
        body: JSON.stringify({ messages: [{ role: 'user', content }], conversationId }),
    });
    const text = response.status === 200 ? await response.text() : '';
    const events = [];
    for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore */ }
    }
    return { status: response.status, events, text };
}

function snapshot(dbPath) {
    const db = new Database(dbPath, { readonly: true });
    const value = {
        stock: db.prepare('SELECT stock FROM parts WHERE id = 9001').get()?.stock,
        operations: db.prepare('SELECT capability_id, status FROM api_operations ORDER BY id').all(),
        tasks: db.prepare('SELECT state FROM ai_tasks ORDER BY id').all(),
    };
    db.close();
    return value;
}

async function withServer({ writeEnabled, stock = 350, message }, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w2-e2e-'));
    const dbPath = path.join(dir, 'w2-e2e.db');
    const port = await freePort();
    const env = apiEnv({ port, dbPath, dir, writeEnabled });
    const runtime = await startApi(env);
    try {
        seed(dbPath, { stock, message });
        await fn({ runtime, dbPath });
    } finally {
        try { await stopApi(runtime); } catch { /* already stopped */ }
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('W2-E2E-1 flag=true：真实 SSE 提案 → 卡片数值与服务端一致 → 确认后写一次并核验成功', async () => {
    await withServer({ writeEnabled: true }, async ({ runtime, dbPath }) => {
        const before = snapshot(dbPath);
        assert.equal(before.stock, 350);
        const streamed = await chat(runtime.baseUrl, { content: `把 ${MODEL} 库存增加 100`, cookie: ownerCookie() });
        assert.equal(streamed.status, 200);

        // 前端事件处理：与 useAiMessageStream/卡片组件同一条代码路径。
        const event = streamed.events.find(item => item.type === 'write_proposal');
        assert.ok(event, 'SSE 必须包含结构化提案事件');
        const card = proposal.createWriteCard(event);
        assert.equal(card.status, 'proposed');
        const model = proposal.toProposalCardModel(card.event);
        assert.equal(model.partLabel, MODEL);
        assert.deepEqual(model.rows.map(row => [row.label, row.value]), [
            ['当前库存', '350'],
            ['本次调整', '+100'],
            ['调整后库存', '450'],
        ]);
        assert.equal(model.notice, '');

        // 确认前：库存不变、零 operation。
        const pendingState = snapshot(dbPath);
        assert.equal(pendingState.stock, 350);
        assert.equal(pendingState.operations.length, 0);

        // 点击「确认执行」：只用服务端身份，走既有 W1 execute 契约。
        const { request, calls } = httpRequest(runtime.baseUrl, ownerCookie());
        // 与 ai-view 相同顺序：先进入执行中（禁用按钮），再按服务端结果收敛。
        const executing = proposal.reduceWriteCard(card, { type: 'confirm' });
        assert.equal(proposal.isExecutableCard(executing), false, '点击后必须立即不可再次执行');
        const result = await client.confirmNativeWriteProposal({ request, card, wait: async () => {} });
        assert.equal(result.kind, 'verified');
        assert.equal(calls.length, 1);
        assert.match(calls[0].path, /\/write-execute$/u);
        const settled = proposal.reduceWriteCard(executing, { type: 'settled', outcome: result.outcome });
        assert.equal(settled.status, 'succeeded');
        assert.deepEqual(settled.success.rows.map(row => row.value), [MODEL, '350 → 450', '450']);
        assert.equal(settled.success.verifiedStock, 450);

        const after = snapshot(dbPath);
        assert.equal(after.stock, 450, '库存必须恰好 +100');
        assert.equal(after.operations.length, 1);
        assert.equal(after.operations[0].capability_id, 'inventory.parts.batch_adjust_stock');
        assert.deepEqual(after.tasks.map(task => task.state), ['SUCCEEDED']);
    });
});

test('W2-E2E-2 重复确认（双击）：库存只变一次，绝不产生第二次调整', async () => {
    await withServer({ writeEnabled: true }, async ({ runtime, dbPath }) => {
        const streamed = await chat(runtime.baseUrl, { content: `把 ${MODEL} 库存增加 100`, cookie: ownerCookie() });
        const card = proposal.createWriteCard(streamed.events.find(item => item.type === 'write_proposal'));
        const { request } = httpRequest(runtime.baseUrl, ownerCookie());
        const executing = proposal.reduceWriteCard(card, { type: 'confirm' });
        const first = await client.confirmNativeWriteProposal({ request, card, wait: async () => {} });
        assert.equal(first.kind, 'verified');
        // UI 侧：卡片已成功 → 不可再执行（第二个点击不会发出任何请求）。
        const settled = proposal.reduceWriteCard(executing, { type: 'settled', outcome: first.outcome });
        assert.equal(proposal.isExecutableCard(settled), false);
        assert.equal(proposal.buildExecuteRequestBody(settled), null);
        // 即使有人绕过 UI 重放同一张卡，后端幂等/单次消费也必须挡住第二次写入。
        const replay = await client.confirmNativeWriteProposal({ request, card, wait: async () => {} });
        assert.ok(['verified', 'failed'].includes(replay.kind), replay.kind);
        const after = snapshot(dbPath);
        assert.equal(after.stock, 450, '重复确认不得再次调整库存');
        assert.equal(after.operations.length, 1);
    });
});

test('W2-E2E-3 取消：零请求、零写入，卡片失活', async () => {
    await withServer({ writeEnabled: true }, async ({ runtime, dbPath }) => {
        const streamed = await chat(runtime.baseUrl, { content: `把 ${MODEL} 库存增加 100`, cookie: ownerCookie() });
        const event = streamed.events.find(item => item.type === 'write_proposal');
        assert.ok(event, '取消用例必须建立在真实提案之上');
        const card = proposal.createWriteCard(event);
        assert.equal(card.status, 'proposed');
        const { request, calls } = httpRequest(runtime.baseUrl, ownerCookie());
        const cancelled = proposal.reduceWriteCard(card, { type: 'cancel' });
        assert.equal(cancelled.status, 'cancelled');
        assert.equal(proposal.isExecutableCard(cancelled), false);
        // 取消路径根本不调用执行入口。
        assert.equal(calls.length, 0);
        const after = snapshot(dbPath);
        assert.equal(after.stock, 350);
        assert.equal(after.operations.length, 0);
        assert.equal(typeof request, 'function');
    });
});

test('W2-E2E-4 flag=false：写未开放时不产生任何卡片，也不可能发起执行', async () => {
    await withServer({ writeEnabled: false }, async ({ runtime, dbPath }) => {
        const streamed = await chat(runtime.baseUrl, { content: `把 ${MODEL} 库存增加 100`, cookie: ownerCookie() });
        assert.equal(streamed.status, 200);
        // 前端：没有任何事件能构成提案卡片。
        assert.equal(streamed.events.some(item => proposal.isNativeWriteProposalEvent(item)), false);
        for (const item of streamed.events) {
            assert.equal(proposal.toProposalCardModel(item), null);
        }
        assert.equal(proposal.createWriteCard(undefined).status, 'expired');
        const detail = streamed.events.find(item => item.type === 'detail');
        assert.equal(detail.state, 'WRITE_DISABLED');
        assert.match(proposal.failureFromCode('AI_NATIVE_WRITE_DISABLED').message, /AI 写入当前未开放/u);
        const after = snapshot(dbPath);
        assert.equal(after.stock, 350);
        assert.equal(after.operations.length, 0);
        assert.equal(after.tasks.length, 0);
    });
});

test('W2-E2E-5 澄清与不支持：绝对目标值/多目标/非 W1 能力都不出卡片', async () => {
    await withServer({ writeEnabled: true }, async ({ runtime, dbPath }) => {
        const cases = [
            `把 ${MODEL} 库存增加到 30`,
            `把 ${MODEL} 库存增加`,
            `把 ${MODEL} 和 W2-6203 库存都增加 100`,
            '把12-120线圈库存增加100套',
        ];
        for (const content of cases) {
            const streamed = await chat(runtime.baseUrl, { content, cookie: ownerCookie() });
            assert.equal(streamed.events.some(item => proposal.isNativeWriteProposalEvent(item)), false, content);
            assert.equal(proposal.toProposalCardModel(streamed.events.find(item => item.type === 'write_proposal')), null, content);
        }
        const after = snapshot(dbPath);
        assert.equal(after.stock, 350);
        assert.equal(after.operations.length, 0);
    });
});
