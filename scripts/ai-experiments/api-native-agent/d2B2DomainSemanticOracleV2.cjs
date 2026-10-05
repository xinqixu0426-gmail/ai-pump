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
    CURRENT_COST: Object.freeze([{ anyOf: ['current_cost'], authorityIncludes: 'costEngine', complete: true, entityRequired: true }]),
    COIL_SCHEMES: Object.freeze([{ anyOf: ['coil_identity', 'coil_specification'] }]),
    QUOTATION_COLLECTION: Object.freeze([{ anyOf: ['quotation_status', 'quotation_collection'] }]),
    KNOWLEDGE_HISTORY: Object.freeze([{ anyOf: ['auxiliary_knowledge_retrieval', 'knowledge_record'] }]),
    SHORTAGE_PROCUREMENT: Object.freeze([
        { anyOf: ['shortage_quantity'], authorityIncludes: 'order' },
        { anyOf: ['purchase_status', 'purchase_quantity'], authorityIncludes: 'purchase' },
        { anyOf: ['collection_completeness'], authorityIncludes: 'order', complete: true },
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
function receiptComplete(result) {
    const receipt = result?.queryReceipt;
    if (!receipt) return true;
    return receipt.truncated !== true && receipt.possiblyTruncated !== true
        && (receipt.returnedCount === undefined || receipt.totalCount === undefined
            || Number(receipt.returnedCount) === Number(receipt.totalCount));
}
function payloadFactState(tool, predicate, result) {
    const data = resultData(result);
    if (data === null || data === undefined) return null;
    if (predicate === 'current_cost') {
        const current = data.currentCost || data;
        return current?.costComplete === true && Number.isFinite(Number(current.currentTotalCost))
            ? { complete: true, entityPresent: true } : null;
    }
    if (predicate === 'source_file') {
        const files = data.sourceFiles;
        const count = Number(data.coverage?.sourceFileCount);
        return Array.isArray(files) && Number.isFinite(count) && count === files.length
            ? { complete: true, entityPresent: true } : null;
    }
    if (predicate === 'quotation_history' || predicate === 'order_history') {
        const rows = predicate === 'quotation_history' ? data.quotations : data.orders;
        const all = data.query?.historyType === 'all';
        return all && Array.isArray(rows) && data.query?.limit == null && receiptComplete(result)
            ? { complete: true, entityPresent: Boolean(data.customer) } : null;
    }
    if (['readiness_status', 'required_quantity', 'available_quantity', 'shortage_quantity'].includes(predicate)
        && tool === 'preview_virtual_readiness') {
        return data.coverage?.complete === true && Number.isFinite(Number(data.quantity))
            ? { complete: true, entityPresent: true } : null;
    }
    if (predicate === 'collection_completeness' && tool === 'preview_virtual_readiness') {
        return data.coverage?.complete === true ? { complete: true, entityPresent: true } : null;
    }
    if (predicate === 'collection_completeness') return { complete: receiptComplete(result), entityPresent: true };
    return { complete: receiptComplete(result), entityPresent: true };
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
            entityPresent: Boolean(fact.entity), factId: fact.factId || null, source: 'FACT_LEDGER' }));
    }
    (candidate.toolResults || []).forEach((result, index) => {
        if (result?.success !== true || result?.verified !== true) return;
        const toolName = resultTool(result, traces[index]); const entry = getApiIndexEntry(toolName);
        if (!entry?.semanticBoundary) return;
        for (const predicate of entry.semanticBoundary.formalFactsProduced) {
            const state = payloadFactState(toolName, predicate, result);
            if (!state) continue;
            evidence.push(Object.freeze({ predicate, authority: entry.semanticBoundary.factAuthorities[predicate], toolName,
                complete: state.complete, entityPresent: state.entityPresent, factId: null, source: 'VERIFIED_FORMAL_RESULT' }));
        }
    });
    return Object.freeze(evidence);
}

function safeIdentityBlock(candidate = {}) {
    const status = candidate.answerValidation?.goals?.[0]?.status;
    if (status !== 'CLARIFICATION') return false;
    return (candidate.factLedger?.facts || []).some(fact => fact?.verified === true
        && ['identity_not_found', 'identity_ambiguous'].includes(fact.predicate));
}

function scoreRequiredFactCoverage(requirements, candidate) {
    const evidence = collectFormalEvidence(candidate);
    const checks = requirements.map(requirement => {
        const matches = evidence.filter(item => requirement.anyOf.includes(item.predicate)
            && (!requirement.authorityIncludes || includesAuthority(item.authority, requirement.authorityIncludes))
            && (!requirement.complete || item.complete === true)
            && (!requirement.entityRequired || item.entityPresent === true));
        return Object.freeze({ requirement, satisfied: matches.length > 0,
            evidence: Object.freeze(matches.map(item => ({ predicate: item.predicate, authority: item.authority, toolName: item.toolName, source: item.source, factId: item.factId }))) });
    });
    return Object.freeze({ complete: checks.every(item => item.satisfied), checks: Object.freeze(checks), evidenceCount: evidence.length });
}

function scoreDomainSemanticCoverage(testCase, candidate = {}) {
    const profile = DOMAIN_SEMANTIC_REQUIREMENTS_V2[testCase.id];
    if (!profile || !FACT_REQUIREMENT_PROFILES[profile]) throw new Error(`DOMAIN_SEMANTIC_ORACLE_V2_UNKNOWN_CASE:${testCase.id}`);
    const exactDomainDiagnostic = scoreDomainSelection(testCase, candidate.relevantApiCoverage?.selectedBusinessDomains || []);
    const requiredFactCoverage = scoreRequiredFactCoverage(FACT_REQUIREMENT_PROFILES[profile], candidate);
    const identityBlocked = safeIdentityBlock(candidate);
    const semanticPass = requiredFactCoverage.complete || identityBlocked;
    return Object.freeze({ version: 'DOMAIN_REQUIRED_FACT_AUTHORITY_V2', profile, semanticPass,
        classification: requiredFactCoverage.complete ? 'FORMAL_REQUIRED_FACTS_COMPLETE'
            : identityBlocked ? 'SAFE_IDENTITY_CLARIFICATION' : 'TRUE_PRODUCT_DOMAIN_MISS',
        exactDomainDiagnostic, requiredFactCoverage,
        extraDomainLabels: exactDomainDiagnostic.extraDomains,
        missingExpectedLabels: exactDomainDiagnostic.missingDomains,
    });
}

module.exports = { DOMAIN_SEMANTIC_REQUIREMENTS_V2, FACT_REQUIREMENT_PROFILES, collectFormalEvidence,
    scoreDomainSemanticCoverage, scoreRequiredFactCoverage };
