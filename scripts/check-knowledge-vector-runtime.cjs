const Database = require('better-sqlite3');
const { embeddingProvider } = require('../api/services/embeddingProvider.cjs');
const { loadVectorExtension } = require('../api/services/knowledgeVectorStore.cjs');

async function main() {
    const prepareModel = process.argv.includes('--prepare-model');
    const db = new Database(':memory:');
    let extension;
    try {
        extension = loadVectorExtension(db);
    } finally {
        db.close();
    }
    if (!extension.available) {
        throw new Error(`sqlite-vec 加载失败: ${extension.error}`);
    }

    let sampleDimensions = null;
    if (prepareModel) {
        const vector = await embeddingProvider.embedQuery('工厂知识向量运行检查');
        sampleDimensions = vector.length;
    }
    const embedding = embeddingProvider.getStatus();
    if (!embedding.runtimeAvailable) {
        throw new Error('@huggingface/transformers 运行时不可用');
    }

    console.log(JSON.stringify({
        success: true,
        platform: process.platform,
        arch: process.arch,
        extension,
        embedding,
        modelPrepared: prepareModel && embedding.loaded,
        sampleDimensions,
    }, null, 2));
}

main().catch(error => {
    console.error(JSON.stringify({
        success: false,
        error: String(error?.message || error),
    }, null, 2));
    process.exitCode = 1;
});
