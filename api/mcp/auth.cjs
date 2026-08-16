const crypto = require('node:crypto');
const {
    getMcpAllowedHosts,
    isMcpEnabled,
    parseMcpServiceTokens,
    validateMcpConfiguration,
} = require('../services/environment.cjs');

function firstHeader(value) {
    return String(Array.isArray(value) ? value[0] : value || '').split(',')[0].trim();
}

function normalizeHost(value) {
    const candidate = firstHeader(value).toLowerCase();
    if (!candidate) return '';
    try {
        return new URL(`http://${candidate}`).hostname.toLowerCase().replace(/^\[|\]$/g, '');
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
    const leftDigest = crypto.createHash('sha256').update(String(left || ''), 'utf8').digest();
    const rightDigest = crypto.createHash('sha256').update(String(right || ''), 'utf8').digest();
    return crypto.timingSafeEqual(leftDigest, rightDigest);
}

function tokenFingerprint(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex').slice(0, 16);
}

function sendHttpError(res, statusCode, code, message) {
    if (statusCode === 401) {
        res.setHeader(
            'WWW-Authenticate',
            'Bearer realm="pump-factory-mcp", error="invalid_token"'
        );
    }
    return res.status(statusCode).json({ error: code, error_description: message });
}

function findServiceCredential(suppliedToken, credentials) {
    let matched = null;
    for (const credential of credentials) {
        if (constantTimeEqual(suppliedToken, credential.token)) matched = credential;
    }
    return matched;
}

function createMcpAccessMiddleware(options = {}) {
    const env = options.env || process.env;
    const configurationErrors = validateMcpConfiguration(env);
    if (isMcpEnabled(env) && configurationErrors.length > 0) {
        throw new Error(configurationErrors.join('；'));
    }
    const credentials = isMcpEnabled(env) ? parseMcpServiceTokens(env) : [];
    const allowedHosts = new Set(getMcpAllowedHosts(env));

    return function mcpAccess(req, res, next) {
        if (!isMcpEnabled(env)) {
            return sendHttpError(res, 404, 'not_found', 'MCP endpoint is disabled');
        }

        const requestHost = normalizeHost(req.headers?.host);
        if (!requestHost || !allowedHosts.has(requestHost)) {
            return sendHttpError(res, 403, 'access_denied', 'MCP request host is not allowed');
        }

        const origin = firstHeader(req.headers?.origin);
        if (origin) {
            let originHost = '';
            try {
                originHost = new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, '');
            } catch {
                return sendHttpError(res, 403, 'access_denied', 'MCP request origin is invalid');
            }
            if (!allowedHosts.has(originHost)) {
                return sendHttpError(res, 403, 'access_denied', 'MCP request origin is not allowed');
            }
        }

        const suppliedToken = bearerToken(req);
        const credential = suppliedToken
            ? findServiceCredential(suppliedToken, credentials)
            : null;
        if (!credential) {
            return sendHttpError(res, 401, 'invalid_token', 'MCP authentication required');
        }

        const fingerprint = tokenFingerprint(credential.token);
        req.mcpActor = `mcp:${credential.clientId}:${fingerprint}`;
        req.auth = {
            token: fingerprint,
            clientId: credential.clientId,
            scopes: ['mcp:read'],
            expiresAt: Number.MAX_SAFE_INTEGER,
            actor: req.mcpActor,
            requestId: req.requestId || null,
        };
        next();
    };
}

module.exports = {
    bearerToken,
    constantTimeEqual,
    createMcpAccessMiddleware,
    findServiceCredential,
    normalizeHost,
    tokenFingerprint,
};

module.exports.createHermesMcpAccessMiddleware = createMcpAccessMiddleware;
