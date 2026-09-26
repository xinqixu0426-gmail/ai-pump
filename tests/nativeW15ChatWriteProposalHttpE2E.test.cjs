'use strict';
/**
 * NATIVE-W1.5 —— 真实 HTTP 端到端：自然语言聊天 → W1 提案（隔离实例，不接触生产）。
 *
 * 证明 ticket §18/§19/§20：
 *   - flag=true：真实 Owner 聊天请求 → 确定性命令路由 → 唯一 canonical 零件 + 显式数量
 *     → 同步准备 → 既有 W1 预览 → 冻结提案 → WAITING_APPROVAL → 结构化提案事件；
 *     聊天回合**零写入**；随后用既有 write-execute 契约确认后才写一次并回读核验。
 *   - flag=false：仍是 WRITE_DISABLED，无提案、无 token、无任务、零写入。
 *   - 失败矩阵：缺数量/多目标/目标不存在/目标歧义/非 W1 能力/非 Owner/未认证。
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
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');

const ROOT = path.resolve(__dirname, '..');
const MODEL = 'W15-6202轴承';
const MODEL_SHORT = 'W15B-6202';
const MODEL_DECREASE = 'W15C-6202轴承';
const OWNER_PASSWORD = 'w15-owner-password-0123456789abcdefghijkl';
const OWNER_SUBJECT = 'w15_owner_subject_value';
const ACCESS_PASSWORD = 'w15-access-password';
const JWT_SECRET = 'w15-synthetic-jwt-secret';
const INTERNAL_SECRET = 'w15-synthetic-internal-secret';
const INTERNAL_WRITE_SECRET = 'w15-synthetic-internal-write-secret-0123456789';

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
    throw new Error('W15_E2E_RUNTIME_NOT_READY');
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

/** 预置正式零件 + Owner 会话 + 用户消息（消息内容就是被识别的权威文本）。 */
function seed(dbPath, { parts, message }) {
    const db = new Database(dbPath);
    const now = new Date().toISOString();
    const insert = db.prepare('INSERT INTO parts (id, model, category, price, supplier, stock, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)');
    for (const part of parts) insert.run(part.id, part.model, '轴承', 12, part.supplier || 'W15', part.stock, now, now);
    db.prepare('INSERT INTO ai_conversations (id, owner_key, title, created_at, updated_at, deleted_at) VALUES (1,?,?,?,?,NULL)')
        .run('admin', 'W15 E2E', now, now);
    db.prepare('INSERT INTO ai_conversation_messages (id, conversation_id, role, content, created_at, updated_at) VALUES (1,1,?,?,?,?)')
        .run('user', message, now, now);
    db.close();
}

/** 真实 UI 会先把用户消息落库再发起流式请求；写提案必须绑定这条持久化消息。 */
function persistUserMessage(dbPath, content) {
    const db = new Database(dbPath);
    const now = new Date().toISOString();
    const info = db.prepare('INSERT INTO ai_conversation_messages (conversation_id, role, content, created_at, updated_at) VALUES (1,?,?,?,?)')
        .run('user', content, now, now);
    db.close();
    return Number(info.lastInsertRowid);
}

function ownerCookie() {
    return `token=${issueOwnerToken(OWNER_PASSWORD, {
        ACCESS_PASSWORD, JWT_SECRET, PUMP_OWNER_ACCESS_PASSWORD: OWNER_PASSWORD,
        PUMP_OWNER_SUBJECT: OWNER_SUBJECT, AI_V5_OWNER_SUBJECTS: JSON.stringify([OWNER_SUBJECT]),
    })}`;
}
function nonOwnerCookie() { return `token=${jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`; }

/** 解析 SSE，返回全部事件（保持顺序）。 */
async function chat(baseUrl, { content, cookie, headers = {}, conversationId = 'chat-1' }) {
    const response = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
        body: JSON.stringify({ messages: [{ role: 'user', content }], conversationId }),
    });
    const text = response.status === 200 ? await response.text() : '';
    const events = [];
    for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try { events.push(JSON.parse(line.slice(5).trim())); } catch { /* ignore partial */ }
    }
    return { status: response.status, events, text, raw: response };
}

async function post(baseUrl, url, { body, cookie, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
        body: JSON.stringify(body || {}),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { status: response.status, body: payload, data: payload?.data, code: payload?.code };
}

function snapshot(dbPath) {
    const db = new Database(dbPath, { readonly: true });
    const state = {
        parts: db.prepare('SELECT id, model, stock FROM parts ORDER BY id').all(),
        tasks: db.prepare('SELECT task_key, state, spec_json FROM ai_tasks ORDER BY id').all(),
        operations: db.prepare('SELECT capability_id, status FROM api_operations ORDER BY id').all(),
    };
    db.close();
    return state;
}

function proposalOf(events) {
    const event = events.find(item => item.type === 'write_proposal');
    assert.ok(event, `SSE 中缺少 write_proposal 事件：${JSON.stringify(events)}`);
    return event;
}

async function withServer({ writeEnabled, parts = [{ id: 9001, model: MODEL, stock: 100 }], message = `把 ${MODEL} 库存增加 100` }, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w15-e2e-'));
    const dbPath = path.join(dir, 'w15-e2e.db');
    const port = await freePort();
    const env = apiEnv({ port, dbPath, dir, writeEnabled });
    const runtime = await startApi(env);
    try {
        seed(dbPath, { parts, message });
        await fn({ runtime, dbPath, dir, env });
    } finally {
        try { await stopApi(runtime); } catch { /* already stopped */ }
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('W15-E2E-1 flag=true：真实聊天直达 W1 提案 → WAITING_APPROVAL（聊天回合零写入），确认后写一次并回读核验', async () => {
    await withServer({ writeEnabled: true }, async ({ runtime, dbPath }) => {
        const result = await chat(runtime.baseUrl, { content: `把 ${MODEL} 库存增加 100`, cookie: ownerCookie() });
        assert.equal(result.status, 200);
        assert.equal(result.text.includes('[object Object]'), false, '用户可见文案不得出现 [object Object]');
        const proposal = proposalOf(result.events);
        assert.equal(proposal.stage, 'NATIVE_WRITE_PROPOSAL');

        // 9) 结构化提案事件里的展示事实全部来自服务端冻结预览。
        assert.equal(proposal.proposal.capabilityId, 'inventory.parts.batch_adjust_stock');
        const item = proposal.proposal.items[0];
        assert.equal(item.partId, 9001);
        assert.equal(item.model, MODEL);
        assert.equal(item.currentStock, 100);
        assert.equal(item.delta, 100);
        assert.equal(item.nextStock, 200);
        // 10) 确认身份存在，且不含任何内部哈希/凭据。
        assert.ok(proposal.confirmation.confirmationToken);
        assert.equal(proposal.confirmation.toolName, 'adjust_part_stock');
        assert.deepEqual(proposal.confirmation.args, { items: [{ model: MODEL, changeQty: 100 }] });
        assert.equal(proposal.task.state, 'WAITING_APPROVAL');
        const serialized = JSON.stringify(result.events);
        for (const forbidden of ['argsHash', 'subjectHash', 'proposalHash', 'INTERNAL_WRITE_SECRET', 'RECONCILING']) {
            assert.equal(serialized.includes(forbidden), false, forbidden);
        }

        // 5/6/7) 任务被构造成写提案任务，并同步到达 WAITING_APPROVAL（没有 worker）。
        const during = snapshot(dbPath);
        assert.equal(during.tasks.length, 1);
        assert.equal(during.tasks[0].state, 'WAITING_APPROVAL');
        const spec = JSON.parse(during.tasks[0].spec_json);
        assert.equal(spec.businessWritePolicy, 'CONFIRMATION_REQUIRED');
        assert.equal(spec.goals[0].kind, 'PREPARE_CHANGE');
        assert.equal(spec.writeV1.phase, 'PROPOSAL_READY');
        assert.equal(spec.writeV1.target.partId, 9001);
        assert.equal(spec.writeV1.nextStock, 200);
        // 11) 聊天回合绝不写入。
        assert.equal(during.parts[0].stock, 100);
        assert.equal(during.operations.length, 0);

        // 12/13/14/15/16) 既有 write-execute 契约：批准事实 → 写一次 → 回读核验 → SUCCEEDED。
        const executed = await post(runtime.baseUrl, `/api/ai/tasks/${proposal.task.taskId}/write-execute`, {
            cookie: ownerCookie(),
            body: {
                version: 1,
                expectedRevision: proposal.task.revision,
                confirmationToken: proposal.confirmation.confirmationToken,
                toolName: proposal.confirmation.toolName,
                args: proposal.confirmation.args,
            },
        });
        assert.equal(executed.status, 200, JSON.stringify(executed.body));
        assert.equal(executed.data.outcome.verified, true);
        assert.equal(executed.data.outcome.stock, 200);
        assert.equal(executed.data.task.state, 'SUCCEEDED');
        const after = snapshot(dbPath);
        assert.equal(after.parts[0].stock, 200, '库存必须恰好 +100');
        assert.equal(after.operations.length, 1);
        assert.equal(after.operations[0].capability_id, 'inventory.parts.batch_adjust_stock');
    });
});

test('W15-E2E-2 flag=false：同一句话仍是 WRITE_DISABLED，零提案、零 token、零任务、零写入', async () => {
    await withServer({ writeEnabled: false }, async ({ runtime, dbPath }) => {
        const result = await chat(runtime.baseUrl, { content: `把 ${MODEL} 库存增加 100`, cookie: ownerCookie() });
        assert.equal(result.status, 200);
        const detail = result.events.find(event => event.type === 'detail');
        assert.equal(detail.state, 'WRITE_DISABLED');
        assert.equal(detail.nativeWriteEnabled, false);
        assert.equal(result.events.some(event => event.type === 'write_proposal'), false);
        assert.equal(/confirmationToken/u.test(result.text), false);
        assert.equal(result.text.includes('[object Object]'), false);
        const state = snapshot(dbPath);
        assert.equal(state.tasks.length, 0, '写未开放时不得创建任何任务');
        assert.equal(state.parts[0].stock, 100);
        assert.equal(state.operations.length, 0);
    });
});

test('W15-E2E-3 flag=true：其它支持说法（不带把/将、减少方向）同样直达提案', async () => {
    await withServer({
        writeEnabled: true,
        parts: [{ id: 9101, model: MODEL_SHORT, stock: 40 }, { id: 9102, model: MODEL_DECREASE, stock: 60 }],
        message: `${MODEL_SHORT}库存加100`,
    }, async ({ runtime, dbPath }) => {
        persistUserMessage(dbPath, `${MODEL_SHORT}库存加100`);
        const increase = await chat(runtime.baseUrl, { content: `${MODEL_SHORT}库存加100`, cookie: ownerCookie() });
        const first = proposalOf(increase.events).proposal.items[0];
        assert.equal(first.model, MODEL_SHORT);
        assert.equal(first.delta, 100);
        assert.equal(first.currentStock, 40);
        assert.equal(first.nextStock, 140);

        persistUserMessage(dbPath, `把 ${MODEL_DECREASE} 库存减少 20`);
        const decrease = await chat(runtime.baseUrl, { content: `把 ${MODEL_DECREASE} 库存减少 20`, cookie: ownerCookie() });
        const second = proposalOf(decrease.events).proposal.items[0];
        assert.equal(second.model, MODEL_DECREASE);
        assert.equal(second.delta, -20);
        assert.equal(second.nextStock, 40);

        const state = snapshot(dbPath);
        assert.equal(state.parts.find(part => part.id === 9101).stock, 40);
        assert.equal(state.parts.find(part => part.id === 9102).stock, 60);
        assert.equal(state.operations.length, 0);
    });
});

test('W15-E2E-4 flag=true 失败矩阵：澄清/多目标/目标不存在/目标歧义/非 W1 能力，全部零写入零提案', async () => {
    await withServer({
        writeEnabled: true,
        parts: [
            { id: 9201, model: MODEL, stock: 100 },
            { id: 9202, model: 'W15-DUP', stock: 10, supplier: 'A' },
            { id: 9203, model: 'W15-DUP', stock: 20, supplier: 'B' },
        ],
        message: `把 ${MODEL} 库存增加 100`,
    }, async ({ runtime, dbPath }) => {
        const cases = [
            { content: `把 ${MODEL} 库存增加`, state: 'WRITE_CLARIFICATION_REQUIRED', code: 'NATIVE_WRITE_QUANTITY_REQUIRED' },
            { content: '把库存增加100', state: 'WRITE_CLARIFICATION_REQUIRED', code: 'NATIVE_WRITE_TARGET_REQUIRED' },
            { content: `把 ${MODEL} 和 W15-DUP 库存都增加 100`, state: 'WRITE_CLARIFICATION_REQUIRED', code: 'NATIVE_WRITE_SINGLE_TARGET_REQUIRED' },
            { content: '把 W15-不存在 库存增加 10', state: 'WRITE_CLARIFICATION_REQUIRED', code: 'part_stock_target_not_found' },
            { content: '把 W15-DUP 库存增加 10', state: 'WRITE_CLARIFICATION_REQUIRED', code: 'part_stock_target_ambiguous' },
            { content: '把12-120线圈库存增加100套', state: 'WRITE_UNSUPPORTED', code: null },
            { content: '把零件A的单价修改成5元', state: 'WRITE_UNSUPPORTED', code: null },
            { content: '删除零件A', state: 'WRITE_UNSUPPORTED', code: null },
        ];
        for (const item of cases) {
            persistUserMessage(dbPath, item.content);
            const result = await chat(runtime.baseUrl, { content: item.content, cookie: ownerCookie() });
            assert.equal(result.status, 200, item.content);
            const detail = result.events.find(event => event.type === 'detail');
            assert.equal(detail.state, item.state, `${item.content} → ${JSON.stringify(detail)}`);
            if (item.code) assert.equal(detail.code, item.code, item.content);
            assert.equal(result.events.some(event => event.type === 'write_proposal'), false, item.content);
            assert.equal(/confirmationToken/u.test(result.text), false, item.content);
        }
        // 未被持久化的消息绝不生成提案（否则卡片会对应错的消息）。
        const unpersisted = await chat(runtime.baseUrl, { content: `把 ${MODEL} 库存增加 999`, cookie: ownerCookie() });
        const unpersistedDetail = unpersisted.events.find(event => event.type === 'detail');
        assert.equal(unpersistedDetail.code, 'NATIVE_WRITE_SOURCE_MISMATCH');
        assert.equal(unpersisted.events.some(event => event.type === 'write_proposal'), false);

        const state = snapshot(dbPath);
        assert.equal(state.parts.find(part => part.id === 9201).stock, 100);
        assert.equal(state.operations.length, 0);
        // 澄清/不支持路径不建任何任务；预览拒绝路径最多留下一条**已安全失败**的任务记录
        // （可审计，但没有 writeV1，无法执行），绝不允许存在非终局/可写的悬挂任务。
        for (const task of state.tasks) {
            assert.equal(task.state, 'FAILED');
            const spec = JSON.parse(task.spec_json);
            assert.equal(spec.writeV1 ?? null, null, '失败任务不得保留提案');
            assert.equal(spec.approvalOperationIds.length, 0);
        }
        assert.deepEqual(state.tasks.map(task => task.state), ['FAILED', 'FAILED']);
    });
});

test('W15-E2E-5 授权：非 Owner / 未认证 / 内部凭据都不能取得 Owner 提案', async () => {
    await withServer({ writeEnabled: true }, async ({ runtime, dbPath }) => {
        const content = `把 ${MODEL} 库存增加 100`;
        const nonOwner = await chat(runtime.baseUrl, { content, cookie: nonOwnerCookie() });
        assert.equal(nonOwner.status, 403);
        const anonymous = await chat(runtime.baseUrl, { content });
        assert.equal(anonymous.status, 401);
        const internal = await chat(runtime.baseUrl, { content, headers: { 'x-internal-secret': INTERNAL_SECRET } });
        assert.equal(internal.status, 403);
        const internalWrite = await chat(runtime.baseUrl, { content, headers: { 'x-internal-write-secret': INTERNAL_WRITE_SECRET } });
        assert.ok([401, 403].includes(internalWrite.status), String(internalWrite.status));
        const state = snapshot(dbPath);
        assert.equal(state.tasks.length, 0);
        assert.equal(state.parts[0].stock, 100);
        assert.equal(state.operations.length, 0);
    });
});

test('W15-E2E-6 对账与执行共用同一个写 rollout 门：flag=false 时 reconcile 同样是 WRITE_DISABLED', async () => {
    await withServer({ writeEnabled: false }, async ({ runtime }) => {
        const fakeTask = crypto.randomUUID();
        for (const endpoint of ['write-preview', 'write-execute', 'write-reconcile']) {
            const call = await post(runtime.baseUrl, `/api/ai/tasks/${fakeTask}/${endpoint}`, {
                cookie: ownerCookie(),
                body: { version: 1, expectedRevision: 1, goalKey: 'prepare_part_stock_adjust', toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 1 }] } },
            });
            assert.equal(call.status, 403, endpoint);
            assert.equal(call.code, 'AI_NATIVE_WRITE_DISABLED', endpoint);
        }
    });
});
