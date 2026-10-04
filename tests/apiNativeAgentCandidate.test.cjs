'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const { AI_FORMAL_TOOLS } = require('../api/services/aiFormalToolDefinitions.cjs');
const { executeAgentTool } = require('../api/services/ai-assistant/agentTools.cjs');
const { executeCostTool } = require('../api/routes/ai/executors/costExecutors.cjs');
const { createFactLedger } = require('../api/services/ai-assistant/factLedger.cjs');
const { createToolSchemaSession } = require('../api/services/ai-assistant/toolSchemaLoader.cjs');
const { validateAnswer } = require('../api/services/ai-assistant/answerValidator.cjs');
const { callKey, businessEvidenceFingerprint, renderClaimableFactsForModel, runApiNativeAgentCandidate } = require('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs');

function toolCall(id, name, args) { return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } }; }
function scripted(messages) {
    let cursor = 0; const calls = [];
    return Object.assign(async (_messages, options) => {
        calls.push({ tools: options.tools.map(item => item.function.name), messages: _messages });
        const next = messages[cursor++];
        if (!next) throw new Error('Unexpected model call');
        return next;
    }, { calls });
}
function baseInput() { return { rawOwnerInput: '请查正式数据', businessMemo: '# Business\n正式业务语义。', policyMemo: '# Policy\n只读。', finalizationEnabled: false }; }

test('AG-01..06: initial control tools load a canonical schema, execute it, return its fact to the same conversation, and never ledger load_tools', async () => {
    const model = scripted([
        { content: '', tool_calls: [toolCall('load-1', 'load_tools', { toolNames: ['get_all_recipes'] })] },
        { content: '', tool_calls: [toolCall('read-1', 'get_all_recipes', {})] },
        { content: JSON.stringify({ answer: '已查到正式配方目录。', claims: [{ text: '已查到正式配方目录。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }) },
    ]);
    const result = await runApiNativeAgentCandidate(baseInput(), {
        modelCall: model,
        executeToolCall: async (name, args) => {
            assert.equal(name, 'get_all_recipes'); assert.deepEqual(args, {});
            return { success: true, executionEvidence: { verified: true }, data: [{ id: 1, name: 'V750-通用款' }] };
        },
    });
    assert.deepEqual(model.calls[0].tools, ['load_tools', 'resolve_entity']);
    assert.ok(model.calls[1].tools.includes('get_all_recipes'));
    assert.equal(result.flags.toolResultsReturnToSameAgent, true);
    assert.equal(result.flags.secondToolDecisionAfterResult, true);
    assert.equal(result.factLedger.facts.some(item => item.source.tool === 'load_tools'), false);
    assert.ok(result.factLedger.facts.some(item => item.predicate === 'formal_result_available'));
    assert.equal(result.answerValidation.valid, true);
});

test('AG-07..11: write/deferred/not-loaded calls fail closed while a second load keeps prior schemas', async () => {
    const model = scripted([
        { content: '', tool_calls: [toolCall('bad-write', 'update_recipe', { recipeId: 1 })] },
        { content: '', tool_calls: [toolCall('load-1', 'load_tools', { toolNames: ['search_coils'] })] },
        { content: '', tool_calls: [toolCall('load-2', 'load_tools', { toolNames: ['calculate_coil_cost'] })] },
        { content: JSON.stringify({ answer: '请明确需要查询的线圈。', claims: [], goals: [{ questionIndex: 0, status: 'CLARIFICATION', factIds: [] }] }) },
    ]);
    const result = await runApiNativeAgentCandidate(baseInput(), { modelCall: model });
    assert.equal(result.traces[0].code, 'TOOL_NOT_LOADED');
    assert.deepEqual(result.metrics.loadedToolNames, ['search_coils', 'calculate_coil_cost']);
    assert.equal(result.metrics.loadToolsCalls, 2);
    assert.equal(result.answerValidation.valid, true);
    const session = createToolSchemaSession();
    assert.equal(session.load(['preview_recipe_cost']).code, 'TOOL_SCHEMA_NOT_DISCOVERABLE');
    assert.equal(session.load(['update_recipe']).code, 'TOOL_SCHEMA_NOT_DISCOVERABLE');
});

test('AG-04 and AG-12: loaded runtime definition is compatible with existing Agent execution and nested scenarios have distinct dedup keys', async () => {
    const session = createToolSchemaSession();
    assert.equal(session.load(['get_all_recipes']).success, true);
    const context = { selectedToolNames: new Set(['get_all_recipes']), entityBindings: new Map() };
    const result = await executeAgentTool('get_all_recipes', {}, context, {
        executeToolCall: async (name, args) => {
            assert.equal(name, 'get_all_recipes'); assert.deepEqual(args, {});
            return { success: true, executionEvidence: { verified: true }, data: [] };
        },
    });
    assert.equal(result.success, true);
    const left = callKey('compare_recipe_scenarios', { recipeId: 1, scenarios: [{ overrides: { cableLength: 5 } }] });
    const right = callKey('compare_recipe_scenarios', { recipeId: 1, scenarios: [{ overrides: { cableLength: 10 } }] });
    assert.notEqual(left, right);
    assert.equal(left, callKey('compare_recipe_scenarios', { scenarios: [{ overrides: { cableLength: 5 } }], recipeId: 1 }));
});

test('AG-13..14: formal errors return to the same agent, and hard safety failures cannot be bypassed', async () => {
    const model = scripted([
        { content: '', tool_calls: [toolCall('load-1', 'load_tools', { toolNames: ['get_all_recipes'] })] },
        { content: '', tool_calls: [toolCall('read-1', 'get_all_recipes', {})] },
        { content: JSON.stringify({ answer: '正式查询暂不可用，请稍后重试。', claims: [], goals: [{ questionIndex: 0, status: 'UNAVAILABLE', factIds: [] }] }) },
    ]);
    const result = await runApiNativeAgentCandidate(baseInput(), {
        modelCall: model,
        executeToolCall: async () => ({ success: false, code: 'FORMAL_TRANSPORT_UNAVAILABLE', category: 'TRANSPORT', recoverable: true }),
    });
    assert.equal(result.traces.find(item => item.name === 'get_all_recipes').success, false);
    assert.equal(model.calls.length, 3);
    assert.equal(result.answerValidation.valid, true);
    assert.equal(result.metrics.businessToolCalls, 1);
});

test('AG-15: Answer Validator rejects a money claim bound to the wrong entity even in the candidate loop', async () => {
    const model = scripted([
        { content: '', tool_calls: [toolCall('resolve-1', 'resolve_entity', { entityType: 'recipe', mention: 'V750' })] },
        { content: '', tool_calls: [toolCall('load-1', 'load_tools', { toolNames: ['get_recipe_detail'] })] },
        { content: '', tool_calls: [toolCall('read-1', 'get_recipe_detail', { recipeId: 1 })] },
        { content: JSON.stringify({ answer: '另一配方当前成本为 100 元。', claims: [{ text: '另一配方当前成本为 100 元。', factIds: ['F-003'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-003'] }] }) },
    ]);
    const result = await runApiNativeAgentCandidate({ ...baseInput(), maxMainModelCalls: 4 }, {
        modelCall: model,
        resolveAgentEntity: async () => ({ entityType: 'recipe', mention: 'V750', status: 'RESOLVED', canonicalId: '1', canonicalName: 'V750-通用款', candidates: [], source: 'formal', verified: true }),
        executeToolCall: async _name => ({ success: true, executionEvidence: { verified: true }, data: { currentTotalCost: 100, recipeName: 'V750-通用款' } }),
    });
    assert.equal(result.answerValidation.valid, false);
    assert.equal(result.answerValidation.code, 'MONEY_CLAIM_BINDING_MISMATCH');
    assert.equal(result.answer, '本轮正式查询已完成，但无法验证回答中的业务事实；请根据正式查询结果重新查询。');
});

test('R1-04..10: claimable facts retain entity and basis, duplicate evidence is not ledgered twice, and finalization has a reserved repair', async () => {
    const model = scripted([
        { content: '', tool_calls: [toolCall('load-1', 'load_tools', { toolNames: ['get_all_recipes'] })] },
        { content: '', tool_calls: [toolCall('read-1', 'get_all_recipes', {})] },
        // The initial investigation draft is ignored by the final-only phase. The first
        // final envelope is intentionally malformed, then the reserved repair corrects it.
        { content: 'draft awaiting finalization' },
        { content: 'not-json' },
        { content: JSON.stringify({ answer: '已取得正式配方当前成本。', claims: [{ text: '已取得正式配方当前成本。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }) },
    ]);
    let finalValidations = 0;
    const result = await runApiNativeAgentCandidate({ ...baseInput(), finalizationEnabled: true, completionReviewEnabled: false }, {
        modelCall: model,
        executeToolCall: async () => ({ success: true, verified: true, executionEvidence: { verified: true }, data: { currentTotalCost: 100, costBasis: 'current' } }),
        validateAnswer: raw => {
            finalValidations += 1;
            if (raw === 'not-json') return { valid: false, code: 'ANSWER_ENVELOPE_INVALID', answer: null, goals: [] };
            return { valid: true, code: null, answer: '已取得正式配方当前成本。', goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] };
        },
    });
    assert.equal(result.answerValidation.valid, true);
    assert.equal(result.metrics.mainModelCalls, 5);
    assert.equal(finalValidations, 2);
    assert.equal(result.claimableFacts.some(item => item.predicate === 'formal_result_available'), true);
    assert.equal(model.calls.at(-1).tools.length, 0);
    assert.match(model.calls.at(-1).messages.at(-1).content, /CLAIMABLE FACT CATALOG/);

    const duplicateModel = scripted([
        { content: '', tool_calls: [toolCall('load-1', 'load_tools', { toolNames: ['search_coils'] })] },
        { content: '', tool_calls: [toolCall('read-1', 'search_coils', { spec: '12' })] },
        { content: '', tool_calls: [toolCall('read-2', 'search_coils', { spec: '13' })] },
        { content: JSON.stringify({ answer: '已取得正式目录。', claims: [{ text: '已取得正式目录。', factIds: ['F-001'] }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }] }) },
    ]);
    const duplicated = await runApiNativeAgentCandidate(baseInput(), {
        modelCall: duplicateModel,
        executeToolCall: async () => ({ success: true, verified: true, executionEvidence: { verified: true }, data: [{ id: 1, name: 'V750-通用款' }] }),
    });
    assert.equal(duplicated.metrics.noNewEvidenceEvents, 1);
    assert.equal(duplicated.metrics.duplicateFactsAvoided, 1);
    assert.equal(duplicated.factLedger.facts.filter(item => item.predicate === 'formal_result_available').length, 1);
    assert.equal(businessEvidenceFingerprint({ data: { fetchedAt: 'a', value: 1 } }), businessEvidenceFingerprint({ data: { fetchedAt: 'b', value: 1 } }));

    const catalog = renderClaimableFactsForModel({ facts: [{ factId: 'F-001', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'V750-通用款' }, predicate: 'current_cost', value: 100, unit: 'CNY', basis: 'current', source: { tool: 'get_recipe_detail' } }] });
    assert.deepEqual(catalog, [{ factId: 'F-001', entity: { type: 'recipe', canonicalName: 'V750-通用款' }, predicate: 'current_cost', value: 100, unit: 'CNY', basis: 'current', sourceTool: 'get_recipe_detail' }]);
});

test('R1-20: a formally resolved coil ID safely hydrates official dimensions before the cost preview route', async () => {
    const requests = [];
    const internalFetch = async (url, options = {}) => {
        requests.push({ url, options });
        if (url.startsWith('/api/coils')) return new Response(JSON.stringify({ success: true, data: [{ id: 71, spec: '12', sheets: 120, material: '钢带', slotType: '小眼', schemeStatus: 'official' }] }), { status: 200 });
        if (url === '/api/coils/calculate') return new Response(JSON.stringify({ success: true, data: { coilId: 71, totalCost: 88.5 } }), { status: 200 });
        throw new Error(`Unexpected route ${url}`);
    };
    const result = await executeCostTool('calculate_coil_cost', { coilId: 71 }, internalFetch);
    assert.equal(result.success, true);
    const calculation = requests.find(item => item.url === '/api/coils/calculate');
    assert.ok(calculation);
    assert.deepEqual(JSON.parse(calculation.options.body), {
        spec: '12', coilId: 71, schemeCode: '', schemeFamilyCode: '', sheets: 120,
        material: '钢带', slotType: '小眼', wireWeight: null, includeTesting: true,
    });
});

test('R1-06..16: candidate-only scenario facts retain entity, basis and candidate qualifiers without changing the default ledger', () => {
    const result = { success: true, verified: true, data: {
        scenarios: [
            { scenarioKey: 'base', role: 'BASE', label: '当前', cost: { currentTotalCost: 100, currency: 'CNY', costBasis: 'CURRENT_REBUILT_BASE' } },
            { scenarioKey: 'float', role: 'CANDIDATE', label: '浮球', cost: { currentTotalCost: 118, currency: 'CNY', costBasis: 'CURRENT_REBUILT_SCENARIO' } },
        ], comparisons: [{ baseScenarioKey: 'base', candidateScenarioKey: 'float', status: 'COMPARABLE', delta: 18, currency: 'CNY' }],
    } };
    const bindings = new Map([['recipe:1', { verified: true, canonicalName: 'V750-通用款' }]]);
    const defaultLedger = createFactLedger();
    defaultLedger.appendToolResult({ toolName: 'compare_recipe_scenarios', args: { recipeId: 1 }, result, entityBindings: bindings });
    assert.equal(defaultLedger.facts().some(item => item.predicate === 'scenario_cost'), false);
    const candidateLedger = createFactLedger({ includeScenarioComparisonFacts: true });
    candidateLedger.appendToolResult({ toolName: 'compare_recipe_scenarios', args: { recipeId: 1 }, result, entityBindings: bindings });
    const facts = candidateLedger.facts();
    assert.deepEqual(facts.filter(item => item.predicate === 'scenario_cost').map(item => [item.value, item.entity.canonicalName, item.basis, item.qualifiers.scenarioKey]), [
        [100, 'V750-通用款', 'CURRENT_REBUILT_BASE', 'base'], [118, 'V750-通用款', 'CURRENT_REBUILT_SCENARIO', 'float'],
    ]);
    assert.deepEqual(facts.filter(item => item.predicate === 'scenario_cost_difference').map(item => [item.value, item.basis, item.qualifiers.candidateScenarioKey]), [[18, 'SCENARIO_COMPARISON', 'float']]);
});

test('R6: finalization instructions keep current, scenario and difference money assertions atomic', () => {
    const source = require('node:fs').readFileSync(require.resolve('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs'), 'utf8');
    assert.match(source, /Each monetary factual sentence\/claim may assert only one money role/);
    const facts = renderClaimableFactsForModel({ facts: [
        { factId: 'F-1', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 224, unit: 'CNY', basis: 'CURRENT_REBUILT_BASE', qualifiers: { moneyRole: 'CURRENT_BASE', scenarioKey: 'base', role: 'BASE', label: '当前' }, source: { tool: 'compare_recipe_scenarios' } },
        { factId: 'F-2', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 230, unit: 'CNY', basis: 'CURRENT_REBUILT_SCENARIO', qualifiers: { moneyRole: 'SCENARIO_CANDIDATE', scenarioKey: 'stainless', role: 'CANDIDATE', label: '候选' }, source: { tool: 'compare_recipe_scenarios' } },
        { factId: 'F-3', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'V750-通用款' }, predicate: 'scenario_cost_difference', value: 6, unit: 'CNY', basis: 'SCENARIO_COMPARISON', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE', baseScenarioKey: 'base', candidateScenarioKey: 'stainless', status: 'COMPARABLE' }, source: { tool: 'compare_recipe_scenarios' } },
    ] });
    assert.deepEqual(facts.map(item => item.claimType), ['CURRENT_COST', 'SCENARIO_COST', 'SCENARIO_DELTA']);
    const envelope = JSON.stringify({ answer: 'V750-通用款当前正式配置成本为224元。V750-通用款候选试算成本为230元。V750-通用款成本增加6元。', claims: [
        { text: 'V750-通用款当前正式配置成本为224元。', factIds: ['F-1'] },
        { text: 'V750-通用款候选试算成本为230元。', factIds: ['F-2'] },
        { text: 'V750-通用款成本增加6元。', factIds: ['F-3'] },
    ], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-1', 'F-2', 'F-3'] }] });
    const validation = validateAnswer(envelope, { ledger: { facts: [
        { factId: 'F-1', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 224, unit: 'CNY', qualifiers: { moneyRole: 'CURRENT_BASE' } },
        { factId: 'F-2', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'V750-通用款' }, predicate: 'scenario_cost', value: 230, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_CANDIDATE' } },
        { factId: 'F-3', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'V750-通用款' }, predicate: 'scenario_cost_difference', value: 6, unit: 'CNY', qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE' } },
    ] }, judge: { questions: ['owner'] } });
    assert.equal(validation.valid, true);
    assert.match(source, /Every claim must have one or more verified Fact IDs/);
    assert.match(source, /delete unsupported narrative sentences instead of keeping them with empty factIds/);
});

test('candidate implementation remains isolated from current production runtime and broker selection', () => {
    const source = require('node:fs').readFileSync(require.resolve('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs'), 'utf8');
    for (const forbidden of ['selectCapabilities', 'DOMAIN_TOOL_NAMES', 'runJudge', 'runtime.cjs']) assert.equal(source.includes(forbidden), false, forbidden);
    assert.equal(AI_TOOLS.some(item => item.function.name === 'load_tools'), false);
    assert.equal(AI_FORMAL_TOOLS.some(item => item.function.name === 'load_tools'), false);
    assert.equal(typeof validateAnswer, 'function');
});
