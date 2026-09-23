'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const { CANONICAL_TABLES_SQL, AI_TASK_PERSISTENCE_SCHEMA_SQL } = require('../api/database/schema.cjs');
const { MIGRATIONS, MIGRATION_TABLE_SQL, migrationChecksum, runMigrations } = require('../api/database/migrations.cjs');
const { createDatabaseBackup } = require('../api/services/databaseBackup.cjs');
const { RESTORE_CONFIRMATION, restoreDatabaseBackup } = require('../api/services/databaseRestore.cjs');
const { createAiTaskLifecycleV2 } = require('../api/services/aiTaskLifecycleV2.cjs');
const { stableHash } = require('../api/services/aiTaskContractV2.cjs');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const now = '2026-09-22T00:00:00.000Z';
const taskKey = '11111111-1111-4111-8111-111111111111';
const stepKey = '22222222-2222-4222-8222-222222222222';
const receiptKey = '33333333-3333-4333-8333-333333333333';
const factKey = '44444444-4444-4444-8444-444444444444';

function accessors(db) {
    return {
        db,
        safeInsert(table, values) {
            const keys = Object.keys(values).filter(key => values[key] !== undefined);
            return db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...keys.map(key => values[key]));
        },
        safeUpdate(table, id, values) {
            const keys = Object.keys(values).filter(key => values[key] !== undefined);
            db.prepare(`UPDATE ${table} SET ${keys.map(key => `${key} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).run(...keys.map(key => values[key]), now, id);
            return { changes: 1 };
        },
    };
}
function task(overrides = {}) {
    return {
        version: 2, taskId: taskKey, parentTaskId: null, ownerKey: 'admin', conversationId: 'chat-1', requestId: 'req-1', revision: 1, planRevision: 1, state: 'NEW', answerOwner: 'TASK_V2', executionMode: 'FOREGROUND', userGoal: '查询 V550 当前成本', inputHash: hash('查询 V550 当前成本'), createdAt: now, updatedAt: now,
        constraints: { businessWritePolicy: 'FORBIDDEN', maxModelCalls: 1, maxToolCalls: 1, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 1, maxActiveMs: 10000 },
        subjects: [], goals: [{ goalKey: 'cost', kind: 'CURRENT_COST', description: '查询成本', subjectKeys: [], scenarioKeys: [], dependsOn: [], state: 'PENDING', factIds: [], blockers: [], requirements: [] }], scenarios: [], steps: [], facts: [], questions: [], approvalOperationIds: [], resultSummary: null, budgetUsage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 }, ...overrides,
    };
}
function createDb(filename = ':memory:') {
    const db = new Database(filename); db.pragma('foreign_keys = ON');
    db.exec(`CREATE TABLE ai_conversations (id INTEGER PRIMARY KEY AUTOINCREMENT, owner_key TEXT NOT NULL, deleted_at TEXT); CREATE TABLE ai_conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, conversation_id INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL); ${AI_TASK_PERSISTENCE_SCHEMA_SQL}`);
    db.prepare('INSERT INTO ai_conversations (id, owner_key, deleted_at) VALUES (1, ?, NULL)').run('admin');
    db.prepare('INSERT INTO ai_conversation_messages (id, conversation_id, role, content) VALUES (1, 1, ?, ?)').run('user', '查询 V550 当前成本');
    return db;
}
function lifecycle(db) { return createAiTaskLifecycleV2({ dbAccessors: accessors(db), clock: () => now }); }
function create(life, input = {}) { return life.createTask({ ownerKey: 'admin', conversationId: 1, userMessageId: 1, taskKey, task: task(), expiresAt: '2026-10-22T00:00:00.000Z', ...input }); }

test('N5.1A task lifecycle persists server-owned task, ordered events, and read-only queries', () => {
    const db = createDb(); const life = lifecycle(db); const created = create(life);
    assert.equal(created.state, 'NEW'); assert.equal(life.store.listEvents(taskKey)[0].eventType, 'TASK_CREATED');
    const resolving = life.transition(taskKey, 1, { state: 'UNDERSTANDING' });
    assert.equal(resolving.revision, 2); assert.equal(resolving.planRevision, 1);
    assert.throws(() => life.transition(taskKey, 1, { state: 'RESOLVING' }), error => error.code === 'TASK_REVISION_CONFLICT');
    const before = db.prepare('SELECT COUNT(*) count FROM ai_task_events').get().count;
    assert.equal(life.store.getTaskByKey(taskKey).revision, 2); assert.equal(life.store.listSteps(taskKey).length, 0); assert.equal(life.store.listEvidence(taskKey).length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) count FROM ai_task_events').get().count, before);
    assert.equal(life.store.getTaskForOwner(taskKey, 'other'), null);
    assert.deepEqual(life.store.listEvents(taskKey).map(event => event.seq), [1, 2]);
    db.close();
});

test('N5.1A rejects spoofed owner, assistant source, client budget expansion, invalid transition and terminal resurrection', () => {
    const db = createDb(); const life = lifecycle(db);
    assert.throws(() => create(life, { ownerKey: 'other' }), error => error.code === 'TASK_SOURCE_OWNERSHIP_INVALID');
    db.prepare("UPDATE ai_conversation_messages SET role = 'assistant' WHERE id = 1").run();
    assert.throws(() => create(life), error => error.code === 'TASK_SOURCE_OWNERSHIP_INVALID');
    db.prepare("UPDATE ai_conversation_messages SET role = 'user' WHERE id = 1").run();
    assert.throws(() => create(life, { task: task({ constraints: { ...task().constraints, maxModelCalls: 99 } }) }), error => ['TASK_MODEL_BUDGET', 'TASK_BUDGET_INVALID'].includes(error.code));
    create(life); assert.throws(() => life.transition(taskKey, 1, { state: 'SUCCEEDED' }), error => error.code === 'TASK_TRANSITION_INVALID');
    life.transition(taskKey, 1, { state: 'CANCELLED' });
    assert.throws(() => life.transition(taskKey, 2, { state: 'RUNNING' }), error => error.code === 'TASK_TRANSITION_INVALID'); db.close();
});

test('N5.1A steps are planned only, and facts require same-task receipts with append-only supersede controls', () => {
    const db = createDb(); const life = lifecycle(db); create(life); life.transition(taskKey, 1, { state: 'UNDERSTANDING' });
    const planned = life.appendPlannedStep(taskKey, 2, { stepId: stepKey, goalKeys: ['cost'], toolName: 'preview_recipe_cost', capabilityId: 'recipe.cost.preview', access: 'QUERY', arguments: {}, argumentSources: [], argsHash: hash('{}'), state: 'PLANNED', attempt: 1, startedAt: null, finishedAt: null, errorCode: null, planRevision: 1 });
    assert.equal(planned.steps.length, 1); assert.throws(() => life.appendPlannedStep(taskKey, 3, { stepId: '55555555-5555-4555-8555-555555555555', goalKeys: ['cost'], toolName: 'write', capabilityId: 'x', access: 'COMMAND', arguments: {}, argumentSources: [], argsHash: hash('{}'), state: 'PLANNED', attempt: 1, startedAt: null, finishedAt: null, errorCode: null, planRevision: 1 }), error => error.code === 'TASK_STEP_INVALID');
    const receiptPayload = { version: 1, receiptId: receiptKey, taskId: taskKey, stepId: null, planRevision: 1, toolName: 'preview_recipe_cost', capabilityId: 'recipe.cost.preview', access: 'QUERY', argsHash: hash('{}'), origin: 'SERVER_EXECUTOR', observedAt: now, readSetId: null, sourceHash: 'a'.repeat(64), projectionVersion: 1, result: { cost: 100 } };
    const receipt = life.appendReceipt(taskKey, 3, { evidenceKey: receiptKey, planRevision: 1, payload: receiptPayload, sourceHash: 'a'.repeat(64), observedAt: now });
    assert.equal(receipt.revision, 4);
    assert.throws(() => life.appendFact(taskKey, 4, { evidenceKey: factKey, planRevision: 1, receiptKey: '66666666-6666-4666-8666-666666666666', factKeyHash: hash('cost'), payload: { value: 100 }, sourceHash: 'a'.repeat(64), observedAt: now }), error => error.code === 'TASK_FACT_RECEIPT_INVALID');
    const factPayload = { version: 1, factId: factKey, key: { entityType: 'global', entityId: null, predicate: 'cost', temporalScope: 'CURRENT', scenarioKey: null, qualifiers: { basis: 'FORMAL_READ', unit: 'pump', currency: 'CNY', snapshotVersion: null, queryScopeHash: null } }, evidenceState: 'VERIFIED_POSITIVE', value: 100, receiptId: receiptKey, resultPointer: '/cost', observedAt: now, sourceUpdatedAt: null, sourceHash: 'a'.repeat(64), complete: true, supersedesFactId: null, planRevision: 1, readSetId: null };
    const factKeyHash = stableHash({ entityType: 'global', entityId: null, predicate: 'cost', temporalScope: 'CURRENT', scenarioKey: null, qualifiers: { basis: 'FORMAL_READ', unit: 'pump', currency: 'CNY', snapshotVersion: null, queryScopeHash: null } });
    const fact = life.appendFact(taskKey, 4, { evidenceKey: factKey, planRevision: 1, receiptKey, factKeyHash, payload: factPayload, sourceHash: 'a'.repeat(64), observedAt: now });
    assert.equal(fact.revision, 5); assert.equal(life.store.listEvidence(taskKey).length, 2);
    assert.equal(life.store.loadValidatedEvidence(taskKey).facts.size, 1);
    db.prepare("UPDATE ai_task_evidence SET source_hash = ? WHERE evidence_key = ?").run('b'.repeat(64), receiptKey);
    assert.throws(() => life.store.loadValidatedEvidence(taskKey), error => error.code === 'TASK_EVIDENCE_TAMPERED'); db.close();
});

test('N5.1A rejects sensitive fields from result, events, and evidence payloads', () => {
    const db = createDb(); const life = lifecycle(db); create(life);
    assert.throws(() => life.saveResult(taskKey, 1, { confirmationToken: 'nope' }), error => error.code === 'TASK_RESULT_TOO_LARGE');
    assert.throws(() => life.store.appendEvent(1, 'STATE_CHANGED', { apiKey: 'nope' }), error => error.code === 'TASK_EVENT_PAYLOAD_UNSAFE');
    db.close();
});

test('N5.1A recovers stored budgets and WAITING_INPUT state without counting wait time', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51a-roundtrip-')); const filename = path.join(root, 'task.db');
    let db = createDb(filename); let life = lifecycle(db); create(life, { task: task({ budgetUsage: { modelCalls: 1, toolCalls: 1, apiCalls: 1, activeMs: 3000 } }) });
    life.transition(taskKey, 1, { state: 'UNDERSTANDING' }); const waiting = life.transition(taskKey, 2, { state: 'WAITING_INPUT' });
    assert.equal(waiting.state, 'WAITING_INPUT'); db.close();
    db = new Database(filename); db.pragma('foreign_keys = ON'); life = lifecycle(db); const recovered = life.store.loadValidatedEvidence(taskKey).task;
    assert.equal(recovered.state, 'WAITING_INPUT'); assert.deepEqual(recovered.budget.usage, { modelCalls: 1, toolCalls: 1, apiCalls: 1, activeMs: 3000 });
    db.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1A revalidates persisted receipt and fact trust after reopening SQLite', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51a-evidence-')); const filename = path.join(root, 'task.db');
    let db = createDb(filename); let life = lifecycle(db); create(life); life.transition(taskKey, 1, { state: 'UNDERSTANDING' });
    const receiptPayload = { version: 1, receiptId: receiptKey, taskId: taskKey, stepId: null, planRevision: 1, toolName: 'preview_recipe_cost', capabilityId: 'recipe.cost.preview', access: 'QUERY', argsHash: hash('{}'), origin: 'SERVER_EXECUTOR', observedAt: now, readSetId: null, sourceHash: 'a'.repeat(64), projectionVersion: 1, result: { cost: 100 } };
    life.appendReceipt(taskKey, 2, { evidenceKey: receiptKey, planRevision: 1, payload: receiptPayload, sourceHash: 'a'.repeat(64), observedAt: now });
    const key = { entityType: 'global', entityId: null, predicate: 'cost', temporalScope: 'CURRENT', scenarioKey: null, qualifiers: { basis: 'FORMAL_READ', unit: 'pump', currency: 'CNY', snapshotVersion: null, queryScopeHash: null } };
    const factPayload = { version: 1, factId: factKey, key, evidenceState: 'VERIFIED_POSITIVE', value: 100, receiptId: receiptKey, resultPointer: '/cost', observedAt: now, sourceUpdatedAt: null, sourceHash: 'a'.repeat(64), complete: true, supersedesFactId: null, planRevision: 1, readSetId: null };
    life.appendFact(taskKey, 3, { evidenceKey: factKey, planRevision: 1, receiptKey, factKeyHash: stableHash(key), payload: factPayload, sourceHash: 'a'.repeat(64), observedAt: now }); db.close();
    db = new Database(filename); db.pragma('foreign_keys = ON'); life = lifecycle(db); const recovered = life.store.loadValidatedEvidence(taskKey);
    assert.equal(recovered.receipts.get(receiptKey).result.cost, 100); assert.equal(recovered.facts.get(factKey).value, 100); assert.equal(recovered.volatileRevalidationRequired, true);
    db.close(); fs.rmSync(root, { recursive: true, force: true });
});

test('N5.1A migration v88 runs through formal runner and disposable backup restores pre-migration schema', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-n51a-')); const sourcePath = path.join(root, 'source.db'); const restorePath = path.join(root, 'restored.db'); const backupRoot = path.join(root, 'backups');
    const db = new Database(sourcePath); db.pragma('foreign_keys = ON'); db.exec(CANONICAL_TABLES_SQL); db.exec(MIGRATION_TABLE_SQL);
    const insertMigration = db.prepare('INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(?,?,?,?)');
    for (const migration of MIGRATIONS.filter(item => item.version < 88)) insertMigration.run(migration.version, migration.name, migrationChecksum(migration), now);
    db.pragma('user_version = 87'); db.prepare("INSERT INTO parts (model, category, supplier, price, stock, created_at, updated_at) VALUES ('legacy-part', '五金', 'fixture', 1, 1, ?, ?)").run(now, now);
    const backup = await createDatabaseBackup(db, { type: 'release', root: backupRoot, now, sourcePath, gitCommit: '9229c625e0bcb3dfb4aa2bd406a1a14e2101cb95', prune: false });
    assert.equal(runMigrations(db).currentVersion, 88); assert.equal(runMigrations(db).appliedVersions.length, 0); assert.equal(db.pragma('user_version', { simple: true }), 88); assert.equal(db.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='table' AND name IN ('ai_tasks','ai_task_steps','ai_task_evidence','ai_task_events')").get().count, 4); assert.equal(db.pragma('integrity_check', { simple: true }), 'ok'); assert.equal(db.pragma('foreign_key_check').length, 0); db.close();
    await restoreDatabaseBackup({ confirmation: RESTORE_CONFIRMATION, root: backupRoot, backupPath: backup.path, targetPath: restorePath, skipPortCheck: true, now, currentGitCommit: '9229c625e0bcb3dfb4aa2bd406a1a14e2101cb95' });
    const restored = new Database(restorePath, { readonly: true }); assert.equal(restored.prepare("SELECT COUNT(*) count FROM parts WHERE model='legacy-part'").get().count, 1); assert.equal(restored.prepare("SELECT COUNT(*) count FROM sqlite_schema WHERE type='table' AND name='ai_tasks'").get().count, 0); restored.close(); fs.rmSync(root, { recursive: true, force: true });
});
