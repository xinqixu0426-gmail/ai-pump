const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const {
    createEmbeddingProvider,
    embeddingConfig,
} = require('../api/services/embeddingProvider.cjs');

test('embedding provider：使用 E5 前缀、均值池化和归一化并复用模型', async () => {
    const calls = [];
    let loadCount = 0;
    const provider = createEmbeddingProvider({
        config: {
            enabled: true,
            model: 'test/e5',
            dimensions: 3,
            dtype: 'q8',
            cacheDir: 'C:\\model-cache',
            offline: true,
        },
        pipelineFactory: async config => {
            loadCount += 1;
            assert.equal(config.model, 'test/e5');
            return async (texts, options) => {
                calls.push({ texts, options });
                return {
                    tolist() {
                        return texts.map((_, index) => [index + 1, 0.5, 0.25]);
                    },
                };
            };
        },
    });

    const query = await provider.embedQuery('平刀切割泵壳多少钱');
    const passages = await provider.embedPassages(['800 平刀切割泵壳', '业务规则']);

    assert.equal(loadCount, 1);
    assert.deepEqual(Array.from(query), [1, 0.5, 0.25]);
    assert.equal(passages.length, 2);
    assert.deepEqual(calls[0], {
        texts: ['query: 平刀切割泵壳多少钱'],
        options: { pooling: 'mean', normalize: true },
    });
    assert.deepEqual(calls[1], {
        texts: ['passage: 800 平刀切割泵壳', 'passage: 业务规则'],
        options: { pooling: 'mean', normalize: true },
    });
    assert.equal(provider.getStatus().loaded, true);
    assert.equal(provider.getStatus().lastError, '');
});

test('embedding provider：模型失败可诊断且不会伪造结果', async () => {
    const provider = createEmbeddingProvider({
        config: {
            enabled: true,
            model: 'missing/model',
            dimensions: 384,
            dtype: 'q8',
            cacheDir: 'C:\\missing-cache',
            offline: true,
        },
        pipelineFactory: async () => {
            throw new Error('模型缓存不存在');
        },
    });

    await assert.rejects(() => provider.embedQuery('测试'), /模型缓存不存在/);
    assert.equal(provider.getStatus().loaded, false);
    assert.match(provider.getStatus().lastError, /模型缓存不存在/);
    assert.ok(provider.getStatus().lastErrorAt);
});

test('embedding provider：环境配置有稳定默认值且支持离线开关', () => {
    const cacheDir = path.join(os.tmpdir(), 'factory-models');
    const config = embeddingConfig({
        KNOWLEDGE_VECTOR_ENABLED: 'false',
        KNOWLEDGE_MODEL_OFFLINE: 'true',
        KNOWLEDGE_EMBEDDING_MODEL: 'local/e5',
        KNOWLEDGE_EMBEDDING_DIMENSIONS: '512',
        KNOWLEDGE_MODEL_CACHE_DIR: cacheDir,
    });

    assert.equal(config.enabled, false);
    assert.equal(config.offline, true);
    assert.equal(config.model, 'local/e5');
    assert.equal(config.dimensions, 512);
    assert.equal(config.cacheDir, path.resolve(cacheDir));
});
