'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const { AI_TASK_PERSISTENCE_SCHEMA_SQL } = require('../api/database/schema.cjs');
const { runMigrations } = require('../api/database/migrations.cjs');
const { createDatabaseBackup } = require('../api/services/databaseBackup.cjs');
const { RESTORE_CONFIRMATION, restoreDatabaseBackup } = require('../api/services/databaseRestore.cjs');
const { createAiTaskLifecycleV2 } = require('../api/services/aiTaskLifecycleV2.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { stableHash } = require('../api/services/aiTaskContractV2.cjs');
const { createBusinessUnderstandingFixtureV2 } = require('./helpers/businessUnderstandingFixtureV2.cjs');

const NOW = '2026-09-22T00:00:00.000Z';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const uuid = () => crypto.randomUUID();
const clone = value => structuredClone(value);

function accessors(db) {
    return {
        db,
        safeInsert(table, values) {
            const keys = Object.keys(values).filter(key => values[key] !== undefined);
            return db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(key => values[key]));
        },
        safeUpdate(table, id, values) {
            const keys = Object.keys(values).filter(key => values[key] !== undefined);
            db.prepare(`UPDATE ${table} SET ${keys.map(key => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map(key => values[key]), NOW, id);
            return { changes: 1 };
        },
    };
}
function createDb(filename = ':memory:', message = '查询 V550 当前成本') {
    const db = new Database(filename); db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE ai_conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_key TEXT NOT NULL, deleted_at TEXT); CREATE TABLE ai_conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL); ${AI_TASK_PERSISTENCE_SCHEMA_SQL}`);
    db.prepare('INSERT INTO ai_conversations(id, owner_key, deleted_at) VALUES(1, ?, NULL)').run('admin');
    db.prepare('INSERT INTO ai_conversation_messages(id, conversation_id, role, content) VALUES(1, 1, ?, ?)').run('user', message);
    return db;
}
function life(db) { return createAiTaskLifecycleV2({ dbAccessors: accessors(db), clock: () => NOW }); }
function baseTask(key = uuid(), message = '查询 V550 当前成本') {
    return {
        version: 2, taskId: key, parentTaskId: null, ownerKey: 'admin', conversationId: 'fixture', requestId: 'fixture', revision: 1, planRevision: 1, state: 'NEW', answerOwner: 'TASK_V2', executionMode: 'FOREGROUND', userGoal: message, inputHash: hash(message), createdAt: NOW, updatedAt: NOW,
        constraints: { businessWritePolicy: 'FORBIDDEN', maxModelCalls: 7, maxToolCalls: 10, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 32, maxActiveMs: 10000 },
        subjects: [], goals: [{ goalKey: 'cost', kind: 'CURRENT_COST', description: '查询成本', subjectKeys: [], scenarioKeys: [], dependsOn: [], state: 'PENDING', factIds: [], blockers: [], requirements: [] }], scenarios: [], steps: [], facts: [], questions: [], approvalOperationIds: [], resultSummary: null, budgetUsage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 },
    };
}
function create(lifecycle, task = baseTask()) { return lifecycle.createTask({ ownerKey: 'admin', conversationId: 1, userMessageId: 1, taskKey: task.taskId, task, expiresAt: '2026-10-22T00:00:00.000Z' }); }
function receipt(taskKey, planRevision, value, sourceHash = 'a'.repeat(64), stepId = null) {
    const receiptId = uuid();
    return { evidenceKey: receiptId, planRevision, payload: { version: 1, receiptId, taskId: taskKey, stepId, planRevision, toolName: 'preview_recipe_cost', capabilityId: 'recipe.cost.preview', access: 'QUERY', argsHash: hash('{}'), origin: 'SERVER_EXECUTOR', observedAt: NOW, readSetId: null, sourceHash, projectionVersion: 1, result: { cost: value } }, sourceHash, observedAt: NOW };
}
function fact(taskKey, planRevision, receiptRecord, value, supersedesFactId = null) {
    const key = { entityType: 'global', entityId: null, predicate: 'recipe.current_cost', temporalScope: 'CURRENT', scenarioKey: null, qualifiers: { basis: 'CURRENT_REBUILT', unit: 'pump', currency: 'CNY', snapshotVersion: null, queryScopeHash: null } };
    const factId = uuid();
    return { evidenceKey: factId, planRevision, receiptKey: receiptRecord.evidenceKey, factKeyHash: stableHash(key), payload: { version: 1, factId, key, evidenceState: 'VERIFIED_POSITIVE', value, receiptId: receiptRecord.evidenceKey, resultPointer: '/cost', observedAt: NOW, sourceUpdatedAt: null, sourceHash: receiptRecord.sourceHash, complete: true, supersedesFactId, planRevision, readSetId: null }, sourceHash: receiptRecord.sourceHash, observedAt: NOW, supersedesKey: supersedesFactId };
}
function fakeExecutor() {
    const calls = [];
    const verified = data => ({ success: true, data, executionEvidence: { verified: true, calls: [{ method: 'GET', path: '/api/formal' }] } });
    const execute = async (toolName, args) => {
        calls.push({ toolName, args });
        if (toolName === 'get_all_recipes') return { ...verified([{ id: 301, name: 'V550' }]), queryReceipt: { authoritative: true, truncated: false, possiblyTruncated: false } };
        if (toolName === 'preview_profitability') {
            const scenario = args.basisRef.comparisonInput.scenarios[0];
            const base = { scenarioKey: 'base', configurationHash: 'base-configuration', cost: { complete: true, currentTotalCost: 108.5 }, appliedOverrides: {}, notApplied: [] };
            const candidate = { scenarioKey: scenario.scenarioKey, configurationHash: 'candidate-configuration', cost: { complete: true, currentTotalCost: 116.5 }, appliedOverrides: scenario.overrides, notApplied: [] };
            return verified({ preview: true, profitabilityId: uuid(), recipe: { id: 301, name: 'V550' }, scenarioKey: args.basisRef.scenarioKey, configurationHash: args.basisRef.scenarioKey === 'base' ? 'base-configuration' : 'candidate-configuration', unitCost: 116.5, unitPrice: args.unitPrice, grossProfitPerUnit: args.unitPrice - 116.5, grossMarginOnSales: (args.unitPrice - 116.5) / args.unitPrice, markupOnCost: (args.unitPrice - 116.5) / 116.5, quantity: args.quantity, totalCost: null, totalRevenue: null, totalGrossProfit: null, costComplete: true, costBasis: 'CURRENT_REBUILT', currency: 'CNY', readSetId: uuid(), readSetHash: 'a'.repeat(64), calculatedAt: NOW, warnings: [], scenarioContext: { scenarios: [base, candidate], comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: scenario.scenarioKey, status: 'COMPARABLE', delta: 8, currency: 'CNY' }] } });
        }
        if (toolName === 'preview_virtual_readiness') return verified({ version: 1, preview: true, readinessId: uuid(), recipe: { id: 301, name: 'V550' }, scenarioKey: args.basisRef.scenarioKey, configurationHash: args.basisRef.scenarioKey === 'base' ? 'base-configuration' : 'candidate-configuration', quantity: args.quantity, inventoryBasis: 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS', status: 'READY', readSetId: uuid(), readSetHash: 'b'.repeat(64), sourceVersions: [], sourceVersionCount: 0, sourceVersionsComplete: true, coverage: { requirementCount: 1, evaluatedCount: 1, shortageCount: 0, unresolvedCount: 0, excludedCount: 0, complete: true }, requirements: [], shortages: [], unresolvedRequirements: [], excludedRequirements: [], calculatedAt: NOW, warnings: [] });
        throw new Error(`unexpected ${toolName}`);
    };
    return { execute, calls };
}
async function captureFourGoalTask() {
    const fixture = fakeExecutor(); let captured = null;
    const message = 'V550现在成本多少？电缆改5米以后呢？卖340毛利多少？如果做300台库存够不够？先不要保存。';
    const publicResult = await runAiTaskControllerV2({ ownerKey: 'admin', requestId: 'n51a-r1-four-goal', conversationId: 'n51a-r1-four-goal', messages: [{ role: 'user', content: message }] }, { executeToolCall: fixture.execute, sessionStore: createTaskSessionStoreV2(), onValidatedTask: value => { captured = value; } });
    assert.equal(publicResult.task.state, 'SUCCEEDED');
    assert.deepEqual(captured.task.goals.map(goal => goal.kind).sort(), ['CONFIGURATION_COMPARE', 'CURRENT_COST', 'INVENTORY_QUERY', 'PROFITABILITY']);
    return { captured, message, calls: fixture.calls };
}
function persistControllerTask(lifecycle, captured, message) {
    const sourceTask = clone(captured.task);
    const storedTask = { ...sourceTask, state: 'NEW', revision: 1, planRevision: 1, steps: [], facts: [], sourceEvidence: [], resultSummary: null,
        goals: sourceTask.goals.map(goal => ({ ...goal, state: 'PENDING', factIds: [], blockers: [], requirements: [] })) };
    create(lifecycle, storedTask);
    let revision = 1;
    for (const state of ['UNDERSTANDING', 'RESOLVING', 'RUNNING']) revision = lifecycle.transition(storedTask.taskId, revision, { state }).revision;
    const receiptByStep = new Map();
    for (const step of sourceTask.steps) {
        const planned = { ...step, planRevision: sourceTask.planRevision, state: 'PLANNED', startedAt: null, finishedAt: null, errorCode: null, receiptId: null };
        assert.equal(stableHash(planned.arguments), planned.argsHash, `controller step hash ${planned.toolName}`);
        assert.equal(planned.planRevision, lifecycle.store.getTaskByKey(storedTask.taskId).planRevision, `controller step plan revision ${planned.toolName}`);
        assert.ok(Array.isArray(planned.goalKeys) && planned.goalKeys.length, `controller step goals ${planned.toolName}`);
        revision = lifecycle.appendPlannedStep(storedTask.taskId, revision, planned).task.revision;
        revision = lifecycle.markStepRunning(storedTask.taskId, revision, step.stepId).revision;
        const originalReceipt = captured.trustedReceipts.get(step.receiptId);
        if (originalReceipt) {
            revision = lifecycle.appendReceipt(storedTask.taskId, revision, { evidenceKey: originalReceipt.receiptId, planRevision: originalReceipt.planRevision, payload: originalReceipt, sourceHash: originalReceipt.sourceHash, observedAt: originalReceipt.observedAt }).revision;
            receiptByStep.set(step.stepId, originalReceipt.receiptId);
        }
        revision = lifecycle.completeStep(storedTask.taskId, revision, step.stepId, { receiptKey: receiptByStep.get(step.stepId) || null }).revision;
    }
    for (const rawFact of sourceTask.facts) {
        revision = lifecycle.appendFact(storedTask.taskId, revision, { evidenceKey: rawFact.factId, planRevision: rawFact.planRevision, receiptKey: rawFact.receiptId, factKeyHash: stableHash(rawFact.key), payload: rawFact, sourceHash: rawFact.sourceHash, observedAt: rawFact.observedAt, supersedesKey: rawFact.supersedesFactId }).revision;
    }
    revision = lifecycle.saveResult(storedTask.taskId, revision, { kind: 'N4_FOUR_GOAL_RESULT', goalStates: sourceTask.goals.map(goal => ({ goalKey: goal.goalKey, state: goal.state })), configurationHash: sourceTask.scenarios.find(item => item.scenarioKey !== 'base')?.configurationHash || null }).revision;
    const finalSpec = { version: 2, answerOwner: 'TASK_V2', userGoal: sourceTask.userGoal, businessWritePolicy: sourceTask.constraints.businessWritePolicy, subjects: sourceTask.subjects, goals: sourceTask.goals, scenarios: sourceTask.scenarios, questions: sourceTask.questions, approvalOperationIds: sourceTask.approvalOperationIds };
    revision = lifecycle.transition(storedTask.taskId, revision, { state: 'VERIFYING', spec: finalSpec }).revision;
    revision = lifecycle.transition(storedTask.taskId, revision, { state: 'SUCCEEDED' }).revision;
    return { taskKey: storedTask.taskId, revision, sourceTask, message };
}
function stableValue(value) {
    if (Buffer.isBuffer(value)) return { blob: value.toString('base64') };
    if (value === null) return null;
    if (Array.isArray(value)) return value.map(stableValue);
    if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
    return value;
}
function businessFingerprint(db) {
    const excluded = new Set(['schema_migrations', 'ai_tasks', 'ai_task_steps', 'ai_task_evidence', 'ai_task_events']);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name).filter(name => !excluded.has(name));
    return tables.map(tableName => {
        const quoted = `\"${tableName.replaceAll('\"', '\"\"')}\"`;
        const columns = db.prepare(`PRAGMA table_info(${quoted})`).all().map(column => `\"${String(column.name).replaceAll('\"', '\"\"')}\"`);
        const rows = db.prepare(`SELECT * FROM ${quoted}${columns.length ? ` ORDER BY ${columns.join(', ')}` : ''}`).all().map(stableValue);
        return { tableName, rowCount: rows.length, stableRowHash: hash(JSON.stringify(rows)) };
    });
}
function assertFingerprintEqual(left, right) { assert.deepEqual(right, left); }

test('N5.1A-R1 persists a real N4 four-goal controller task and restores it through a fresh store', async () => {
    const generated = await captureFourGoalTask();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51a-r1-four-goal-')); const file = path.join(root, 'task.db');
    let db = createDb(file, generated.message); let lifecycle = life(db);
    const persisted = persistControllerTask(lifecycle, generated.captured, generated.message);
    const before = { task: lifecycle.store.getTaskByKey(persisted.taskKey), steps: lifecycle.store.listSteps(persisted.taskKey), evidence: lifecycle.store.listEvidence(persisted.taskKey), events: lifecycle.store.listEvents(persisted.taskKey) };
    assert.equal(before.task.state, 'SUCCEEDED'); assert.equal(before.task.spec.goals.length, 4); assert.ok(before.steps.length >= 3); assert.ok(before.evidence.length >= 5); assert.ok(before.events.length > before.steps.length);
    db.close(); db = new Database(file); db.pragma('foreign_keys = ON'); lifecycle = life(db);
    const recovered = lifecycle.store.loadValidatedEvidence(persisted.taskKey); const after = { task: recovered.task, steps: lifecycle.store.listSteps(persisted.taskKey), evidence: lifecycle.store.listEvidence(persisted.taskKey), events: lifecycle.store.listEvents(persisted.taskKey) };
    assert.equal(after.task.taskKey, before.task.taskKey); assert.equal(after.task.revision, before.task.revision); assert.equal(after.task.planRevision, before.task.planRevision); assert.deepEqual(after.task.spec.goals.map(goal => [goal.kind, goal.state]).sort(), before.task.spec.goals.map(goal => [goal.kind, goal.state]).sort());
    assert.deepEqual(after.task.spec.scenarios.map(item => [item.scenarioKey, item.configurationHash]), before.task.spec.scenarios.map(item => [item.scenarioKey, item.configurationHash]));
    assert.deepEqual(after.steps.map(step => [step.stepKey, step.access, step.argsHash, step.state]), before.steps.map(step => [step.stepKey, step.access, step.argsHash, step.state]));
    assert.deepEqual(after.evidence.map(item => [item.evidenceKey, item.recordKind, item.factKeyHash, item.supersedesKey]), before.evidence.map(item => [item.evidenceKey, item.recordKind, item.factKeyHash, item.supersedesKey]));
    assert.deepEqual(after.events.map(event => event.seq), before.events.map(event => event.seq)); assert.equal(recovered.receipts.size, before.evidence.filter(item => item.recordKind === 'RECEIPT').length); assert.equal(recovered.facts.size, before.evidence.filter(item => item.recordKind === 'FACT').length); assert.equal(recovered.volatileRevalidationRequired, true);
    db.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1A-R1 validates receipt/fact tampering and a complete FACT supersession chain after reload', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51a-r1-evidence-')); const file = path.join(root, 'task.db'); let db = createDb(file); let lifecycle = life(db); const task = baseTask(); create(lifecycle, task);
    let revision = 1; const aReceipt = receipt(task.taskId, 1, 100); revision = lifecycle.appendReceipt(task.taskId, revision, aReceipt).revision; const aFact = fact(task.taskId, 1, aReceipt, 100); revision = lifecycle.appendFact(task.taskId, revision, aFact).revision;
    let spec = clone(lifecycle.store.getTaskByKey(task.taskId).spec); spec.questions.push({ questionId: uuid(), planRevision: 2, goalKeys: ['cost'], prompt: 'x', reasonCode: 'x', choices: [], candidateSetHash: hash('x'), expiresAt: '2026-10-01T00:00:00.000Z', answeredAt: null }); revision = lifecycle.revisePlan(task.taskId, revision, spec).revision;
    const bReceipt = receipt(task.taskId, 2, 110); revision = lifecycle.appendReceipt(task.taskId, revision, bReceipt).revision; const bFact = fact(task.taskId, 2, bReceipt, 110, aFact.evidenceKey); revision = lifecycle.appendFact(task.taskId, revision, bFact).revision;
    spec = clone(lifecycle.store.getTaskByKey(task.taskId).spec); spec.questions.push({ questionId: uuid(), planRevision: 3, goalKeys: ['cost'], prompt: 'y', reasonCode: 'y', choices: [], candidateSetHash: hash('y'), expiresAt: '2026-10-01T00:00:00.000Z', answeredAt: null }); revision = lifecycle.revisePlan(task.taskId, revision, spec).revision;
    const cReceipt = receipt(task.taskId, 3, 120); revision = lifecycle.appendReceipt(task.taskId, revision, cReceipt).revision; const cFact = fact(task.taskId, 3, cReceipt, 120, bFact.evidenceKey); revision = lifecycle.appendFact(task.taskId, revision, cFact).revision;
    assert.equal(lifecycle.store.loadValidatedEvidence(task.taskId).facts.get(cFact.evidenceKey).value, 120);
    assert.throws(() => lifecycle.appendFact(task.taskId, revision, { ...fact(task.taskId, 3, cReceipt, 120, aFact.evidenceKey), factKeyHash: stableHash({ wrong: true }) }), error => error.code === 'TASK_FACT_INVALID' || error.code === 'TASK_FACT_SUPERSEDE_INVALID');
    db.close(); db = new Database(file); db.pragma('foreign_keys = ON'); lifecycle = life(db); assert.equal(lifecycle.store.loadValidatedEvidence(task.taskId).facts.size, 3);
    db.prepare("UPDATE ai_task_evidence SET payload_json=? WHERE evidence_key=?").run(JSON.stringify({ ...cReceipt.payload, result: { cost: 999 } }), cReceipt.evidenceKey); assert.throws(() => lifecycle.store.loadValidatedEvidence(task.taskId), error => error.code === 'TASK_EVIDENCE_TAMPERED');
    db.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1A-R1 resolves revision and plan revision races through two SQLite connections without partial events', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51a-r1-race-')); const file = path.join(root, 'task.db'); let dbA = createDb(file); const task = baseTask(); let lifeA = life(dbA); create(lifeA, task); dbA.close();
    dbA = new Database(file); dbA.pragma('foreign_keys = ON'); const dbB = new Database(file); dbB.pragma('foreign_keys = ON'); lifeA = life(dbA); const lifeB = life(dbB); const initialA = lifeA.store.getTaskByKey(task.taskId); const initialB = lifeB.store.getTaskByKey(task.taskId); assert.equal(initialA.revision, initialB.revision);
    const success = lifeA.transition(task.taskId, initialA.revision, { state: 'UNDERSTANDING' }); assert.equal(success.revision, 2); assert.throws(() => lifeB.transition(task.taskId, initialB.revision, { state: 'UNDERSTANDING' }), error => error.code === 'TASK_REVISION_CONFLICT');
    assert.equal(lifeA.store.getTaskByKey(task.taskId).revision, 2); assert.deepEqual(lifeA.store.listEvents(task.taskId).map(item => item.seq), [1, 2]);
    const beforePlanA = lifeA.store.getTaskByKey(task.taskId); const beforePlanB = lifeB.store.getTaskByKey(task.taskId); const specA = clone(beforePlanA.spec); specA.questions.push({ questionId: uuid(), planRevision: 2, goalKeys: ['cost'], prompt: 'A', reasonCode: 'A', choices: [], candidateSetHash: hash('A'), expiresAt: '2026-10-01T00:00:00.000Z', answeredAt: null });
    const specB = clone(beforePlanB.spec); specB.questions.push({ questionId: uuid(), planRevision: 2, goalKeys: ['cost'], prompt: 'B', reasonCode: 'B', choices: [], candidateSetHash: hash('B'), expiresAt: '2026-10-01T00:00:00.000Z', answeredAt: null });
    const revised = lifeA.revisePlan(task.taskId, beforePlanA.revision, specA); assert.equal(revised.planRevision, 2); assert.throws(() => lifeB.revisePlan(task.taskId, beforePlanB.revision, specB), error => error.code === 'TASK_REVISION_CONFLICT');
    const final = lifeA.store.getTaskByKey(task.taskId); assert.equal(final.revision, 3); assert.equal(final.planRevision, 2); assert.equal(final.spec.questions.at(-1).prompt, 'A'); assert.deepEqual(lifeA.store.listEvents(task.taskId).map(item => item.seq), [1, 2, 3]);
    dbA.close(); dbB.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1A-R1 fingerprints every preexisting business table across migration and backup restore', async () => {
    const fixture = createBusinessUnderstandingFixtureV2(); const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51a-r1-migration-')); const restorePath = path.join(root, 'restored.db'); const backupRoot = path.join(root, 'backups'); const db = fixture.db;
    const customerId = fixture.ids['customer.benchmark']; db.prepare("INSERT INTO orders(customer_name, customer_id, items_json, created_at, updated_at) VALUES(?,?,?,?,?)").run('基准客户', customerId, '[]', NOW, NOW); db.prepare("INSERT INTO quotations(customer_id, items_json, created_at, updated_at) VALUES(?,?,?,?)").run(customerId, '[]', NOW, NOW);
    db.exec('DROP TABLE ai_task_events; DROP TABLE ai_task_evidence; DROP TABLE ai_task_steps; DROP TABLE ai_tasks;'); db.prepare('DELETE FROM schema_migrations WHERE version=88').run(); db.pragma('user_version = 87');
    const before = businessFingerprint(db); const backup = await createDatabaseBackup(db, { type: 'release', root: backupRoot, now: NOW, sourcePath: fixture.filename, gitCommit: '055a59360a870dc3e73ad33f1eeed911ea02fd40', prune: false });
    assert.equal(runMigrations(db).currentVersion, 88); const after = businessFingerprint(db); assertFingerprintEqual(before, after); assert.equal(db.pragma('integrity_check', { simple: true }), 'ok'); assert.equal(db.pragma('foreign_key_check').length, 0); assert.equal(runMigrations(db).appliedVersions.length, 0); assertFingerprintEqual(after, businessFingerprint(db)); db.close();
    await restoreDatabaseBackup({ confirmation: RESTORE_CONFIRMATION, root: backupRoot, backupPath: backup.path, targetPath: restorePath, skipPortCheck: true, now: NOW, currentGitCommit: '055a59360a870dc3e73ad33f1eeed911ea02fd40' }); const restored = new Database(restorePath, { readonly: true }); assertFingerprintEqual(before, businessFingerprint(restored)); assert.equal(restored.pragma('integrity_check', { simple: true }), 'ok'); assert.equal(restored.pragma('foreign_key_check').length, 0); restored.close(); fixture.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1A-R1 rejects every required recovered evidence tamper and cross-task receipt reference', () => {
    const cases = [
        ['receipt-source-hash', (db, keys) => db.prepare('UPDATE ai_task_evidence SET source_hash=? WHERE evidence_key=?').run('b'.repeat(64), keys.receipt)],
        ['fact-value', (db, keys) => { const row = db.prepare('SELECT payload_json FROM ai_task_evidence WHERE evidence_key=?').get(keys.fact); const payload = JSON.parse(row.payload_json); payload.value = 999; db.prepare('UPDATE ai_task_evidence SET payload_json=? WHERE evidence_key=?').run(JSON.stringify(payload), keys.fact); }],
        ['fact-key-hash', (db, keys) => db.prepare('UPDATE ai_task_evidence SET fact_key_hash=? WHERE evidence_key=?').run('f'.repeat(64), keys.fact)],
    ];
    for (const [name, tamper] of cases) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), `pump-n51a-r1-${name}-`)); const file = path.join(root, 'task.db'); let db = createDb(file); let lifecycle = life(db); const task = baseTask(); create(lifecycle, task);
        const rec = receipt(task.taskId, 1, 100); let revision = lifecycle.appendReceipt(task.taskId, 1, rec).revision; const currentFact = fact(task.taskId, 1, rec, 100); lifecycle.appendFact(task.taskId, revision, currentFact); db.close();
        db = new Database(file); db.pragma('foreign_keys = ON'); tamper(db, { receipt: rec.evidenceKey, fact: currentFact.evidenceKey }); lifecycle = life(db); assert.throws(() => lifecycle.store.loadValidatedEvidence(task.taskId), error => error.code === 'TASK_EVIDENCE_TAMPERED', name); db.close(); fs.rmSync(root, { recursive: true, force: true });
    }
    const db = createDb(); const lifecycle = life(db); const taskA = baseTask(); const taskB = baseTask(uuid()); create(lifecycle, taskA); create(lifecycle, taskB); const recA = receipt(taskA.taskId, 1, 100); lifecycle.appendReceipt(taskA.taskId, 1, recA);
    assert.throws(() => lifecycle.appendFact(taskB.taskId, 1, fact(taskB.taskId, 1, recA, 100)), error => error.code === 'TASK_FACT_RECEIPT_INVALID');
    const own = receipt(taskA.taskId, 1, 100); let revision = lifecycle.appendReceipt(taskA.taskId, 2, own).revision;
    assert.throws(() => lifecycle.appendFact(taskA.taskId, revision, { ...fact(taskA.taskId, 1, own, 100), supersedesKey: own.evidenceKey }), error => error.code === 'TASK_FACT_SUPERSEDE_INVALID');
    db.close();
});

test('N5.1A-R1 restores WAITING_INPUT question and budget with fresh connection', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51a-r1-waiting-')); const file = path.join(root, 'task.db'); const message = 'V550 毛利和库存够不够'; let db = createDb(file, message); let lifecycle = life(db); const task = baseTask(uuid(), message); task.budgetUsage = { modelCalls: 2, toolCalls: 3, apiCalls: 4, activeMs: 3000 }; task.goals[0].state = 'NEEDS_INPUT'; task.questions = [{ questionId: uuid(), planRevision: 1, goalKeys: ['cost'], prompt: '请输入数量', reasonCode: 'VIRTUAL_READINESS_QUANTITY_REQUIRED', choices: [], candidateSetHash: hash('candidates'), expiresAt: '2026-10-01T00:00:00.000Z', answeredAt: null }]; create(lifecycle, task); lifecycle.transition(task.taskId, 1, { state: 'UNDERSTANDING' }); lifecycle.transition(task.taskId, 2, { state: 'WAITING_INPUT' }); db.close();
    db = new Database(file); db.pragma('foreign_keys = ON'); lifecycle = life(db); const restored = lifecycle.store.getTaskByKey(task.taskId); assert.equal(restored.state, 'WAITING_INPUT'); assert.equal(restored.spec.questions[0].candidateSetHash, hash('candidates')); assert.equal(restored.planRevision, 1); assert.deepEqual(restored.budget.usage, { modelCalls: 2, toolCalls: 3, apiCalls: 4, activeMs: 3000 }); db.close(); fs.rmSync(root, { recursive: true, force: true });
});
