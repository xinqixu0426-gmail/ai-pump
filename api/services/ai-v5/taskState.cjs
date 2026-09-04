'use strict';

const {
    V5_TASK_STATES,
    createV5Task,
    validateToolRequestForExecution,
    validateV5Task,
} = require('./contracts.cjs');
const { validateLedger } = require('./evidenceLedger.cjs');

const V5_ALLOWED_TRANSITIONS = Object.freeze({
    RECEIVED: Object.freeze(['UNDERSTANDING', 'FAILED_INTERNAL']),
    UNDERSTANDING: Object.freeze([
        'RESOLVING_ENTITY',
        'ROUTING',
        'NEEDS_CLARIFICATION',
        'FAILED_INTERNAL',
    ]),
    RESOLVING_ENTITY: Object.freeze([
        'ROUTING',
        'NEEDS_CLARIFICATION',
        'FAILED_EVIDENCE',
        'FAILED_INTERNAL',
    ]),
    ROUTING: Object.freeze([
        'EXECUTING',
        'NEEDS_CLARIFICATION',
        'BLOCKED_POLICY',
        'FAILED_EVIDENCE',
        'FAILED_INTERNAL',
    ]),
    EXECUTING: Object.freeze([
        'COLLECTING_EVIDENCE',
        'FAILED_TOOL',
        'BLOCKED_POLICY',
        'FAILED_INTERNAL',
    ]),
    COLLECTING_EVIDENCE: Object.freeze([
        'ROUTING',
        'VERIFYING',
        'NEEDS_CLARIFICATION',
        'FAILED_EVIDENCE',
        'FAILED_INTERNAL',
    ]),
    VERIFYING: Object.freeze([
        'COMPOSING',
        'ROUTING',
        'NEEDS_CLARIFICATION',
        'FAILED_EVIDENCE',
        'FAILED_INTERNAL',
    ]),
    COMPOSING: Object.freeze(['COMPLETED', 'FAILED_EVIDENCE', 'FAILED_INTERNAL']),
    COMPLETED: Object.freeze([]),
    NEEDS_CLARIFICATION: Object.freeze([]),
    BLOCKED_POLICY: Object.freeze([]),
    FAILED_TOOL: Object.freeze([]),
    FAILED_EVIDENCE: Object.freeze([]),
    FAILED_INTERNAL: Object.freeze([]),
});

const V5_TERMINAL_STATES = Object.freeze([
    'COMPLETED',
    'NEEDS_CLARIFICATION',
    'BLOCKED_POLICY',
    'FAILED_TOOL',
    'FAILED_EVIDENCE',
    'FAILED_INTERNAL',
]);

class V5StateTransitionError extends Error {
    constructor(message, details = {}) {
        super(message);
        this.name = 'V5StateTransitionError';
        this.code = 'V5_STATE_TRANSITION_REJECTED';
        this.details = Object.freeze({ ...details });
    }
}

function validState(state) {
    return V5_TASK_STATES.includes(state);
}

function canTransition(from, to) {
    return validState(from)
        && validState(to)
        && V5_ALLOWED_TRANSITIONS[from].includes(to);
}

function transitionFailure(from, to, reason) {
    throw new V5StateTransitionError(`V5 状态转换被拒绝: ${from} -> ${to}`, {
        from,
        to,
        reason,
    });
}

function assertTransitionPreconditions(task, to, context = {}) {
    if (to === 'EXECUTING') {
        if (context.policyDecision !== 'ALLOW') {
            transitionFailure(task.state, to, 'POLICY_ALLOW_REQUIRED');
        }
        if (!task.requestedCapability) {
            transitionFailure(task.state, to, 'CAPABILITY_NOT_RESOLVED');
        }
        const checked = validateToolRequestForExecution(task.execution.toolRequest);
        if (!checked.valid) {
            transitionFailure(task.state, to, 'VALIDATED_TOOL_REQUEST_REQUIRED');
        }
        if (checked.request.taskId !== task.taskId) {
            transitionFailure(task.state, to, 'TASK_REQUEST_MISMATCH');
        }
        if (checked.request.capability !== task.requestedCapability) {
            transitionFailure(task.state, to, 'CAPABILITY_REQUEST_MISMATCH');
        }
    }

    if (to === 'VERIFYING') {
        if (context.executionCompleted !== true && context.evidenceFree !== true) {
            transitionFailure(task.state, to, 'EXECUTION_OR_EVIDENCE_FREE_PATH_REQUIRED');
        }
        if (context.evidenceFree !== true) {
            let ledger;
            try {
                ledger = validateLedger(context.evidenceLedger);
            } catch {
                transitionFailure(task.state, to, 'VALID_TASK_EVIDENCE_LEDGER_REQUIRED');
            }
            if (ledger.taskId !== task.taskId) {
                transitionFailure(task.state, to, 'TASK_EVIDENCE_LEDGER_REQUIRED');
            }
        }
    }

    if (to === 'COMPOSING' && (
        context.verificationCompleted !== true
        || context.verificationDecision !== 'VERIFIED'
    )) {
        transitionFailure(task.state, to, 'VERIFIED_DECISION_REQUIRED');
    }

    if (to === 'COMPLETED' && context.answerSupported !== true) {
        transitionFailure(task.state, to, 'ANSWER_SUPPORT_REQUIRED');
    }

    if (to === 'ROUTING' && ['COLLECTING_EVIDENCE', 'VERIFYING'].includes(task.state)) {
        if (context.openEvidenceRequirement !== true
            || context.remainingBudget !== true
            || context.untriedEligibleCapability !== true) {
            transitionFailure(task.state, to, 'BOUNDED_EVIDENCE_RETRY_REQUIRED');
        }
    }
}

function transitionTask(inputTask, to, context = {}) {
    const task = validateV5Task(inputTask);
    if (!validState(to)) transitionFailure(task.state, to, 'UNKNOWN_TARGET_STATE');
    if (V5_TERMINAL_STATES.includes(task.state)) {
        transitionFailure(task.state, to, 'TERMINAL_STATE');
    }
    if (!canTransition(task.state, to)) {
        transitionFailure(task.state, to, 'TRANSITION_NOT_ALLOWED');
    }
    assertTransitionPreconditions(task, to, context);

    const timestamp = context.timestamp || new Date().toISOString();
    const reasonCode = context.reasonCode || 'STATE_TRANSITION';
    return createV5Task({
        ...task,
        state: to,
        updatedAt: timestamp,
        stateHistory: [
            ...task.stateHistory,
            { from: task.state, to, timestamp, reasonCode },
        ],
    });
}

module.exports = {
    V5_ALLOWED_TRANSITIONS,
    V5StateTransitionError,
    V5_TASK_STATES,
    V5_TERMINAL_STATES,
    assertTransitionPreconditions,
    canTransition,
    transitionTask,
};
