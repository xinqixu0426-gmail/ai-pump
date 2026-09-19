const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    buildKnowledgeVectorHealth,
    loadVectorExtension,
    searchStoredEmbeddings,
    vectorBuffer,
    vectorCoverage,
} = require('../api/services/knowledgeVectorStore.cjs');

function openFixture() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE knowledge_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_type TEXT NOT NULL,
            source_table TEXT NOT NULL,
            source_id TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT DEFAULT '',
            content_hash TEXT NOT NULL
        );
        CREATE TABLE knowledge_embeddings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            content_hash TEXT NOT NULL,
            embedding BLOB NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(entry_id, model),
            FOREIGN KEY(entry_id) REFERENCES knowledge_entries(id) ON DELETE CASCADE
        );
    `);
    return db;
}

function insertEntry(db, values) {
    const info = db.prepare(`
        INSERT INTO knowledge_entries(
            entry_type, source_table, source_id, title, summary, content_hash
        ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
        values.entryType,
        values.sourceTable,
        values.sourceId,
        values.title,
        values.summary || '',
        values.contentHash
    );
    return Number(info.lastInsertRowid);
}

function insertEmbedding(db, entryId, contentHash, vector, model = 'test/e5') {
    const now = '2026-07-29T00:00:00.000Z';
    db.prepare(`
        INSERT INTO knowledge_embeddings(
            entry_id, model, dimensions, content_hash, embedding, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entryId, model, vector.length, contentHash, vectorBuffer(vector), now, now);
}

test('向量存储：sqlite-vec 对当前模型执行精确余弦排序和业务过滤', () => {
    const db = openFixture();
    try {
        const shellId = insertEntry(db, {
            entryType: 'part',
            sourceTable: 'parts',
            sourceId: '1',
            title: '800 平刀切割泵壳',
            contentHash: 'hash-shell',
        });
        const ruleId = insertEntry(db, {
            entryType: 'business_rule',
            sourceTable: 'business_rules',
            sourceId: 'cable',
            title: '成品电缆规则',
            contentHash: 'hash-rule',
        });
        insertEmbedding(db, shellId, 'hash-shell', Float32Array.from([1, 0, 0]));
        insertEmbedding(db, ruleId, 'hash-rule', Float32Array.from([0, 1, 0]));

        const result = searchStoredEmbeddings(
            db,
            Float32Array.from([0.9, 0.1, 0]),
            { model: 'test/e5', dimensions: 3, limit: 10 }
        );
        assert.equal(result.extension.available, true);
        assert.match(result.extension.version, /^v?\d+\.\d+\.\d+/);
        assert.deepEqual(result.results.map(item => item.id), [shellId, ruleId]);
        assert.ok(result.results[0].vectorDistance < result.results[1].vectorDistance);

        const filtered = searchStoredEmbeddings(
            db,
            Float32Array.from([0, 1, 0]),
            {
                model: 'test/e5',
                dimensions: 3,
                entryType: 'business_rule',
                sourceTable: 'business_rules',
            }
        );
        assert.deepEqual(filtered.results.map(item => item.id), [ruleId]);
    } finally {
        db.close();
    }
});

test('向量存储：覆盖率按内容哈希区分新鲜、过期和待生成', () => {
    const db = openFixture();
    try {
        const freshId = insertEntry(db, {
            entryType: 'recipe',
            sourceTable: 'recipes',
            sourceId: '1',
            title: '配方一',
            contentHash: 'fresh',
        });
        const staleId = insertEntry(db, {
            entryType: 'recipe',
            sourceTable: 'recipes',
            sourceId: '2',
            title: '配方二',
            contentHash: 'new',
        });
        insertEntry(db, {
            entryType: 'recipe',
            sourceTable: 'recipes',
            sourceId: '3',
            title: '配方三',
            contentHash: 'pending',
        });
        insertEmbedding(db, freshId, 'fresh', Float32Array.from([1, 0]));
        insertEmbedding(db, staleId, 'old', Float32Array.from([0, 1]));

        assert.deepEqual(vectorCoverage(db, 'test/e5'), {
            totalEntries: 3,
            embeddedEntries: 2,
            freshEntries: 1,
            staleEntries: 1,
            pendingEntries: 2,
            coveragePercent: 33.3,
        });
    } finally {
        db.close();
    }
});

test('向量存储：扩展不可用时健康检查保持 FTS 回退', () => {
    const db = openFixture();
    try {
        const sqliteVec = {
            load() {
                throw new Error('当前平台没有 sqlite-vec');
            },
        };
        const extension = loadVectorExtension(db, { sqliteVec });
        assert.equal(extension.available, false);
        assert.match(extension.error, /没有 sqlite-vec/);

        const provider = {
            getStatus() {
                return {
                    enabled: true,
                    runtimeAvailable: true,
                    model: 'test/e5',
                    dimensions: 3,
                    loaded: false,
                    ready: false,
                };
            },
        };
        const health = buildKnowledgeVectorHealth(db, provider);
        assert.equal(health.operational, false);
        assert.equal(health.searchMode, 'fts');
        assert.match(health.message, /继续使用 FTS/);
    } finally {
        db.close();
    }
});
