'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createV5ToolResult, createV5ToolError, createV5Task, createV5ToolRequest } = require('../api/services/ai-v5/contracts.cjs');
const {
    V5_EVIDENCE_LEDGER_VERSION,
    addEvidence,
    classifySourceTrust,
    createEvidenceLedger,
    createV5EvidenceItem,
    getEvidence,
    listEvidence,
    toolResultToCandidateEvidence,
    validateLedger,
} = require('../api/services/ai-v5/evidenceLedger.cjs');
const {
    auditCapabilityRequirementCoverage,
    createEvidenceRequirement,
    listEvidenceRequirements,
} = require('../api/services/ai-v5/evidenceRequirements.cjs');
const {
    composingTransitionContext,
    decisionFromLayerResults,
    evaluateEvidenceCompleteness,
    evaluateEvidenceValidity,
    evaluateExecutionCompleteness,
    evaluateSupportability,
    verificationTransitionContext,
    verifyV5Task,
} = require('../api/services/ai-v5/verification.cjs');
const { transitionTask } = require('../api/services/ai-v5/taskState.cjs');
const { evaluateP06VerificationCases } = require('../api/services/ai-v5/evidenceShadowEvaluation.cjs');
const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');

const AT = '2026-09-04T00:00:00.000Z';
const ENTITY = Object.freeze({ entityType: 'part', canonicalEntityId: 'synthetic-part', resolutionReceiptRef: 'synthetic-resolution' });

function item(overrides = {}) {
    return createV5EvidenceItem({
        version: 1,
        evidenceId: 'e-1',
        taskId: 'task-1',
        evidenceType: 'DIRECT_FACT',
        status: 'VALID',
        claimType: 'inventory.quantity',
        sourceType: 'TOOL',
        sourceRef: 'synthetic-tool-result',
        entityRef: ENTITY,
        toolName: 'search_parts',
        capabilityId: 'inventory.read',
        operationRefs: [],
        freshness: 'CURRENT',
        derivation: null,
        createdAt: AT,
        metadata: {},
        ...overrides,
    });
}

function requirement(overrides = {}) {
    return createEvidenceRequirement({
        capabilityId: 'inventory.read',
        requirementId: 'inventory-current-formal-fact',
        claimType: 'inventory.quantity',
        requiredEvidenceType: 'DIRECT_FACT',
        minimumSourceTrust: 'FORMAL',
        freshnessRequirement: 'CURRENT',
        minimumCount: 1,
        level: 'REQUIRED',
        entityType: 'part',
        ...overrides,
    });
}

function ledgerWith(...items) {
    return items.reduce((ledger, evidence) => addEvidence(ledger, evidence), createEvidenceLedger('task-1'));
}

function successfulToolResult(overrides = {}) {
    return createV5ToolResult({ taskId: 'task-1', toolName: 'search_parts', status: 'success', data: { synthetic: true }, operationRefs: [], ...overrides });
}

test('evidence ledger V1 is versioned, serializable and immutable', () => {
    const ledger = ledgerWith(item());
    assert.equal(V5_EVIDENCE_LEDGER_VERSION, 1);
    assert.equal(ledger.version, 1);
    assert.equal(Object.isFrozen(ledger), true);
    assert.doesNotThrow(() => JSON.stringify(ledger));
});

test('evidence contract validates type, status, source, freshness and version', () => {
    for (const overrides of [{ version: 2 }, { evidenceType: 'MAGIC' }, { status: 'MAYBE' }, { sourceType: 'MODEL' }, { freshness: 'RECENT' }]) {
        assert.throws(() => item(overrides), { code: 'V5_EVIDENCE_VALIDATION_FAILED' });
    }
});

test('source trust is deterministic and cannot be self-promoted', () => {
    assert.equal(classifySourceTrust('TOOL'), 'FORMAL');
    assert.equal(classifySourceTrust('BUSINESS_API'), 'FORMAL');
    assert.equal(classifySourceTrust('DERIVATION'), 'DERIVED_FORMAL');
    assert.equal(classifySourceTrust('DOCUMENT'), 'TEMPORARY');
    assert.equal(classifySourceTrust('USER_CLAIM'), 'UNVERIFIED');
    assert.throws(() => item({ sourceTrust: 'UNVERIFIED' }), /sourceTrust/);
});

test('DIRECT_FACT accepts only formal tool/business sources', () => {
    assert.equal(item().evidenceType, 'DIRECT_FACT');
    assert.throws(() => item({ sourceType: 'USER_CLAIM', sourceTrust: 'UNVERIFIED' }), /DIRECT_FACT/);
});

test('ASSUMPTION remains explicit and cannot masquerade as a direct fact', () => {
    const assumption = item({ evidenceType: 'ASSUMPTION', sourceType: 'USER_CLAIM', sourceTrust: 'UNVERIFIED', sourceRef: null });
    assert.equal(assumption.evidenceType, 'ASSUMPTION');
    assert.equal(assumption.sourceTrust, 'UNVERIFIED');
});

test('UNVERIFIED is distinct from INVALID and cannot be marked VALID', () => {
    const candidate = item({ evidenceType: 'UNVERIFIED', status: 'UNKNOWN', sourceType: 'UNKNOWN', sourceTrust: 'UNVERIFIED', sourceRef: null });
    assert.equal(candidate.status, 'UNKNOWN');
    assert.throws(() => item({ evidenceType: 'UNVERIFIED', status: 'VALID', sourceType: 'UNKNOWN', sourceTrust: 'UNVERIFIED' }), /cannot have VALID/);
});

test('DERIVED_FACT requires deterministic derivation metadata', () => {
    const derived = item({ evidenceId: 'e-2', evidenceType: 'DERIVED_FACT', sourceType: 'DERIVATION', sourceTrust: 'DERIVED_FORMAL', derivation: { inputEvidenceIds: ['e-1'], derivationType: 'SUM', formulaId: 'synthetic-formula' } });
    assert.equal(derived.derivation.derivationType, 'SUM');
    assert.throws(() => item({ evidenceType: 'DERIVED_FACT', sourceType: 'DERIVATION', sourceTrust: 'DERIVED_FORMAL' }), /derivation contract/);
});

test('ledger add/list/get is immutable', () => {
    const original = createEvidenceLedger('task-1');
    const next = addEvidence(original, item());
    assert.equal(original.items.length, 0);
    assert.equal(listEvidence(next).length, 1);
    assert.equal(getEvidence(next, 'e-1').evidenceId, 'e-1');
});

test('duplicate evidence IDs are rejected without partial mutation', () => {
    const ledger = ledgerWith(item());
    const before = JSON.stringify(ledger);
    assert.throws(() => addEvidence(ledger, item()), { code: 'V5_EVIDENCE_DUPLICATE_ID' });
    assert.equal(JSON.stringify(ledger), before);
});

test('cross-task evidence is rejected', () => {
    assert.throws(() => addEvidence(createEvidenceLedger('task-1'), item({ taskId: 'task-2' })), { code: 'V5_EVIDENCE_TASK_MISMATCH' });
});

test('missing derivation inputs are rejected', () => {
    const derived = item({ evidenceId: 'derived', evidenceType: 'DERIVED_FACT', sourceType: 'DERIVATION', sourceTrust: 'DERIVED_FORMAL', derivation: { inputEvidenceIds: ['missing'], derivationType: 'SUM' } });
    assert.throws(() => addEvidence(createEvidenceLedger('task-1'), derived), { code: 'V5_EVIDENCE_INPUT_MISSING' });
});

test('circular derivation is rejected without recursion overflow', () => {
    const a = item({ evidenceId: 'a', evidenceType: 'DERIVED_FACT', sourceType: 'DERIVATION', sourceTrust: 'DERIVED_FORMAL', derivation: { inputEvidenceIds: ['b'], derivationType: 'COPY' } });
    const b = item({ evidenceId: 'b', evidenceType: 'DERIVED_FACT', sourceType: 'DERIVATION', sourceTrust: 'DERIVED_FORMAL', derivation: { inputEvidenceIds: ['a'], derivationType: 'COPY' } });
    assert.throws(() => validateLedger({ version: 1, taskId: 'task-1', items: [a, b] }), { code: 'V5_EVIDENCE_CIRCULAR_DERIVATION' });
});

test('VALID derived fact requires existing valid formal inputs', () => {
    const assumption = item({ evidenceType: 'ASSUMPTION', sourceType: 'USER_CLAIM', sourceTrust: 'UNVERIFIED', sourceRef: null });
    const derived = item({ evidenceId: 'derived', evidenceType: 'DERIVED_FACT', sourceType: 'DERIVATION', sourceTrust: 'DERIVED_FORMAL', derivation: { inputEvidenceIds: ['e-1'], derivationType: 'COPY' } });
    assert.throws(() => validateLedger({ version: 1, taskId: 'task-1', items: [assumption, derived] }), { code: 'V5_EVIDENCE_DERIVATION_INVALID' });
    assert.equal(ledgerWith(item(), derived).items.length, 2);
});

test('canonical entity reference requires a formal resolution receipt', () => {
    assert.throws(() => item({ entityRef: { entityType: 'part', canonicalEntityId: 1 } }), /resolutionReceiptRef/);
});

test('missing operation refs are tolerated but explicitly UNKNOWN', () => {
    assert.equal(item().operationLinkStatus, 'UNKNOWN');
    assert.equal(item({ operationRefs: ['synthetic-operation'] }).operationLinkStatus, 'KNOWN');
});

test('ToolResult adapter does not copy raw data and requires explicit formal validation', () => {
    const toolResult = successfulToolResult({ data: { rawBusinessPayload: 'DO_NOT_COPY' } });
    const candidate = toolResultToCandidateEvidence(toolResult, { evidenceId: 'candidate', claimType: 'inventory.quantity', createdAt: AT });
    assert.equal(candidate.evidenceType, 'UNVERIFIED');
    assert.equal(JSON.stringify(candidate).includes('DO_NOT_COPY'), false);
    const formal = toolResultToCandidateEvidence(toolResult, { evidenceId: 'formal', claimType: 'inventory.quantity', capabilityId: 'inventory.read', formalSourceValidated: true, entityConsistent: true, entityRef: ENTITY, sourceRef: 'formal-result', freshness: 'CURRENT', createdAt: AT });
    assert.equal(formal.evidenceType, 'DIRECT_FACT');
    assert.equal(formal.status, 'VALID');
});

test('failed ToolResult becomes invalid unverified evidence, not a direct fact', () => {
    const error = createV5ToolError({ classification: 'EXECUTION_ERROR', code: 'SYNTHETIC_FAILURE', retryable: false });
    const failed = createV5ToolResult({ taskId: 'task-1', toolName: 'search_parts', status: 'failure', error, operationRefs: [] });
    const evidence = toolResultToCandidateEvidence(failed, { evidenceId: 'failed', claimType: 'inventory.quantity', createdAt: AT });
    assert.equal(evidence.evidenceType, 'UNVERIFIED');
    assert.equal(evidence.status, 'INVALID');
});

test('requirement contract distinguishes required and optional with minimum count', () => {
    assert.equal(requirement().level, 'REQUIRED');
    assert.equal(requirement({ level: 'OPTIONAL' }).level, 'OPTIONAL');
    assert.throws(() => requirement({ minimumCount: 0 }), /minimumCount/);
});

test('capability requirement coverage is conservative and explicit', () => {
    const audit = auditCapabilityRequirementCoverage();
    assert.deepEqual({ count: audit.capabilityCount, defined: audit.defined, deferred: audit.deferred, na: audit.notApplicable }, { count: 42, defined: 4, deferred: 38, na: 0 });
    assert.equal(listEvidenceRequirements('inventory.read').length, 1);
    assert.equal(listEvidenceRequirements('order.read').length, 0);
});

test('execution completeness separates complete, incomplete, failed and not applicable', () => {
    assert.equal(evaluateExecutionCompleteness({ toolResults: [successfulToolResult()], orchestrationComplete: true }).status, 'COMPLETE');
    assert.equal(evaluateExecutionCompleteness({ toolResults: [], orchestrationComplete: true }).status, 'INCOMPLETE');
    const error = createV5ToolError({ classification: 'EXECUTION_ERROR', code: 'X', retryable: false });
    const failed = createV5ToolResult({ taskId: 'task-1', toolName: 'x', status: 'failure', error, operationRefs: [] });
    assert.equal(evaluateExecutionCompleteness({ toolResults: [failed], orchestrationComplete: true }).status, 'FAILED');
    assert.equal(evaluateExecutionCompleteness({ executionRequired: false }).status, 'NOT_APPLICABLE');
});

test('evidence completeness checks required counts but ignores optional gaps', () => {
    const ledger = ledgerWith(item());
    assert.equal(evaluateEvidenceCompleteness(ledger, [requirement()]).status, 'COMPLETE');
    assert.equal(evaluateEvidenceCompleteness(createEvidenceLedger('task-1'), [requirement()]).status, 'INCOMPLETE');
    assert.equal(evaluateEvidenceCompleteness(createEvidenceLedger('task-1'), [requirement({ level: 'OPTIONAL' })]).status, 'NOT_APPLICABLE');
    assert.equal(evaluateEvidenceCompleteness(ledger, [requirement({ minimumCount: 2 })]).status, 'INCOMPLETE');
});

test('evidence validity distinguishes valid, stale, invalid and unknown', () => {
    assert.equal(evaluateEvidenceValidity(ledgerWith(item()), [requirement()]).status, 'VALID');
    assert.equal(evaluateEvidenceValidity(ledgerWith(item({ status: 'STALE', freshness: 'STALE' })), [requirement()]).status, 'STALE');
    assert.equal(evaluateEvidenceValidity(ledgerWith(item({ status: 'INVALID' })), [requirement()]).status, 'INVALID');
    assert.equal(evaluateEvidenceValidity(ledgerWith(item({ status: 'UNKNOWN', freshness: 'UNKNOWN' })), [requirement()]).status, 'UNKNOWN');
});

test('supportability enforces source trust, freshness, entity consistency and formal type', () => {
    assert.equal(evaluateSupportability(ledgerWith(item()), [requirement()]).status, 'SUPPORTED');
    assert.equal(evaluateSupportability(ledgerWith(item({ freshness: 'STALE', status: 'STALE' })), [requirement()]).status, 'UNSUPPORTED');
    const wrong = item({ entityRef: { entityType: 'coil', canonicalEntityId: 'synthetic-coil', resolutionReceiptRef: 'receipt' } });
    assert.equal(evaluateSupportability(ledgerWith(wrong), [requirement()]).status, 'UNSUPPORTED');
    assert.equal(evaluateEvidenceValidity(ledgerWith(wrong), [requirement()]).status, 'INVALID');
    const wrongCanonical = item({ entityRef: { entityType: 'part', canonicalEntityId: 'other-part', resolutionReceiptRef: 'receipt' } });
    const boundRequirement = requirement({ entityRef: { entityType: 'part', canonicalEntityId: 'synthetic-part' } });
    assert.equal(evaluateEvidenceValidity(ledgerWith(wrongCanonical), [boundRequirement]).status, 'INVALID');
    assert.equal(evaluateSupportability(ledgerWith(wrongCanonical), [boundRequirement]).status, 'UNSUPPORTED');
    const assumption = item({ evidenceType: 'ASSUMPTION', sourceType: 'USER_CLAIM', sourceTrust: 'UNVERIFIED', sourceRef: null });
    assert.equal(evaluateSupportability(ledgerWith(assumption), [requirement({ requiredEvidenceType: 'ASSUMPTION' })]).status, 'UNSUPPORTED');
});

test('valid derived fact is supported only from valid referenced formal evidence', () => {
    const derived = item({ evidenceId: 'derived', claimType: 'inventory.total', evidenceType: 'DERIVED_FACT', sourceType: 'DERIVATION', sourceTrust: 'DERIVED_FORMAL', derivation: { inputEvidenceIds: ['e-1'], derivationType: 'SUM', formulaId: 'synthetic-sum' } });
    const derivedRequirement = requirement({ requirementId: 'inventory-derived-total', claimType: 'inventory.total', requiredEvidenceType: 'DERIVED_FACT', minimumSourceTrust: 'DERIVED_FORMAL' });
    const ledger = ledgerWith(item(), derived);
    const result = verifyV5Task({ ledger, requirements: [derivedRequirement], execution: { toolResults: [successfulToolResult()], orchestrationComplete: true } });
    assert.equal(result.decision, 'VERIFIED');
});

test('valid direct fact scenario verifies deterministically', () => {
    const result = verifyV5Task({ ledger: ledgerWith(item()), requirements: [requirement()], execution: { toolResults: [successfulToolResult()], orchestrationComplete: true } });
    assert.equal(result.decision, 'VERIFIED');
});

test('missing, stale, assumption-only and invalid evidence never verify', () => {
    const scenarios = [
        { ledger: createEvidenceLedger('task-1'), expected: 'UNVERIFIED' },
        { ledger: ledgerWith(item({ status: 'STALE', freshness: 'STALE' })), expected: 'FAILED_EVIDENCE' },
        { ledger: ledgerWith(item({ evidenceType: 'ASSUMPTION', sourceType: 'USER_CLAIM', sourceTrust: 'UNVERIFIED', sourceRef: null })), expected: 'UNVERIFIED' },
        { ledger: ledgerWith(item({ status: 'INVALID' })), expected: 'FAILED_EVIDENCE' },
    ];
    for (const scenario of scenarios) {
        const result = verifyV5Task({ ledger: scenario.ledger, requirements: scenario.requirements || [requirement()], execution: { toolResults: [successfulToolResult()], orchestrationComplete: true } });
        assert.equal(result.decision, scenario.expected);
        assert.notEqual(result.decision, 'VERIFIED');
    }
});

test('invalid tool result is classified as FAILED_EXECUTION', () => {
    const error = createV5ToolError({ classification: 'EXECUTION_ERROR', code: 'X', retryable: false });
    const failed = createV5ToolResult({ taskId: 'task-1', toolName: 'search_parts', status: 'failure', error, operationRefs: [] });
    const result = verifyV5Task({ ledger: createEvidenceLedger('task-1'), requirements: [requirement()], execution: { toolResults: [failed], orchestrationComplete: true } });
    assert.equal(result.decision, 'FAILED_EXECUTION');
});

test('verification decision matrix covers every layer status combination', () => {
    const execution = ['COMPLETE', 'INCOMPLETE', 'FAILED', 'NOT_APPLICABLE'];
    const completeness = ['COMPLETE', 'INCOMPLETE', 'NOT_APPLICABLE'];
    const validity = ['VALID', 'INVALID', 'STALE', 'UNKNOWN'];
    const support = ['SUPPORTED', 'UNSUPPORTED', 'PARTIALLY_SUPPORTED'];
    let checked = 0;
    for (const e of execution) for (const c of completeness) for (const v of validity) for (const s of support) {
        const expected = ['FAILED', 'INCOMPLETE'].includes(e) ? 'FAILED_EXECUTION'
            : ['INVALID', 'STALE'].includes(v) ? 'FAILED_EVIDENCE'
                : c === 'INCOMPLETE' || v === 'UNKNOWN' || s !== 'SUPPORTED' ? 'UNVERIFIED' : 'VERIFIED';
        assert.equal(decisionFromLayerResults(e, c, v, s), expected, `${e}/${c}/${v}/${s}`);
        checked += 1;
    }
    assert.equal(checked, 144);
});

function taskAt(state) {
    const request = createV5ToolRequest({ taskId: 'task-1', toolName: 'search_parts', capability: 'inventory.read', rawArguments: {}, validatedArguments: {}, entityRefs: [], riskClass: 'L1', validationStatus: 'validated' });
    return createV5Task({ version: 1, taskId: 'task-1', state, createdAt: AT, updatedAt: AT, intent: null, entityContext: [], requestedCapability: 'inventory.read', execution: { toolRequest: request, toolResult: null }, verification: null, failure: null, metadata: {}, stateHistory: [] });
}

test('V5-A state integration requires task ledger before VERIFYING', () => {
    const task = taskAt('COLLECTING_EVIDENCE');
    assert.throws(() => transitionTask(task, 'VERIFYING', { executionCompleted: true, timestamp: AT }), { code: 'V5_STATE_TRANSITION_REJECTED' });
    const context = verificationTransitionContext(createEvidenceLedger('task-1'), true);
    assert.equal(transitionTask(task, 'VERIFYING', { ...context, timestamp: AT }).state, 'VERIFYING');
});

test('only VERIFIED decision can transition VERIFYING to COMPOSING', () => {
    const task = taskAt('VERIFYING');
    assert.throws(() => transitionTask(task, 'COMPOSING', { ...composingTransitionContext({ decision: 'UNVERIFIED' }), timestamp: AT }), { code: 'V5_STATE_TRANSITION_REJECTED' });
    assert.equal(transitionTask(task, 'COMPOSING', { ...composingTransitionContext({ decision: 'VERIFIED' }), timestamp: AT }).state, 'COMPOSING');
});

test('P06 verification symptoms are classified downstream and success controls remain accepted', () => {
    const evaluation = evaluateP06VerificationCases(p06Cases);
    assert.deepEqual(evaluation.metrics, {
        verificationFailureCasesAnalyzed: 6,
        rootCauses: 0,
        downstreamSymptoms: 6,
        insufficientData: 0,
        deterministicallyClassifiedCorrectly: 6,
        unknown: 0,
        c02CasesRechecked: 3,
        c02IncorrectlyCountedAsRootFix: 0,
        successControlCases: 7,
        successControlsFalselyRejected: 0,
    });
});
