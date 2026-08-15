const { getAiCapability } = require('../capabilities/registry.cjs');
const { AI_TOOLS } = require('../routes/ai/tools.cjs');

// V1 只暴露经过人工审核的 Query/Preview。新增工具必须显式修改此白名单并补测试。
const HERMES_MCP_V1_TOOL_NAMES = Object.freeze([
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

const toolsByName = new Map(AI_TOOLS.map(tool => [tool?.function?.name, tool]));

function requireHermesMcpCapability(name) {
    const normalizedName = String(name || '').trim();
    if (!HERMES_MCP_V1_TOOL_NAMES.includes(normalizedName)) {
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

function listHermesMcpTools() {
    return HERMES_MCP_V1_TOOL_NAMES.map(name => {
        const { capability, tool } = requireHermesMcpCapability(name);
        return {
            name,
            title: capability.displayName,
            description: tool.function.description,
            inputSchema: tool.function.parameters,
            annotations: {
                title: capability.displayName,
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
            },
        };
    });
}

function assertHermesMcpCatalogSafe() {
    const names = listHermesMcpTools().map(tool => tool.name);
    if (new Set(names).size !== names.length) {
        throw new Error('MCP V1 工具白名单存在重复项');
    }
    return true;
}

assertHermesMcpCatalogSafe();

module.exports = {
    HERMES_MCP_V1_TOOL_NAMES,
    assertHermesMcpCatalogSafe,
    listHermesMcpTools,
    requireHermesMcpCapability,
};
