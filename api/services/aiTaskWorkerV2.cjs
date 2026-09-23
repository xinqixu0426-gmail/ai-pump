'use strict';

// The worker owns scheduling and leases only. Domain execution remains behind
// the injected N3/N4 runtime seam, so this module never reads business tables
// and never exposes a COMMAND path.
const crypto = require('node:crypto');
const { createAiTaskLifecycleV2 } = require('./aiTaskLifecycleV2.cjs');
const { runAiTaskControllerV2 } = require('./aiTaskControllerV2.cjs');
const { createAiTaskRecoveryV2 } = require('./aiTaskRecoveryV2.cjs');

const DEFAULT_LEASE_DURATION_MS = 30_000;
const DEFAULT_LEASE_RENEW_INTERVAL_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const TASK_WORKER_DEFAULT_ENABLED = false;
const TERMINAL = new Set(['SUCCEEDED', 'PARTIAL', 'UNSUPPORTED', 'FAILED', 'CANCELLED']);

class AiTaskWorkerError extends Error {
    constructor(code) { super(code); this.name = 'AiTaskWorkerError'; this.code = code; }
}
const fail = code => { throw new AiTaskWorkerError(code); };
const workerId = () => crypto.randomUUID();


// This adapter is intentionally a continuation seam, not a second runtime.
// It invokes the N3/N4 controller with a detached task identity and persists
// the controller's validated read-only snapshot through the leased lifecycle.
function createAiTaskControllerContinuationV2(options = {}) {
    if (typeof options.inputForTask !== 'function') throw new Error('TASK_CONTINUATION_INPUT_REQUIRED');
    const controller = options.controller || runAiTaskControllerV2;
    return async context => {
        const input = await options.inputForTask(context.task);
        if (!input || typeof input !== 'object') throw new AiTaskWorkerError('TASK_CONTINUATION_INPUT_INVALID');
        const recovery = context.task.spec?.recovery ? (options.recovery || createAiTaskRecoveryV2({ lifecycle: options.lifecycle, dbAccessors: options.dbAccessors, db: options.db, clock: options.clock })) : null;
        const hydrated = recovery ? recovery.rehydrate(context.task.taskKey) : null;
        if (context.task.state === 'SUSPENDED' && !hydrated) throw new AiTaskWorkerError('TASK_RECOVERY_PLAN_MISSING');
        if (hydrated?.blocked.some(item => item.code === 'RECOVERY_RETRY_LIMIT')) {
            const suspended = options.lifecycle.suspendLeased(context.task.taskKey, context.fence().revision, { workerId: context.workerId, leaseToken: context.task.lease.token }, 'READ_RETRY_EXHAUSTED');
            return { state: suspended.state, alreadyPersisted: true, result: { reason: 'READ_RETRY_EXHAUSTED' } };
        }
        const retrySteps = new Map();
        if (hydrated) for (const step of hydrated.interrupted) {
            const prepared = options.lifecycle.prepareInterruptedReadRetryLeased(context.task.taskKey, context.fence().revision, { workerId: context.workerId, leaseToken: context.task.lease.token }, step.stepKey);
            context.task = prepared;
            retrySteps.set(`${step.capabilityId}:${step.toolName}:${step.argsHash}`, { ...step, attempt: 2 });
        }
        let snapshot = null;
        const checkpoint = async value => {
            const durableSourceMessageIds = hydrated?.task?.spec?.recovery?.sourceMessageIds || context.task.spec?.recovery?.sourceMessageIds || {};
            const sourceMessageIds = Object.fromEntries([...value.sourceMessages.keys()].map(ref => [ref, durableSourceMessageIds[ref] || context.task.userMessageId]));
            const recoveryPlan = { version: 1, proposal: value.proposal, sourceMessageIds, pending: value.pending || null, activeMsBase: hydrated ? hydrated.task.budget.usage.activeMs : context.task.budget.usage.activeMs };
            const stored = options.lifecycle.persistControllerProgressLeased(context.task.taskKey, context.fence().revision, { workerId: context.workerId, leaseToken: context.task.lease.token }, value, recoveryPlan);
            context.task = stored;
            if (typeof options.afterProgress === 'function') await options.afterProgress({ snapshot: value, task: stored, hydrated: Boolean(hydrated) });
            return stored;
        };
        const controllerResult = await controller({ ...input, taskId: context.task.taskKey, executionMode: 'DETACHED' }, {
            ...(options.dependencies || {}),
            recoveredContext: hydrated,
            findRecoveredReceipt: hydrated ? descriptor => {
                const step = recovery.findReusableStep(hydrated, { planRevision: hydrated.task.planRevision, capabilityId: descriptor.capabilityId, toolName: descriptor.toolName, args: descriptor.args });
                return step ? hydrated.trustedReceipts.get(step.receiptKey) : null;
            } : null,
            beforeModelCall: context.beforeModelCall,
            beforeToolCall: request => {
                const key = `${request.request.descriptor.capabilityId}:${request.toolName}:${request.request.argsHash}`;
                if (retrySteps.has(key)) { context.fence(); retrySteps.delete(key); return context.task; }
                return context.beforeToolCall(request);
            },
            findInterruptedRetry: descriptor => retrySteps.get(`${descriptor.capabilityId}:${descriptor.toolName}:${descriptor.argsHash}`) || null,
            afterToolCall: async value => {
                context.afterToolCall(value);
                if (typeof options.afterDispatch === 'function') await options.afterDispatch(value);
            },
            onProgress: checkpoint,
            onValidatedTask: value => { snapshot = value; },
        });
        context.beforeResultWrite();
        if (!snapshot) throw new AiTaskWorkerError('TASK_CONTINUATION_SNAPSHOT_MISSING');
        const compactResult = {
            answer: typeof controllerResult?.answer === 'string' ? controllerResult.answer : '',
            detail: controllerResult?.detail && typeof controllerResult.detail === 'object' ? controllerResult.detail : null,
            outcome: controllerResult?.telemetry?.outcome || snapshot.task.state.toLowerCase(),
        };
        const task = options.lifecycle.persistControllerSnapshotLeased(
            context.task.taskKey, context.fence().revision,
            { workerId: context.workerId, leaseToken: context.task.lease.token }, snapshot, compactResult,
        );
        return { state: task.state, alreadyPersisted: true, result: undefined };
    };
}

function createAiTaskWorkerV2(options = {}) {
    const lifecycle = options.lifecycle || createAiTaskLifecycleV2(options);
    const store = lifecycle.store;
    const id = options.workerId || workerId();
    const leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    const leaseRenewIntervalMs = options.leaseRenewIntervalMs ?? DEFAULT_LEASE_RENEW_INTERVAL_MS;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const runtime = options.runtime;
    if (typeof runtime !== 'function') throw new Error('TASK_WORKER_RUNTIME_REQUIRED');
    if (![leaseDurationMs, leaseRenewIntervalMs, pollIntervalMs].every(value => Number.isInteger(value) && value > 0)) throw new Error('TASK_WORKER_CONFIG_INVALID');
    let timer = null; let stopped = false; let active = false;
    const telemetry = { workerId: id, claims: 0, notClaimed: 0, renewals: 0, leaseLost: 0, recoveries: 0, iterations: 0, modelCalls: 0, toolCalls: 0, apiCalls: 0 };

    function checked(taskKey, leaseToken) {
        const task = store.assertLease(taskKey, id, leaseToken);
        if (task.cancelRequestedAt) throw new AiTaskWorkerError('TASK_CANCEL_REQUESTED');
        return task;
    }
    function cancel(task, leaseToken) {
        const steps = store.listSteps(task.taskKey);
        const unknownEffect = steps.some(step => step.access === 'COMMAND' && (step.state === 'RUNNING' || step.operationId) || step.state === 'UNKNOWN_EFFECT');
        const state = unknownEffect ? 'RECONCILING' : 'CANCELLED';
        return lifecycle.transitionLeased(task.taskKey, task.revision, { workerId: id, leaseToken }, { state, eventType: state === 'CANCELLED' ? 'TASK_CANCELLED' : 'STATE_CHANGED' });
    }
    function advanceToResolving(task, leaseToken) {
        let current = task;
        if (current.state === 'NEW') current = lifecycle.transitionLeased(current.taskKey, current.revision, { workerId: id, leaseToken }, { state: 'UNDERSTANDING' });
        if (current.state === 'UNDERSTANDING' || current.state === 'SUSPENDED') current = lifecycle.transitionLeased(current.taskKey, current.revision, { workerId: id, leaseToken }, { state: 'RESOLVING', eventType: current.state === 'SUSPENDED' ? 'TASK_RECOVERED' : 'STATE_CHANGED' });
        if (current.state === 'RESOLVING') current = lifecycle.transitionLeased(current.taskKey, current.revision, { workerId: id, leaseToken }, { state: 'RUNNING' });
        return current;
    }
    async function runClaimed(task) {
        const token = task.lease.token;
        let current = task;
        let lost = false;
        const renew = () => {
            if (lost) return;
            const result = store.renewLease(task.taskKey, id, token, { leaseDurationMs });
            if (result.outcome !== 'LEASE_RENEWED') { lost = true; telemetry.leaseLost += 1; return; }
            telemetry.renewals += 1;
        };
        const interval = setInterval(renew, leaseRenewIntervalMs);
        const fence = () => {
            if (lost) fail('LEASE_FENCED');
            return checked(task.taskKey, token);
        };
        const reserve = increments => {
            const before = fence();
            current = store.reserveBudget(task.taskKey, before.revision, id, token, increments);
            telemetry.modelCalls += increments.modelCalls || 0;
            telemetry.toolCalls += increments.toolCalls || 0;
            telemetry.apiCalls += increments.apiCalls || 0;
            return current;
        };
        try {
            current = advanceToResolving(fence(), token);
            if (current.cancelRequestedAt) { current = cancel(current, token); return { outcome: 'CANCELLED', task: current }; }
            if (current.budget.usage.activeMs >= current.budget.limits.maxActiveMs) {
                current = lifecycle.suspendLeased(current.taskKey, current.revision, { workerId: id, leaseToken: token }, 'ACTIVE_BUDGET_EXHAUSTED');
                return { outcome: 'ACTIVE_BUDGET_EXHAUSTED', task: current };
            }
            const result = await runtime({
                task: current,
                workerId: id,
                fence,
                reserve,
                beforeModelCall: () => { fence(); return reserve({ modelCalls: 1 }); },
                beforeToolCall: () => { fence(); return reserve({ toolCalls: 1, apiCalls: 1 }); },
                afterToolCall: () => fence(),
                beforeStateWrite: () => fence(),
                beforeStepWrite: () => fence(),
                beforeEvidenceWrite: () => fence(),
                beforeResultWrite: () => fence(),
            });
            current = fence();
            if (result?.state && !TERMINAL.has(result.state) && !['WAITING_INPUT', 'WAITING_APPROVAL', 'SUSPENDED', 'RECONCILING'].includes(result.state)) fail('TASK_WORKER_RUNTIME_STATE_INVALID');
            if (!result?.alreadyPersisted && result?.result !== undefined) current = lifecycle.saveResultLeased(current.taskKey, current.revision, { workerId: id, leaseToken: token }, result.result);
            if (!result?.alreadyPersisted && result?.state && result.state !== current.state) current = lifecycle.transitionLeased(current.taskKey, current.revision, { workerId: id, leaseToken: token }, { state: result.state });
            if (result?.alreadyPersisted) current = store.getTaskByKey(task.taskKey);
            return { outcome: 'COMPLETED', task: current };
        } catch (error) {
            // Narrow test-only crash seam used to prove durable restart from a
            // genuinely expired lease.  It is never reachable without an
            // explicit injected hook and does not exist in the public runtime.
            if (error.code === 'TASK_TEST_CRASH' && options.testCrashLeavesLease === true) {
                lost = true;
                return { outcome: 'CRASHED', task: store.getTaskByKey(task.taskKey), errorCode: error.code };
            }
            if (error.code === 'TASK_CANCEL_REQUESTED') {
                const fresh = store.getTaskByKey(task.taskKey);
                if (fresh?.lease?.token === token) return { outcome: 'CANCELLED', task: cancel(fresh, token) };
            }
            if (error.code === 'LEASE_FENCED') return { outcome: 'LEASE_FENCED', task: store.getTaskByKey(task.taskKey) };
            const fresh = store.getTaskByKey(task.taskKey);
            if (fresh?.lease?.token === token && !TERMINAL.has(fresh.state)) {
                current = lifecycle.suspendLeased(fresh.taskKey, fresh.revision, { workerId: id, leaseToken: token });
                return { outcome: 'SUSPENDED', task: current, errorCode: error.code || error.message || 'TASK_WORKER_RUNTIME_FAILED' };
            }
            return { outcome: 'LEASE_FENCED', task: fresh || null };
        } finally {
            clearInterval(interval);
            if (!lost) store.releaseLease(task.taskKey, id, token);
        }
    }
    async function runOnce() {
        if (stopped || active) return { outcome: stopped ? 'WORKER_STOPPED' : 'WORKER_BUSY' };
        active = true; telemetry.iterations += 1;
        try {
            const claim = store.claimNextDetachedTask({ workerId: id, leaseDurationMs });
            if (claim.outcome !== 'LEASE_ACQUIRED') { telemetry.notClaimed += 1; return claim; }
            telemetry.claims += 1;
            return await runClaimed(claim.task);
        } finally { active = false; }
    }
    function start() {
        if (timer) return;
        telemetry.recoveries += store.recoverExpiredLeases().length;
        timer = setInterval(() => { void runOnce(); }, pollIntervalMs);
    }
    async function stop() { stopped = true; if (timer) { clearInterval(timer); timer = null; } while (active) await new Promise(resolve => setTimeout(resolve, 1)); }
    return { workerId: id, leaseDurationMs, leaseRenewIntervalMs, pollIntervalMs, runOnce, start, stop, telemetry: () => ({ ...telemetry }), recoverExpiredLeases: () => store.recoverExpiredLeases() };
}

module.exports = { AiTaskWorkerError, DEFAULT_LEASE_DURATION_MS, DEFAULT_LEASE_RENEW_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS, TASK_WORKER_DEFAULT_ENABLED, createAiTaskControllerContinuationV2, createAiTaskWorkerV2 };
