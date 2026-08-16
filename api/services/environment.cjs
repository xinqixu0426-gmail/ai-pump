const REQUIRED_PRODUCTION_ENV = Object.freeze([
    'ACCESS_PASSWORD',
    'JWT_SECRET',
    'INTERNAL_SECRET',
    'CORS_ORIGIN',
]);

const DISALLOWED_JWT_SECRETS = new Set(['dev_jwt_secret', 'fallback_secret']);

function isProductionEnvironment(env = process.env, platform = process.platform) {
    if (env.NODE_ENV === 'production') return true;
    if (platform !== 'win32' && env.BEHIND_PROXY === 'true') return true;
    if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return false;
    return platform !== 'win32';
}

function parseInteger(value, {
    name,
    defaultValue,
    min,
    max,
}) {
    const rawValue = value === undefined || value === null || value === ''
        ? defaultValue
        : value;
    const parsed = Number(rawValue);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${name} 必须是 ${min}-${max} 的整数`);
    }
    return parsed;
}

function getServerPort(env = process.env) {
    return parseInteger(env.PORT, {
        name: 'PORT',
        defaultValue: 3002,
        min: 1,
        max: 65535,
    });
}

function getInternalApiTimeoutMs(env = process.env) {
    return parseInteger(env.INTERNAL_API_TIMEOUT_MS, {
        name: 'INTERNAL_API_TIMEOUT_MS',
        defaultValue: 15000,
        min: 1000,
        max: 120000,
    });
}

function configuredEnv(env, canonicalName, legacyName) {
    if (Object.prototype.hasOwnProperty.call(env, canonicalName)) {
        return { name: canonicalName, value: env[canonicalName] };
    }
    return { name: legacyName, value: env[legacyName] };
}

function isMcpEnabled(env = process.env) {
    const configured = configuredEnv(env, 'MCP_ENABLED', 'HERMES_MCP_ENABLED');
    return String(configured.value || '').trim().toLowerCase() === 'true';
}

function getMcpRateLimit(env = process.env) {
    const configured = configuredEnv(
        env,
        'MCP_RATE_LIMIT_PER_MINUTE',
        'HERMES_MCP_RATE_LIMIT_PER_MINUTE'
    );
    return parseInteger(configured.value, {
        name: configured.name,
        defaultValue: 60,
        min: 1,
        max: 600,
    });
}

function getMcpMaxResultBytes(env = process.env) {
    const configured = configuredEnv(
        env,
        'MCP_MAX_RESULT_BYTES',
        'HERMES_MCP_MAX_RESULT_BYTES'
    );
    return parseInteger(configured.value, {
        name: configured.name,
        defaultValue: 262144,
        min: 16384,
        max: 1048576,
    });
}

function parseCorsOrigins(value) {
    return String(value || '')
        .split(',')
        .map(origin => origin.trim())
        .filter(Boolean);
}

function parseHostList(value) {
    return String(value || '')
        .split(',')
        .map(host => host.trim().toLowerCase())
        .filter(Boolean);
}

function getMcpAllowedHosts(env = process.env) {
    const hosts = new Set(['localhost', '127.0.0.1', '::1']);
    for (const origin of parseCorsOrigins(env.CORS_ORIGIN)) {
        try {
            hosts.add(new URL(origin).hostname.toLowerCase());
        } catch {
            // CORS_ORIGIN 的整体合法性仍由生产环境校验负责。
        }
    }
    const configured = configuredEnv(env, 'MCP_ALLOWED_HOSTS', 'HERMES_MCP_ALLOWED_HOSTS');
    for (const host of parseHostList(configured.value)) hosts.add(host.replace(/^\[|\]$/g, ''));
    return [...hosts];
}

function parseMcpServiceTokens(env = process.env) {
    const entries = [];
    const serviceTokensRaw = String(env.MCP_SERVICE_TOKENS || '').trim();
    if (serviceTokensRaw) {
        let serviceTokens;
        try {
            serviceTokens = JSON.parse(serviceTokensRaw);
        } catch {
            throw new Error('MCP_SERVICE_TOKENS 必须是 clientId 到 token 的 JSON 对象');
        }
        if (!serviceTokens || Array.isArray(serviceTokens) || typeof serviceTokens !== 'object') {
            throw new Error('MCP_SERVICE_TOKENS 必须是 clientId 到 token 的 JSON 对象');
        }
        for (const [clientId, token] of Object.entries(serviceTokens)) {
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(clientId)) {
                throw new Error(`MCP clientId 不合法: ${clientId}`);
            }
            entries.push({ clientId, token: String(token || '').trim() });
        }
    }

    const singleToken = String(env.MCP_TOKEN || '').trim();
    if (singleToken || (!serviceTokensRaw && Object.prototype.hasOwnProperty.call(env, 'MCP_TOKEN'))) {
        entries.push({
            clientId: String(env.MCP_CLIENT_ID || 'default-agent').trim(),
            token: singleToken,
        });
    } else if (!serviceTokensRaw && Object.prototype.hasOwnProperty.call(env, 'HERMES_MCP_TOKEN')) {
        entries.push({ clientId: 'hermes', token: String(env.HERMES_MCP_TOKEN || '').trim() });
    }
    return entries;
}

function validateMcpConfiguration(env = process.env) {
    if (!isMcpEnabled(env)) return [];
    const errors = [];
    let serviceTokens = [];
    try {
        serviceTokens = parseMcpServiceTokens(env);
    } catch (error) {
        errors.push(error.message);
    }
    if (serviceTokens.length === 0) {
        errors.push('启用 MCP 时必须配置 MCP_TOKEN 或 MCP_SERVICE_TOKENS');
    }
    const seenClientIds = new Set();
    const seenTokens = new Set();
    for (const { clientId, token } of serviceTokens) {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(clientId)) {
            errors.push(`MCP clientId 不合法: ${clientId || '(empty)'}`);
        } else if (seenClientIds.has(clientId)) {
            errors.push(`MCP clientId 重复: ${clientId}`);
        }
        seenClientIds.add(clientId);
        if (token.length < 32) {
            errors.push(`MCP token 至少需要 32 个字符: ${clientId || '(empty)'}`);
        } else if (seenTokens.has(token)) {
            errors.push('不同 MCP clientId 不能复用同一个 token');
        }
        seenTokens.add(token);
        for (const name of ['INTERNAL_SECRET', 'JWT_SECRET', 'ACCESS_PASSWORD']) {
            const other = String(env[name] || '').trim();
            if (token && other && token === other) {
                errors.push(`MCP token 不能与 ${name} 相同: ${clientId}`);
            }
        }
    }
    try {
        getMcpRateLimit(env);
    } catch (error) {
        errors.push(error.message);
    }
    try {
        getMcpMaxResultBytes(env);
    } catch (error) {
        errors.push(error.message);
    }
    return errors;
}

function validateProductionEnvironment(env = process.env) {
    const errors = [];
    const missing = REQUIRED_PRODUCTION_ENV.filter(name => !String(env[name] || '').trim());
    if (missing.length > 0) {
        errors.push(`生产环境变量缺失: ${missing.join(', ')}`);
    }
    if (DISALLOWED_JWT_SECRETS.has(String(env.JWT_SECRET || '').trim())) {
        errors.push('JWT_SECRET 不能使用开发或历史默认值');
    }
    if (env.CORS_ORIGIN !== undefined && parseCorsOrigins(env.CORS_ORIGIN).length === 0) {
        errors.push('生产环境必须配置有效的 CORS_ORIGIN');
    }
    try {
        getServerPort(env);
    } catch (error) {
        errors.push(error.message);
    }
    try {
        getInternalApiTimeoutMs(env);
    } catch (error) {
        errors.push(error.message);
    }
    errors.push(...validateMcpConfiguration(env));
    return errors;
}

function assertProductionEnvironment(env = process.env) {
    const errors = validateProductionEnvironment(env);
    if (errors.length > 0) {
        throw new Error(errors.join('；'));
    }
}

module.exports = {
    REQUIRED_PRODUCTION_ENV,
    isProductionEnvironment,
    getServerPort,
    getInternalApiTimeoutMs,
    getMcpAllowedHosts,
    getMcpMaxResultBytes,
    getMcpRateLimit,
    isMcpEnabled,
    parseMcpServiceTokens,
    parseCorsOrigins,
    parseHostList,
    validateMcpConfiguration,
    validateProductionEnvironment,
    assertProductionEnvironment,
};

// 旧部署环境变量保留一个兼容周期；新代码只使用通用 MCP 命名。
module.exports.getHermesMcpAllowedHosts = getMcpAllowedHosts;
module.exports.getHermesMcpMaxResultBytes = getMcpMaxResultBytes;
module.exports.getHermesMcpRateLimit = getMcpRateLimit;
module.exports.isHermesMcpEnabled = isMcpEnabled;
module.exports.validateHermesMcpConfiguration = validateMcpConfiguration;
