'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const { AI_FORMAL_TOOLS } = require('../api/services/aiFormalToolDefinitions.cjs');
const { getAiCapability, getBusinessCapability, listAiCapabilities } = require('../api/capabilities/registry.cjs');
const { buildApiIndex } = require('../api/services/ai-assistant/apiIndex.cjs');
const {
    LOAD_TOOLS_TOOL,
    MAX_LOAD_BATCH,
    MAX_LOADED_SCHEMA_CHARS,
    MAX_LOADED_TOOLS_PER_REQUEST,
    createToolSchemaSession,
    loadToolSchemas,
} = require('../api/services/ai-assistant/toolSchemaLoader.cjs');

const PRIVATE_TOOL_NAMES = [
    'get_recipe_technical_profile',
    'compare_recipe_scenarios',
    'preview_profitability',
    'preview_virtual_readiness',
];
const CORE_TOOL_NAMES = [
    'search_coils',
    'calculate_coil_cost',
    'get_all_recipes',
    'get_recipe_detail',
    'compare_recipes',
    'compare_recipe_scenarios',
    'get_recipe_technical_profile',
    'get_recipe_technical_files',
    'get_copper_price',
    'check_order_readiness',
    'get_order_knowledge_package',
    'search_factory_knowledge',
];

function canonicalDefinition(name) {
    return [...AI_TOOLS, ...AI_FORMAL_TOOLS].find(definition => definition.function.name === name);
}

test('LOAD-01..06: loader admits only discoverable Model Index tools and validates batches atomically', () => {
    const session = createToolSchemaSession();
    const before = session.snapshot();
    assert.equal(loadToolSchemas(['update_recipe'], { session }).code, 'TOOL_SCHEMA_NOT_DISCOVERABLE');
    assert.equal(loadToolSchemas(['preview_recipe_cost'], { session }).code, 'TOOL_SCHEMA_NOT_DISCOVERABLE');
    assert.equal(loadToolSchemas(['made_up_tool'], { session }).code, 'TOOL_SCHEMA_NOT_DISCOVERABLE');
    assert.equal(loadToolSchemas(['search_coils', 'made_up_tool'], { session }).code, 'TOOL_SCHEMA_NOT_DISCOVERABLE');
    assert.deepEqual(session.snapshot(), before, 'invalid batch must not partially load');

    const discoverable = buildApiIndex().modelIndexV1.map(entry => entry.toolName);
    assert.equal(loadToolSchemas(discoverable.slice(0, MAX_LOAD_BATCH), { session }).success, true);
    assert.equal(loadToolSchemas([...discoverable, 'search_coils', 'search_coils'], { session }).code, 'LOAD_BATCH_LIMIT_EXCEEDED');

    const cumulative = createToolSchemaSession();
    assert.equal(cumulative.load(discoverable.slice(0, 16)).success, true);
    assert.equal(cumulative.load(discoverable.slice(16)).success, true);
    assert.equal(cumulative.snapshot().loadedToolCount, discoverable.length);
    assert.ok(cumulative.snapshot().loadedToolCount <= MAX_LOADED_TOOLS_PER_REQUEST);
    assert.ok(cumulative.snapshot().loadedSchemaChars <= MAX_LOADED_SCHEMA_CHARS);
});

test('LOAD-07..09: reloads are idempotent and canonical loading order is stable', () => {
    const first = createToolSchemaSession();
    const second = createToolSchemaSession();
    const forward = ['search_coils', 'calculate_coil_cost'];
    const reverse = [...forward].reverse();
    const firstResult = first.load(reverse);
    const secondResult = second.load(forward);
    assert.equal(firstResult.success, true);
    assert.equal(secondResult.success, true);
    assert.deepEqual(first.loadedToolNames(), ['search_coils', 'calculate_coil_cost']);
    assert.deepEqual(first.loadedToolNames(), second.loadedToolNames());
    assert.equal(first.snapshot().schemaFingerprint, second.snapshot().schemaFingerprint);
    const reload = first.load(['search_coils']);
    assert.equal(reload.success, true);
    assert.deepEqual(reload.newlyLoadedToolNames, []);
    assert.deepEqual(reload.alreadyLoadedToolNames, ['search_coils']);
    assert.equal(reload.loadedToolCount, 2);
    assert.deepEqual(createToolSchemaSession().loadedToolNames(), [], 'loading state must not outlive its request session');
});

test('LOAD-10..12: schema and index drift both change the relevant fingerprint and fail closed', () => {
    const baseline = buildApiIndex();
    const alteredCapabilities = listAiCapabilities().map(capability => (
        capability.toolName === 'get_copper_price'
            ? { ...capability, formalCapabilityIds: [] }
            : capability
    ));
    const exposureChanged = buildApiIndex({ capabilities: alteredCapabilities });
    assert.notEqual(exposureChanged.fingerprint, baseline.fingerprint);

    const alteredDefinitions = AI_TOOLS.map(definition => JSON.parse(JSON.stringify(definition)));
    alteredDefinitions.find(definition => definition.function.name === 'get_copper_price').function.description += ' Schema loader drift test.';
    const alteredIndexFactory = () => buildApiIndex({ genericToolDefinitions: alteredDefinitions });
    const alteredSession = createToolSchemaSession({
        genericToolDefinitions: alteredDefinitions,
        indexFactory: alteredIndexFactory,
    });
    assert.equal(alteredSession.load(['get_copper_price']).success, true);
    const normalSession = createToolSchemaSession();
    assert.equal(normalSession.load(['get_copper_price']).success, true);
    assert.notEqual(alteredSession.snapshot().schemaFingerprint, normalSession.snapshot().schemaFingerprint);

    const oversizedDefinitions = AI_TOOLS.map(definition => JSON.parse(JSON.stringify(definition)));
    oversizedDefinitions.find(definition => definition.function.name === 'get_copper_price').function.description = 'x'.repeat(MAX_LOADED_SCHEMA_CHARS + 1);
    const oversizedIndexFactory = () => buildApiIndex({ genericToolDefinitions: oversizedDefinitions });
    const oversizedSession = createToolSchemaSession({
        genericToolDefinitions: oversizedDefinitions,
        indexFactory: oversizedIndexFactory,
    });
    assert.equal(oversizedSession.load(['get_copper_price']).code, 'LOADED_SCHEMA_CONTEXT_LIMIT_EXCEEDED');
    assert.equal(oversizedSession.snapshot().loadedToolCount, 0);

    let currentIndex = baseline;
    const driftingSession = createToolSchemaSession({ indexFactory: () => currentIndex });
    currentIndex = exposureChanged;
    assert.equal(driftingSession.load(['search_coils']).code, 'INDEX_FINGERPRINT_CHANGED');
    assert.equal(driftingSession.snapshot().loadedToolCount, 0);
});

test('PRIVATE-01..04 and core load contracts preserve canonical tool definitions', () => {
    for (const toolName of [...PRIVATE_TOOL_NAMES, ...CORE_TOOL_NAMES]) {
        const session = createToolSchemaSession();
        const result = session.load([toolName]);
        assert.equal(result.success, true, toolName);
        assert.equal(session.loadedDefinitions()[0], canonicalDefinition(toolName), `${toolName} must be the canonical definition object`);
    }
    const privateSession = createToolSchemaSession();
    assert.equal(privateSession.load(PRIVATE_TOOL_NAMES).success, true);
    for (const toolName of PRIVATE_TOOL_NAMES) {
        assert.equal(privateSession.loadedDefinitions().find(definition => definition.function.name === toolName), canonicalDefinition(toolName));
    }
});

test('LOAD-13..20: load_tools remains a non-fact control-plane tool with no registry or executor presence', () => {
    const index = buildApiIndex();
    assert.equal(index.modelIndexV1.some(entry => entry.toolName === 'load_tools'), false);
    assert.equal(getAiCapability('load_tools'), null);
    assert.equal(getBusinessCapability('load_tools'), null);
    assert.equal(LOAD_TOOLS_TOOL.function.parameters.properties.toolNames.maxItems, MAX_LOAD_BATCH);
    assert.deepEqual(LOAD_TOOLS_TOOL.function.parameters.required, ['toolNames']);

    const session = createToolSchemaSession();
    assert.deepEqual(session.exposedTools().map(definition => definition.function.name), ['load_tools']);
    const result = session.load(['search_coils']);
    assert.equal(result.controlPlane, true);
    assert.equal(JSON.stringify(result).includes('parameters'), false, 'load result must not repeat a full schema');
    assert.equal(/confirmationToken|idempotencyKey|secret/iu.test(JSON.stringify(result)), false);
    assert.deepEqual(session.exposedTools().map(definition => definition.function.name), ['load_tools', 'search_coils']);

    const executorSources = fs.readdirSync(path.join(__dirname, '../api/routes/ai/executors'))
        .filter(file => file.endsWith('.cjs'))
        .map(file => fs.readFileSync(path.join(__dirname, '../api/routes/ai/executors', file), 'utf8'))
        .join('\n');
    assert.equal(executorSources.includes("case 'load_tools'"), false);
    const loaderSource = fs.readFileSync(path.join(__dirname, '../api/services/ai-assistant/toolSchemaLoader.cjs'), 'utf8');
    assert.equal(/internalApiClient|executeToolCall|fetch\(|capabilityBroker|DOMAIN_TOOL_NAMES|factLedger/iu.test(loaderSource), false);
});
