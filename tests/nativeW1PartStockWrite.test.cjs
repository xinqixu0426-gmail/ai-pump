'use strict';
/**
 * NATIVE-W1 —— Native 写 V1 行为矩阵（路由层，隔离运行时不接触生产库）。
 *
 * 覆盖 ticket §28 的行为类：
 *   范围/白名单（§4/§23/§26）、身份与接地（§5/§6）、Owner 批准（§9）、
 *   提案持久化（§8）、批准事实（§10）、幂等/重放（§12/§19）、版本漂移（§17）、
 *   过期（§18）、写后回读核验（§16）、崩溃与对账策略（§14/§15）、安全边界（§29）。
 */
process.env.NODE_ENV = 'test';
if (!process.env.PUMP_TEST_DATABASE_PATH) {
    process.env.PUMP_TEST_DATABASE_PATH = require('node:path').join(require('node:os').tmpdir(), `w1-router-${process.pid}.db`);
}

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const OWNER_PASSWORD = 'w1-owner-password-0123456789abcdefghijklmn';
const OWNER_SUBJECT = 'w1_owner_subject_value';
const ACCESS_PASSWORD = 'w1-access-password';
const JWT_SECRET = 'w1-synthetic-jwt-secret';
const INTERNAL_SECRET = 'w1-synthetic-internal-secret';
const INTERNAL_WRITE_SECRET = 'w1-synthetic-internal-write-secret-0123456789';

process.env.ACCESS_PASSWORD = ACCESS_PASSWORD;
process.env.JWT_SECRET = JWT_SECRET;
process.env.PUMP_OWNER_ACCESS_PASSWORD = OWNER_PASSWORD;
process.env.PUMP_OWNER_SUBJECT = OWNER_SUBJECT;
process.env.AI_V5_OWNER_SUBJECTS = JSON.stringify([OWNER_SUBJECT]);
process.env.AI_NATIVE_MODE = 'owner';
process.env.AI_NATIVE_WRITE_ENABLED = 'true';
process.env.INTERNAL_SECRET = INTERNAL_SECRET;
process.env.INTERNAL_WRITE_SECRET = INTERNAL_WRITE_SECRET;

const { AI_TASK_PERSISTENCE_SCHEMA_SQL } = require('../api/database/schema.cjs');
const { createAiTaskLifecycleV2 } = require('../api/services/aiTaskLifecycleV2.cjs');
const { createAiTaskRouterV2 } = require('../api/routes/ai/tasks.cjs');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');
const { issueAiToolConfirmation, resetAiToolConfirmationsForTests } = require('../api/services/aiToolConfirmation.cjs');
const { executeConfirmedAiTool } = require('../api/services/aiConfirmedToolExecution.cjs');
const { stableHash } = require('../api/services/aiTaskContractV2.cjs');
const { RECONCILE_MAX_ATTEMPTS, RECONCILE_MAX_ELAPSED_MS } = require('../api/services/aiTaskWriteBridgeV2.cjs');
const { listBusinessCapabilities, getAiCapability } = require('../api/capabilities/registry.cjs');
const {
    NATIVE_WRITE_V1_CAPABILITIES,
    NATIVE_WRITE_V1_TOOLS,
    validateNativeWriteV1Request,
} = require('../api/services/aiNativeWriteScope.cjs');

const CAPABILITY = 'inventory.parts.batch_adjust_stock';
const MODEL = 'W1-轴承-6202';

function accessors(db) {
    return {
        db,
        safeInsert(table, values) {
            const keys = Object.keys(values).filter(key => values[key] !== undefined);
            return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => values[key]));
        },
        safeUpdate(table, id, values) {
            const keys = Object.keys(values).filter(key => values[key] !== undefined);
            return db.prepare(`UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(',')}, updated_at=? WHERE id=?`).run(...keys.map(key => values[key]), new Date().toISOString(), id);
        },
    };
}

/** 隔离任务运行时 + 一个"正式零件"事实，供注入的预检/执行器使用。 */
async function harness({ scenario = {} } = {}) {
    const db = new Database(':memory:');
    db.pragma('foreign_keys=ON');
    db.exec(`CREATE TABLE ai_conversations (id INTEGER PRIMARY KEY, owner_key TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE ai_conversation_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE api_operations (id INTEGER PRIMARY KEY, operation_id TEXT NOT NULL, capability_id TEXT NOT NULL, actor_key TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, request_id TEXT, status TEXT NOT NULL, response_json TEXT, created_at TEXT NOT NULL, completed_at TEXT, expires_at TEXT NOT NULL);
${AI_TASK_PERSISTENCE_SCHEMA_SQL}`);
    db.prepare('INSERT INTO ai_conversations VALUES(1,?,NULL)').run('admin');
    db.prepare('INSERT INTO ai_conversation_messages VALUES(1,1,?,?)').run('user', '把 6202 轴承库存增加 100 个');
    const state = { scenario, part: { partId: 7, model: MODEL, stock: 100, updatedAt: '2026-09-01T00:00:00.000Z' }, writes: 0, operationSeq: 100, readbacks: 0 };
    const lifecycle = createAiTaskLifecycleV2({ dbAccessors: accessors(db) });
    const taskKey = crypto.randomUUID();
    const spec = {
        version: 2, answerOwner: 'TASK_V2', userGoal: '把 6202 轴承库存增加 100 个', businessWritePolicy: 'CONFIRMATION_REQUIRED',
        subjects: [], goals: [
            { goalKey: 'apply', kind: 'APPLY_CHANGE', description: '执行库存调整', subjectKeys: [], scenarioKeys: [], dependsOn: [], state: 'PENDING', factIds: [], blockers: [], requirements: [] },
        ], scenarios: [], questions: [], approvalOperationIds: [],
    };
    const budget = { limits: { maxModelCalls: 7, maxToolCalls: 10, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 32, maxActiveMs: 60000 }, usage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 } };
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO ai_tasks(task_key,owner_key,conversation_id,user_message_id,schema_version,revision,plan_revision,state,execution_mode,input_hash,spec_json,budget_json,result_json,lease_owner,lease_token,lease_expires_at,cancel_requested_at,created_at,updated_at,expires_at)
VALUES(?,?,1,1,2,1,1,'RUNNING','DETACHED',?,?,?,NULL,NULL,NULL,NULL,NULL,?,?,?)`)
        .run(taskKey, 'admin', crypto.createHash('sha256').update('x').digest('hex'), JSON.stringify(spec), JSON.stringify(budget), now, now, new Date(Date.now() + 86400000).toISOString());

    // 注入的"正式预览"：完全模拟真实 preflight 的返回形状（proposal + idempotencyKey + 确认卡）。
    const executeToolCall = async (toolName, args, options = {}) => {
        assert.equal(toolName, 'adjust_part_stock');
        const item = args.items[0];
        const delta = Number(item.changeQty);
        const currentStock = state.part.stock;
        const nextStock = Math.max(0, currentStock + delta);
        const issued = issueAiToolConfirmation({
            toolName, args, subject: options.confirmationSubject,
            executionContext: {
                kind: 'part_stock_preview', confirmationToken: 'formal-preview-token',
                idempotencyKey: `w1-idem-${state.operationSeq}`, operations: [{ partId: state.part.partId, delta, currentStock, nextStock, expectedUpdatedAt: state.part.updatedAt }],
                nativeTask: options.executionContext.nativeTask,
            },
        });
        return {
            success: true, requiresConfirmation: true,
            confirmation: {
                ...issued, idempotencyKey: `w1-idem-${state.operationSeq}`,
                proposal: { kind: 'part_stock_adjust', capabilityId: CAPABILITY, items: [{ partId: state.part.partId, model: state.part.model, currentStock, delta, nextStock, expectedUpdatedAt: state.part.updatedAt, clampedToZero: nextStock === 0 && currentStock + delta < 0 }] },
            },
        };
    };
    // 注入的"正式业务 API 执行"：真实确认执行链 + 假业务写。
    const executeConfirmed = input => executeConfirmedAiTool({
        ...input,
        execute: async () => {
            state.writes += 1;
            if (scenario.businessReject) {
                const error = new Error('零件已被其他操作修改，请刷新后重试');
                error.code = 'resource_version_conflict'; error.statusCode = 409; throw error;
            }
            if (scenario.businessTimeout) {
                const error = new Error('正式库存 API 超时'); error.code = 'transport_failure'; error.statusCode = 502; throw error;
            }
            state.operationSeq += 1;
            const operationId = crypto.randomUUID();
            const nextStock = Math.max(0, state.part.stock + Number(input ? 0 : 0));
            return {
                success: true,
                executionEvidence: { verified: true, kind: 'formal_api_command', receipts: [{ operationId, capabilityId: CAPABILITY, status: 'completed', auditIds: [state.operationSeq] }] },
                auditId: state.operationSeq, auditIds: [state.operationSeq],
                changes: [{ resourceId: state.part.partId, field: 'stock' }],
                ...(scenario.skipReadback ? {} : { readback: [{ id: state.part.partId, model: state.part.model, stock: scenario.readbackStock ?? (state.part.stock + 100) }] }),
                _nextStock: nextStock,
                _operationId: operationId,
            };
        },
    });

    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(createAiTaskRouterV2({
        lifecycle,
        dbAccessors: accessors(db),
        executeToolCall,
        executeConfirmedAiTool: executeConfirmed,
        readTaskCommandOperation: ({ db: readDb, step }) => readOperationFrom(readDb, step),
        verifyPartStockTarget: async ({ target }) => {
            state.readbacks += 1;
            if (scenario.verifyMismatch) {
                const error = new Error('回读库存与冻结提案不一致');
                error.code = 'part_stock_readback_mismatch';
                throw error;
            }
            return { partId: target.partId, model: state.part.model, stock: target.nextStock };
        },
    }));
    const server = app.listen(0, '127.0.0.1');
    server.unref();
    await new Promise(resolve => server.once('listening', resolve));
    return { db, lifecycle, state, taskKey, server, app, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

function readOperationFrom(db, step) {
    const row = step?.idempotencyKey
        ? db.prepare('SELECT operation_id, capability_id, idempotency_key, status, response_json, completed_at FROM api_operations WHERE idempotency_key = ? ORDER BY id').all(step.idempotencyKey)
        : [];
    if (row.length === 0) return { status: 'MISSING' };
    if (row.length > 1) return { status: 'AMBIGUOUS' };
    if (row[0].status !== 'completed') return { status: 'PENDING' };
    const receipt = JSON.parse(row[0].response_json || '{}');
    return { status: 'COMPLETED', receipt: { operationId: receipt.operationId, capabilityId: receipt.capabilityId, status: 'completed', auditIds: receipt.auditIds, completedAt: receipt.completed_at || row[0].completed_at } };
}

function ownerCookie() { return `token=${issueOwnerToken(OWNER_PASSWORD, process.env)}`; }
function nonOwnerCookie() { return `token=${jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '1h' })}`; }
async function call(harnessRef, path, { body, cookie, headers = {} } = {}) {
    const response = await fetch(`${harnessRef.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
        body: JSON.stringify(body || {}),
    });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { status: response.status, body: payload, data: payload?.data };
}
function previewBody(overrides = {}) {
    return { version: 1, expectedRevision: 1, goalKey: 'apply', toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] }, ...overrides };
}
function executeBody(token, overrides = {}) {
    return { version: 1, expectedRevision: 1, confirmationToken: token, toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 100 }] }, ...overrides };
}
/** 执行请求必须携带当前任务版本（预览会推进 revision）。 */
function executeFor(h, token, overrides = {}) {
    return { ...executeBody(token), expectedRevision: taskState(h).revision, ...overrides };
}
function taskState(h) { return h.lifecycle.store.getTaskByKey(h.taskKey); }

test.beforeEach(() => resetAiToolConfirmationsForTests());

// ── §4/§23/§26 范围：deny-by-default，且恰好只有一个能力 ────────────────────────────
test('W1-SCOPE-1 白名单恰好只包含一个能力，且该能力确实是注册表里的库存调整能力', () => {
    assert.deepEqual(NATIVE_WRITE_V1_TOOLS, ['adjust_part_stock']);
    assert.deepEqual(NATIVE_WRITE_V1_CAPABILITIES, [CAPABILITY]);
    const capability = getAiCapability('adjust_part_stock');
    assert.equal(capability.capabilityId, 'ai.adjust_part_stock');
    assert.deepEqual(capability.formalCapabilityIds, [CAPABILITY]);
    // 注册表里的写能力远多于 1 个 → 白名单必须显式收敛，而不是"自动暴露"。
    const writeCapabilities = listBusinessCapabilities().filter(item => item.access === 'write' || item.operation === 'command');
    assert.ok(writeCapabilities.length > 1, `注册表写能力数量异常：${writeCapabilities.length}`);
    const allowed = new Set(NATIVE_WRITE_V1_CAPABILITIES);
    assert.equal(writeCapabilities.filter(item => allowed.has(item.capabilityId)).length, 1);
});

test('W1-SCOPE-2 其它任何写能力（含删除）都被拒绝，且返回可判定的错误码', () => {
    const writeCapabilities = listBusinessCapabilities().filter(item => item.access === 'write' || item.operation === 'command');
    const denied = [];
    for (const capability of writeCapabilities) {
        if (capability.capabilityId === CAPABILITY) continue;
        const toolName = Object.entries(require('../api/capabilities/registry.cjs').AI_CAPABILITY_REGISTRY)
            .find(([, value]) => (value.formalCapabilityIds || []).includes(capability.capabilityId))?.[0];
        const result = validateNativeWriteV1Request({ toolName: toolName || capability.capabilityId, args: { items: [{ model: MODEL, changeQty: 1 }] } });
        assert.equal(result.ok, false, `写能力 ${capability.capabilityId} 不应被 V1 接受`);
        denied.push(capability.capabilityId);
    }
    assert.ok(denied.length >= 90, `被拒绝的写能力数量异常：${denied.length}`);
    // 删除类：明确永不在 V1 内。
    const deletes = writeCapabilities.filter(item => /delete|remove|purge/iu.test(item.capabilityId));
    assert.ok(deletes.length >= 10, `删除类能力数量异常：${deletes.length}`);
    for (const item of deletes) assert.equal(NATIVE_WRITE_V1_CAPABILITIES.includes(item.capabilityId), false);
});

test('W1-SCOPE-3 多目标批量、缺数量、非整数/零数量一律拒绝（不猜、不拆分）', () => {
    const two = validateNativeWriteV1Request({ toolName: 'adjust_part_stock', args: { items: [{ model: 'A', changeQty: 1 }, { model: 'B', changeQty: 2 }] } });
    assert.equal(two.ok, false); assert.equal(two.code, 'NATIVE_WRITE_SINGLE_TARGET_REQUIRED');
    const empty = validateNativeWriteV1Request({ toolName: 'adjust_part_stock', args: { items: [] } });
    assert.equal(empty.ok, false); assert.equal(empty.code, 'NATIVE_WRITE_SINGLE_TARGET_REQUIRED');
    const missing = validateNativeWriteV1Request({ toolName: 'adjust_part_stock', args: { items: [{ model: MODEL }] } });
    assert.equal(missing.ok, false); assert.equal(missing.code, 'NATIVE_WRITE_QUANTITY_INVALID');
    const zero = validateNativeWriteV1Request({ toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 0 }] } });
    assert.equal(zero.ok, false); assert.equal(zero.code, 'NATIVE_WRITE_QUANTITY_INVALID');
    const float = validateNativeWriteV1Request({ toolName: 'adjust_part_stock', args: { items: [{ model: MODEL, changeQty: 1.5 }] } });
    assert.equal(float.ok, false); assert.equal(float.code, 'NATIVE_WRITE_QUANTITY_INVALID');
    const noModel = validateNativeWriteV1Request({ toolName: 'adjust_part_stock', args: { items: [{ changeQty: 1 }] } });
    assert.equal(noModel.ok, false); assert.equal(noModel.code, 'NATIVE_WRITE_TARGET_MODEL_REQUIRED');
    const unknownTool = validateNativeWriteV1Request({ toolName: 'adjust_coil_stock', args: { items: [{ model: '12-120', changeQty: 1 }] } });
    assert.equal(unknownTool.ok, false); assert.equal(unknownTool.code, 'NATIVE_WRITE_CAPABILITY_UNSUPPORTED');
});

// ── §9 Owner 批准：只有规范 Owner 可以批准/执行/对账 ────────────────────────────────
test('W1-AUTH-1 非 Owner JWT、内部凭据、未认证都不能批准 Native 写入', async t => {
    const h = await harness(); t.after(() => h.server.close());
    let preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    assert.equal(preview.status, 202);
    const token = preview.data.confirmation.confirmationToken;

    const nonOwner = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, token), cookie: nonOwnerCookie() });
    assert.equal(nonOwner.status, 403); assert.equal(nonOwner.body.code, 'NATIVE_WRITE_OWNER_REQUIRED');
    const internal = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, token), headers: { 'x-internal-secret': INTERNAL_SECRET } });
    assert.equal(internal.status, 403); assert.equal(internal.body.code, 'NATIVE_WRITE_OWNER_REQUIRED');
    const anonymous = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, token) });
    assert.equal(anonymous.status, 401);
    // 非 Owner 尝试也不能预览或对账。
    const nonOwnerPreview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: nonOwnerCookie() });
    assert.equal(nonOwnerPreview.status, 403); assert.equal(nonOwnerPreview.body.code, 'NATIVE_WRITE_OWNER_REQUIRED');
    const nonOwnerReconcile = await call(h, `/api/ai/tasks/${h.taskKey}/write-reconcile`, { body: {}, cookie: nonOwnerCookie() });
    assert.equal(nonOwnerReconcile.status, 403); assert.equal(nonOwnerReconcile.body.code, 'NATIVE_WRITE_OWNER_REQUIRED');
    assert.equal(h.state.writes, 0, '未批准的请求绝不能产生业务写入');
});

test('W1-AUTH-2 AI_NATIVE_WRITE_ENABLED=false 时三个写端点全部 WRITE_DISABLED（生产默认）', async t => {
    const saved = process.env.AI_NATIVE_WRITE_ENABLED;
    process.env.AI_NATIVE_WRITE_ENABLED = 'false';
    try {
        const h = await harness(); t.after(() => h.server.close());
        for (const path of ['write-preview', 'write-execute', 'write-reconcile']) {
            const result = await call(h, `/api/ai/tasks/${h.taskKey}/${path}`, { body: previewBody(), cookie: ownerCookie() });
            assert.equal(result.status, 403, path);
            assert.equal(result.body.code, 'AI_NATIVE_WRITE_DISABLED', path);
        }
        assert.equal(h.state.writes, 0);
    } finally { process.env.AI_NATIVE_WRITE_ENABLED = saved; }
});

// ── §7/§8/§12/§19 闭环：提案 → 批准 → 写一次 → 回读核验 → SUCCEEDED ────────────────
test('W1-LOOP-1 闭环成功：提案事实持久化、Owner 批准、恰好一次业务写、回读核验后 SUCCEEDED', async t => {
    const h = await harness(); t.after(() => h.server.close());
    const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    assert.equal(preview.status, 202);
    assert.equal(preview.data.proposal.partId, 7);
    assert.equal(preview.data.proposal.currentStock, 100);
    assert.equal(preview.data.proposal.delta, 100);
    assert.equal(preview.data.proposal.nextStock, 200);
    assert.match(preview.data.proposal.summary, /调整后：200/u);

    const stored = taskState(h);
    assert.equal(stored.state, 'WAITING_APPROVAL');
    assert.equal(stored.spec.writeV1.phase, 'PROPOSAL_READY');
    assert.equal(stored.spec.writeV1.target.partId, 7);
    assert.equal(stored.spec.writeV1.idempotencyKey, 'w1-idem-100');
    assert.match(stored.spec.writeV1.proposalHash, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(stored.spec).includes('confirmationToken'), false, '任务数据绝不能保存确认 token');

    const executed = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, {
        body: executeFor(h, preview.data.confirmation.confirmationToken), cookie: ownerCookie(),
    });
    assert.equal(executed.status, 200);
    assert.equal(executed.data.outcome.verified, true);
    assert.equal(executed.data.outcome.stock, 200);
    const after = taskState(h);
    assert.equal(after.state, 'SUCCEEDED');
    assert.equal(after.spec.goals[0].state, 'VERIFIED');
    assert.equal(after.spec.writeV1.phase, 'VERIFIED');
    assert.equal(after.spec.writeV1.verification.verified, true);
    assert.equal(after.spec.writeV1.approval.proposalHash, stored.spec.writeV1.proposalHash);
    assert.match(after.spec.writeV1.approval.ownerSubject, /^[a-f0-9]{64}$/u);
    assert.equal(after.spec.writeV1.approval.idempotencyKey, stored.spec.writeV1.idempotencyKey);
    assert.equal(h.state.writes, 1);
});

test('W1-LOOP-2 重复提交/双击同一确认：只产生一次库存调整，第二次回放既有结果', async t => {
    const h = await harness(); t.after(() => h.server.close());
    const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    const token = preview.data.confirmation.confirmationToken;
    const first = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, token), cookie: ownerCookie() });
    assert.equal(first.status, 200);
    const second = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, token), cookie: ownerCookie() });
    assert.ok(second.status === 200 || second.status === 409, `第二次提交必须确定性失败或回放，实际 ${second.status}`);
    assert.equal(h.state.writes, 1, '同一确认绝不能再写一次');
    assert.equal(taskState(h).state, 'SUCCEEDED');
});

test('W1-LOOP-3 批准后参数/目标被改动 → 冻结提案不匹配，拒绝执行且零写入', async t => {
    const h = await harness(); t.after(() => h.server.close());
    const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    const token = preview.data.confirmation.confirmationToken;
    const tampered = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, {
        body: { ...executeFor(h, token), args: { items: [{ model: MODEL, changeQty: 5 }] } }, cookie: ownerCookie(),
    });
    assert.equal(tampered.status, 409);
    assert.equal(tampered.body.code, 'confirmation_payload_mismatch');
    assert.equal(h.state.writes, 0);
    assert.equal(taskState(h).state, 'WAITING_APPROVAL');
});

// ── §14/§15/§16 失败与对账策略 ─────────────────────────────────────────────────
test('W1-FAIL-1 业务 API 明确拒绝（版本漂移 409）→ 安全失败、零追加写入、状态 FAILED', async t => {
    const h = await harness({ scenario: { businessReject: true } }); t.after(() => h.server.close());
    const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    const executed = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, {
        body: executeFor(h, preview.data.confirmation.confirmationToken), cookie: ownerCookie(),
    });
    assert.equal(executed.status, 409);
    assert.equal(executed.body.code, 'resource_version_conflict');
    const after = taskState(h);
    assert.equal(after.state, 'FAILED');
    assert.equal(after.spec.writeV1.phase, 'FAILED_SAFE');
    assert.equal(after.spec.writeV1.failure.code, 'resource_version_conflict');
    assert.equal(h.state.writes, 1, '只发生一次被拒绝的调用');
});

test('W1-FAIL-2 结果未知（超时）→ RECONCILING；对账 MISSING → 安全失败并要求重新确认（不重发）', async t => {
    const h = await harness({ scenario: { businessTimeout: true } }); t.after(() => h.server.close());
    const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    const executed = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, {
        body: executeFor(h, preview.data.confirmation.confirmationToken), cookie: ownerCookie(),
    });
    assert.equal(executed.status, 502);
    assert.equal(taskState(h).state, 'RECONCILING');
    assert.equal(taskState(h).spec.writeV1.phase, 'RECONCILING');

    const reconcile = await call(h, `/api/ai/tasks/${h.taskKey}/write-reconcile`, { body: {}, cookie: ownerCookie() });
    assert.equal(reconcile.status, 200);
    assert.equal(reconcile.data.resolved, false);
    assert.equal(reconcile.data.status, 'MISSING');
    const after = taskState(h);
    assert.equal(after.state, 'FAILED');
    assert.equal(after.spec.writeV1.failure.code, 'OPERATION_MISSING');
    assert.equal(after.spec.writeV1.failure.reconfirmRequired, true);
    assert.equal(h.state.writes, 1, '对账绝不能产生第二次写入');
});

test('W1-FAIL-3 PENDING 有界对账：超过次数上限后安全终止，不无限停留在 RECONCILING', async t => {
    const h = await harness({ scenario: { businessTimeout: true } }); t.after(() => h.server.close());
    const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, preview.data.confirmation.confirmationToken), cookie: ownerCookie() });
    // 让对账读到一条 pending 的正式操作（不是缺失，也不是完成）。
    h.db.prepare(`INSERT INTO api_operations(operation_id,capability_id,actor_key,idempotency_key,request_hash,request_id,status,response_json,created_at,completed_at,expires_at)
VALUES(?,?,?,?,?,NULL,'pending',NULL,?,NULL,?)`).run(crypto.randomUUID(), CAPABILITY, 'internal', taskState(h).spec.writeV1.idempotencyKey, 'hash', new Date().toISOString(), new Date(Date.now() + 60000).toISOString());
    let last = null;
    for (let attempt = 1; attempt <= RECONCILE_MAX_ATTEMPTS; attempt += 1) {
        last = await call(h, `/api/ai/tasks/${h.taskKey}/write-reconcile`, { body: {}, cookie: ownerCookie() });
        assert.equal(last.status, 200);
        if (taskState(h).state === 'FAILED') break;
        assert.equal(taskState(h).state, 'RECONCILING', `第 ${attempt} 次对账后仍应在有界范围内`);
    }
    const after = taskState(h);
    assert.equal(after.state, 'FAILED', '有界对账必须能终止');
    assert.equal(after.spec.writeV1.failure.code, 'RECONCILIATION_BOUND_EXCEEDED');
    assert.equal(after.spec.writeV1.failure.manualReviewRequired, true);
    assert.ok(after.spec.writeV1.reconciliation.attempts <= RECONCILE_MAX_ATTEMPTS + 1);
    assert.ok(RECONCILE_MAX_ELAPSED_MS > 0);
    assert.equal(h.state.writes, 1);
});

test('W1-FAIL-4 正式操作记录不唯一（AMBIGUOUS）→ 人工核对的安全失败', async t => {
    const h = await harness({ scenario: { businessTimeout: true } }); t.after(() => h.server.close());
    const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, preview.data.confirmation.confirmationToken), cookie: ownerCookie() });
    const key = taskState(h).spec.writeV1.idempotencyKey;
    const insert = h.db.prepare(`INSERT INTO api_operations(operation_id,capability_id,actor_key,idempotency_key,request_hash,request_id,status,response_json,created_at,completed_at,expires_at)
VALUES(?,?,?,?,?,NULL,'completed',?,?,?,?)`);
    for (let index = 0; index < 2; index += 1) {
        insert.run(crypto.randomUUID(), CAPABILITY, 'internal', key, 'hash', JSON.stringify({ operationId: crypto.randomUUID(), capabilityId: CAPABILITY, status: 'completed', auditIds: [1] }), new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 60000).toISOString());
    }
    const reconcile = await call(h, `/api/ai/tasks/${h.taskKey}/write-reconcile`, { body: {}, cookie: ownerCookie() });
    assert.equal(reconcile.status, 200);
    assert.equal(reconcile.data.status, 'AMBIGUOUS');
    assert.equal(taskState(h).state, 'FAILED');
    assert.equal(taskState(h).spec.writeV1.failure.manualReviewRequired, true);
});

test('W1-FAIL-5 正式回执缺少可核验回读 → 不得声称成功，安全失败', async t => {
    // 两种缺失形态：回执没有回读事实，以及回读与冻结的调整后库存不一致。
    for (const scenario of [{ skipReadback: true }, { readbackStock: 999 }]) {
        const h = await harness({ scenario }); t.after(() => h.server.close());
        const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
        const executed = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, preview.data.confirmation.confirmationToken), cookie: ownerCookie() });
        assert.equal(executed.status, 200, '业务调用本身成功');
        assert.equal(executed.data.outcome.verified, false);
        const after = taskState(h);
        assert.notEqual(after.state, 'SUCCEEDED', '核验不成立时绝不能 SUCCEEDED');
        assert.equal(after.state, 'FAILED');
        assert.equal(after.spec.writeV1.phase, 'FAILED_SAFE');
        assert.ok(['WRITE_VERIFICATION_MISSING', 'WRITE_VERIFICATION_STOCK_MISMATCH'].includes(after.spec.writeV1.failure.code), after.spec.writeV1.failure.code);
    }
});

// ── §20/§21 重启语义（进程内确认态丢失，但持久化事实可安全恢复） ────────────────────
test('W1-RESTART-1 重启前未批准：旧 token 失效且不能写，重新预览后可正常批准', async t => {
    const h = await harness(); t.after(() => h.server.close());
    const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    const oldToken = preview.data.confirmation.confirmationToken;
    const proposalHash = taskState(h).spec.writeV1.proposalHash;

    // 模拟进程重启：确认态是进程内 Map，全部丢失；任务/提案事实仍在数据库里。
    resetAiToolConfirmationsForTests();
    assert.equal(taskState(h).spec.writeV1.proposalHash, proposalHash, '提案事实必须在重启后仍然存在');

    const stale = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, oldToken), cookie: ownerCookie() });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'confirmation_token_invalid');
    assert.equal(h.state.writes, 0, '重启后旧 token 绝不能写入');

    // 重新预览（同一冻结提案重新签发确认卡）→ Owner 批准 → 正常成功。
    const again = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody({ expectedRevision: taskState(h).revision }), cookie: ownerCookie() });
    assert.equal(again.status, 202, JSON.stringify(again.body));
    const done = await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: { ...executeFor(h, again.data.confirmation.confirmationToken), expectedRevision: taskState(h).revision }, cookie: ownerCookie() });
    assert.equal(done.status, 200);
    assert.equal(done.data.outcome.verified, true);
    assert.equal(h.state.writes, 1);
    assert.equal(taskState(h).state, 'SUCCEEDED');
});

test('W1-RESTART-2 已提交但回执丢失：对账按持久化幂等键发现提交，回读核验后 SUCCEEDED 且不重复写', async t => {
    const h = await harness({ scenario: { businessTimeout: true } }); t.after(() => h.server.close());
    const preview = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, { body: previewBody(), cookie: ownerCookie() });
    await call(h, `/api/ai/tasks/${h.taskKey}/write-execute`, { body: executeFor(h, preview.data.confirmation.confirmationToken), cookie: ownerCookie() });
    let task = taskState(h);
    assert.equal(task.state, 'RECONCILING');
    // 模拟"业务提交成功、进程在拿到回执前崩溃"：数据库里存在完成的正式操作。
    const operationId = crypto.randomUUID();
    const receipt = { operationId, capabilityId: CAPABILITY, status: 'completed', auditIds: [42], completedAt: new Date().toISOString() };
    h.db.prepare(`INSERT INTO api_operations(operation_id,capability_id,actor_key,idempotency_key,request_hash,request_id,status,response_json,created_at,completed_at,expires_at)
VALUES(?,?,?,?,?,NULL,'completed',?,?,?,?)`).run(operationId, CAPABILITY, 'internal', task.spec.writeV1.idempotencyKey, 'hash', JSON.stringify(receipt), receipt.completedAt, receipt.completedAt, new Date(Date.now() + 60000).toISOString());

    const reconcile = await call(h, `/api/ai/tasks/${h.taskKey}/write-reconcile`, { body: {}, cookie: ownerCookie() });
    assert.equal(reconcile.status, 200);
    assert.equal(reconcile.data.resolved, true);
    assert.equal(reconcile.data.status, 'COMPLETED');
    assert.equal(reconcile.data.outcome.verified, true);
    assert.equal(reconcile.data.outcome.stock, 200);
    task = taskState(h);
    assert.equal(task.state, 'SUCCEEDED');
    assert.equal(task.spec.writeV1.phase, 'VERIFIED');
    assert.equal(task.spec.writeV1.verification.stock, 200);
    assert.equal(h.state.writes, 1, '对账只能基于既有提交，不能再写一次');
    assert.equal(h.state.readbacks, 1, '对账必须做独立回读核验');
});

test('W1-SCOPE-4 通过路由请求非 W1 能力（线圈/价格/删除/配方）一律拒绝且零写入', async t => {
    const h = await harness(); t.after(() => h.server.close());
    const cases = [
        { toolName: 'adjust_coil_stock', args: { items: [{ model: '12-120', changeQty: 5 }] }, expected: 'NATIVE_WRITE_CAPABILITY_UNSUPPORTED' },
        { toolName: 'batch_update_prices', args: { category: '轴承', percentChange: 5 }, expected: 'NATIVE_WRITE_CAPABILITY_UNSUPPORTED' },
        { toolName: 'delete_part', args: { model: MODEL }, expected: 'NATIVE_WRITE_CAPABILITY_UNSUPPORTED' },
        { toolName: 'update_recipe', args: { recipeName: 'X' }, expected: 'NATIVE_WRITE_CAPABILITY_UNSUPPORTED' },
        { toolName: 'adjust_part_stock', args: { items: [{ model: 'A', changeQty: 1 }, { model: 'B', changeQty: 1 }] }, expected: 'NATIVE_WRITE_SINGLE_TARGET_REQUIRED' },
    ];
    for (const item of cases) {
        const result = await call(h, `/api/ai/tasks/${h.taskKey}/write-preview`, {
            body: previewBody({ toolName: item.toolName, args: item.args }), cookie: ownerCookie(),
        });
        assert.ok(result.status >= 400, `${item.toolName} 必须被拒绝`);
        assert.equal(result.body.code, item.expected, `${item.toolName} 错误码`);
    }
    assert.equal(h.state.writes, 0);
});
