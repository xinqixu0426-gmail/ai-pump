const express = require('express');
const rateLimit = require('express-rate-limit');
const { createMcpHandler } = require('@modelcontextprotocol/server');
const { toNodeHandler } = require('@modelcontextprotocol/node');
const { createLogger } = require('../logger.cjs');
const { createMcpAccessMiddleware } = require('../mcp/auth.cjs');
const { createMcpProtocolServer } = require('../mcp/server.cjs');
const { getMcpRateLimit } = require('../services/environment.cjs');

const mcpRouteLogger = createLogger('mcp-http');
const MCP_MAX_REQUEST_BYTES = 262_144;

function reportProtocolRejection(error) {
    mcpRouteLogger.warn('MCP 协议请求被拒绝', {
        error: error?.message || String(error),
    });
}

function isMcpJsonParseError(error) {
    return error?.type === 'entity.parse.failed'
        || (
            error instanceof SyntaxError
            && error?.status === 400
            && Object.hasOwn(error, 'body')
        );
}

function classifyMcpBodyError(error) {
    if (isMcpJsonParseError(error)) {
        return {
            status: 400,
            code: -32700,
            message: 'Parse error',
            errorCode: 'json_rpc_parse_error',
        };
    }
    if (error?.type === 'entity.too.large' || error?.status === 413) {
        return {
            status: 413,
            code: -32600,
            message: 'Request body too large',
            errorCode: 'request_body_too_large',
        };
    }
    return null;
}

function handleMcpBodyError(error, req, res, next) {
    const classification = classifyMcpBodyError(error);
    if (!classification) return next(error);
    mcpRouteLogger.warn('MCP 请求体被拒绝', {
        requestId: req.requestId || null,
        method: req.method,
        path: req.originalUrl,
        errorCode: classification.errorCode,
    });
    return res.status(classification.status).json({
        jsonrpc: '2.0',
        id: null,
        error: {
            code: classification.code,
            message: classification.message,
            data: {
                requestId: req.requestId || null,
                ...(classification.status === 413
                    ? { maxRequestBytes: MCP_MAX_REQUEST_BYTES }
                    : {}),
            },
        },
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
        executeConfirmedAiTool: options.executeConfirmedAiTool,
        hasVerifiedExecution: options.hasVerifiedExecution,
        hasVerifiedWriteExecution: options.hasVerifiedWriteExecution,
        maxResultBytes: options.maxResultBytes,
        protocolEra: ctx.era,
        requestId: ctx.authInfo?.requestId || null,
        scopes: ctx.authInfo?.scopes || [],
        writeTools: ctx.authInfo?.writeTools || [],
    }), {
        legacy: 'stateless',
        responseMode: 'auto',
        onerror: reportProtocolRejection,
    });
    const nodeHandler = toNodeHandler(protocolHandler, {
        onerror: error => mcpRouteLogger.error('MCP HTTP 适配失败', { error }),
    });

    // 鉴权失败也必须计入限流，避免独立 token 入口被无上限试探。
    router.use('/', limiter, access, express.json({ limit: MCP_MAX_REQUEST_BYTES }));
    const handleProtocol = (req, res) => nodeHandler(req, res, req.body);

    router.post('/', handleProtocol);
    router.get('/', handleProtocol);
    router.delete('/', handleProtocol);
    router.use(handleMcpBodyError);
    router.closeMcpHandler = () => protocolHandler.close();
    return router;
}

module.exports = createMcpRouter();
module.exports.createMcpRouter = createMcpRouter;
module.exports.createHermesMcpRouter = createMcpRouter;
module.exports.classifyMcpBodyError = classifyMcpBodyError;
module.exports.handleMcpBodyError = handleMcpBodyError;
module.exports.isMcpJsonParseError = isMcpJsonParseError;
module.exports.MCP_MAX_REQUEST_BYTES = MCP_MAX_REQUEST_BYTES;
