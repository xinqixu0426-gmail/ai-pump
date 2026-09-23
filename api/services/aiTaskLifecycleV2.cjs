'use strict';

const { TASK_TRANSITIONS_V2, TERMINAL_TASK_STATES } = require('./aiTaskContractV2.cjs');
const { AiTaskStoreError, createAiTaskStoreV2 } = require('./aiTaskStoreV2.cjs');

function mergeDetachedBudgetCheckpoint(currentBudget, runtimeBudget, { iterationActiveMs = 0, activeMsBase = currentBudget.usage.activeMs } = {}) {
    if (!Number.isInteger(iterationActiveMs) || iterationActiveMs < 0 || !Number.isInteger(activeMsBase) || activeMsBase < 0) throw new AiTaskStoreError('TASK_ACTIVE_MS_INVALID');
    // Calls are reserved before dispatch by the durable Worker. A controller
    // snapshot is a mirror only and can never change these three ledgers.
    const usage = {
        modelCalls: currentBudget.usage.modelCalls,
        toolCalls: currentBudget.usage.toolCalls,
        apiCalls: currentBudget.usage.apiCalls,
        activeMs: Math.max(currentBudget.usage.activeMs, activeMsBase + iterationActiveMs),
    };
    const budget = { limits: currentBudget.limits, usage };
    if (usage.activeMs > budget.limits.maxActiveMs) throw new AiTaskStoreError('TASK_ACTIVE_BUDGET_EXCEEDED');
    return budget;
}
function planSemanticView(spec) {
    if (!spec) return spec;
    return {
        subjects: spec.subjects,
        goals: spec.goals.map(goal => {
            const semanticGoal = { ...goal };
            for (const key of ['state', 'factIds', 'blockers', 'requirements', 'sourceEvidenceIds']) delete semanticGoal[key];
            return semanticGoal;
        }),
        scenarios: spec.scenarios,
        questions: spec.questions.map(question => {
            const semanticQuestion = { ...question };
            delete semanticQuestion.answeredAt;
            return semanticQuestion;
        }),
    };
}

function createAiTaskLifecycleV2(options = {}) {
    const store = options.store || createAiTaskStoreV2(options);
    function createTask(input) { return store.createTask(input); }
    function transitionInternal(taskKey, expectedRevision, next, leaseContext = null) {
        return store.mutateTask(taskKey, expectedRevision, current => {
            if (TERMINAL_TASK_STATES.includes(current.state) || !TASK_TRANSITIONS_V2[current.state].includes(next.state)) throw new AiTaskStoreError('TASK_TRANSITION_INVALID');
            const planChanged = next.planChanged === true || (next.spec !== undefined && JSON.stringify(planSemanticView(current.spec)) !== JSON.stringify(planSemanticView(next.spec)));
            const planRevision = planChanged ? current.planRevision + 1 : current.planRevision;
            return { state: next.state, spec: next.spec, budget: next.budget, result: next.result, planRevision, eventType: next.eventType || (next.state === 'WAITING_INPUT' ? 'WAITING_INPUT' : 'STATE_CHANGED'), eventPayload: { from: current.state, to: next.state, planRevision, ...(next.eventPayload || {}) } };
        }, undefined, leaseContext);
    }
    function transition(taskKey, expectedRevision, next) { return transitionInternal(taskKey, expectedRevision, next); }
    function transitionLeased(taskKey, expectedRevision, lease, next) { return transitionInternal(taskKey, expectedRevision, next, lease); }
    function saveResult(taskKey, expectedRevision, result) { return store.mutateTask(taskKey, expectedRevision, () => ({ result, eventType: 'RESULT_UPDATED', eventPayload: { updated: true } })); }
    function saveResultLeased(taskKey, expectedRevision, lease, result) { return store.mutateTask(taskKey, expectedRevision, () => ({ result, eventType: 'RESULT_UPDATED', eventPayload: { updated: true } }), undefined, lease); }
    function revisePlan(taskKey, expectedRevision, spec) {
        return store.mutateTask(taskKey, expectedRevision, current => ({
            spec,
            planRevision: current.planRevision + 1,
            eventType: 'PLAN_REVISED',
            eventPayload: { fromPlanRevision: current.planRevision, toPlanRevision: current.planRevision + 1 },
        }));
    }
    function suspend(taskKey, expectedRevision, reason = null) { return transition(taskKey, expectedRevision, { state: 'SUSPENDED', eventType: 'TASK_SUSPENDED', ...(reason ? { eventPayload: { reason } } : {}) }); }
    function suspendLeased(taskKey, expectedRevision, lease, reason = null) { return transitionLeased(taskKey, expectedRevision, lease, { state: 'SUSPENDED', eventType: 'TASK_SUSPENDED', ...(reason ? { eventPayload: { reason } } : {}) }); }
    function appendPlannedStep(taskKey, expectedRevision, step) { return store.appendStep(taskKey, expectedRevision, step); }
    function appendProtectedCommandStep(taskKey, expectedRevision, step) { return store.appendProtectedCommandStep(taskKey, expectedRevision, step); }
    function appendPlannedStepLeased(taskKey, expectedRevision, lease, step) { return store.appendStep(taskKey, expectedRevision, step, undefined, lease); }
    function markStepRunning(taskKey, expectedRevision, stepKey) { return store.setStepState(taskKey, expectedRevision, stepKey, 'RUNNING'); }
    function markStepRunningLeased(taskKey, expectedRevision, lease, stepKey) { return store.setStepState(taskKey, expectedRevision, stepKey, 'RUNNING', {}, undefined, lease); }
    function completeStep(taskKey, expectedRevision, stepKey, metadata = {}) { return store.setStepState(taskKey, expectedRevision, stepKey, 'SUCCEEDED', metadata); }
    function completeReconciledCommandStep(taskKey, expectedRevision, stepKey, metadata = {}) { return store.setStepState(taskKey, expectedRevision, stepKey, 'SUCCEEDED', { ...metadata, reconciled: true }); }
    function completeStepLeased(taskKey, expectedRevision, lease, stepKey, metadata = {}) { return store.setStepState(taskKey, expectedRevision, stepKey, 'SUCCEEDED', metadata, undefined, lease); }
    function failStep(taskKey, expectedRevision, stepKey, metadata = {}) { return store.setStepState(taskKey, expectedRevision, stepKey, 'FAILED', metadata); }
    function appendReceipt(taskKey, expectedRevision, receipt) { return store.appendEvidence(taskKey, expectedRevision, { ...receipt, recordKind: 'RECEIPT', receiptKey: null, factKeyHash: null }); }
    function appendReceiptLeased(taskKey, expectedRevision, lease, receipt) { return store.appendEvidence(taskKey, expectedRevision, { ...receipt, recordKind: 'RECEIPT', receiptKey: null, factKeyHash: null }, undefined, lease); }
    function appendFact(taskKey, expectedRevision, fact) { return store.appendEvidence(taskKey, expectedRevision, { ...fact, recordKind: 'FACT' }); }
    function appendFactLeased(taskKey, expectedRevision, lease, fact) { return store.appendEvidence(taskKey, expectedRevision, { ...fact, recordKind: 'FACT' }, undefined, lease); }
    // A recovery checkpoint is a normalized server plan and its durable
    // execution artifacts. It deliberately excludes controller/session state.
    function persistControllerProgressLeased(taskKey, expectedRevision, lease, snapshot, recoveryPlan) {
        const runtimeTask = snapshot?.task;
        const receipts = snapshot?.trustedReceipts instanceof Map ? snapshot.trustedReceipts : new Map();
        if (!runtimeTask || runtimeTask.taskId !== taskKey || runtimeTask.executionMode !== 'DETACHED') throw new AiTaskStoreError('TASK_RUNTIME_SNAPSHOT_INVALID');
        runtimeTask.recoveryPlan = recoveryPlan;
        const storage = store.taskStorageFromEnvelope(runtimeTask);
        let revision = expectedRevision;
        let current = store.mutateTask(taskKey, revision, state => ({
            spec: storage.spec,
            budget: mergeDetachedBudgetCheckpoint(state.budget, storage.budget, { iterationActiveMs: snapshot.iterationActiveMs || 0, activeMsBase: recoveryPlan.activeMsBase ?? state.budget.usage.activeMs }),
            eventType: 'STATE_CHANGED', eventPayload: { checkpoint: true, planRevision: state.planRevision },
        }), undefined, lease);
        revision = current.revision;
        const persistedSteps = new Map(store.listSteps(taskKey).map(step => [step.stepKey, step]));
        for (const sourceStep of runtimeTask.steps) {
            const persisted = persistedSteps.get(sourceStep.stepId);
            if (persisted) {
                // Restart retries deliberately retain their original Step row.
                // A later controller checkpoint therefore completes that row
                // rather than silently dropping the recovered receipt.
                if (persisted.state === 'RUNNING' && sourceStep.state === 'SUCCEEDED') {
                    const receipt = sourceStep.receiptId ? receipts.get(sourceStep.receiptId) : null;
                    if (!receipt) throw new AiTaskStoreError('TASK_RUNTIME_RECEIPT_MISSING');
                    if (!store.listEvidence(taskKey).some(record => record.evidenceKey === receipt.receiptId)) {
                        current = appendReceiptLeased(taskKey, revision, lease, { evidenceKey: receipt.receiptId, planRevision: receipt.planRevision, payload: receipt, sourceHash: receipt.sourceHash, observedAt: receipt.observedAt }); revision = current.revision;
                    }
                    current = completeStepLeased(taskKey, revision, lease, sourceStep.stepId, { receiptKey: receipt.receiptId }); revision = current.revision;
                    persistedSteps.set(sourceStep.stepId, store.listSteps(taskKey).find(step => step.stepKey === sourceStep.stepId));
                }
                continue;
            }
            const planned = { ...sourceStep, planRevision: current.planRevision };
            current = appendPlannedStepLeased(taskKey, revision, lease, { ...planned, state: 'PLANNED', receiptId: null, operationId: null, startedAt: null, finishedAt: null, errorCode: null }).task; revision = current.revision;
            current = markStepRunningLeased(taskKey, revision, lease, sourceStep.stepId); revision = current.revision;
            const receipt = sourceStep.receiptId ? receipts.get(sourceStep.receiptId) : null;
            if (receipt && !store.listEvidence(taskKey).some(record => record.evidenceKey === receipt.receiptId)) { current = appendReceiptLeased(taskKey, revision, lease, { evidenceKey: receipt.receiptId, planRevision: receipt.planRevision, payload: receipt, sourceHash: receipt.sourceHash, observedAt: receipt.observedAt }); revision = current.revision; }
            if (sourceStep.state === 'SUCCEEDED') current = completeStepLeased(taskKey, revision, lease, sourceStep.stepId, { receiptKey: receipt?.receiptId || null });
            else if (sourceStep.state === 'FAILED') current = store.setStepState(taskKey, revision, sourceStep.stepId, 'FAILED', { errorCode: sourceStep.errorCode || 'TASK_RUNTIME_STEP_FAILED' }, undefined, lease);
            revision = current.revision;
            persistedSteps.set(sourceStep.stepId, store.listSteps(taskKey).find(step => step.stepKey === sourceStep.stepId));
        }
        const persistedEvidence = new Set(store.listEvidence(taskKey).map(record => record.evidenceKey));
        for (const fact of runtimeTask.facts) if (!persistedEvidence.has(fact.factId)) { current = appendFactLeased(taskKey, revision, lease, { evidenceKey: fact.factId, planRevision: fact.planRevision, receiptKey: fact.receiptId, factKeyHash: require('./aiTaskContractV2.cjs').stableHash(fact.key), payload: fact, sourceHash: fact.sourceHash, observedAt: fact.observedAt, supersedesKey: fact.supersedesFactId }); revision = current.revision; }
        return current;
    }
    // Controller V2 deliberately remains storage-agnostic.  This narrow
    // lifecycle adapter persists its already validated read-only snapshot
    // under a live lease; it is the sole bridge used by the detached worker.
    function persistControllerSnapshotLeased(taskKey, expectedRevision, lease, snapshot, result) {
        const runtimeTask = snapshot?.task;
        const receipts = snapshot?.trustedReceipts instanceof Map ? snapshot.trustedReceipts : new Map();
        if (!runtimeTask || runtimeTask.taskId !== taskKey || runtimeTask.executionMode !== 'DETACHED') throw new AiTaskStoreError('TASK_RUNTIME_SNAPSHOT_INVALID');
        const stored = store.getTaskByKey(taskKey);
        if (!stored || runtimeTask.planRevision !== stored.planRevision) throw new AiTaskStoreError('TASK_RUNTIME_SNAPSHOT_REVISION_INVALID');
        const storage = store.taskStorageFromEnvelope(runtimeTask);
        // A completed controller snapshot omits the storage-only recovery plan;
        // retain the already validated durable plan rather than erasing it.
        if (!storage.spec.recovery && stored.spec.recovery) storage.spec.recovery = stored.spec.recovery;
        let revision = expectedRevision;
        let current = store.mutateTask(taskKey, revision, state => ({
            state: 'VERIFYING', spec: storage.spec,
            budget: mergeDetachedBudgetCheckpoint(state.budget, storage.budget, { iterationActiveMs: snapshot.iterationActiveMs || 0, activeMsBase: stored.spec.recovery?.activeMsBase ?? state.budget.usage.activeMs }),
            eventType: 'STATE_CHANGED', eventPayload: { from: state.state, to: 'VERIFYING', planRevision: state.planRevision },
        }), undefined, lease);
        revision = current.revision;
        const persistedSteps = new Set(store.listSteps(taskKey).map(step => step.stepKey));
        for (const sourceStep of runtimeTask.steps) {
            if (persistedSteps.has(sourceStep.stepId)) continue;
            const planned = { ...sourceStep, planRevision: current.planRevision, state: 'PLANNED', receiptId: null, operationId: null, startedAt: null, finishedAt: null, errorCode: null };
            current = appendPlannedStepLeased(taskKey, revision, lease, planned).task; revision = current.revision;
            current = markStepRunningLeased(taskKey, revision, lease, sourceStep.stepId); revision = current.revision;
            const receipt = sourceStep.receiptId ? receipts.get(sourceStep.receiptId) : null;
            if (receipt && !store.listEvidence(taskKey).some(record => record.evidenceKey === receipt.receiptId)) {
                current = appendReceiptLeased(taskKey, revision, lease, { evidenceKey: receipt.receiptId, planRevision: receipt.planRevision, payload: receipt, sourceHash: receipt.sourceHash, observedAt: receipt.observedAt }); revision = current.revision;
            }
            if (sourceStep.state === 'SUCCEEDED') current = completeStepLeased(taskKey, revision, lease, sourceStep.stepId, { receiptKey: receipt?.receiptId || null });
            else if (sourceStep.state === 'FAILED') current = store.setStepState(taskKey, revision, sourceStep.stepId, 'FAILED', { errorCode: sourceStep.errorCode || 'TASK_RUNTIME_STEP_FAILED' }, undefined, lease);
            revision = current.revision;
        }
        const persistedEvidence = new Set(store.listEvidence(taskKey).map(record => record.evidenceKey));
        for (const fact of runtimeTask.facts) {
            if (persistedEvidence.has(fact.factId)) continue;
            current = appendFactLeased(taskKey, revision, lease, { evidenceKey: fact.factId, planRevision: fact.planRevision, receiptKey: fact.receiptId, factKeyHash: require('./aiTaskContractV2.cjs').stableHash(fact.key), payload: fact, sourceHash: fact.sourceHash, observedAt: fact.observedAt, supersedesKey: fact.supersedesFactId });
            revision = current.revision;
        }
        current = saveResultLeased(taskKey, revision, lease, result); revision = current.revision;
        if (runtimeTask.state !== 'VERIFYING') current = transitionLeased(taskKey, revision, lease, { state: runtimeTask.state });
        return current;
    }
    return { appendFact, appendFactLeased, appendPlannedStep, appendPlannedStepLeased, appendProtectedCommandStep, appendReceipt, appendReceiptLeased, completeReconciledCommandStep, completeStep, completeStepLeased, createTask, failStep, markStepRunning, markStepRunningLeased, prepareInterruptedReadRetryLeased: (taskKey, revision, lease, stepKey) => store.prepareInterruptedReadRetryLeased(taskKey, revision, lease.workerId, lease.leaseToken, stepKey), persistControllerProgressLeased, persistControllerSnapshotLeased, revisePlan, saveResult, saveResultLeased, store, suspend, suspendLeased, transition, transitionLeased };
}
module.exports = { createAiTaskLifecycleV2, mergeDetachedBudgetCheckpoint, planSemanticView };
