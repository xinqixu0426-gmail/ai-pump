const extensionStates = new WeakMap();

function vectorBuffer(vector) {
    const values = vector instanceof Float32Array ? vector : Float32Array.from(vector || []);
    if (values.length === 0 || Array.from(values).some(value => !Number.isFinite(value))) {
        throw new Error('向量必须包含有效数值');
    }
    return Buffer.from(values.buffer, values.byteOffset, values.byteLength);
}

function loadVectorExtension(db, options = {}) {
    if (!options.reload && extensionStates.has(db)) return extensionStates.get(db);
    try {
        const sqliteVec = options.sqliteVec || require('sqlite-vec');
        sqliteVec.load(db);
        const version = String(db.prepare('SELECT vec_version() AS version').get()?.version || '');
        const state = { available: true, version, error: '' };
        extensionStates.set(db, state);
        return state;
    } catch (error) {
        const state = {
            available: false,
            version: '',
            error: String(error?.message || error),
        };
        extensionStates.set(db, state);
        return state;
    }
}

function vectorCoverage(db, model) {
    const row = db.prepare(`
        SELECT
            COUNT(*) AS total_entries,
            SUM(CASE WHEN embedding.id IS NOT NULL THEN 1 ELSE 0 END) AS embedded_entries,
            SUM(CASE
                WHEN embedding.id IS NOT NULL
                 AND embedding.content_hash = entry.content_hash
                THEN 1 ELSE 0
            END) AS fresh_entries,
            SUM(CASE
                WHEN embedding.id IS NOT NULL
                 AND embedding.content_hash <> entry.content_hash
                THEN 1 ELSE 0
            END) AS stale_entries
        FROM knowledge_entries entry
        LEFT JOIN knowledge_embeddings embedding
          ON embedding.entry_id = entry.id
         AND embedding.model = ?
    `).get(model);
    const totalEntries = Number(row?.total_entries || 0);
    const freshEntries = Number(row?.fresh_entries || 0);
    return {
        totalEntries,
        embeddedEntries: Number(row?.embedded_entries || 0),
        freshEntries,
        staleEntries: Number(row?.stale_entries || 0),
        pendingEntries: Math.max(0, totalEntries - freshEntries),
        coveragePercent: totalEntries > 0
            ? Number(((freshEntries / totalEntries) * 100).toFixed(1))
            : 100,
    };
}

function buildKnowledgeVectorHealth(db, provider, options = {}) {
    const embedding = provider.getStatus();
    const extension = loadVectorExtension(db, options);
    const coverage = vectorCoverage(db, embedding.model);
    const sync = options.syncStatus || null;
    const history = options.history || null;
    const operational = embedding.enabled && extension.available && embedding.canLoad;
    const hybridEnabled = !['0', 'false', 'no', 'off'].includes(
        String(process.env.KNOWLEDGE_HYBRID_SEARCH_ENABLED ?? 'true').trim().toLowerCase()
    );
    const searchMode = operational && hybridEnabled ? 'hybrid' : 'fts';
    return {
        enabled: embedding.enabled,
        operational,
        searchMode,
        phase: 'v6.4',
        message: searchMode === 'hybrid' && coverage.pendingEntries === 0
            ? '混合检索已启用，精确关键词与语义向量共同排序'
            : searchMode === 'hybrid'
                ? '混合检索已启用，未生成向量的条目仍可通过 FTS 命中'
                : '向量能力未启用或尚未就绪，当前检索继续使用 FTS/LIKE',
        extension,
        embedding,
        coverage,
        sync,
        history,
    };
}

function searchStoredEmbeddings(db, queryVector, options = {}) {
    const extension = loadVectorExtension(db, options);
    if (!extension.available) return { extension, results: [] };
    const model = String(options.model || '').trim();
    if (!model) throw new Error('向量模型不能为空');
    const dimensions = Math.max(1, Number(options.dimensions) || queryVector?.length || 0);
    const query = vectorBuffer(queryVector);
    if (query.length !== dimensions * Float32Array.BYTES_PER_ELEMENT) {
        throw new Error(`查询向量维度不匹配: 预期 ${dimensions}`);
    }
    const limit = Math.min(50, Math.max(1, Number(options.limit) || 10));
    const entryType = String(options.entryType || '').trim();
    const sourceTable = String(options.sourceTable || '').trim();
    const results = db.prepare(`
        SELECT entry.id,
               entry.entry_type AS entryType,
               entry.source_table AS sourceTable,
               entry.source_id AS sourceId,
               entry.title,
               entry.summary,
               vec_distance_cosine(embedding.embedding, ?) AS vectorDistance
        FROM knowledge_embeddings embedding
        JOIN knowledge_entries entry ON entry.id = embedding.entry_id
        WHERE embedding.model = ?
          AND embedding.dimensions = ?
          AND embedding.content_hash = entry.content_hash
          AND (? = '' OR entry.entry_type = ?)
          AND (? = '' OR entry.source_table = ?)
        ORDER BY vectorDistance ASC, entry.id ASC
        LIMIT ?
    `).all(
        query,
        model,
        dimensions,
        entryType,
        entryType,
        sourceTable,
        sourceTable,
        limit
    );
    return { extension, results };
}

module.exports = {
    buildKnowledgeVectorHealth,
    loadVectorExtension,
    searchStoredEmbeddings,
    vectorBuffer,
    vectorCoverage,
};
