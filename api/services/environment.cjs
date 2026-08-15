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

function isHermesMcpEnabled(env = process.env) {
    return String(env.HERMES_MCP_ENABLED || '').trim().toLowerCase() === 'true';
}

function getHermesMcpRateLimit(env = process.env) {
    return parseInteger(env.HERMES_MCP_RATE_LIMIT_PER_MINUTE, {
        name: 'HERMES_MCP_RATE_LIMIT_PER_MINUTE',
        defaultValue: 60,
        min: 1,
        max: 600,
    });
}

function getHermesMcpMaxResultBytes(env = process.env) {
    return parseInteger(env.HERMES_MCP_MAX_RESULT_BYTES, {
        name: 'HERMES_MCP_MAX_RESULT_BYTES',
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

function getHermesMcpAllowedHosts(env = process.env) {
    const hosts = new Set(['localhost', '127.0.0.1', '::1']);
    for (const origin of parseCorsOrigins(env.CORS_ORIGIN)) {
        try {
            hosts.add(new URL(origin).hostname.toLowerCase());
        } catch {
            // CORS_ORIGIN 的整体合法性仍由生产环境校验负责。
        }
    }
    for (const host of parseHostList(env.HERMES_MCP_ALLOWED_HOSTS)) hosts.add(host);
    return [...hosts];
}

function validateHermesMcpConfiguration(env = process.env) {
    if (!isHermesMcpEnabled(env)) return [];
    const errors = [];
    const token = String(env.HERMES_MCP_TOKEN || '').trim();
    if (token.length < 32) {
        errors.push('启用 Hermes MCP 时 HERMES_MCP_TOKEN 至少需要 32 个字符');
    }
    for (const name of ['INTERNAL_SECRET', 'JWT_SECRET', 'ACCESS_PASSWORD']) {
        const other = String(env[name] || '').trim();
        if (token && other && token === other) {
            errors.push(`HERMES_MCP_TOKEN 不能与 ${name} 相同`);
        }
    }
    try {
        getHermesMcpRateLimit(env);
    } catch (error) {
        errors.push(error.message);
    }
    try {
        getHermesMcpMaxResultBytes(env);
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
    errors.push(...validateHermesMcpConfiguration(env));
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
    getHermesMcpAllowedHosts,
    getHermesMcpMaxResultBytes,
    getHermesMcpRateLimit,
    isHermesMcpEnabled,
    parseCorsOrigins,
    parseHostList,
    validateHermesMcpConfiguration,
    validateProductionEnvironment,
    assertProductionEnvironment,
};
