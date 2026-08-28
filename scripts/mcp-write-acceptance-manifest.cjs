const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const COMMON_PROTOCOL_TESTS = Object.freeze([
    'tests/mcp.test.cjs',
    'tests/aiToolConfirmation.test.cjs',
    'tests/aiCapabilityRegistry.test.cjs',
]);

// Baseline accepted before this batch. This is a test cohort, not a projection
// of the live production allowlist; deployment verification reads that state
// from the authenticated endpoint.
const MCP_PREVIOUSLY_ACCEPTED_WRITE_TOOL_NAMES = Object.freeze([
    'sync_factory_knowledge',
    'create_recipe',
    'update_recipe',
    'delete_recipe',
    'adjust_coil_stock',
    'batch_create_parts',
    'adjust_part_stock',
    'delete_part',
    'batch_update_prices',
]);

const MCP_BATCH_WRITE_SCENARIOS = Object.freeze([
    Object.freeze({
        id: 'order_and_workflow',
        title: '订单与报价转单',
        tools: Object.freeze([
            'execute_order_readiness_action',
            'execute_factory_workflow_step',
            'generate_purchase_list',
            'create_order',
            'add_recipe_to_order',
            'remove_recipe_from_order',
            'update_order_item',
        ]),
        cleanup: 'destroy_temporary_database',
        productionBoundary: 'dedicated gray data only; quotation conversion is decline-only in production',
    }),
    Object.freeze({
        id: 'file_archive',
        title: '文件归档',
        tools: Object.freeze(['archive_factory_file']),
        cleanup: 'destroy_temporary_database',
        productionBoundary: 'dedicated canary file only',
    }),
    Object.freeze({
        id: 'rotor_output',
        title: '转子出图与打印',
        tools: Object.freeze(['generate_rotor_drawing', 'print_rotor_drawing']),
        cleanup: 'destroy_temporary_directory',
        productionBoundary: 'print command is decline-only; localhost execution must use fail-closed stubs',
    }),
]);

const MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES = Object.freeze(
    MCP_BATCH_WRITE_SCENARIOS.flatMap(scenario => scenario.tools)
);

function batchScenarioForTool(name) {
    return MCP_BATCH_WRITE_SCENARIOS.find(scenario => scenario.tools.includes(name)) || null;
}

const MCP_WRITE_ACCEPTANCE_CASES = Object.freeze([
    {
        name: 'execute_order_readiness_action',
        args: { orderId: 101, actionId: 'confirm_order' },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/orderCommands.test.cjs'],
        isolation: 'formal API stub + in-memory order database',
    },
    {
        name: 'execute_factory_workflow_step',
        args: { workflowType: 'quotation_to_order', quotationId: 201, actionId: 'convert_quotation' },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/factoryWorkflowCommands.test.cjs'],
        isolation: 'formal API stub + in-memory workflow database',
    },
    {
        name: 'sync_factory_knowledge',
        args: {},
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/knowledgeAutoSync.test.cjs'],
        isolation: 'formal API stub + in-memory knowledge database',
    },
    {
        name: 'generate_purchase_list',
        args: { orderId: 101, reason: 'MCP 本地验收重新生成采购清单' },
        businessTests: ['tests/orderCommands.test.cjs', 'tests/orderPlanning.test.cjs'],
        isolation: 'in-memory order database',
    },
    {
        name: 'create_order',
        args: { customerName: '本地验收客户', contractNo: 'LOCAL-MCP-001' },
        businessTests: ['tests/orderCommands.test.cjs'],
        isolation: 'in-memory order database',
    },
    {
        name: 'add_recipe_to_order',
        args: { orderId: 101, recipeName: '本地验收配方', qty: 2, reason: 'MCP 本地验收追加产品' },
        businessTests: ['tests/orderCommands.test.cjs'],
        isolation: 'in-memory order database',
    },
    {
        name: 'remove_recipe_from_order',
        args: { orderId: 101, recipeName: '本地验收配方', reason: 'MCP 本地验收移除产品' },
        businessTests: ['tests/orderCommands.test.cjs'],
        isolation: 'in-memory order database',
    },
    {
        name: 'update_order_item',
        args: { orderId: 101, recipeName: '本地验收配方', qty: 3, reason: 'MCP 本地验收调整数量' },
        businessTests: ['tests/orderCommands.test.cjs'],
        isolation: 'in-memory order database',
    },
    {
        name: 'archive_factory_file',
        args: { fileId: 301, targetType: 'recipe', targetId: 401, title: '本地验收归档' },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/factoryFileArchive.test.cjs'],
        isolation: 'temporary files + in-memory archive database',
    },
    {
        name: 'create_recipe',
        args: { name: '本地验收配方', spec: '1寸' },
        businessTests: ['tests/recipeCommands.test.cjs'],
        isolation: 'in-memory recipe database',
    },
    {
        name: 'update_recipe',
        args: { recipeName: '本地验收配方', newSpec: '1.5寸' },
        businessTests: ['tests/recipeCommands.test.cjs'],
        isolation: 'in-memory recipe database',
    },
    {
        name: 'delete_recipe',
        args: { recipeName: '本地验收配方' },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/recipeCommands.test.cjs'],
        isolation: 'formal delete preview/API + in-memory recipe database',
    },
    {
        name: 'adjust_coil_stock',
        args: { items: [{ model: '12-120', changeQty: 1 }], note: 'MCP 本地验收' },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/coilInventory.test.cjs'],
        isolation: 'formal API stub + in-memory coil database',
    },
    {
        name: 'batch_create_parts',
        args: { parts: [{ model: 'MCP-LOCAL-PART', price: 1.25, supplier: '本地验收' }] },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/partCommands.test.cjs'],
        isolation: 'formal API stub + in-memory parts database',
    },
    {
        name: 'adjust_part_stock',
        args: { items: [{ model: 'MCP-LOCAL-PART', changeQty: 1 }], note: 'MCP 本地验收' },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/partCommands.test.cjs'],
        isolation: 'formal API stub + in-memory parts database',
    },
    {
        name: 'delete_part',
        args: { partId: 1, model: 'MCP-LOCAL-PART', supplier: '本地验收' },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/partCommands.test.cjs'],
        isolation: 'formal delete preview/API + in-memory parts database',
    },
    {
        name: 'batch_update_prices',
        args: { targets: [{ partId: 1 }], absoluteChange: 0.01 },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/partCommands.test.cjs'],
        isolation: 'formal API stub + in-memory parts database',
    },
    {
        name: 'generate_rotor_drawing',
        args: { shell_model: 'V750', piece_count: 160 },
        businessTests: ['tests/aiExecutorBehavior.test.cjs', 'tests/rotorExternalCommands.test.cjs'],
        isolation: 'formal API stub + temporary drawing job boundary',
    },
    {
        name: 'print_rotor_drawing',
        args: { jobId: 'local-mcp-drawing-job' },
        businessTests: ['tests/aiCapabilityRegistry.test.cjs', 'tests/rotorExternalCommands.test.cjs'],
        isolation: 'printer command stub; no physical print',
    },
]);

function acceptanceTestFiles() {
    return [...new Set([
        'tests/mcpWriteLocalVerification.test.cjs',
        ...COMMON_PROTOCOL_TESTS,
        ...MCP_WRITE_ACCEPTANCE_CASES.flatMap(item => item.businessTests),
    ])];
}

module.exports = {
    COMMON_PROTOCOL_TESTS,
    MCP_PREVIOUSLY_ACCEPTED_WRITE_TOOL_NAMES,
    MCP_BATCH_WRITE_SCENARIOS,
    MCP_BATCH_CANDIDATE_WRITE_TOOL_NAMES,
    MCP_WRITE_ACCEPTANCE_CASES,
    ROOT,
    acceptanceTestFiles,
    batchScenarioForTool,
};
