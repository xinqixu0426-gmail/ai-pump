'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { AI_TASK_PERSISTENCE_SCHEMA_SQL } = require('../api/database/schema.cjs');
const { createAiTaskLifecycleV2 } = require('../api/services/aiTaskLifecycleV2.cjs');
const { createAiTaskWorkerV2, createAiTaskControllerContinuationV2 } = require('../api/services/aiTaskWorkerV2.cjs');
const { stableHash } = require('../api/services/aiTaskContractV2.cjs');
const { createAiTaskRecoveryV2 } = require('../api/services/aiTaskRecoveryV2.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const key = () => crypto.randomUUID();
function accessors(db, clock) {
    return { db,
        safeInsert(table, values) { const keys = Object.keys(values).filter(name => values[name] !== undefined); return db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(name => values[name])); },
        safeUpdate(table, id, values) { const keys = Object.keys(values).filter(name => values[name] !== undefined); return db.prepare(`UPDATE ${table} SET ${keys.map(name => `${name}=?`).join(',')}, updated_at=? WHERE id=?`).run(...keys.map(name => values[name]), new Date(clock()).toISOString(), id); },
    };
}
function makeDb(filename = ':memory:') {
    const db = new Database(filename); db.pragma('foreign_keys=ON');
    db.exec(`CREATE TABLE ai_conversations (id INTEGER PRIMARY KEY, owner_key TEXT NOT NULL, deleted_at TEXT); CREATE TABLE ai_conversation_messages (id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL); ${AI_TASK_PERSISTENCE_SCHEMA_SQL}`);
    db.prepare('INSERT INTO ai_conversations VALUES(1,?,NULL)').run('owner');
    db.prepare('INSERT INTO ai_conversation_messages VALUES(1,1,?,?)').run('user', 'V550现在成本多少');
    return db;
}
function envelope(taskId, overrides = {}) {
    const content = 'V550现在成本多少';
    return { version: 2, taskId, parentTaskId: null, ownerKey: 'owner', conversationId: 'c', requestId: key(), revision: 1, planRevision: 1, state: 'NEW', answerOwner: 'TASK_V2', executionMode: 'DETACHED', userGoal: content, inputHash: hash(content), createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', constraints: { businessWritePolicy: 'FORBIDDEN', maxModelCalls: 7, maxToolCalls: 10, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 32, maxActiveMs: 60000 }, subjects: [], goals: [{ goalKey: 'cost', kind: 'CURRENT_COST', description: 'cost', subjectKeys: [], scenarioKeys: [], dependsOn: [], state: 'PENDING', factIds: [], blockers: [], requirements: [] }], scenarios: [], steps: [], facts: [], questions: [], approvalOperationIds: [], resultSummary: null, budgetUsage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 }, ...overrides };
}
function setup({ filename = ':memory:', at = Date.parse('2026-09-22T00:00:00.000Z') } = {}) {
    let time = at; const db = makeDb(filename); const lifecycle = createAiTaskLifecycleV2({ dbAccessors: accessors(db, () => time), clock: () => time });
    function create(input = {}) { const task = envelope(input.taskId || key(), input); return lifecycle.createTask({ ownerKey: 'owner', conversationId: 1, userMessageId: 1, taskKey: task.taskId, task, expiresAt: '2026-10-22T00:00:00.000Z' }); }
    return { db, lifecycle, create, advance(ms) { time += ms; }, now: () => time };
}
function worker(lifecycle, runtime, options = {}) { return createAiTaskWorkerV2({ ...options, lifecycle, runtime, workerId: options.workerId || key(), leaseDurationMs: options.leaseDurationMs || 20, leaseRenewIntervalMs: options.leaseRenewIntervalMs || 5, pollIntervalMs: 1000 }); }

function verified(data, extra = {}) {
    return { success: true, data, ...extra, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/formal' }] } };
}
function fourGoalExecutor() {
    const calls = [];
    const execute = async (toolName, args) => {
        calls.push({ toolName, args: structuredClone(args) });
        if (toolName === 'get_all_recipes') return verified([{ id: 301, name: 'V550' }], { queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false } });
        if (toolName === 'compare_recipe_scenarios') return verified({ recipe: { id: 301, name: 'V550' }, scenarios: [{ scenarioKey: 'current_check', configurationHash: 'base-configuration', cost: { complete: true, currentTotalCost: 108.5 }, appliedOverrides: {}, notApplied: [] }], comparisons: [], readSetId: key() });
        if (toolName === 'preview_profitability') {
            const scenario = args.basisRef.comparisonInput.scenarios[0];
            const base = { scenarioKey: 'base', configurationHash: 'base-configuration', cost: { complete: true, currentTotalCost: 108.5 }, appliedOverrides: {}, notApplied: [] };
            const candidate = { scenarioKey: scenario.scenarioKey, configurationHash: 'candidate-configuration', cost: { complete: true, currentTotalCost: 116.5 }, appliedOverrides: scenario.overrides, notApplied: [] };
            return verified({ preview: true, profitabilityId: key(), recipe: { id: 301, name: 'V550' }, scenarioKey: args.basisRef.scenarioKey, configurationHash: 'candidate-configuration', unitCost: 116.5, unitPrice: args.unitPrice, grossProfitPerUnit: args.unitPrice - 116.5, grossMarginOnSales: (args.unitPrice - 116.5) / args.unitPrice, markupOnCost: (args.unitPrice - 116.5) / 116.5, quantity: args.quantity, totalCost: null, totalRevenue: null, totalGrossProfit: null, costComplete: true, costBasis: 'CURRENT_REBUILT', currency: 'CNY', readSetId: key(), readSetHash: 'a'.repeat(64), calculatedAt: new Date().toISOString(), warnings: [], scenarioContext: { scenarios: [base, candidate], comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: scenario.scenarioKey, status: 'COMPARABLE', delta: 8, currency: 'CNY' }] } });
        }
        if (toolName === 'preview_virtual_readiness') return verified({ version: 1, preview: true, readinessId: key(), recipe: { id: 301, name: 'V550' }, scenarioKey: args.basisRef.scenarioKey, configurationHash: 'candidate-configuration', quantity: args.quantity, inventoryBasis: 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS', status: 'READY', readSetId: key(), readSetHash: 'b'.repeat(64), sourceVersions: [], sourceVersionCount: 0, sourceVersionsComplete: true, coverage: { requirementCount: 1, evaluatedCount: 1, shortageCount: 0, unresolvedCount: 0, excludedCount: 0, complete: true }, requirements: [], shortages: [], unresolvedRequirements: [], excludedRequirements: [], calculatedAt: new Date().toISOString(), warnings: [] });
        throw new Error(`unexpected tool ${toolName}`);
    };
    return { calls, execute };
}
function continuation(lifecycle, db, execute, text, options = {}) {
    return createAiTaskControllerContinuationV2({ lifecycle, db, clock: options.clock,
        inputForTask: task => ({ ownerKey: 'owner', requestId: task.taskKey, conversationId: `detached:${task.taskKey}`, messages: [{ role: 'user', content: text }] }),
        dependencies: { executeToolCall: execute, sessionStore: require('../api/services/aiTaskSessionV2.cjs').createTaskSessionStoreV2() },
        afterProgress: options.afterProgress,
        afterDispatch: options.afterDispatch,
    });
}

test('N5.1B claims only one eligible DETACHED task and never preclaims a queue', async () => {
    const fixture = setup(); const a = fixture.create(); const b = fixture.create();
    const calls = []; const w = worker(fixture.lifecycle, async context => { calls.push(context.task.taskKey); return { state: 'SUSPENDED' }; });
    await w.runOnce();
    assert.equal(calls.length, 1); assert.equal(fixture.lifecycle.store.getTaskByKey(a.taskKey).lease, null); assert.equal(fixture.lifecycle.store.getTaskByKey(b.taskKey).lease, null);
    const emptyFixture = setup(); const before = emptyFixture.db.prepare('SELECT COUNT(*) count FROM ai_task_events').get().count;
    const empty = await worker(emptyFixture.lifecycle, async () => ({ state: 'SUSPENDED' })).runOnce();
    assert.equal(empty.outcome, 'LEASE_NOT_ACQUIRED'); assert.equal(emptyFixture.db.prepare('SELECT COUNT(*) count FROM ai_task_events').get().count, before);
    const foregroundFixture = setup(); foregroundFixture.create({ executionMode: 'FOREGROUND' }); foregroundFixture.create({ state: 'WAITING_INPUT' });
    assert.equal((await worker(foregroundFixture.lifecycle, async () => ({ state: 'SUSPENDED' })).runOnce()).outcome, 'LEASE_NOT_ACQUIRED');
    fixture.db.close(); emptyFixture.db.close(); foregroundFixture.db.close();
});

test('N5.1B two independent connections elect exactly one lease winner and rotate tokens', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51b-race-')); const filename = path.join(root, 'task.db'); const first = setup({ filename }); first.create(); first.db.close();
    const dbA = new Database(filename); dbA.pragma('foreign_keys=ON'); const aLife = createAiTaskLifecycleV2({ dbAccessors: accessors(dbA, first.now), clock: first.now }); const bDb = new Database(filename); bDb.pragma('foreign_keys=ON'); const bLife = createAiTaskLifecycleV2({ dbAccessors: accessors(bDb, first.now), clock: first.now });
    const left = aLife.store.claimNextDetachedTask({ workerId: 'A', leaseDurationMs: 20 }); const right = bLife.store.claimNextDetachedTask({ workerId: 'B', leaseDurationMs: 20 });
    assert.deepEqual([left.outcome, right.outcome].sort(), ['LEASE_ACQUIRED', 'LEASE_NOT_ACQUIRED']); const winner = left.task || right.task; const oldToken = winner.lease.token;
    first.advance(21); aLife.store.recoverExpiredLeases(); const again = aLife.store.claimNextDetachedTask({ workerId: winner.lease.owner, leaseDurationMs: 20 });
    assert.equal(again.outcome, 'LEASE_ACQUIRED'); assert.notEqual(again.task.lease.token, oldToken); assert.equal(again.task.planRevision, 1);
    dbA.close(); bDb.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1B fences stale lease renew, release, state write, and delayed result', async () => {
    const fixture = setup(); const task = fixture.create(); let resolveSlow; let oldLease; const slow = new Promise(resolve => { resolveSlow = resolve; });
    const a = worker(fixture.lifecycle, async context => { oldLease = { workerId: context.workerId, leaseToken: context.task.lease.token }; context.beforeToolCall(); await slow; context.afterToolCall(); return { state: 'SUSPENDED', result: { source: 'old' } }; }, { workerId: 'A', leaseDurationMs: 20, leaseRenewIntervalMs: 1000 });
    const running = a.runOnce(); await new Promise(resolve => setImmediate(resolve)); fixture.advance(21); fixture.lifecycle.store.recoverExpiredLeases();
    const bClaim = fixture.lifecycle.store.claimNextDetachedTask({ workerId: 'B', leaseDurationMs: 20 }); assert.equal(bClaim.outcome, 'LEASE_ACQUIRED');
    const old = fixture.lifecycle.store.listEvents(task.taskKey).find(event => event.eventType === 'LEASE_ACQUIRED'); assert.ok(old);
    assert.equal(fixture.lifecycle.store.renewLease(task.taskKey, 'A', oldLease.leaseToken, { leaseDurationMs: 20 }).outcome, 'LEASE_FENCED'); assert.equal(fixture.lifecycle.store.releaseLease(task.taskKey, 'A', oldLease.leaseToken).outcome, 'LEASE_FENCED');
    const currentBefore = fixture.lifecycle.store.getTaskByKey(task.taskKey);
    const staleStep = { stepId: key(), goalKeys: ['cost'], toolName: 'preview_recipe_cost', capabilityId: 'recipe.cost.preview', access: 'QUERY', arguments: {}, argumentSources: [], argsHash: stableHash({}), state: 'PLANNED', attempt: 1, startedAt: null, finishedAt: null, errorCode: null, planRevision: currentBefore.planRevision };
    assert.throws(() => fixture.lifecycle.transitionLeased(task.taskKey, currentBefore.revision, oldLease, { state: 'RESOLVING' }), error => error.code === 'LEASE_FENCED');
    assert.throws(() => fixture.lifecycle.appendPlannedStepLeased(task.taskKey, currentBefore.revision, oldLease, staleStep), error => error.code === 'LEASE_FENCED');
    assert.throws(() => fixture.lifecycle.appendReceiptLeased(task.taskKey, currentBefore.revision, oldLease, { evidenceKey: key(), planRevision: 1, payload: {}, sourceHash: 'a'.repeat(64), observedAt: new Date(fixture.now()).toISOString() }), error => error.code === 'LEASE_FENCED');
    resolveSlow(); const result = await running; assert.equal(result.outcome, 'LEASE_FENCED');
    const current = fixture.lifecycle.store.getTaskByKey(task.taskKey); assert.equal(current.lease.owner, 'B'); assert.equal(current.result, null); fixture.lifecycle.store.releaseLease(task.taskKey, 'B', bClaim.task.lease.token); fixture.db.close();
});

test('N5.1B reserves budget before each call, counts failed calls, and ignores unsent validation failures', async () => {
    const fixture = setup(); const task = fixture.create(); const w = worker(fixture.lifecycle, async context => { context.beforeModelCall(); context.beforeToolCall(); throw Object.assign(new Error('network'), { code: 'NETWORK' }); });
    const result = await w.runOnce(); assert.equal(result.outcome, 'SUSPENDED'); const stored = fixture.lifecycle.store.getTaskByKey(task.taskKey); assert.deepEqual(stored.budget.usage, { modelCalls: 1, toolCalls: 1, apiCalls: 1, activeMs: 0 });
    const untouched = fixture.create(); const noSend = worker(fixture.lifecycle, async () => { throw Object.assign(new Error('args'), { code: 'ARGUMENTS_INVALID' }); }); await noSend.runOnce(); assert.deepEqual(fixture.lifecycle.store.getTaskByKey(untouched.taskKey).budget.usage, { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 }); fixture.db.close();
});

test('N5.1B recovers expired read tasks once, preserves foreground, and reconciles unknown command effects', () => {
    const fixture = setup(); const detached = fixture.create({ state: 'RUNNING' }); const foreground = fixture.create({ executionMode: 'FOREGROUND', state: 'RUNNING' }); const command = fixture.create({ state: 'RUNNING' });
    const expire = item => fixture.db.prepare('UPDATE ai_tasks SET lease_owner=?, lease_token=?, lease_expires_at=? WHERE task_key=?').run('dead', key(), new Date(fixture.now() - 1).toISOString(), item.taskKey);
    expire(detached); expire(foreground); expire(command);
    const row = fixture.lifecycle.store.getTaskByKey(command.taskKey);
    fixture.db.prepare("INSERT INTO ai_task_steps(step_key,task_id,plan_revision,sequence,capability_id,tool_name,goal_keys_json,access,args_json,args_hash,argument_sources_json,state,attempt,receipt_key,operation_id,idempotency_key,started_at,finished_at,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(key(), row.id, 1, 1, 'x', 'x', '[]', 'COMMAND', '{}', hash('{}'), '[]', 'RUNNING', 1, null, 'op-1', null, null, null, null, new Date(fixture.now()).toISOString(), new Date(fixture.now()).toISOString());
    const first = fixture.lifecycle.store.recoverExpiredLeases(); const second = fixture.lifecycle.store.recoverExpiredLeases();
    assert.equal(first.length, 3); assert.equal(second.length, 0); assert.equal(fixture.lifecycle.store.getTaskByKey(detached.taskKey).state, 'SUSPENDED'); assert.equal(fixture.lifecycle.store.getTaskByKey(foreground.taskKey).state, 'SUSPENDED'); assert.equal(fixture.lifecycle.store.getTaskByKey(command.taskKey).state, 'RECONCILING'); fixture.db.close();
});

test('N5.1B releases WAITING_INPUT and cancellation never spins or executes a command', async () => {
    const fixture = setup(); const waiting = fixture.create(); const w = worker(fixture.lifecycle, async () => ({ state: 'WAITING_INPUT' })); const first = await w.runOnce(); const events = fixture.lifecycle.store.listEvents(waiting.taskKey).length; await w.runOnce();
    assert.equal(first.task.state, 'WAITING_INPUT'); assert.equal(fixture.lifecycle.store.getTaskByKey(waiting.taskKey).lease, null); assert.equal(fixture.lifecycle.store.listEvents(waiting.taskKey).length, events);
    const cancelled = fixture.create(); fixture.lifecycle.store.requestCancel(cancelled.taskKey, 1); const stop = await worker(fixture.lifecycle, async () => { throw new Error('must not run'); }).runOnce(); assert.equal(stop.outcome, 'CANCELLED'); assert.equal(fixture.lifecycle.store.getTaskByKey(cancelled.taskKey).state, 'CANCELLED'); fixture.db.close();
});

test('N5.1B slow remote execution holds no SQLite write transaction and renews its lease', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51b-slow-')); const filename = path.join(root, 'task.db'); const fixture = setup({ filename }); fixture.create(); const reader = new Database(filename, { readonly: true });
    let release; const slow = new Promise(resolve => { release = resolve; }); const w = worker(fixture.lifecycle, async () => { await slow; return { state: 'SUSPENDED' }; }, { leaseRenewIntervalMs: 1, leaseDurationMs: 30 });
    const pending = w.runOnce(); await new Promise(resolve => setTimeout(resolve, 8)); assert.equal(reader.prepare('SELECT COUNT(*) count FROM ai_tasks').get().count, 1); release(); await pending; assert.ok(w.telemetry().renewals > 0); reader.close(); fixture.db.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1B drives the existing controller through the leased continuation and persists its read-only evidence', async () => {
    const fixture = setup(); const stored = fixture.create(); const calls = [];
    const execute = async toolName => {
        calls.push(toolName);
        if (toolName === 'get_all_recipes') return {
            success: true, data: [{ id: 301, name: 'V550' }],
            queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false },
            executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/recipes' }] },
        };
        if (toolName === 'preview_recipe_cost') return {
            success: true, data: { recipeId: 301, recipeName: 'V550', currentTotalCost: 108.5, pricingComplete: true },
            executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/recipes/301/cost-preview' }] },
        };
        if (toolName === 'compare_recipe_scenarios') return {
            success: true, data: { recipe: { id: 301, name: 'V550' }, scenarios: [{ scenarioKey: 'base', configurationHash: 'base', cost: { complete: true, currentTotalCost: 108.5 }, appliedOverrides: {}, notApplied: [] }], comparisons: [], readSetId: key() },
            executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/recipes/301/cost-preview' }] },
        };
        throw new Error(`unexpected ${toolName}`);
    };
    const { createAiTaskControllerContinuationV2 } = require('../api/services/aiTaskWorkerV2.cjs');
    const continuation = createAiTaskControllerContinuationV2({
        lifecycle: fixture.lifecycle,
        inputForTask: task => ({ ownerKey: 'owner', requestId: task.taskKey, conversationId: `detached:${task.taskKey}`, messages: [{ role: 'user', content: 'V550现在成本多少' }] }),
        dependencies: { executeToolCall: execute, sessionStore: require('../api/services/aiTaskSessionV2.cjs').createTaskSessionStoreV2() },
    });
    const result = await worker(fixture.lifecycle, continuation).runOnce();
    const recovered = fixture.lifecycle.store.loadValidatedEvidence(stored.taskKey);
    assert.equal(result.outcome, 'COMPLETED', result.errorCode); assert.equal(recovered.task.state, 'SUCCEEDED');
    assert.equal(recovered.task.lease, null); assert.deepEqual(calls, ['get_all_recipes', 'compare_recipe_scenarios']);
    assert.equal(recovered.task.budget.usage.toolCalls, 2); assert.equal(recovered.task.budget.usage.apiCalls, 2);
    assert.ok(fixture.lifecycle.store.listSteps(stored.taskKey).every(item => item.state === 'SUCCEEDED'));
    assert.ok(recovered.receipts.size >= 2); assert.ok(recovered.facts.size >= 1); fixture.db.close();
});


test('N5.1B-R1 rehydrates an owner-bound durable task without a model call and fails closed on source drift', () => {
    const fixture = setup(); const created = fixture.create({ state: 'SUSPENDED' });
    const recovery = createAiTaskRecoveryV2({ lifecycle: fixture.lifecycle, db: fixture.db, clock: fixture.now });
    const hydrated = recovery.rehydrate(created.taskKey);
    assert.equal(hydrated.task.taskKey, created.taskKey); assert.equal(hydrated.sourceMessages.get('msg:durable:1'), 'V550现在成本多少');
    assert.equal(hydrated.remainingActiveMs, 60000); assert.equal(hydrated.telemetry.recoveredSteps, 0);
    fixture.db.prepare('UPDATE ai_conversation_messages SET content=? WHERE id=1').run('消息被更改');
    assert.throws(() => recovery.rehydrate(created.taskKey), error => error.code === 'TASK_SOURCE_MESSAGE_CHANGED'); fixture.db.close();
});

test('N5.1B-R1 resumes a crashed detached controller from a fresh connection and reuses its succeeded read step', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51br1-restart-')); const filename = path.join(root, 'task.db');
    const first = setup({ filename }); const stored = first.create(); const calls = [];
    let crash = true;
    const execute = async toolName => {
        calls.push(toolName);
        if (toolName === 'get_all_recipes') return { success: true, data: [{ id: 301, name: 'V550' }], queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false }, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/recipes' }] } };
        if (toolName === 'compare_recipe_scenarios') {
            if (crash) { crash = false; throw Object.assign(new Error('crash after persisted read'), { code: 'CRASH' }); }
            return { success: true, data: { recipe: { id: 301, name: 'V550' }, scenarios: [{ scenarioKey: 'current_check', configurationHash: 'base', cost: { complete: true, currentTotalCost: 108.5 }, appliedOverrides: {}, notApplied: [] }], comparisons: [], readSetId: key() }, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/recipes/301/cost-preview' }] } };
        }
        throw new Error(`unexpected ${toolName}`);
    };
    const makeContinuation = (lifecycle, db) => createAiTaskControllerContinuationV2({ lifecycle, db, clock: first.now,
        inputForTask: task => ({ ownerKey: 'owner', requestId: task.taskKey, conversationId: `detached:${task.taskKey}`, messages: [{ role: 'user', content: 'V550现在成本多少' }] }),
        dependencies: { executeToolCall: execute, sessionStore: require('../api/services/aiTaskSessionV2.cjs').createTaskSessionStoreV2() },
    });
    const a = worker(first.lifecycle, makeContinuation(first.lifecycle, first.db), { workerId: 'worker-a' });
    const beforeCrash = await a.runOnce();
    assert.equal(beforeCrash.outcome, 'SUSPENDED');
    assert.deepEqual(calls, ['get_all_recipes', 'compare_recipe_scenarios']);
    assert.equal(first.lifecycle.store.listSteps(stored.taskKey).filter(step => step.state === 'SUCCEEDED').length, 1);
    first.db.close();
    const freshDb = new Database(filename); freshDb.pragma('foreign_keys=ON');
    const freshLifecycle = createAiTaskLifecycleV2({ dbAccessors: accessors(freshDb, first.now), clock: first.now });
    const b = worker(freshLifecycle, makeContinuation(freshLifecycle, freshDb), { workerId: 'worker-b' });
    const resumed = await b.runOnce();
    assert.equal(resumed.outcome, 'COMPLETED', resumed.errorCode);
    assert.equal(freshLifecycle.store.getTaskByKey(stored.taskKey).state, 'SUCCEEDED');
    assert.equal(calls.filter(item => item === 'get_all_recipes').length, 1);
    assert.equal(calls.filter(item => item === 'compare_recipe_scenarios').length, 2);
    assert.equal(freshLifecycle.store.getTaskByKey(stored.taskKey).budget.usage.toolCalls, 3);
    freshDb.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1B-R3 keeps active time cumulative and prepares exactly one interrupted read retry', () => {
    const { mergeDetachedBudgetCheckpoint } = require('../api/services/aiTaskLifecycleV2.cjs');
    const budget = { limits: { maxModelCalls: 7, maxToolCalls: 10, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 32, maxActiveMs: 60000 }, usage: { modelCalls: 1, toolCalls: 2, apiCalls: 2, activeMs: 12000 } };
    const merged = mergeDetachedBudgetCheckpoint(budget, { ...budget, usage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 } }, { activeMsBase: 12000, iterationActiveMs: 3500 });
    assert.equal(merged.usage.activeMs, 15500); assert.equal(merged.usage.toolCalls, 2); assert.equal(60000 - merged.usage.activeMs, 44500);
    const fixture = setup(); const task = fixture.create({ state: 'RUNNING' }); const claim = fixture.lifecycle.store.claimNextDetachedTask({ workerId: 'retry', leaseDurationMs: 1000 }).task;
    const step = { stepId: key(), goalKeys: ['cost'], toolName: 'preview_recipe_cost', capabilityId: 'recipe.cost.preview', access: 'QUERY', arguments: {}, argumentSources: [], argsHash: stableHash({}), state: 'PLANNED', attempt: 1, startedAt: null, finishedAt: null, errorCode: null, planRevision: 1 };
    let current = fixture.lifecycle.appendPlannedStepLeased(task.taskKey, claim.revision, { workerId: 'retry', leaseToken: claim.lease.token }, step).task;
    current = fixture.lifecycle.markStepRunningLeased(task.taskKey, current.revision, { workerId: 'retry', leaseToken: claim.lease.token }, step.stepId);
    const before = current.budget.usage.toolCalls;
    current = fixture.lifecycle.prepareInterruptedReadRetryLeased(task.taskKey, current.revision, { workerId: 'retry', leaseToken: claim.lease.token }, step.stepId);
    const retried = fixture.lifecycle.store.listSteps(task.taskKey)[0]; const events = fixture.lifecycle.store.listEvents(task.taskKey).filter(event => event.eventType.startsWith('STEP_'));
    assert.equal(retried.attempt, 2); assert.equal(current.budget.usage.toolCalls, before + 1); assert.deepEqual(events.slice(-2).map(event => event.eventType), ['STEP_ATTEMPT_INTERRUPTED', 'STEP_RETRY_STARTED']);
    assert.throws(() => fixture.lifecycle.prepareInterruptedReadRetryLeased(task.taskKey, current.revision, { workerId: 'retry', leaseToken: claim.lease.token }, step.stepId), error => error.code === 'READ_RETRY_NOT_ELIGIBLE');
    fixture.db.close();
});

test('N5.1B-R3 rehydrates owner-bound follow-up source references and fails closed when missing', () => {
    const fixture = setup(); const task = fixture.create({ state: 'SUSPENDED' });
    fixture.db.prepare('INSERT INTO ai_conversation_messages VALUES(2,1,?,?)').run('user', '卖340元一台，做300台');
    const stored = fixture.lifecycle.store.getTaskByKey(task.taskKey);
    const proposal = { version: 1, goalSummary: 'followup', subjects: [], scenarios: [], goals: [{ goalKey: 'profit', kind: 'PROFITABILITY', description: 'profit', subjectKeys: [], scenarioKeys: [], dependsOn: [], requestedBasis: 'CURRENT', sources: [], quantity: { value: 300, unit: 'pump', sources: [{ messageRef: 'msg:turn2', start: 8, end: 13, text: '做300台' }] }, unitPrice: { value: 340, unit: 'CNY', sources: [{ messageRef: 'msg:turn2', start: 0, end: 7, text: '卖340元一台' }] } }], unparsedSpans: [] };
    const spec = { ...stored.spec, recovery: { version: 1, proposal, sourceMessageIds: { 'msg:turn1': 1, 'msg:turn2': 2 }, pending: null, activeMsBase: 0 } };
    fixture.lifecycle.store.mutateTask(task.taskKey, stored.revision, () => ({ spec }));
    const recovery = createAiTaskRecoveryV2({ lifecycle: fixture.lifecycle, db: fixture.db, clock: fixture.now }); const hydrated = recovery.rehydrate(task.taskKey);
    assert.equal(hydrated.sourceMessages.get('msg:turn2'), '卖340元一台，做300台'); assert.equal(hydrated.sourceMessages.get('msg:turn2').slice(0, 7), '卖340元一台');
    fixture.db.prepare('DELETE FROM ai_conversation_messages WHERE id=2').run(); assert.throws(() => recovery.rehydrate(task.taskKey), error => error.code === 'TASK_SOURCE_MESSAGE_UNAVAILABLE'); fixture.db.close();
});

test('N5.1B-R4 cancellation routes unknown command effects to RECONCILING and releases lease', async () => {
    for (const state of ['RUNNING', 'UNKNOWN_EFFECT']) {
        const fixture = setup(); const task = fixture.create({ state: 'RUNNING' });
        fixture.db.prepare('INSERT INTO ai_task_steps(step_key,task_id,plan_revision,sequence,capability_id,tool_name,goal_keys_json,access,args_json,args_hash,argument_sources_json,state,attempt,receipt_key,operation_id,idempotency_key,started_at,finished_at,error_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(key(), task.id, 1, 1, 'command.test', 'command_test', '["cost"]', 'COMMAND', '{}', stableHash({}), '[]', state, 1, null, 'op-123', null, null, null, null, new Date(fixture.now()).toISOString(), new Date(fixture.now()).toISOString());
        fixture.lifecycle.store.requestCancel(task.taskKey, task.revision);
        const outcome = await worker(fixture.lifecycle, async () => { throw new Error('must not execute'); }, { workerId: `cancel-${state}` }).runOnce();
        const final = fixture.lifecycle.store.getTaskByKey(task.taskKey);
        assert.equal(outcome.outcome, 'CANCELLED'); assert.equal(final.state, 'RECONCILING'); assert.equal(final.lease, null); assert.equal(fixture.lifecycle.store.listSteps(task.taskKey)[0].operationId, 'op-123'); fixture.db.close();
    }
});

test('N5.1B-R5 resumes four real controller goals from a fresh worker without repeating durable reads', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51br5-four-goal-')); const filename = path.join(root, 'task.db');
    const text = 'V550现在成本多少？电缆改5米以后成本多少？卖340毛利多少？如果现在做300台库存够不够、缺什么？先不要保存。';
    const first = setup({ filename }); first.db.prepare('UPDATE ai_conversation_messages SET content=? WHERE id=1').run(text);
    const task = first.create({ userGoal: text, inputHash: hash(text) }); const executor = fourGoalExecutor();
    const crashAfterProfit = ({ snapshot }) => {
        if (snapshot.task.steps.some(step => step.toolName === 'preview_profitability' && step.state === 'SUCCEEDED')) {
            throw Object.assign(new Error('deterministic test crash'), { code: 'TASK_TEST_CRASH' });
        }
    };
    const a = worker(first.lifecycle, continuation(first.lifecycle, first.db, executor.execute, text, { clock: first.now, afterProgress: crashAfterProfit }), { workerId: 'worker-a', testCrashLeavesLease: true });
    const crashed = await a.runOnce();
    assert.equal(crashed.outcome, 'CRASHED');
    const preCrash = first.lifecycle.store.getTaskByKey(task.taskKey);
    const preCrashSteps = first.lifecycle.store.listSteps(task.taskKey).filter(step => step.state === 'SUCCEEDED');
    assert.ok(preCrashSteps.length >= 1); assert.ok(first.lifecycle.store.listEvidence(task.taskKey).length >= 2);
    assert.ok(preCrash.lease);
    const beforeCounts = Object.fromEntries(executor.calls.map(call => [call.toolName, executor.calls.filter(item => item.toolName === call.toolName).length]));
    first.db.close();

    const secondDb = new Database(filename); secondDb.pragma('foreign_keys=ON');
    const secondLifecycle = createAiTaskLifecycleV2({ dbAccessors: accessors(secondDb, first.now), clock: first.now });
    first.advance(21); const recoveredLeases = secondLifecycle.store.recoverExpiredLeases();
    assert.deepEqual(recoveredLeases, [{ taskKey: task.taskKey, state: 'SUSPENDED' }]);
    const beforeResume = secondLifecycle.store.getTaskByKey(task.taskKey);
    assert.equal(beforeResume.state, 'SUSPENDED');
    const b = worker(secondLifecycle, continuation(secondLifecycle, secondDb, executor.execute, text, { clock: first.now }), { workerId: 'worker-b' });
    const resumed = await b.runOnce();
    assert.equal(resumed.outcome, 'COMPLETED', resumed.errorCode);
    const final = secondLifecycle.store.loadValidatedEvidence(task.taskKey);
    assert.equal(final.task.taskKey, task.taskKey); assert.equal(final.task.state, 'SUCCEEDED'); assert.equal(final.task.lease, null);
    assert.deepEqual(final.task.spec.goals.map(goal => [goal.kind, goal.state]).sort(([a], [b]) => a.localeCompare(b)), [
        ['CURRENT_COST', 'VERIFIED'], ['CONFIGURATION_COMPARE', 'VERIFIED'], ['PROFITABILITY', 'VERIFIED'], ['INVENTORY_QUERY', 'VERIFIED'],
    ].sort(([a], [b]) => a.localeCompare(b)));
    for (const step of preCrashSteps) assert.equal(executor.calls.filter(call => call.toolName === step.toolName).length, beforeCounts[step.toolName], `${step.toolName} reused`);
    assert.ok(final.receipts.size >= 2); assert.ok(final.facts.size >= 3); assert.ok(secondLifecycle.store.listSteps(task.taskKey).every(step => step.state === 'SUCCEEDED'));
    secondDb.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1B-R5 dispatches one bounded QUERY retry through the original controller and adapter', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51br5-query-')); const filename = path.join(root, 'task.db'); const text = 'V550现在成本多少';
    const first = setup({ filename }); const task = first.create(); const executor = fourGoalExecutor(); let interrupted = false;
    const a = worker(first.lifecycle, continuation(first.lifecycle, first.db, executor.execute, text, { clock: first.now, afterDispatch: ({ toolName }) => {
        if (toolName === 'get_all_recipes' && !interrupted) { interrupted = true; throw Object.assign(new Error('crash after query dispatch'), { code: 'TASK_TEST_CRASH' }); }
    } }), { workerId: 'query-a', testCrashLeavesLease: true });
    assert.equal((await a.runOnce()).outcome, 'CRASHED');
    const before = first.lifecycle.store.getTaskByKey(task.taskKey); const initial = first.lifecycle.store.listSteps(task.taskKey).find(step => step.toolName === 'get_all_recipes');
    assert.equal(initial.state, 'RUNNING'); assert.equal(initial.attempt, 1); assert.equal(before.budget.usage.toolCalls, 1);
    first.db.close(); const fresh = new Database(filename); fresh.pragma('foreign_keys=ON'); const life = createAiTaskLifecycleV2({ dbAccessors: accessors(fresh, first.now), clock: first.now }); first.advance(21); life.store.recoverExpiredLeases();
    const b = worker(life, continuation(life, fresh, executor.execute, text, { clock: first.now }), { workerId: 'query-b' }); const completed = await b.runOnce(); assert.equal(completed.outcome, 'COMPLETED', completed.errorCode);
    const retried = life.store.listSteps(task.taskKey).find(step => step.stepKey === initial.stepKey); const events = life.store.listEvents(task.taskKey).map(event => event.eventType);
    assert.equal(retried.state, 'SUCCEEDED'); assert.equal(retried.attempt, 2); assert.equal(executor.calls.filter(call => call.toolName === 'get_all_recipes').length, 2);
    assert.ok(events.includes('STEP_ATTEMPT_INTERRUPTED')); assert.ok(events.includes('STEP_RETRY_STARTED')); assert.equal(life.store.getTaskByKey(task.taskKey).budget.usage.toolCalls, 3);
    fresh.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1B-R5 dispatches one bounded PREVIEW retry and blocks a third attempt without a call', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51br5-preview-')); const filename = path.join(root, 'task.db');
    const text = 'V550现在成本多少？电缆改5米以后成本多少？卖340毛利多少？如果现在做300台库存够不够、缺什么？先不要保存。';
    const first = setup({ filename }); first.db.prepare('UPDATE ai_conversation_messages SET content=? WHERE id=1').run(text); const task = first.create({ userGoal: text, inputHash: hash(text) }); const executor = fourGoalExecutor(); let firstCrash = false;
    const a = worker(first.lifecycle, continuation(first.lifecycle, first.db, executor.execute, text, { clock: first.now, afterDispatch: ({ toolName }) => {
        if (toolName === 'preview_profitability' && !firstCrash) { firstCrash = true; throw Object.assign(new Error('crash after preview dispatch'), { code: 'TASK_TEST_CRASH' }); }
    } }), { workerId: 'preview-a', testCrashLeavesLease: true });
    assert.equal((await a.runOnce()).outcome, 'CRASHED'); first.db.close();
    const dbB = new Database(filename); dbB.pragma('foreign_keys=ON'); const lifeB = createAiTaskLifecycleV2({ dbAccessors: accessors(dbB, first.now), clock: first.now }); first.advance(21); lifeB.store.recoverExpiredLeases(); let secondCrash = false;
    const b = worker(lifeB, continuation(lifeB, dbB, executor.execute, text, { clock: first.now, afterDispatch: ({ toolName }) => {
        if (toolName === 'preview_profitability' && !secondCrash) { secondCrash = true; throw Object.assign(new Error('crash after retry dispatch'), { code: 'TASK_TEST_CRASH' }); }
    } }), { workerId: 'preview-b', testCrashLeavesLease: true });
    assert.equal((await b.runOnce()).outcome, 'CRASHED'); const afterRetry = lifeB.store.getTaskByKey(task.taskKey); const target = lifeB.store.listSteps(task.taskKey).find(step => step.toolName === 'preview_profitability');
    assert.equal(target.state, 'RUNNING'); assert.equal(target.attempt, 2); const budgetAfterRetry = structuredClone(afterRetry.budget.usage); dbB.close();
    const dbC = new Database(filename); dbC.pragma('foreign_keys=ON'); const lifeC = createAiTaskLifecycleV2({ dbAccessors: accessors(dbC, first.now), clock: first.now }); first.advance(21); lifeC.store.recoverExpiredLeases();
    const c = worker(lifeC, continuation(lifeC, dbC, executor.execute, text, { clock: first.now }), { workerId: 'preview-c' }); const exhausted = await c.runOnce(); const final = lifeC.store.getTaskByKey(task.taskKey);
    assert.equal(exhausted.outcome, 'COMPLETED'); assert.equal(final.state, 'SUSPENDED'); assert.equal(lifeC.store.listSteps(task.taskKey).find(step => step.stepKey === target.stepKey).attempt, 2);
    assert.equal(lifeC.store.listEvents(task.taskKey).find(event => event.eventType === 'TASK_SUSPENDED' && event.payload.reason === 'READ_RETRY_EXHAUSTED')?.payload.reason, 'READ_RETRY_EXHAUSTED'); assert.equal(executor.calls.filter(call => call.toolName === 'preview_profitability').length, 2); assert.deepEqual(final.budget.usage, budgetAfterRetry); dbC.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1B-R5 stops exhausted active budgets before any Worker external dispatch and excludes waiting wall time', async () => {
    const fixture = setup(); const exhausted = fixture.create({ budgetUsage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 60000 } }); let calls = 0;
    const outcome = await worker(fixture.lifecycle, async () => { calls += 1; return { state: 'SUCCEEDED' }; }, { workerId: 'deadline' }).runOnce();
    assert.equal(outcome.outcome, 'ACTIVE_BUDGET_EXHAUSTED'); assert.equal(calls, 0); assert.equal(fixture.lifecycle.store.getTaskByKey(exhausted.taskKey).state, 'SUSPENDED');
    const waiting = fixture.create({ state: 'WAITING_INPUT', budgetUsage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 12000 } }); const suspended = fixture.create({ state: 'SUSPENDED', budgetUsage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 12000 } });
    fixture.advance(2 * 60 * 60 * 1000);
    assert.equal(fixture.lifecycle.store.getTaskByKey(waiting.taskKey).budget.usage.activeMs, 12000); assert.equal(fixture.lifecycle.store.getTaskByKey(suspended.taskKey).budget.usage.activeMs, 12000);
    fixture.db.close();
});
