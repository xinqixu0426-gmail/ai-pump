const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    SettingsQueryError,
    createSettingsQueries,
} = require('../api/services/settingsQueries.cjs');
const {
    resolveProviderConfigsForMode,
} = require('../api/services/aiProviderRegistry.cjs');

function createFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE system_settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TEXT
        );
        INSERT INTO system_settings VALUES
            ('management_fee', '10', '2026-08-03T00:00:00.000Z'),
            ('usd_exchange_rate', '7.2', '2026-08-03T00:01:00.000Z'),
            ('internal_only', 'secret', '2026-08-03T00:02:00.000Z');
    `);
    const providerCalls = [];
    const clock = [1000, 1042];
    const queries = createSettingsQueries({
        allowedSettings: new Set([
            'management_fee',
            'usd_exchange_rate',
            'cable_accessories',
        ]),
        buildCandidateAiEnvironment: input => input,
        db,
        fetchAiProvider: async (messages, options) => {
            providerCalls.push({ messages, options });
            return {
                arrayBuffer: async () => new ArrayBuffer(0),
            };
        },
        now: () => clock.shift(),
        publicRuntimeSnapshot: () => ({
            provider: 'auto',
            apiKeyConfigured: true,
        }),
        resolveProviderConfigsForMode,
    });
    return {
        db,
        providerCalls,
        queries,
    };
}

test('设置 Query 只返回白名单业务设置并保留更新时间', () => {
    const fixture = createFixture();
    try {
        assert.deepEqual(
            fixture.queries.getAllBusinessSettings(),
            {
                management_fee: '10',
                usd_exchange_rate: '7.2',
            }
        );
        assert.deepEqual(
            fixture.queries.getBusinessSetting('management_fee'),
            {
                key: 'management_fee',
                value: '10',
                updatedAt: '2026-08-03T00:00:00.000Z',
            }
        );
    } finally {
        fixture.db.close();
    }
});

test('设置 Query 对非法和不存在的白名单 key 返回稳定 400/404', () => {
    const fixture = createFixture();
    try {
        assert.throws(
            () => fixture.queries.getBusinessSetting('internal_only'),
            error => (
                error instanceof SettingsQueryError
                && error.statusCode === 400
                && error.message === '非法设置项'
            )
        );
        assert.throws(
            () => fixture.queries.getBusinessSetting('cable_accessories'),
            error => (
                error instanceof SettingsQueryError
                && error.statusCode === 404
                && error.message === '设置项 "cable_accessories" 不存在'
            )
        );
    } finally {
        fixture.db.close();
    }
});

test('设置 Query 复用运行配置公开快照且不暴露内部数据库值', () => {
    const fixture = createFixture();
    try {
        assert.deepEqual(fixture.queries.getRuntimeSettings(), {
            provider: 'auto',
            apiKeyConfigured: true,
        });
    } finally {
        fixture.db.close();
    }
});

test('设置 Query 的 AI 探测统一编排自动路由提供商和耗时', async () => {
    const fixture = createFixture();
    try {
        const result = await fixture.queries.testAiConnection({
            AI_PROVIDER: 'auto',
            DEEPSEEK_API_KEY: 'configured',
            KIMI_API_KEY: 'configured',
        });
        assert.deepEqual(result, {
            provider: 'auto',
            displayName: '智能路由',
            model: 'deepseek-v4-flash / kimi-k3',
            testedProviders: [
                {
                    provider: 'deepseek',
                    displayName: 'DeepSeek',
                    model: 'deepseek-v4-flash',
                },
                {
                    provider: 'kimi',
                    displayName: 'Kimi 开放平台',
                    model: 'kimi-k3',
                },
            ],
            latencyMs: 42,
        });
        assert.equal(fixture.providerCalls.length, 2);
        assert.deepEqual(fixture.providerCalls[0].messages, [{
            role: 'user',
            content: '只回复“连接正常”。',
        }]);
    } finally {
        fixture.db.close();
    }
});
