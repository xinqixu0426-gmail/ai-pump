const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    QUOTATION_EXPIRY_CAPABILITY_ID,
    createQuotationExpiryMaintenance,
    expireOverdueQuotations,
    quotationExpiryCutoff,
} = require('../api/services/quotationExpiry.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE quotations (
            id INTEGER PRIMARY KEY,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_id TEXT,
            capability_id TEXT
        );
        CREATE TABLE api_operations (
            operation_id TEXT PRIMARY KEY,
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
    `);
    const insert = db.prepare(`
        INSERT INTO quotations (id, status, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, ?)
    `);
    insert.run(1, '报价中', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', null);
    insert.run(2, '报价中', '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z', null);
    insert.run(3, '已接受', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', null);
    insert.run(4, '报价中', '2026-05-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z');
    const updates = [];
    const safeUpdate = (table, id, values, auditContext = {}) => {
        assert.equal(table, 'quotations');
        updates.push({ id, values });
        db.prepare('UPDATE quotations SET status = ?, updated_at = ? WHERE id = ?')
            .run(values.status, '2026-08-02T00:00:00.000Z', id);
        const audit = db.prepare(`
            INSERT INTO audit_log (operation_id, capability_id)
            VALUES (?, ?)
        `).run(auditContext.operationId, auditContext.capabilityId);
        return {
            changes: 1,
            auditId: Number(audit.lastInsertRowid),
        };
    };
    return { db, safeUpdate, updates };
}

test('报价过期维护只更新超过一个月且仍在报价中的有效记录', () => {
    const fixture = createFixture();
    try {
        const now = new Date('2026-08-02T00:00:00.000Z');
        assert.equal(quotationExpiryCutoff(now).toISOString(), '2026-07-02T00:00:00.000Z');
        const result = expireOverdueQuotations({
            db: fixture.db,
            safeUpdate: fixture.safeUpdate,
            now,
        });
        assert.equal(result.status, 'completed');
        assert.equal(result.capabilityId, QUOTATION_EXPIRY_CAPABILITY_ID);
        assert.equal(result.expiredCount, 1);
        assert.deepEqual(result.quotationIds, [1]);
        assert.equal(result.changes[0].to, '已过时');
        assert.equal(result.auditIds.length, 1);
        assert.equal(fixture.db.prepare('SELECT status FROM quotations WHERE id = 1').get().status, '已过时');
        assert.equal(fixture.db.prepare('SELECT status FROM quotations WHERE id = 2').get().status, '报价中');
        assert.equal(fixture.updates.length, 1);
    } finally {
        fixture.db.close();
    }
});

test('报价过期维护的批量更新在失败时整体回滚', () => {
    const fixture = createFixture();
    try {
        fixture.db.prepare(
            "INSERT INTO quotations (id, status, created_at) VALUES (5, '报价中', '2026-04-01T00:00:00.000Z')"
        ).run();
        let calls = 0;
        const failingUpdate = (_table, id, values) => {
            calls += 1;
            fixture.db.prepare('UPDATE quotations SET status = ? WHERE id = ?').run(values.status, id);
            if (calls === 2) throw new Error('模拟维护失败');
        };
        assert.throws(() => expireOverdueQuotations({
            db: fixture.db,
            safeUpdate: failingUpdate,
            now: new Date('2026-08-02T00:00:00.000Z'),
        }), /模拟维护失败/);
        const statuses = fixture.db.prepare('SELECT id, status FROM quotations WHERE id IN (1, 5) ORDER BY id').all();
        assert.deepEqual(statuses, [
            { id: 1, status: '报价中' },
            { id: 5, status: '报价中' },
        ]);
    } finally {
        fixture.db.close();
    }
});

test('报价过期维护使用持久幂等回放首次结果且不重复更新', () => {
    const fixture = createFixture();
    try {
        const commandContext = {
            actorKey: 'system:quotation-expiry',
            idempotencyKey: 'quotation-expiry:scheduled:2026-08-02',
            operationId: 'quotation-expiry-operation-1',
        };
        const first = expireOverdueQuotations({
            db: fixture.db,
            safeUpdate: fixture.safeUpdate,
            now: new Date('2026-08-02T00:00:00.000Z'),
            trigger: 'scheduled',
            commandContext,
        });
        const replay = expireOverdueQuotations({
            db: fixture.db,
            safeUpdate: fixture.safeUpdate,
            now: new Date('2026-08-02T00:01:00.000Z'),
            trigger: 'scheduled',
            commandContext: {
                ...commandContext,
                operationId: 'quotation-expiry-operation-2',
            },
        });

        assert.equal(first.idempotentReplay, false);
        assert.equal(replay.idempotentReplay, true);
        assert.equal(replay.operationId, first.operationId);
        assert.deepEqual(replay.quotationIds, [1]);
        assert.equal(fixture.updates.length, 1);
        assert.equal(
            fixture.db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count,
            1
        );
    } finally {
        fixture.db.close();
    }
});

test('报价过期调度器启动补跑、链式安排并可停止', () => {
    const timers = [];
    const cleared = [];
    const calls = [];
    const fixedNow = new Date('2026-08-01T16:00:00.000Z');
    const maintenance = createQuotationExpiryMaintenance({
        run: (now, trigger) => {
            calls.push({ now: now.toISOString(), trigger });
            return {
                operationId: 'op-1',
                cutoff: '2026-07-02T00:00:00.000Z',
                expiredCount: 0,
            };
        },
        now: () => fixedNow,
        setTimer: (callback, delay) => {
            const handle = { callback, delay, unref() {} };
            timers.push(handle);
            return handle;
        },
        clearTimer: handle => cleared.push(handle),
    });

    maintenance.start();
    assert.deepEqual(calls, [{
        now: '2026-08-01T16:00:00.000Z',
        trigger: 'startup',
    }]);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].delay, 5 * 60 * 1000);
    assert.equal(maintenance.isStarted(), true);
    maintenance.stop();
    assert.deepEqual(cleared, [timers[0]]);
    assert.equal(maintenance.isStarted(), false);
});
