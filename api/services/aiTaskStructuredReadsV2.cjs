'use strict';

// N4.1A declares how Task V2 reuses already-registered read capabilities.
// It is a server-owned mapping layer, not a second executor, tool registry,
// or source of business algorithms.
const { stableHash } = require('./stableJson.cjs');
const { makeFactKey, makeFactRecordV1 } = require('./aiTaskFactsV2.cjs');
const { readJsonPointer } = require('./aiTaskCapabilityAdapterV2.cjs');

const STRUCTURED_READ_GOALS = Object.freeze(new Set([
    'CUSTOMER_HISTORY', 'QUOTATION_QUERY', 'ORDER_READINESS', 'INVENTORY_QUERY',
    'MANAGEMENT_OVERVIEW', 'BUSINESS_CHANGES', 'IMPACT_INVESTIGATION', 'COIL_QUERY',
]));

const GOAL_CAPABILITIES = Object.freeze({
    CUSTOMER_HISTORY: 'search_customer_history',
    QUOTATION_QUERY: 'search_quotations',
    ORDER_READINESS: 'get_order_knowledge_package',
    MANAGEMENT_OVERVIEW: 'get_management_action_center',
    BUSINESS_CHANGES: 'search_business_changes',
    COIL_QUERY: 'search_coils',
});

function queryReceipt(result = {}) { return result.queryReceipt || result.receipt || null; }

function collectionCoverageV1({ result, capabilityId, scopeType }) {
    const receipt = queryReceipt(result);
    const authoritative = receipt?.authoritative === true;
    const truncated = receipt?.truncated;
    const possible = receipt?.possiblyTruncated;
    const hasMore = truncated === true || possible === true ? true : (authoritative && truncated === false && possible === false ? false : null);
    const complete = result?.complete === true || result?.collectionComplete === true
        || (authoritative && truncated === false && possible !== true);
    const filters = receipt?.appliedFilters && typeof receipt.appliedFilters === 'object'
        ? structuredClone(receipt.appliedFilters) : {};
    const limit = Number.isFinite(Number(filters.limit)) ? Number(filters.limit) : null;
    const returnedCount = Number.isFinite(Number(receipt?.returnedCount)) ? Number(receipt.returnedCount) : null;
    return Object.freeze({
        scopeType,
        queryScopeHash: stableHash({ scopeType, capabilityId, filters }),
        filters,
        limit,
        returnedCount,
        hasMore,
        complete: Boolean(complete),
        sourceCapabilityId: capabilityId,
    });
}

function requirement({ requirementKey, predicate, subjectKey = null, temporalScope = 'CURRENT', basis, requireComplete = true, unit = 'record', currency = null }) {
    return { requirementKey, predicate, subjectKey, scenarioKey: null, temporalScope, basis, requireComplete, unit, currency };
}

function customerHistoryTypes(userGoal = '') {
    const asksQuotation = /报价|报价单|价格/u.test(userGoal);
    const asksOrder = /订单|买过|采购/u.test(userGoal);
    if (asksQuotation && !asksOrder) return ['quotation'];
    if (asksOrder && !asksQuotation) return ['order'];
    return ['quotation', 'order'];
}

function requirementsForStructuredGoal(goal, { userGoal = '', coverage = null } = {}) {
    const subjectKey = goal.subjectKeys[0] || null;
    switch (goal.kind) {
        case 'CUSTOMER_HISTORY': {
            const types = customerHistoryTypes(userGoal);
            const completeHistoryRequested = /(?:全部|所有)/u.test(userGoal);
            return [
                requirement({ requirementKey: `customer-identity:${subjectKey}`, predicate: 'customer.identity', subjectKey, temporalScope: 'CURRENT', basis: 'CUSTOMER_DIRECTORY' }),
                ...types.map(type => requirement({
                    requirementKey: `customer-${type}-history:${subjectKey}`,
                    predicate: `customer.${type}_history`, subjectKey,
                    temporalScope: 'HISTORICAL', basis: 'CUSTOMER_HISTORY',
                    requireComplete: completeHistoryRequested || Boolean(coverage?.complete),
                })),
            ];
        }
        case 'QUOTATION_QUERY': return [requirement({ requirementKey: `quotation-summary:${goal.goalKey}`, predicate: 'quotation.summary', basis: 'QUOTATION_CURRENT_LIST', requireComplete: Boolean(coverage?.complete) })];
        case 'ORDER_READINESS': return [
            requirement({ requirementKey: `order-identity:${subjectKey}`, predicate: 'order.identity', subjectKey, basis: 'ORDER_KNOWLEDGE_PACKAGE' }),
            requirement({ requirementKey: `order-readiness:${subjectKey}`, predicate: 'order.readiness', subjectKey, basis: 'ORDER_KNOWLEDGE_PACKAGE' }),
            requirement({ requirementKey: `order-actions:${subjectKey}`, predicate: 'order.readiness_actions', subjectKey, basis: 'ORDER_KNOWLEDGE_PACKAGE' }),
        ];
        case 'INVENTORY_QUERY': return [requirement({ requirementKey: `inventory:${subjectKey || goal.goalKey}`, predicate: subjectKey ? 'inventory.coil' : 'inventory.part', subjectKey, basis: 'FORMAL_INVENTORY_QUERY', requireComplete: Boolean(coverage?.complete) })];
        case 'COIL_QUERY': return [requirement({ requirementKey: `coil-variants:${subjectKey || goal.goalKey}`, predicate: 'coil.variant_set', subjectKey, basis: 'COIL_CATALOGUE_QUERY', requireComplete: Boolean(coverage?.complete) })];
        case 'COIL_COST': return [requirement({ requirementKey: `coil-cost:${subjectKey || goal.goalKey}`, predicate: 'coil.current_cost', subjectKey, basis: 'FORMAL_COIL_COST_QUERY', requireComplete: true })];
        // E2-R1 FAMILY-01：双主体成本比较。三个正式事实缺一不可：
        // 主体 A 的当前完整成本、主体 B 的当前完整成本、以及**来自 compare_recipes 回执**的正式差额。
        // 差额 predicate 绑定在主体 A 上（A 是差额的说法基准）；金额永远来自回执，控制器不相减。
        case 'RECIPE_COST_COMPARISON': return [
            requirement({ requirementKey: `comparison-cost-a:${goal.subjectKeys[0] || goal.goalKey}`, predicate: 'recipe.current_cost', subjectKey: goal.subjectKeys[0] || null, basis: 'FORMAL_COST_COMPARISON', requireComplete: true, unit: 'pump', currency: 'CNY' }),
            requirement({ requirementKey: `comparison-cost-b:${goal.subjectKeys[1] || goal.goalKey}`, predicate: 'recipe.current_cost', subjectKey: goal.subjectKeys[1] || null, basis: 'FORMAL_COST_COMPARISON', requireComplete: true, unit: 'pump', currency: 'CNY' }),
            requirement({ requirementKey: `comparison-diff:${goal.subjectKeys[0] || goal.goalKey}`, predicate: 'recipe.cost_difference', subjectKey: goal.subjectKeys[0] || null, basis: 'FORMAL_COST_COMPARISON', requireComplete: true, unit: 'pump', currency: 'CNY' }),
        ];
        case 'MANAGEMENT_OVERVIEW': return [requirement({ requirementKey: `management:${goal.goalKey}`, predicate: 'management.action_center', basis: 'MANAGEMENT_ACTION_CENTER' })];
        case 'BUSINESS_CHANGES': return [requirement({ requirementKey: `business-changes:${goal.goalKey}`, predicate: 'business.change_set', basis: 'BUSINESS_CHANGE_EVENT_LOG', requireComplete: Boolean(coverage?.complete) })];
        case 'IMPACT_INVESTIGATION': return [requirement({ requirementKey: `impact:${goal.goalKey}`, predicate: 'business.impact_projection', subjectKey, basis: 'FORMAL_IMPACT_PROJECTION' })];
        default: return [];
    }
}

function makeStructuredFact({ receipt, pointer, entityType, entityId, predicate, temporalScope = 'CURRENT', basis, coverage = null, planRevision, clock, complete = true }) {
    const key = makeFactKey({
        entityType, entityId, predicate, temporalScope, scenarioKey: null,
        basis, unit: 'record', currency: null,
        queryScopeHash: coverage?.queryScopeHash || null,
    });
    return makeFactRecordV1({
        receipt, pointer, key,
        evidenceState: 'VERIFIED_POSITIVE',
        complete: Boolean(complete), planRevision, clock,
    });
}

function projectCustomerHistoryFacts({ receipt, customer, historyTypes, coverage, planRevision, clock }) {
    const facts = [makeStructuredFact({ receipt, pointer: '/data/customer', entityType: 'customer', entityId: customer.entityId, predicate: 'customer.identity', basis: 'CUSTOMER_DIRECTORY', planRevision, clock })];
    for (const type of historyTypes) {
        const pointer = type === 'quotation' ? '/data/quotations' : '/data/orders';
        const records = readJsonPointer(receipt.result, pointer);
        const key = makeFactKey({ entityType: 'customer', entityId: customer.entityId, predicate: `customer.${type}_history`, temporalScope: 'HISTORICAL', scenarioKey: null, basis: 'CUSTOMER_HISTORY', unit: 'record', currency: null, queryScopeHash: coverage.queryScopeHash });
        facts.push(makeFactRecordV1({ receipt, pointer, key, evidenceState: Array.isArray(records) && records.length === 0 && coverage.complete ? 'VERIFIED_NEGATIVE' : 'VERIFIED_POSITIVE', complete: coverage.complete, planRevision, clock }));
    }
    return facts;
}

module.exports = {
    GOAL_CAPABILITIES,
    STRUCTURED_READ_GOALS,
    collectionCoverageV1,
    customerHistoryTypes,
    makeStructuredFact,
    projectCustomerHistoryFacts,
    requirementsForStructuredGoal,
};
