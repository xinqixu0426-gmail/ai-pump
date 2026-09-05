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
    runtime.set(receipt, { item, taskId, entity: { ...entity }, sourceExecutionId,
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
function createVerifiedValueHandoff(ledger, verification, receipt) {
    if (verification?.taskId !== ledger?.taskId || verification?.decision !== 'VERIFIED'
        || !require('./verification.cjs').isVerifiedTaskResult(ledger, verification)
        || !hasVerifiedPriceReceipt(ledger, receipt)) return null;
    const handle = Object.freeze({});
    handoffs.set(handle, runtime.get(receipt));
    return handle;
}
function getVerifiedEvidenceValue(handle, context = {}) {
    const s = handoffs.get(handle);
    if (!s?.checked || !s.valid || context.taskId !== s.taskId || context.factKey !== PRICE_FACT.factKey
        || context.sourceExecutionId !== s.sourceExecutionId || !sameEntity(context.entity, s.entity)) {
        throw new Error('VERIFIED_EVIDENCE_ACCESS_DENIED');
    }
    const output = { factKey: PRICE_FACT.factKey, currency: PRICE_FACT.currency, unit: PRICE_FACT.unit };
    Object.defineProperty(output, 'runtimeValue', { value: s.value, enumerable: false });
    return Object.freeze(output);
}

module.exports = { PRICE_FACT, extractPriceEvidence, verifyPriceEvidence, hasVerifiedPriceReceipt,
    createVerifiedValueHandoff, getVerifiedEvidenceValue };
