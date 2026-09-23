'use strict';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'ai-task-routes-test-secret';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const Database = require('better-sqlite3');
const { AI_TASK_PERSISTENCE_SCHEMA_SQL } = require('../api/database/schema.cjs');
const { createAiTaskRouterV2 } = require('../api/routes/ai/tasks.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function accessors(db) { return { db,
    safeInsert(table, values) { const keys = Object.keys(values).filter(key => values[key] !== undefined); return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => values[key])); },
    safeUpdate(table, id, values) { const keys = Object.keys(values).filter(key => values[key] !== undefined); return db.prepare(`UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(',')}, updated_at=? WHERE id=?`).run(...keys.map(key => values[key]), new Date().toISOString(), id); },
}; }
async function setup() {
    const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
    db.exec(`CREATE TABLE ai_conversations (id INTEGER PRIMARY KEY, owner_key TEXT NOT NULL, deleted_at TEXT); CREATE TABLE ai_conversation_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL); ${AI_TASK_PERSISTENCE_SCHEMA_SQL}`);
    db.prepare('INSERT INTO ai_conversations VALUES(1,?,NULL)').run('owner');
    db.prepare('INSERT INTO ai_conversation_messages VALUES(1,1,?,?)').run('user', 'V550现在成本多少');
    const app = express(); app.use(express.json());
    app.use(createAiTaskRouterV2({ dbAccessors: accessors(db), auth: (req, _res, next) => { req.aiTaskOwner = 'owner'; next(); } }));
    const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { db, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(() => { db.close(); resolve(); })) };
}
async function request(runtime, path, options = {}) { const response = await fetch(`${runtime.url}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } }); return { status: response.status, body: await response.json() }; }

test('N5.2 task routes create owner-bound DETACHED task and only expose public projection', async t => {
    const runtime = await setup(); t.after(runtime.close);
    const start = await request(runtime, '/api/ai/tasks', { method: 'POST', headers: { 'idempotency-key': 'n52-task-start-0001' }, body: JSON.stringify({ version: 1, conversationId: 'chat-1', userMessageId: 1, executionMode: 'DETACHED' }) });
    assert.equal(start.status, 202, JSON.stringify(start.body)); assert.equal(start.body.data.executionMode, 'DETACHED');
    const replay = await request(runtime, '/api/ai/tasks', { method: 'POST', headers: { 'idempotency-key': 'n52-task-start-0001' }, body: JSON.stringify({ version: 1, conversationId: 'chat-1', userMessageId: 1, executionMode: 'DETACHED' }) });
    assert.equal(replay.status, 200, JSON.stringify(replay.body)); assert.equal(replay.body.data.taskId, start.body.data.taskId);
    const view = await request(runtime, start.body.data.statusPath);
    assert.equal(view.status, 200); assert.equal(view.body.data.goals.length, 1);
    const serialized = JSON.stringify(view.body.data);
    for (const forbidden of ['ownerKey', 'lease', 'arguments', 'receipt', 'budgetUsage', 'allowWrite']) assert.equal(serialized.includes(forbidden), false);
    const events = await request(runtime, `${start.body.data.statusPath}/events?afterSeq=0&limit=50`);
    assert.equal(events.status, 200); assert.equal(events.body.data.events.length, 1);
    const cancel = await request(runtime, `${start.body.data.statusPath}/cancel`, { method: 'POST', headers: { 'idempotency-key': 'n52-task-cancel-0001' }, body: JSON.stringify({ version: 1, expectedRevision: view.body.data.revision, reason: '停止' }) });
    assert.equal(cancel.status, 200); assert.equal(cancel.body.data.state, 'CANCELLED');
});

test('N5.2 rejects untrusted task inputs and owner-mismatched source message without task writes', async t => {
    const runtime = await setup(); t.after(runtime.close);
    const invalid = await request(runtime, '/api/ai/tasks', { method: 'POST', headers: { 'idempotency-key': 'n52-task-invalid-01' }, body: JSON.stringify({ version: 1, conversationId: 'chat-1', userMessageId: 1, executionMode: 'DETACHED', ownerKey: 'attacker' }) });
    assert.equal(invalid.status, 400);
    const missing = await request(runtime, '/api/ai/tasks', { method: 'POST', headers: { 'idempotency-key': 'n52-task-missing-01' }, body: JSON.stringify({ version: 1, conversationId: 'chat-1', userMessageId: 99, executionMode: 'DETACHED' }) });
    assert.equal(missing.status, 404, JSON.stringify(missing.body)); assert.equal(runtime.db.prepare('SELECT COUNT(*) count FROM ai_tasks').get().count, 0);
});

test('N5.2 resume enforces revision and bound clarification choices', async t => {
    const runtime = await setup(); t.after(runtime.close);
    const now = new Date(Date.now() + 60_000).toISOString();
    const taskId = crypto.randomUUID(); const body = 'V550现在成本多少';
    const spec = { version: 2, answerOwner: 'TASK_V2', userGoal: body, businessWritePolicy: 'FORBIDDEN', subjects: [], goals: [{ goalKey: 'cost', kind: 'CURRENT_COST', description: '查询当前成本', subjectKeys: [], scenarioKeys: [], dependsOn: [], state: 'NEEDS_INPUT', factIds: [], blockers: [{ code: 'CHOICE', message: '请选择', questionId: crypto.randomUUID() }], requirements: [] }], scenarios: [], questions: [], approvalOperationIds: [], recovery: { version: 1, proposal: { version: 1, goalSummary: body, subjects: [], scenarios: [], goals: [{ goalKey: 'cost', kind: 'CURRENT_COST', description: '查询当前成本', subjectKeys: [], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [{ messageRef: 'msg:durable:1', start: 0, end: body.length, text: body }], quantity: null, unitPrice: null }], unparsedSpans: [] }, sourceMessageIds: { 'msg:durable:1': 1 }, pending: null, activeMsBase: 0 } };
    const questionId = spec.goals[0].blockers[0].questionId; spec.questions.push({ questionId, planRevision: 1, goalKeys: ['cost'], prompt: '请选择', reasonCode: 'CHOICE', choices: [{ choiceId: 'choice_1', label: 'V550', entity: { entityType: 'recipe', entityId: '1', displayName: 'V550', updatedAt: null, recordHash: null, schemeCode: null } }], candidateSetHash: hash('[]'), expiresAt: now, answeredAt: null });
    runtime.db.prepare(`INSERT INTO ai_tasks (task_key,owner_key,conversation_id,user_message_id,schema_version,revision,plan_revision,state,execution_mode,input_hash,spec_json,budget_json,result_json,lease_owner,lease_token,lease_expires_at,cancel_requested_at,created_at,updated_at,expires_at) VALUES (?,?,?,?,2,1,1,'WAITING_INPUT','DETACHED',?,?,?,NULL,NULL,NULL,NULL,NULL,?,?,?)`).run(taskId, 'owner', 1, 1, hash(body), JSON.stringify(spec), JSON.stringify({ limits: { maxModelCalls: 7, maxToolCalls: 10, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 32, maxActiveMs: 60000 }, usage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 } }), new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());
    const bad = await request(runtime, `/api/ai/tasks/${taskId}/resume`, { method: 'POST', headers: { 'idempotency-key': 'n52-task-resume-01' }, body: JSON.stringify({ version: 1, expectedRevision: 1, answers: [{ questionId, choiceId: 'choice_x', answerText: null }], executionMode: 'DETACHED' }) });
    assert.equal(bad.status, 409);
});

test('N5.2 resume only accepts answer text rebound to a durable owner conversation user message', async t => {
    const runtime = await setup(); t.after(runtime.close);
    const now = new Date(Date.now() + 60_000).toISOString();
    const taskId = crypto.randomUUID(); const body = 'V550毛利多少'; const questionId = crypto.randomUUID();
    const spec = { version: 2, answerOwner: 'TASK_V2', userGoal: body, businessWritePolicy: 'FORBIDDEN', subjects: [], goals: [{ goalKey: 'profit', kind: 'PROFITABILITY', description: '毛利', subjectKeys: [], scenarioKeys: [], dependsOn: [], state: 'NEEDS_INPUT', factIds: [], blockers: [{ code: 'PRICE', message: '需要售价', questionId }], requirements: [] }], scenarios: [], questions: [{ questionId, planRevision: 1, goalKeys: ['profit'], prompt: '请提供销售单价', reasonCode: 'PROFITABILITY_UNIT_PRICE_REQUIRED', choices: [], candidateSetHash: hash('[]'), expiresAt: now, answeredAt: null }], approvalOperationIds: [], recovery: { version: 1, proposal: { version: 1, goalSummary: body, subjects: [], scenarios: [], goals: [{ goalKey: 'profit', kind: 'PROFITABILITY', description: '毛利', subjectKeys: [], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [{ messageRef: 'msg:durable:1', start: 0, end: body.length, text: body }], quantity: null, unitPrice: null }], unparsedSpans: [] }, sourceMessageIds: { 'msg:durable:1': 1 }, pending: { kind: 'profitPrice', questionId }, activeMsBase: 0 } };
    runtime.db.prepare(`INSERT INTO ai_tasks (task_key,owner_key,conversation_id,user_message_id,schema_version,revision,plan_revision,state,execution_mode,input_hash,spec_json,budget_json,result_json,lease_owner,lease_token,lease_expires_at,cancel_requested_at,created_at,updated_at,expires_at) VALUES (?,?,?,?,2,1,1,'WAITING_INPUT','DETACHED',?,?,?,NULL,NULL,NULL,NULL,NULL,?,?,?)`).run(taskId, 'owner', 1, 1, hash(body), JSON.stringify(spec), JSON.stringify({ limits: { maxModelCalls: 7, maxToolCalls: 10, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 32, maxActiveMs: 60000 }, usage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 } }), new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 86400000).toISOString());
    const payload = { version: 1, expectedRevision: 1, answers: [{ questionId, choiceId: null, answerText: '卖340元一台' }], executionMode: 'DETACHED' };
    const missing = await request(runtime, `/api/ai/tasks/${taskId}/resume`, { method: 'POST', headers: { 'idempotency-key': 'n52-task-resume-source-missing' }, body: JSON.stringify(payload) });
    assert.equal(missing.status, 409);
    runtime.db.prepare('INSERT INTO ai_conversation_messages VALUES(2,1,?,?)').run('user', '卖340元一台');
    const resumed = await request(runtime, `/api/ai/tasks/${taskId}/resume`, { method: 'POST', headers: { 'idempotency-key': 'n52-task-resume-source-ok' }, body: JSON.stringify(payload) });
    assert.equal(resumed.status, 202, JSON.stringify(resumed.body));
    const stored = JSON.parse(runtime.db.prepare('SELECT spec_json FROM ai_tasks WHERE task_key=?').get(taskId).spec_json);
    assert.equal(stored.recovery.sourceMessageIds['msg:durable:2'], 2);
    assert.equal(stored.recovery.pending.resume.answers[0].messageRef, 'msg:durable:2');
    assert.equal(stored.questions[0].answeredAt !== null, true);
});

test('N7.1 write kill switch rejects Native write preview before any task mutation', async t => {
    const runtime = await setup(); t.after(runtime.close);
    const start = await request(runtime, '/api/ai/tasks', { method: 'POST', headers: { 'idempotency-key': 'n71-write-disabled-start' }, body: JSON.stringify({ version: 1, conversationId: 'chat-1', userMessageId: 1, executionMode: 'DETACHED' }) });
    assert.equal(start.status, 202, JSON.stringify(start.body));
    // The endpoint-level guard reads only the server-owned environment/policy;
    // this request cannot use its payload to grant write permission.
    const blocked = await request(runtime, `${start.body.data.statusPath}/write-preview`, { method: 'POST', body: JSON.stringify({ allowWrite: true, version: 1 }) });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'AI_NATIVE_WRITE_DISABLED');
    assert.equal(runtime.db.prepare('SELECT COUNT(*) count FROM ai_task_steps').get().count, 0);
});
