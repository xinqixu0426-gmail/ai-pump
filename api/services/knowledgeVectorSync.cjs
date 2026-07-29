const { embeddingProvider } = require('./embeddingProvider.cjs');
const {
    loadVectorExtension,
    vectorCoverage,
} = require('./knowledgeVectorStore.cjs');

function loadDbAccessors() {
    return require('../db.cjs');
}

function batchSize(env = process.env) {
    const configured = Number(env.KNOWLEDGE_VECTOR_BATCH_SIZE);
    return Number.isInteger(configured) && configured > 0
        ? Math.min(configured, 64)
        : 16;
}

function embeddingPassage(row) {
    let tags = [];
    try {
        const parsed = JSON.parse(row.tags_json || '[]');
        tags = Array.isArray(parsed) ? parsed : [];
    } catch {
        tags = [];
    }
    return [
        `标题：${String(row.title || '').trim()}`,
        String(row.summary || '').trim(),
        String(row.content || '').trim(),
        tags.length > 0 ? `标签：${tags.map(String).join('、')}` : '',
    ].filter(Boolean).join('\n');
}

function planKnowledgeVectorSync(db, provider = embeddingProvider) {
    const config = provider.config;
    const rows = db.prepare(`
        SELECT entry.id,
               entry.title,
               entry.summary,
               entry.content,
               entry.tags_json,
               entry.content_hash,
               embedding.id AS embedding_id,
               embedding.content_hash AS embedding_content_hash,
               embedding.dimensions AS embedding_dimensions
        FROM knowledge_entries entry
        LEFT JOIN knowledge_embeddings embedding
          ON embedding.entry_id = entry.id
         AND embedding.model = ?
        ORDER BY entry.id
    `).all(config.model);
    const pending = [];
    let unchanged = 0;
    for (const row of rows) {
        const fresh = row.embedding_id
            && row.embedding_content_hash === row.content_hash
            && Number(row.embedding_dimensions) === config.dimensions;
        if (fresh) {
            unchanged += 1;
        } else {
            pending.push({
                ...row,
                action: row.embedding_id ? 'update' : 'insert',
            });
        }
    }
    return {
        model: config.model,
        dimensions: config.dimensions,
        total: rows.length,
        unchanged,
        pending,
    };
}

class KnowledgeVectorSyncError extends Error {
    constructor(message, stats, errors = []) {
        super(message);
        this.name = 'KnowledgeVectorSyncError';
        this.stats = stats;
        this.errors = errors;
    }
}

async function syncKnowledgeEmbeddings(options = {}) {
    const dbAccessors = options.dbAccessors || loadDbAccessors();
    const {
        db,
        hardDelete,
        safeInsert,
        safeUpdate,
    } = dbAccessors;
    const provider = options.provider || embeddingProvider;
    const plan = planKnowledgeVectorSync(db, provider);
    const unavailableStats = {
        total: plan.total,
        inserted: 0,
        updated: 0,
        unchanged: plan.unchanged,
        deleted: Math.max(0, Number(options.cascadeDeleted || 0)),
        failed: plan.pending.length,
        pending: plan.pending.length,
    };
    const extension = loadVectorExtension(db, options);
    if (!extension.available) {
        throw new KnowledgeVectorSyncError(
            `sqlite-vec 加载失败: ${extension.error}`,
            unavailableStats
        );
    }
    if (!provider.config.enabled) {
        throw new KnowledgeVectorSyncError('向量能力已关闭', unavailableStats);
    }

    const stats = {
        total: plan.total,
        inserted: 0,
        updated: 0,
        unchanged: plan.unchanged,
        deleted: Math.max(0, Number(options.cascadeDeleted || 0)),
        failed: 0,
        pending: plan.pending.length,
    };
    const errors = [];
    const size = options.batchSize || batchSize(options.env);

    for (let offset = 0; offset < plan.pending.length; offset += size) {
        const rows = plan.pending.slice(offset, offset + size);
        try {
            const vectors = await provider.embedPassages(rows.map(embeddingPassage));
            const now = new Date().toISOString();
            const batchInserted = rows.filter(row => !row.embedding_id).length;
            const batchUpdated = rows.length - batchInserted;
            const writeBatch = db.transaction(() => {
                rows.forEach((row, index) => {
                    const values = {
                        entry_id: row.id,
                        model: plan.model,
                        dimensions: plan.dimensions,
                        content_hash: row.content_hash,
                        embedding: Buffer.from(
                            vectors[index].buffer,
                            vectors[index].byteOffset,
                            vectors[index].byteLength
                        ),
                    };
                    if (row.embedding_id) {
                        safeUpdate('knowledge_embeddings', row.embedding_id, values);
                    } else {
                        safeInsert('knowledge_embeddings', {
                            ...values,
                            created_at: now,
                            updated_at: now,
                        });
                    }
                });
            });
            writeBatch();
            stats.inserted += batchInserted;
            stats.updated += batchUpdated;
        } catch (error) {
            stats.failed += rows.length;
            errors.push(String(error?.message || error));
        }
    }

    const coverage = vectorCoverage(db, plan.model);
    stats.pending = coverage.pendingEntries;
    stats.unchanged = Math.max(
        stats.unchanged,
        stats.total - stats.inserted - stats.updated - stats.failed
    );

    if (stats.failed === 0 && stats.pending === 0) {
        const obsolete = db.prepare(`
            SELECT id FROM knowledge_embeddings
            WHERE model <> ?
            ORDER BY id
        `).all(plan.model);
        obsolete.forEach(row => hardDelete('knowledge_embeddings', row.id));
        stats.deleted += obsolete.length;
    }

    if (stats.failed > 0 || stats.pending > 0) {
        const uniqueErrors = [...new Set(errors)].slice(0, 5);
        throw new KnowledgeVectorSyncError(
            uniqueErrors[0] || `仍有 ${stats.pending} 条知识向量待生成`,
            stats,
            uniqueErrors
        );
    }

    return {
        model: plan.model,
        dimensions: plan.dimensions,
        extension,
        stats,
    };
}

module.exports = {
    KnowledgeVectorSyncError,
    batchSize,
    embeddingPassage,
    planKnowledgeVectorSync,
    syncKnowledgeEmbeddings,
};
