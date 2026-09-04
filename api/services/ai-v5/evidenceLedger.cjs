'use strict';

const { validateV5ToolResult } = require('./contracts.cjs');

const V5_EVIDENCE_LEDGER_VERSION = 1;
const V5_EVIDENCE_TYPES = Object.freeze(['DIRECT_FACT', 'DERIVED_FACT', 'ASSUMPTION', 'UNVERIFIED']);
const V5_EVIDENCE_STATUSES = Object.freeze(['VALID', 'STALE', 'INVALID', 'MISSING', 'NOT_APPLICABLE', 'UNKNOWN']);
const V5_EVIDENCE_SOURCE_TYPES = Object.freeze(['TOOL', 'BUSINESS_API', 'FILE', 'DOCUMENT', 'DERIVATION', 'USER_CLAIM', 'UNKNOWN']);
const V5_SOURCE_TRUST = Object.freeze(['FORMAL', 'DERIVED_FORMAL', 'TEMPORARY', 'UNVERIFIED']);
const V5_FRESHNESS = Object.freeze(['CURRENT', 'STALE', 'UNKNOWN', 'NOT_APPLICABLE']);

class V5EvidenceValidationError extends TypeError {
    constructor(message, code = 'V5_EVIDENCE_VALIDATION_FAILED') {
        super(message);
        this.name = 'V5EvidenceValidationError';
        this.code = code;
    }
}

function fail(message, code) {
    throw new V5EvidenceValidationError(message, code);
}

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function clone(value, seen = new WeakSet()) {
    if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value || typeof value !== 'object' || typeof value === 'function') fail('Evidence fields must be JSON serializable');
    if (seen.has(value)) fail('Evidence fields cannot contain circular values');
    seen.add(value);
    const output = Array.isArray(value)
        ? value.map(item => clone(item, seen))
        : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item, seen)]));
    seen.delete(value);
    return output;
}

function immutable(value) {
    return deepFreeze(clone(value));
}

function requiredString(value, field) {
    if (typeof value !== 'string' || value.length === 0) fail(`${field} must be a non-empty string`);
    return value;
}

function optionalString(value, field) {
    if (value === null || value === undefined) return null;
    return requiredString(value, field);
}

function stringArray(value, field) {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
        fail(`${field} must be an array of non-empty strings`);
    }
    return [...new Set(value)];
}

function isoTimestamp(value, field) {
    requiredString(value, field);
    if (Number.isNaN(Date.parse(value))) fail(`${field} must be an ISO-compatible timestamp`);
    return value;
}

function classifySourceTrust(sourceType) {
    if (['TOOL', 'BUSINESS_API'].includes(sourceType)) return 'FORMAL';
    if (sourceType === 'DERIVATION') return 'DERIVED_FORMAL';
    if (['FILE', 'DOCUMENT'].includes(sourceType)) return 'TEMPORARY';
    return 'UNVERIFIED';
}

function normalizeEntityRef(value) {
    if (value === null || value === undefined) return null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('entityRef must be an object or null');
    const entityType = requiredString(value.entityType, 'entityRef.entityType');
    const canonicalEntityId = value.canonicalEntityId ?? null;
    if (canonicalEntityId === null) fail('Evidence entityRef requires a resolved canonicalEntityId');
    if (!['string', 'number'].includes(typeof canonicalEntityId)) fail('entityRef.canonicalEntityId is invalid');
    const resolutionReceiptRef = requiredString(value.resolutionReceiptRef, 'entityRef.resolutionReceiptRef');
    return { entityType, canonicalEntityId, resolutionReceiptRef };
}

function createV5EvidenceItem(input = {}) {
    if ((input.version ?? V5_EVIDENCE_LEDGER_VERSION) !== V5_EVIDENCE_LEDGER_VERSION) fail('Unsupported evidence version');
    if (!V5_EVIDENCE_TYPES.includes(input.evidenceType)) fail('Invalid evidenceType');
    if (!V5_EVIDENCE_STATUSES.includes(input.status)) fail('Invalid evidence status');
    if (!V5_EVIDENCE_SOURCE_TYPES.includes(input.sourceType)) fail('Invalid sourceType');
    if (!V5_FRESHNESS.includes(input.freshness)) fail('Invalid freshness');
    const expectedTrust = classifySourceTrust(input.sourceType);
    const sourceTrust = input.sourceTrust ?? expectedTrust;
    if (!V5_SOURCE_TRUST.includes(sourceTrust) || sourceTrust !== expectedTrust) fail('sourceTrust does not match deterministic source classification');
    const derivation = input.derivation ?? null;
    if (input.evidenceType === 'DERIVED_FACT') {
        if (input.sourceType !== 'DERIVATION' || !derivation || typeof derivation !== 'object' || Array.isArray(derivation)) {
            fail('DERIVED_FACT requires a DERIVATION source and derivation contract');
        }
        if (!Array.isArray(derivation.inputEvidenceIds) || derivation.inputEvidenceIds.length === 0) fail('DERIVED_FACT requires inputEvidenceIds');
        requiredString(derivation.derivationType, 'derivation.derivationType');
    } else if (derivation !== null) {
        fail('Only DERIVED_FACT may contain derivation metadata');
    }
    if (input.evidenceType === 'DIRECT_FACT' && !['TOOL', 'BUSINESS_API'].includes(input.sourceType)) {
        fail('DIRECT_FACT requires a formal TOOL or BUSINESS_API source');
    }
    if (input.evidenceType === 'UNVERIFIED' && input.status === 'VALID') fail('UNVERIFIED evidence cannot have VALID status');

    return immutable({
        version: V5_EVIDENCE_LEDGER_VERSION,
        evidenceId: requiredString(input.evidenceId, 'evidenceId'),
        taskId: requiredString(input.taskId, 'taskId'),
        evidenceType: input.evidenceType,
        status: input.status,
        claimType: requiredString(input.claimType, 'claimType'),
        sourceType: input.sourceType,
        sourceTrust,
        sourceRef: optionalString(input.sourceRef, 'sourceRef'),
        entityRef: normalizeEntityRef(input.entityRef),
        toolName: optionalString(input.toolName, 'toolName'),
        capabilityId: optionalString(input.capabilityId, 'capabilityId'),
        operationRefs: stringArray(input.operationRefs || [], 'operationRefs'),
        operationLinkStatus: (input.operationRefs || []).length > 0 ? 'KNOWN' : 'UNKNOWN',
        freshness: input.freshness,
        derivation: derivation === null ? null : {
            inputEvidenceIds: stringArray(derivation.inputEvidenceIds, 'derivation.inputEvidenceIds'),
            derivationType: requiredString(derivation.derivationType, 'derivation.derivationType'),
            formulaId: optionalString(derivation.formulaId, 'derivation.formulaId'),
        },
        createdAt: isoTimestamp(input.createdAt, 'createdAt'),
        metadata: clone(input.metadata || {}),
    });
}

function createEvidenceLedger(taskId) {
    return immutable({ version: V5_EVIDENCE_LEDGER_VERSION, taskId: requiredString(taskId, 'taskId'), items: [] });
}

function assertNoCircularDerivation(items) {
    const graph = new Map(items.map(item => [item.evidenceId, item.derivation?.inputEvidenceIds || []]));
    const visiting = new Set();
    const visited = new Set();
    function visit(id) {
        if (visiting.has(id)) fail('Circular evidence derivation rejected', 'V5_EVIDENCE_CIRCULAR_DERIVATION');
        if (visited.has(id)) return;
        visiting.add(id);
        for (const inputId of graph.get(id) || []) visit(inputId);
        visiting.delete(id);
        visited.add(id);
    }
    for (const id of graph.keys()) visit(id);
}

function validateLedger(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Ledger must be an object');
    if (value.version !== V5_EVIDENCE_LEDGER_VERSION) fail('Unsupported ledger version');
    const taskId = requiredString(value.taskId, 'ledger.taskId');
    if (!Array.isArray(value.items)) fail('ledger.items must be an array');
    const items = value.items.map(createV5EvidenceItem);
    if (items.some(item => item.taskId !== taskId)) fail('Cross-task evidence rejected', 'V5_EVIDENCE_TASK_MISMATCH');
    const ids = new Set();
    for (const item of items) {
        if (ids.has(item.evidenceId)) fail('Duplicate evidenceId rejected', 'V5_EVIDENCE_DUPLICATE_ID');
        ids.add(item.evidenceId);
    }
    for (const item of items) {
        for (const inputId of item.derivation?.inputEvidenceIds || []) {
            if (!ids.has(inputId)) fail('Missing derivation input rejected', 'V5_EVIDENCE_INPUT_MISSING');
        }
    }
    assertNoCircularDerivation(items);
    for (const item of items.filter(candidate => candidate.evidenceType === 'DERIVED_FACT' && candidate.status === 'VALID')) {
        const inputs = item.derivation.inputEvidenceIds.map(id => items.find(candidate => candidate.evidenceId === id));
        if (inputs.some(input => input.status !== 'VALID' || ['ASSUMPTION', 'UNVERIFIED'].includes(input.evidenceType))) {
            fail('VALID derived evidence requires valid formal inputs', 'V5_EVIDENCE_DERIVATION_INVALID');
        }
    }
    return immutable({ version: V5_EVIDENCE_LEDGER_VERSION, taskId, items });
}

function addEvidence(ledger, evidenceInput) {
    const current = validateLedger(ledger);
    const item = createV5EvidenceItem(evidenceInput);
    return validateLedger({ ...current, items: [...current.items, item] });
}

function getEvidence(ledger, evidenceId) {
    return validateLedger(ledger).items.find(item => item.evidenceId === evidenceId) || null;
}

function listEvidence(ledger) {
    return validateLedger(ledger).items;
}

function toolResultToCandidateEvidence(toolResultInput, options = {}) {
    const toolResult = validateV5ToolResult(toolResultInput);
    const formal = toolResult.status === 'success'
        && options.formalSourceValidated === true
        && options.entityConsistent !== false
        && options.freshness === 'CURRENT'
        && typeof options.sourceRef === 'string'
        && options.sourceRef.length > 0;
    return createV5EvidenceItem({
        evidenceId: options.evidenceId,
        taskId: toolResult.taskId,
        evidenceType: formal ? 'DIRECT_FACT' : 'UNVERIFIED',
        status: formal ? 'VALID' : (toolResult.status === 'failure' ? 'INVALID' : 'UNKNOWN'),
        claimType: options.claimType,
        sourceType: formal ? 'TOOL' : 'UNKNOWN',
        sourceRef: formal ? options.sourceRef : null,
        entityRef: options.entityConsistent === true ? options.entityRef : null,
        toolName: toolResult.toolName,
        capabilityId: options.capabilityId ?? null,
        operationRefs: toolResult.operationRefs,
        freshness: formal ? 'CURRENT' : 'UNKNOWN',
        derivation: null,
        createdAt: options.createdAt,
        metadata: { resultStatus: toolResult.status },
    });
}

module.exports = {
    V5_EVIDENCE_LEDGER_VERSION,
    V5_EVIDENCE_SOURCE_TYPES,
    V5_EVIDENCE_STATUSES,
    V5_EVIDENCE_TYPES,
    V5_FRESHNESS,
    V5_SOURCE_TRUST,
    V5EvidenceValidationError,
    addEvidence,
    classifySourceTrust,
    createEvidenceLedger,
    createV5EvidenceItem,
    getEvidence,
    listEvidence,
    toolResultToCandidateEvidence,
    validateLedger,
};
