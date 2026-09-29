'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AGENT_TOOLS, AgentToolError, executeAgentTool } = require('../api/services/ai-assistant/agentTools.cjs');
const { mainAgentSystemPrompt, toolCallsFrom } = require('../api/services/ai-assistant/mainAgent.cjs');
const { judgeSystemPrompt } = require('../api/services/ai-assistant/judge.cjs');

function evidence() { return { verified: true, calls: [{ method: 'GET', path: '/internal-only' }] }; }
function formal(name, args) {
    if (name === 'get_all_recipes') {
        const recipes = args.keyword === 'V750'
            ? [{ id: 13, name: 'V750', partsJson: 'private' }]
            : args.keyword ? [{ id: 12, name: 'V550', spec: 'private', updatedAt: 'private' }]
                : [{ id: 12, name: 'V550' }, { id: 13, name: 'V750' }];
        return Promise.resolve({ success: true, data: recipes, executionEvidence: evidence() });
    }
    if (name === 'preview_recipe_cost') return Promise.resolve({ success: true, data: {
        recipeId: args.recipeId, recipeName: args.recipeId === 12 ? 'V550' : 'V750', currentTotalCost: args.recipeId === 12 ? 268.7 : 289.01, costBasis: 'currentFullCost', costComplete: true, readSetHash: 'private',
    }, executionEvidence: evidence() });
    if (name === 'compare_recipes') return Promise.resolve({ success: true, recipe1: { name: 'V550', cost: 268.7 }, recipe2: { name: 'V750', cost: 289.01 }, costDiff: '20.31', costBasis: 'currentFullCost', executionEvidence: evidence() });
    if (name === 'search_coils') {
        const data = args.spec === '12' ? [
            { id: 501, spec: '12', sheets: 120, schemeCode: 'A', schemeName: '钢带小眼', material: '钢带', slotType: '小眼', stock: 8 },
            { id: 502, spec: '12', sheets: 120, schemeCode: 'B', schemeName: '冷轧国标眼', material: '冷轧', slotType: '国标眼', stock: 4 },
        ] : [{ id: 503, spec: '18', sheets: 120, schemeCode: 'C', schemeName: '唯一方案', material: '冷轧', slotType: '国标眼', stock: 7 }];
        return Promise.resolve({ success: true, data: args.schemeCode ? data.filter(item => item.schemeCode === args.schemeCode) : data, executionEvidence: evidence() });
    }
    if (name === 'calculate_coil_cost') return Promise.resolve({ success: true, data: { coilId: args.coilId, spec: '18', sheets: 120, schemeCode: 'C', schemeName: '唯一方案', totalCost: 166.51, sourceVersions: 'private' }, executionEvidence: evidence() });
    if (name === 'preview_virtual_readiness') return Promise.resolve({ success: true, data: { recipe: { displayName: 'V550' }, quantity: args.quantity, status: 'SHORTAGE', inventoryBasis: '扣除活动订单占用后', shortages: [{ model: '电缆', supplier: '供应甲', virtualRequiredQty: 300, availableForVirtualQty: 20, shortageQty: 280, inventoryUnit: '米', sourcePointers: 'private' }], readSetHash: 'private' }, executionEvidence: evidence() });
    if (name === 'preview_profitability') return Promise.resolve({ success: true, data: { costComplete: true, currency: 'CNY', costBasis: 'CURRENT_REBUILT_SCENARIO', scenarioKey: 'candidate', unitPrice: 340, unitCost: 264.35, grossProfitPerUnit: 75.65, grossMarginOnSales: 0.2225, markupOnCost: 0.2861, readSetId: 'private' }, executionEvidence: evidence() });
    throw new Error(`unexpected ${name}`);
}

function context() { return { resolvedRecipeIds: new Set(), resolvedRecipeBindings: new Map(), resolvedCoilBindings: new Map() }; }
async function call(name, args, state) { return executeAgentTool(name, args, state, { executeToolCall: formal }); }

test('M2-A exposes only the core read/analyze tool surface and generic prompt', () => {
    assert.deepEqual(AGENT_TOOLS.map(item => item.function.name), ['find_recipe', 'list_recipes', 'recipe_current_cost', 'compare_recipe_costs', 'find_coils', 'coil_inventory', 'coil_cost', 'preview_profitability', 'preview_virtual_readiness']);
    const prompt = mainAgentSystemPrompt('policy');
    assert.doesNotMatch(prompt, /V550|340|cableLength|先用 find_recipe/);
    assert.match(prompt, /自主选择必要工具和顺序/);
    assert.match(judgeSystemPrompt('policy'), /不要遗漏并列问题/);
    assert.deepEqual(toolCallsFrom({ tool_calls: [
        { id: 'a', function: { name: 'find_recipe', arguments: '{"keyword":"V550"}' } },
        { id: 'b', function: { name: 'find_coils', arguments: '{"spec":"12","sheets":120}' } },
    ] }).map(call => call.name), ['find_recipe', 'find_coils']);
});

test('recipe IDs bind only from a unique formal result and all money is projected from formal tools', async () => {
    const state = context();
    const recipe = await call('find_recipe', { keyword: 'V550' }, state);
    assert.deepEqual(recipe.data, [{ id: 12, name: 'V550' }]);
    assert.equal('execution' in recipe, false);
    const cost = await call('recipe_current_cost', { recipeId: 12 }, state);
    assert.deepEqual(cost.data, { recipeId: 12, recipeName: 'V550', unitCost: 268.7, currency: 'CNY', costBasis: 'currentFullCost', costComplete: true });
    const profit = await call('preview_profitability', { recipeId: 12, cableLength: 5, unitPrice: 340 }, state);
    assert.deepEqual(Object.keys(profit.data).sort(), ['costBasis', 'costComplete', 'currency', 'grossMarginOnSales', 'grossProfitPerUnit', 'markupOnCost', 'scenarioKey', 'unitCost', 'unitPrice']);
    const readiness = await call('preview_virtual_readiness', { recipeId: 12, quantity: 300 }, state);
    assert.equal(readiness.data.shortageItems[0].shortageQuantity, 280);
    await assert.rejects(() => call('recipe_current_cost', { recipeId: 999 }, state), error => error instanceof AgentToolError);
});

test('recipe comparison requires two independently grounded identities', async () => {
    const state = context();
    await call('find_recipe', { keyword: 'V550' }, state);
    await call('find_recipe', { keyword: 'V750' }, state);
    const comparison = await call('compare_recipe_costs', { leftRecipeId: 12, rightRecipeId: 13 }, state);
    assert.deepEqual(comparison.data, { left: { name: 'V550', unitCost: 268.7 }, right: { name: 'V750', unitCost: 289.01 }, costDifference: '20.31', currency: 'CNY', costBasis: 'currentFullCost' });
});

test('ambiguous coils remain distinct and cannot be silently used for inventory or cost', async () => {
    const state = context();
    const coils = await call('find_coils', { spec: '12', sheets: 120 }, state);
    assert.equal(coils.data.length, 2);
    assert.deepEqual(Object.keys(coils.data[0]).sort(), ['commonDesignation', 'id', 'material', 'schemeCode', 'schemeName', 'slotType']);
    await assert.rejects(() => call('coil_cost', { coilId: 501 }, state), error => error instanceof AgentToolError && error.code === 'AGENT_TOOL_IDENTITY_UNVERIFIED');
    await call('find_coils', { spec: '18', sheets: 120 }, state);
    const inventory = await call('coil_inventory', { coilId: 503 }, state);
    assert.deepEqual(inventory.data[0], { coilId: 503, commonDesignation: '18-120', schemeCode: 'C', schemeName: '唯一方案', quantity: 7, unit: '件', inventoryBasis: '当前在库' });
    const cost = await call('coil_cost', { coilId: 503 }, state);
    assert.equal(cost.data.unitCost, 166.51);
});

const CORE_16 = [
    ['12-120还有多少库存？', ['find_coils', 'coil_inventory']], ['12-120成本多少？', ['find_coils', 'coil_cost']], ['V550现在成本多少？', ['find_recipe', 'recipe_current_cost']], ['列一下配方。', ['list_recipes']],
    ['V550现在成本多少？顺便看看12-120还有多少库存。', ['find_recipe', 'recipe_current_cost', 'find_coils', 'coil_inventory']], ['12-120现在库存还有多少，成本又是多少？', ['find_coils', 'coil_inventory', 'coil_cost']],
    ['V550和V750成本差多少？', ['find_recipe', 'find_recipe', 'compare_recipe_costs']], ['V550如果现在再做300台，库存够不够？', ['find_recipe', 'preview_virtual_readiness']], ['V550如果做300台，缺什么料？', ['find_recipe', 'preview_virtual_readiness']], ['V550电缆改成5米，卖340元，毛利多少？先不要保存。', ['find_recipe', 'preview_profitability']],
    ['V550现在成本多少？', ['find_recipe', 'recipe_current_cost']], ['那V750呢？', ['find_recipe', 'recipe_current_cost']], ['这两个差多少？', ['find_recipe', 'find_recipe', 'compare_recipe_costs']],
    ['12-120还有多少？', ['find_coils', 'coil_inventory']], ['它成本呢？', ['find_coils', 'coil_cost']], ['有其他同规格方案吗？', ['find_coils']],
];
test('M0 core 16 deterministic acceptance fixtures are covered by the generic tool surface', () => {
    assert.equal(CORE_16.length, 16);
    const names = new Set(AGENT_TOOLS.map(item => item.function.name));
    for (const [, needed] of CORE_16) for (const name of needed) assert.ok(names.has(name), `${name} must be exposed`);
});
