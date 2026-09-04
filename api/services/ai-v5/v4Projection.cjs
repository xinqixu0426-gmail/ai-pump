'use strict';

const { V5_CONTRACT_VERSION, createV5Task } = require('./contracts.cjs');

const V4_TERMINAL_STATE_MAP = Object.freeze({
    completed: 'COMPLETED',
    needs_clarification: 'NEEDS_CLARIFICATION',
    budget_exhausted: 'FAILED_EVIDENCE',
    running: 'COLLECTING_EVIDENCE',
});

const PROJECTION_NOT_AVAILABLE = Object.freeze([
    'RAW_ENTITY_NOT_AVAILABLE',
    'VALIDATED_ARGUMENTS_NOT_AVAILABLE',
    'CAPABILITY_NOT_AVAILABLE',
    'EVIDENCE_NOT_AVAILABLE',
]);

function safeString(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function shadowTaskId(caseId) {
    return `v5-shadow-${caseId.replace(/[^A-Za-z0-9._:-]/g, '_')}`;
}

function projectV4FailureCaseToV5Task(caseEntry = {}, options = {}) {
    const caseId = safeString(caseEntry.case_id);
    const metadata = caseEntry.safe_structural_metadata;
    if (!caseId || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return Object.freeze({
            status: 'rejected',
            task: null,
            missing: Object.freeze(['CASE_ID_OR_SAFE_METADATA_REQUIRED']),
            source: 'P06_SAFE_STRUCTURAL_METADATA',
        });
    }

    const sourceTerminalState = safeString(metadata.terminal_state);
    const projectedState = V4_TERMINAL_STATE_MAP[sourceTerminalState] || 'RECEIVED';
    const missing = [...PROJECTION_NOT_AVAILABLE];
    if (!V4_TERMINAL_STATE_MAP[sourceTerminalState]) missing.push('MAPPABLE_V4_STATE_NOT_AVAILABLE');

    const timestamp = options.timestamp || '1970-01-01T00:00:00.000Z';
    const task = createV5Task({
        version: V5_CONTRACT_VERSION,
        taskId: shadowTaskId(caseId),
        state: projectedState,
        createdAt: timestamp,
        updatedAt: timestamp,
        intent: null,
        entityContext: [],
        requestedCapability: null,
        execution: { toolRequest: null, toolResult: null },
        verification: null,
        failure: safeString(caseEntry.failure_class)
            ? { sourceClass: caseEntry.failure_class }
            : null,
        metadata: {
            projection: 'V4_TO_V5_SHADOW',
            projectionCompleteness: 'incomplete',
            sourceCaseId: caseId,
            sourcePath: safeString(caseEntry.expected?.path),
            sourceResult: safeString(caseEntry.result),
            sourceTerminalState,
            sourceFailureClass: safeString(caseEntry.failure_class),
            mappedState: projectedState,
        },
        stateHistory: [],
    });

    return Object.freeze({
        status: 'partial',
        task,
        missing: Object.freeze(missing),
        source: 'P06_SAFE_STRUCTURAL_METADATA',
    });
}

function analyzeP06FailureAgainstV5A(caseEntry = {}) {
    const failureClass = safeString(caseEntry.failure_class);
    const first = caseEntry.first_divergence || {};
    if (failureClass === 'C02') {
        const evidence = `${first.expected_stage || ''} ${first.actual_stage || ''} ${first.first_divergent_event || ''}`;
        const wouldBlock = /terminate after required evidence is satisfied/i.test(evidence)
            && /continued investigation|selected /i.test(evidence);
        return Object.freeze({
            failureClass,
            scope: 'STATE_CONTRACT',
            wouldBeBlocked: wouldBlock ? 'YES' : 'UNKNOWN',
            reason: wouldBlock
                ? 'POST_EVIDENCE_ROUTING_REQUIRES_OPEN_BOUNDED_REQUIREMENT'
                : 'NO_EXPLICIT_ILLEGAL_TRANSITION_IN_SAFE_METADATA',
        });
    }
    if (failureClass === 'A01') {
        return Object.freeze({
            failureClass,
            scope: 'TOOL_REQUEST_CONTRACT',
            wouldBeBlocked: 'YES',
            reason: 'NO_VALIDATED_ARGUMENTS_OR_PRESERVED_ENTITY_REFERENCE_AVAILABLE',
        });
    }
    if (failureClass === 'R02') {
        return Object.freeze({
            failureClass,
            scope: 'OUT_OF_SCOPE_V5_B',
            wouldBeBlocked: 'UNKNOWN',
            reason: 'CAPABILITY_ROUTING_NOT_IMPLEMENTED_IN_V5_A',
        });
    }
    return Object.freeze({
        failureClass,
        scope: 'NOT_APPLICABLE',
        wouldBeBlocked: 'UNKNOWN',
        reason: 'NO_V5_A_PRIMARY_CLASSIFICATION',
    });
}

function projectP06FailureCorpus(entries = [], options = {}) {
    if (!Array.isArray(entries)) {
        return Object.freeze({ total: 0, complete: 0, partial: 0, rejected: 1, projections: Object.freeze([]) });
    }
    const projections = entries.map(entry => Object.freeze({
        caseId: safeString(entry?.case_id),
        projection: projectV4FailureCaseToV5Task(entry, options),
        analysis: analyzeP06FailureAgainstV5A(entry),
    }));
    return Object.freeze({
        total: projections.length,
        complete: projections.filter(item => item.projection.status === 'complete').length,
        partial: projections.filter(item => item.projection.status === 'partial').length,
        rejected: projections.filter(item => item.projection.status === 'rejected').length,
        projections: Object.freeze(projections),
    });
}

module.exports = {
    PROJECTION_NOT_AVAILABLE,
    V4_TERMINAL_STATE_MAP,
    analyzeP06FailureAgainstV5A,
    projectP06FailureCorpus,
    projectV4FailureCaseToV5Task,
};
