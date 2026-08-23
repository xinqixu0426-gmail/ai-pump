const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const COMMON_PROTOCOL_TESTS = Object.freeze([
    'tests/mcp.test.cjs',
    'tests/aiToolConfirmation.test.cjs',
    'tests/aiCapabilityRegistry.test.cjs',
]);

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
        name: 'batch_update_prices',
        args: { category: '本地验收分类', percentChange: 1 },
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
    MCP_WRITE_ACCEPTANCE_CASES,
    ROOT,
    acceptanceTestFiles,
};
