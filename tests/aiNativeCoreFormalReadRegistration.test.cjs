'use strict';

const childProcess = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getAiCapability,
    getBusinessCapability,
    listBusinessCapabilities,
} = require('../api/capabilities/registry.cjs');
const {
    CORE_ACTION_LINKS,
    CORE_CAPABILITIES,
    buildAudit,
} = require('../scripts/ai-experiments/api-index/audit-core-formal-read-closure.cjs');

const START_HEAD = '39e3c4ec8db2433da1bd416d4163325d5df682d8';
const ROUTE_EVIDENCE = Object.freeze({
    'orders.readiness.read': ['api/routes/orders.cjs', "router.get('/:id/readiness'"],
    'orders.knowledge_package.read': ['api/routes/orders.cjs', "router.get('/:id/knowledge-package'"],
    'recipes.technical_files.list': ['api/routes/recipes.cjs', "router.get('/:id/technical-files'"],
    'coils.cost_preview': ['api/routes/coils.cjs', "router.post('/calculate'"],
    'market.copper_price.read': ['api/routes/cost.cjs', "router.get('/copper-price'"],
    'coils.spec_options.read': ['api/routes/coils.cjs', "router.get('/specs'"],
});

test('A3 FR-01..FR-10: six core formal read/preview capabilities are registered safely', () => {
    assert.equal(listBusinessCapabilities().length, 153);
    assert.equal(CORE_CAPABILITIES.length, 6);
    for (const expected of CORE_CAPABILITIES) {
        const capability = getBusinessCapability(expected.capabilityId);
        assert.ok(capability, expected.capabilityId);
        assert.equal(capability.access, expected.access, expected.capabilityId);
        assert.equal(capability.operation, expected.operation, expected.capabilityId);
        assert.equal(capability.requiresConfirmation, false, expected.capabilityId);
        assert.equal(capability.riskLevel, 'low', expected.capabilityId);
        assert.match(capability.inputSchema, new RegExp(`^${expected.method} ${expected.path.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}`));
        assert.ok(capability.outputSchema, expected.capabilityId);
        assert.ok(capability.sourceOfTruth, expected.capabilityId);
        assert.ok(capability.callers.includes('ai'), expected.capabilityId);
        const [routeFile, routeDeclaration] = ROUTE_EVIDENCE[expected.capabilityId];
        const routeSource = require('node:fs').readFileSync(`${__dirname}/../${routeFile}`, 'utf8');
        assert.ok(routeSource.includes(routeDeclaration), `${expected.capabilityId} route declaration`);
    }
    for (const capabilityId of CORE_CAPABILITIES.filter(item => item.access === 'query').map(item => item.capabilityId)) {
        assert.equal(getBusinessCapability(capabilityId).access, 'query', capabilityId);
    }
    assert.equal(getBusinessCapability('coils.cost_preview').access, 'preview');
    assert.deepEqual(CORE_CAPABILITIES.filter(item => item.access === 'write'), []);
});

test('A3 FR-11..FR-18: core AI actions declare only verified formal links', () => {
    for (const [toolName, expectedIds] of Object.entries(CORE_ACTION_LINKS)) {
        const action = getAiCapability(toolName);
        assert.ok(action, toolName);
        assert.deepEqual(action.formalCapabilityIds, expectedIds, toolName);
        for (const capabilityId of expectedIds) assert.ok(getBusinessCapability(capabilityId), `${toolName}:${capabilityId}`);
    }
    for (const name of [
        'search_factory_knowledge',
        'get_factory_knowledge_detail',
        'get_order_detail',
        'get_recipe_detail',
    ]) {
        assert.deepEqual(getAiCapability(name).formalCapabilityIds, [], `${name} must remain composite/unlinked in A3`);
    }
});

test('A3 registry audit aligns formal route contracts and preserves the existing execution boundary', () => {
    const audit = buildAudit();
    assert.equal(audit.aiActionCount, 84);
    assert.equal(audit.formalCapabilityCount, 153);
    assert.equal(audit.explicitFormalLinkedActions, 56);
    assert.equal(audit.remainingUnlinkedActions, 28);
    assert.deepEqual(audit.brokenDeclaredFormalLinks, []);
    assert.deepEqual(audit.a3AddedWriteCapabilities, []);

    const protectedRuntimePaths = [
        'api/routes/ai/tools.cjs',
        'api/services/aiFormalToolDefinitions.cjs',
        'api/routes/ai/executor.cjs',
        'api/routes/ai/executors',
        'api/services/ai-assistant/capabilityBroker.cjs',
        'api/services/ai-assistant/mainAgent.cjs',
        'api/routes/orders.cjs',
        'api/routes/recipes.cjs',
        'api/routes/coils.cjs',
        'api/routes/cost.cjs',
        'api/services/coilCost.cjs',
    ];
    const changedPaths = childProcess.execFileSync('git', ['diff', '--name-only', START_HEAD, '--', ...protectedRuntimePaths], {
        cwd: __dirname + '/..', encoding: 'utf8',
    }).trim().split('\n').filter(Boolean);
    // A3 itself was metadata-only. D1-R1 later fixed a shared read adapter,
    // and D1-R5A later extended the already-exposed formal scenario schema
    // with one reviewed Rotor Process configuration dimension:
    // an identity-bound canonical coil ID must hydrate its required dimensions
    // from the formal catalogue before it reaches the unchanged calculate route.
    // Keep the baseline assertion strict for every other protected surface.
    const allowedLaterChanges = new Set([
        'api/routes/ai/executors/costExecutors.cjs',
        'api/services/aiFormalToolDefinitions.cjs',
    ]);
    assert.deepEqual(
        changedPaths.filter(item => !allowedLaterChanges.has(item)),
        [],
        `A3 must remain metadata-only outside explicitly reviewed later safe extensions: ${changedPaths.join(', ')}`,
    );
    if (changedPaths.includes('api/routes/ai/executors/costExecutors.cjs')) {
        const source = require('node:fs').readFileSync(`${__dirname}/../api/routes/ai/executors/costExecutors.cjs`, 'utf8');
        assert.match(source, /hydrate missing dimensions from the same formal coil catalogue/);
        assert.match(source, /getJson\(internalFetch, '\/api\/coils'/);
    }
    if (changedPaths.includes('api/services/aiFormalToolDefinitions.cjs')) {
        const source = require('node:fs').readFileSync(`${__dirname}/../api/services/aiFormalToolDefinitions.cjs`, 'utf8');
        assert.match(source, /rotorProcessMode/);
        assert.match(source, /stainless_shaft_joint/);
    }
});
