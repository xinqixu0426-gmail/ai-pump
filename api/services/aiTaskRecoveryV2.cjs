'use strict';

// Durable recovery is deliberately a read-only adapter.  It rebuilds only
// trusted state from the N5 tables; it neither calls a model nor invokes tools.
const crypto = require('node:crypto');
const { stableHash } = require('./aiTaskContractV2.cjs');
const { validateSpec, validateBudget } = require('./aiTaskStoreV2.cjs');

class AiTaskRecoveryError extends Error { constructor(code) { super(code); this.name = 'AiTaskRecoveryError'; this.code = code; } }
const fail = code => { throw new AiTaskRecoveryError(code); };
const read = (db, sql, ...params) => db.prepare(sql).all(...params);
const hash = text => crypto.createHash('sha256').update(text).digest('hex');

function sourceMessagesFor(db, task) {
    const rows = read(db, `SELECT m.id, m.content FROM ai_conversation_messages m
        JOIN ai_conversations c ON c.id=m.conversation_id
        WHERE m.conversation_id=? AND c.owner_key=? AND c.deleted_at IS NULL AND m.role='user'
        ORDER BY m.id`, task.conversationId, task.ownerKey);
    const byId = new Map(rows.map(row => [Number(row.id), row]));
    const initial = byId.get(task.userMessageId);
    if (!initial || hash(initial.content) !== task.inputHash) fail('TASK_SOURCE_MESSAGE_CHANGED');
    const refs = task.spec.recovery?.sourceMessageIds || { [`msg:durable:${task.userMessageId}`]: task.userMessageId };
    const restored = new Map();
    for (const [messageRef, messageId] of Object.entries(refs)) {
        const message = byId.get(Number(messageId));
        if (!message) fail('TASK_SOURCE_MESSAGE_UNAVAILABLE');
        restored.set(messageRef, message.content);
    }
    return restored;
}
function activeFactProjection(facts) {
    const superseded = new Set([...facts.values()].map(fact => fact.supersedesFactId).filter(Boolean));
    return new Map([...facts].filter(([factId]) => !superseded.has(factId)));
}
function classifySteps(task, steps, receipts) {
    const reusable = []; const interrupted = []; const blocked = [];
    for (const step of steps) {
        const samePlan = step.planRevision === task.planRevision;
        const trustedReceipt = step.receiptKey ? receipts.get(step.receiptKey) : null;
        if (step.state === 'SUCCEEDED') {
            if (samePlan && trustedReceipt && trustedReceipt.toolName === step.toolName && trustedReceipt.capabilityId === step.capabilityId && trustedReceipt.argsHash === step.argsHash) reusable.push(step);
            else blocked.push({ stepKey: step.stepKey, code: 'RECOVERY_INTEGRITY_FAILURE' });
        } else if (samePlan && ['QUERY', 'PREVIEW'].includes(step.access) && step.state === 'RUNNING' && !step.receiptKey) {
            if (step.attempt < 2) interrupted.push(step); else blocked.push({ stepKey: step.stepKey, code: 'RECOVERY_RETRY_LIMIT' });
        } else if (step.access === 'COMMAND' && (step.state === 'RUNNING' || step.state === 'UNKNOWN_EFFECT' || step.operationId)) blocked.push({ stepKey: step.stepKey, code: 'COMMAND_RECONCILIATION_REQUIRED' });
    }
    return { reusable, interrupted, blocked };
}
function envelopeFromDurable(task, steps, facts) {
    const spec = task.spec;
    const recovery = spec.recovery;
    if (!recovery) fail('TASK_RECOVERY_PLAN_MISSING');
    return {
        version: 2, taskId: task.taskKey, parentTaskId: task.parentTaskId ? String(task.parentTaskId) : null,
        ownerKey: task.ownerKey, conversationId: String(task.conversationId), requestId: task.taskKey,
        revision: task.revision, planRevision: task.planRevision, state: task.state, answerOwner: 'TASK_V2', executionMode: task.executionMode,
        userGoal: spec.userGoal, inputHash: task.inputHash, createdAt: task.createdAt, updatedAt: task.updatedAt,
        constraints: { businessWritePolicy: spec.businessWritePolicy, ...task.budget.limits }, subjects: spec.subjects, goals: spec.goals, scenarios: spec.scenarios,
        steps: steps.map(step => ({ stepId: step.stepKey, goalKeys: step.goalKeys, toolName: step.toolName, capabilityId: step.capabilityId, access: step.access, arguments: step.arguments, argumentSources: step.argumentSources, argsHash: step.argsHash, state: step.state, attempt: step.attempt, startedAt: step.startedAt, finishedAt: step.finishedAt, receiptId: step.receiptKey, operationId: step.operationId, errorCode: step.errorCode })),
        facts: [...facts.values()], questions: spec.questions, approvalOperationIds: spec.approvalOperationIds, resultSummary: task.result?.answer || null, budgetUsage: task.budget.usage,
        sourceEvidence: [], sourceConflicts: [], sourceConfigComparisons: [], recoveryPlan: recovery,
    };
}
function createAiTaskRecoveryV2(options = {}) {
    const store = options.store || options.lifecycle?.store;
    const db = options.dbAccessors?.db || options.db;
    const now = options.clock ? Number(options.clock()) : Date.now();
    if (!store || !db) throw new Error('TASK_RECOVERY_CONTEXT_REQUIRED');
    function rehydrate(taskKey) {
        const loaded = store.loadValidatedEvidence(taskKey);
        const task = loaded.task;
        try { validateSpec(task.spec); validateBudget(task.budget); } catch { fail('TASK_STORAGE_INTEGRITY_FAILURE'); }
        const sourceMessages = sourceMessagesFor(db, task);
        const steps = store.listSteps(taskKey); const classifications = classifySteps(task, steps, loaded.receipts);
        const remainingActiveMs = Math.max(0, task.budget.limits.maxActiveMs - task.budget.usage.activeMs);
        const runtimeTask = task.spec.recovery ? envelopeFromDurable(task, steps, loaded.facts) : null;
        return {
            task, runtimeTask, proposal: task.spec.recovery?.proposal || null, pending: task.spec.recovery?.pending || null, sourceMessages, trustedReceipts: loaded.receipts, facts: loaded.facts,
            activeFacts: activeFactProjection(loaded.facts), steps, ...classifications,
            revalidation: loaded.revalidation, remainingActiveMs,
            executionDeadlineAt: new Date(now + remainingActiveMs).toISOString(),
            telemetry: { recoveredSteps: steps.length, reusedSucceededSteps: classifications.reusable.length, retriedInterruptedReadSteps: 0, recoveryBlockedSteps: classifications.blocked.length, avoidedToolCalls: classifications.reusable.length },
        };
    }
    function findReusableStep(context, { planRevision, capabilityId, toolName, args }) {
        const argsHash = stableHash(args);
        return context.reusable.find(step => step.planRevision === planRevision && step.capabilityId === capabilityId && step.toolName === toolName && step.argsHash === argsHash) || null;
    }
    return { rehydrate, findReusableStep };
}
module.exports = { AiTaskRecoveryError, activeFactProjection, classifySteps, envelopeFromDurable, createAiTaskRecoveryV2 };
