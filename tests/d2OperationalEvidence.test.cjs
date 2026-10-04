'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createFactLedger } = require('../api/services/ai-assistant/factLedger.cjs');
const { validateAnswer, operationalQuantityMentions } = require('../api/services/ai-assistant/answerValidator.cjs');
const { renderClaimableFactsForModel } = require('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs');
const { executeOrderTool } = require('../api/routes/ai/executors/orderExecutors.cjs');
const { createD2Wave1ControlledFixture } = require('./helpers/d2Wave1ControlledFixture.cjs');

function bindings() {
    return createD2Wave1ControlledFixture().bindings;
}
function appendOperationalEvidence() {
    const ledger = createFactLedger({ includeOperationalEvidenceFacts: true });
    const entityBindings = bindings();
    const fixture = createD2Wave1ControlledFixture();
    const virtual = ledger.appendToolResult({ toolName: 'preview_virtual_readiness', args: { basisRef: { recipeId: 11 } }, entityBindings,
        result: { success: true, verified: true, data: fixture.virtualReadiness } });
    const readiness = ledger.appendToolResult({ toolName: 'check_order_readiness', args: { orderId: 21 }, entityBindings,
        result: { success: true, verified: true, data: fixture.orderReadiness } });
    const detail = ledger.appendToolResult({ toolName: 'get_order_detail', args: { orderId: 21 }, entityBindings,
        result: { success: true, verified: true, data: fixture.orderDetail } });
    const purchase = ledger.appendToolResult({ toolName: 'get_purchase_overview', args: { limit: 1 }, entityBindings,
        result: { success: true, verified: true, queryReceipt: { returnedCount: 1, totalCount: 2, truncated: true, possiblyTruncated: true }, data: fixture.purchaseOverview } });
    return { ledger: ledger.snapshot(), ids: { virtual, readiness, detail, purchase } };
}

function fact(snapshot, predicate, role = null) {
    return snapshot.facts.find(item => item.predicate === predicate && (!role || item.qualifiers?.quantityRole === role));
}

test('W1-01..18: verified formal operational results preserve identity, quantity role, units, snapshot boundaries and completeness', () => {
    const { ledger } = appendOperationalEvidence();
    const required = fact(ledger, 'required_quantity', 'REQUIRED');
    const available = fact(ledger, 'available_quantity', 'AVAILABLE');
    const shortage = fact(ledger, 'shortage_quantity', 'SHORTAGE');
    assert.deepEqual(required.entity, { type: 'part', id: 31, canonicalName: '轴承-A' });
    assert.equal(required.value, 10); assert.equal(available.value, 7); assert.equal(shortage.value, 3);
    assert.equal(required.unit, 'piece');
    assert.equal(required.qualifiers.requirementRef, available.qualifiers.requirementRef);
    assert.equal(available.qualifiers.requirementRef, shortage.qualifiers.requirementRef);
    assert.equal(ledger.facts.some(item => item.predicate === 'shortage_quantity' && item.value === 4 && item.entity === null), false);
    assert.equal(ledger.facts.some(item => item.predicate === 'unresolved_requirement' && item.qualifiers?.displayName === '未绑定物料'), true);
    assert.equal(ledger.facts.some(item => item.predicate === 'order_snapshot_recipe' && item.value === '历史快照配方'), true);
    assert.equal(ledger.facts.some(item => item.predicate === 'current_recipe_relation'), false);
    assert.equal(ledger.facts.some(item => item.predicate === 'purchase_status' && item.entity?.canonicalName === '轴承-A'), true);
    assert.equal(ledger.facts.some(item => item.predicate === 'purchase_quantity' && item.qualifiers?.quantityRole === 'PLANNED_PURCHASE'), true);
    assert.equal(ledger.facts.some(item => item.predicate === 'purchase_quantity_ordered' && item.qualifiers?.quantityRole === 'ORDERED'), true);
    assert.equal(ledger.facts.some(item => item.predicate === 'purchase_quantity_received' && item.qualifiers?.quantityRole === 'RECEIVED'), true);
    assert.equal(ledger.facts.some(item => item.predicate === 'purchase_quantity_stocked' && item.qualifiers?.quantityRole === 'STOCKED'), true);
    const purchaseCompleteness = ledger.facts.find(item => item.predicate === 'collection_completeness' && item.qualifiers?.collectionRef === 'purchase_tasks');
    assert.equal(purchaseCompleteness.value, 'PARTIAL');
    assert.equal(purchaseCompleteness.qualifiers.complete, false);
    assert.equal(ledger.facts.some(item => item.predicate === 'purchase_coverage'), false);
});

test('W1-19..23: validator fails closed for wrong operational entity, role, unit, and partial/all claims', () => {
    const { ledger } = appendOperationalEvidence();
    const shortage = fact(ledger, 'shortage_quantity', 'SHORTAGE');
    const required = fact(ledger, 'required_quantity', 'REQUIRED');
    const purchaseQuantity = fact(ledger, 'purchase_quantity', 'PLANNED_PURCHASE');
    const partial = ledger.facts.find(item => item.predicate === 'collection_completeness' && item.qualifiers?.collectionRef === 'purchase_tasks');
    const check = (answer, factIds) => validateAnswer(JSON.stringify({ answer, claims: [{ text: answer, factIds }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds }] }), { ledger, judge: { questions: ['运营数量'] }, mode: 'READ' });
    assert.equal(check('轴承-A 缺3个。', [shortage.factId]).valid, true);
    assert.equal(check('轴承-A 缺10个。', [required.factId]).code, 'OPERATIONAL_QUANTITY_BINDING_MISMATCH');
    assert.equal(check('轴承-A 缺3套。', [shortage.factId]).code, 'OPERATIONAL_QUANTITY_BINDING_MISMATCH');
    assert.equal(check('密封件-B 缺3个。', [shortage.factId]).code, 'OPERATIONAL_QUANTITY_BINDING_MISMATCH');
    assert.equal(check('全部采购任务计划采购3个。', [purchaseQuantity.factId, partial.factId]).code, 'COLLECTION_COMPLETENESS_MISMATCH');
    const readyLedger = createFactLedger({ includeOperationalEvidenceFacts: true });
    readyLedger.appendToolResult({ toolName: 'preview_virtual_readiness', args: { basisRef: { recipeId: 11 } }, entityBindings: bindings(), result: { success: true, verified: true, data: {
        status: 'READY', inventoryBasis: 'CURRENT_STOCK_AFTER_ACTIVE_ORDER_RESERVATIONS', scenarioKey: 'base', quantity: 1,
        coverage: { complete: true, requirementCount: 0, shortageCount: 0, unresolvedCount: 0 }, collections: { requirements: { returnedCount: 0, totalCount: 0, complete: true, hasMore: false }, shortages: { returnedCount: 0, totalCount: 0, complete: true, hasMore: false }, unresolvedRequirements: { returnedCount: 0, totalCount: 0, complete: true, hasMore: false } }, requirements: [], shortages: [], unresolvedRequirements: [],
    } } });
    const ready = readyLedger.snapshot();
    const readyFacts = ready.facts.filter(item => ['readiness_status', 'collection_completeness'].includes(item.predicate));
    const answer = '当前无已识别缺料。';
    const valid = validateAnswer(JSON.stringify({ answer, claims: [{ text: answer, factIds: readyFacts.map(item => item.factId) }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds: readyFacts.map(item => item.factId) }] }), { ledger: ready, judge: { questions: ['缺料'] }, mode: 'READ' });
    assert.equal(valid.valid, true);
});

test('NS-01..06: no-shortage claims require a formal ready verdict and a complete zero-row shortage collection', () => {
    const build = ({ verdict = '可生产', canProduce = true, complete = true, returnedCount = 0, totalCount = 0, unresolved = 0 } = {}) => {
        const ledger = createFactLedger({ includeOperationalEvidenceFacts: true });
        ledger.appendToolResult({ toolName: 'check_order_readiness', args: { orderId: 21 }, entityBindings: bindings(), result: {
            success: true, verified: true, data: {
                verdict, canProduce, metrics: { shortageLineCount: 0, unresolvedLineCount: unresolved },
                collections: { shortages: { complete, returnedCount, totalCount, hasMore: !complete } }, shortages: [],
            },
        } });
        return ledger.snapshot();
    };
    const check = ledger => {
        const factIds = ledger.facts.filter(item => ['readiness_status', 'collection_completeness', 'shortage_line_count'].includes(item.predicate)).map(item => item.factId);
        return validateAnswer(JSON.stringify({ answer: '当前没有已识别缺料。', claims: [{ text: '当前没有已识别缺料。', factIds }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds }] }), { ledger, judge: { questions: ['缺料'] }, mode: 'READ' });
    };
    assert.equal(check(build()).valid, true, 'formal 可生产 + complete zero rows');
    assert.equal(check(build({ complete: false })).code, 'COLLECTION_COMPLETENESS_MISMATCH');
    assert.equal(check(build({ verdict: 'waiting_materials', canProduce: false })).code, 'COLLECTION_COMPLETENESS_MISMATCH');
    assert.equal(check(build({ returnedCount: 0, totalCount: 1 })).code, 'COLLECTION_COMPLETENESS_MISMATCH');
    assert.equal(check(build({ unresolved: 1 })).code, 'COLLECTION_COMPLETENESS_MISMATCH');
});

test('PC-01..07: a verified partial purchase collection remains deliverable but cannot be presented as complete', () => {
    const { ledger } = appendOperationalEvidence();
    const partial = ledger.facts.find(item => item.predicate === 'collection_completeness' && item.qualifiers?.collectionRef === 'purchase_tasks');
    const partialAnswer = '当前仅返回1条采购任务，正式结果显示还有更多记录。';
    const partialResult = validateAnswer(JSON.stringify({
        answer: partialAnswer, claims: [{ text: partialAnswer, factIds: [partial.factId] }],
        goals: [{ questionIndex: 0, status: 'PARTIAL', factIds: [partial.factId] }],
    }), { ledger, judge: { questions: ['待处理采购'] }, mode: 'READ' });
    assert.equal(partialResult.valid, true);
    const allResult = validateAnswer(JSON.stringify({
        answer: '全部采购任务只有这些。', claims: [{ text: '全部采购任务只有这些。', factIds: [partial.factId] }],
        goals: [{ questionIndex: 0, status: 'PARTIAL', factIds: [partial.factId] }],
    }), { ledger, judge: { questions: ['待处理采购'] }, mode: 'READ' });
    assert.equal(allResult.code, 'COLLECTION_COMPLETENESS_MISMATCH');
});

test('W1-36..37: model-facing catalog keeps operational roles and names but hides internal numeric identities', () => {
    const { ledger } = appendOperationalEvidence();
    const catalog = renderClaimableFactsForModel(ledger);
    const shortage = catalog.find(item => item.predicate === 'shortage_quantity' && item.entity?.canonicalName === '轴承-A');
    assert.equal(shortage.claimType, 'OPERATIONAL_QUANTITY');
    assert.equal(shortage.qualifiers.quantityRole, 'SHORTAGE');
    assert.equal(shortage.qualifiers.requirementRef, 'virtual_requirements:0');
    assert.equal(JSON.stringify(catalog).includes('"partId"'), false);
    assert.equal(JSON.stringify(catalog).includes('"orderId"'), false);
    assert.equal(JSON.stringify(catalog).includes('"coilId"'), false);
});

test('OV-01..08: operational quantity parsing binds every value to its local role', () => {
    const roles = text => operationalQuantityMentions(text).map(item => [item.value, item.unit, item.role]);
    assert.deepEqual(roles('缺料共1项。'), [[1, 'count', 'SHORTAGE_LINE_COUNT']]);
    assert.deepEqual(roles('有1项物料库存不足。'), [[1, 'count', 'SHORTAGE_LINE_COUNT']]);
    assert.deepEqual(roles('D1轴承缺3个。'), [[3, 'piece', 'SHORTAGE']]);
    assert.deepEqual(roles('需求10个，可用7个，缺3个。'), [[10, 'piece', 'REQUIRED'], [7, 'piece', 'AVAILABLE'], [3, 'piece', 'SHORTAGE']]);
    assert.deepEqual(roles('计划采购3个，已下单0个，已到货0个，已入库0个。'), [[3, 'piece', 'PLANNED_PURCHASE'], [0, 'piece', 'ORDERED'], [0, 'piece', 'RECEIVED'], [0, 'piece', 'STOCKED']]);
    assert.deepEqual(roles('缺3个，计划采购3个。'), [[3, 'piece', 'SHORTAGE'], [3, 'piece', 'PLANNED_PURCHASE']]);
    assert.deepEqual(roles('有1项缺料，轴承-A缺3个。'), [[1, 'count', 'SHORTAGE_LINE_COUNT'], [3, 'piece', 'SHORTAGE']]);
});

test('IDQ-01..17: identifier fragments never become operational quantities while local quantity grammar remains strict', () => {
    const roles = text => operationalQuantityMentions(text).map(item => [item.value, item.unit, item.role]);
    for (const identifier of ['D1-R1轴承-202', '12-120-A', 'V750', 'COIL-0001', 'M5-D2-B2', 'D2-B2未绑定物料', 'ABC_123', 'PART-608', '2026-10-04']) {
        assert.deepEqual(roles(identifier), [], identifier);
    }
    assert.deepEqual(roles('缺口物料为 D1-R1轴承-202，需求10个，可用7个，缺3个。'), [[10, 'piece', 'REQUIRED'], [7, 'piece', 'AVAILABLE'], [3, 'piece', 'SHORTAGE']]);
    assert.deepEqual(roles('D1-R1轴承-202计划采购3个，已下单0个，已到货0个，已入库0个。'), [[3, 'piece', 'PLANNED_PURCHASE'], [0, 'piece', 'ORDERED'], [0, 'piece', 'RECEIVED'], [0, 'piece', 'STOCKED']]);
    assert.deepEqual(roles('ORDER-A有1项缺料：D1-R1轴承-202缺3个。'), [[1, 'count', 'SHORTAGE_LINE_COUNT'], [3, 'piece', 'SHORTAGE']]);
    assert.deepEqual(roles('V750-通用款做10台需要D1-R1轴承-202共20个。'), [[10, 'count', 'REQUIRED']], 'only a locally grammatical quantity may be recognized');
    assert.deepEqual(roles('3.5米电缆，需求2.5kg。'), [[3.5, 'meter', 'REQUIRED'], [2.5, 'kg', 'REQUIRED']]);
});

test('LC-01..11: collection-line grammar retains raw units without converting ordinary count quantities into line counts', () => {
    const roles = text => operationalQuantityMentions(text).map(item => [item.value, item.rawUnit, item.unit, item.role]);
    assert.deepEqual(roles('缺1项物料。'), [[1, '项', 'count', 'SHORTAGE_LINE_COUNT']]);
    assert.deepEqual(roles('缺2项零件。'), [[2, '项', 'count', 'SHORTAGE_LINE_COUNT']]);
    assert.deepEqual(roles('缺2条物料记录。'), [[2, '条', 'count', 'SHORTAGE_LINE_COUNT']]);
    assert.deepEqual(roles('有1项物料库存不足。'), [[1, '项', 'count', 'SHORTAGE_LINE_COUNT']]);
    assert.deepEqual(roles('缺料1项。'), [[1, '项', 'count', 'SHORTAGE_LINE_COUNT']]);
    assert.deepEqual(roles('缺3台水泵。'), [[3, '台', 'count', 'SHORTAGE']]);
    assert.deepEqual(roles('缺3个轴承。'), [[3, '个', 'piece', 'SHORTAGE']]);
    assert.deepEqual(roles('缺1项物料：D1-R1轴承-202缺3个。'), [[1, '项', 'count', 'SHORTAGE_LINE_COUNT'], [3, '个', 'piece', 'SHORTAGE']]);
    assert.deepEqual(roles('D1-R1轴承-202、12-120-A、V750、COIL-0001、M5-D2-B2。'), []);
    assert.deepEqual(roles('缺3个，计划采购3个。'), [[3, '个', 'piece', 'SHORTAGE'], [3, '个', 'piece', 'PLANNED_PURCHASE']]);
    assert.deepEqual(roles('计划采购3个，已下单0个，已到货0个，已入库0个。'), [[3, '个', 'piece', 'PLANNED_PURCHASE'], [0, '个', 'piece', 'ORDERED'], [0, '个', 'piece', 'RECEIVED'], [0, '个', 'piece', 'STOCKED']]);
});

test('OV-09..15: validator keeps strict quantity entity, role, unit and collection checks', () => {
    const { ledger } = appendOperationalEvidence();
    const required = fact(ledger, 'required_quantity', 'REQUIRED');
    const available = fact(ledger, 'available_quantity', 'AVAILABLE');
    const shortage = fact(ledger, 'shortage_quantity', 'SHORTAGE');
    const planned = fact(ledger, 'purchase_quantity', 'PLANNED_PURCHASE');
    const ordered = fact(ledger, 'purchase_quantity_ordered', 'ORDERED');
    const received = fact(ledger, 'purchase_quantity_received', 'RECEIVED');
    const stocked = fact(ledger, 'purchase_quantity_stocked', 'STOCKED');
    const lineCount = ledger.facts.find(item => item.predicate === 'shortage_line_count' && item.qualifiers?.quantityRole === 'SHORTAGE_LINE_COUNT');
    const check = (answer, factIds) => validateAnswer(JSON.stringify({ answer, claims: [{ text: answer, factIds }], goals: [{ questionIndex: 0, status: 'COMPLETED', factIds }] }), { ledger, judge: { questions: ['运营数量'] }, mode: 'READ' });
    assert.equal(check(`缺料共${lineCount.value}项。`, [lineCount.factId]).valid, true);
    assert.equal(check('需求10个，可用7个，缺3个。', [required.factId, available.factId, shortage.factId]).valid, true);
    assert.equal(check(`计划采购${planned.value}个，已下单${ordered.value}个，已到货${received.value}个，已入库${stocked.value}个。`, [planned.factId, ordered.factId, received.factId, stocked.factId]).valid, true);
    assert.equal(check('轴承-A 缺3个。', [required.factId]).code, 'OPERATIONAL_QUANTITY_BINDING_MISMATCH');
    assert.equal(check('密封件-B 缺3个。', [shortage.factId]).code, 'OPERATIONAL_QUANTITY_BINDING_MISMATCH');
    assert.equal(check('轴承-A 缺3套。', [shortage.factId]).code, 'OPERATIONAL_QUANTITY_BINDING_MISMATCH');
    assert.equal(check('轴承-A 缺3。', [shortage.factId]).code, 'OPERATIONAL_QUANTITY_BINDING_MISMATCH');
});

test('W1-25: purchase overview survives the formal executor receipt before the ledger projects it', async () => {
    const fixture = createD2Wave1ControlledFixture();
    const internalFetch = async (url, options) => {
        assert.equal(options.method, 'GET');
        assert.match(url, /^\/api\/orders\/purchase-overview\?limit=1$/);
        return new Response(JSON.stringify({ success: true, data: fixture.purchaseOverview }), { status: 200 });
    };
    const executed = await executeOrderTool('get_purchase_overview', { limit: 1 }, internalFetch);
    assert.equal(executed.success, true);
    assert.deepEqual(executed.queryReceipt, {
        appliedFilters: { pendingOnly: false, limit: 1 }, totalCount: 2, returnedCount: 1,
        truncated: true, possiblyTruncated: true, authoritative: true,
    });
    const ledger = createFactLedger({ includeOperationalEvidenceFacts: true });
    ledger.appendToolResult({ toolName: 'get_purchase_overview', result: { ...executed, verified: true } });
    const facts = ledger.snapshot().facts;
    assert.equal(facts.some(item => item.predicate === 'purchase_quantity' && item.entity?.canonicalName === '轴承-A'), true);
    assert.equal(facts.some(item => item.predicate === 'collection_completeness' && item.value === 'PARTIAL'), true);
});

test('W1-26: order-detail executor marks only result-scoped collections complete and preserves recipe snapshots', async () => {
    const row = {
        id: 21, customerName: '测试客户', contractNo: 'HT-D2-001', status: '采购中',
        itemsJson: JSON.stringify([{ recipeId: 999, recipeName: '历史快照配方', qty: 2 }]),
        purchaseListJson: JSON.stringify([{ model: '轴承-A' }]), todosJson: JSON.stringify([{ title: '跟进到货' }]),
    };
    const internalFetch = async (url, options) => {
        assert.equal(options.method, 'GET');
        assert.equal(url, '/api/orders/21');
        return new Response(JSON.stringify({ success: true, data: row }), { status: 200 });
    };
    const executed = await executeOrderTool('get_order_detail', { orderId: 21 }, internalFetch);
    assert.equal(executed.success, true);
    assert.deepEqual(executed.order.collections.items, { returnedCount: 1, totalCount: 1, complete: true, hasMore: false });
    const ledger = createFactLedger({ includeOperationalEvidenceFacts: true });
    // The dynamic capability broker carries composite executor output as the
    // verified formal `data` envelope. This is the same shape the Candidate
    // receives, so the ledger must read the nested order without assuming a
    // current recipe relation from its historical line snapshot.
    ledger.appendToolResult({ toolName: 'get_order_detail', args: { orderId: 21 }, entityBindings: bindings(), result: { success: true, verified: true, data: executed } });
    const facts = ledger.snapshot().facts;
    assert.equal(facts.some(item => item.predicate === 'order_snapshot_recipe' && item.value === '历史快照配方'), true);
    assert.equal(facts.some(item => item.predicate === 'current_recipe_relation'), false);
});
