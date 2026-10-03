'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const { AI_FORMAL_TOOLS } = require('../api/services/aiFormalToolDefinitions.cjs');
const { listAiCapabilities, getAiCapability, getBusinessCapability } = require('../api/capabilities/registry.cjs');
const { validateAiToolArgs, getAiToolInputSchema } = require('../api/services/aiToolInputValidator.cjs');
const { AGENT_TOOLS, executeAgentTool, rawParts } = require('../api/services/ai-assistant/agentTools.cjs');
const { selectCapabilities, executeBrokeredCapability } = require('../api/services/ai-assistant/capabilityBroker.cjs');
const { modelProjection, createFactLedger } = require('../api/services/ai-assistant/factLedger.cjs');
const { canonicalToolCall } = require('../api/services/ai-assistant/mainAgent.cjs');
const { validateAnswer } = require('../api/services/ai-assistant/answerValidator.cjs');

const formalComparison = { recipeId: 7, version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [
    { scenarioKey: 'candidate', label: '候选', overrides: { cableLength: 5 } },
] };
const profitability = { version: 1, basisRef: { kind: 'SCENARIO_COMPARISON', recipeId: 7,
    comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: formalComparison.scenarios },
    scenarioKey: 'candidate' }, unitPrice: 300, quantity: null, currency: 'CNY' };
const readiness = { version: 1, basisRef: { kind: 'RECIPE_SCENARIO', recipeId: 7,
    comparisonInput: { version: 1, baselinePolicy: 'CURRENT_REBUILT', scenarios: [] }, scenarioKey: 'base' }, quantity: 3 };

test('A/I: every exposed broker tool has a schema, registered read capability, formal link and executor family', () => {
    const registry = listAiCapabilities();
    const definitions = [...AI_TOOLS, ...AI_FORMAL_TOOLS];
    assert.equal(AI_TOOLS.length, 80);
    assert.equal(AI_FORMAL_TOOLS.length, 4);
    assert.equal(registry.length, definitions.length);
    assert.deepEqual(AGENT_TOOLS.map(item => item.function.name).filter(name => AI_FORMAL_TOOLS.some(tool => tool.function.name === name)), []);
    for (const definition of definitions) {
        const name = definition.function.name;
        const capability = getAiCapability(name);
        assert.ok(capability, name);
        assert.ok(getAiToolInputSchema(name), name);
        assert.ok(['cost', 'query', 'order', 'recipe', 'business'].includes(capability.executorKey), name);
        // Composite/read-service tools can have a registered AI source without
        // a single formal capability link. Private formal tools must be linked.
        if (AI_FORMAL_TOOLS.includes(definition)) assert.ok(capability.formalCapabilityIds.length > 0, name);
        for (const id of capability.formalCapabilityIds) assert.ok(getBusinessCapability(id), `${name}:${id}`);
    }
    for (const domain of ['recipe', 'coil', 'part', 'cost', 'inventory', 'order', 'template', 'general']) {
        const selected = selectCapabilities({ judge: { domains: [domain] } });
        for (const exposed of selected.tools.slice(2)) {
            const name = exposed.function.name;
            assert.ok(getAiToolInputSchema(name), name);
            assert.ok(getAiCapability(name), name);
        }
    }
    const executorDirectory = path.join(__dirname, '../api/routes/ai/executors');
    const source = fs.readdirSync(executorDirectory).filter(name => name.endsWith('Executors.cjs'))
        .map(name => fs.readFileSync(path.join(executorDirectory, name), 'utf8')).join('\n');
    const executorActions = [...source.matchAll(/case '([^']+)'\s*:/g)].map(match => match[1]);
    assert.deepEqual(new Set(executorActions), new Set(definitions.map(item => item.function.name)));
});

test('A: formal private schemas survive agent adapter unchanged', async () => {
    const inputs = [['compare_recipe_scenarios', formalComparison], ['preview_profitability', profitability], ['preview_virtual_readiness', readiness]];
    for (const [name, args] of inputs) {
        let received;
        const result = await executeAgentTool(name, args, {
            selectedToolNames: new Set([name]),
            entityBindings: new Map([['recipe:7', { verified: true, canonicalName: 'R7' }]]),
        }, { executeToolCall: async (toolName, toolArgs) => {
            received = { toolName, toolArgs };
            return { success: true, data: { complete: true }, executionEvidence: { verified: true } };
        } });
        assert.equal(result.success, true, name);
        assert.equal(received.toolName, name);
        assert.deepEqual(received.toolArgs, validateAiToolArgs(name, args));
    }
});

test('B: small collections are complete, large ones disclose truncation, identities survive but tokens do not', () => {
    const small = modelProjection({ success: true, data: { complete: true, rows: Array.from({ length: 14 }, (_, id) => ({ recipeId: id + 1 })) } }, []);
    assert.equal(small.data.rows.length, 14);
    assert.equal(small.projection.truncated, false);
    assert.equal(small.data.rows[0].recipeId, 1);
    const large = modelProjection({ success: true, data: { complete: true, rows: Array.from({ length: 110 }, (_, id) => ({ partId: id + 1 })) }, confirmationToken: 'secret', idempotencyKey: 'secret' }, []);
    assert.equal(large.data.complete, false);
    assert.equal(large.projection.collections.find(item => item.path === '$.data.rows').totalCount, 110);
    assert.equal(large.projection.collections.find(item => item.path === '$.data.rows').hasMore, true);
    assert.equal(JSON.stringify(large).includes('secret'), false);
});

test('C: recursive canonical tool key preserves nested objects and arrays', () => {
    const a = canonicalToolCall({ name: 'compare_recipe_scenarios', args: { scenarios: [{ overrides: { cableLength: 5, hasCable: true } }], recipeId: 7 } });
    const b = canonicalToolCall({ name: 'compare_recipe_scenarios', args: { recipeId: 7, scenarios: [{ overrides: { hasCable: true, cableLength: 10 } }] } });
    const equivalent = canonicalToolCall({ name: 'compare_recipe_scenarios', args: { recipeId: 7, scenarios: [{ overrides: { hasCable: true, cableLength: 5 } }] } });
    assert.notEqual(a, b); assert.equal(a, equivalent);
});

test('D: broker preserves safe formal error distinctions and strips unsafe payloads', async () => {
    for (const [code, category] of [['INVALID_AI_TOOL_INPUT', 'INVALID_ARGUMENT'], ['ENTITY_AMBIGUOUS', 'AMBIGUITY'], ['AI_RESOURCE_NOT_FOUND', 'NOT_FOUND'], ['UNSUPPORTED_OVERRIDE', 'UNSUPPORTED_OVERRIDE'], ['UNSUPPORTED_CAPABILITY', 'UNSUPPORTED_CAPABILITY'], ['STALE_PROPOSAL', 'STALE_CONFLICT'], ['SERVICE_UNAVAILABLE', 'TRANSPORT_UNAVAILABLE']]) {
        const result = await executeBrokeredCapability('get_recipe_detail', { recipeId: 7 }, {
            selectedToolNames: new Set(['get_recipe_detail']),
            entityBindings: new Map([['recipe:7', { verified: true }]]),
        }, { executeToolCall: async () => ({ success: false, code, validation: { missingFields: ['recipeId'], allowedValues: ['7'], confirmationToken: 'secret' } }) });
        assert.equal(result.category, category, code);
        assert.equal(result.code, code);
        assert.deepEqual(result.details.missingFields, ['recipeId']);
        assert.equal(JSON.stringify(result).includes('secret'), false);
    }
});

test('E: unknown numeric values never become zero facts', () => {
    for (const value of [null, undefined, '', ' ', NaN]) {
        const ledger = createFactLedger();
        ledger.appendToolResult({ toolName: 'preview_recipe_cost', result: { success: true, verified: true, data: { unitCost: value, currentStock: value } } });
        assert.equal(ledger.facts().some(fact => ['unit_cost', 'current_stock'].includes(fact.predicate)), false);
    }
    assert.equal(rawParts({ data: [{ id: 1, model: 'P', stock: null }] })[0].stock, null);
});

test('F: monetary claims bind to cited entity and current/scenario basis', () => {
    const facts = [
        { factId: 'F-001', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'Recipe A' }, predicate: 'unit_cost', value: 100, unit: 'CNY', basis: 'CURRENT_REBUILT' },
        { factId: 'F-002', verified: true, entity: { type: 'recipe', id: 1, canonicalName: 'Recipe A' }, predicate: 'unit_cost', value: 100, unit: 'CNY', basis: 'CURRENT_REBUILT_SCENARIO' },
    ];
    const check = (answer, ids) => validateAnswer(JSON.stringify({ answer, claims: [{ text: answer, factIds: ids }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ids }] }), { ledger: { facts }, judge: { questions: ['cost'] } });
    assert.equal(check('Recipe B cost = ¥100', ['F-001']).valid, false);
    assert.equal(check('配方B的成本为¥100', ['F-001']).valid, false);
    assert.equal(check('Recipe A scenario cost = ¥100', ['F-001']).valid, false);
    assert.equal(check('Recipe A current cost = ¥100', ['F-001']).valid, true);
    assert.equal(check('Recipe A scenario cost = ¥100', ['F-002']).valid, true);
    const uncovered = validateAnswer(JSON.stringify({
        answer: 'Recipe A current cost = ¥100；Recipe B scenario cost = ¥100。',
        claims: [{ text: 'Recipe A current cost = ¥100', factIds: ['F-001'] }],
        goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: ['F-001'] }],
    }), { ledger: { facts }, judge: { questions: ['cost'] } });
    assert.equal(uncovered.code, 'MONEY_CLAIM_UNCLAIMED');
});

test('F: nested formal basisRef retains the verified recipe identity in ledger facts', () => {
    const ledger = createFactLedger();
    ledger.appendToolResult({ toolName: 'preview_profitability', args: profitability,
        entityBindings: new Map([['recipe:7', { verified: true, canonicalName: 'R7' }]]),
        result: { success: true, verified: true, data: { unitCost: 42, costBasis: 'SCENARIO' } } });
    assert.deepEqual(ledger.facts().find(fact => fact.predicate === 'unit_cost').entity,
        { type: 'recipe', id: 7, canonicalName: 'R7' });
});

test('G/H: formal schema enforces protocol keywords and scenario/packaging boundary', () => {
    assert.throws(() => validateAiToolArgs('compare_recipe_scenarios', { ...formalComparison, scenarios: [{ scenarioKey: '!bad', label: 'x', overrides: {} }] }), /格式无效/);
    assert.throws(() => validateAiToolArgs('compare_recipe_scenarios', { ...formalComparison, scenarios: [{ scenarioKey: 'candidate', label: 'x', overrides: { customBarrelLength: 0 } }] }), /必须大于/);
    assert.throws(() => validateAiToolArgs('compare_recipe_scenarios', { ...formalComparison, version: 2 }), /必须为/);
    assert.throws(() => validateAiToolArgs('compare_recipe_scenarios', { ...formalComparison, scenarios: [{ scenarioKey: 'candidate', label: 'x', overrides: { packingParts: '木箱' } }] }), { code: 'PACKING_FORMAL_BINDING_REQUIRED' });
    assert.deepEqual(validateAiToolArgs('compare_recipe_scenarios', { ...formalComparison, scenarios: [{ scenarioKey: 'candidate', label: 'x', overrides: { packingParts: [{ partId: 2, model: '木箱', supplier: 'S', qty: 1, packingRole: 'container' }] } }] }).scenarios[0].overrides.packingParts[0].partId, 2);
    assert.throws(() => validateAiToolArgs('compare_recipe_scenarios', { ...formalComparison, scenarios: [{ scenarioKey: 'candidate', label: 'x', overrides: { rotorProcess: 'stainless' } }] }), /未声明字段/);
});

test('G: every keyword used by exposed tool schemas is in the implemented validator vocabulary', () => {
    const supported = new Set(['type', 'properties', 'required', 'enum', 'const', 'minimum', 'maximum', 'exclusiveMinimum',
        'minLength', 'maxLength', 'minItems', 'maxItems', 'items', 'oneOf', 'anyOf', 'additionalProperties', 'pattern', 'description']);
    const used = new Set();
    const inspect = schema => {
        if (!schema || typeof schema !== 'object') return;
        for (const [keyword, child] of Object.entries(schema)) {
            used.add(keyword);
            if (keyword === 'properties') Object.values(child).forEach(inspect);
            if (keyword === 'items') inspect(child);
            if (keyword === 'additionalProperties' && typeof child === 'object') inspect(child);
            if (keyword === 'oneOf' || keyword === 'anyOf') child.forEach(inspect);
        }
    };
    for (const tool of [...AI_TOOLS, ...AI_FORMAL_TOOLS]) inspect(tool.function.parameters);
    assert.deepEqual([...used].filter(keyword => !supported.has(keyword)), []);
});
