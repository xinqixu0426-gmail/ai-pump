'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    resolutionProjection,
    resolvePageContextEntity,
} = require('../api/ontology/agentResolver.cjs');
const {
    MAX_DYNAMIC_TOOLS,
    MAX_EXPOSED_TOOLS,
    executeBrokeredCapability,
    selectCapabilities,
} = require('../api/services/ai-assistant/capabilityBroker.cjs');
const { getAiCapability, listAiCapabilities } = require('../api/capabilities/registry.cjs');
const { runMainAgent } = require('../api/services/ai-assistant/mainAgent.cjs');
const { executeAgentTool } = require('../api/services/ai-assistant/agentTools.cjs');

function lookupResult(candidates, complete = true) {
    return { complete, candidates };
}

test('agent Ontology contract is unique, ambiguous, and not-found without a first-result binding', () => {
    const unique = resolutionProjection('recipe', 'V550', lookupResult([{
        entityType: 'recipe', canonicalId: '12', canonicalName: 'V550', matchKind: 'EXACT',
    }]));
    assert.deepEqual(unique, {
        entityType: 'recipe', mention: 'V550', status: 'RESOLVED', canonicalId: '12', canonicalName: 'V550',
        candidates: [], source: 'formal', verified: true, matchKind: 'EXACT',
    });

    const ambiguous = resolutionProjection('coil', '18-90', lookupResult([
        { entityType: 'coil', canonicalId: '7', canonicalName: '18-90 / A', identityAttributes: { schemeCode: 'A' } },
        { entityType: 'coil', canonicalId: '8', canonicalName: '18-90 / B', identityAttributes: { schemeCode: 'B' } },
    ]));
    assert.equal(ambiguous.status, 'AMBIGUOUS');
    assert.equal(ambiguous.canonicalId, null);
    assert.equal(ambiguous.candidates.length, 2);

    const missing = resolutionProjection('part', '不存在零件', lookupResult([]));
    assert.equal(missing.status, 'NOT_FOUND');
    assert.equal(missing.verified, false);
});

test('page context remains a candidate until a formal Executor read verifies its identity', async () => {
    const calls = [];
    const result = await resolvePageContextEntity({
        entityType: 'recipe',
        pageContext: { resourceType: 'recipe', resourceId: 12, path: '/recipes/12' },
    }, {
        executeToolCall: async (name, args, options) => {
            calls.push({ name, args, options });
            return { success: true, recipe: { name: 'V550' } };
        },
    });
    assert.equal(result.status, 'RESOLVED');
    assert.equal(result.canonicalId, '12');
    assert.equal(result.source, 'page_context_candidate');
    assert.deepEqual(calls, [{ name: 'get_recipe_detail', args: { recipeId: 12 }, options: { allowWrite: false, signal: undefined } }]);

    const mismatched = await resolvePageContextEntity({
        entityType: 'recipe', pageContext: { resourceType: 'order', resourceId: 12 },
    }, { executeToolCall: async () => { throw new Error('must not run'); } });
    assert.equal(mismatched.status, 'NOT_FOUND');
});

test('Capability Broker selects bounded registered read/preview tools across related domains', () => {
    const broker = selectCapabilities({ judge: { domains: ['recipe', 'order', 'procurement', 'knowledge'] } });
    assert.ok(broker.selectedCapabilityCount > 0);
    assert.ok(broker.selectedCapabilityCount <= MAX_DYNAMIC_TOOLS);
    assert.ok(broker.exposedToolCount <= MAX_EXPOSED_TOOLS);
    assert.equal(broker.tools[0].function.name, 'resolve_entity');
    assert.equal(broker.tools[1].function.name, 'resolve_page_context_entity');
    for (const capability of broker.capabilities) {
        const registered = getAiCapability(capability.toolName);
        assert.ok(registered);
        assert.notEqual(registered.access, 'write');
        assert.ok(['query', 'preview'].includes(registered.operation));
    }
    assert.equal(broker.availableCapabilityCount, listAiCapabilities().filter(item => item.access !== 'write' && ['query', 'preview'].includes(item.operation)).length);
});

test('Capability Broker round-robins multi-goal domains before filling one rich profile', () => {
    const broker = selectCapabilities({ judge: { domains: ['recipe', 'coil', 'order', 'procurement'] } });
    const names = broker.capabilities.map(item => item.toolName);
    assert.ok(names.includes('get_recipe_detail'));
    assert.ok(names.includes('search_coils'));
    assert.ok(names.includes('get_recent_orders'));
    assert.ok(names.includes('get_purchase_overview'));
});

test('Capability Broker covers formal owner-query domains without exposing writes', () => {
    const domains = ['recipe', 'coil', 'part', 'technical_profile', 'order', 'quotation', 'customer', 'procurement', 'business_history', 'knowledge', 'file', 'template'];
    for (const domain of domains) {
        const broker = selectCapabilities({ judge: { domains: [domain] } });
        assert.ok(broker.capabilities.length > 0, domain);
        assert.ok(broker.capabilities.every(item => getAiCapability(item.toolName).access !== 'write'), domain);
    }
});

test('unselected, invented, ambiguous, and write capability calls fail closed before formal execution', async () => {
    let executions = 0;
    const context = {
        selectedToolNames: new Set(['get_recipe_detail']),
        entityBindings: new Map(),
    };
    await assert.rejects(
        executeBrokeredCapability('get_order_detail', { orderId: 7 }, context, { executeToolCall: async () => { executions += 1; } }),
        error => error.code === 'AGENT_CAPABILITY_NOT_SELECTED',
    );
    await assert.rejects(
        executeBrokeredCapability('get_recipe_detail', { recipeId: 999 }, context, { executeToolCall: async () => { executions += 1; } }),
        error => error.code === 'AGENT_TOOL_IDENTITY_UNVERIFIED',
    );
    assert.equal(executions, 0);
    assert.equal(selectCapabilities({ judge: { domains: ['inventory', 'order'] } }).capabilities.some(item => getAiCapability(item.toolName).access === 'write'), false);
});

test('an ambiguous Ontology result never binds a protected write proposal identity', async () => {
    const context = { entityBindings: new Map(), resolvedRecipeIds: new Set(), resolvedRecipeBindings: new Map(), resolvedCoilBindings: new Map(), resolvedPartBindings: new Map() };
    const resolution = await executeAgentTool('resolve_entity', { entityType: 'part', mention: '共同型号' }, context, {
        resolveAgentEntity: async () => ({ entityType: 'part', status: 'AMBIGUOUS', canonicalId: null, canonicalName: null, candidates: [{ canonicalId: '1' }, { canonicalId: '2' }], verified: false }),
    });
    assert.equal(resolution.success, false);
    await assert.rejects(
        executeAgentTool('prepare_part_stock_adjustment', { partId: 1, delta: 1 }, context, { executeToolCall: async () => { throw new Error('must not execute'); } }),
        error => error.code === 'AGENT_TOOL_IDENTITY_UNVERIFIED',
    );
});

test('Main Agent receives broker tools rather than the retired fixed agent surface, while conversation remains bounded context', async () => {
    let suppliedTools = [];
    const answer = await runMainAgent({
        userMessage: '刚才那个配方的零件有哪些？',
        recentConversation: [{ role: 'user', content: 'V550 现在成本多少？' }, { role: 'assistant', content: '已查询。' }],
        judge: { mode: 'GENERAL', domains: ['recipe'], persistentMutation: false },
        domainPolicy: '回答先给结论。', policyVersion: '3',
    }, {
        modelCall: async (_messages, options) => {
            suppliedTools = options.tools.map(item => item.function.name);
            return { choices: [{ message: { content: '请先确认具体配方。' } }] };
        },
    });
    assert.ok(suppliedTools.includes('resolve_entity'));
    assert.ok(suppliedTools.includes('get_recipe_parts'));
    assert.equal(suppliedTools.includes('prepare_part_stock_adjustment'), false);
    assert.match(answer.answer, /确认/);
});
