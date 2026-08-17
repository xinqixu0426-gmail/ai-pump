const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { Client: LegacyClient } = require('@modelcontextprotocol/sdk/client/index.js');
const {
    StreamableHTTPClientTransport: LegacyStreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const {
    Client: ModernClient,
    StreamableHTTPClientTransport: ModernStreamableHTTPClientTransport,
} = require('@modelcontextprotocol/client');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const {
    MCP_OPEN_WORLD_TOOL_NAMES,
    MCP_POTENTIALLY_DESTRUCTIVE_TOOL_NAMES,
    MCP_READ_ONLY_TOOL_NAMES,
    MCP_WRITE_TOOL_NAMES,
    buildMcpInputSchema,
    listMcpTools,
} = require('../api/mcp/catalog.cjs');
const {
    createMcpAccessMiddleware,
} = require('../api/mcp/auth.cjs');
const {
    classifyMcpToolResponse,
    executeMcpTool,
} = require('../api/mcp/server.cjs');
const {
    executeMcpWriteTool,
    resetMcpWriteFlowsForTests,
    verifyMcpRequestState,
} = require('../api/mcp/write.cjs');
const {
    MCP_MAX_REQUEST_BYTES,
    createMcpRouter,
} = require('../api/routes/mcp.cjs');

const TOKEN = 'generic-mcp-test-token-0123456789abcdef';
const SECOND_TOKEN = 'second-agent-test-token-0123456789abcdef';

test.beforeEach(() => {
    resetMcpWriteFlowsForTests();
});

function enabledEnv(overrides = {}) {
    return {
        MCP_ENABLED: 'true',
        MCP_SERVICE_TOKENS: JSON.stringify({
            'generic-test': TOKEN,
            'second-agent': SECOND_TOKEN,
        }),
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

test('通用 MCP：固定白名单只包含已登记的只读 Query/Preview，并复用唯一 AI schema', () => {
    const listed = listMcpTools();
    const aiTools = new Map(AI_TOOLS.map(tool => [tool.function.name, tool]));

    const eligibleReadTools = AI_TOOLS
        .map(tool => getAiCapability(tool.function.name))
        .filter(capability => (
            capability
            && capability.access === 'read'
            && capability.requiresConfirmation === false
            && ['query', 'preview'].includes(capability.operation)
        ))
        .map(capability => capability.toolName);

    assert.equal(listed.length, 45);
    assert.deepEqual(listed.map(tool => tool.name), MCP_READ_ONLY_TOOL_NAMES);
    assert.deepEqual(
        new Set(listed.map(tool => tool.name)),
        new Set(eligibleReadTools),
        'MCP 只读目录必须覆盖全部已登记的安全 Query/Preview'
    );
    for (const tool of listed) {
        const capability = getAiCapability(tool.name);
        assert.equal(capability.access, 'read', tool.name);
        assert.equal(capability.requiresConfirmation, false, tool.name);
        assert.ok(['query', 'preview'].includes(capability.operation), tool.name);
        assert.deepEqual(
            tool.inputSchema,
            buildMcpInputSchema(aiTools.get(tool.name).function.parameters),
            tool.name
        );
        assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
        assert.equal(tool.outputSchema.type, 'object', tool.name);
        assert.equal(tool.annotations.readOnlyHint, true, tool.name);
        assert.equal(tool.annotations.destructiveHint, false, tool.name);
        assert.equal(
            tool.annotations.openWorldHint,
            MCP_OPEN_WORLD_TOOL_NAMES.includes(tool.name),
            tool.name
        );
    }
    assert.deepEqual(MCP_OPEN_WORLD_TOOL_NAMES, ['get_copper_price']);

    const orderDetailSchema = listed.find(tool => tool.name === 'get_order_detail').inputSchema;
    assert.equal(orderDetailSchema.additionalProperties, false);
    assert.ok(orderDetailSchema.oneOf.every(branch => (
        branch.additionalProperties === undefined
    )));
    assert.match(
        listed.find(tool => tool.name === 'get_order_detail').description,
        /不要重复调用两者/
    );
    assert.match(
        listed.find(tool => tool.name === 'get_order_knowledge_package').description,
        /不要再顺序重复调用/
    );
    assert.match(
        listed.find(tool => tool.name === 'check_order_readiness').description,
        /无需先调用 get_order_detail/
    );
    assert.match(
        listed.find(tool => tool.name === 'plan_order_readiness_actions').description,
        /无需先调用 check_order_readiness/
    );
});

test('通用 MCP V2：写目录只包含显式审核过的 Preview + Confirmation 命令', () => {
    const listed = listMcpTools({ includeWrite: true });
    const writes = listed.filter(tool => tool.annotations.readOnlyHint === false);
    assert.equal(listed.length, MCP_READ_ONLY_TOOL_NAMES.length + MCP_WRITE_TOOL_NAMES.length);
    assert.deepEqual(writes.map(tool => tool.name), MCP_WRITE_TOOL_NAMES);
    for (const tool of writes) {
        const capability = getAiCapability(tool.name);
        assert.equal(capability.access, 'write', tool.name);
        assert.equal(capability.operation, 'command', tool.name);
        assert.equal(capability.requiresConfirmation, true, tool.name);
        assert.equal(capability.supportsPreview, true, tool.name);
        assert.equal(tool.annotations.idempotentHint, false, tool.name);
        assert.equal(
            tool.annotations.destructiveHint,
            MCP_POTENTIALLY_DESTRUCTIVE_TOOL_NAMES.includes(tool.name),
            tool.name
        );
    }
    assert.ok(!MCP_WRITE_TOOL_NAMES.includes('create_part'));
    assert.ok(!MCP_WRITE_TOOL_NAMES.includes('delete_order'));
});

test('通用 MCP V2：多轮确认状态使用 HMAC 并绑定服务身份', async () => {
    const actor = 'mcp:generic-test:fingerprint';
    const ctx = {
        mcpReq: {
            method: 'tools/call',
            requestState: () => undefined,
            inputResponses: undefined,
        },
        http: { authInfo: { actor, clientId: 'generic-test' } },
    };
    const first = await executeMcpWriteTool('sync_factory_knowledge', {}, ctx, {
        actor,
        clientId: 'generic-test',
        scopes: ['mcp:read', 'mcp:write'],
        executeToolCall: async (name, args) => ({
            success: true,
            requiresConfirmation: true,
            confirmation: {
                confirmationToken: 'state-confirmation-token-0123456789abcdefghi',
                operationId: '44444444-4444-4444-8444-444444444444',
                argsHash: '3'.repeat(64),
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                toolName: name,
                args,
                title: '同步工厂知识库',
                summary: '准备同步工厂知识库',
            },
        }),
    });
    assert.equal(first.resultType, 'input_required');
    assert.match(first.requestState, /^v1\./);
    const verified = await verifyMcpRequestState(first.requestState, ctx);
    assert.equal(verified.toolName, 'sync_factory_knowledge');

    const stateSegments = first.requestState.split('.');
    const mac = stateSegments.at(-1);
    stateSegments[stateSegments.length - 1] = `${mac[0] === 'A' ? 'B' : 'A'}${mac.slice(1)}`;
    const tampered = stateSegments.join('.');
    await assert.rejects(() => verifyMcpRequestState(tampered, ctx), /mac|malformed/);
    await assert.rejects(() => verifyMcpRequestState(first.requestState, {
        ...ctx,
        http: { authInfo: { actor: 'mcp:other:fingerprint', clientId: 'other' } },
    }), /bind/);
});

test('通用 MCP：越过白名单或缺少正式 API 证据时默认拒绝', async () => {
    let called = false;
    const rejectedWrite = await executeMcpTool('create_part', {}, {
        executeToolCall: async () => {
            called = true;
            return verifiedResult();
        },
    });
    assert.equal(rejectedWrite.isError, true);
    assert.equal(rejectedWrite.structuredContent.code, 'mcp_tool_not_allowed');
    assert.equal(called, false);

    const missingEvidence = await executeMcpTool('get_copper_price', {}, {
        executeToolCall: async () => ({ success: true, data: { cnyPerKg: 80 } }),
    });
    assert.equal(missingEvidence.isError, true);
    assert.equal(missingEvidence.structuredContent.code, 'mcp_execution_evidence_missing');
});

test('通用 MCP：正式 API 已确认资源不存在时保留业务负结果', async () => {
    const response = await executeMcpTool('get_order_detail', { orderId: 999999999 }, {
        executeToolCall: async () => ({
            success: false,
            code: 'AI_RESOURCE_NOT_FOUND',
            error: '找不到订单ID: 999999999',
            executionEvidence: {
                verified: true,
                kind: 'formal_api_query_failure',
                calls: [{
                    method: 'GET',
                    path: '/api/orders/999999999',
                    outcome: 'not_found',
                }],
            },
        }),
    });

    assert.equal(response.isError, true);
    assert.equal(response.structuredContent.code, 'AI_RESOURCE_NOT_FOUND');
    assert.equal(response.structuredContent.mcp.verified, true);
    assert.doesNotMatch(response.structuredContent.code, /mcp_execution_evidence_missing/);
});

test('通用 MCP：已验证业务负结果不触发系统告警，协议或执行错误仍告警', () => {
    assert.deepEqual(classifyMcpToolResponse({ structuredContent: { success: true } }), {
        level: 'info',
        outcome: 'success',
        errorCode: null,
    });
    assert.deepEqual(classifyMcpToolResponse({
        isError: true,
        structuredContent: {
            success: false,
            code: 'AI_RESOURCE_NOT_FOUND',
            mcp: { verified: true },
        },
    }), {
        level: 'info',
        outcome: 'verified_negative',
        errorCode: 'AI_RESOURCE_NOT_FOUND',
    });
    assert.deepEqual(classifyMcpToolResponse({
        isError: true,
        structuredContent: {
            success: false,
            code: 'mcp_tool_execution_failed',
        },
    }), {
        level: 'warn',
        outcome: 'error',
        errorCode: 'mcp_tool_execution_failed',
    });
});

test('通用 MCP：每个 Agent 使用独立 Bearer token，并校验 Host 与 Origin', () => {
    const middleware = createMcpAccessMiddleware({ env: enabledEnv() });
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
    assert.match(accepted.req.mcpActor, /^mcp:generic-test:[a-f0-9]{16}$/);
    assert.equal(accepted.req.auth.clientId, 'generic-test');
    assert.deepEqual(accepted.req.auth.scopes, ['mcp:read']);

    const secondAgent = invoke({
        host: 'pump.example.com',
        authorization: `Bearer ${SECOND_TOKEN}`,
    });
    assert.match(secondAgent.req.mcpActor, /^mcp:second-agent:[a-f0-9]{16}$/);
    assert.notEqual(secondAgent.req.mcpActor, accepted.req.mcpActor);

    const writeMiddleware = createMcpAccessMiddleware({
        env: enabledEnv({
            MCP_WRITE_ENABLED: 'true',
            MCP_WRITE_CLIENT_IDS: 'generic-test',
        }),
    });
    const invokeWrite = headers => {
        const req = { headers };
        const res = {
            setHeader: () => {},
            status: () => res,
            json: body => body,
        };
        let nextCalled = false;
        writeMiddleware(req, res, () => { nextCalled = true; });
        return { req, nextCalled };
    };
    const writeAccepted = invokeWrite({
        host: 'pump.example.com',
        authorization: `Bearer ${TOKEN}`,
    });
    assert.equal(writeAccepted.nextCalled, true);
    assert.deepEqual(writeAccepted.req.auth.scopes, ['mcp:read', 'mcp:write']);
    const readOnlyIdentity = invokeWrite({
        host: 'pump.example.com',
        authorization: `Bearer ${SECOND_TOKEN}`,
    });
    assert.deepEqual(readOnlyIdentity.req.auth.scopes, ['mcp:read']);
});

test('通用 MCP：无效凭证也计入独立入口限流', async () => {
    const router = createMcpRouter({
        env: enabledEnv({ MCP_RATE_LIMIT_PER_MINUTE: '1' }),
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

test('通用 MCP：Hermes 使用的 2025 版客户端仍可发现并调用工具', async () => {
    const calls = [];
    const router = createMcpRouter({
        env: {
            HERMES_MCP_ENABLED: 'true',
            HERMES_MCP_TOKEN: TOKEN,
            CORS_ORIGIN: 'https://pump.example.com',
        },
        executeToolCall: async (name, args, options) => {
            calls.push({ name, args, options });
            return verifiedResult({ cnyPerKg: 80.25 });
        },
    });
    const { server, url } = await listen(router);
    const transport = new LegacyStreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new LegacyClient({ name: 'hermes-mcp-test', version: '1.0.0' });
    try {
        await client.connect(transport);
        const listed = await client.listTools();
        assert.deepEqual(listed.tools.map(tool => tool.name), MCP_READ_ONLY_TOOL_NAMES);

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
            options: { allowWrite: false, caller: 'mcp:hermes' },
        }]);
    } finally {
        await client.close();
        await closeServer(server);
    }
});

test('通用 MCP：2026 客户端自动协商现代无状态协议并调用同一工具目录', async () => {
    const calls = [];
    const router = createMcpRouter({
        env: enabledEnv(),
        executeToolCall: async (name, args, options) => {
            calls.push({ name, args, options });
            return verifiedResult({ cnyPerKg: 81.5 });
        },
    });
    const { server, url } = await listen(router);
    const transport = new ModernStreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new ModernClient(
        { name: 'generic-agent-test', version: '2.0.0' },
        { versionNegotiation: { mode: 'auto' } }
    );
    try {
        await client.connect(transport);
        assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
        assert.ok(client.getDiscoverResult());
        const listed = await client.listTools();
        assert.deepEqual(listed.tools.map(tool => tool.name), MCP_READ_ONLY_TOOL_NAMES);
        assert.equal(listed.tools[0].outputSchema.type, 'object');

        const invalidInput = await client.callTool({
            name: 'search_parts',
            arguments: { limit: 'not-a-number' },
        });
        assert.equal(invalidInput.isError, true);
        assert.match(invalidInput.content[0].text, /validation|expected number/i);
        assert.deepEqual(calls, []);

        const unknownInput = await client.callTool({
            name: 'search_coils',
            arguments: { spec: '12', limit: 10 },
        });
        assert.equal(unknownInput.isError, true);
        assert.match(
            unknownInput.content[0].text,
            /validation|additional|unrecognized|unknown/i
        );
        assert.deepEqual(calls, []);

        const result = await client.callTool({ name: 'get_copper_price', arguments: {} });
        assert.equal(result.structuredContent.data.cnyPerKg, 81.5);
        assert.equal(result.structuredContent.mcp.verified, true);
        assert.deepEqual(calls, [{
            name: 'get_copper_price',
            args: {},
            options: { allowWrite: false, caller: 'mcp:generic-test' },
        }]);
    } finally {
        await client.close();
        await closeServer(server);
        await router.closeMcpHandler();
    }
});

test('通用 MCP V2：2025 无状态客户端缺少交互回路时安全拒绝写入', async () => {
    let executed = 0;
    const router = createMcpRouter({
        env: enabledEnv({
            MCP_WRITE_ENABLED: 'true',
            MCP_WRITE_CLIENT_IDS: 'generic-test',
        }),
        executeToolCall: async (name, args) => ({
            success: true,
            requiresConfirmation: true,
            confirmation: {
                confirmationToken: 'legacy-confirmation-token-0123456789abcdefghi',
                operationId: '33333333-3333-4333-8333-333333333333',
                argsHash: '2'.repeat(64),
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                toolName: name,
                args,
                title: '同步工厂知识库',
                summary: '准备同步工厂知识库',
            },
        }),
        executeConfirmedAiTool: async () => {
            executed += 1;
            throw new Error('不应执行');
        },
    });
    const { server, url } = await listen(router);
    const transport = new LegacyStreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new LegacyClient({ name: 'legacy-write-test', version: '1.0.0' });
    try {
        await client.connect(transport);
        const listed = await client.listTools();
        assert.deepEqual(listed.tools.map(tool => tool.name), MCP_READ_ONLY_TOOL_NAMES);
        await assert.rejects(
            () => client.callTool(
                { name: 'sync_factory_knowledge', arguments: {} },
                undefined,
                { timeout: 2_000 }
            ),
            /not found|unknown|未找到/i
        );
        assert.equal(executed, 0);
    } finally {
        await client.close();
        await closeServer(server);
        await router.closeMcpHandler();
    }
});

test('通用 MCP V2：2026 客户端必须完成人工 elicitation 才执行写命令', async () => {
    const prepared = [];
    const executed = [];
    const env = enabledEnv({
        MCP_WRITE_ENABLED: 'true',
        MCP_WRITE_CLIENT_IDS: 'generic-test',
    });
    const router = createMcpRouter({
        env,
        executeToolCall: async (name, args, options) => {
            prepared.push({ name, args, options });
            return {
                success: true,
                requiresConfirmation: true,
                confirmation: {
                    capabilityId: 'ai.sync_factory_knowledge',
                    riskLevel: 'high',
                    confirmationToken: 'test-confirmation-token-0123456789abcdefghi',
                    operationId: '11111111-1111-4111-8111-111111111111',
                    argsHash: '0'.repeat(64),
                    expiresAt: new Date(Date.now() + 60_000).toISOString(),
                    toolName: name,
                    args,
                    title: '同步工厂知识库',
                    rows: [{ label: '范围', value: '正式知识库' }],
                    summary: '准备同步工厂知识库',
                    warning: '请核对后确认。',
                },
            };
        },
        executeConfirmedAiTool: async input => {
            executed.push(input);
            return {
                name: 'sync_factory_knowledge',
                result: {
                    success: true,
                    data: { synced: 3 },
                    executionEvidence: {
                        verified: true,
                        kind: 'formal_api_command',
                        receipts: [{ auditIds: [71] }],
                    },
                },
                capabilityId: 'ai.sync_factory_knowledge',
                operationId: '11111111-1111-4111-8111-111111111111',
                status: 'completed',
                changes: [{ type: 'knowledge_sync', count: 3 }],
                warnings: [],
                auditId: 71,
                auditIds: [71],
                idempotentReplay: false,
                completedAt: new Date().toISOString(),
            };
        },
    });
    const { server, url } = await listen(router);
    const transport = new ModernStreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const client = new ModernClient(
        { name: 'write-agent-test', version: '2.0.0' },
        { versionNegotiation: { mode: 'auto' } }
    );
    client.registerCapabilities({ elicitation: { form: {} } });
    client.setRequestHandler('elicitation/create', async request => {
        assert.equal(request.params.mode, 'form');
        assert.match(request.params.message, /准备同步工厂知识库/);
        return { action: 'accept', content: { confirm: true } };
    });
    try {
        await client.connect(transport);
        assert.equal(client.getNegotiatedProtocolVersion(), '2026-07-28');
        const listed = await client.listTools();
        assert.deepEqual(
            listed.tools.map(tool => tool.name),
            [...MCP_READ_ONLY_TOOL_NAMES, ...MCP_WRITE_TOOL_NAMES]
        );
        const writeTool = listed.tools.find(tool => tool.name === 'sync_factory_knowledge');
        assert.equal(writeTool.annotations.readOnlyHint, false);

        const result = await client.callTool({
            name: 'sync_factory_knowledge',
            arguments: {},
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent.success, true);
        assert.equal(result.structuredContent.data.status, 'completed');
        assert.equal(result.structuredContent.data.auditId, 71);
        assert.equal(result.structuredContent.mcp.verified, true);
        assert.equal(prepared.length, 1);
        assert.equal(prepared[0].options.allowWrite, false);
        assert.match(prepared[0].options.confirmationSubject, /^mcp:generic-test:/);
        assert.equal(executed.length, 1);
        assert.equal(executed[0].expectedToolName, 'sync_factory_knowledge');
        assert.deepEqual(executed[0].expectedArgs, {});
    } finally {
        await client.close();
        await closeServer(server);
        await router.closeMcpHandler();
    }
});

test('通用 MCP V2：用户拒绝确认和未授权身份均不会执行写命令', async () => {
    let executed = 0;
    const router = createMcpRouter({
        env: enabledEnv({
            MCP_WRITE_ENABLED: 'true',
            MCP_WRITE_CLIENT_IDS: 'generic-test',
        }),
        executeToolCall: async (name, args) => ({
            success: true,
            requiresConfirmation: true,
            confirmation: {
                confirmationToken: 'declined-confirmation-token-0123456789abcdef',
                operationId: '22222222-2222-4222-8222-222222222222',
                argsHash: '1'.repeat(64),
                expiresAt: new Date(Date.now() + 60_000).toISOString(),
                toolName: name,
                args,
                title: '同步工厂知识库',
                summary: '准备同步工厂知识库',
            },
        }),
        executeConfirmedAiTool: async () => {
            executed += 1;
            throw new Error('不应执行');
        },
    });
    const { server, url } = await listen(router);
    const writeTransport = new ModernStreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    });
    const writeClient = new ModernClient(
        { name: 'decline-agent-test', version: '2.0.0' },
        { versionNegotiation: { mode: 'auto' } }
    );
    writeClient.registerCapabilities({ elicitation: { form: {} } });
    writeClient.setRequestHandler('elicitation/create', async () => ({ action: 'decline' }));
    const readTransport = new ModernStreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${SECOND_TOKEN}` } },
    });
    const readClient = new ModernClient(
        { name: 'read-agent-test', version: '2.0.0' },
        { versionNegotiation: { mode: 'auto' } }
    );
    try {
        await writeClient.connect(writeTransport);
        const declined = await writeClient.callTool({
            name: 'sync_factory_knowledge',
            arguments: {},
        });
        assert.equal(declined.isError, undefined);
        assert.equal(declined.structuredContent.code, 'mcp_write_declined');
        assert.equal(executed, 0);

        await readClient.connect(readTransport);
        const listed = await readClient.listTools();
        assert.deepEqual(listed.tools.map(tool => tool.name), MCP_READ_ONLY_TOOL_NAMES);
        assert.equal(listed.tools.some(tool => tool.name === 'sync_factory_knowledge'), false);
    } finally {
        await writeClient.close();
        await readClient.close();
        await closeServer(server);
        await router.closeMcpHandler();
    }
});

test('通用 MCP：HTTP 认证错误与协议错误按标准分层返回', async () => {
    const router = createMcpRouter({ env: enabledEnv() });
    const { server, url } = await listen(router);
    try {
        const unauthorized = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        });
        assert.equal(unauthorized.status, 401);
        assert.match(unauthorized.headers.get('www-authenticate'), /^Bearer /);
        assert.equal((await unauthorized.json()).error, 'invalid_token');

        const unauthorizedMalformed = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{',
        });
        assert.equal(unauthorizedMalformed.status, 401);

        const malformed = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: '{',
        });
        assert.equal(malformed.status, 400);
        assert.match(malformed.headers.get('content-type'), /^application\/json/);
        assert.deepEqual(await malformed.json(), {
            jsonrpc: '2.0',
            id: null,
            error: {
                code: -32700,
                message: 'Parse error',
                data: { requestId: 'mcp-test-request' },
            },
        });

        const oversizedBody = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ value: 'x'.repeat(MCP_MAX_REQUEST_BYTES) }),
        });
        assert.equal(oversizedBody.status, 413);
        assert.deepEqual(await oversizedBody.json(), {
            jsonrpc: '2.0',
            id: null,
            error: {
                code: -32600,
                message: 'Request body too large',
                data: {
                    requestId: 'mcp-test-request',
                    maxRequestBytes: MCP_MAX_REQUEST_BYTES,
                },
            },
        });

        const wrongMediaType = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                'Content-Type': 'text/plain',
            },
            body: '{}',
        });
        assert.equal(wrongMediaType.status, 415);

        const incompleteAccept = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${TOKEN}`,
                Accept: 'application/json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        });
        assert.equal(incompleteAccept.status, 406);

        const legacyGet = await fetch(url, {
            headers: { Authorization: `Bearer ${TOKEN}` },
        });
        assert.equal(legacyGet.status, 405);
    } finally {
        await closeServer(server);
        await router.closeMcpHandler();
    }
});

test('通用 MCP：禁用时隐藏端点，超大结果要求调用方缩小查询', async () => {
    const router = createMcpRouter({ env: { MCP_ENABLED: 'false' } });
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

    const oversized = await executeMcpTool('get_copper_price', {}, {
        executeToolCall: async () => verifiedResult({ value: 'x'.repeat(20_000) }),
        maxResultBytes: 16_384,
    });
    assert.equal(oversized.isError, true);
    assert.equal(oversized.structuredContent.code, 'mcp_result_too_large');
});
