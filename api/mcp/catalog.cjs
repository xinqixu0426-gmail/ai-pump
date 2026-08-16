const { getAiCapability } = require('../capabilities/registry.cjs');
const { AI_TOOLS } = require('../routes/ai/tools.cjs');

// 通用 MCP V1 只暴露经过人工审核的 Query/Preview。新增工具必须显式修改此白名单并补测试。
const MCP_READ_ONLY_TOOL_NAMES = Object.freeze([
    'full_calculate',
    'get_copper_price',
    'calculate_coil_cost',
    'get_coil_specs',
    'search_parts',
    'search_coils',
    'search_templates',
    'get_all_recipes',
    'get_recipe_detail',
    'get_recipe_technical_files',
    'build_recipe_bom_draft',
    'preview_recipe_cost',
    'preview_pump_shell_cost',
    'dynamic_config_cost',
    'compare_recipes',
    'search_customers',
    'search_quotations',
    'search_customer_history',
    'inspect_quotation_file',
    'build_quotation_draft',
    'explain_cost_change',
    'get_recent_orders',
    'get_order_detail',
    'get_purchase_overview',
    'build_order_draft',
    'get_order_knowledge_package',
    'check_order_readiness',
    'get_order_readiness_overview',
    'plan_order_readiness_actions',
    'get_dashboard_summary',
    'get_business_alerts',
    'get_management_action_center',
    'plan_factory_workflow',
    'get_data_quality_summary',
    'analyze_recipe_configuration',
    'get_factory_learning_health',
    'get_factory_rule_candidates',
    'get_factory_rule_impact',
    'get_factory_rule_compliance',
    'get_factory_rule_history',
    'search_factory_file_archive_targets',
    'search_factory_knowledge',
    'get_factory_knowledge_detail',
    'get_factory_knowledge_health',
    'get_rotor_drawing_history',
]);

// 只有会访问管理域外实时数据源的工具才标记为 open world；该标注仅供 MCP 客户端决策。
const MCP_OPEN_WORLD_TOOL_NAMES = Object.freeze([
    'get_copper_price',
]);

const toolsByName = new Map(AI_TOOLS.map(tool => [tool?.function?.name, tool]));

function buildMcpInputSchema(schema) {
    if (Array.isArray(schema)) return schema.map(buildMcpInputSchema);
    if (!schema || typeof schema !== 'object') return schema;

    const normalized = Object.fromEntries(Object.entries(schema).map(([key, value]) => [
        key,
        buildMcpInputSchema(value),
    ]));
    if (
        schema.type === 'object'
        && schema.properties
        && schema.additionalProperties === undefined
        && !(
            Object.keys(schema.properties).length === 0
            && Array.isArray(schema.required)
            && schema.required.length > 0
        )
    ) {
        normalized.additionalProperties = false;
    }
    return normalized;
}

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
            inputSchema: buildMcpInputSchema(tool.function.parameters),
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
    buildMcpInputSchema,
    listMcpTools,
    requireMcpCapability,
};

// 兼容现有本地导入；协议与部署配置不再绑定 Hermes。
module.exports.HERMES_MCP_V1_TOOL_NAMES = MCP_READ_ONLY_TOOL_NAMES;
module.exports.assertHermesMcpCatalogSafe = assertMcpCatalogSafe;
module.exports.listHermesMcpTools = listMcpTools;
module.exports.requireHermesMcpCapability = requireMcpCapability;
