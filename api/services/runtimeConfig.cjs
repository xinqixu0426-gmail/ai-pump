const crypto = require('node:crypto');
const {
    AI_RUNTIME_FIELD_NAMES,
    PROVIDER_RUNTIME_DEFINITIONS,
    assertProviderModeConfigured,
} = require('./aiProviderRegistry.cjs');

const SECRET_PREFIX = 'v1';
const SECRET_CONTEXT = 'pump-runtime-settings-v1';
const MODEL_RE = /^[a-zA-Z0-9._:/-]{1,120}$/;
const FALSE_VALUES = new Set(['0', 'false', 'off', 'no']);

const DEFINITIONS = Object.freeze({
    ...PROVIDER_RUNTIME_DEFINITIONS,
    knowledgeAutoSyncEnabled: {
        env: 'KNOWLEDGE_AUTO_SYNC_ENABLED',
        type: 'boolean',
        defaultValue: 'true',
        hot: false,
    },
    knowledgeVectorEnabled: {
        env: 'KNOWLEDGE_VECTOR_ENABLED',
        type: 'boolean',
        defaultValue: 'true',
        hot: false,
    },
    knowledgeVectorAutoSyncEnabled: {
        env: 'KNOWLEDGE_VECTOR_AUTO_SYNC_ENABLED',
        type: 'boolean',
        defaultValue: 'true',
        hot: false,
    },
    knowledgeHybridSearchEnabled: {
        env: 'KNOWLEDGE_HYBRID_SEARCH_ENABLED',
        type: 'boolean',
        defaultValue: 'true',
        hot: true,
    },
    knowledgeVectorBatchSize: {
        env: 'KNOWLEDGE_VECTOR_BATCH_SIZE',
        type: 'integer',
        min: 1,
        max: 64,
        defaultValue: '16',
        hot: true,
    },
    knowledgeEmbeddingModel: {
        env: 'KNOWLEDGE_EMBEDDING_MODEL',
        type: 'model',
        defaultValue: 'Xenova/multilingual-e5-small',
        hot: false,
    },
    knowledgeEmbeddingDimensions: {
        env: 'KNOWLEDGE_EMBEDDING_DIMENSIONS',
        type: 'integer',
        min: 1,
        max: 4096,
        defaultValue: '384',
        hot: false,
    },
    knowledgeEmbeddingDtype: {
        env: 'KNOWLEDGE_EMBEDDING_DTYPE',
        type: 'enum',
        values: ['q8', 'fp16', 'fp32'],
        defaultValue: 'q8',
        hot: false,
    },
    knowledgeModelCacheDir: {
        env: 'KNOWLEDGE_MODEL_CACHE_DIR',
        type: 'path',
        defaultValue: '',
        hot: false,
    },
    knowledgeModelOffline: {
        env: 'KNOWLEDGE_MODEL_OFFLINE',
        type: 'boolean',
        defaultValue: 'false',
        hot: false,
    },
});

let startupValues = null;

function dbAccessors(options = {}) {
    return options.dbAccessors || require('../db.cjs');
}

function normalizeBoolean(value) {
    return FALSE_VALUES.has(String(value ?? '').trim().toLowerCase()) ? 'false' : 'true';
}

function normalizeUrl(value) {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'https:') throw new Error('服务地址必须使用 HTTPS');
    if (url.username || url.password) throw new Error('服务地址不能包含账号或密码');
    return url.toString().replace(/\/+$/, '');
}

function isPrivateHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (host === 'localhost' || host === '::1') return true;
    const parts = host.split('.').map(Number);
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
        return false;
    }
    return parts[0] === 10
        || parts[0] === 127
        || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
        || (parts[0] === 192 && parts[1] === 168);
}

function normalizePrivateUrl(value) {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('局域网模型服务地址必须使用 HTTP 或 HTTPS');
    }
    if (url.username || url.password) throw new Error('服务地址不能包含账号或密码');
    if (!isPrivateHost(url.hostname)) {
        throw new Error('局域网模型服务地址必须使用 localhost 或私网 IP');
    }
    return url.toString().replace(/\/+$/, '');
}

function normalizeValue(field, value) {
    const definition = DEFINITIONS[field];
    if (!definition) throw new Error(`不支持的运行设置: ${field}`);
    if (definition.type === 'secret') {
        const secret = String(value || '').trim();
        if (!secret) throw new Error(`${field} 不能为空`);
        if (field === 'kimiApiKey' && /^sk-kimi-/i.test(secret)) {
            throw new Error('这是 Kimi Coding 订阅凭证，不能用于业务助手。请使用 Kimi 开放平台 API Key。');
        }
        if (secret.length > 500) throw new Error(`${field} 长度异常`);
        return secret;
    }
    if (definition.type === 'boolean') return normalizeBoolean(value);
    if (definition.type === 'integer') {
        const number = Number(value);
        if (!Number.isInteger(number) || number < definition.min || number > definition.max) {
            throw new Error(`${field} 必须是 ${definition.min}-${definition.max} 的整数`);
        }
        return String(number);
    }
    const normalized = String(value ?? '').trim();
    if (definition.type === 'enum') {
        if (!definition.values.includes(normalized)) throw new Error(`${field} 取值无效`);
        return normalized;
    }
    if (definition.type === 'url') return normalizeUrl(normalized);
    if (definition.type === 'privateUrl') return normalizePrivateUrl(normalized);
    if (definition.type === 'model') {
        if (!MODEL_RE.test(normalized)) throw new Error(`${field} 模型名称格式无效`);
        return normalized;
    }
    if (definition.type === 'path') {
        if (normalized.length > 500 || normalized.includes('\0')) throw new Error(`${field} 路径格式无效`);
        return normalized;
    }
    throw new Error(`${field} 类型无效`);
}

function encryptionKey(env = process.env) {
    const material = String(env.JWT_SECRET || (env.NODE_ENV === 'production' ? '' : 'dev_jwt_secret'));
    if (!material) throw new Error('缺少 JWT_SECRET，不能安全保存 API Key');
    return crypto.createHash('sha256').update(`${SECRET_CONTEXT}:${material}`).digest();
}

function encryptSecret(value, env = process.env) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(env), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return [
        SECRET_PREFIX,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        encrypted.toString('base64url'),
    ].join(':');
}

function decryptSecret(value, env = process.env) {
    const [version, ivValue, tagValue, encryptedValue] = String(value || '').split(':');
    if (version !== SECRET_PREFIX || !ivValue || !tagValue || !encryptedValue) {
        throw new Error('运行密钥格式无效');
    }
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        encryptionKey(env),
        Buffer.from(ivValue, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
        decipher.update(Buffer.from(encryptedValue, 'base64url')),
        decipher.final(),
    ]).toString('utf8');
}

function storedRows(options = {}) {
    const { db } = dbAccessors(options);
    return db.prepare(`
        SELECT id, setting_key, setting_value, is_secret, created_at, updated_at
        FROM runtime_settings
        ORDER BY setting_key
    `).all();
}

function storedMap(options = {}) {
    return new Map(storedRows(options).map((row) => [row.setting_key, row]));
}

function runtimeSettingsUpdatedAt(options = {}) {
    const { db } = dbAccessors(options);
    return db.prepare(`
        SELECT MAX(updated_at) AS updated_at
        FROM runtime_settings
    `).get()?.updated_at || null;
}

function effectiveValues(options = {}) {
    const env = options.env || process.env;
    const rows = storedMap(options);
    const values = {};
    const sources = {};
    const secretStatus = {};
    for (const [field, definition] of Object.entries(DEFINITIONS)) {
        const row = rows.get(field);
        if (definition.type === 'secret') {
            let value = '';
            let source = 'none';
            let error = '';
            if (row) {
                try {
                    value = decryptSecret(row.setting_value, env);
                    source = 'runtime';
                } catch (decryptError) {
                    error = decryptError.message;
                    source = 'invalid';
                }
            } else if (env[definition.env]) {
                value = String(env[definition.env]).trim();
                source = 'environment';
            }
            values[field] = value;
            sources[field] = source;
            secretStatus[field] = {
                configured: Boolean(value),
                source,
                error,
            };
            continue;
        }
        if (row) {
            values[field] = row.setting_value;
            sources[field] = 'runtime';
        } else if (env[definition.env] !== undefined && env[definition.env] !== '') {
            values[field] = normalizeValue(field, env[definition.env]);
            sources[field] = 'environment';
        } else {
            values[field] = definition.defaultValue ?? '';
            sources[field] = 'default';
        }
    }
    return { values, sources, secretStatus };
}

function upsertRuntimeSetting(field, value, options = {}) {
    const accessors = dbAccessors(options);
    const now = new Date().toISOString();
    const existing = accessors.db.prepare(`
        SELECT id FROM runtime_settings WHERE setting_key = ?
    `).get(field);
    const definition = DEFINITIONS[field];
    const settingValue = definition.type === 'secret'
        ? encryptSecret(value, options.env || process.env)
        : value;
    if (existing) {
        const write = accessors.safeUpdate('runtime_settings', existing.id, {
            setting_value: settingValue,
            is_secret: definition.type === 'secret' ? 1 : 0,
        }, options.auditContext || {});
        return {
            id: existing.id,
            created: false,
            auditId: write?.auditId || null,
        };
    }
    const write = accessors.safeInsert('runtime_settings', {
        setting_key: field,
        setting_value: settingValue,
        is_secret: definition.type === 'secret' ? 1 : 0,
        created_at: now,
        updated_at: now,
    }, options.auditContext || {});
    return {
        id: Number(write?.lastInsertRowid) || null,
        created: true,
        auditId: write?.auditId || null,
    };
}

function deploymentStatus(env = process.env) {
    return [
        { key: 'nodeEnv', label: '运行环境', configured: true, value: env.NODE_ENV || 'development' },
        { key: 'port', label: 'API 端口', configured: true, value: env.PORT || '3002' },
        { key: 'nextOrigin', label: '页面服务', configured: Boolean(env.NEXT_ORIGIN), value: env.NEXT_ORIGIN || '本机开发模式' },
        { key: 'accessPassword', label: '管理密码', configured: Boolean(env.ACCESS_PASSWORD) },
        { key: 'jwtSecret', label: '登录签名密钥', configured: Boolean(env.JWT_SECRET) || env.NODE_ENV !== 'production' },
        { key: 'internalSecret', label: '内部接口密钥', configured: Boolean(env.INTERNAL_SECRET) },
        { key: 'corsOrigin', label: '跨域来源', configured: Boolean(env.CORS_ORIGIN), value: env.CORS_ORIGIN || '开发环境自动放行' },
    ];
}

function publicSnapshot(options = {}) {
    const env = options.env || process.env;
    const current = effectiveValues(options);
    const publicValues = {};
    for (const [field, definition] of Object.entries(DEFINITIONS)) {
        if (definition.type === 'secret') continue;
        const value = current.values[field];
        publicValues[field] = definition.type === 'boolean'
            ? value === 'true'
            : definition.type === 'integer'
                ? Number(value)
                : value;
    }
    const restartFields = startupValues
        ? Object.entries(DEFINITIONS)
            .filter(([, definition]) => !definition.hot)
            .filter(([field]) => startupValues[field] !== current.values[field])
            .map(([field]) => field)
        : [];
    return {
        values: publicValues,
        sources: current.sources,
        secrets: current.secretStatus,
        deployment: deploymentStatus(env),
        restartRequired: restartFields.length > 0,
        restartFields,
        kimiCodingCompatible: false,
        updatedAt: runtimeSettingsUpdatedAt(options),
    };
}

function initializeRuntimeSettings(options = {}) {
    const env = options.env || process.env;
    const current = effectiveValues({ ...options, env });
    for (const [field, definition] of Object.entries(DEFINITIONS)) {
        const value = current.values[field];
        if (definition.type !== 'secret' || value !== '') env[definition.env] = String(value);
    }
    startupValues = { ...current.values };
    return publicSnapshot({ ...options, env });
}

function prepareRuntimeSettingsUpdate(input, options = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new Error('运行设置必须是对象');
    }
    const env = options.env || process.env;
    const normalized = {};
    for (const [field, rawValue] of Object.entries(input)) {
        if (field === 'expectedUpdatedAt' || field === 'idempotencyKey') continue;
        if (!(field in DEFINITIONS)) throw new Error(`不支持的运行设置: ${field}`);
        if (DEFINITIONS[field].type === 'secret' && String(rawValue || '').trim() === '') continue;
        normalized[field] = normalizeValue(field, rawValue);
    }
    const current = effectiveValues({ ...options, env });
    const nextValues = { ...current.values, ...normalized };
    if (normalized.aiProvider && normalized.aiProvider !== current.values.aiProvider) {
        assertProviderModeConfigured(normalized.aiProvider, nextValues);
    }
    const changed = Object.keys(normalized).filter(
        field => normalized[field] !== current.values[field]
    );
    return {
        current,
        requested: { ...normalized },
        normalized: Object.fromEntries(
            changed.map(field => [field, normalized[field]])
        ),
        changed,
    };
}

function persistRuntimeSettings(normalized, options = {}) {
    const env = options.env || process.env;
    const accessors = dbAccessors(options);
    const writes = [];
    const saveAll = () => {
        for (const [field, value] of Object.entries(normalized)) {
            writes.push({
                field,
                ...upsertRuntimeSetting(field, value, {
                    ...options,
                    env,
                    dbAccessors: accessors,
                }),
            });
        }
    };
    if (options.transaction === false) saveAll();
    else accessors.db.transaction(saveAll).immediate();
    return writes;
}

function applyRuntimeEnvironment(normalized, env = process.env) {
    for (const [field, value] of Object.entries(normalized)) {
        env[DEFINITIONS[field].env] = value;
    }
}

function updateRuntimeSettings(input, options = {}) {
    const env = options.env || process.env;
    const draft = prepareRuntimeSettingsUpdate(input, { ...options, env });
    const writes = persistRuntimeSettings(draft.normalized, {
        ...options,
        env,
    });
    applyRuntimeEnvironment(draft.normalized, env);
    return {
        changed: draft.changed,
        config: publicSnapshot({ ...options, env }),
        auditIds: writes.map(write => write.auditId).filter(Boolean),
        writes,
    };
}

function buildCandidateAiEnvironment(input = {}, options = {}) {
    const env = { ...(options.env || process.env) };
    for (const field of AI_RUNTIME_FIELD_NAMES) {
        if (input[field] === undefined || input[field] === '') continue;
        env[DEFINITIONS[field].env] = normalizeValue(field, input[field]);
    }
    return env;
}

module.exports = {
    DEFINITIONS,
    applyRuntimeEnvironment,
    buildCandidateAiEnvironment,
    decryptSecret,
    effectiveValues,
    encryptSecret,
    initializeRuntimeSettings,
    normalizeValue,
    persistRuntimeSettings,
    prepareRuntimeSettingsUpdate,
    publicSnapshot,
    runtimeSettingsUpdatedAt,
    updateRuntimeSettings,
};
