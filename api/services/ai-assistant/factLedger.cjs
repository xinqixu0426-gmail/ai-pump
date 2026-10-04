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

// get_recipe_detail returns current cost inside its formal detail envelope.
// Candidate finalization needs the same structured money semantics as other
// current-cost paths; this projects the API value only when the API confirms
// the amount is complete.  It never promotes a partial amount or recalculates
// any cost.
function recipeDetailCurrentCostFacts(data, base) {
    if (base.tool !== 'get_recipe_detail' || !data || typeof data !== 'object') return [];
    const current = data.currentCost;
    const value = finite(current?.currentTotalCost);
    if (current?.costComplete !== true || value === null || !base.entity) return [];
    // A legacy/formally-redacted identity lookup can verify the canonical ID
    // without returning its display label.  The detail response is itself a
    // verified formal record, so hydrate only this exact bound recipe with
    // its own canonical name after checking the IDs agree.  This is a
    // provenance repair, not a name inference or a cross-record binding.
    const detailId = Number(data.recipe?.id ?? data.recipeId);
    const detailName = text(data.recipe?.name ?? data.recipeName);
    const entity = Number.isSafeInteger(detailId) && detailId === Number(base.entity.id) && detailName
        ? { ...base.entity, canonicalName: detailName }
        : base.entity;
    return [makeFact({ entity, predicate: 'current_cost', value, unit: 'CNY',
        basis: text(current.costBasis) || null, capabilityId: base.capabilityId, tool: base.tool,
        qualifiers: { moneyRole: 'CURRENT_FORMAL', costComplete: true, sourcePath: 'currentCost.currentTotalCost' } })];
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
    // search_coils is a complete, non-paginated formal directory query in the
    // current executor contract.  Retain its returned set size separately so
    // a count answer is grounded even when the Broker projects only the list.
    facts.push(makeFact({ entity: null, predicate: 'coil_directory_count', value: rows.length, unit: 'COUNT',
        basis: 'FORMAL_SEARCH_COILS_COMPLETE_RESULT', capabilityId: base.capabilityId, tool: base.tool,
        qualifiers: { resultCompleteness: 'COMPLETE_SINGLE_RESPONSE' } }));
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

function positiveId(value) {
    const id = Number(value);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function materialEntity(row = {}) {
    const resourceType = String(row.resourceType || row.inventoryType || '').toUpperCase();
    const coilId = positiveId(row.coilId);
    const partId = positiveId(row.partId);
    if ((resourceType === 'COIL' || resourceType === 'COILS' || row.inventoryType === 'coil') && coilId) {
        const canonicalName = text(row.schemeCode) || text(row.model) || text(row.name);
        return canonicalName ? { type: 'coil', id: coilId, canonicalName } : null;
    }
    if ((resourceType === 'PART' || resourceType === 'PARTS' || row.inventoryType === 'part' || partId) && partId) {
        const canonicalName = text(row.model) || text(row.name);
        return canonicalName ? { type: 'part', id: partId, canonicalName } : null;
    }
    return null;
}

function collectionCompletenessFact({ entity, collectionRef, source, base, complete, returnedCount, totalCount, hasMore = false }) {
    const normalizedReturned = finite(returnedCount);
    const normalizedTotal = finite(totalCount);
    const isComplete = complete === true && hasMore !== true
        && (normalizedReturned === null || normalizedTotal === null || normalizedReturned === normalizedTotal);
    return makeFact({ entity, predicate: 'collection_completeness', value: isComplete ? 'COMPLETE' : 'PARTIAL',
        basis: null, capabilityId: base.capabilityId, tool: base.tool,
        qualifiers: {
            collectionRef, source,
            complete: isComplete,
            hasMore: hasMore === true || !isComplete,
            ...(normalizedReturned !== null ? { returnedCount: normalizedReturned } : {}),
            ...(normalizedTotal !== null ? { totalCount: normalizedTotal } : {}),
        } });
}

function operationalQuantityFacts(row, { entity, base, requirementRef, basis, context = {}, fields = {} }) {
    if (!entity) return [];
    const unit = text(row.inventoryUnit) || text(row.purchaseUnit) || null;
    const facts = [];
    for (const [predicate, descriptor] of Object.entries(fields)) {
        const value = finite(row[descriptor.field]);
        if (value === null) continue;
        facts.push(makeFact({ entity, predicate, value, unit, basis, capabilityId: base.capabilityId, tool: base.tool,
            qualifiers: { quantityRole: descriptor.role, requirementRef, ...context } }));
    }
    return facts;
}

function unresolvedRequirementFact(row, { base, requirementRef, basis, context = {} }) {
    return makeFact({ entity: null, predicate: 'unresolved_requirement', value: text(row.code) || text(row.reasonCode)
        || text(row.model) || 'UNRESOLVED_REQUIREMENT', basis, capabilityId: base.capabilityId, tool: base.tool,
    qualifiers: { requirementRef, inventoryType: text(row.inventoryType) || text(row.resourceType) || null,
        ...(text(row.model) || text(row.name) ? { displayName: text(row.model) || text(row.name) } : {}), ...context } });
}

// Operational read/preview producers already own readiness and procurement
// arithmetic.  This adapter copies their formal result rows into a compact,
// shared evidence vocabulary; it never derives shortage, availability,
// purchase coverage, readiness, or procurement state.
function operationalEvidenceFacts(data, base, result = {}) {
    if (!data || typeof data !== 'object') return [];
    const facts = [];
    const add = fact => facts.push(fact);
    const collection = (entity, collectionRef, source, metadata = {}) => add(collectionCompletenessFact({
        entity, collectionRef, source, base,
        complete: metadata.complete, returnedCount: metadata.returnedCount,
        totalCount: metadata.totalCount, hasMore: metadata.hasMore,
    }));
    const quantities = (row, entity, requirementRef, basis, context, fields) => {
        for (const fact of operationalQuantityFacts(row, { entity, base, requirementRef, basis, context, fields })) add(fact);
    };

    if (base.tool === 'preview_virtual_readiness') {
        const recipe = base.entity;
        const basis = text(data.inventoryBasis) || null;
        if (text(data.status)) add(makeFact({ entity: recipe, predicate: 'readiness_status', value: text(data.status), basis,
            capabilityId: base.capabilityId, tool: base.tool,
            qualifiers: { producer: 'virtual_readiness', scenarioKey: text(data.scenarioKey), targetQuantity: finite(data.quantity), coverageComplete: data.coverage?.complete === true } }));
        const collections = data.collections || {};
        collection(recipe, 'virtual_requirements', 'virtual_readiness', collections.requirements || {
            complete: data.coverage?.complete === true, returnedCount: Array.isArray(data.requirements) ? data.requirements.length : null,
            totalCount: data.coverage?.requirementCount,
        });
        collection(recipe, 'virtual_shortages', 'virtual_readiness', collections.shortages || {
            complete: data.coverage?.complete === true, returnedCount: Array.isArray(data.shortages) ? data.shortages.length : null,
            totalCount: data.coverage?.shortageCount,
        });
        collection(recipe, 'virtual_unresolved_requirements', 'virtual_readiness', collections.unresolvedRequirements || {
            complete: true, returnedCount: Array.isArray(data.unresolvedRequirements) ? data.unresolvedRequirements.length : null,
            totalCount: data.coverage?.unresolvedCount,
        });
        for (const [index, row] of (Array.isArray(data.requirements) ? data.requirements : []).entries()) {
            const requirementRef = `virtual_requirements:${index}`;
            const entity = materialEntity(row);
            if (!entity) { add(unresolvedRequirementFact(row, { base, requirementRef, basis, context: { producer: 'virtual_readiness', scenarioKey: text(data.scenarioKey) } })); continue; }
            quantities(row, entity, requirementRef, basis, { producer: 'virtual_readiness', inventoryType: text(row.inventoryType) || text(row.resourceType), scenarioKey: text(data.scenarioKey) }, {
                required_quantity: { field: 'virtualRequiredQty', role: 'REQUIRED' },
                available_quantity: { field: 'availableForVirtualQty', role: 'AVAILABLE' },
                shortage_quantity: { field: 'shortageQty', role: 'SHORTAGE' },
            });
        }
        for (const [index, row] of (Array.isArray(data.unresolvedRequirements) ? data.unresolvedRequirements : []).entries()) {
            add(unresolvedRequirementFact(row, { base, requirementRef: `virtual_unresolved_requirements:${index}`, basis,
                context: { producer: 'virtual_readiness', scenarioKey: text(data.scenarioKey) } }));
        }
    }

    if (base.tool === 'check_order_readiness') {
        const order = base.entity;
        const basis = 'FORMAL_ORDER_READINESS';
        if (text(data.verdict)) add(makeFact({ entity: order, predicate: 'readiness_status', value: text(data.verdict), basis,
            capabilityId: base.capabilityId, tool: base.tool,
            qualifiers: { producer: 'order_readiness', canProduce: data.canProduce === true,
                shortageLineCount: finite(data.metrics?.shortageLineCount), unresolvedLineCount: finite(data.metrics?.unresolvedLineCount) } }));
        const metadata = data.collections?.shortages || { complete: true,
            returnedCount: Array.isArray(data.shortages) ? data.shortages.length : null,
            totalCount: finite(data.metrics?.shortageLineCount) };
        collection(order, 'order_shortages', 'order_readiness', metadata);
        const metric = finite(data.metrics?.shortageLineCount);
        if (metric !== null) add(makeFact({ entity: order, predicate: 'shortage_line_count', value: metric, unit: 'COUNT', basis,
            capabilityId: base.capabilityId, tool: base.tool, qualifiers: { quantityRole: 'SHORTAGE_LINE_COUNT', collectionRef: 'order_shortages' } }));
        for (const [index, row] of (Array.isArray(data.shortages) ? data.shortages : []).entries()) {
            const requirementRef = `order_shortages:${index}`;
            const entity = materialEntity(row);
            if (!entity) { add(unresolvedRequirementFact(row, { base, requirementRef, basis, context: { producer: 'order_readiness', orderContext: true } })); continue; }
            quantities(row, entity, requirementRef, basis, { producer: 'order_readiness', orderContext: true,
                inventoryType: text(row.inventoryType), procurementStage: text(row.procurementStage) }, {
                required_quantity: { field: 'requiredQty', role: 'REQUIRED' },
                available_quantity: { field: 'availableQty', role: 'AVAILABLE' },
                shortage_quantity: { field: 'shortageQty', role: 'SHORTAGE' },
                purchase_quantity: { field: 'plannedQty', role: 'PLANNED_PURCHASE' },
                purchase_quantity_ordered: { field: 'orderedQty', role: 'ORDERED' },
                purchase_quantity_received: { field: 'receivedQty', role: 'RECEIVED' },
                purchase_quantity_stocked: { field: 'stockedQty', role: 'STOCKED' },
            });
        }
    }

    if (base.tool === 'get_order_detail') {
        const order = base.entity;
        const detail = data.order && typeof data.order === 'object' ? data.order : data;
        const basis = 'FORMAL_ORDER_DETAIL';
        if (text(detail.status)) add(makeFact({ entity: order, predicate: 'order_status', value: text(detail.status), basis,
            capabilityId: base.capabilityId, tool: base.tool }));
        if (text(detail.customerName)) add(makeFact({ entity: order, predicate: 'order_customer_attribute', value: text(detail.customerName), basis,
            capabilityId: base.capabilityId, tool: base.tool }));
        if (text(detail.contractNo)) add(makeFact({ entity: order, predicate: 'order_contract_number', value: text(detail.contractNo), basis,
            capabilityId: base.capabilityId, tool: base.tool }));
        const collections = detail.collections || {};
        collection(order, 'order_lines', 'order_detail', collections.items || { complete: false });
        collection(order, 'order_purchase_list', 'order_detail', collections.purchaseList || { complete: false });
        collection(order, 'order_todos', 'order_detail', collections.todos || { complete: false });
        for (const [index, row] of (Array.isArray(detail.items) ? detail.items : []).entries()) {
            const lineRef = `order_lines:${index}`;
            const quantity = finite(row.qty);
            const snapshotName = text(row.recipeName);
            if (snapshotName) add(makeFact({ entity: order, predicate: 'order_snapshot_recipe', value: snapshotName, basis,
                capabilityId: base.capabilityId, tool: base.tool, qualifiers: { lineRef, relationKind: 'ORDER_SNAPSHOT_RECIPE' } }));
            if (quantity !== null) add(makeFact({ entity: order, predicate: 'order_line_quantity', value: quantity, unit: 'COUNT', basis,
                capabilityId: base.capabilityId, tool: base.tool,
                qualifiers: { quantityRole: 'ORDER_LINE', lineRef, ...(snapshotName ? { recipeSnapshotName: snapshotName } : {}) } }));
        }
    }

    if (base.tool === 'get_purchase_overview') {
        const basis = 'FORMAL_PURCHASE_OVERVIEW';
        const receipt = result.queryReceipt || {};
        const returnedCount = finite(data.returnedCount ?? receipt.returnedCount);
        const totalCount = finite(data.summary?.taskCount ?? receipt.totalCount);
        collection(null, 'purchase_tasks', 'purchase_overview', {
            complete: receipt.truncated !== true && receipt.possiblyTruncated !== true && data.truncated !== true
                && returnedCount !== null && totalCount !== null && returnedCount === totalCount,
            returnedCount, totalCount,
            hasMore: receipt.truncated === true || receipt.possiblyTruncated === true || data.truncated === true,
        });
        for (const [index, row] of (Array.isArray(data.tasks) ? data.tasks : []).entries()) {
            const requirementRef = `purchase_tasks:${index}`;
            const entity = materialEntity(row);
            if (!entity) { add(unresolvedRequirementFact(row, { base, requirementRef, basis, context: { producer: 'purchase_overview' } })); continue; }
            if (text(row.procurementStage)) add(makeFact({ entity, predicate: 'purchase_status', value: text(row.procurementStage), basis,
                capabilityId: base.capabilityId, tool: base.tool,
                qualifiers: { requirementRef, supplier: text(row.supplier), inventoryType: text(row.inventoryType), producer: 'purchase_overview' } }));
            quantities(row, entity, requirementRef, basis, { producer: 'purchase_overview', supplier: text(row.supplier),
                inventoryType: text(row.inventoryType), procurementStage: text(row.procurementStage) }, {
                purchase_quantity: { field: 'plannedQty', role: 'PLANNED_PURCHASE' },
                purchase_quantity_ordered: { field: 'orderedQty', role: 'ORDERED' },
                purchase_quantity_received: { field: 'receivedQty', role: 'RECEIVED' },
                purchase_quantity_stocked: { field: 'stockedQty', role: 'STOCKED' },
                purchase_pending_quantity: { field: 'pendingQty', role: 'PENDING_PURCHASE' },
            });
        }
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
    const includeRecipeDetailCurrentCostFacts = options.includeRecipeDetailCurrentCostFacts === true;
    const includeOperationalEvidenceFacts = options.includeOperationalEvidenceFacts === true;
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
                if (includeRecipeDetailCurrentCostFacts) {
                    for (const fact of recipeDetailCurrentCostFacts(data, { entity, tool, capabilityId })) added.push(append(fact));
                }
                if (includeRecipeComparisonFacts) {
                    for (const fact of recipeComparisonFacts(data, { entity, tool, capabilityId })) added.push(append(fact));
                }
                if (includeScenarioComparisonFacts) {
                    for (const fact of scenarioComparisonFacts(data, { entity, tool, capabilityId })) added.push(append(fact));
                }
                if (includeCoilDirectoryCostFacts) {
                    for (const fact of coilDirectoryCostFacts(data, { entity, tool, capabilityId })) added.push(append(fact));
                }
                if (includeOperationalEvidenceFacts) {
                    for (const fact of operationalEvidenceFacts(data, { entity, tool, capabilityId }, result)) added.push(append(fact));
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

module.exports = { MAX_MODEL_PROJECTION_BYTES, coilDirectoryCostFacts, createFactLedger, modelProjection, operationalEvidenceFacts, recipeComparisonFacts, recipeDetailCurrentCostFacts, scenarioComparisonFacts };
