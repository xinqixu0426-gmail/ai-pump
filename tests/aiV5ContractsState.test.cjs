'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    V5_CONTRACT_VERSION,
    V5_TASK_STATES,
    V5_TOOL_ERROR_CLASSES,
    createV5EntityReference,
    createV5Task,
    createV5ToolError,
    createV5ToolRequest,
    createV5ToolResult,
    validateToolRequestForExecution,
    validateV5Task,
} = require('../api/services/ai-v5/contracts.cjs');
const {
    V5_ALLOWED_TRANSITIONS,
    V5_TERMINAL_STATES,
    canTransition,
    transitionTask,
} = require('../api/services/ai-v5/taskState.cjs');
const { createEvidenceLedger } = require('../api/services/ai-v5/evidenceLedger.cjs');

const AT = '2026-09-04T00:00:00.000Z';
const LATER = '2026-09-04T00:00:01.000Z';

function validatedRequest(overrides = {}) {
    return createV5ToolRequest({
        version: V5_CONTRACT_VERSION,
        taskId: 'task-001',
        toolName: 'test_tool',
        capability: 'test.read',
        rawArguments: { query: 'raw' },
        validatedArguments: { query: 'validated' },
        entityRefs: [],
        riskClass: 'L1',
        validationStatus: 'validated',
        ...overrides,
    });
}

function taskAt(state = 'RECEIVED', overrides = {}) {
    return createV5Task({
        version: V5_CONTRACT_VERSION,
        taskId: 'task-001',
        state,
        createdAt: AT,
        updatedAt: AT,
        intent: null,
        entityContext: [],
        requestedCapability: 'test.read',
        execution: { toolRequest: validatedRequest(), toolResult: null },
        verification: null,
        failure: null,
        metadata: {},
        stateHistory: [],
        ...overrides,
    });
}

const ALL_PRECONDITIONS = Object.freeze({
    timestamp: LATER,
    reasonCode: 'TEST_TRANSITION',
    executionCompleted: true,
    evidenceFree: true,
    verificationCompleted: true,
    verificationDecision: 'VERIFIED',
    answerSupported: true,
    openEvidenceRequirement: true,
    remainingBudget: true,
    untriedEligibleCapability: true,
});

const EXPECTED_TRANSITIONS = Object.freeze({
    RECEIVED: ['UNDERSTANDING', 'FAILED_INTERNAL'],
    UNDERSTANDING: ['RESOLVING_ENTITY', 'ROUTING', 'NEEDS_CLARIFICATION', 'FAILED_INTERNAL'],
    RESOLVING_ENTITY: ['ROUTING', 'NEEDS_CLARIFICATION', 'FAILED_EVIDENCE', 'FAILED_INTERNAL'],
    ROUTING: ['EXECUTING', 'NEEDS_CLARIFICATION', 'BLOCKED_POLICY', 'FAILED_EVIDENCE', 'FAILED_INTERNAL'],
    EXECUTING: ['COLLECTING_EVIDENCE', 'FAILED_TOOL', 'BLOCKED_POLICY', 'FAILED_INTERNAL'],
    COLLECTING_EVIDENCE: ['ROUTING', 'VERIFYING', 'NEEDS_CLARIFICATION', 'FAILED_EVIDENCE', 'FAILED_INTERNAL'],
    VERIFYING: ['COMPOSING', 'ROUTING', 'NEEDS_CLARIFICATION', 'FAILED_EVIDENCE', 'FAILED_INTERNAL'],
    COMPOSING: ['COMPLETED', 'FAILED_EVIDENCE', 'FAILED_INTERNAL'],
    COMPLETED: [],
    NEEDS_CLARIFICATION: [],
    BLOCKED_POLICY: [],
    FAILED_TOOL: [],
    FAILED_EVIDENCE: [],
    FAILED_INTERNAL: [],
});

test('V5Task contract is versioned, explicit, immutable, and serializable', () => {
    const task = taskAt();
    assert.equal(task.version, 1);
    assert.equal(task.state, 'RECEIVED');
    assert.equal(task.intent, null);
    assert.deepEqual(task.entityContext, []);
    assert.equal(Object.isFrozen(task), true);
    assert.doesNotThrow(() => JSON.stringify(task));
    assert.deepEqual(validateV5Task(task), task);
});

test('V5Task rejects unknown version, missing taskId, invalid state, and non-serializable values', () => {
    assert.throws(() => taskAt('RECEIVED', { version: 2 }), { code: 'V5_CONTRACT_VALIDATION_FAILED' });
    assert.throws(() => taskAt('RECEIVED', { taskId: '' }), { code: 'V5_CONTRACT_VALIDATION_FAILED' });
    assert.throws(() => taskAt('NOT_A_STATE'), { code: 'V5_CONTRACT_VALIDATION_FAILED' });
    assert.throws(() => taskAt('RECEIVED', { metadata: { bad: () => {} } }), { code: 'V5_CONTRACT_VALIDATION_FAILED' });
});

test('entity identity preserves raw mention separately from normalized mention and canonical ID', () => {
    const cases = [
        ['v750-tokoy-', 'v750-tokoy'],
        ['800平刀', '800平刀'],
        ['V750-A', 'v750-a'],
        ['00123', '00123'],
        ['--V750..A__', 'v750a'],
    ];
    for (const [rawMention, normalizedMention] of cases) {
        const ref = createV5EntityReference({
            version: 1,
            entityType: 'test_entity',
            rawMention,
            normalizedMention,
            canonicalEntityId: null,
        });
        assert.equal(ref.rawMention, rawMention);
        assert.equal(ref.normalizedMention, normalizedMention);
        assert.equal(ref.canonicalEntityId, null);
        assert.equal(Object.isFrozen(ref), true);
    }
});

test('entity identity rejects empty or invalid values without overwriting raw mention', () => {
    assert.throws(() => createV5EntityReference({ entityType: 'part', rawMention: '' }), {
        code: 'V5_CONTRACT_VALIDATION_FAILED',
    });
    assert.throws(() => createV5EntityReference({ entityType: 'part', rawMention: 800 }), {
        code: 'V5_CONTRACT_VALIDATION_FAILED',
    });
    assert.throws(() => createV5EntityReference({ entityType: '', rawMention: 'x' }), {
        code: 'V5_CONTRACT_VALIDATION_FAILED',
    });
    assert.throws(() => createV5EntityReference({
        entityType: 'part', rawMention: 'x', normalizedMention: '',
    }), { code: 'V5_CONTRACT_VALIDATION_FAILED' });
});

test('raw-only ToolRequest is not execution-ready and keeps raw arguments immutable', () => {
    const source = { query: 'v750-tokoy-' };
    const request = createV5ToolRequest({
        taskId: 'task-raw',
        toolName: 'test_tool',
        capability: 'test.read',
        rawArguments: source,
        entityRefs: [],
        riskClass: 'L1',
    });
    source.query = 'changed-after-create';
    assert.equal(request.rawArguments.query, 'v750-tokoy-');
    assert.equal(request.validatedArguments, null);
    assert.equal(request.validationStatus, 'raw');
    assert.equal(request.executionReady, false);
    assert.equal(validateToolRequestForExecution(request).valid, false);
});

test('validated ToolRequest uses a distinct stage and becomes execution-ready only with capability', () => {
    const raw = { query: 'raw' };
    const validated = { query: 'validated' };
    const request = validatedRequest({ rawArguments: raw, validatedArguments: validated });
    assert.notStrictEqual(request.rawArguments, request.validatedArguments);
    assert.deepEqual(request.rawArguments, raw);
    assert.deepEqual(request.validatedArguments, validated);
    assert.equal(request.executionReady, true);
    assert.equal(validateToolRequestForExecution(request).valid, true);

    const unresolved = validatedRequest({ capability: null });
    assert.equal(unresolved.executionReady, false);
    assert.equal(validateToolRequestForExecution(unresolved).valid, false);
});

test('ToolRequest rejects invalid argument stages and risk classes', () => {
    assert.throws(() => validatedRequest({ rawArguments: 'not-object' }), {
        code: 'V5_CONTRACT_VALIDATION_FAILED',
    });
    assert.throws(() => validatedRequest({ validatedArguments: null, validationStatus: 'validated' }), {
        code: 'V5_CONTRACT_VALIDATION_FAILED',
    });
    assert.throws(() => validatedRequest({ validationStatus: 'raw' }), {
        code: 'V5_CONTRACT_VALIDATION_FAILED',
    });
    assert.throws(() => validatedRequest({ riskClass: 'HIGH' }), {
        code: 'V5_CONTRACT_VALIDATION_FAILED',
    });
});

test('ToolResult requires explicit success/failure and structured ToolError', () => {
    const success = createV5ToolResult({
        taskId: 'task-001', toolName: 'test_tool', status: 'success', data: { count: 0 }, operationRefs: [],
    });
    assert.equal(success.status, 'success');
    assert.equal(success.error, null);

    for (const classification of V5_TOOL_ERROR_CLASSES) {
        const error = createV5ToolError({ classification, code: `TEST_${classification}`, retryable: false });
        const failure = createV5ToolResult({
            taskId: 'task-001', toolName: 'test_tool', status: 'failure', error, operationRefs: [],
        });
        assert.equal(failure.status, 'failure');
        assert.equal(failure.error.classification, classification);
        assert.equal(failure.data, null);
    }
    assert.throws(() => createV5ToolResult({ taskId: 'x', toolName: 'x', status: 'failure' }), {
        code: 'V5_CONTRACT_VALIDATION_FAILED',
    });
    assert.throws(() => createV5ToolResult({ taskId: 'x', toolName: 'x', status: true }), {
        code: 'V5_CONTRACT_VALIDATION_FAILED',
    });
});

test('declared transition table covers every state exactly once', () => {
    assert.deepEqual(Object.keys(V5_ALLOWED_TRANSITIONS).sort(), [...V5_TASK_STATES].sort());
    assert.deepEqual(V5_ALLOWED_TRANSITIONS, EXPECTED_TRANSITIONS);
    assert.equal(new Set(V5_TASK_STATES).size, 14);
});

test('all-state transition matrix implementation equals the declared table', () => {
    let checked = 0;
    for (const from of V5_TASK_STATES) {
        for (const to of V5_TASK_STATES) {
            assert.equal(
                canTransition(from, to),
                EXPECTED_TRANSITIONS[from].includes(to),
                `${from} -> ${to}`
            );
            checked += 1;
        }
    }
    assert.equal(checked, V5_TASK_STATES.length ** 2);
    assert.equal(checked, 196);
    assert.equal(canTransition('UNKNOWN', 'RECEIVED'), false);
});

test('every declared transition executes with satisfied orchestration prerequisites', () => {
    for (const from of V5_TASK_STATES) {
        for (const to of EXPECTED_TRANSITIONS[from]) {
            const next = transitionTask(taskAt(from), to, ALL_PRECONDITIONS);
            assert.equal(next.state, to, `${from} -> ${to}`);
            assert.deepEqual(next.stateHistory.at(-1), {
                from, to, timestamp: LATER, reasonCode: 'TEST_TRANSITION',
            });
        }
    }
});

test('every forbidden transition is rejected and cannot mutate the original task', () => {
    for (const from of V5_TASK_STATES) {
        for (const to of V5_TASK_STATES) {
            if (EXPECTED_TRANSITIONS[from].includes(to)) continue;
            const original = taskAt(from);
            const before = JSON.stringify(original);
            assert.throws(() => transitionTask(original, to, ALL_PRECONDITIONS), {
                code: 'V5_STATE_TRANSITION_REJECTED',
            }, `${from} -> ${to}`);
            assert.equal(JSON.stringify(original), before, `${from} -> ${to} mutated input`);
            assert.equal(original.state, from);
        }
    }
});

test('terminal states reject all subsequent transitions', () => {
    assert.deepEqual([...V5_TERMINAL_STATES].sort(), [
        'BLOCKED_POLICY', 'COMPLETED', 'FAILED_EVIDENCE', 'FAILED_INTERNAL',
        'FAILED_TOOL', 'NEEDS_CLARIFICATION',
    ].sort());
    for (const terminal of V5_TERMINAL_STATES) {
        for (const to of V5_TASK_STATES) {
            assert.throws(() => transitionTask(taskAt(terminal), to, ALL_PRECONDITIONS), {
                code: 'V5_STATE_TRANSITION_REJECTED',
            });
        }
    }
});

test('generic C02 jumps RECEIVED -> VERIFYING and ROUTING -> VERIFYING are rejected', () => {
    for (const state of ['RECEIVED', 'ROUTING']) {
        assert.throws(() => transitionTask(taskAt(state), 'VERIFYING', ALL_PRECONDITIONS), {
            code: 'V5_STATE_TRANSITION_REJECTED',
        });
    }
});

test('EXECUTING requires matching resolved capability and validated ToolRequest', () => {
    const rawRequest = createV5ToolRequest({
        taskId: 'task-001', toolName: 'test_tool', capability: 'test.read',
        rawArguments: {}, riskClass: 'L1', entityRefs: [],
    });
    assert.throws(() => transitionTask(taskAt('ROUTING', {
        execution: { toolRequest: rawRequest, toolResult: null },
    }), 'EXECUTING', ALL_PRECONDITIONS), { code: 'V5_STATE_TRANSITION_REJECTED' });

    assert.throws(() => transitionTask(taskAt('ROUTING', {
        requestedCapability: null,
    }), 'EXECUTING', ALL_PRECONDITIONS), { code: 'V5_STATE_TRANSITION_REJECTED' });

    assert.throws(() => transitionTask(taskAt('ROUTING', {
        requestedCapability: 'other.read',
    }), 'EXECUTING', ALL_PRECONDITIONS), { code: 'V5_STATE_TRANSITION_REJECTED' });

    assert.throws(() => transitionTask(taskAt('ROUTING', {
        execution: {
            toolRequest: validatedRequest({ taskId: 'different-task' }),
            toolResult: null,
        },
    }), 'EXECUTING', ALL_PRECONDITIONS), { code: 'V5_STATE_TRANSITION_REJECTED' });

    assert.equal(transitionTask(taskAt('ROUTING'), 'EXECUTING', ALL_PRECONDITIONS).state, 'EXECUTING');
});

test('VERIFYING requires completed execution plus task-scoped ledger or an explicit evidence-free path', () => {
    const task = taskAt('COLLECTING_EVIDENCE');
    assert.throws(() => transitionTask(task, 'VERIFYING', { timestamp: LATER }), {
        code: 'V5_STATE_TRANSITION_REJECTED',
    });
    assert.throws(() => transitionTask(task, 'VERIFYING', {
        timestamp: LATER, executionCompleted: true,
    }), { code: 'V5_STATE_TRANSITION_REJECTED' });
    assert.equal(transitionTask(task, 'VERIFYING', {
        timestamp: LATER,
        executionCompleted: true,
        evidenceLedger: createEvidenceLedger(task.taskId),
    }).state, 'VERIFYING');
    assert.equal(transitionTask(task, 'VERIFYING', {
        timestamp: LATER, evidenceFree: true,
    }).state, 'VERIFYING');
});

test('retry routing requires an open requirement, remaining budget, and an untried capability', () => {
    for (const state of ['COLLECTING_EVIDENCE', 'VERIFYING']) {
        assert.throws(() => transitionTask(taskAt(state), 'ROUTING', { timestamp: LATER }), {
            code: 'V5_STATE_TRANSITION_REJECTED',
        });
        assert.equal(transitionTask(taskAt(state), 'ROUTING', ALL_PRECONDITIONS).state, 'ROUTING');
    }
});

test('COMPOSING and COMPLETED enforce skeleton completion prerequisites', () => {
    assert.throws(() => transitionTask(taskAt('VERIFYING'), 'COMPOSING', { timestamp: LATER }), {
        code: 'V5_STATE_TRANSITION_REJECTED',
    });
    assert.equal(transitionTask(taskAt('VERIFYING'), 'COMPOSING', {
        timestamp: LATER, verificationCompleted: true, verificationDecision: 'VERIFIED',
    }).state, 'COMPOSING');
    assert.throws(() => transitionTask(taskAt('VERIFYING'), 'COMPOSING', {
        timestamp: LATER, verificationCompleted: true, verificationDecision: 'UNVERIFIED',
    }), { code: 'V5_STATE_TRANSITION_REJECTED' });
    assert.throws(() => transitionTask(taskAt('COMPOSING'), 'COMPLETED', { timestamp: LATER }), {
        code: 'V5_STATE_TRANSITION_REJECTED',
    });
    assert.equal(transitionTask(taskAt('COMPOSING'), 'COMPLETED', {
        timestamp: LATER, answerSupported: true,
    }).state, 'COMPLETED');
});
