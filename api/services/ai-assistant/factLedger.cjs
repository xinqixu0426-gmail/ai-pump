'use strict';

// A request-scoped, append-only projection of verified formal observations.
// It is deliberately not a business table and never promotes user context,
// page context, or a failed technical call into a formal fact.

const SENSITIVE_KEYS = new Set([
    'confirmationToken', 'operationId', 'idempotencyKey', 'argsHash', 'proposalHash', 'executionEvidence', 'apiTrace',
]);
const MAX_MODEL_PROJECTION_BYTES = 16 * 1024;
const MAX_MODEL_PROJECTION_ARRAY_ITEMS = 100;
const MAX_MODEL_PROJECTION_OBJECT_FIELDS = 24;
const MAX_MODEL_PROJECTION_DEPTH = 4;

function finite(value) {
    if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function text(value) {
    const normalized = String(value || '').trim();
    return normalized || null;
}

function entityFromBindings(args = {}, bindings) {
    if (!(bindings instanceof Map)) return null;
    for (const [key, value] of bindings.entries()) {
        const [type, rawId] = String(key).split(':');
        const id = Number(rawId);
        if (!Number.isSafeInteger(id) || id < 1 || !value?.verified) continue;
        const fields = [`${type}Id`, 'entityId', 'canonicalId'];
        if (fields.some(field => Number(args?.[field]) === id)
            || (type === 'recipe' && Number(args?.basisRef?.recipeId) === id)) {
            return { type, id, canonicalName: text(value.canonicalName) };
        }
    }
    return null;
}

function entityFromResolution(data) {
    if (!data || data.status !== 'RESOLVED' || data.verified !== true) return null;
    const id = Number(data.canonicalId);
    const type = text(data.entityType);
    if (!type || !Number.isSafeInteger(id) || id < 1) return null;
    return { type, id, canonicalName: text(data.canonicalName) };
}

function makeFact({ entity = null, predicate, value, unit = null, basis = null, capabilityId = null, tool, qualifiers = null }) {
    return {
        entity: entity && entity.type && Number.isSafeInteger(Number(entity.id))
            ? { type: entity.type, id: Number(entity.id), canonicalName: entity.canonicalName || null }
            : null,
        predicate,
        value,
        unit,
        basis,
        authority: 'FORMAL_API',
        capabilityId: capabilityId || null,
        verified: true,
        source: { tool },
        ...(qualifiers ? { qualifiers } : {}),
    };
}

function scalarFacts(data, base) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
    const entity = base.entity;
    const tool = base.tool;
    const capabilityId = base.capabilityId;
    const basis = text(data.costBasis) || text(data.inventoryBasis) || text(data.basis) || null;
    const facts = [];
    const addNumber = (field, predicate, unit, factBasis = basis, qualifiers = null) => {
        const value = finite(data[field]);
        if (value !== null) facts.push(makeFact({ entity, predicate, value, unit, basis: factBasis, capabilityId, tool, qualifiers }));
    };
    addNumber('currentTotalCost', 'current_cost', 'CNY', basis, { moneyRole: 'CURRENT_FORMAL' });
    addNumber('unitCost', 'unit_cost', 'CNY');
    // The formal coil preview route returns `totalCost` as its authoritative
    // calculation result.  Make that tool contract explicit rather than
    // treating every arbitrary totalCost field as a current-cost fact.
    addNumber('totalCost', 'total_cost', 'CNY',
        tool === 'calculate_coil_cost' ? (basis || 'FORMAL_COIL_COST_CALCULATION') : basis,
        tool === 'calculate_coil_cost' ? { moneyRole: 'CURRENT_FORMAL', pricingMode: text(data.pricingMode) } : null);
    addNumber('unitPrice', 'unit_price', 'CNY');
    addNumber('grossProfitPerUnit', 'gross_profit_per_unit', 'CNY');
    addNumber('grossMarginOnSales', 'gross_margin_on_sales', 'PERCENT');
    addNumber('markupOnCost', 'markup_on_cost', 'PERCENT');
    addNumber('currentStock', 'current_stock', 'COUNT');
    addNumber('nextStock', 'next_stock', 'COUNT');
    addNumber('delta', 'stock_delta', 'COUNT');
    addNumber('quantity', 'inventory_quantity', 'COUNT');
    addNumber('stock', 'inventory_quantity', 'COUNT');
    addNumber('costDifference', 'cost_difference', 'CNY');
    if (text(data.status)) facts.push(makeFact({ entity, predicate: 'status', value: text(data.status), unit: null, basis, capabilityId, tool }));
    return facts;
}

// The formal compare_recipes result is directional: recipe2 minus recipe1.
// This only projects the returned difference and its formal pair; it never
// derives a new amount from the two absolute costs.
function recipeComparisonFacts(data, base) {
    if (!data || typeof data !== 'object') return [];
    const value = finite(data.costDiff ?? data.costDifference ?? data.totalDiff);
    const left = data.left || data.recipe1 || {};
    const right = data.right || data.recipe2 || {};
    const leftName = text(left.name || left.recipeName);
    const rightName = text(right.name || right.recipeName);
    if (value === null || !leftName || !rightName) return [];
    return [makeFact({ entity: null, predicate: 'recipe_cost_difference', value, unit: text(data.currency) || 'CNY',
        basis: text(data.costBasis) || null, capabilityId: base.capabilityId, tool: base.tool,
        qualifiers: { moneyRole: 'RECIPE_DIFFERENCE', participants: { left: { canonicalName: leftName }, right: { canonicalName: rightName } }, direction: 'RIGHT_MINUS_LEFT' } })];
}

// Scenario comparison is a formal multi-basis result.  Preserve its compact
// scalar evidence before generic traversal reaches verbose read-set metadata;
// this performs no cost calculation and only projects values the formal API
// already returned with their scenario and basis bindings intact.
function scenarioComparisonFacts(data, base) {
    if (!data || typeof data !== 'object' || !Array.isArray(data.scenarios)) return [];
    const facts = [];
    for (const scenario of data.scenarios) {
        const cost = scenario?.cost;
        const value = finite(cost?.currentTotalCost);
        if (value === null) continue;
        const role = text(scenario?.role);
        // A formally rejected/no-op candidate must never become a claimable
        // scenario amount just because the transport returned a base-shaped
        // cost object.
        if (role !== 'BASE' && Array.isArray(scenario?.notApplied) && scenario.notApplied.length > 0) continue;
        facts.push(makeFact({ entity: base.entity, predicate: 'scenario_cost', value, unit: text(cost?.currency) || 'CNY',
            basis: text(cost?.costBasis) || null, capabilityId: base.capabilityId, tool: base.tool,
            qualifiers: { moneyRole: role === 'BASE' ? 'CURRENT_BASE' : 'SCENARIO_CANDIDATE', scenarioKey: text(scenario?.scenarioKey), role, label: text(scenario?.label) } }));
    }
    for (const comparison of Array.isArray(data.comparisons) ? data.comparisons : []) {
        const value = finite(comparison?.delta);
        if (value === null || text(comparison?.status) !== 'COMPARABLE') continue;
        facts.push(makeFact({ entity: base.entity, predicate: 'scenario_cost_difference', value, unit: text(comparison?.currency) || 'CNY',
            basis: 'SCENARIO_COMPARISON', capabilityId: base.capabilityId, tool: base.tool,
            qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE', baseScenarioKey: text(comparison?.baseScenarioKey), candidateScenarioKey: text(comparison?.candidateScenarioKey), status: text(comparison?.status) } }));
    }
    return facts;
}

// search_coils is a formal directory query.  Its record-level `cost` is the
// registered cost for that exact coil scheme, not an invitation to re-run a
// formula in the ledger.  Keep the source contract narrow: only the explicit
// `cost` field is a directory cost, while unitPrice/kitPrice remain pricing
// parameters and must not be promoted to a full current-cost assertion.
function coilDirectoryCostFacts(data, base) {
    if (base.tool !== 'search_coils' || !data || typeof data !== 'object') return [];
    // Generic Brokered search_coils projects the formal list directly as an
    // array; the raw Executor wraps the same records in { data }.  Both are
    // canonical read-path shapes and must retain identical per-record facts.
    const rows = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : [];
    const facts = [];
    for (const row of rows) {
        const id = Number(row?.id ?? row?.Id);
        const schemeCode = text(row?.schemeCode);
        const schemeName = text(row?.schemeName);
        const value = finite(row?.cost);
        if (!Number.isSafeInteger(id) || id < 1 || !schemeCode || value === null) continue;
        facts.push(makeFact({
            entity: { type: 'coil', id, canonicalName: schemeCode },
            predicate: 'coil_directory_cost', value, unit: 'CNY',
            basis: 'FORMAL_COIL_DIRECTORY_COST', capabilityId: base.capabilityId, tool: base.tool,
            qualifiers: {
                moneyRole: 'CURRENT_FORMAL',
                pricingMode: text(row?.pricingMode),
                costField: 'cost',
                ...(schemeName ? { schemeName } : {}),
            },
        }));
    }
    return facts;
}

function genericFormalFacts(data, base, limit = 80) {
    const facts = [];
    const visit = (value, path, depth) => {
        if (facts.length >= limit || depth > 4 || value === null || value === undefined) return;
        if (Array.isArray(value)) {
            value.slice(0, 30).forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
            return;
        }
        if (typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) {
                if (SENSITIVE_KEYS.has(key)) continue;
                visit(child, path ? `${path}.${key}` : key, depth + 1);
            }
            return;
        }
        if (!['string', 'number', 'boolean'].includes(typeof value)) return;
        const field = path.split('.').at(-1).replace(/\[\d+\]/g, '');
        const unit = /(?:cost|price|amount|total|profit|fee)/i.test(field) ? 'CNY'
            : /(?:margin|markup|rate|percent)/i.test(field) ? 'PERCENT'
                : /(?:stock|quantity|qty|count)/i.test(field) ? 'COUNT' : null;
        facts.push(makeFact({ entity: base.entity, predicate: `formal_field:${path}`, value, unit,
            basis: base.basis, capabilityId: base.capabilityId, tool: base.tool }));
    };
    visit(data, '', 0);
    return facts;
}

function createFactLedger(options = {}) {
    const includeScenarioComparisonFacts = options.includeScenarioComparisonFacts === true;
    const includeRecipeComparisonFacts = options.includeRecipeComparisonFacts === true;
    const includeCoilDirectoryCostFacts = options.includeCoilDirectoryCostFacts === true;
    const facts = [];
    const observations = [];
    let sequence = 0;
    const append = raw => {
        const fact = { factId: `F-${String(++sequence).padStart(3, '0')}`, ...raw };
        facts.push(Object.freeze(fact));
        return fact;
    };
    return Object.freeze({
        appendToolResult({ toolName, args, result, entityBindings } = {}) {
            const tool = text(toolName) || text(result?.agentToolName) || 'unknown_tool';
            const added = [];
            const data = result?.data;
            const capabilityId = text(result?.capabilityId);
            if (tool === 'resolve_entity' || tool === 'resolve_page_context_entity') {
                const resolved = entityFromResolution(data);
                if (resolved) added.push(append(makeFact({ entity: resolved, predicate: 'identity_resolved', value: resolved.canonicalName, capabilityId, tool })));
                if (['AMBIGUOUS', 'NOT_FOUND'].includes(data?.status) && ['formal', 'page_context_candidate'].includes(data?.source)) {
                    added.push(append(makeFact({ entity: null, predicate: data.status === 'AMBIGUOUS' ? 'identity_ambiguous' : 'identity_not_found', value: text(data.entityType) || 'unknown', capabilityId, tool, qualifiers: { mention: text(data.mention), candidateCount: Array.isArray(data.candidates) ? data.candidates.length : 0 } })));
                }
            } else if (result?.success === true && result?.verified === true) {
                const entity = entityFromBindings(args, entityBindings);
                // Every verified formal call receives a neutral provenance fact,
                // even when its result is a domain-specific list not yet mapped
                // to scalar predicates.  This keeps answer claims traceable
                // without copying business algorithms into the adapter.
                added.push(append(makeFact({ entity, predicate: 'formal_result_available', value: true, capabilityId, tool })));
                for (const fact of scalarFacts(data, { entity, tool, capabilityId })) added.push(append(fact));
                if (includeRecipeComparisonFacts) {
                    for (const fact of recipeComparisonFacts(data, { entity, tool, capabilityId })) added.push(append(fact));
                }
                if (includeScenarioComparisonFacts) {
                    for (const fact of scenarioComparisonFacts(data, { entity, tool, capabilityId })) added.push(append(fact));
                }
                if (includeCoilDirectoryCostFacts) {
                    for (const fact of coilDirectoryCostFacts(data, { entity, tool, capabilityId })) added.push(append(fact));
                }
                for (const fact of genericFormalFacts(data, { entity, tool, capabilityId })) added.push(append(fact));
                if (Array.isArray(data) && data.length === 0) {
                    added.push(append(makeFact({ entity, predicate: 'query_no_results', value: true, capabilityId, tool })));
                }
            }
            observations.push(Object.freeze({ tool, success: result?.success === true, verified: result?.verified === true, factIds: added.map(fact => fact.factId),
                ...(result?.success === false ? { technicalFailure: true, code: text(result?.code) || 'FORMAL_TOOL_FAILED' } : {}) }));
            return Object.freeze({ factIds: Object.freeze(added.map(fact => fact.factId)), facts: Object.freeze(added) });
        },
        snapshot() {
            return Object.freeze({ facts: Object.freeze([...facts]), observations: Object.freeze([...observations]) });
        },
        facts() { return Object.freeze([...facts]); },
    });
}

function modelProjection(result, factIds) {
    const budget = { remaining: MAX_MODEL_PROJECTION_BYTES };
    const collections = [];
    let truncated = false;
    let truncationCount = 0;
    const markTruncated = () => { truncated = true; truncationCount += 1; };
    const consume = value => {
        const source = Buffer.from(String(value), 'utf8');
        const accepted = source.subarray(0, Math.max(0, budget.remaining));
        budget.remaining -= accepted.length;
        return accepted.toString('utf8');
    };
    const project = (value, depth = 0, path = '$') => {
        if (value === null || value === undefined) return value;
        if (typeof value === 'string') { const projected = consume(value); if (projected !== value) markTruncated(); return projected; }
        if (typeof value === 'number' || typeof value === 'boolean') { consume(String(value)); return value; }
        if (depth >= MAX_MODEL_PROJECTION_DEPTH || budget.remaining <= 0) { markTruncated(); return '[内容已截断]'; }
        if (Array.isArray(value)) {
            const output = [];
            const priorTruncations = truncationCount;
            for (let index = 0; index < value.length && index < MAX_MODEL_PROJECTION_ARRAY_ITEMS && budget.remaining > 0; index += 1) {
                output.push(project(value[index], depth + 1, `${path}[${index}]`));
            }
            if (output.length < value.length) markTruncated();
            collections.push({ path, totalCount: value.length, returnedCount: output.length,
                hasMore: output.length < value.length || truncationCount > priorTruncations,
                complete: output.length === value.length && truncationCount === priorTruncations });
            return output;
        }
        if (typeof value !== 'object') return consume(String(value));
        const output = {};
        for (const [key, child] of Object.entries(value)) {
            if (SENSITIVE_KEYS.has(key)) continue;
            if (Object.keys(output).length >= MAX_MODEL_PROJECTION_OBJECT_FIELDS || budget.remaining <= 0) { markTruncated(); continue; }
            output[consume(key)] = project(child, depth + 1, `${path}.${key}`);
        }
        for (const collection of collections.filter(item => item.path.startsWith(`${path}.`) && !item.path.slice(path.length + 1).includes('.'))) {
            const reportedTotal = Number(value.totalCount);
            if (value.totalCount !== null && value.totalCount !== undefined && Number.isSafeInteger(reportedTotal) && reportedTotal >= collection.totalCount) {
                collection.totalCount = reportedTotal;
            }
            if (value.complete === false || value.hasMore === true || collection.returnedCount < collection.totalCount) {
                collection.complete = false;
                collection.hasMore = true;
            }
            const cursor = value.nextCursor ?? value.cursor;
            if (typeof cursor === 'string' && cursor.length <= 500) collection.cursor = cursor;
        }
        if (collections.some(item => item.path.startsWith(`${path}.`) && !item.complete)) {
            if (output.complete === true) output.complete = false;
            if (output.hasMore === false) output.hasMore = true;
        }
        return output;
    };
    const projected = project(result);
    return { ...projected, factRefs: Array.isArray(factIds) ? factIds.slice(0, 96) : [],
        projection: { truncated, collections } };
}

module.exports = { MAX_MODEL_PROJECTION_BYTES, coilDirectoryCostFacts, createFactLedger, modelProjection, recipeComparisonFacts, scenarioComparisonFacts };
