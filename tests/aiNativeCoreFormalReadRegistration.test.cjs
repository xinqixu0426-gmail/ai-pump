'use strict';

const childProcess = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    getAiCapability,
    getBusinessCapability,
    listBusinessCapabilities,
} = require('../api/capabilities/registry.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const {
    CORE_ACTION_LINKS,
    CORE_CAPABILITIES,
    buildAudit,
} = require('../scripts/ai-experiments/api-index/audit-core-formal-read-closure.cjs');

const START_HEAD = '39e3c4ec8db2433da1bd416d4163325d5df682d8';
const R3_METADATA_BASELINE = '5fa2cc918463b42b5ba8df415b68ba65acb669ae';
const R3_REVIEWED_METADATA_COMMIT = '85877dfd748f87c1aee324eb25de0e581a211b1e';
const ROUTE_EVIDENCE = Object.freeze({
    'orders.readiness.read': ['api/routes/orders.cjs', "router.get('/:id/readiness'"],
    'orders.knowledge_package.read': ['api/routes/orders.cjs', "router.get('/:id/knowledge-package'"],
    'recipes.technical_files.list': ['api/routes/recipes.cjs', "router.get('/:id/technical-files'"],
    'coils.cost_preview': ['api/routes/coils.cjs', "router.post('/calculate'"],
    'market.copper_price.read': ['api/routes/cost.cjs', "router.get('/copper-price'"],
    'coils.spec_options.read': ['api/routes/coils.cjs', "router.get('/specs'"],
});

function assertReviewedPurchaseOverviewMetadataDelta() {
    const cwd = __dirname + '/..';
    const reviewed = childProcess.execFileSync('git', ['diff', '--unified=0', R3_METADATA_BASELINE, R3_REVIEWED_METADATA_COMMIT, '--', 'api/routes/ai/tools.cjs'], { cwd, encoding: 'utf8' });
    const changedLines = reviewed.split('\n').filter(line => (/^[+-]/u.test(line)) && !/^(?:---|\+\+\+)/u.test(line));
    assert.deepEqual(changedLines, [
        '-            description: \'读取当前全部活动订单的采购任务总览，返回供应商、物料、计划/已下单/已到货/已入库/待采购数量及关联订单。仅当用户询问采购任务、供应商、采购物料、待采购数量或采购进度时使用；“采购中的订单/单子/单据有几个”属于订单状态查询，禁止使用本工具。只读，不修改采购、订单或库存。\',',
        '+            description: \'读取当前全部活动订单的采购任务总览，返回供应商、物料、计划/已下单/已到货/已入库/待采购数量及关联订单。仅当用户询问采购任务、供应商、采购物料、待采购数量、待处理/未完成采购任务或采购进度时使用；“采购中的订单/单子/单据有几个”属于订单状态查询，禁止使用本工具。只读，不修改采购、订单或库存。\',',
        "-                    pendingOnly: { type: 'boolean', description: '仅返回待采购数量大于0的任务（可选）' }",
        "+                    pendingOnly: { type: 'boolean', description: '仅返回待采购数量大于0的待处理/未完成采购任务（可选）' }",
    ]);
    const unreviewed = childProcess.execFileSync('git', ['diff', '--name-only', R3_REVIEWED_METADATA_COMMIT, '--', 'api/routes/ai/tools.cjs'], { cwd, encoding: 'utf8' }).trim();
    assert.equal(unreviewed, '', 'unreviewed tools.cjs drift must fail the A3 boundary');
    const purchase = AI_TOOLS.find(item => item?.function?.name === 'get_purchase_overview');
    assert.ok(purchase); assert.equal(AI_TOOLS.length, 80);
    assert.deepEqual(Object.keys(purchase.function.parameters.properties).sort(), ['limit', 'pendingOnly', 'supplier']);
    assert.equal(purchase.function.parameters.properties.pendingOnly.type, 'boolean');
    assert.match(purchase.function.description, /待处理\/未完成采购任务/);
    assert.match(purchase.function.parameters.properties.pendingOnly.description, /待处理\/未完成采购任务/);
}

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
        'api/routes/ai/executors/orderExecutors.cjs',
        'api/services/aiFormalToolDefinitions.cjs',
    ]);
    assert.deepEqual(
        changedPaths.filter(item => !allowedLaterChanges.has(item) && item !== 'api/routes/ai/tools.cjs'),
        [],
        `A3 must remain metadata-only outside explicitly reviewed later safe extensions: ${changedPaths.join(', ')}`,
    );
    if (changedPaths.includes('api/routes/ai/tools.cjs')) assertReviewedPurchaseOverviewMetadataDelta();
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
    if (changedPaths.includes('api/routes/ai/executors/orderExecutors.cjs')) {
        const source = require('node:fs').readFileSync(`${__dirname}/../api/routes/ai/executors/orderExecutors.cjs`, 'utf8');
        assert.match(source, /collections:\s*\{/);
        assert.match(source, /items: \{ returnedCount: items\.length, totalCount: items\.length, complete: true/);
    }
});
