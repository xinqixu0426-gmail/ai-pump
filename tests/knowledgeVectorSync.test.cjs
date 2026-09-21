const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    KnowledgeVectorSyncError,
    planKnowledgeVectorSync,
    syncKnowledgeEmbeddings,
} = require('../api/services/knowledgeVectorSync.cjs');

function createAccessors() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE knowledge_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            summary TEXT DEFAULT '',
            content TEXT DEFAULT '',
            search_text TEXT DEFAULT '',
            tags_json TEXT DEFAULT '[]',
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
    return {
        db,
        safeInsert(table, values) {
            assert.equal(table, 'knowledge_embeddings');
            const columns = Object.keys(values);
            return db.prepare(`
                INSERT INTO knowledge_embeddings (${columns.join(', ')})
                VALUES (${columns.map(() => '?').join(', ')})
            `).run(...columns.map(column => values[column]));
        },
        safeUpdate(table, id, values) {
            assert.equal(table, 'knowledge_embeddings');
            const columns = Object.keys(values);
            db.prepare(`
                UPDATE knowledge_embeddings
                SET ${columns.map(column => `${column} = ?`).join(', ')}, updated_at = ?
                WHERE id = ?
            `).run(...columns.map(column => values[column]), new Date().toISOString(), id);
        },
        hardDelete(table, id) {
            assert.equal(table, 'knowledge_embeddings');
            db.prepare('DELETE FROM knowledge_embeddings WHERE id = ?').run(id);
        },
    };
}

function insertEntry(db, id, hash, title = `知识${id}`) {
    db.prepare(`
        INSERT INTO knowledge_entries(id, title, summary, content, search_text, tags_json, content_hash)
        VALUES (?, ?, '', ?, ?, '["测试"]', ?)
    `).run(id, title, `${title}正文`, `${title}检索文本`, hash);
}

function fakeProvider(model, options = {}) {
    let calls = 0;
    return {
        config: {
            enabled: true,
            model,
            dimensions: 3,
        },
        get calls() {
            return calls;
        },
        async embedPassages(texts) {
            calls += 1;
            if (options.failText && texts.some(text => text.includes(options.failText))) {
                throw new Error(`无法生成 ${options.failText}`);
            }
            return texts.map((text, index) => Float32Array.from([
                text.length,
                calls,
                index + 1,
            ]));
        },
    };
}

test('Knowledge V6.2：首次生成后按内容哈希跳过未变化知识', async () => {
    const accessors = createAccessors();
    try {
        insertEntry(accessors.db, 1, 'hash-1');
        insertEntry(accessors.db, 2, 'hash-2');
        const provider = fakeProvider('test/e5');

        const first = await syncKnowledgeEmbeddings({
            dbAccessors: accessors,
            provider,
            batchSize: 2,
        });
        const second = await syncKnowledgeEmbeddings({
            dbAccessors: accessors,
            provider,
            batchSize: 2,
        });

        assert.deepEqual(first.stats, {
            total: 2,
            inserted: 2,
            updated: 0,
            unchanged: 0,
            deleted: 0,
            failed: 0,
            pending: 0,
        });
        assert.equal(second.stats.unchanged, 2);
        assert.equal(second.stats.inserted, 0);
        assert.equal(provider.calls, 1);
    } finally {
        accessors.db.close();
    }
});

test('Knowledge V6.2：只重新生成内容哈希变化的条目并保留向量记录 ID', async () => {
    const accessors = createAccessors();
    try {
        insertEntry(accessors.db, 1, 'hash-1');
        insertEntry(accessors.db, 2, 'hash-2');
        const provider = fakeProvider('test/e5');
        await syncKnowledgeEmbeddings({ dbAccessors: accessors, provider });
        const before = accessors.db.prepare(`
            SELECT id FROM knowledge_embeddings WHERE entry_id = 2
        `).get();
        accessors.db.prepare(`
            UPDATE knowledge_entries
            SET content = '修改后的正文', search_text = '修改后的检索文本', content_hash = 'hash-2-new'
            WHERE id = 2
        `).run();

        const result = await syncKnowledgeEmbeddings({ dbAccessors: accessors, provider });
        const after = accessors.db.prepare(`
            SELECT id, content_hash FROM knowledge_embeddings WHERE entry_id = 2
        `).get();

        assert.equal(result.stats.updated, 1);
        assert.equal(result.stats.unchanged, 1);
        assert.equal(after.id, before.id);
        assert.equal(after.content_hash, 'hash-2-new');
    } finally {
        accessors.db.close();
    }
});

test('Knowledge V6.2：模型切换失败可续跑且完成前保留旧模型', async () => {
    const accessors = createAccessors();
    try {
        insertEntry(accessors.db, 1, 'hash-1', '正常知识');
        insertEntry(accessors.db, 2, 'hash-2', '失败知识');
        await syncKnowledgeEmbeddings({
            dbAccessors: accessors,
            provider: fakeProvider('test/e5-v1'),
            batchSize: 2,
        });

        await assert.rejects(
            () => syncKnowledgeEmbeddings({
                dbAccessors: accessors,
                provider: fakeProvider('test/e5-v2', { failText: '失败知识' }),
                batchSize: 1,
            }),
            error => {
                assert.ok(error instanceof KnowledgeVectorSyncError);
                assert.equal(error.stats.inserted, 1);
                assert.equal(error.stats.failed, 1);
                assert.equal(error.stats.pending, 1);
                return true;
            }
        );
        assert.equal(
            accessors.db.prepare("SELECT COUNT(*) AS count FROM knowledge_embeddings WHERE model = 'test/e5-v1'").get().count,
            2
        );
        assert.equal(
            accessors.db.prepare("SELECT COUNT(*) AS count FROM knowledge_embeddings WHERE model = 'test/e5-v2'").get().count,
            1
        );

        const completed = await syncKnowledgeEmbeddings({
            dbAccessors: accessors,
            provider: fakeProvider('test/e5-v2'),
            batchSize: 1,
        });
        assert.equal(completed.stats.inserted, 1);
        assert.equal(completed.stats.unchanged, 1);
        assert.equal(completed.stats.deleted, 2);
        assert.equal(
            accessors.db.prepare("SELECT COUNT(*) AS count FROM knowledge_embeddings WHERE model = 'test/e5-v1'").get().count,
            0
        );
    } finally {
        accessors.db.close();
    }
});

test('Knowledge V6.2：知识来源删除立即级联清理向量', async () => {
    const accessors = createAccessors();
    try {
        insertEntry(accessors.db, 1, 'hash-1');
        await syncKnowledgeEmbeddings({
            dbAccessors: accessors,
            provider: fakeProvider('test/e5'),
        });
        accessors.db.prepare('DELETE FROM knowledge_entries WHERE id = 1').run();

        assert.equal(
            accessors.db.prepare('SELECT COUNT(*) AS count FROM knowledge_embeddings').get().count,
            0
        );
        const plan = planKnowledgeVectorSync(accessors.db, fakeProvider('test/e5'));
        assert.equal(plan.total, 0);
    } finally {
        accessors.db.close();
    }
});
