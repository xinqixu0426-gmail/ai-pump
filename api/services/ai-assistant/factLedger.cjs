'use strict';

// A request-scoped, append-only projection of verified formal observations.
// It is deliberately not a business table and never promotes user context,
// page context, or a failed technical call into a formal fact.

const SENSITIVE_KEYS = new Set([
    'confirmationToken', 'partId', 'recipeId', 'coilId', 'orderId', 'customerId',
    'operationId', 'idempotencyKey', 'argsHash', 'proposalHash', 'executionEvidence',
]);

function finite(value) {
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
        if (fields.some(field => Number(args?.[field]) === id)) {
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
    const addNumber = (field, predicate, unit, factBasis = basis) => {
        const value = finite(data[field]);
        if (value !== null) facts.push(makeFact({ entity, predicate, value, unit, basis: factBasis, capabilityId, tool }));
    };
    addNumber('currentTotalCost', 'current_cost', 'CNY');
    addNumber('unitCost', 'unit_cost', 'CNY');
    addNumber('totalCost', 'total_cost', 'CNY');
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

function createFactLedger() {
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
    const redact = value => {
        if (Array.isArray(value)) return value.map(redact);
        if (!value || typeof value !== 'object') return value;
        return Object.fromEntries(Object.entries(value)
            .filter(([key]) => !SENSITIVE_KEYS.has(key))
            .map(([key, child]) => [key, redact(child)]));
    };
    return { ...redact(result), factRefs: factIds };
}

module.exports = { createFactLedger, modelProjection };
