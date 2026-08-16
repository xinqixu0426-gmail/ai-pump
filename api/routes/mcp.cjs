const express = require('express');
const rateLimit = require('express-rate-limit');
const { createMcpHandler } = require('@modelcontextprotocol/server');
const { toNodeHandler } = require('@modelcontextprotocol/node');
const { createLogger } = require('../logger.cjs');
const { createMcpAccessMiddleware } = require('../mcp/auth.cjs');
const { createMcpProtocolServer } = require('../mcp/server.cjs');
const { getMcpRateLimit } = require('../services/environment.cjs');

const mcpRouteLogger = createLogger('mcp-http');

function reportProtocolRejection(error) {
    mcpRouteLogger.warn('MCP 协议请求被拒绝', {
        error: error?.message || String(error),
    });
}

function createMcpRouter(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const access = createMcpAccessMiddleware({ env });
    const limiter = rateLimit({
        windowMs: 60_000,
        max: getMcpRateLimit(env),
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            error: 'rate_limit_exceeded',
            error_description: 'MCP request rate limit exceeded',
        },
    });

    const protocolHandler = createMcpHandler(ctx => createMcpProtocolServer({
        actor: ctx.authInfo?.actor || 'mcp:unknown',
        clientId: ctx.authInfo?.clientId || 'unknown',
        env,
        executeToolCall: options.executeToolCall,
        hasVerifiedExecution: options.hasVerifiedExecution,
        maxResultBytes: options.maxResultBytes,
        protocolEra: ctx.era,
        requestId: ctx.authInfo?.requestId || null,
    }), {
        legacy: 'stateless',
        responseMode: 'auto',
        onerror: reportProtocolRejection,
    });
    const nodeHandler = toNodeHandler(protocolHandler, {
        onerror: error => mcpRouteLogger.error('MCP HTTP 适配失败', { error }),
    });

    // 鉴权失败也必须计入限流，避免独立 token 入口被无上限试探。
    router.use('/', limiter, access);
    const handleProtocol = (req, res) => nodeHandler(req, res, req.body);

    router.post('/', handleProtocol);
    router.get('/', handleProtocol);
    router.delete('/', handleProtocol);
    router.closeMcpHandler = () => protocolHandler.close();
    return router;
}

module.exports = createMcpRouter();
module.exports.createMcpRouter = createMcpRouter;
module.exports.createHermesMcpRouter = createMcpRouter;
