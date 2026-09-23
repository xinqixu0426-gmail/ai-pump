'use strict';

// N6.1 deliberately stops at a formal preflight and server-issued card.  The
// existing confirmed-command service remains the sole execution path; wiring
// a task card to that command belongs to N6.2's operation reconciliation work.
const { executeToolCall } = require('../routes/ai/executor.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { stableHash } = require('./aiTaskContractV2.cjs');
const { executeConfirmedAiTool } = require('./aiConfirmedToolExecution.cjs');

const N6_1_WRITE_TOOLS = new Set(['adjust_part_stock', 'batch_update_prices']);

class AiTaskWriteBridgeError extends Error {
    constructor(code, message, statusCode = 409) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
}

function fail(code, message, statusCode) {
    throw new AiTaskWriteBridgeError(code, message, statusCode);
}

function assertPrepareRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('TASK_WRITE_REQUEST_INVALID', '写入预检请求无效', 400);
    const allowed = ['version', 'expectedRevision', 'goalKey', 'toolName', 'args'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !(key in value))) fail('TASK_WRITE_REQUEST_INVALID', '写入预检请求字段无效', 400);
    if (value.version !== 1 || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 1 || typeof value.goalKey !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(value.goalKey) || !N6_1_WRITE_TOOLS.has(value.toolName) || !value.args || typeof value.args !== 'object' || Array.isArray(value.args)) fail('TASK_WRITE_REQUEST_INVALID', '写入预检请求内容无效', 400);
    return value;
}

function requireWritableTask(task, request) {
    if (!task || task.executionMode !== 'DETACHED') fail('TASK_WRITE_DETACHED_REQUIRED', '只有后台任务可生成写入确认卡');
    if (task.spec.businessWritePolicy !== 'CONFIRMATION_REQUIRED') fail('TASK_WRITE_POLICY_FORBIDDEN', '当前任务不允许准备业务写入', 403);
    if (task.revision !== request.expectedRevision) fail('TASK_REVISION_CONFLICT', '任务已更新，请刷新后重试');
    const goal = task.spec.goals.find(item => item.goalKey === request.goalKey);
    if (!goal || !['PREPARE_CHANGE', 'APPLY_CHANGE'].includes(goal.kind)) fail('TASK_WRITE_GOAL_INVALID', '该目标不能准备业务写入', 409);
    if (['CANCELLED', 'FAILED', 'UNSUPPORTED', 'SUCCEEDED'].includes(task.state)) fail('TASK_WRITE_STATE_INVALID', '当前任务不能准备业务写入');
    return goal;
}

function nativeTaskContext(task, goalKey) {
    return Object.freeze({ taskId: task.taskKey, planRevision: task.planRevision, goalKey });
}

async function prepareAiTaskWriteConfirmationV2({ task, request, confirmationSubject, lifecycle, execute = executeToolCall }) {
    const parsed = assertPrepareRequest(request);
    const goal = requireWritableTask(task, parsed);
    if (typeof confirmationSubject !== 'string' || !confirmationSubject.trim()) fail('TASK_WRITE_SUBJECT_REQUIRED', '当前确认主体不可用', 401);
    const result = await execute(parsed.toolName, parsed.args, {
        allowWrite: false,
        confirmationSubject,
        executionContext: { nativeTask: nativeTaskContext(task, goal.goalKey) },
    });
    const confirmation = result?.confirmation;
    if (!result?.success || result.requiresConfirmation !== true || !confirmation?.confirmationToken || !confirmation.operationId) fail('TASK_WRITE_PREFLIGHT_INVALID', result?.error || '正式写入预检未生成有效确认卡', 422);

    // Keep only the opaque operation association durably.  Tokens and formal
    // preview contexts are intentionally process-local and never task data.
    const spec = structuredClone(task.spec);
    spec.approvalOperationIds = [...new Set([...spec.approvalOperationIds, confirmation.operationId])];
    const prepareGoal = spec.goals.find(item => item.goalKey === goal.goalKey);
    if (prepareGoal?.kind === 'PREPARE_CHANGE') prepareGoal.state = 'VERIFIED';
    const updated = lifecycle.transition(task.taskKey, task.revision, {
        state: 'WAITING_APPROVAL',
        spec,
        eventType: 'TASK_WRITE_PREFLIGHTED',
        eventPayload: { goalKey: goal.goalKey, toolName: parsed.toolName, operationId: confirmation.operationId },
    });
    return { task: updated, confirmation };
}

function assertExecuteRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('TASK_COMMAND_REQUEST_INVALID', '任务命令请求无效', 400);
    const allowed = ['version', 'expectedRevision', 'confirmationToken', 'toolName', 'args'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !(key in value))) fail('TASK_COMMAND_REQUEST_INVALID', '任务命令请求字段无效', 400);
    if (value.version !== 1 || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 1 || typeof value.confirmationToken !== 'string' || !value.confirmationToken || (value.toolName !== null && typeof value.toolName !== 'string') || (value.args !== null && (typeof value.args !== 'object' || Array.isArray(value.args)))) fail('TASK_COMMAND_REQUEST_INVALID', '任务命令请求内容无效', 400);
    return value;
}

function commandStepId(task, operationId) {
    return `command-${stableHash({ taskId: task.taskKey, planRevision: task.planRevision, operationId }).slice(0, 24)}`;
}

function updateExecutionSpec(task, goalKey, operationId, goalState) {
    const spec = structuredClone(task.spec);
    spec.approvalOperationIds = [...new Set([...spec.approvalOperationIds, operationId])];
    const goal = spec.goals.find(item => item.goalKey === goalKey);
    if (goal && goalState) goal.state = goalState;
    return spec;
}

function terminalForGoals(task, spec) {
    if (task.cancelRequestedAt) return 'PARTIAL';
    return spec.goals.every(goal => goal.state === 'VERIFIED') ? 'SUCCEEDED' : 'PARTIAL';
}

function knownBusinessRejection(error) {
    return Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500;
}

async function executeAiTaskConfirmedWriteV2({ task, request, confirmationSubject, lifecycle, executeConfirmed = executeConfirmedAiTool }) {
    const parsed = assertExecuteRequest(request);
    if (task.executionMode !== 'DETACHED' || task.spec.businessWritePolicy !== 'CONFIRMATION_REQUIRED' || task.state !== 'WAITING_APPROVAL' || task.revision !== parsed.expectedRevision) fail('TASK_COMMAND_ADMISSION_INVALID', '任务当前不能执行确认命令');
    let admitted = null;
    try {
        const receipt = await executeConfirmed({
            confirmationToken: parsed.confirmationToken,
            subject: confirmationSubject,
            expectedToolName: parsed.toolName || undefined,
            expectedArgs: parsed.args === null ? undefined : parsed.args,
            onAdmission: async consumed => {
                const nativeTask = consumed.executionContext?.nativeTask;
                if (!nativeTask || nativeTask.taskId !== task.taskKey || nativeTask.planRevision !== task.planRevision || typeof nativeTask.goalKey !== 'string') fail('TASK_COMMAND_CONTEXT_INVALID', '确认卡不属于当前任务版本');
                if (!task.spec.approvalOperationIds.includes(consumed.operationId) || !N6_1_WRITE_TOOLS.has(consumed.toolName)) fail('TASK_COMMAND_ADMISSION_INVALID', '确认卡未被当前任务正式签发');
                const capability = getAiCapability(consumed.toolName);
                if (!capability || capability.access !== 'write') fail('TASK_COMMAND_ADMISSION_INVALID', '确认能力无效');
                const contextKey = String(consumed.executionContext?.idempotencyKey || '').trim();
                if (!contextKey) fail('TASK_COMMAND_IDEMPOTENCY_MISSING', '正式预检缺少幂等关联');
                const stepId = commandStepId(task, consumed.operationId);
                let current = lifecycle.appendProtectedCommandStep(task.taskKey, task.revision, {
                    stepId, goalKeys: [nativeTask.goalKey], toolName: consumed.toolName, capabilityId: capability.capabilityId,
                    access: 'COMMAND', arguments: consumed.args, argumentSources: [], argsHash: stableHash(consumed.args),
                    state: 'PLANNED', attempt: 1, operationId: consumed.operationId, idempotencyKey: contextKey,
                    startedAt: null, finishedAt: null, errorCode: null, planRevision: task.planRevision,
                }).task;
                current = lifecycle.markStepRunning(task.taskKey, current.revision, stepId);
                current = lifecycle.transition(task.taskKey, current.revision, { state: 'RUNNING', eventType: 'STATE_CHANGED' });
                admitted = { stepId, goalKey: nativeTask.goalKey, task: current, confirmationOperationId: consumed.operationId };
            },
            onCompleted: async receipt => {
                if (!admitted) fail('TASK_COMMAND_ADMISSION_INVALID', '命令没有持久化准入记录');
                // A cancellation request may arrive after admission while the
                // formal API is running.  Continue from the durable revision;
                // the known receipt must not be discarded as a stale callback.
                const durable = lifecycle.store.getTaskByKey(task.taskKey);
                let current = lifecycle.completeStep(task.taskKey, durable.revision, admitted.stepId, { operationId: receipt.operationId });
                const spec = updateExecutionSpec(current, admitted.goalKey, receipt.operationId, 'VERIFIED');
                // A cancellation that races a submitted command can never erase
                // the known side effect.  Keep it reconcilable until the formal
                // operation lookup confirms the durable final result.
                if (current.cancelRequestedAt) {
                    current = lifecycle.transition(task.taskKey, current.revision, { state: 'RECONCILING', spec, eventType: 'COMMAND_RECONCILING', eventPayload: { operationId: receipt.operationId, stepKey: admitted.stepId, reason: 'CANCEL_AFTER_COMMAND' } });
                } else {
                    current = lifecycle.transition(task.taskKey, current.revision, { state: 'VERIFYING', spec, eventType: 'COMMAND_RECONCILED', eventPayload: { operationId: receipt.operationId, stepKey: admitted.stepId } });
                    const terminal = terminalForGoals(current, spec);
                    current = lifecycle.transition(task.taskKey, current.revision, { state: terminal, spec, eventType: terminal === 'SUCCEEDED' ? 'TASK_SUCCEEDED' : 'TASK_PARTIAL' });
                }
                admitted.task = current;
            },
        });
        return { task: admitted?.task || lifecycle.store.getTaskByKey(task.taskKey), receipt };
    } catch (error) {
        if (!admitted) throw error;
        const current = lifecycle.store.getTaskByKey(task.taskKey);
        if (knownBusinessRejection(error)) {
            const failed = lifecycle.failStep(task.taskKey, current.revision, admitted.stepId, { errorCode: error.code || 'FORMAL_COMMAND_REJECTED' });
            lifecycle.transition(task.taskKey, failed.revision, { state: 'FAILED', eventType: 'TASK_FAILED', eventPayload: { stepKey: admitted.stepId, reason: error.code || 'FORMAL_COMMAND_REJECTED' } });
        } else {
            const unknown = lifecycle.store.setStepState(task.taskKey, current.revision, admitted.stepId, 'UNKNOWN_EFFECT', { operationId: admitted.confirmationOperationId, errorCode: error.code || 'COMMAND_RESULT_UNKNOWN' });
            lifecycle.transition(task.taskKey, unknown.revision, { state: 'RECONCILING', eventType: 'COMMAND_RECONCILING', eventPayload: { stepKey: admitted.stepId, operationId: admitted.confirmationOperationId } });
        }
        throw error;
    }
}

async function reconcileAiTaskCommandV2({ task, lifecycle, readOperation }) {
    if (!task || task.state !== 'RECONCILING' || typeof readOperation !== 'function') fail('TASK_RECONCILIATION_INVALID', '当前任务不能执行命令对账');
    const steps = lifecycle.store.listSteps(task.taskKey)
        .filter(step => step.access === 'COMMAND' && ['RUNNING', 'UNKNOWN_EFFECT', 'SUCCEEDED'].includes(step.state));
    if (steps.length !== 1) fail('TASK_RECONCILIATION_INVALID', '当前任务没有唯一待对账命令');
    const step = steps[0];
    const formal = await readOperation({ task, step });
    if (!formal || ['MISSING', 'PENDING', 'AMBIGUOUS'].includes(formal.status)) {
        const current = lifecycle.store.mutateTask(task.taskKey, task.revision, () => ({
            eventType: 'COMMAND_RECONCILING',
            eventPayload: { stepKey: step.stepKey, operationId: step.operationId, status: formal?.status || 'MISSING' },
        }));
        return { task: current, resolved: false, status: formal?.status || 'MISSING' };
    }
    if (formal.status !== 'COMPLETED' || !formal.receipt) fail('TASK_RECONCILIATION_INVALID', '正式命令回读结果无效');
    let current = step.state === 'SUCCEEDED'
        ? lifecycle.store.getTaskByKey(task.taskKey)
        : lifecycle.completeReconciledCommandStep(task.taskKey, task.revision, step.stepKey, { operationId: formal.receipt.operationId });
    const goalKey = step.goalKeys[0];
    const spec = updateExecutionSpec(current, goalKey, formal.receipt.operationId, 'VERIFIED');
    current = lifecycle.transition(task.taskKey, current.revision, { state: 'VERIFYING', spec, eventType: 'COMMAND_RECONCILED', eventPayload: { stepKey: step.stepKey, operationId: formal.receipt.operationId } });
    const terminal = terminalForGoals(current, spec);
    current = lifecycle.transition(task.taskKey, current.revision, { state: terminal, spec, eventType: terminal === 'SUCCEEDED' ? 'TASK_SUCCEEDED' : 'TASK_PARTIAL' });
    return { task: current, receipt: formal.receipt, resolved: true, status: 'COMPLETED' };
}

module.exports = { AiTaskWriteBridgeError, N6_1_WRITE_TOOLS, assertExecuteRequest, assertPrepareRequest, commandStepId, executeAiTaskConfirmedWriteV2, nativeTaskContext, prepareAiTaskWriteConfirmationV2, reconcileAiTaskCommandV2, requireWritableTask };
