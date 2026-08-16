const { getAiCapability } = require('../capabilities/registry.cjs');
const { AI_TOOLS } = require('../routes/ai/tools.cjs');

// 通用 MCP V1 只暴露经过人工审核的 Query/Preview。新增工具必须显式修改此白名单并补测试。
const MCP_READ_ONLY_TOOL_NAMES = Object.freeze([
    'get_copper_price',
    'search_parts',
    'search_coils',
    'get_all_recipes',
    'get_recipe_detail',
    'preview_recipe_cost',
    'get_recent_orders',
    'get_order_detail',
    'check_order_readiness',
    'get_order_readiness_overview',
    'get_management_action_center',
    'search_factory_knowledge',
]);

// 只有会访问管理域外实时数据源的工具才标记为 open world；该标注仅供 MCP 客户端决策。
const MCP_OPEN_WORLD_TOOL_NAMES = Object.freeze([
    'get_copper_price',
]);

const toolsByName = new Map(AI_TOOLS.map(tool => [tool?.function?.name, tool]));

const MCP_TOOL_OUTPUT_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        success: { type: 'boolean' },
        code: { type: 'string' },
        error: { type: 'string' },
        mcp: {
            type: 'object',
            properties: {
                capabilityId: { type: 'string' },
                operation: { enum: ['query', 'preview'] },
                sourceOfTruth: { type: 'string' },
                dataMode: { type: 'string' },
                verified: { type: 'boolean' },
                fetchedAt: { type: 'string', format: 'date-time' },
            },
            additionalProperties: false,
        },
    },
    additionalProperties: true,
});

function requireMcpCapability(name) {
    const normalizedName = String(name || '').trim();
    if (!MCP_READ_ONLY_TOOL_NAMES.includes(normalizedName)) {
        const error = new Error(`MCP V1 未开放工具: ${normalizedName || '(empty)'}`);
        error.code = 'mcp_tool_not_allowed';
        throw error;
    }

    const capability = getAiCapability(normalizedName);
    const tool = toolsByName.get(normalizedName);
    if (!capability || !tool) {
        const error = new Error(`MCP 工具契约不完整: ${normalizedName}`);
        error.code = 'mcp_tool_contract_missing';
        throw error;
    }
    if (
        capability.access !== 'read'
        || capability.requiresConfirmation
        || !['query', 'preview'].includes(capability.operation)
    ) {
        const error = new Error(`MCP V1 只允许无副作用的 Query/Preview: ${normalizedName}`);
        error.code = 'mcp_write_capability_rejected';
        throw error;
    }
    return { capability, tool };
}

function listMcpTools() {
    return MCP_READ_ONLY_TOOL_NAMES.map(name => {
        const { capability, tool } = requireMcpCapability(name);
        return {
            name,
            title: capability.displayName,
            description: tool.function.description,
            inputSchema: tool.function.parameters,
            outputSchema: MCP_TOOL_OUTPUT_SCHEMA,
            annotations: {
                title: capability.displayName,
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: MCP_OPEN_WORLD_TOOL_NAMES.includes(name),
            },
        };
    });
}

function assertMcpCatalogSafe() {
    const names = listMcpTools().map(tool => tool.name);
    if (new Set(names).size !== names.length) {
        throw new Error('MCP V1 工具白名单存在重复项');
    }
    return true;
}

assertMcpCatalogSafe();

module.exports = {
    MCP_READ_ONLY_TOOL_NAMES,
    MCP_OPEN_WORLD_TOOL_NAMES,
    MCP_TOOL_OUTPUT_SCHEMA,
    assertMcpCatalogSafe,
    listMcpTools,
    requireMcpCapability,
};

// 兼容现有本地导入；协议与部署配置不再绑定 Hermes。
module.exports.HERMES_MCP_V1_TOOL_NAMES = MCP_READ_ONLY_TOOL_NAMES;
module.exports.assertHermesMcpCatalogSafe = assertMcpCatalogSafe;
module.exports.listHermesMcpTools = listMcpTools;
module.exports.requireHermesMcpCapability = requireMcpCapability;
