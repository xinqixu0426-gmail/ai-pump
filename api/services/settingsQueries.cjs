class SettingsQueryError extends Error {
    constructor(message, statusCode = 400) {
        super(message);
        this.name = 'SettingsQueryError';
        this.statusCode = statusCode;
    }
}

function createSettingsQueries({
    allowedSettings,
    buildCandidateAiEnvironment,
    db,
    fetchAiProvider,
    now = Date.now,
    publicRuntimeSnapshot,
    resolveProviderConfigsForMode,
} = {}) {
    if (!db || typeof db.prepare !== 'function') {
        throw new Error('设置查询服务缺少数据库依赖');
    }
    if (!(allowedSettings instanceof Set) || allowedSettings.size === 0) {
        throw new Error('设置查询服务缺少 allowedSettings');
    }
    for (const [name, dependency] of Object.entries({
        buildCandidateAiEnvironment,
        fetchAiProvider,
        now,
        publicRuntimeSnapshot,
        resolveProviderConfigsForMode,
    })) {
        if (typeof dependency !== 'function') {
            throw new Error(`设置查询服务缺少 ${name}`);
        }
    }

    function requireAllowedSetting(key) {
        if (!allowedSettings.has(key)) {
            throw new SettingsQueryError('非法设置项');
        }
        return key;
    }

    function getRuntimeSettings() {
        return publicRuntimeSnapshot();
    }

    function getBusinessSetting(rawKey) {
        const key = requireAllowedSetting(rawKey);
        const row = db.prepare(`
            SELECT key, value, updated_at
            FROM system_settings
            WHERE key = ?
        `).get(key);
        if (!row) {
            throw new SettingsQueryError(
                `设置项 "${key}" 不存在`,
                404
            );
        }
        return {
            key: row.key,
            value: row.value,
            updatedAt: row.updated_at,
        };
    }

    function getAllBusinessSettings() {
        const keys = [...allowedSettings];
        const rows = db.prepare(`
            SELECT key, value, updated_at
            FROM system_settings
            WHERE key IN (${keys.map(() => '?').join(', ')})
        `).all(...keys);
        return Object.fromEntries(
            rows.map(row => [row.key, row.value])
        );
    }

    async function testAiConnection(input = {}) {
        const startedAt = now();
        const env = buildCandidateAiEnvironment(input);
        const resolved = resolveProviderConfigsForMode(env, {
            defaultMode: 'auto',
            includeUnconfigured: false,
        });
        const { mode, configs } = resolved;

        const testedProviders = [];
        for (const config of configs) {
            const response = await fetchAiProvider([{
                role: 'user',
                content: '只回复“连接正常”。',
            }], { config });
            await response.arrayBuffer();
            testedProviders.push({
                provider: config.provider,
                displayName: config.displayName,
                model: config.model,
            });
        }
        return {
            provider: mode,
            displayName: mode === 'auto'
                ? '智能路由'
                : testedProviders[0].displayName,
            model: testedProviders
                .map(item => item.model)
                .join(' / '),
            testedProviders,
            latencyMs: now() - startedAt,
        };
    }

    return {
        getAllBusinessSettings,
        getBusinessSetting,
        getRuntimeSettings,
        testAiConnection,
    };
}

module.exports = {
    SettingsQueryError,
    createSettingsQueries,
};
