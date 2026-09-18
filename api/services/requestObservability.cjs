const crypto = require('node:crypto');
const { createLogger } = require('../logger.cjs');

const REQUEST_ID_RE = /^[a-zA-Z0-9._-]{8,128}$/;

function normalizeRequestId(value) {
    const candidate = String(value || '').trim();
    return REQUEST_ID_RE.test(candidate) ? candidate : crypto.randomUUID();
}

function createRequestObservability(options = {}) {
    const logger = options.logger || createLogger('http');
    const now = options.now || (() => process.hrtime.bigint());

    return function requestObservability(req, res, next) {
        const requestId = normalizeRequestId(req.headers['x-request-id']);
        const startedAt = now();
        const requestPath = String(req.originalUrl || req.url || req.path || '').split('?')[0];
        req.requestId = requestId;
        res.setHeader('X-Request-ID', requestId);

        res.once('finish', () => {
            if (requestPath === '/api/health/live') return;
            const durationMs = Number(now() - startedAt) / 1e6;
            const meta = {
                requestId,
                method: req.method,
                path: requestPath,
                statusCode: res.statusCode,
                durationMs: Number(durationMs.toFixed(1)),
            };
            if (
                res.statusCode === 503
                && (requestPath === '/api/health' || requestPath === '/api/health/ready')
            ) logger.warn('请求完成', meta);
            else if (res.statusCode >= 500) logger.error('请求完成', meta);
            else if (res.statusCode >= 400) logger.warn('请求完成', meta);
            else logger.info('请求完成', meta);
        });
        next();
    };
}

module.exports = { createRequestObservability, normalizeRequestId };
