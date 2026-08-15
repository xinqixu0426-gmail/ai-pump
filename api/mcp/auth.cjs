const crypto = require('node:crypto');
const {
    getHermesMcpAllowedHosts,
    isHermesMcpEnabled,
    validateHermesMcpConfiguration,
} = require('../services/environment.cjs');

function firstHeader(value) {
    return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

function normalizeHost(value) {
    const candidate = firstHeader(value).toLowerCase();
    if (!candidate) return '';
    try {
        return new URL(`http://${candidate}`).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function bearerToken(req) {
    const authorization = firstHeader(req.headers?.authorization);
    const match = authorization.match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

function constantTimeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ''), 'utf8');
    const rightBuffer = Buffer.from(String(right || ''), 'utf8');
    return leftBuffer.length === rightBuffer.length
        && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function tokenFingerprint(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex').slice(0, 16);
}

function sendHttpError(res, statusCode, code, message) {
    if (statusCode === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="pump-hermes-mcp"');
    return res.status(statusCode).json({
        jsonrpc: '2.0',
        error: { code, message },
        id: null,
    });
}

function createHermesMcpAccessMiddleware(options = {}) {
    const env = options.env || process.env;
    const configurationErrors = validateHermesMcpConfiguration(env);
    if (isHermesMcpEnabled(env) && configurationErrors.length > 0) {
        throw new Error(configurationErrors.join('；'));
    }

    return function hermesMcpAccess(req, res, next) {
        if (!isHermesMcpEnabled(env)) {
            return sendHttpError(res, 404, -32004, 'MCP endpoint is disabled');
        }

        const allowedHosts = new Set(getHermesMcpAllowedHosts(env));
        const requestHost = normalizeHost(
            req.headers?.['x-forwarded-host'] || req.headers?.host
        );
        if (!requestHost || !allowedHosts.has(requestHost)) {
            return sendHttpError(res, 403, -32003, 'MCP request host is not allowed');
        }

        const origin = firstHeader(req.headers?.origin);
        if (origin) {
            let originHost = '';
            try {
                originHost = new URL(origin).hostname.toLowerCase();
            } catch {
                return sendHttpError(res, 403, -32003, 'MCP request origin is invalid');
            }
            if (!allowedHosts.has(originHost)) {
                return sendHttpError(res, 403, -32003, 'MCP request origin is not allowed');
            }
        }

        const suppliedToken = bearerToken(req);
        const configuredToken = String(env.HERMES_MCP_TOKEN || '').trim();
        if (!suppliedToken || !constantTimeEqual(suppliedToken, configuredToken)) {
            return sendHttpError(res, 401, -32001, 'MCP authentication required');
        }

        req.mcpActor = `hermes:${tokenFingerprint(configuredToken)}`;
        next();
    };
}

module.exports = {
    bearerToken,
    constantTimeEqual,
    createHermesMcpAccessMiddleware,
    normalizeHost,
    tokenFingerprint,
};
