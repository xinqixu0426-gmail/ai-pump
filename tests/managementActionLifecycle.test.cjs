const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildManagementActionProgress,
    createManagementActionLifecycleMonitor,
    decorateManagementActionCenter,
    lifecycleOverview,
    listManagementActionLifecycles,
    shouldRecheckManagementActions,
    syncManagementActionLifecycles,
} = require('../api/services/managementActionLifecycle.cjs');

function lifecycleRow(row) {
    return {
        id: row.id,
        actionKey: row.action_key,
        status: row.status,
        category: row.category,
        sourceType: row.source_type,
        entityType: row.entity_type,
        entityId: row.entity_id,
        title: row.title,
        priority: row.priority,
        occurrenceCount: Number(row.occurrence_count),
        firstSeenAt: row.first_seen_at,
        activeSince: row.active_since,
        resolvedAt: row.resolved_at,
        lastReopenedAt: row.last_reopened_at,
        snapshotJson: row.snapshot_json,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function createAccessors() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE management_action_lifecycles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_key TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL,
            category TEXT NOT NULL,
            source_type TEXT NOT NULL,
            entity_type TEXT DEFAULT '',
            entity_id TEXT DEFAULT '',
            title TEXT NOT NULL,
            priority TEXT NOT NULL,
            occurrence_count INTEGER NOT NULL DEFAULT 1,
            first_seen_at TEXT NOT NULL,
            active_since TEXT NOT NULL,
            resolved_at TEXT,
            last_reopened_at TEXT,
            snapshot_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE management_action_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lifecycle_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            snapshot_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            FOREIGN KEY(lifecycle_id) REFERENCES management_action_lifecycles(id) ON DELETE CASCADE
        );
    `);
    function safeInsert(table, values) {
        const columns = Object.keys(values);
        return db.prepare(`
            INSERT INTO ${table} (${columns.join(', ')})
            VALUES (${columns.map(() => '?').join(', ')})
        `).run(...columns.map(column => values[column]));
    }
    function safeUpdate(table, id, values) {
        const updates = { ...values, updated_at: new Date().toISOString() };
        const columns = Object.keys(updates);
        db.prepare(`
            UPDATE ${table}
            SET ${columns.map(column => `${column} = ?`).join(', ')}
            WHERE id = ?
        `).run(...columns.map(column => updates[column]), id);
    }
    return {
        db,
        safeInsert,
        safeUpdate,
        managementActionLifecycleRow: lifecycleRow,
    };
}

function item(overrides = {}) {
    return {
        id: 'data-quality:missing-price',
        priority: 'high',
        category: 'data_quality',
        categoryLabel: '数据质量',
        title: '零件缺少价格（2 项）',
        detail: '补齐零件价格。',
        action: '进入数据质量查看明细',
        owner: '资料管理员',
        path: '/dashboard?view=quality',
        count: 2,
        entityType: 'quality_issue',
        entityId: 'missing-price',
        sourceType: 'data_quality',
        ...overrides,
    };
}

test('V7.1：管理待办记录首次出现、消失和再次出现', () => {
    const dbAccessors = createAccessors();
    try {
        const first = syncManagementActionLifecycles({
            dbAccessors,
            items: [item()],
            now: new Date('2026-07-29T01:00:00.000Z'),
        });
        const unchanged = syncManagementActionLifecycles({
            dbAccessors,
            items: [item()],
            now: new Date('2026-07-29T01:05:00.000Z'),
        });
        const resolved = syncManagementActionLifecycles({
            dbAccessors,
            items: [],
            now: new Date('2026-07-29T02:00:00.000Z'),
        });
        const reopened = syncManagementActionLifecycles({
            dbAccessors,
            items: [item({ title: '零件缺少价格（1 项）', count: 1 })],
            now: new Date('2026-07-30T01:00:00.000Z'),
        });

        const lifecycle = listManagementActionLifecycles({}, { dbAccessors })[0];
        const events = dbAccessors.db.prepare(`
            SELECT event_type, occurred_at
            FROM management_action_events
            ORDER BY id
        `).all();

        assert.equal(first.stats.appeared, 1);
        assert.equal(unchanged.stats.unchanged, 1);
        assert.equal(resolved.stats.resolved, 1);
        assert.equal(reopened.stats.reopened, 1);
        assert.equal(lifecycle.status, 'active');
        assert.equal(lifecycle.occurrenceCount, 2);
        assert.equal(lifecycle.firstSeenAt, '2026-07-29T01:00:00.000Z');
        assert.equal(lifecycle.activeSince, '2026-07-30T01:00:00.000Z');
        assert.equal(lifecycle.lastReopenedAt, '2026-07-30T01:00:00.000Z');
        assert.deepEqual(events.map(event => event.event_type), ['appeared', 'resolved', 'reopened']);
    } finally {
        dbAccessors.db.close();
    }
});

test('V7.1：当前待办只读附加持续时间，最近消失记录仍可追溯', () => {
    const dbAccessors = createAccessors();
    try {
        syncManagementActionLifecycles({
            dbAccessors,
            items: [item(), item({ id: 'knowledge-health:failed', title: '知识同步失败' })],
            now: new Date('2026-07-29T01:00:00.000Z'),
        });
        syncManagementActionLifecycles({
            dbAccessors,
            items: [item()],
            now: new Date('2026-07-29T02:00:00.000Z'),
        });
        const center = decorateManagementActionCenter({
            generatedAt: '2026-07-29T03:00:00.000Z',
            summary: '当前有 1 项管理待办。',
            metrics: { total: 1 },
            items: [item()],
        }, {
            dbAccessors,
            monitorStatus: {
                lastCompletedAt: '2026-07-29T02:00:00.000Z',
                lastError: '',
            },
        });

        assert.equal(center.items[0].lifecycle.activeSince, '2026-07-29T01:00:00.000Z');
        assert.equal(center.lifecycle.activeCount, 1);
        assert.equal(center.lifecycle.resolvedCount, 1);
        assert.equal(center.lifecycle.recentResolved[0].title, '知识同步失败');
        assert.equal(center.executionQueue.items[0].id, 'data-quality:missing-price');
        assert.match(center.executionQueue.summary, /当前最先处理/);
        assert.equal(center.progress.resolvedCount, 1);
        assert.equal(center.progress.unresolvedCount, 1);
        assert.match(center.progress.summary, /自动归档 1 项/);
        assert.equal(lifecycleOverview({ dbAccessors }).totalCount, 2);
    } finally {
        dbAccessors.db.close();
    }
});

test('V7.4：进展汇总区分仍待处理、暂时受阻和反复出现', () => {
    const dbAccessors = createAccessors();
    try {
        const recurringItem = item({
            resolution: {
                mode: 'needs_input',
                title: '确认合理价格',
            },
        });
        syncManagementActionLifecycles({
            dbAccessors,
            items: [recurringItem],
            now: new Date('2026-07-28T01:00:00.000Z'),
        });
        syncManagementActionLifecycles({
            dbAccessors,
            items: [],
            now: new Date('2026-07-28T02:00:00.000Z'),
        });
        syncManagementActionLifecycles({
            dbAccessors,
            items: [recurringItem],
            now: new Date('2026-07-29T01:00:00.000Z'),
        });
        const lifecycle = listManagementActionLifecycles(
            { status: 'active' },
            { dbAccessors }
        )[0];
        const center = {
            generatedAt: '2026-07-29T03:00:00.000Z',
            items: [{ ...recurringItem, lifecycle }],
        };
        const progress = buildManagementActionProgress(center, { dbAccessors });

        assert.equal(progress.resolvedCount, 0);
        assert.equal(progress.unresolvedCount, 1);
        assert.equal(progress.blockedCount, 1);
        assert.equal(progress.recurringCount, 1);
        assert.equal(progress.recurringItems[0].occurrenceCount, 2);
        assert.match(progress.summary, /1 项暂时受阻/);
        assert.match(progress.summary, /1 项曾反复出现/);
    } finally {
        dbAccessors.db.close();
    }
});

test('V7.4：只有成功的核心业务写请求触发自动复查', () => {
    assert.equal(shouldRecheckManagementActions({
        method: 'PATCH',
        path: '/api/orders/12',
        statusCode: 200,
    }), true);
    assert.equal(shouldRecheckManagementActions({
        method: 'POST',
        path: '/api/recipes/8?preview=false',
        statusCode: 201,
    }), true);
    assert.equal(shouldRecheckManagementActions({
        method: 'GET',
        path: '/api/orders/12',
        statusCode: 200,
    }), false);
    assert.equal(shouldRecheckManagementActions({
        method: 'POST',
        path: '/api/orders/12',
        statusCode: 400,
    }), false);
    assert.equal(shouldRecheckManagementActions({
        method: 'POST',
        path: '/api/ai/chat',
        statusCode: 200,
    }), false);
    assert.equal(shouldRecheckManagementActions({
        method: 'POST',
        path: '/api/recipes/bom-draft',
        statusCode: 200,
    }), false);
    assert.equal(shouldRecheckManagementActions({
        method: 'POST',
        path: '/api/orders/purchase-plan',
        statusCode: 200,
    }), false);
    assert.equal(shouldRecheckManagementActions({
        method: 'POST',
        path: '/api/quality/recipe-analysis',
        statusCode: 200,
    }), false);
});

test('V7.1：后台监控失败可诊断且仍安排下一次核对', async () => {
    const timers = [];
    const monitor = createManagementActionLifecycleMonitor({
        intervalMs: 1000,
        setTimer(callback, delay) {
            timers.push({ callback, delay });
            return { unref() {} };
        },
        clearTimer() {},
        sync() {
            throw new Error('测试失败');
        },
        logger: { info() {}, error() {} },
    });

    const result = await monitor.run();
    const status = monitor.getStatus();

    assert.equal(result.success, false);
    assert.match(status.lastError, /测试失败/);
    assert.equal(status.scheduled, true);
    assert.equal(timers.at(-1).delay, 1000);
});

test('V7.4：连续业务操作合并为一次短延迟复查', () => {
    const timers = [];
    let clearCount = 0;
    const monitor = createManagementActionLifecycleMonitor({
        intervalMs: 5000,
        recheckDelayMs: 250,
        setTimer(callback, delay) {
            const timer = { callback, delay, unref() {} };
            timers.push(timer);
            return timer;
        },
        clearTimer() {
            clearCount += 1;
        },
        sync() {
            return { syncedAt: '2026-07-29T03:00:00.000Z', stats: {} };
        },
        logger: { info() {}, error() {} },
    });

    monitor.start();
    monitor.request('patch:/api/orders/1');
    monitor.request('patch:/api/orders/1');
    const status = monitor.getStatus();

    assert.equal(timers.at(-1).delay, 250);
    assert.equal(clearCount, 2);
    assert.equal(status.lastRequestReason, 'patch:/api/orders/1');
    assert.equal(status.scheduled, true);
});
