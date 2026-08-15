const express = require('express');
const rateLimit = require('express-rate-limit');
const {
    StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { createLogger } = require('../logger.cjs');
const { createHermesMcpAccessMiddleware } = require('../mcp/auth.cjs');
const { createHermesMcpProtocolServer } = require('../mcp/server.cjs');
const { getHermesMcpRateLimit } = require('../services/environment.cjs');

const mcpRouteLogger = createLogger('hermes-mcp-http');

function methodNotAllowed(res) {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed' },
        id: null,
    });
}

function createHermesMcpRouter(options = {}) {
    const router = express.Router();
    const env = options.env || process.env;
    const access = createHermesMcpAccessMiddleware({ env });
    const limiter = rateLimit({
        windowMs: 60_000,
        max: getHermesMcpRateLimit(env),
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            jsonrpc: '2.0',
            error: { code: -32029, message: 'MCP request rate limit exceeded' },
            id: null,
        },
    });

    // 鉴权失败也必须计入限流，避免独立 token 入口被无上限试探。
    router.post('/', limiter, access, async (req, res) => {
        const server = createHermesMcpProtocolServer({
            actor: req.mcpActor,
            env,
            executeToolCall: options.executeToolCall,
            hasVerifiedExecution: options.hasVerifiedExecution,
            maxResultBytes: options.maxResultBytes,
            requestId: req.requestId,
        });
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
        });
        const cleanup = () => {
            void transport.close();
            void server.close();
        };
        res.once('close', cleanup);
        try {
            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        } catch (error) {
            mcpRouteLogger.error('MCP 协议请求失败', {
                requestId: req.requestId,
                actor: req.mcpActor,
                error,
            });
            if (!res.headersSent) {
                res.status(500).json({
                    jsonrpc: '2.0',
                    error: { code: -32603, message: 'Internal MCP server error' },
                    id: null,
                });
            }
        }
    });

    router.get('/', access, (req, res) => methodNotAllowed(res));
    router.delete('/', access, (req, res) => methodNotAllowed(res));
    return router;
}

module.exports = createHermesMcpRouter();
module.exports.createHermesMcpRouter = createHermesMcpRouter;
