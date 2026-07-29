const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    MAX_RETAINED_VECTOR_RUNS,
    listKnowledgeVectorSyncRuns,
    recordKnowledgeVectorSyncRun,
} = require('../api/services/knowledgeVectorSyncHistory.cjs');

function rowAdapter(row) {
    return {
        id: row.id,
        status: row.status,
        model: row.model,
        dimensions: Number(row.dimensions),
        totalCount: Number(row.total_count),
        insertedCount: Number(row.inserted_count),
        updatedCount: Number(row.updated_count),
        unchangedCount: Number(row.unchanged_count),
        deletedCount: Number(row.deleted_count),
        failedCount: Number(row.failed_count),
        pendingCount: Number(row.pending_count),
        durationMs: Number(row.duration_ms),
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
        CREATE TABLE knowledge_vector_sync_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT NOT NULL,
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            total_count INTEGER NOT NULL DEFAULT 0,
            inserted_count INTEGER NOT NULL DEFAULT 0,
            updated_count INTEGER NOT NULL DEFAULT 0,
            unchanged_count INTEGER NOT NULL DEFAULT 0,
            deleted_count INTEGER NOT NULL DEFAULT 0,
            failed_count INTEGER NOT NULL DEFAULT 0,
            pending_count INTEGER NOT NULL DEFAULT 0,
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
        knowledgeVectorSyncRunRow: rowAdapter,
        safeInsert(table, values) {
            assert.equal(table, 'knowledge_vector_sync_runs');
            const columns = Object.keys(values);
            return db.prepare(`
                INSERT INTO knowledge_vector_sync_runs (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(column => values[column]));
        },
    };
}

test('Knowledge V6.2：向量同步历史保存完整统计和错误', () => {
    const accessors = createAccessors();
    try {
        const success = recordKnowledgeVectorSyncRun({
            status: 'success',
            model: 'test/e5',
            dimensions: 384,
            durationMs: 20,
            stats: {
                total: 10,
                inserted: 3,
                updated: 2,
                unchanged: 5,
                deleted: 1,
                failed: 0,
                pending: 0,
            },
        }, { dbAccessors: accessors });
        recordKnowledgeVectorSyncRun({
            status: 'failed',
            model: 'test/e5',
            dimensions: 384,
            error: new Error('模型加载失败'),
            stats: {
                total: 10,
                failed: 10,
                pending: 10,
            },
        }, { dbAccessors: accessors });

        const history = listKnowledgeVectorSyncRuns({ limit: 10 }, { dbAccessors: accessors });
        assert.equal(success.insertedCount, 3);
        assert.equal(success.deletedCount, 1);
        assert.equal(history.items[0].status, 'failed');
        assert.equal(history.items[0].failedCount, 10);
        assert.match(history.items[0].errorText, /模型加载失败/);
        assert.equal(history.stats.successCount, 1);
        assert.equal(history.stats.failedCount, 1);
    } finally {
        accessors.db.close();
    }
});

test('Knowledge V6.2：向量同步历史最多保留最近 200 次', () => {
    const accessors = createAccessors();
    try {
        for (let index = 0; index < MAX_RETAINED_VECTOR_RUNS + 3; index += 1) {
            const timestamp = new Date(Date.UTC(2026, 6, 29, 0, 0, index)).toISOString();
            recordKnowledgeVectorSyncRun({
                status: 'success',
                model: 'test/e5',
                dimensions: 384,
                completedAt: timestamp,
                stats: { total: index },
            }, { dbAccessors: accessors });
        }
        const row = accessors.db.prepare(`
            SELECT COUNT(*) AS count, MIN(total_count) AS oldest
            FROM knowledge_vector_sync_runs
        `).get();
        assert.equal(row.count, MAX_RETAINED_VECTOR_RUNS);
        assert.equal(row.oldest, 3);
    } finally {
        accessors.db.close();
    }
});
