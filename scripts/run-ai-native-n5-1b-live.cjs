'use strict';
// N5.1B live acceptance: real DeepSeek candidate extraction, current formal
// read-only runtime, and an isolated SQLite task store. Raw payloads remain
// gitignored under logs/.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const dotenv = require('dotenv');
const { AI_TASK_PERSISTENCE_SCHEMA_SQL } = require('../api/database/schema.cjs');
const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
const { createAiTaskLifecycleV2 } = require('../api/services/aiTaskLifecycleV2.cjs');
const { createAiTaskWorkerV2, createAiTaskControllerContinuationV2 } = require('../api/services/aiTaskWorkerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { startAiHttpRuntime } = require('../tests/helpers/ontologyHttpRuntimeFixture.cjs');
const { configureFixture: configureN42cFixture } = require('./run-ai-native-n4-2c-live.cjs');
const root = path.resolve(__dirname, '..'); dotenv.config({ path: path.join(root, '.env'), quiet: true });
const rawPath = path.join(root, 'logs', 'ai-native-n5-1b-live-raw.json');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const uuid = () => crypto.randomUUID();
const instruction = 'Return a TaskProposalV1 candidate by calling the one supplied function exactly once. Preserve every explicit goal, condition, quantity, price and no-save instruction. Never invent identity, receipts, completion, authorization, write policy, or business results.';
function accessors(db) { return { db, safeInsert(table, values) { const keys = Object.keys(values).filter(key => values[key] !== undefined); return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => values[key])); }, safeUpdate(table, id, values) { const keys = Object.keys(values).filter(key => values[key] !== undefined); return db.prepare(`UPDATE ${table} SET ${keys.map(key => `${key}=?`).join(',')},updated_at=? WHERE id=?`).run(...keys.map(key => values[key]), new Date().toISOString(), id); } }; }
function configureFixture(db) { configureN42cFixture(db, { scenario: 'cable', readiness: 'READY' }); }
function provider(config, raw, tag) { return async request => { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120000); try { const response = await fetch(`${config.baseUrl}/chat/completions`, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, thinking: { type: 'disabled' }, temperature: 0, messages: [{ role: 'system', content: instruction }, ...request.messages], tools: request.tools, tool_choice: request.toolChoice, stream: false }) }); if (!response.ok) throw Object.assign(new Error(`DEEPSEEK_HTTP_${response.status}`), { code: `DEEPSEEK_HTTP_${response.status}` }); const payload = await response.json(); raw.push({ tag, model: payload.model || config.model, payload }); fs.mkdirSync(path.dirname(rawPath), { recursive: true }); fs.writeFileSync(rawPath, JSON.stringify(raw)); return { ...payload, provider: 'deepseek', model: payload.model || config.model }; } finally { clearTimeout(timer); } }; }
function makeTask(taskId, ownerKey, text) { return { version: 2, taskId, parentTaskId: null, ownerKey, conversationId: `live:${taskId}`, requestId: taskId, revision: 1, planRevision: 1, state: 'NEW', answerOwner: 'TASK_V2', executionMode: 'DETACHED', userGoal: text, inputHash: hash(text), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), constraints: { businessWritePolicy: 'FORBIDDEN', maxModelCalls: 7, maxToolCalls: 10, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 32, maxActiveMs: 900000 }, subjects: [], goals: [{ goalKey: 'initial', kind: 'OTHER', description: 'pending semantic extraction', subjectKeys: [], scenarioKeys: [], dependsOn: [], state: 'PENDING', factIds: [], blockers: [], requirements: [] }], scenarios: [], steps: [], facts: [], questions: [], approvalOperationIds: [], resultSummary: null, budgetUsage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 } }; }
async function main() {
    const config = resolveProviderConfig('deepseek', process.env); if (!config.apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const runtime = await startAiHttpRuntime(); const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51b-live-')), 'tasks.db'); const db = new Database(file); const raw = []; const runs = [];
    try {
        configureFixture(runtime.db); db.exec(`CREATE TABLE ai_conversations (id INTEGER PRIMARY KEY, owner_key TEXT NOT NULL, deleted_at TEXT); CREATE TABLE ai_conversation_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL); ${AI_TASK_PERSISTENCE_SCHEMA_SQL}`);
        const lifecycle = createAiTaskLifecycleV2({ dbAccessors: accessors(db) });
        const families = [['current-cost', 'V550现在成本多少？'], ['four-goal', 'V550电缆改5米以后，卖340毛利多少，做300台库存够不够，先不要保存。']];
        for (let round = 1; round <= 2; round += 1) for (const [family, text] of families) {
            const owner = `n51b-live-${round}-${family}`; const taskId = uuid(); db.prepare('INSERT INTO ai_conversations(id,owner_key,deleted_at) VALUES(?,?,NULL)').run(runs.length + 1, owner); db.prepare('INSERT INTO ai_conversation_messages(id,conversation_id,role,content) VALUES(?,?,?,?)').run(runs.length + 1, runs.length + 1, 'user', text);
            const task = makeTask(taskId, owner, text); lifecycle.createTask({ ownerKey: owner, conversationId: runs.length + 1, userMessageId: runs.length + 1, taskKey: taskId, task, expiresAt: '2026-10-22T00:00:00.000Z' });
            const continuation = createAiTaskControllerContinuationV2({ lifecycle, inputForTask: () => ({ ownerKey: owner, requestId: taskId, conversationId: `live:${taskId}`, messages: [{ role: 'user', content: text }] }), dependencies: { provider: provider(config, raw, `${round}:${family}`), sessionStore: createTaskSessionStoreV2() } });
            const started = Date.now(); const worker = createAiTaskWorkerV2({ lifecycle, runtime: continuation }); const outcome = await worker.runOnce(); const persisted = lifecycle.store.getTaskByKey(taskId); const evidence = lifecycle.store.loadValidatedEvidence(taskId);
            runs.push({ family, round, outcome: outcome.outcome, state: persisted.state, leaseReleased: persisted.lease === null, goals: persisted.spec.goals.map(goal => ({ kind: goal.kind, state: goal.state })), budget: persisted.budget.usage, steps: lifecycle.store.listSteps(taskId).length, receipts: evidence.receipts.size, facts: evidence.facts.size, durationMs: Date.now() - started });
        }
        const errors = runs.filter(run => run.outcome !== 'COMPLETED' || run.state !== 'SUCCEEDED' || !run.leaseReleased || run.steps < 1 || run.receipts < 1 || run.facts < 1).map(run => `${run.round}:${run.family}`);
        process.stdout.write(`${JSON.stringify({ ticket: 'N5.1B', requestedProvider: 'deepseek', actualProvider: 'deepseek', model: config.model, fallbackCount: 0, runs, errors, taskRuntimeDbWrites: true, businessWrites: 0, commandExecutions: 0, database: 'temporary SQLite fixtures' }, null, 2)}\n`);
        if (errors.length) process.exitCode = 2;
    } finally { db.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true }); await runtime.close(); }
}
main().catch(error => { process.stderr.write(`N5_1B_LIVE_FAILED ${error.code || error.message}\n`); process.exitCode = 2; });
