const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
    BUSINESS_CHANGE_INDEXES_SQL,
    BUSINESS_CHANGE_SCHEMA_SQL,
} = require('../api/database/schema.cjs');
const { executePersistentCommand } = require('../api/services/commandExecution.cjs');
const { MIGRATIONS, runMigrations } = require('../api/database/migrations.cjs');
const {
    businessChangeKnowledgeEntries,
    listBusinessChanges,
    recordBusinessChangeEvent,
    standardBusinessChange,
} = require('../api/services/businessChanges.cjs');

function buildDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE api_operations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_id TEXT NOT NULL,
            capability_id TEXT NOT NULL,
            actor_key TEXT NOT NULL,
            idempotency_key TEXT NOT NULL,
            request_hash TEXT NOT NULL,
            request_id TEXT,
            status TEXT NOT NULL,
            response_json TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            expires_at TEXT NOT NULL,
            UNIQUE(actor_key, capability_id, idempotency_key)
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action TEXT NOT NULL,
            table_name TEXT,
            record_id INTEGER,
            old_value TEXT,
            new_value TEXT,
            user TEXT,
            request_id TEXT,
            operation_id TEXT,
            capability_id TEXT,
            created_at TEXT
        );
        CREATE TABLE parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            model TEXT NOT NULL,
            created_at TEXT,
            updated_at TEXT
        );
        ${BUSINESS_CHANGE_SCHEMA_SQL}
        ${BUSINESS_CHANGE_INDEXES_SQL}
    `);
    return db;
}

function executePartUpdate(db, overrides = {}) {
    return executePersistentCommand({
        db,
        capabilityId: 'parts.update',
        actorKey: 'user:admin',
        idempotencyKey: overrides.idempotencyKey || 'part-update-0001',
        operationId: overrides.operationId || 'operation-part-0001',
        input: { partId: 1, price: 12 },
        now: new Date('2026-08-23T02:30:00.000Z'),
        businessChange: standardBusinessChange({
            domain: 'part',
            eventType: 'updated',
            reason: '供应商调价',
        }),
        requestKnowledgeSync: overrides.requestKnowledgeSync,
        execute: ({ auditContext }) => {
            if (!db.prepare('SELECT id FROM parts WHERE id = 1').get()) {
                db.prepare('INSERT INTO parts (id, model, created_at, updated_at) VALUES (1, ?, ?, ?)')
                    .run('轴承 6204', '2026-08-23T02:00:00.000Z', '2026-08-23T02:00:00.000Z');
            }
            const audit = db.prepare(`
                INSERT INTO audit_log (
                    action, table_name, record_id, old_value, new_value, user,
                    request_id, operation_id, capability_id, created_at
                ) VALUES ('UPDATE', 'parts', 1, '{}', '{"price":12}', ?, ?, ?, ?, ?)
            `).run(
                auditContext.user,
                auditContext.requestId,
                auditContext.operationId,
                auditContext.capabilityId,
                '2026-08-23T02:30:00.000Z'
            );
            return {
                data: { part: { id: 1, model: '轴承 6204' } },
                resource: { type: 'part', ids: [1] },
                changes: [{ resourceType: 'part', resourceId: 1, field: 'price', from: 10, to: 12 }],
                auditIds: [Number(audit.lastInsertRowid)],
            };
        },
    });
}

test('业务变更：命令、审计、事件和实体引用在同一事务内提交', () => {
    const db = buildDb();
    const receipt = executePartUpdate(db);
    assert.equal(receipt.businessChangeEvent.primaryDomain, 'part');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_change_events').get().count, 1);
    const event = db.prepare('SELECT * FROM business_change_events').get();
    assert.equal(event.operation_id, receipt.operationId);
    assert.equal(event.reason, '供应商调价');
    const ref = db.prepare('SELECT * FROM business_change_event_entities').get();
    assert.equal(ref.entity_type, 'part');
    assert.equal(ref.entity_label, '零件 轴承 6204（#1）');
    assert.throws(
        () => db.prepare("UPDATE business_change_events SET summary = '篡改' WHERE id = ?").run(event.id),
        /immutable/
    );
    assert.throws(() => db.prepare('DELETE FROM business_change_events WHERE id = ?').run(event.id), /immutable/);
    assert.throws(() => db.prepare("UPDATE business_change_event_entities SET entity_label = '篡改' WHERE id = ?").run(ref.id), /immutable/);
    assert.throws(() => db.prepare('DELETE FROM business_change_event_entities WHERE id = ?').run(ref.id), /immutable/);
    db.close();
});

test('业务变更：事务提交后请求知识和向量投影且同步失败不回滚业务事实', () => {
    const db = buildDb();
    const requests = [];
    const receipt = executePartUpdate(db, {
        requestKnowledgeSync(change) {
            requests.push(change);
            throw new Error('模拟向量服务暂时不可用');
        },
    });
    assert.equal(receipt.status, 'completed');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_change_events').get().count, 1);
    assert.deepEqual(requests, [{
        sourceTable: 'business_change_events',
        sourceId: receipt.businessChangeEvent.id,
        reason: 'command_completed',
    }]);
    db.close();
});

test('业务变更：幂等重放和空操作不会重复生成事件', () => {
    const db = buildDb();
    const first = executePartUpdate(db);
    const replay = executePartUpdate(db);
    assert.equal(first.idempotentReplay, false);
    assert.equal(replay.idempotentReplay, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_change_events').get().count, 1);

    executePersistentCommand({
        db,
        capabilityId: 'parts.update',
        actorKey: 'user:admin',
        idempotencyKey: 'part-update-noop',
        operationId: 'operation-part-noop',
        input: { partId: 1 },
        businessChange: standardBusinessChange({ domain: 'part', eventType: 'updated' }),
        execute: () => ({
            data: { part: { id: 1 } },
            resource: { type: 'part', ids: [1] },
            changes: [],
            auditIds: [],
            requiredAuditCount: 0,
        }),
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_change_events').get().count, 1);
    db.close();
});

test('业务变更：强审计失败时事件与 operation 一起回滚', () => {
    const db = buildDb();
    assert.throws(() => executePersistentCommand({
        db,
        capabilityId: 'parts.update',
        actorKey: 'user:admin',
        idempotencyKey: 'part-update-failed',
        operationId: 'operation-part-failed',
        input: { partId: 1 },
        businessChange: standardBusinessChange({ domain: 'part', eventType: 'updated' }),
        execute: () => ({
            resource: { type: 'part', ids: [1] },
            changes: [{ resourceType: 'part', resourceId: 1, field: 'price', from: 10, to: 12 }],
            auditIds: [],
        }),
    }), /强审计/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_change_events').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    db.close();
});

test('业务变更：已登记正式业务命令缺少描述符时整体回滚', () => {
    const db = buildDb();
    assert.throws(() => executePersistentCommand({
        db,
        capabilityId: 'parts.create',
        actorKey: 'test:user',
        idempotencyKey: 'missing-business-change-descriptor',
        input: { model: 'P-002' },
        execute: ({ auditContext }) => {
            const part = db.prepare("INSERT INTO parts (model) VALUES ('P-002')").run();
            const audit = db.prepare(`
                INSERT INTO audit_log (action, table_name, record_id, operation_id, capability_id)
                VALUES ('INSERT', 'parts', ?, ?, 'parts.create')
            `).run(part.lastInsertRowid, auditContext.operationId);
            return {
                changes: [{ resourceType: 'part', resourceId: Number(part.lastInsertRowid), field: 'created', from: null, to: true }],
                auditIds: [Number(audit.lastInsertRowid)],
            };
        },
    }), error => error?.code === 'business_change_descriptor_required');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM parts').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_change_events').get().count, 0);
});

test('业务变更：北京时间 today、实体过滤和知识投影使用同一事件源', () => {
    const db = buildDb();
    executePartUpdate(db);
    const page = listBusinessChanges(db, {
        period: 'today',
        domain: 'part',
        entityType: 'part',
        entityId: '1',
    }, { now: new Date('2026-08-23T03:00:00.000Z') });
    assert.equal(page.total, 1);
    assert.equal(page.items[0].entities[0].entityLabel, '零件 轴承 6204（#1）');
    assert.equal(page.appliedFilters.from, '2026-08-22T16:00:00.000Z');
    const entries = businessChangeKnowledgeEntries(db);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, page.items[0].id);
    assert.match(entries[0].content, /供应商调价/);
    db.close();
});

test('业务变更：分页按 occurredAt 和 id 的复合顺序稳定前进', () => {
    const db = buildDb();
    for (const event of [
        { operationId: 'event-newer-inserted-first', occurredAt: '2026-08-23T03:00:00.000Z' },
        { operationId: 'event-older-inserted-later', occurredAt: '2026-08-22T03:00:00.000Z' },
    ]) {
        recordBusinessChangeEvent(db, {
            ...event,
            capabilityId: 'parts.update',
            actorKey: 'test:user',
            changes: [{ resourceType: 'part', resourceId: 1, field: 'price', from: 10, to: 11 }],
            auditIds: [1],
            descriptor: { domain: 'part', eventType: 'updated', entityRefs: [{ entityType: 'part', entityId: 1, role: 'primary' }] },
        });
    }
    const first = listBusinessChanges(db, { period: 'all', limit: 1 });
    const second = listBusinessChanges(db, { period: 'all', limit: 1, beforeId: first.nextCursor });
    assert.equal(first.items[0].operationId, 'event-newer-inserted-first');
    assert.equal(second.items[0].operationId, 'event-older-inserted-later');
    db.close();
});

test('业务变更迁移：只从不可变订单修订安全补录历史', () => {
    const db = new Database(':memory:');
    runMigrations(db);
    const now = '2026-08-20T02:00:00.000Z';
    db.prepare(`
        INSERT INTO orders (
            customer_name, contract_no, status, items_json, purchase_list_json,
            todos_json, created_at, updated_at
        ) VALUES ('历史客户', 'HT-001', '待确认', '[]', '[]', '[]', ?, ?)
    `).run(now, now);
    db.prepare(`
        INSERT INTO order_revisions (
            order_id, revision_no, reason, before_snapshot_json, after_snapshot_json,
            change_summary_json, operation_id, actor, created_at
        ) VALUES (1, 1, '客户改用不锈钢接轴', '{}', '{}', ?, 'historical-order-operation', 'user:admin', ?)
    `).run(JSON.stringify([{ field: 'configuration', description: '接轴调整为不锈钢' }]), now);
    const migration = MIGRATIONS.find(item => item.version === 67);
    migration.up(db);
    migration.up(db);
    const event = db.prepare(`
        SELECT * FROM business_change_events WHERE operation_id = 'historical-order-operation'
    `).get();
    assert.equal(event.source_type, 'order_revision_backfill');
    assert.equal(event.reason, '客户改用不锈钢接轴');
    assert.equal(db.prepare(`
        SELECT COUNT(*) AS count FROM business_change_events
        WHERE operation_id = 'historical-order-operation'
    `).get().count, 1);
    assert.equal(db.prepare(`
        SELECT COUNT(*) AS count FROM business_change_event_entities
        WHERE event_id = ?
    `).get(event.id).count, 1);
    assert.deepEqual(JSON.parse(event.detail_ref_json), {
        type: 'order_revision', id: 1, orderId: 1, revisionNo: 1,
    });
    db.close();
});
