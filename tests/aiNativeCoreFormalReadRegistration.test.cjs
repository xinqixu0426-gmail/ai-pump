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
const R5_REVIEWED_METADATA_COMMIT = 'f60f521ded4e114a52a3e0479c41d709da8cb70c';
const ROUTE_EVIDENCE = Object.freeze({
    'orders.readiness.read': ['api/routes/orders.cjs', "router.get('/:id/readiness'"],
    'orders.knowledge_package.read': ['api/routes/orders.cjs', "router.get('/:id/knowledge-package'"],
    'recipes.technical_files.list': ['api/routes/recipes.cjs', "router.get('/:id/technical-files'"],
    'coils.cost_preview': ['api/routes/coils.cjs', "router.post('/calculate'"],
    'market.copper_price.read': ['api/routes/cost.cjs', "router.get('/copper-price'"],
    'coils.spec_options.read': ['api/routes/coils.cjs', "router.get('/specs'"],
});

function changedSourceLines(from, to) {
    const cwd = __dirname + '/..';
    const reviewed = childProcess.execFileSync('git', ['diff', '--unified=0', from, to, '--', 'api/routes/ai/tools.cjs'], { cwd, encoding: 'utf8' });
    return reviewed.split('\n').filter(line => (/^[+-]/u.test(line)) && !/^(?:---|\+\+\+)/u.test(line));
}
function assertReviewedPurchaseOverviewMetadataDelta() {
    assert.deepEqual(changedSourceLines(R3_METADATA_BASELINE, R3_REVIEWED_METADATA_COMMIT), [
        '-            description: \'读取当前全部活动订单的采购任务总览，返回供应商、物料、计划/已下单/已到货/已入库/待采购数量及关联订单。仅当用户询问采购任务、供应商、采购物料、待采购数量或采购进度时使用；“采购中的订单/单子/单据有几个”属于订单状态查询，禁止使用本工具。只读，不修改采购、订单或库存。\',',
        '+            description: \'读取当前全部活动订单的采购任务总览，返回供应商、物料、计划/已下单/已到货/已入库/待采购数量及关联订单。仅当用户询问采购任务、供应商、采购物料、待采购数量、待处理/未完成采购任务或采购进度时使用；“采购中的订单/单子/单据有几个”属于订单状态查询，禁止使用本工具。只读，不修改采购、订单或库存。\',',
        "-                    pendingOnly: { type: 'boolean', description: '仅返回待采购数量大于0的任务（可选）' }",
        "+                    pendingOnly: { type: 'boolean', description: '仅返回待采购数量大于0的待处理/未完成采购任务（可选）' }",
    ]);
    assert.deepEqual(changedSourceLines(R3_REVIEWED_METADATA_COMMIT, R5_REVIEWED_METADATA_COMMIT), [
        '-            description: \'读取某个订单的实时业务详情（配方列表、采购清单、待办、金额和状态）。用户明确提供订单ID时传 orderId；只提供客户名或合同号时必须传 orderQuery，由正式订单查询唯一解析。若当前问题还涉及人工确认的客户要求、执行档案、历史异常或来源文件，服务端会在本能力成功后按同一订单目标自动补充知识包；模型不要改调其他能力或重复调用。禁止根据名称、消息序号或历史回答猜测订单ID。\',',
        '+            description: \'读取某个订单的实时业务详情（配方列表、采购清单、待办、金额和状态）。用户明确提供订单ID时传 orderId；只提供客户名或合同号时必须传 orderQuery，由正式订单查询唯一解析。若当前问题还涉及人工确认的客户要求、执行档案、历史异常或来源文件，服务端会在本能力成功后按同一订单目标自动补充知识包。此能力只覆盖订单详情；同一请求的其它直接业务维度仍由模型根据 API Index 自行选择相关只读/预览能力，不要重复相同查询。禁止根据名称、消息序号或历史回答猜测订单ID。\',',
        '-            description: \'读取一个订单的完整只读知识包：实时订单明细、采购与待办、实时生产准备和处理方案，以及人工确认的客户要求、执行事实和来源文件。草稿不会作为正式事实返回。本工具已包含 get_order_detail、check_order_readiness 和 plan_order_readiness_actions 的核心结果，需要完整上下文时单次调用即可，不要再顺序重复调用这些工具。\',',
        '+            description: \'读取一个订单的完整只读知识包：实时订单明细、采购与待办、实时生产准备和处理方案，以及人工确认的客户要求、执行事实和来源文件。草稿不会作为正式事实返回。本工具包含 get_order_detail、check_order_readiness 和 plan_order_readiness_actions 的核心结果，需要完整上下文时可单次调用；不要为同一结果重复查询。若 Owner 同一请求还涉及本知识包未覆盖的直接业务维度，模型仍应根据 API Index 自行选择相关只读/预览能力。\',',
        '-            description: \'实时检查一个订单当前能否进入生产。按顺序核对订单状态、配方与BOM快照、零件库存、线圈库存、采购进度、锁定成本和销售单价，返回可生产、待补料、待复核、数据阻塞或不适用。只读，不修改订单和库存。已知 orderId 时可直接单次调用，无需先调用 get_order_detail；若还需要人工确认的客户要求和执行事实，服务端会在本能力成功后按同一订单目标自动补充知识包，模型不要改调其他能力。用户问“这个订单能不能生产”“是否齐料”“还缺什么”“生产准备情况”时使用。\',',
        '+            description: \'实时检查一个订单当前能否进入生产。按顺序核对订单状态、配方与BOM快照、零件库存、线圈库存、采购进度、锁定成本和销售单价，返回可生产、待补料、待复核、数据阻塞或不适用。只读，不修改订单和库存。已知 orderId 时可直接单次调用，无需先调用 get_order_detail；若还需要人工确认的客户要求和执行事实，服务端会在本能力成功后按同一订单目标自动补充知识包。此能力是生产准备和缺料的正式来源；同一请求的其它直接业务维度仍由模型根据 API Index 自行选择相关只读/预览能力。用户问“这个订单能不能生产”“是否齐料”“还缺什么”“生产准备情况”时使用。\',',
        '-            description: \'根据订单实时生产准备检查结果生成按依赖排序的处理方案。区分AI可发起确认、人工补资料、采购跟进和等待状态；本工具会自行完成所需的准备检查，只生成方案，不执行写操作，无需先调用 check_order_readiness。若还需要人工确认的客户要求和执行事实，服务端会在本能力成功后按同一订单目标自动补充知识包，模型不要改调其他能力。用户问“这个订单的问题怎么处理”“给出处理方案”“下一步做什么”时使用。\',',
        '+            description: \'根据订单实时生产准备检查结果生成按依赖排序的处理方案。区分AI可发起确认、人工补资料、采购跟进和等待状态；本工具会自行完成所需的准备检查，只生成方案，不执行写操作，无需先调用 check_order_readiness。若还需要人工确认的客户要求和执行事实，服务端会在本能力成功后按同一订单目标自动补充知识包。它不替代 Owner 同一请求中的其它直接业务维度；模型仍应根据 API Index 自行选择相关只读/预览能力。用户问“这个订单的问题怎么处理”“给出处理方案”“下一步做什么”时使用。\',',
    ]);
    const cwd = __dirname + '/..';
    const unreviewed = childProcess.execFileSync('git', ['diff', '--name-only', R5_REVIEWED_METADATA_COMMIT, '--', 'api/routes/ai/tools.cjs'], { cwd, encoding: 'utf8' }).trim();
    assert.equal(unreviewed, '', 'unreviewed tools.cjs drift must fail the A3 boundary');
    const purchase = AI_TOOLS.find(item => item?.function?.name === 'get_purchase_overview');
    assert.ok(purchase); assert.equal(AI_TOOLS.length, 80);
    assert.deepEqual(Object.keys(purchase.function.parameters.properties).sort(), ['limit', 'pendingOnly', 'supplier']);
    assert.equal(purchase.function.parameters.properties.pendingOnly.type, 'boolean');
    assert.match(purchase.function.description, /待处理\/未完成采购任务/);
    assert.match(purchase.function.parameters.properties.pendingOnly.description, /待处理\/未完成采购任务/);
    for (const name of ['get_order_detail', 'get_order_knowledge_package', 'check_order_readiness', 'plan_order_readiness_actions']) {
        const tool = AI_TOOLS.find(item => item?.function?.name === name);
        assert.ok(tool, name);
        assert.match(tool.function.description, /直接业务维度/);
        assert.doesNotMatch(tool.function.description, /模型不要改调其他能力/);
    }
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
