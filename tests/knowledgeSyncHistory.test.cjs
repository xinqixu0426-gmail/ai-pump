const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    MAX_RETAINED_RUNS,
    listKnowledgeSyncRuns,
    recordKnowledgeSyncRun,
} = require('../api/services/knowledgeSyncHistory.cjs');

function runRow(row) {
    return {
        id: row.id,
        mode: row.mode,
        status: row.status,
        triggerSourcesJson: row.trigger_sources_json || '[]',
        sourceCount: Number(row.source_count || 0),
        attempt: Number(row.attempt || 1),
        totalCount: Number(row.total_count || 0),
        insertedCount: Number(row.inserted_count || 0),
        updatedCount: Number(row.updated_count || 0),
        unchangedCount: Number(row.unchanged_count || 0),
        deletedCount: Number(row.deleted_count || 0),
        ftsEnabled: Boolean(row.fts_enabled),
        durationMs: Number(row.duration_ms || 0),
        errorText: row.error_text || '',
        startedAt: row.started_at,
        completedAt: row.completed_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function createAccessors() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE knowledge_sync_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mode TEXT NOT NULL,
            status TEXT NOT NULL,
            trigger_sources_json TEXT DEFAULT '[]',
            source_count INTEGER NOT NULL DEFAULT 0,
            attempt INTEGER NOT NULL DEFAULT 1,
            total_count INTEGER NOT NULL DEFAULT 0,
            inserted_count INTEGER NOT NULL DEFAULT 0,
            updated_count INTEGER NOT NULL DEFAULT 0,
            unchanged_count INTEGER NOT NULL DEFAULT 0,
            deleted_count INTEGER NOT NULL DEFAULT 0,
            fts_enabled INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            error_text TEXT DEFAULT '',
            started_at TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);
    return {
        db,
        knowledgeSyncRunRow: runRow,
        safeInsert(table, values) {
            assert.equal(table, 'knowledge_sync_runs');
            const columns = Object.keys(values);
            return db.prepare(`
                INSERT INTO knowledge_sync_runs (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(column => values[column]));
        },
    };
}

test('Knowledge V4：同步历史保存统计、来源和错误详情', () => {
    const accessors = createAccessors();
    try {
        const success = recordKnowledgeSyncRun({
            mode: 'automatic',
            status: 'success',
            sources: ['parts:1', 'parts:1', 'recipes:2'],
            attempt: 2,
            durationMs: 18,
            startedAt: '2026-07-28T00:00:00.000Z',
            completedAt: '2026-07-28T00:00:00.018Z',
            result: {
                ftsEnabled: true,
                stats: { total: 10, inserted: 1, updated: 2, unchanged: 7, deleted: 0 },
            },
        }, { dbAccessors: accessors });
        recordKnowledgeSyncRun({
            mode: 'manual',
            status: 'failed',
            error: 'FTS 刷新失败',
            durationMs: 5,
            completedAt: '2026-07-28T00:01:00.000Z',
        }, { dbAccessors: accessors });

        const history = listKnowledgeSyncRuns({ limit: 10 }, { dbAccessors: accessors });
        assert.deepEqual(success.triggerSources, ['parts:1', 'recipes:2']);
        assert.equal(success.updatedCount, 2);
        assert.equal(success.attempt, 2);
        assert.equal(history.items.length, 2);
        assert.equal(history.items[0].status, 'failed');
        assert.match(history.items[0].errorText, /FTS/);
        assert.equal(history.stats.successCount, 1);
        assert.equal(history.stats.failedCount, 1);
    } finally {
        accessors.db.close();
    }
});

test('Knowledge V4：同步历史最多保留最近 200 次', () => {
    const accessors = createAccessors();
    try {
        for (let index = 0; index < MAX_RETAINED_RUNS + 5; index += 1) {
            const timestamp = new Date(Date.UTC(2026, 6, 28, 0, 0, index)).toISOString();
            recordKnowledgeSyncRun({
                mode: 'automatic',
                status: 'success',
                completedAt: timestamp,
                result: { stats: { total: index } },
            }, { dbAccessors: accessors });
        }
        const count = accessors.db.prepare('SELECT COUNT(*) AS count FROM knowledge_sync_runs').get().count;
        const oldest = accessors.db.prepare('SELECT MIN(total_count) AS value FROM knowledge_sync_runs').get().value;
        assert.equal(count, MAX_RETAINED_RUNS);
        assert.equal(oldest, 5);
    } finally {
        accessors.db.close();
    }
});
