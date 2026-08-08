const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    decryptSecret,
    initializeRuntimeSettings,
    normalizeValue,
    publicSnapshot,
    updateRuntimeSettings,
} = require('../api/services/runtimeConfig.cjs');

function createAccessors() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE runtime_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            setting_key TEXT NOT NULL UNIQUE,
            setting_value TEXT NOT NULL,
            is_secret INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    `);
    return {
        db,
        safeInsert(_table, values) {
            return db.prepare(`
                INSERT INTO runtime_settings (
                    setting_key, setting_value, is_secret, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
            `).run(
                values.setting_key,
                values.setting_value,
                values.is_secret,
                values.created_at,
                values.updated_at
            );
        },
        safeUpdate(_table, id, values) {
            return db.prepare(`
                UPDATE runtime_settings
                SET setting_value = ?, is_secret = ?, updated_at = ?
                WHERE id = ?
            `).run(
                values.setting_value,
                values.is_secret,
                new Date().toISOString(),
                id
            );
        },
    };
}

test('系统初始化：API Key 加密保存且读取接口不返回密钥原文', () => {
    const accessors = createAccessors();
    const env = {
        NODE_ENV: 'test',
        JWT_SECRET: 'runtime-config-test-secret',
    };
    try {
        updateRuntimeSettings({
            deepseekApiKey: 'sk-test-deepseek-secret',
            aiProvider: 'deepseek',
        }, { env, dbAccessors: accessors });

        const row = accessors.db.prepare(`
            SELECT setting_value, is_secret
            FROM runtime_settings
            WHERE setting_key = 'deepseekApiKey'
        `).get();
        assert.equal(row.is_secret, 1);
        assert.doesNotMatch(row.setting_value, /sk-test-deepseek-secret/);
        assert.equal(decryptSecret(row.setting_value, env), 'sk-test-deepseek-secret');

        const snapshot = publicSnapshot({ env, dbAccessors: accessors });
        assert.equal(snapshot.secrets.deepseekApiKey.configured, true);
        assert.equal(snapshot.secrets.deepseekApiKey.source, 'runtime');
        assert.equal(JSON.stringify(snapshot).includes('sk-test-deepseek-secret'), false);
    } finally {
        accessors.db.close();
    }
});

test('系统初始化：智能路由默认使用 DeepSeek 并允许 Kimi K3 处理图片和文件', () => {
    const accessors = createAccessors();
    const env = {
        NODE_ENV: 'test',
        JWT_SECRET: 'runtime-config-test-secret',
        DEEPSEEK_API_KEY: 'deepseek-existing-key',
    };
    try {
        const snapshot = initializeRuntimeSettings({ env, dbAccessors: accessors });
        assert.equal(snapshot.values.aiProvider, 'auto');
        assert.equal(snapshot.values.kimiModel, 'kimi-k3');
        assert.equal(snapshot.values.kimiReasoningEffort, 'low');
        assert.equal(env.AI_PROVIDER, 'auto');
        assert.equal(normalizeValue('aiProvider', 'auto'), 'auto');

        const result = updateRuntimeSettings({
            aiProvider: 'auto',
            kimiApiKey: 'sk-open-platform-example',
        }, { env, dbAccessors: accessors });
        assert.equal(result.config.values.aiProvider, 'auto');
        assert.equal(result.config.secrets.kimiApiKey.configured, true);
    } finally {
        accessors.db.close();
    }
});

test('系统初始化：即时设置更新环境，重启设置保留待重启状态', () => {
    const accessors = createAccessors();
    const env = {
        NODE_ENV: 'test',
        JWT_SECRET: 'runtime-config-test-secret',
    };
    try {
        initializeRuntimeSettings({ env, dbAccessors: accessors });
        let result = updateRuntimeSettings({
            aiProvider: 'kimi',
            kimiApiKey: 'sk-open-platform-example',
            kimiModel: 'kimi-k3',
            kimiReasoningEffort: 'high',
            knowledgeVectorEnabled: false,
        }, { env, dbAccessors: accessors });

        assert.equal(env.AI_PROVIDER, 'kimi');
        assert.equal(env.KIMI_MODEL, 'kimi-k3');
        assert.equal(env.KIMI_REASONING_EFFORT, 'high');
        assert.equal(env.KNOWLEDGE_VECTOR_ENABLED, 'false');
        assert.equal(result.config.restartRequired, true);
        assert.deepEqual(result.config.restartFields, ['knowledgeVectorEnabled']);

        result = updateRuntimeSettings({
            knowledgeVectorEnabled: true,
        }, { env, dbAccessors: accessors });
        assert.equal(result.config.restartRequired, false);
    } finally {
        accessors.db.close();
    }
});

test('系统初始化：拒绝把 Kimi Coding 订阅凭证当作开放平台密钥', () => {
    assert.throws(
        () => normalizeValue('kimiApiKey', 'sk-kimi-example-only'),
        /Kimi Coding 订阅凭证/
    );
});

test('系统初始化：整批设置先校验再提交且不允许切换到缺少密钥的提供商', () => {
    const accessors = createAccessors();
    const env = {
        NODE_ENV: 'test',
        JWT_SECRET: 'runtime-config-test-secret',
        DEEPSEEK_API_KEY: 'deepseek-existing-key',
    };
    try {
        assert.throws(
            () => updateRuntimeSettings({
                aiProvider: 'kimi',
                knowledgeVectorBatchSize: 17,
            }, { env, dbAccessors: accessors }),
            /Kimi 开放平台 API Key/
        );
        assert.equal(
            accessors.db.prepare('SELECT COUNT(*) AS count FROM runtime_settings').get().count,
            0
        );

        assert.throws(
            () => updateRuntimeSettings({
                knowledgeVectorBatchSize: 17,
                knowledgeEmbeddingDimensions: 0,
            }, { env, dbAccessors: accessors }),
            /knowledgeEmbeddingDimensions/
        );
        assert.equal(
            accessors.db.prepare('SELECT COUNT(*) AS count FROM runtime_settings').get().count,
            0
        );
    } finally {
        accessors.db.close();
    }
});
