const os = require('node:os');
const path = require('node:path');

const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';
const DEFAULT_DIMENSIONS = 384;
const DEFAULT_DTYPE = 'q8';

function envBoolean(value, defaultValue) {
    if (value == null || String(value).trim() === '') return defaultValue;
    return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function embeddingConfig(env = process.env) {
    return {
        enabled: envBoolean(env.KNOWLEDGE_VECTOR_ENABLED, true),
        model: String(env.KNOWLEDGE_EMBEDDING_MODEL || DEFAULT_MODEL).trim(),
        dimensions: Math.max(1, Number(env.KNOWLEDGE_EMBEDDING_DIMENSIONS) || DEFAULT_DIMENSIONS),
        dtype: String(env.KNOWLEDGE_EMBEDDING_DTYPE || DEFAULT_DTYPE).trim(),
        cacheDir: path.resolve(
            String(
                env.KNOWLEDGE_MODEL_CACHE_DIR
                || path.join(os.homedir(), '.cache', 'pump-knowledge-models')
            )
        ),
        offline: envBoolean(env.KNOWLEDGE_MODEL_OFFLINE, false),
    };
}

function runtimeAvailable() {
    try {
        require.resolve('@huggingface/transformers');
        return true;
    } catch {
        return false;
    }
}

async function defaultPipelineFactory(config) {
    const transformers = await import('@huggingface/transformers');
    transformers.env.cacheDir = config.cacheDir;
    return transformers.pipeline('feature-extraction', config.model, {
        cache_dir: config.cacheDir,
        local_files_only: config.offline,
        dtype: config.dtype,
    });
}

function tensorRows(tensor) {
    if (typeof tensor?.tolist === 'function') {
        const rows = tensor.tolist();
        return Array.isArray(rows?.[0]) ? rows : [rows];
    }
    if (!tensor?.data || !Array.isArray(tensor?.dims)) {
        throw new Error('嵌入模型返回了无法识别的张量');
    }
    const rowCount = Number(tensor.dims[0]) || 1;
    const dimensions = Number(tensor.dims.at(-1)) || 0;
    if (!dimensions || tensor.data.length !== rowCount * dimensions) {
        throw new Error('嵌入模型返回的张量维度不完整');
    }
    return Array.from({ length: rowCount }, (_, index) => (
        Array.from(tensor.data.slice(index * dimensions, (index + 1) * dimensions))
    ));
}

function createEmbeddingProvider(options = {}) {
    const config = options.config || embeddingConfig(options.env);
    const pipelineFactory = options.pipelineFactory || defaultPipelineFactory;
    let extractor = options.extractor || null;
    let loading = null;
    let loadedAt = extractor ? new Date().toISOString() : null;
    let lastError = '';
    let lastErrorAt = null;

    async function load() {
        if (!config.enabled) throw new Error('向量能力已通过 KNOWLEDGE_VECTOR_ENABLED 关闭');
        if (extractor) return extractor;
        if (!loading) {
            loading = Promise.resolve()
                .then(() => pipelineFactory(config))
                .then(instance => {
                    extractor = instance;
                    loadedAt = new Date().toISOString();
                    lastError = '';
                    lastErrorAt = null;
                    return instance;
                })
                .catch(error => {
                    lastError = String(error?.message || error);
                    lastErrorAt = new Date().toISOString();
                    throw error;
                })
                .finally(() => {
                    loading = null;
                });
        }
        return loading;
    }

    async function embed(texts, mode) {
        try {
            const values = (Array.isArray(texts) ? texts : [texts])
                .map(value => String(value || '').trim());
            if (values.length === 0 || values.some(value => !value)) {
                throw new Error('嵌入文本不能为空');
            }
            if (!['query', 'passage'].includes(mode)) {
                throw new Error('嵌入模式必须是 query 或 passage');
            }
            const instance = await load();
            const tensor = await instance(
                values.map(value => `${mode}: ${value}`),
                { pooling: 'mean', normalize: true }
            );
            const rows = tensorRows(tensor).map(row => Float32Array.from(row));
            if (rows.length !== values.length) {
                throw new Error(`嵌入数量不匹配: 预期 ${values.length}，实际 ${rows.length}`);
            }
            if (rows.some(row => row.length !== config.dimensions)) {
                throw new Error(`嵌入维度不匹配: 预期 ${config.dimensions}`);
            }
            lastError = '';
            lastErrorAt = null;
            return rows;
        } catch (error) {
            lastError = String(error?.message || error);
            lastErrorAt = new Date().toISOString();
            throw error;
        }
    }

    return {
        config,
        embedPassages(texts) {
            return embed(texts, 'passage');
        },
        async embedQuery(text) {
            const [embedding] = await embed([text], 'query');
            return embedding;
        },
        getStatus() {
            const available = runtimeAvailable();
            return {
                enabled: config.enabled,
                runtimeAvailable: available,
                model: config.model,
                dimensions: config.dimensions,
                dtype: config.dtype,
                cacheDir: config.cacheDir,
                offline: config.offline,
                loaded: Boolean(extractor),
                loading: Boolean(loading),
                loadedAt,
                lastError,
                lastErrorAt,
                canLoad: config.enabled && available,
                ready: config.enabled && available && Boolean(extractor),
            };
        },
    };
}

const embeddingProvider = createEmbeddingProvider();

module.exports = {
    DEFAULT_DIMENSIONS,
    DEFAULT_DTYPE,
    DEFAULT_MODEL,
    createEmbeddingProvider,
    embeddingConfig,
    embeddingProvider,
    tensorRows,
};
