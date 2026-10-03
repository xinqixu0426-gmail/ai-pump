'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const { AI_FORMAL_TOOLS } = require('../api/services/aiFormalToolDefinitions.cjs');
const { executeAgentTool } = require('../api/services/ai-assistant/agentTools.cjs');
const { createToolSchemaSession } = require('../api/services/ai-assistant/toolSchemaLoader.cjs');
const { validateAnswer } = require('../api/services/ai-assistant/answerValidator.cjs');
const { callKey, runApiNativeAgentCandidate } = require('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs');

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
function baseInput() { return { rawOwnerInput: '请查正式数据', businessMemo: '# Business\n正式业务语义。', policyMemo: '# Policy\n只读。' }; }

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

test('candidate implementation remains isolated from current production runtime and broker selection', () => {
    const source = require('node:fs').readFileSync(require.resolve('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs'), 'utf8');
    for (const forbidden of ['selectCapabilities', 'DOMAIN_TOOL_NAMES', 'runJudge', 'runtime.cjs']) assert.equal(source.includes(forbidden), false, forbidden);
    assert.equal(AI_TOOLS.some(item => item.function.name === 'load_tools'), false);
    assert.equal(AI_FORMAL_TOOLS.some(item => item.function.name === 'load_tools'), false);
    assert.equal(typeof validateAnswer, 'function');
});
