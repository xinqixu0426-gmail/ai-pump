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

// MCP V2 写能力必须同时具备正式 Preview + Confirmation，并经独立写 scope 开放。
// 新增写工具不会自动进入 MCP，必须逐项审计后显式加入。
const MCP_WRITE_TOOL_NAMES = Object.freeze([
    'execute_order_readiness_action',
    'execute_factory_workflow_step',
    'sync_factory_knowledge',
    'generate_purchase_list',
    'create_order',
    'add_recipe_to_order',
    'remove_recipe_from_order',
    'update_order_item',
    'archive_factory_file',
    'create_recipe',
    'update_recipe',
    'adjust_coil_stock',
    'batch_create_parts',
    'adjust_part_stock',
    'batch_update_prices',
    'generate_rotor_drawing',
    'print_rotor_drawing',
]);

const MCP_POTENTIALLY_DESTRUCTIVE_TOOL_NAMES = Object.freeze([
    'execute_order_readiness_action',
    'execute_factory_workflow_step',
    'remove_recipe_from_order',
    'update_order_item',
    'archive_factory_file',
    'update_recipe',
    'adjust_coil_stock',
    'adjust_part_stock',
    'batch_update_prices',
    'print_rotor_drawing',
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
                operation: { enum: ['query', 'preview', 'command'] },
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

function requireMcpCapability(name, options = {}) {
    const normalizedName = String(name || '').trim();
    const isReadTool = MCP_READ_ONLY_TOOL_NAMES.includes(normalizedName);
    const isWriteTool = options.allowWrite === true
        && MCP_WRITE_TOOL_NAMES.includes(normalizedName);
    if (!isReadTool && !isWriteTool) {
        const error = new Error(`MCP 未开放工具: ${normalizedName || '(empty)'}`);
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
    if (isReadTool) {
        if (
            capability.access !== 'read'
            || capability.requiresConfirmation
            || !['query', 'preview'].includes(capability.operation)
        ) {
            const error = new Error(`MCP 只读目录只允许无副作用的 Query/Preview: ${normalizedName}`);
            error.code = 'mcp_write_capability_rejected';
            throw error;
        }
    } else if (
        capability.access !== 'write'
        || capability.operation !== 'command'
        || capability.requiresConfirmation !== true
        || capability.supportsPreview !== true
    ) {
        const error = new Error(`MCP 写目录只允许正式 Preview + Confirmation 命令: ${normalizedName}`);
        error.code = 'mcp_write_contract_rejected';
        throw error;
    }
    return { capability, tool, write: isWriteTool };
}

function listMcpTools(options = {}) {
    const names = options.includeWrite === true
        ? [...MCP_READ_ONLY_TOOL_NAMES, ...MCP_WRITE_TOOL_NAMES]
        : MCP_READ_ONLY_TOOL_NAMES;
    return names.map(name => {
        const { capability, tool, write } = requireMcpCapability(name, {
            allowWrite: options.includeWrite === true,
        });
        return {
            name,
            title: capability.displayName,
            description: tool.function.description,
            inputSchema: buildMcpInputSchema(tool.function.parameters),
            outputSchema: MCP_TOOL_OUTPUT_SCHEMA,
            annotations: {
                title: capability.displayName,
                readOnlyHint: !write,
                destructiveHint: write
                    && MCP_POTENTIALLY_DESTRUCTIVE_TOOL_NAMES.includes(name),
                idempotentHint: !write,
                openWorldHint: MCP_OPEN_WORLD_TOOL_NAMES.includes(name),
            },
        };
    });
}

function assertMcpCatalogSafe() {
    const names = listMcpTools({ includeWrite: true }).map(tool => tool.name);
    if (new Set(names).size !== names.length) {
        throw new Error('MCP V1 工具白名单存在重复项');
    }
    return true;
}

assertMcpCatalogSafe();

module.exports = {
    MCP_READ_ONLY_TOOL_NAMES,
    MCP_OPEN_WORLD_TOOL_NAMES,
    MCP_POTENTIALLY_DESTRUCTIVE_TOOL_NAMES,
    MCP_TOOL_OUTPUT_SCHEMA,
    MCP_WRITE_TOOL_NAMES,
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
