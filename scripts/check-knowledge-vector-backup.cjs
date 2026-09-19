const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
    loadVectorExtension,
    searchStoredEmbeddings,
    vectorCoverage,
} = require('../api/services/knowledgeVectorStore.cjs');

async function main() {
    const sourcePath = path.resolve(__dirname, '..', 'pump.db');
    const backupPath = path.join(
        os.tmpdir(),
        `pump-vector-backup-${process.pid}-${Date.now()}.db`
    );
    let source;
    let restored;
    try {
        source = new Database(sourcePath, { readonly: true });
        await source.backup(backupPath);
        const sourceCounts = source.prepare(`
            SELECT
                (SELECT COUNT(*) FROM knowledge_entries) AS entries,
                (SELECT COUNT(*) FROM knowledge_embeddings) AS embeddings
        `).get();
        source.close();
        source = null;

        restored = new Database(backupPath, { readonly: true });
        const integrity = restored.pragma('integrity_check', { simple: true });
        const foreignKeyViolations = restored.pragma('foreign_key_check');
        if (integrity !== 'ok') throw new Error(`备份完整性异常：${integrity}`);
        if (foreignKeyViolations.length > 0) {
            throw new Error(`备份存在 ${foreignKeyViolations.length} 条外键异常`);
        }
        const restoredCounts = restored.prepare(`
            SELECT
                (SELECT COUNT(*) FROM knowledge_entries) AS entries,
                (SELECT COUNT(*) FROM knowledge_embeddings) AS embeddings
        `).get();
        if (
            Number(restoredCounts.entries) !== Number(sourceCounts.entries)
            || Number(restoredCounts.embeddings) !== Number(sourceCounts.embeddings)
        ) {
            throw new Error('备份前后知识或向量数量不一致');
        }

        const sample = restored.prepare(`
            SELECT entry_id AS entryId, model, dimensions, embedding
            FROM knowledge_embeddings
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        `).get();
        if (!sample) throw new Error('备份中没有可验证的知识向量');
        const expectedBytes = Number(sample.dimensions) * Float32Array.BYTES_PER_ELEMENT;
        if (sample.embedding.length !== expectedBytes) {
            throw new Error(`备份向量字节数异常：预期 ${expectedBytes}，实际 ${sample.embedding.length}`);
        }
        const extension = loadVectorExtension(restored);
        if (!extension.available) throw new Error(extension.error || 'sqlite-vec 加载失败');
        const queryVector = new Float32Array(Number(sample.dimensions));
        Buffer.from(sample.embedding).copy(Buffer.from(queryVector.buffer));
        const search = searchStoredEmbeddings(restored, queryVector, {
            model: sample.model,
            dimensions: sample.dimensions,
            limit: 1,
        });
        if (Number(search.results[0]?.id) !== Number(sample.entryId)) {
            throw new Error('恢复库向量检索未返回样本自身');
        }
        const coverage = vectorCoverage(restored, sample.model);
        console.log(JSON.stringify({
            integrity,
            foreignKeyViolations: foreignKeyViolations.length,
            entries: Number(restoredCounts.entries),
            embeddings: Number(restoredCounts.embeddings),
            model: sample.model,
            dimensions: Number(sample.dimensions),
            coveragePercent: coverage.coveragePercent,
            vectorSearch: 'ok',
        }, null, 2));
    } finally {
        if (source?.open) source.close();
        if (restored?.open) restored.close();
        if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
