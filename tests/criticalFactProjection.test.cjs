'use strict';
/**
 * E1-A — Structured Criticality Producer Contract（关键事实投影契约）
 *
 * 覆盖用户点名的测试 1–6：
 *   1 pricingComplete=false → mustShow
 *   2 shortage → mustShow
 *   3 unresolvedRequirement → mustShow
 *   4 normal row → not mustShow
 *   5 未知自然语言表达不影响结构化判定
 *   6 没有 structured state → fallback 仍存在
 *
 * 所有 producer 字段都取自**真实 capability 输出契约**（见模块头部注释的来源清单）。
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { projectCriticalFacts, PRODUCER_STATE, DISPLAY_SCOPE } = require('../api/services/criticalFactProjection.cjs');
const { buildListCriticality, listRowTier, normalizeAnswerPresentation, LIST_TIER, TIER1_PATTERN, TIER2_PATTERN } = require('../api/services/aiPresentationNormalizer.cjs');

const verified = data => ({ success: true, data, executionEvidence: { verified: true, kind: 'formal_api_query' } });
const factsOf = toolResults => projectCriticalFacts(toolResults);

test('E1-A-1 preview_virtual_readiness 的 SHORTAGE 状态与 shortages 都是 mustShow', () => {
    const projection = factsOf([{ name: 'preview_virtual_readiness', result: verified({
        recipeName: 'v550-tokoy', status: 'SHORTAGE',
        coverage: { requirementCount: 2, shortageCount: 2, complete: true },
        shortages: [
            { requirementKey: 'coil:1', resourceType: 'COIL', coilId: 1, model: '12-120', shortageQty: 300 },
            { requirementKey: 'part:71', resourceType: 'PART', partId: 71, model: '珍珠棉', shortageQty: 300 },
        ],
        unresolvedRequirements: [], excludedRequirements: [], warnings: [],
    }) }]);
    assert.equal(projection.producers.preview_virtual_readiness, PRODUCER_STATE.ACTIVE);
    assert.deepEqual(projection.rowTokens.sort(), ['12-120', '珍珠棉']);
    assert.deepEqual(projection.subjectTokens, ['v550-tokoy']);
    assert.ok(projection.mustShowTokens.length >= 3);
    // 缺料对象是行级事实；被评估的主体是主体级事实。
    assert.equal(projection.facts.find(fact => fact.displayToken === '12-120').displayScope, DISPLAY_SCOPE.ROW);
    assert.equal(projection.facts.find(fact => fact.displayToken === 'v550-tokoy').displayScope, DISPLAY_SCOPE.SUBJECT);
});

test('E1-A-2 preview_recipe_cost 的 costComplete=false / missingParts 都是 mustShow', () => {
    const projection = factsOf([{ name: 'preview_recipe_cost', result: verified({
        recipeId: 13, recipeName: 'v550-tokoy', currentTotalCost: 271.98,
        costComplete: false, missingParts: [{ model: '6202轴承', name: '轴承' }], warnings: [],
    }) }]);
    assert.equal(projection.producers.preview_recipe_cost, PRODUCER_STATE.ACTIVE);
    assert.ok(projection.rowTokens.includes('6202轴承'), '缺失零件必须 mustShow');
    const incomplete = projection.facts.find(fact => fact.reasonCode === 'COST_INCOMPLETE');
    assert.ok(incomplete && incomplete.mustShow);
    assert.equal(incomplete.displayScope, DISPLAY_SCOPE.SUBJECT);
    assert.equal(incomplete.entityDisplayName, 'v550-tokoy');
});

test('E1-A-3 unresolvedRequirement 与 coverage.complete=false 都是 mustShow', () => {
    const projection = factsOf([{ name: 'preview_virtual_readiness', result: verified({
        recipeName: 'v550-tokoy', status: 'INCOMPLETE',
        coverage: { requirementCount: 3, evaluatedCount: 1, unresolvedCount: 2, complete: false },
        shortages: [], unresolvedRequirements: [{ code: 'INVENTORY_IDENTITY_UNRESOLVED' }], excludedRequirements: [], warnings: [],
    }) }]);
    const reasons = projection.facts.map(fact => fact.reasonCode);
    assert.ok(reasons.includes('INVENTORY_IDENTITY_UNRESOLVED'));
    assert.ok(reasons.includes('READINESS_COVERAGE_INCOMPLETE'));
    assert.ok(projection.facts.every(fact => fact.mustShow));
});

test('E1-A-4 正常行不产生 mustShow（只产生 SUPPORT 的正式金额事实）', () => {
    const projection = factsOf([{ name: 'preview_recipe_cost', result: verified({
        recipeId: 13, recipeName: 'v550-tokoy', currentTotalCost: 271.98, costComplete: true, missingParts: [], warnings: [],
    }) }]);
    assert.deepEqual(projection.rowTokens, []);
    assert.deepEqual(projection.subjectTokens, []);
    assert.deepEqual(projection.mustShowTokens, []);
    // 正式金额只作为 SUPPORT 事实（支撑结论），不是关键状态。
    assert.ok(projection.supportTokens.includes('271.98'));
    assert.ok(projection.facts.filter(fact => fact.severity === 'SUPPORT').every(fact => fact.mustShow === false));
});

test('E1-A-5 未接入 producer 的能力不产生结构化关键性（不猜字段名）', () => {
    for (const receipt of [
        { name: 'search_parts', result: verified([{ model: '常规件', stock: 400, shortage: 300, missing: 1 }]) },
        { name: 'search_coils', result: verified([{ schemeCode: 'COIL-A', cost: 166.7, incomplete: true }]) },
    ]) {
        const projection = factsOf([receipt]);
        assert.deepEqual(projection.mustShowTokens, [], `${receipt.name} 未登记 producer，不得产生 mustShow`);
        assert.equal(projection.producers[receipt.name], undefined);
    }
    // 已知没有结构化关键状态契约的能力必须被显式记录。
    assert.ok(factsOf([]).notAvailable.includes('preview_profitability'));
});

test('E1-A-6 未知名词/自然语言表达不影响结构化判定', () => {
    const receipts = [{ name: 'preview_virtual_readiness', result: verified({
        recipeName: 'v550-tokoy', status: 'SHORTAGE', coverage: { shortageCount: 1, complete: true },
        shortages: [{ resourceType: 'PART', partId: 71, model: '6202轴承', shortageQty: 300 }], warnings: [],
    }) }];
    const criticality = buildListCriticality(receipts);
    // 三个从未出现过的说法：都不命中任何既有词表，必须靠结构化 token 保留。
    const wordings = [
        '现货只能凑一部分，余量暂时没有着落',
        '已到一部分，须等下一批',
        '手上数量偏少，其余暂无来源',
    ];
    for (const wording of wordings) {
        assert.equal(TIER1_PATTERN.test(wording), false, `不得命中 TIER1：${wording}`);
        assert.equal(TIER2_PATTERN.test(wording), false, `不得命中 TIER2：${wording}`);
        assert.equal(listRowTier(`- 6202轴承：${wording}。`, criticality), LIST_TIER.DECISION_CRITICAL);
    }
    // 结构化来源可用时，措辞不得再把无关行升级为关键行。
    assert.equal(listRowTier('- 缺 300 个 其它件', criticality), LIST_TIER.NEUTRAL_DETAIL);
});

test('E1-A-6b 没有 structured state 时保守兜底仍存在，且不作保全声明', () => {
    const noProducer = buildListCriticality([{ name: 'search_parts', result: verified([{ model: '常规件', stock: 400 }]) }]);
    assert.deepEqual(noProducer.mustShowTokens, []);
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：库存充足。`),
        '- 缺 300 个 6202 轴承',
        '- 常规件12：库存充足。',
    ];
    const out = normalizeAnswerPresentation(`库存检查结果如下。\n\n${rows.join('\n')}`, '查库存', { criticality: noProducer });
    assert.match(out, /缺 300 个 6202 轴承/, '结构化来源为空时兜底必须仍保护结论性行');
    assert.doesNotMatch(out, /已全部保留/, '不得作出无法支持的保全声明');
    assert.match(out, /没有出现结构化的缺料/, '必须如实说明本轮没有结构化关键状态');
});

test('E1-A-7 ROW 与 SUBJECT 的核对位置不同（subject 不要求在清单行里出现）', () => {
    const criticality = buildListCriticality([{ name: 'preview_virtual_readiness', result: verified({
        recipeName: 'v550-tokoy', status: 'SHORTAGE', coverage: { shortageCount: 1, complete: true },
        shortages: [{ resourceType: 'PART', partId: 71, model: '6202轴承', shortageQty: 300 }], warnings: [],
    }) }]);
    // 主体出现在正文里、缺料对象出现在清单行里 ⇒ 两类都算已展示，必须声明「已全部保留」。
    const rows = [
        ...Array.from({ length: 10 }, (_, index) => `- 常规件${index + 1}：库存充足。`),
        '- 6202轴承：还差300个。',
        '- 常规件12：库存充足。',
    ];
    const out = normalizeAnswerPresentation(`v550-tokoy 的齐料检查结果如下。\n\n${rows.join('\n')}`, '查库存', { criticality });
    assert.match(out, /已全部保留/);
    assert.doesNotMatch(out, /没有出现在回答里/);

    // 主体完全没出现在回答里 ⇒ 必须如实报告，而不是假装保全。
    const outMissingSubject = normalizeAnswerPresentation(`齐料检查结果如下。\n\n${rows.join('\n')}`, '查库存', { criticality });
    assert.match(outMissingSubject, /没有出现在回答里/);
});

test('E1-A-8 order readiness / purchase overview 使用各自真实 schema', () => {
    const readiness = factsOf([{ name: 'get_order_readiness_overview', result: verified({
        generatedAt: '2026-09-23T00:00:00.000Z',
        metrics: { totalActiveOrders: 2, ready: 1, waitingMaterials: 1, needsReview: 0, blocked: 0, attentionRequired: 1 },
        items: [
            { order: { id: 1, contractNo: 'HT-1', customerName: '客户-001' }, verdict: 'waiting_materials', canProduce: false, blockers: [], warnings: [], shortages: [{ identityKey: 'part:71', model: '珍珠棉', shortageQty: 300 }] },
            { order: { id: 2, contractNo: 'HT-2', customerName: '客户-002' }, verdict: 'ready', canProduce: true, blockers: [], warnings: [], shortages: [] },
        ],
    }) }]);
    assert.equal(readiness.producers.get_order_readiness_overview, PRODUCER_STATE.ACTIVE);
    assert.ok(readiness.rowTokens.includes('珍珠棉'));
    assert.ok(readiness.subjectTokens.includes('HT-1'));
    assert.equal(readiness.subjectTokens.includes('HT-2'), false, 'ready 订单不是关键事实');
    assert.equal(readiness.rowTokens.includes('HT-2'), false);

    const purchase = factsOf([{ name: 'get_purchase_overview', result: verified({
        summary: { activeOrderCount: 1, supplierCount: 1, taskCount: 2, pendingTaskCount: 1, plannedQty: 0, orderedQty: 0, receivedQty: 0, stockedQty: 0, pendingQty: 300 },
        returnedCount: 2, truncated: false, filters: {}, 
        tasks: [
            { supplierLabel: '供应甲', model: '珍珠棉', orderIds: [1], orderCount: 1, plannedQty: 0, orderedQty: 0, receivedQty: 0, stockedQty: 0, pendingQty: 300 },
            { supplierLabel: '供应乙', model: '木箱', orderIds: [1], orderCount: 1, plannedQty: 0, orderedQty: 0, receivedQty: 0, stockedQty: 0, pendingQty: 0 },
        ],
    }) }]);
    assert.equal(purchase.producers.get_purchase_overview, PRODUCER_STATE.ACTIVE);
    assert.deepEqual(purchase.rowTokens, ['珍珠棉'], '只有 pendingQty>0 的采购项是关键事实');
});

test('E1-A-9 purchase schema 缺失时显式记录 PRODUCER_NOT_AVAILABLE（不猜字段）', () => {
    const projection = factsOf([{ name: 'get_purchase_overview', result: verified({ summary: { pendingQty: 300 } }) }]);
    assert.equal(projection.producers.get_purchase_overview, PRODUCER_STATE.PRODUCER_NOT_AVAILABLE);
    assert.deepEqual(projection.mustShowTokens, []);
});
