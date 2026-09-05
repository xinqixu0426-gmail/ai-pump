'use strict';

const { createV5EvidenceItem } = require('./evidenceLedger.cjs');
const runtime = new WeakMap();
const handoffs = new WeakMap();
const PRICE_FACT = Object.freeze({ factKey: 'price.current', field: 'price', capabilityId: 'inventory.read',
    sourceTool: 'search_parts', entityType: 'part', currency: 'CNY', unit: 'CATALOG_QUANTITY_UNIT',
    evidenceKind: 'DIRECT_FACT', numericType: 'number', snapshotKind: 'SAME_ROW_VERSION_READBACK' });
const sameEntity = (a, b) => a?.entityType === b?.entityType && a?.canonicalEntityId === b?.canonicalEntityId
    && a?.resolutionReceiptRef === b?.resolutionReceiptRef;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const APPROVED_RUNTIME_FACTS = Object.freeze({
    'price.current': PRICE_FACT,
    'inventory.quantity': Object.freeze({ factKey: 'inventory.quantity', capabilityId: 'inventory.read', sourceTool: 'search_parts', entityType: 'part', field: 'parts[].stock', unit: 'CATALOG_QUANTITY_UNIT', evidenceKind: 'DIRECT_FACT', snapshotKind: 'SAME_TOOL_EXECUTION' }),
    'coil.inventory': Object.freeze({ factKey: 'coil.inventory', capabilityId: 'coil.read', sourceTool: 'search_coils', entityType: 'coil', field: 'data[].stock', unit: 'COIL_SET', evidenceKind: 'DIRECT_FACT', snapshotKind: 'SAME_TOOL_EXECUTION' }),
    'recipe.cost.preview': Object.freeze({ factKey: 'recipe.cost.preview', capabilityId: 'recipe.cost.preview', sourceTool: 'preview_recipe_cost', entityType: 'recipe', field: 'data.currentTotalCost', unit: 'RECIPE_UNIT', currency: 'CNY', evidenceKind: 'DIRECT_FACT', snapshotKind: 'SAME_TOOL_EXECUTION_CURRENT_COST' }),
});
const version = row => typeof row?.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)) ? row.updatedAt : null;

// Values and row versions never enter serializable ledger metadata. The receipt is an
// opaque identity, not a JSON token that callers can forge or replay in another task.
function extractPriceEvidence({ result, taskId, entity, sourceExecutionId, capabilityId, sourceTool }) {
    const receipt = Object.freeze({});
    const rows = Array.isArray(result?.parts) ? result.parts : [];
    const matches = rows.filter(row => String(row.id) === String(entity?.canonicalEntityId));
    const row = matches.length === 1 ? matches[0] : null;
    const present = !!row && row.price !== null && row.price !== undefined;
    const valid = capabilityId === PRICE_FACT.capabilityId && sourceTool === PRICE_FACT.sourceTool
        && entity?.entityType === PRICE_FACT.entityType && !!entity.resolutionReceiptRef
        && typeof taskId === 'string' && !!taskId && typeof sourceExecutionId === 'string' && !!sourceExecutionId
        && result?.success === true && result.truncated === false && result.count === rows.length
        && result.executionEvidence?.verified === true && result.executionEvidence.kind === 'formal_api_query'
        && result.executionEvidence.calls?.length > 0
        && result.executionEvidence.calls.every(call => call.method === 'GET')
        && result.executionEvidence.calls.some(call => /^\/api\/parts(?:\?|$)/u.test(call.path || ''))
        && present && finite(row.price) && version(row) !== null;
    const item = createV5EvidenceItem({ evidenceId: `${sourceExecutionId}:price`, taskId,
        evidenceType: 'DIRECT_FACT', status: valid ? 'VALID' : present ? 'INVALID' : 'MISSING',
        claimType: PRICE_FACT.factKey, sourceType: 'TOOL', sourceRef: sourceExecutionId,
        entityRef: entity, toolName: sourceTool, capabilityId, operationRefs: [sourceExecutionId],
        freshness: valid ? 'CURRENT' : 'UNKNOWN', createdAt: new Date().toISOString(),
        metadata: { factKey: PRICE_FACT.factKey, field: PRICE_FACT.field, fieldType: present ? typeof row.price : 'missing',
            present, currency: PRICE_FACT.currency, unit: PRICE_FACT.unit, snapshotKind: PRICE_FACT.snapshotKind } });
    runtime.set(receipt, { item, taskId, entity: { ...entity }, sourceExecutionId, factKey: PRICE_FACT.factKey,
        value: valid ? row.price : undefined, rowVersion: version(row), valid, checked: false });
    return Object.freeze({ item, receipt, present, valid });
}

function verifyPriceEvidence({ ledger, receipt, taskId, entity, sourceExecutionId, referenceRows }) {
    const stored = runtime.get(receipt);
    if (!stored) return Object.freeze({ status: 'FAIL', reasonCode: 'PRICE_RECEIPT_INVALID' });
    stored.checked = false;
    const item = ledger?.items?.find(e => e.evidenceId === stored.item.evidenceId);
    const own = ledger?.taskId === taskId && stored.taskId === taskId && item?.taskId === taskId
        && sameEntity(stored.entity, entity) && sameEntity(item?.entityRef, entity)
        && stored.sourceExecutionId === sourceExecutionId && item?.sourceRef === sourceExecutionId;
    const structure = item?.claimType === PRICE_FACT.factKey && item.metadata?.factKey === PRICE_FACT.factKey
        && item.metadata.field === PRICE_FACT.field && item.metadata.fieldType === 'number'
        && item.metadata.currency === PRICE_FACT.currency && item.metadata.unit === PRICE_FACT.unit
        && item.metadata.snapshotKind === PRICE_FACT.snapshotKind
        && item.toolName === PRICE_FACT.sourceTool && item.capabilityId === PRICE_FACT.capabilityId
        && item.evidenceType === 'DIRECT_FACT' && item.sourceType === 'TOOL' && item.sourceTrust === 'FORMAL'
        && item.status === 'VALID' && item.freshness === 'CURRENT'
        && item.operationRefs?.length === 1 && item.operationRefs[0] === sourceExecutionId;
    if (!own || !structure || !stored.valid) return Object.freeze({ status: 'FAIL', reasonCode: 'PRICE_EVIDENCE_INVALID' });
    const matches = Array.isArray(referenceRows)
        ? referenceRows.filter(row => String(row.id) === String(entity.canonicalEntityId)) : [];
    if (matches.length !== 1 || !finite(matches[0].price)) return Object.freeze({ status: 'FAIL', reasonCode: 'PRICE_REFERENCE_INVALID' });
    if (!version(matches[0]) || version(matches[0]) !== stored.rowVersion) return Object.freeze({ status: 'FAIL', reasonCode: 'PRICE_SNAPSHOT_MISMATCH' });
    if (matches[0].price !== stored.value) return Object.freeze({ status: 'FAIL', reasonCode: 'PRICE_VALUE_MISMATCH' });
    stored.checked = true;
    return Object.freeze({ status: 'PASS', reasonCode: 'PRICE_FIELD_VERIFIED' });
}

// Called by formal verification, not by an evaluation comparator. Receipt binding also
// prevents a generic metadata-only ledger item from claiming verified price support.
function hasVerifiedPriceReceipt(ledger, receipt) {
    const s = runtime.get(receipt);
    if (!s?.checked || !s.valid || ledger?.taskId !== s.taskId) return false;
    const i = ledger.items.find(item => item.evidenceId === s.item.evidenceId);
    return !!i && JSON.stringify(i) === JSON.stringify(s.item);
}
// Capture only the field of an already-created ledger item in the same execution.
// This does not create evidence, perform verification, read a comparator, or call I/O.
function captureReadFactValue({ ledger, evidenceId, result, entity }) {
    const item = ledger?.items?.find(i => i.evidenceId === evidenceId);
    const spec = APPROVED_RUNTIME_FACTS[item?.claimType];
    if (!spec || spec === PRICE_FACT || item.taskId !== ledger.taskId || !sameEntity(item.entityRef, entity)
        || item.status !== 'VALID' || item.evidenceType !== spec.evidenceKind || item.sourceTrust !== 'FORMAL'
        || item.sourceType !== 'TOOL' || item.freshness !== 'CURRENT' || !item.sourceRef
        || item.toolName !== spec.sourceTool || item.capabilityId !== spec.capabilityId
        || entity.entityType !== spec.entityType || result?.success !== true) return null;
    let value;
    if (spec.entityType === 'recipe') {
        if (String(result.data?.recipeId) !== String(entity.canonicalEntityId)) return null;
        value = result.data?.currentTotalCost;
    } else {
        const rows = spec.entityType === 'part' ? result.parts : result.data;
        const matches = Array.isArray(rows) ? rows.filter(r => String(r.id ?? r.Id) === String(entity.canonicalEntityId)) : [];
        if (matches.length !== 1) return null;
        value = matches[0].stock;
    }
    if (!finite(value)) return null;
    const receipt = Object.freeze({});
    runtime.set(receipt, { item, taskId: ledger.taskId, entity: { ...item.entityRef },
        sourceExecutionId: item.sourceRef, factKey: item.claimType, value, valid: true });
    return receipt;
}
function createVerifiedValueHandoff(ledger, verification, receipt) {
    if (verification?.taskId !== ledger?.taskId || verification?.decision !== 'VERIFIED'
        || !require('./verification.cjs').isVerifiedTaskResult(ledger, verification)) return null;
    const records = new Map();
    for (const ref of Array.isArray(receipt) ? receipt : [receipt]) {
        const s = runtime.get(ref);
        if (!s?.valid || s.taskId !== ledger.taskId || !finite(s.value)
            || !ledger.items.some(i => JSON.stringify(i) === JSON.stringify(s.item))
            || (s.factKey === PRICE_FACT.factKey && !hasVerifiedPriceReceipt(ledger, ref))
            || records.has(s.factKey)) return null;
        records.set(s.factKey, s);
    }
    if (!records.size) return null;
    const handle = Object.freeze({});
    handoffs.set(handle, records);
    return handle;
}
function getVerifiedEvidenceValue(handle, context = {}) {
    const s = handoffs.get(handle)?.get(context.factKey);
    if (!s?.valid || (s.factKey === PRICE_FACT.factKey && !s.checked)
        || context.taskId !== s.taskId || context.factKey !== s.factKey
        || context.sourceExecutionId !== s.sourceExecutionId || !sameEntity(context.entity, s.entity)) {
        throw new Error('VERIFIED_EVIDENCE_ACCESS_DENIED');
    }
    const spec = APPROVED_RUNTIME_FACTS[s.factKey];
    const output = { factKey: s.factKey, ...(spec.currency ? { currency: spec.currency } : {}), unit: spec.unit };
    Object.defineProperty(output, 'runtimeValue', { value: s.value, enumerable: false });
    return Object.freeze(output);
}

module.exports = { PRICE_FACT, APPROVED_RUNTIME_FACTS, captureReadFactValue, extractPriceEvidence, verifyPriceEvidence, hasVerifiedPriceReceipt,
    createVerifiedValueHandoff, getVerifiedEvidenceValue };
