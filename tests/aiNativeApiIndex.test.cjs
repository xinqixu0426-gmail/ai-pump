'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const { AI_FORMAL_TOOLS } = require('../api/services/aiFormalToolDefinitions.cjs');
const { getBusinessCapability } = require('../api/capabilities/registry.cjs');
const a2Eligibility = require('../planning/ai-native-api/M5-A2-Index-Eligibility.json');
const {
    API_INDEX_V1_REVIEWED_COMPOSITES,
    BACKING_TYPES,
    apiIndexFingerprint,
    buildApiIndex,
    getApiIndexEntry,
    renderApiIndexForModel,
} = require('../api/services/ai-assistant/apiIndex.cjs');

const START_HEAD = '5e0503ebb97468e1246ab2dc275e6b5e54cb5870';
const PRIVATE_TOOL_NAMES = [
    'get_recipe_technical_profile',
    'compare_recipe_scenarios',
    'preview_profitability',
    'preview_virtual_readiness',
];
const CORE_DISCOVERY_NAMES = [
    'get_all_recipes',
    'search_coils',
    'search_parts',
    'search_templates',
    'get_recipe_detail',
    'get_recipe_technical_profile',
    'get_recipe_technical_files',
    'calculate_coil_cost',
    'get_copper_price',
    'get_coil_specs',
    'compare_recipes',
    'compare_recipe_scenarios',
    'check_order_readiness',
    'get_order_knowledge_package',
];

function definitionByName(name) {
    return [...AI_TOOLS, ...AI_FORMAL_TOOLS].find(definition => definition.function.name === name);
}

test('IDX-01..10: complete inventory is classified and Model Index V1 applies the reviewed exposure policy', () => {
    const index = buildApiIndex();
    const modelNames = new Set(index.modelIndexV1.map(entry => entry.toolName));
    assert.equal(index.fullInventory.length, 84);
    assert.equal(index.fullInventory.filter(entry => !BACKING_TYPES.includes(entry.backingType)).length, 0);
    assert.equal(index.modelIndexV1.filter(entry => entry.access === 'write').length, 0);
    assert.equal(index.modelIndexV1.filter(entry => !['query', 'preview'].includes(entry.operation)).length, 0);
    for (const entry of index.modelIndexV1.filter(entry => entry.backingType === 'FORMAL_LINKED')) {
        assert.ok(entry.formalCapabilityIds.length > 0, entry.toolName);
        entry.formalCapabilityIds.forEach(id => assert.ok(getBusinessCapability(id), `${entry.toolName}:${id}`));
    }
    assert.deepEqual(index.modelIndexV1.filter(entry => entry.backingType === 'REVIEWED_COMPOSITE').map(entry => entry.toolName).sort(), [...API_INDEX_V1_REVIEWED_COMPOSITES].sort());
    assert.equal(index.modelIndexV1.filter(entry => entry.backingType === 'REVIEWED_COMPOSITE').length, 4);
    for (const action of a2Eligibility.actions.filter(action => action.indexEligibility === 'EXPOSE_V1')) {
        assert.ok(modelNames.has(action.toolName), `A2 EXPOSE_V1 missing: ${action.toolName}`);
    }
    for (const action of a2Eligibility.actions.filter(action => action.indexEligibility !== 'EXPOSE_V1')) {
        assert.equal(modelNames.has(action.toolName), false, `A2 ${action.indexEligibility} leaked: ${action.toolName}`);
    }
    for (const name of PRIVATE_TOOL_NAMES) assert.ok(modelNames.has(name), `private assistant tool must be considered: ${name}`);
});

test('IDX-11..15: summaries and top-level hints derive from formal tool definitions without implementation leakage', () => {
    const index = buildApiIndex();
    const rendered = renderApiIndexForModel(index);
    for (const entry of index.modelIndexV1) {
        const definition = definitionByName(entry.toolName);
        assert.ok(definition, entry.toolName);
        assert.ok(definition.function.description.includes(entry.summary), entry.toolName);
        assert.deepEqual(entry.requiredInputs, [...(definition.function.parameters.required || [])].sort(), entry.toolName);
        assert.equal(entry.summary.includes('/api/'), false, entry.toolName);
    }
    assert.equal(/\/api\//u.test(rendered), false);
    assert.equal(/sourceOfTruth|executorKey|SELECT\s|FROM\s|additionalProperties|"properties"/iu.test(rendered), false);
    assert.equal(rendered.includes('packingParts'), false, 'nested schema details must not be rendered');
});

test('IDX-16..20: ordering, fingerprint, definitions and discovery remain deterministic', () => {
    const first = buildApiIndex();
    const second = buildApiIndex();
    assert.deepEqual(first.modelIndexV1.map(entry => entry.toolName), second.modelIndexV1.map(entry => entry.toolName));
    assert.equal(apiIndexFingerprint(first), apiIndexFingerprint(second));
    assert.equal(new Set(first.modelIndexV1.map(entry => entry.toolName)).size, first.modelIndexV1.length);
    for (const name of CORE_DISCOVERY_NAMES) assert.ok(getApiIndexEntry(name, first), `missing core discovery tool: ${name}`);
    for (const entry of first.modelIndexV1) assert.ok(definitionByName(entry.toolName), `Phase C definition missing: ${entry.toolName}`);

    const alteredDefinitions = AI_TOOLS.map(definition => JSON.parse(JSON.stringify(definition)));
    alteredDefinitions.find(definition => definition.function.name === 'get_copper_price').function.description += ' 目录描述变更。';
    const changed = buildApiIndex({ genericToolDefinitions: alteredDefinitions });
    assert.notEqual(first.fingerprint, changed.fingerprint);
});

test('API Index remains isolated from runtime, Main Agent, and Capability Broker', () => {
    const runtimePaths = [
        'api/services/ai-assistant/runtime.cjs',
        'api/services/ai-assistant/mainAgent.cjs',
        'api/services/ai-assistant/capabilityBroker.cjs',
    ];
    for (const relativePath of runtimePaths) {
        const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
        assert.equal(source.includes("require('./apiIndex.cjs')"), false, relativePath);
    }
    const changed = childProcess.execFileSync('git', ['diff', '--name-only', START_HEAD, '--', ...runtimePaths], {
        cwd: path.join(__dirname, '..'), encoding: 'utf8',
    }).trim();
    assert.equal(changed, '', `Phase B must not integrate runtime: ${changed}`);
});
