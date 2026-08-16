const {
    McpServer,
    fromJsonSchema,
} = require('@modelcontextprotocol/server');
const { createLogger } = require('../logger.cjs');
const { executeToolCall } = require('../routes/ai/executor.cjs');
const { hasVerifiedExecution } = require('../services/aiExecutionEvidence.cjs');
const {
    getMcpMaxResultBytes,
} = require('../services/environment.cjs');
const {
    listMcpTools,
    requireMcpCapability,
} = require('./catalog.cjs');

const mcpLogger = createLogger('mcp');

function errorResult(code, message) {
    const payload = { success: false, code, error: message };
    return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload,
    };
}

function publicExecutionResult(result, capability) {
    const { executionEvidence, ...businessResult } = result;
    return {
        ...businessResult,
        mcp: {
            capabilityId: capability.capabilityId,
            operation: capability.operation,
            sourceOfTruth: capability.sourceOfTruth,
            dataMode: capability.dataMode,
            verified: executionEvidence?.verified === true,
            fetchedAt: new Date().toISOString(),
        },
    };
}

function serializeMcpResult(payload, maxResultBytes) {
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, 'utf8') > maxResultBytes) {
        return errorResult(
            'mcp_result_too_large',
            '查询结果超过 MCP 返回上限，请增加筛选条件或缩小 limit'
        );
    }
    return {
        content: [{ type: 'text', text: serialized }],
        structuredContent: payload,
    };
}

async function executeMcpTool(name, args, options = {}) {
    let capability;
    try {
        ({ capability } = requireMcpCapability(name));
    } catch (error) {
        return errorResult(error.code || 'mcp_tool_not_allowed', error.message);
    }

    const execute = options.executeToolCall || executeToolCall;
    const verifyEvidence = options.hasVerifiedExecution || hasVerifiedExecution;
    let result;
    try {
        result = await execute(name, args || {}, {
            allowWrite: false,
            caller: `mcp:${options.clientId || 'unknown'}`,
        });
    } catch (error) {
        return errorResult(error.code || 'mcp_tool_execution_failed', error.message);
    }

    if (result?.requiresConfirmation) {
        return errorResult(
            'mcp_write_capability_rejected',
            'MCP 只读目录禁止写操作和确认令牌签发'
        );
    }
    if (!verifyEvidence(result)) {
        return errorResult(
            'mcp_execution_evidence_missing',
            result?.error || '正式业务 API 执行证据缺失，不能返回业务事实'
        );
    }

    const payload = publicExecutionResult(result, capability);
    const maxResultBytes = options.maxResultBytes
        || getMcpMaxResultBytes(options.env || process.env);
    const response = serializeMcpResult(payload, maxResultBytes);
    if (result.success === false) response.isError = true;
    return response;
}

function createMcpProtocolServer(options = {}) {
    const server = new McpServer(
        { name: 'pump-factory-mcp', version: '1.1.0' },
        {
            instructions: [
                '只使用已列出的只读工具读取水泵工厂正式事实。',
                '本服务不支持写操作；不得把知识候选当作实时库存、价格、成本或订单事实。',
                '工具失败或未找到时如实报告，不得根据历史消息补写业务数据。',
            ].join(''),
            cacheHints: {
                'tools/list': { ttlMs: 300000, cacheScope: 'private' },
                'server/discover': { ttlMs: 300000, cacheScope: 'private' },
            },
        }
    );

    for (const tool of listMcpTools()) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: fromJsonSchema(tool.inputSchema),
                outputSchema: fromJsonSchema(tool.outputSchema),
                annotations: tool.annotations,
                _meta: {
                    'com.pump-factory/capability-id': requireMcpCapability(tool.name)
                        .capability.capabilityId,
                },
            },
            async args => {
                const startedAt = Date.now();
                const response = await executeMcpTool(tool.name, args, options);
                const meta = {
                    requestId: options.requestId || null,
                    actor: options.actor || 'mcp:unknown',
                    clientId: options.clientId || null,
                    protocolEra: options.protocolEra || null,
                    toolName: tool.name,
                    success: response.isError !== true,
                    durationMs: Date.now() - startedAt,
                };
                if (response.isError) mcpLogger.warn('MCP 工具调用失败', meta);
                else mcpLogger.info('MCP 工具调用完成', meta);
                return response;
            }
        );
    }

    return server;
}

module.exports = {
    createMcpProtocolServer,
    errorResult,
    executeMcpTool,
    publicExecutionResult,
    serializeMcpResult,
};

module.exports.createHermesMcpProtocolServer = createMcpProtocolServer;
module.exports.executeHermesMcpTool = executeMcpTool;
