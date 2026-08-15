const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
    StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const {
    HERMES_MCP_V1_TOOL_NAMES,
    listHermesMcpTools,
} = require('../api/mcp/catalog.cjs');
const {
    createHermesMcpAccessMiddleware,
} = require('../api/mcp/auth.cjs');
const {
    executeHermesMcpTool,
} = require('../api/mcp/server.cjs');
const {
    createHermesMcpRouter,
} = require('../api/routes/mcp.cjs');

const TOKEN = 'hermes-mcp-test-token-0123456789abcdef';

function enabledEnv(overrides = {}) {
    return {
        HERMES_MCP_ENABLED: 'true',
        HERMES_MCP_TOKEN: TOKEN,
        CORS_ORIGIN: 'https://pump.example.com',
        ...overrides,
    };
}

function verifiedResult(data = {}) {
    return {
        success: true,
        data,
        executionEvidence: {
            verified: true,
            kind: 'formal_api_query',
            calls: [{ method: 'GET', path: '/api/test' }],
        },
    };
}

async function listen(router) {
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => {
        req.requestId = 'mcp-test-request';
        next();
    });
    app.use('/mcp', router);
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    return {
        server,
        url: `http://127.0.0.1:${address.port}/mcp`,
    };
}

async function closeServer(server) {
    await new Promise((resolve, reject) => server.close(error => (
        error ? reject(error) : resolve()
    )));
}

test('Hermes MCP V1：固定白名单只包含已登记的只读 Query/Preview，并复用唯一 AI schema', () => {
    const listed = listHermesMcpTools();
    const aiTools = new Map(AI_TOOLS.map(tool => [tool.function.name, tool]));

    assert.equal(listed.length, 12);
    assert.deepEqual(listed.map(tool => tool.name), HERMES_MCP_V1_TOOL_NAMES);
    for (const tool of listed) {
        const capability = getAiCapability(tool.name);
        assert.equal(capability.access, 'read', tool.name);
        assert.equal(capability.requiresConfirmation, false, tool.name);
        assert.ok(['query', 'preview'].includes(capability.operation), tool.name);
        assert.deepEqual(tool.inputSchema, aiTools.get(tool.name).function.parameters, tool.name);
        assert.equal(tool.annotations.readOnlyHint, true, tool.name);
        assert.equal(tool.annotations.destructiveHint, false, tool.name);
    }
});

test('Hermes MCP V1：越过白名单或缺少正式 API 证据时默认拒绝', async () => {
    let called = false;
    const rejectedWrite = await executeHermesMcpTool('create_part', {}, {
        executeToolCall: async () => {
            called = true;
            return verifiedResult();
        },
    });
    assert.equal(rejectedWrite.isError, true);
    assert.equal(rejectedWrite.structuredContent.code, 'mcp_tool_not_allowed');
    assert.equal(called, false);

    const missingEvidence = await executeHermesMcpTool('get_copper_price', {}, {
        executeToolCall: async () => ({ success: true, data: { cnyPerKg: 80 } }),
    });
    assert.equal(missingEvidence.isError, true);
    assert.equal(missingEvidence.structuredContent.code, 'mcp_execution_evidence_missing');
});

test('Hermes MCP V1：认证使用独立 Bearer token，并校验 Host 与 Origin', () => {
    const middleware = createHermesMcpAccessMiddleware({ env: enabledEnv() });
    const invoke = headers => {
        const req = { headers };
        const response = { statusCode: 200, headers: {} };
        const res = {
            setHeader: (name, value) => { response.headers[name] = value; },
            status: statusCode => {
                response.statusCode = statusCode;
                return res;
            },
            json: body => {
                response.body = body;
                return response;
            },
        };
        let nextCalled = false;
        middleware(req, res, () => { nextCalled = true; });
        return { req, response, nextCalled };
    };

    assert.equal(invoke({ host: 'localhost' }).response.statusCode, 401);
    assert.equal(invoke({
        host: 'localhost',
        authorization: 'Bearer wrong-token',
    }).response.statusCode, 401);
    assert.equal(invoke({
        host: 'evil.example.com',
        authorization: `Bearer ${TOKEN}`,
    }).response.statusCode, 403);
    assert.equal(invoke({
        host: 'pump.example.com',
        origin: 'https://evil.example.com',
        authorization: `Bearer ${TOKEN}`,
    }).response.statusCode, 403);

    const accepted = invoke({
        host: 'pump.example.com',
        origin: 'https://pump.example.com',
        authorization: `Bearer ${TOKEN}`,
    });
    assert.equal(accepted.nextCalled, true);
    assert.match(accepted.req.mcpActor, /^hermes:[a-f0-9]{16}$/);
});

test('Hermes MCP V1：无效凭证也计入独立入口限流', async () => {
    const router = createHermesMcpRouter({
        env: enabledEnv({ HERMES_MCP_RATE_LIMIT_PER_MINUTE: '1' }),
    });
    const { server, url } = await listen(router);
    try {
        const request = () => fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        });
        assert.equal((await request()).status, 401);
        assert.equal((await request()).status, 429);
    } finally {
        await closeServer(server);
    }
});

test('Hermes MCP V1：真实 Streamable HTTP 客户端可以发现并调用白名单工具', async () => {
    const calls = [];
    const router = createHermesMcpRouter({
        env: enabledEnv(),
        executeToolCall: async (name, args, options) => {
            calls.push({ name, args, options });
            return verifiedResult({ cnyPerKg: 80.25 });
        },
    });
    const { server, url } = await listen(router);
    const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new Client({ name: 'hermes-mcp-test', version: '1.0.0' });
    try {
        await client.connect(transport);
        const listed = await client.listTools();
        assert.deepEqual(listed.tools.map(tool => tool.name), HERMES_MCP_V1_TOOL_NAMES);

        const result = await client.callTool({
            name: 'get_copper_price',
            arguments: {},
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent.data.cnyPerKg, 80.25);
        assert.equal(result.structuredContent.mcp.capabilityId, 'ai.get_copper_price');
        assert.equal(result.structuredContent.mcp.verified, true);
        assert.deepEqual(calls, [{
            name: 'get_copper_price',
            args: {},
            options: { allowWrite: false, caller: 'hermes-mcp' },
        }]);
    } finally {
        await client.close();
        await closeServer(server);
    }
});

test('Hermes MCP V1：禁用时隐藏端点，超大结果要求调用方缩小查询', async () => {
    const router = createHermesMcpRouter({ env: { HERMES_MCP_ENABLED: 'false' } });
    const { server, url } = await listen(router);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        });
        assert.equal(response.status, 404);
    } finally {
        await closeServer(server);
    }

    const oversized = await executeHermesMcpTool('get_copper_price', {}, {
        executeToolCall: async () => verifiedResult({ value: 'x'.repeat(20_000) }),
        maxResultBytes: 16_384,
    });
    assert.equal(oversized.isError, true);
    assert.equal(oversized.structuredContent.code, 'mcp_result_too_large');
});
