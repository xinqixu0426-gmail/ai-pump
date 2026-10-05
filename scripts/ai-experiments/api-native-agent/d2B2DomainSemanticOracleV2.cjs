'use strict';

// Acceptance-only V2 oracle.  The frozen V1 exact-domain corpus remains
// untouched and is retained as a selection-efficiency diagnostic.  V2 scores
// reusable required facts against verified formal evidence and the authority
// projection in API Index; it neither routes production requests nor lists
// acceptable tool chains per case.
const { getApiIndexEntry } = require('../../../api/services/ai-assistant/apiIndex.cjs');
const { scoreDomainSelection } = require('./d2B2DomainCorpus.cjs');

const FACT_REQUIREMENT_PROFILES = Object.freeze({
    ORDER_CURRENT: Object.freeze([{ anyOf: ['order_status', 'order_snapshot_recipe', 'readiness_status'], complete: true }]),
    PROCUREMENT_COLLECTION: Object.freeze([{ anyOf: ['purchase_status', 'collection_completeness'], authorityIncludes: 'purchase' }]),
    RECIPE_DETAIL: Object.freeze([{ anyOf: ['recipe_identity', 'recipe_bom'] }]),
    CURRENT_COST: Object.freeze([{ anyOf: ['current_cost', 'scenario_cost'], authorityIncludes: 'costEngine', complete: true,
        entityRequired: true, allowedMoneyRoles: ['CURRENT_FORMAL', 'CURRENT_BASE'] }]),
    COIL_SCHEMES: Object.freeze([{ anyOf: ['coil_identity', 'coil_specification'] }]),
    QUOTATION_COLLECTION: Object.freeze([{ anyOf: ['quotation_status', 'quotation_collection'] }]),
    KNOWLEDGE_HISTORY: Object.freeze([{ anyOf: ['auxiliary_knowledge_retrieval', 'knowledge_record'] }]),
    SHORTAGE_PROCUREMENT: Object.freeze([
        { anyOf: ['shortage_quantity'], authorityIncludes: 'order', entityRequired: true },
        { anyOf: ['purchase_status', 'purchase_quantity'], authorityIncludes: 'purchase', entityRequired: true },
        { anyOf: ['collection_completeness'], collectionRef: 'order_shortages', complete: true },
    ]),
    CUSTOMER_HISTORY_ALL: Object.freeze([
        { anyOf: ['quotation_history'], authorityIncludes: 'quotation', complete: true },
        { anyOf: ['order_history'], authorityIncludes: 'order', complete: true },
    ]),
    RECIPE_INVENTORY: Object.freeze([
        { anyOf: ['readiness_status'], authorityIncludes: 'inventory', complete: true, entityRequired: true },
        { anyOf: ['collection_completeness'], authorityIncludes: 'inventory', complete: true, entityRequired: true },
    ]),
    ORDER_KNOWLEDGE_FILES: Object.freeze([{ anyOf: ['source_file'], authorityIncludes: 'factory_file', complete: true }]),
});

const DOMAIN_SEMANTIC_REQUIREMENTS_V2 = Object.freeze({
    D01: 'ORDER_CURRENT', D02: 'PROCUREMENT_COLLECTION', D03: 'RECIPE_DETAIL', D04: 'CURRENT_COST',
    D05: 'COIL_SCHEMES', D06: 'QUOTATION_COLLECTION', D07: 'KNOWLEDGE_HISTORY', D08: 'SHORTAGE_PROCUREMENT',
    D09: 'CUSTOMER_HISTORY_ALL', D10: 'CURRENT_COST', D11: 'RECIPE_INVENTORY', D12: 'ORDER_KNOWLEDGE_FILES',
});

function text(value) { return String(value || ''); }
function includesAuthority(actual, expected) { return text(actual).toLowerCase().includes(text(expected).toLowerCase()); }
function resultTool(result, trace) { return result?.agentToolName || result?.toolName || trace?.name || null; }
function resultData(result) { return result?.data; }
function receiptComplete(result, required = false) {
    const receipt = result?.queryReceipt;
    if (!receipt) return !required;
    return receipt.truncated !== true && receipt.possiblyTruncated !== true
        && (receipt.returnedCount === undefined || receipt.totalCount === undefined
            || Number(receipt.returnedCount) === Number(receipt.totalCount));
}

const AUDITED_LEDGER_PREDICATES_BY_TOOL = Object.freeze({
    search_factory_knowledge: Object.freeze(['auxiliary_knowledge_retrieval']),
    search_coils: Object.freeze(['coil_directory_cost']),
    get_recipe_detail: Object.freeze(['current_cost']),
    compare_recipe_scenarios: Object.freeze(['scenario_cost', 'scenario_cost_difference']),
    compare_recipes: Object.freeze(['recipe_cost_difference']),
    preview_virtual_readiness: Object.freeze(['readiness_status', 'required_quantity', 'available_quantity', 'shortage_quantity', 'collection_completeness']),
    check_order_readiness: Object.freeze(['readiness_status', 'shortage_line_count', 'required_quantity', 'available_quantity', 'shortage_quantity', 'purchase_status', 'purchase_quantity', 'collection_completeness']),
    get_order_detail: Object.freeze(['order_status', 'order_customer_attribute', 'order_contract_number', 'order_snapshot_recipe', 'order_line_quantity', 'collection_completeness']),
    get_order_knowledge_package: Object.freeze(['order_status', 'order_snapshot_recipe', 'order_line_quantity', 'readiness_status', 'shortage_quantity', 'purchase_status', 'collection_completeness']),
    get_purchase_overview: Object.freeze(['purchase_status', 'purchase_quantity', 'purchase_quantity_ordered', 'purchase_quantity_received', 'purchase_quantity_stocked', 'purchase_pending_quantity', 'collection_completeness']),
    preview_profitability: Object.freeze(['gross_profit_per_unit', 'gross_margin_on_sales']),
});

// Explicit acceptance extractors are predicate-specific and inspect the actual
// returned payload.  Merely advertising a predicate in API Index never creates
// evidence for a particular execution.
const EXPLICIT_PAYLOAD_PREDICATES_BY_TOOL = Object.freeze({
    search_business_changes: Object.freeze(['business_change_event']),
    search_parts: Object.freeze(['part_identity', 'part_catalog_attribute']),
    get_coil_specs: Object.freeze(['coil_identity', 'coil_specification']),
    search_coils: Object.freeze(['coil_identity']),
    calculate_coil_cost: Object.freeze(['current_cost']),
    get_copper_price: Object.freeze(['copper_price']),
    get_factory_knowledge_detail: Object.freeze(['knowledge_record']),
    get_order_knowledge_package: Object.freeze(['source_file']),
    get_recent_orders: Object.freeze(['order_status', 'order_collection']),
    get_quotation_detail: Object.freeze(['quotation_status', 'quotation_amount', 'quotation_customer']),
    search_customer_history: Object.freeze(['customer_identity', 'quotation_history', 'order_history', 'collection_completeness']),
    search_customers: Object.freeze(['customer_identity', 'customer_collection']),
    search_quotations: Object.freeze(['quotation_status', 'quotation_collection']),
    explain_cost_change: Object.freeze(['recipe_cost_difference']),
    get_all_recipes: Object.freeze(['recipe_identity', 'recipe_collection']),
    get_recipe_detail: Object.freeze(['recipe_identity', 'recipe_bom', 'current_cost']),
    get_recipe_parts: Object.freeze(['recipe_bom', 'part_identity', 'coil_identity']),
    get_recipe_technical_files: Object.freeze(['recipe_identity', 'source_file']),
    get_recipe_technical_profile: Object.freeze(['recipe_technical_profile']),
    get_recipes_by_coil: Object.freeze(['recipe_collection', 'coil_identity']),
    get_recipes_by_part: Object.freeze(['recipe_collection', 'part_identity']),
    get_template_detail: Object.freeze(['template_detail']),
    search_templates: Object.freeze(['template_collection']),
    preview_profitability: Object.freeze(['current_cost']),
});

function rows(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return null;
    for (const key of ['data', 'items', 'rows', 'results', 'orders', 'quotations', 'customers', 'recipes', 'parts', 'coils', 'templates', 'events']) {
        if (Array.isArray(value[key])) return value[key];
    }
    return null;
}
function hasIdentity(value) {
    return Boolean(value && typeof value === 'object'
        && Number.isSafeInteger(Number(value.id ?? value.Id)) && Number(value.id ?? value.Id) > 0
        && text(value.name ?? value.model ?? value.schemeCode ?? value.recipeName ?? value.orderNo));
}
function hasPositiveId(value) {
    return Boolean(value && typeof value === 'object'
        && Number.isSafeInteger(Number(value.id ?? value.Id)) && Number(value.id ?? value.Id) > 0);
}
function payloadFactState(tool, predicate, result) {
    const data = resultData(result);
    if (data === null || data === undefined) return null;
    if (tool === 'get_recipe_detail' && predicate === 'current_cost') {
        const current = data.currentCost;
        return current?.costComplete === true && Number.isFinite(Number(current.currentTotalCost)) && hasIdentity(data.recipe)
            ? { complete: true, entityPresent: true, qualifiers: { moneyRole: 'CURRENT_FORMAL' } } : null;
    }
    if (tool === 'preview_profitability' && predicate === 'current_cost') {
        return data.costComplete === true && Number.isFinite(Number(data.unitCost)) && hasIdentity(data.recipe)
            ? { complete: true, entityPresent: true, qualifiers: { moneyRole: 'CURRENT_FORMAL' } } : null;
    }
    if (tool === 'calculate_coil_cost' && predicate === 'current_cost') {
        return Number.isFinite(Number(data.totalCost)) && hasIdentity(data.coil || data)
            ? { complete: true, entityPresent: true, qualifiers: { moneyRole: 'CURRENT_FORMAL' } } : null;
    }
    if (tool === 'get_order_knowledge_package' && predicate === 'source_file') {
        const files = data.sourceFiles;
        const count = Number(data.coverage?.sourceFileCount);
        return Array.isArray(files) && Number.isFinite(count) && count === files.length && hasPositiveId(data.order)
            ? { complete: true, entityPresent: true, qualifiers: { collectionRef: 'order_source_files' } } : null;
    }
    if (tool === 'search_customer_history' && (predicate === 'quotation_history' || predicate === 'order_history')) {
        const rows = predicate === 'quotation_history' ? data.quotations : data.orders;
        const filters = result.queryReceipt?.appliedFilters || {};
        const all = filters.historyType === 'all';
        return all && Array.isArray(rows) && filters.limit == null && receiptComplete(result, true) && hasIdentity(data.customer)
            ? { complete: true, entityPresent: true } : null;
    }
    if (tool === 'search_customer_history' && predicate === 'customer_identity') {
        return hasIdentity(data.customer) ? { complete: true, entityPresent: true } : null;
    }
    if (tool === 'search_customer_history' && predicate === 'collection_completeness') {
        const filters = result.queryReceipt?.appliedFilters || {};
        return filters.historyType === 'all' && filters.limit == null && receiptComplete(result, true)
            && hasIdentity(data.customer) && Array.isArray(data.quotations) && Array.isArray(data.orders)
            ? { complete: true, entityPresent: true } : null;
    }
    if (['readiness_status', 'required_quantity', 'available_quantity', 'shortage_quantity'].includes(predicate)
        && tool === 'preview_virtual_readiness') {
        return data.coverage?.complete === true && Number.isFinite(Number(data.quantity))
            ? { complete: true, entityPresent: true } : null;
    }
    if (predicate === 'collection_completeness' && tool === 'preview_virtual_readiness') {
        return data.coverage?.complete === true ? { complete: true, entityPresent: true } : null;
    }
    const list = rows(data);
    if (predicate.endsWith('_collection')) return Array.isArray(list) && receiptComplete(result)
        ? { complete: true, entityPresent: true } : null;
    if (predicate.endsWith('_identity')) return (hasIdentity(data) || (Array.isArray(list) && list.some(hasIdentity)))
        ? { complete: receiptComplete(result), entityPresent: true } : null;
    const predicateFields = {
        business_change_event: ['eventType', 'changeType', 'action'], part_catalog_attribute: ['model', 'category', 'stock'],
        coil_specification: ['schemeCode', 'schemeName', 'material'], copper_price: ['price', 'copperPrice', 'unitPrice'],
        knowledge_record: ['title', 'content', 'text'], order_status: ['status'], quotation_status: ['status'],
        quotation_amount: ['amount', 'totalAmount', 'unitPrice'], quotation_customer: ['customer', 'customerName'],
        recipe_bom: ['parts', 'bom', 'items'], recipe_technical_profile: ['technicalProfile', 'profile'],
        template_detail: ['shellModel', 'description'], source_file: ['sourceFiles', 'files'],
        recipe_cost_difference: ['costDiff', 'costDifference', 'totalDiff'],
    };
    const fields = predicateFields[predicate] || [];
    const objects = [data, ...(Array.isArray(list) ? list : [])].filter(value => value && typeof value === 'object');
    return objects.some(value => fields.some(field => value[field] !== undefined && value[field] !== null))
        ? { complete: receiptComplete(result), entityPresent: objects.some(hasIdentity) } : null;
}

function evidenceProducerFor(toolName, predicate) {
    if ((AUDITED_LEDGER_PREDICATES_BY_TOOL[toolName] || []).includes(predicate)) return 'FACT_LEDGER';
    if ((EXPLICIT_PAYLOAD_PREDICATES_BY_TOOL[toolName] || []).includes(predicate)) return 'PREDICATE_SPECIFIC_PAYLOAD_EXTRACTOR';
    return null;
}

function collectFormalEvidence(candidate = {}) {
    const evidence = [];
    const traces = candidate.traces || [];
    for (const fact of candidate.factLedger?.facts || []) {
        if (fact?.verified !== true || !fact?.predicate) continue;
        const entry = getApiIndexEntry(fact.source?.tool);
        const authority = entry?.semanticBoundary?.factAuthorities?.[fact.predicate]
            || entry?.semanticBoundary?.sourceOfTruth || fact.authority || null;
        const complete = fact.predicate === 'collection_completeness' ? fact.value === 'COMPLETE'
            : fact.predicate === 'current_cost' ? fact.qualifiers?.costComplete === true
                : fact.predicate === 'readiness_status' ? fact.qualifiers?.coverageComplete === true
                    : true;
        evidence.push(Object.freeze({ predicate: fact.predicate, authority, toolName: fact.source?.tool || null,
            complete,
            entityPresent: Boolean(fact.entity), entityKey: fact.entity ? `${fact.entity.type}:${fact.entity.id}` : null,
            value: fact.value, qualifiers: Object.freeze({ ...(fact.qualifiers || {}) }), factId: fact.factId || null, source: 'FACT_LEDGER' }));
    }
    (candidate.toolResults || []).forEach((result, index) => {
        if (result?.success !== true || result?.verified !== true) return;
        const toolName = resultTool(result, traces[index]); const entry = getApiIndexEntry(toolName);
        if (!entry?.semanticBoundary) return;
        for (const predicate of EXPLICIT_PAYLOAD_PREDICATES_BY_TOOL[toolName] || []) {
            if (!entry.semanticBoundary.formalFactsProduced.includes(predicate)) continue;
            const state = payloadFactState(toolName, predicate, result);
            if (!state) continue;
            evidence.push(Object.freeze({ predicate, authority: entry.semanticBoundary.factAuthorities[predicate], toolName,
                complete: state.complete, entityPresent: state.entityPresent, entityKey: null, value: null,
                qualifiers: Object.freeze({ ...(state.qualifiers || {}) }), factId: null, source: 'VERIFIED_FORMAL_RESULT' }));
        }
    });
    return Object.freeze(evidence);
}

const PROFILE_REQUIRED_ENTITY_TYPE = Object.freeze({ CURRENT_COST: 'recipe', CUSTOMER_HISTORY_ALL: 'customer', RECIPE_INVENTORY: 'recipe' });
function safeIdentityBlock(candidate = {}, profile) {
    const goal = candidate.answerValidation?.goals?.find(item => item?.questionIndex === 0);
    const requiredType = PROFILE_REQUIRED_ENTITY_TYPE[profile];
    if (goal?.status !== 'CLARIFICATION' || !requiredType) return false;
    const cited = new Set(goal.factIds || []);
    return (candidate.factLedger?.facts || []).some(fact => fact?.verified === true
        && ['identity_not_found', 'identity_ambiguous'].includes(fact.predicate)
        && text(fact.value).toLowerCase() === requiredType && fact.factId && cited.has(fact.factId)
        && ['resolve_entity', 'resolve_page_context_entity'].includes(fact.source?.tool));
}

function scoreRequiredFactCoverage(requirements, candidate) {
    const evidence = collectFormalEvidence(candidate);
    const checks = requirements.map(requirement => {
        const matches = evidence.filter(item => requirement.anyOf.includes(item.predicate)
            && (!requirement.authorityIncludes || includesAuthority(item.authority, requirement.authorityIncludes))
            && (!requirement.complete || item.complete === true)
            && (!requirement.entityRequired || item.entityPresent === true)
            && (!requirement.collectionRef || item.qualifiers?.collectionRef === requirement.collectionRef)
            && (!requirement.allowedMoneyRoles || requirement.allowedMoneyRoles.includes(item.qualifiers?.moneyRole)));
        return Object.freeze({ requirement, satisfied: matches.length > 0,
            evidence: Object.freeze(matches.map(item => ({ predicate: item.predicate, authority: item.authority, toolName: item.toolName, source: item.source, factId: item.factId }))) });
    });
    return Object.freeze({ complete: checks.every(item => item.satisfied), checks: Object.freeze(checks), evidenceCount: evidence.length });
}

function scoreShortageProcurementCoverage(requirements, candidate) {
    const base = scoreRequiredFactCoverage(requirements, candidate);
    const evidence = collectFormalEvidence(candidate);
    const shortages = evidence.filter(item => item.predicate === 'shortage_quantity' && item.entityKey
        && includesAuthority(item.authority, 'order') && item.qualifiers?.scopeKey);
    const bound = shortages.find(shortage => {
        const procurement = evidence.some(item => ['purchase_status', 'purchase_quantity'].includes(item.predicate)
            && item.entityKey === shortage.entityKey && item.qualifiers?.scopeKey === shortage.qualifiers.scopeKey
            && includesAuthority(item.authority, 'purchase'));
        const complete = evidence.some(item => item.predicate === 'collection_completeness' && item.complete === true
            && item.qualifiers?.collectionRef === 'order_shortages'
            && item.qualifiers?.scopeKey === shortage.qualifiers.scopeKey);
        return procurement && complete;
    });
    return Object.freeze({ ...base, complete: Boolean(bound), sameScopeEntityBound: Boolean(bound) });
}

function scoreDomainSemanticCoverage(testCase, candidate = {}) {
    const profile = DOMAIN_SEMANTIC_REQUIREMENTS_V2[testCase.id];
    if (!profile || !FACT_REQUIREMENT_PROFILES[profile]) throw new Error(`DOMAIN_SEMANTIC_ORACLE_V2_UNKNOWN_CASE:${testCase.id}`);
    const exactDomainDiagnostic = scoreDomainSelection(testCase, candidate.relevantApiCoverage?.selectedBusinessDomains || []);
    const requiredFactCoverage = profile === 'SHORTAGE_PROCUREMENT'
        ? scoreShortageProcurementCoverage(FACT_REQUIREMENT_PROFILES[profile], candidate)
        : scoreRequiredFactCoverage(FACT_REQUIREMENT_PROFILES[profile], candidate);
    const identityBlocked = safeIdentityBlock(candidate, profile);
    const semanticPass = requiredFactCoverage.complete || identityBlocked;
    return Object.freeze({ version: 'DOMAIN_REQUIRED_FACT_AUTHORITY_V2', profile, semanticPass,
        classification: requiredFactCoverage.complete ? 'FORMAL_REQUIRED_FACTS_COMPLETE'
            : identityBlocked ? 'SAFE_IDENTITY_CLARIFICATION' : 'TRUE_PRODUCT_DOMAIN_MISS',
        exactDomainDiagnostic, requiredFactCoverage,
        extraDomainLabels: exactDomainDiagnostic.extraDomains,
        missingExpectedLabels: exactDomainDiagnostic.missingDomains,
    });
}

module.exports = { AUDITED_LEDGER_PREDICATES_BY_TOOL, DOMAIN_SEMANTIC_REQUIREMENTS_V2,
    EXPLICIT_PAYLOAD_PREDICATES_BY_TOOL, FACT_REQUIREMENT_PROFILES, collectFormalEvidence,
    evidenceProducerFor, payloadFactState, safeIdentityBlock, scoreDomainSemanticCoverage,
    scoreRequiredFactCoverage, scoreShortageProcurementCoverage };
