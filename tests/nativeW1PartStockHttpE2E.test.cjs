'use strict';
/**
 * NATIVE-W1 —— 真实 HTTP 端到端验收（隔离实例，不接触生产）。
 *
 * 这一组测试跑**真实 api.cjs**（真实路由、真实确认链、真实业务 API、真实 SQLite）：
 *   - 关闭/开启开关的真实行为（AI_NATIVE_WRITE_ENABLED=false → WRITE_DISABLED）；
 *   - 完整闭环：Owner 预览 → Owner 批准 → 业务 API 写一次 → 独立回读核验 → SUCCEEDED；
 *   - 重复提交不产生第二次库存调整；
 *   - 目标版本漂移 → 409 且零写入；
 *   - 进程重启后：未批准的 token 失效、已提交的写入通过对账 + 回读确认（不重复写）。
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

const ROOT = path.resolve(__dirname, '..');
const MODEL = 'W1-E2E-6202轴承';
const OWNER_PASSWORD = 'w1-e2e-owner-password-0123456789abcdefgh';
const OWNER_SUBJECT = 'w1_e2e_owner_subject';
const ACCESS_PASSWORD = 'w1-e2e-access-password';
const JWT_SECRET = 'w1-e2e-jwt-secret';
const INTERNAL_SECRET = 'w1-e2e-internal-secret';
const INTERNAL_WRITE_SECRET = 'w1-e2e-internal-write-secret-0123456789';

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
    throw new Error('W1_E2E_RUNTIME_NOT_READY');
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

/** 隔离实例里预置一条正式零件 + Owner 会话 + 一个待批准的任务。 */
function seed(dbPath) {
    const db = new Database(dbPath);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO parts (id, model, category, price, supplier, stock, created_at, updated_at, deleted_at) VALUES (?,?,?,?,?,?,?,?,NULL)')
        .run(9001, MODEL, '轴承', 12, 'W1-E2E', 100, now, now);
    db.prepare('INSERT INTO ai_conversations (id, owner_key, title, created_at, updated_at, deleted_at) VALUES (1,?,?,?,?,NULL)')
        .run('admin', 'W1 E2E', now, now);
    db.prepare('INSERT INTO ai_conversation_messages (id, conversation_id, role, content, created_at, updated_at) VALUES (1,1,?,?,?,?)')
        .run('user', `把 ${MODEL} 库存增加 100 个`, now, now);
    const taskKey = crypto.randomUUID();
    const spec = {
        version: 2, answerOwner: 'TASK_V2', userGoal: `把 ${MODEL} 库存增加 100 个`, businessWritePolicy: 'CONFIRMATION_REQUIRED',
        subjects: [], goals: [{ goalKey: 'apply', kind: 'APPLY_CHANGE', description: '执行库存调整', subjectKeys: [], scenarioKeys: [], dependsOn: [], state: 'PENDING', factIds: [], blockers: [], requirements: [] }],
        scenarios: [], questions: [], approvalOperationIds: [],
    };
    const budget = { limits: { maxModelCalls: 7, maxToolCalls: 10, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 32, maxActiveMs: 60000 }, usage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 } };
    db.prepare(`INSERT INTO ai_tasks(task_key,owner_key,conversation_id,user_message_id,schema_version,revision,plan_revision,state,execution_mode,input_hash,spec_json,budget_json,result_json,lease_owner,lease_token,lease_expires_at,cancel_requested_at,created_at,updated_at,expires_at)
VALUES(?,?,1,1,2,1,1,'RUNNING','DETACHED',?,?,?,NULL,NULL,NULL,NULL,NULL,?,?,?)`)
        .run(taskKey, 'admin', crypto.createHash('sha256').update('w1-e2e').digest('hex'), JSON.stringify(spec), JSON.stringify(budget), now, now, new Date(Date.now() + 86400000).toISOString());
    db.close();
    return taskKey;
}

function ownerCookie() {
    return `token=${issueOwnerToken(OWNER_PASSWORD, { ACCESS_PASSWORD, JWT_SECRET, PUMP_OWNER_ACCESS_PASSWORD: OWNER_PASSWORD, PUMP_OWNER_SUBJECT: OWNER_SUBJECT, AI_V5_OWNER_SUBJECTS: JSON.stringify([OWNER_SUBJECT]) })}`;
}

async function post(baseUrl, url, { body, cookie, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
        body: JSON.stringify(body || {}),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { status: response.status, body: payload, data: payload?.data };
}

function readTask(dbPath, taskKey) {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('SELECT * FROM ai_tasks WHERE task_key = ?').get(taskKey);
    const steps = db.prepare('SELECT * FROM ai_task_steps WHERE task_id = ? ORDER BY id').all(row.id);
    const part = db.prepare('SELECT id, model, stock, updated_at FROM parts WHERE id = ?').get(9001);
    const operations = db.prepare('SELECT operation_id, capability_id, idempotency_key, status FROM api_operations ORDER BY id').all();
    const audits = db.prepare("SELECT COUNT(*) count FROM audit_log WHERE table_name = 'parts'").get().count;
    db.close();
    return { row, spec: JSON.parse(row.spec_json), steps, part, operations, audits };
}

async function withServer(options, fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-e2e-'));
    const dbPath = path.join(dir, 'w1-e2e.db');
    const port = await freePort();
    const env = apiEnv({ port, dbPath, dir, writeEnabled: options.writeEnabled !== false });
    let runtime = await startApi(env);
    try { await fn({ runtime, env, dir, dbPath, port }); } finally {
        try { await stopApi(runtime); } catch { /* already stopped */ }
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

test('W1-E2E-1 生产默认（AI_NATIVE_WRITE_ENABLED=false）：三个写端点全部 WRITE_DISABLED 且零写入', async () => {
    await withServer({ writeEnabled: false }, async ({ runtime, dbPath }) => {
        const taskKey = seed(dbPath);
        const cookie = ownerCookie();
        for (const suffix of ['write-preview', 'write-execute', 'write-reconcile']) {
            const result = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/${suffix}`, { body: { version: 1, expectedRevision: 1, goalKey: 'apply', toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie });
            assert.equal(result.status, 403, suffix);
            assert.equal(result.body.code, 'AI_NATIVE_WRITE_DISABLED', suffix);
        }
        const state = readTask(dbPath, taskKey);
        assert.equal(state.part.stock, 100, '开关关闭时绝不能改动库存');
        assert.equal(state.operations.length, 0);
    });
});

test('W1-E2E-2 真实闭环：预览 → Owner 批准 → 业务 API 写一次 → 回读核验 → SUCCEEDED；重复提交不再调整', async () => {
    await withServer({}, async ({ runtime, dbPath }) => {
        const taskKey = seed(dbPath);
        const cookie = ownerCookie();

        const preview = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-preview`, {
            body: { version: 1, expectedRevision: 1, goalKey: 'apply', toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie,
        });
        assert.equal(preview.status, 202, JSON.stringify(preview.body));
        assert.equal(preview.data.proposal.model, MODEL);
        assert.equal(preview.data.proposal.currentStock, 100);
        assert.equal(preview.data.proposal.nextStock, 200);
        const token = preview.data.confirmation.confirmationToken;
        const revision = readTask(dbPath, taskKey).row.revision;

        const executed = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-execute`, {
            body: { version: 1, expectedRevision: revision, confirmationToken: token, toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie,
        });
        assert.equal(executed.status, 200, JSON.stringify(executed.body));
        assert.equal(executed.data.outcome.verified, true);
        assert.equal(executed.data.outcome.stock, 200);

        const after = readTask(dbPath, taskKey);
        assert.equal(after.part.stock, 200, '库存必须恰好 +100');
        assert.equal(after.row.state, 'SUCCEEDED');
        assert.equal(after.spec.goals[0].state, 'VERIFIED');
        assert.equal(after.spec.writeV1.phase, 'VERIFIED');
        assert.equal(after.spec.writeV1.verification.verified, true);
        assert.match(after.spec.writeV1.approval.ownerSubject, /^[a-f0-9]{64}$/u);
        assert.equal(after.spec.writeV1.approval.targetPartId, 9001);
        assert.equal(after.steps.length, 1);
        assert.equal(after.steps[0].access, 'COMMAND');
        assert.equal(after.steps[0].state, 'SUCCEEDED');
        assert.equal(after.operations.filter(item => item.capability_id === 'inventory.parts.batch_adjust_stock').length, 1, '同一幂等键只能有一条正式操作记录');
        assert.ok(after.audits >= 1, '库存写入必须产生审计记录');

        // 重复提交同一确认：不得产生第二次调整。
        const replay = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-execute`, {
            body: { version: 1, expectedRevision: readTask(dbPath, taskKey).row.revision, confirmationToken: token, toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie,
        });
        assert.ok([200, 409].includes(replay.status), `重复提交必须确定性处理，实际 ${replay.status}`);
        const finalState = readTask(dbPath, taskKey);
        assert.equal(finalState.part.stock, 200, '重复提交后库存不得再变');
        assert.equal(finalState.operations.filter(item => item.capability_id === 'inventory.parts.batch_adjust_stock').length, 1);
    });
});

test('W1-E2E-3 目标版本漂移：批准后目标被改动 → 409 resource_version_conflict，零写入、任务安全失败', async () => {
    await withServer({}, async ({ runtime, dbPath }) => {
        const taskKey = seed(dbPath);
        const cookie = ownerCookie();
        const preview = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-preview`, {
            body: { version: 1, expectedRevision: 1, goalKey: 'apply', toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie,
        });
        assert.equal(preview.status, 202);
        const token = preview.data.confirmation.confirmationToken;
        const draft = readTask(dbPath, taskKey);
        assert.equal(draft.spec.writeV1.expectedUpdatedAt !== null, true, '预检必须冻结目标版本');

        // 合法的其它更新：直接改库存与 updated_at（模拟另一个操作先提交）。
        const writer = new Database(dbPath);
        writer.prepare('UPDATE parts SET stock = ?, updated_at = ? WHERE id = ?').run(150, new Date(Date.now() + 1000).toISOString(), 9001);
        writer.close();

        const executed = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-execute`, {
            body: { version: 1, expectedRevision: draft.row.revision, confirmationToken: token, toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie,
        });
        assert.equal(executed.status, 409, JSON.stringify(executed.body));
        assert.equal(executed.body.code, 'resource_version_conflict');
        const after = readTask(dbPath, taskKey);
        assert.equal(after.part.stock, 150, '陈旧提案绝不能被套用到已变化的目标上');
        assert.equal(after.row.state, 'FAILED');
        assert.equal(after.spec.writeV1.phase, 'FAILED_SAFE');
        assert.equal(after.operations.filter(item => item.capability_id === 'inventory.parts.batch_adjust_stock').length, 0);
    });
});

test('W1-E2E-4 重启：未批准的确认卡失效（不写），重新预览后可正常完成；已提交的写入通过对账 + 回读确认', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w1-e2e-restart-'));
    const dbPath = path.join(dir, 'w1-e2e.db');
    const port = await freePort();
    const env = apiEnv({ port, dbPath, dir, writeEnabled: true });
    let runtime = await startApi(env);
    try {
        const taskKey = seed(dbPath);
        const cookie = ownerCookie();
        const preview = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-preview`, {
            body: { version: 1, expectedRevision: 1, goalKey: 'apply', toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie,
        });
        assert.equal(preview.status, 202);
        const staleToken = preview.data.confirmation.confirmationToken;
        const proposalHash = readTask(dbPath, taskKey).spec.writeV1.proposalHash;

        // 真重启：进程内确认态全部丢失，持久化提案仍在。
        await stopApi(runtime);
        runtime = await startApi(env);
        const afterRestart = readTask(dbPath, taskKey);
        assert.equal(afterRestart.spec.writeV1.proposalHash, proposalHash, '提案事实必须在重启后仍然存在');
        assert.equal(afterRestart.row.state, 'WAITING_APPROVAL');

        const stale = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-execute`, {
            body: { version: 1, expectedRevision: afterRestart.row.revision, confirmationToken: staleToken, toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie,
        });
        assert.equal(stale.status, 409, JSON.stringify(stale.body));
        assert.equal(stale.body.code, 'confirmation_token_invalid');
        assert.equal(readTask(dbPath, taskKey).part.stock, 100, '重启后旧 token 绝不能写入');

        // 重新预览 → 批准 → 完成（真实写入一次）。
        const again = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-preview`, {
            body: { version: 1, expectedRevision: readTask(dbPath, taskKey).row.revision, goalKey: 'apply', toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie,
        });
        assert.equal(again.status, 202, JSON.stringify(again.body));
        const done = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-execute`, {
            body: { version: 1, expectedRevision: readTask(dbPath, taskKey).row.revision, confirmationToken: again.data.confirmation.confirmationToken, toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie,
        });
        assert.equal(done.status, 200, JSON.stringify(done.body));
        let state = readTask(dbPath, taskKey);
        assert.equal(state.part.stock, 200);
        assert.equal(state.row.state, 'SUCCEEDED');

        // 模拟"已提交但回执丢失"：把任务回滚成对账态（正式操作记录保留在数据库里），再重启对账。
        const editor = new Database(dbPath);
        const spec = state.spec;
        spec.writeV1 = { ...spec.writeV1, phase: 'RECONCILING', reconciliation: undefined };
        delete spec.writeV1.verification;
        delete spec.writeV1.execution;
        spec.goals[0].state = 'PENDING';
        editor.prepare("UPDATE ai_tasks SET state='RECONCILING', spec_json=?, revision=revision+1 WHERE task_key=?").run(JSON.stringify(spec), taskKey);
        editor.prepare("UPDATE ai_task_steps SET state='UNKNOWN_EFFECT' WHERE task_id=(SELECT id FROM ai_tasks WHERE task_key=?)").run(taskKey);
        editor.close();

        await stopApi(runtime);
        runtime = await startApi(env);
        const reconciling = readTask(dbPath, taskKey);
        const reconciled = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-reconcile`, { body: {}, cookie });
        assert.equal(reconciled.status, 200, JSON.stringify(reconciled.body));
        assert.equal(reconciled.data.resolved, true);
        assert.equal(reconciled.data.status, 'COMPLETED');
        assert.equal(reconciled.data.outcome.verified, true);
        state = readTask(dbPath, taskKey);
        assert.equal(state.row.state, 'SUCCEEDED');
        assert.equal(state.spec.writeV1.phase, 'VERIFIED');
        assert.equal(state.part.stock, 200, '对账不得产生第二次库存调整');
        assert.equal(state.operations.filter(item => item.capability_id === 'inventory.parts.batch_adjust_stock').length, 1);
        assert.equal(reconciling.row.state, 'RECONCILING');
    } finally {
        try { await stopApi(runtime); } catch { /* already stopped */ }
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('W1-E2E-5 HTTP 层安全边界：非 Owner / 内部凭据 / 未认证都不能批准，且零写入', async () => {
    await withServer({}, async ({ runtime, dbPath }) => {
        const taskKey = seed(dbPath);
        const preview = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-preview`, {
            body: { version: 1, expectedRevision: 1, goalKey: 'apply', toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } }, cookie: ownerCookie(),
        });
        assert.equal(preview.status, 202);
        const token = preview.data.confirmation.confirmationToken;
        const revision = readTask(dbPath, taskKey).row.revision;
        const body = { version: 1, expectedRevision: revision, confirmationToken: token, toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] } };
        const { default: jwt } = { default: require('jsonwebtoken') };
        const nonOwner = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-execute`, { body, cookie: `token=${jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}` });
        assert.equal(nonOwner.status, 403); assert.equal(nonOwner.body.code, 'NATIVE_WRITE_OWNER_REQUIRED');
        const internal = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-execute`, { body, headers: { 'x-internal-secret': INTERNAL_SECRET } });
        assert.equal(internal.status, 403); assert.equal(internal.body.code, 'NATIVE_WRITE_OWNER_REQUIRED');
        const anonymous = await post(runtime.baseUrl, `/api/ai/tasks/${taskKey}/write-execute`, { body });
        assert.equal(anonymous.status, 401);
        const state = readTask(dbPath, taskKey);
        assert.equal(state.part.stock, 100);
        assert.equal(state.operations.length, 0);
        assert.equal(state.row.state, 'WAITING_APPROVAL');
    });
});
