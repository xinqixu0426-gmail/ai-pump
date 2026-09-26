'use strict';

/**
 * NATIVE-W1 —— Native 写 V1 桥（**只有一个能力**：单个零件库存调整）。
 *
 * 契约（严格按 ticket）：
 *   - 预检：只有 V1 白名单工具 + 单一目标 + 用户给出的非零整数增量才允许生成确认卡；
 *     预检调用**现有正式预览**（不新建预览引擎），并把结构化提案事实持久化到任务 spec。
 *   - 提案：`spec.writeV1.phase = 'PROPOSAL_READY'`，含冻结目标/参数哈希/幂等键/预览事实/提案哈希。
 *   - 批准：只有 Owner 才能批准（路由层强制）；批准事实在**执行之前**持久化为
 *     `spec.writeV1.approval`（`phase = 'CONFIRMED'`），且必须与冻结提案逐项一致。
 *   - 执行：`executeConfirmedAiTool`（唯一 allowWrite 通道）→ executor → internalApiClient → 业务 API；
 *     执行期不重新按名称解析目标，使用冻结的 partId/参数。
 *   - 提交：收到可信回执后 `phase = 'COMMITTED'`，随后用**独立回读**核验实际库存。
 *   - 对账：结果未知时进入 `RECONCILING`，按持久化幂等键查 `api_operations`；有界（次数+时间），
 *     用尽后安全失败，绝不对 MISSING/PENDING/AMBIGUOUS 自动重发。
 *
 * 状态映射（不新建编排运行时）：
 *   PROPOSAL_READY → task WAITING_APPROVAL；CONFIRMED → task RUNNING；COMMITTED → task VERIFYING；
 *   VERIFIED → task VERIFIED → SUCCEEDED/PARTIAL；FAILED_SAFE → task FAILED；未定 → task RECONCILING。
 */

const { executeToolCall } = require('../routes/ai/executor.cjs');
const { createInternalFetch, getJson } = require('../routes/ai/internalApiClient.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { stableHash } = require('./aiTaskContractV2.cjs');
const { executeConfirmedAiTool } = require('./aiConfirmedToolExecution.cjs');
const { verifyPartStockTargetState } = require('./aiPartExecution.cjs');
const {
    NATIVE_WRITE_V1_CAPABILITY,
    NATIVE_WRITE_V1_TOOLS,
    validateNativeWriteV1Request,
} = require('./aiNativeWriteScope.cjs');

/** 有界对账：最多尝试次数与最长等待时间（ticket §15）。 */
const RECONCILE_MAX_ATTEMPTS = 5;
const RECONCILE_MAX_ELAPSED_MS = 10 * 60 * 1000;

// 兼容旧名字：N6.1 曾允许两个工具，V1 收紧为单一能力。
const N6_1_WRITE_TOOLS = NATIVE_WRITE_V1_TOOLS;

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
    if (value.version !== 1 || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 1
        || typeof value.goalKey !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(value.goalKey)
        || typeof value.toolName !== 'string' || !value.args || typeof value.args !== 'object' || Array.isArray(value.args)) {
        fail('TASK_WRITE_REQUEST_INVALID', '写入预检请求内容无效', 400);
    }
    return value;
}

/** NATIVE-W1 范围判定：白名单（默认拒绝）+ 单一目标 + 用户给出的非零整数增量。 */
function assertNativeWriteV1Scope(request) {
    const scope = validateNativeWriteV1Request({ toolName: request.toolName, args: request.args });
    if (!scope.ok) fail(scope.code, scope.message, scope.statusCode);
    return scope;
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

/** 从正式预检结果构造不可变提案事实（只投影预览回执，不做业务计算）。 */
function buildProposalFacts({ scope, confirmation, now }) {
    const items = Array.isArray(confirmation?.proposal?.items) ? confirmation.proposal.items : null;
    if (!items || items.length !== 1) fail('TASK_WRITE_PROPOSAL_INVALID', '正式预览没有返回唯一的零件提案事实，不能生成确认卡', 422);
    const item = items[0];
    const partId = Number(item.partId);
    const currentStock = Number(item.currentStock);
    const nextStock = Number(item.nextStock);
    const delta = Number(item.delta);
    const model = String(item.model || '').trim();
    const idempotencyKey = String(confirmation?.idempotencyKey || '').trim();
    if (!Number.isInteger(partId) || partId < 1 || !model
        || !Number.isInteger(currentStock) || !Number.isInteger(nextStock) || !Number.isInteger(delta) || delta === 0) {
        fail('TASK_WRITE_PROPOSAL_INVALID', '正式预览返回的零件提案事实不完整', 422);
    }
    if (!idempotencyKey) fail('TASK_WRITE_IDEMPOTENCY_MISSING', '正式预览没有返回稳定幂等键', 422);
    const argsHash = String(confirmation?.argsHash || '');
    if (!/^[a-f0-9]{64}$/u.test(argsHash)) fail('TASK_WRITE_PROPOSAL_INVALID', '正式预览没有返回可核验的参数哈希', 422);
    const proposalHash = stableHash({
        version: 1, capabilityId: NATIVE_WRITE_V1_CAPABILITY, toolName: scope.toolName,
        partId, model, currentStock, delta, nextStock, argsHash, idempotencyKey,
    });
    return {
        version: 1,
        phase: 'PROPOSAL_READY',
        capabilityId: NATIVE_WRITE_V1_CAPABILITY,
        toolName: scope.toolName,
        target: { partId, model },
        delta,
        currentStock,
        nextStock,
        expectedUpdatedAt: item.expectedUpdatedAt || null,
        argsHash,
        proposalHash,
        idempotencyKey,
        previewFacts: [{
            partId, model, currentStock, delta, nextStock,
            expectedUpdatedAt: item.expectedUpdatedAt || null,
            clampedToZero: item.clampedToZero === true,
        }],
        proposedAt: now,
    };
}

/** 面向用户的提案视图：只有业务事实，不含 token / 哈希 / 内部术语。 */
function proposalView(writeV1) {
    if (!writeV1) return null;
    const { target, currentStock, delta, nextStock } = writeV1;
    const sign = delta > 0 ? '+' : '';
    return {
        partId: target.partId,
        model: target.model,
        currentStock,
        delta,
        nextStock,
        summary: `零件：${target.model}\n当前库存：${currentStock}\n调整：${sign}${delta}\n调整后：${nextStock}`,
    };
}

/** 执行/对账完成后的面向用户结论：只有核验通过才声称成功。 */
function outcomeView(writeV1) {
    if (!writeV1) return null;
    const verification = writeV1.verification;
    if (writeV1.phase === 'VERIFIED' && verification?.verified === true) {
        return {
            verified: true,
            partId: verification.partId ?? writeV1.target.partId,
            model: writeV1.target.model,
            stock: verification.stock ?? writeV1.nextStock,
            summary: `零件：${writeV1.target.model}\n库存已调整为 ${verification.stock ?? writeV1.nextStock}（已通过正式 API 回读核验）。`,
        };
    }
    if (writeV1.phase === 'FAILED_SAFE') {
        return {
            verified: false,
            code: writeV1.failure?.code || 'WRITE_FAILED_SAFE',
            reconfirmRequired: writeV1.failure?.reconfirmRequired === true,
            manualReviewRequired: writeV1.failure?.manualReviewRequired === true,
            summary: '本次没有形成已确认成功的库存调整；请勿重复提交，按提示重新预览并确认。',
        };
    }
    return null;
}

async function prepareAiTaskWriteConfirmationV2({ task, request, confirmationSubject, lifecycle, execute = executeToolCall, now = () => new Date().toISOString() }) {
    const parsed = assertPrepareRequest(request);
    const goal = requireWritableTask(task, parsed);
    const scope = assertNativeWriteV1Scope(parsed);
    if (typeof confirmationSubject !== 'string' || !confirmationSubject.trim()) fail('TASK_WRITE_SUBJECT_REQUIRED', '当前确认主体不可用', 401);
    // 有命令仍在执行/结果未定时，绝不允许用新提案覆盖旧提案。
    const inFlight = lifecycle.store.listSteps(task.taskKey)
        .some(step => step.access === 'COMMAND' && ['RUNNING', 'UNKNOWN_EFFECT'].includes(step.state));
    if (inFlight) fail('TASK_WRITE_INFLIGHT', '该任务已有写入正在执行或等待对账，不能重新生成确认卡', 409);
    const result = await execute(scope.toolName, scope.args, {
        allowWrite: false,
        confirmationSubject,
        executionContext: { nativeTask: nativeTaskContext(task, goal.goalKey) },
    });
    const confirmation = result?.confirmation;
    if (!result?.success || result.requiresConfirmation !== true || !confirmation?.confirmationToken || !confirmation.operationId) {
        fail('TASK_WRITE_PREFLIGHT_INVALID', result?.error || '正式写入预检未生成有效确认卡', 422);
    }
    const proposal = buildProposalFacts({ scope, confirmation, now: now() });

    // 只持久化不可变事实：token 与正式预览上下文保持进程内，绝不进任务数据。
    const spec = structuredClone(task.spec);
    spec.approvalOperationIds = [...new Set([...spec.approvalOperationIds, confirmation.operationId])];
    spec.writeV1 = proposal;
    const prepareGoal = spec.goals.find(item => item.goalKey === goal.goalKey);
    if (prepareGoal?.kind === 'PREPARE_CHANGE') prepareGoal.state = 'VERIFIED';
    const updated = lifecycle.transition(task.taskKey, task.revision, {
        state: 'WAITING_APPROVAL',
        spec,
        eventType: 'WRITE_PROPOSAL_READY',
        eventPayload: {
            goalKey: goal.goalKey, toolName: scope.toolName, capabilityId: proposal.capabilityId,
            partId: proposal.target.partId, delta: proposal.delta, currentStock: proposal.currentStock,
            nextStock: proposal.nextStock, proposalHash: proposal.proposalHash, operationId: confirmation.operationId,
        },
    });
    return { task: updated, confirmation, proposal: proposalView(proposal) };
}

function assertExecuteRequest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('TASK_COMMAND_REQUEST_INVALID', '任务命令请求无效', 400);
    const allowed = ['version', 'expectedRevision', 'confirmationToken', 'toolName', 'args'];
    if (Object.keys(value).some(key => !allowed.includes(key)) || allowed.some(key => !(key in value))) fail('TASK_COMMAND_REQUEST_INVALID', '任务命令请求字段无效', 400);
    if (value.version !== 1 || !Number.isInteger(value.expectedRevision) || value.expectedRevision < 1 || typeof value.confirmationToken !== 'string' || !value.confirmationToken) {
        fail('TASK_COMMAND_REQUEST_INVALID', '任务命令请求内容无效', 400);
    }
    return value;
}

function commandStepId(task, operationId) {
    return `command-${stableHash({ taskId: task.taskKey, planRevision: task.planRevision, operationId }).slice(0, 24)}`;
}

function terminalForGoals(task, spec) {
    if (task.cancelRequestedAt) return 'PARTIAL';
    return spec.goals.every(goal => goal.state === 'VERIFIED') ? 'SUCCEEDED' : 'PARTIAL';
}

function knownBusinessRejection(error) {
    return Number(error?.statusCode) >= 400 && Number(error?.statusCode) < 500;
}

/** 执行期冻结一致性：被消费的确认卡必须正好对应持久化的那个提案。 */
function assertFrozenProposalMatches(consumed, writeV1) {
    if (!writeV1 || writeV1.phase !== 'PROPOSAL_READY') fail('TASK_COMMAND_ADMISSION_INVALID', '任务没有处于待批准的冻结提案');
    if (consumed.toolName !== writeV1.toolName) fail('TASK_COMMAND_ADMISSION_INVALID', '确认卡能力与冻结提案不一致');
    if (consumed.argsHash !== writeV1.argsHash) fail('TASK_COMMAND_ADMISSION_INVALID', '确认卡参数与冻结提案不一致');
    const items = Array.isArray(consumed.args?.items) ? consumed.args.items : [];
    if (items.length !== 1) fail('TASK_COMMAND_ADMISSION_INVALID', '确认卡目标数量与冻结提案不一致');
    const item = items[0];
    if (String(item.model || '').trim() !== writeV1.target.model || Number(item.changeQty) !== writeV1.delta) {
        fail('TASK_COMMAND_ADMISSION_INVALID', '确认卡目标与冻结提案不一致');
    }
    const contextKey = String(consumed.executionContext?.idempotencyKey || '').trim();
    if (!contextKey) fail('TASK_COMMAND_IDEMPOTENCY_MISSING', '正式预检缺少幂等关联');
    if (contextKey !== writeV1.idempotencyKey) fail('TASK_COMMAND_IDEMPOTENCY_MISMATCH', '确认卡幂等键与冻结提案不一致');
    return contextKey;
}

/** 批准事实：只存主体指纹（不是原始凭据）、冻结哈希、目标与时间。 */
function buildApprovalFact(writeV1, { ownerSubject, idempotencyKey, approvedAt }) {
    return {
        proposalHash: writeV1.proposalHash,
        argsHash: writeV1.argsHash,
        capabilityId: writeV1.capabilityId,
        toolName: writeV1.toolName,
        targetPartId: writeV1.target.partId,
        ownerSubject: stableHash(String(ownerSubject)),
        approvedAt,
        idempotencyKey,
    };
}

function reconcileState(writeV1, at) {
    const previous = writeV1?.reconciliation || {};
    const attempts = Number.isInteger(previous.attempts) ? previous.attempts : 0;
    return {
        attempts: attempts + 1,
        firstAttemptAt: previous.firstAttemptAt || at,
        lastAttemptAt: at,
        deadlineAt: previous.deadlineAt || new Date(new Date(at).getTime() + RECONCILE_MAX_ELAPSED_MS).toISOString(),
        maxAttempts: RECONCILE_MAX_ATTEMPTS,
    };
}

/** 从执行回执里取独立回读结果（AI 层在执行期已经做过 GET /api/parts 核验）。 */
function verificationFromReceipt(receipt, writeV1) {
    const readback = Array.isArray(receipt?.result?.readback) ? receipt.result.readback : null;
    if (!readback || readback.length !== 1) return null;
    const part = readback[0];
    const at = new Date().toISOString();
    if (Number(part.id ?? part.partId) !== Number(writeV1.target.partId)) {
        return { verified: false, code: 'WRITE_VERIFICATION_TARGET_MISMATCH', reason: '回读目标与冻结提案不一致', at };
    }
    if (Number(part.stock) !== Number(writeV1.nextStock)) {
        return { verified: false, code: 'WRITE_VERIFICATION_STOCK_MISMATCH', reason: `回读库存 ${Number(part.stock)} 与冻结的调整后库存 ${writeV1.nextStock} 不一致`, at };
    }
    return { verified: true, partId: Number(part.id ?? part.partId), model: String(part.model || writeV1.target.model), stock: Number(part.stock), at };
}

/** 安全失败：终局 FAILED + 明确原因与恢复指引，绝不自动重发。 */
function failSafeTask({ lifecycle, task, goalKey, failure }) {
    const spec = structuredClone(task.spec);
    spec.writeV1 = { ...spec.writeV1, phase: 'FAILED_SAFE', failure };
    if (goalKey) {
        const goal = spec.goals.find(item => item.goalKey === goalKey);
        if (goal) goal.state = 'FAILED';
    }
    return lifecycle.transition(task.taskKey, task.revision, {
        state: 'FAILED',
        spec,
        eventType: 'WRITE_FAILED_SAFE',
        eventPayload: { goalKey: goalKey || null, code: failure.code, safe: true },
    });
}

async function executeAiTaskConfirmedWriteV2({ task, request, confirmationSubject, lifecycle, executeConfirmed = executeConfirmedAiTool, now = () => new Date().toISOString() }) {
    const parsed = assertExecuteRequest(request);
    if (task.executionMode !== 'DETACHED' || task.spec.businessWritePolicy !== 'CONFIRMATION_REQUIRED' || task.state !== 'WAITING_APPROVAL' || task.revision !== parsed.expectedRevision) {
        fail('TASK_COMMAND_ADMISSION_INVALID', '任务当前不能执行确认命令');
    }
    if (!task.spec.writeV1 || task.spec.writeV1.phase !== 'PROPOSAL_READY') {
        fail('TASK_COMMAND_ADMISSION_INVALID', '任务没有待批准的冻结提案，不能执行写入');
    }
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
                if (!task.spec.approvalOperationIds.includes(consumed.operationId) || !NATIVE_WRITE_V1_TOOLS.includes(consumed.toolName)) fail('TASK_COMMAND_ADMISSION_INVALID', '确认卡未被当前任务正式签发');
                const capability = getAiCapability(consumed.toolName);
                if (!capability || capability.access !== 'write') fail('TASK_COMMAND_ADMISSION_INVALID', '确认能力无效');
                const idempotencyKey = assertFrozenProposalMatches(consumed, task.spec.writeV1);

                // 批准事实必须在调用业务 API **之前**落盘（ticket §10）。
                const approvedAt = now();
                let current = lifecycle.store.mutateTask(task.taskKey, task.revision, state => {
                    const spec = structuredClone(state.spec);
                    spec.approvalOperationIds = [...new Set([...spec.approvalOperationIds, consumed.operationId])];
                    spec.writeV1 = {
                        ...spec.writeV1,
                        phase: 'CONFIRMED',
                        approval: buildApprovalFact(state.spec.writeV1, {
                            ownerSubject: confirmationSubject,
                            idempotencyKey,
                            approvedAt,
                        }),
                    };
                    return {
                        spec,
                        eventType: 'WRITE_APPROVED',
                        eventPayload: {
                            goalKey: nativeTask.goalKey, capabilityId: spec.writeV1.capabilityId,
                            partId: spec.writeV1.target.partId, delta: spec.writeV1.delta,
                            proposalHash: spec.writeV1.proposalHash, approvedAt,
                        },
                    };
                });
                const stepId = commandStepId(task, consumed.operationId);                current = lifecycle.appendProtectedCommandStep(task.taskKey, current.revision, {
                    stepId, goalKeys: [nativeTask.goalKey], toolName: consumed.toolName, capabilityId: capability.capabilityId,
                    access: 'COMMAND', arguments: consumed.args, argumentSources: [], argsHash: stableHash(consumed.args),
                    state: 'PLANNED', attempt: 1, operationId: consumed.operationId, idempotencyKey,
                    startedAt: null, finishedAt: null, errorCode: null, planRevision: task.planRevision,
                }).task;
                current = lifecycle.markStepRunning(task.taskKey, current.revision, stepId);
                current = lifecycle.transition(task.taskKey, current.revision, { state: 'RUNNING', eventType: 'STATE_CHANGED' });
                admitted = { stepId, goalKey: nativeTask.goalKey, task: current, confirmationOperationId: consumed.operationId };
            },
            onCompleted: async receipt => {
                if (!admitted) fail('TASK_COMMAND_ADMISSION_INVALID', '命令没有持久化准入记录');
                const durable = lifecycle.store.getTaskByKey(task.taskKey);
                let current = lifecycle.completeStep(task.taskKey, durable.revision, admitted.stepId, { operationId: receipt.operationId });
                const execution = {
                    operationId: receipt.operationId || null,
                    formalOperationIds: Array.isArray(receipt.formalOperationIds) ? receipt.formalOperationIds : [],
                    capabilityId: receipt.capabilityId || null,
                    status: receipt.status || null,
                    auditIds: Array.isArray(receipt.auditIds) ? receipt.auditIds : [],
                    idempotentReplay: receipt.idempotentReplay === true,
                    completedAt: receipt.completedAt || null,
                    at: now(),
                };
                const verification = verificationFromReceipt(receipt, current.spec.writeV1);
                const committed = structuredClone(current.spec);
                if (execution.operationId) {
                    committed.approvalOperationIds = [...new Set([...committed.approvalOperationIds, execution.operationId])];
                }
                committed.writeV1 = { ...committed.writeV1, phase: 'COMMITTED', execution, ...(verification ? { verification } : {}) };
                current = lifecycle.transition(task.taskKey, current.revision, {
                    state: 'VERIFYING', spec: committed, eventType: 'WRITE_EXECUTED',
                    eventPayload: {
                        goalKey: admitted.goalKey, partId: committed.writeV1.target.partId, delta: committed.writeV1.delta,
                        operationId: execution.operationId, verified: verification?.verified === true,
                        idempotentReplay: execution.idempotentReplay,
                    },
                });
                if (verification?.verified !== true) {
                    current = failSafeTask({
                        lifecycle, task: current, goalKey: admitted.goalKey,
                        failure: {
                            code: verification?.code || 'WRITE_VERIFICATION_MISSING',
                            reason: verification?.reason || '正式回执没有提供可核验的库存回读结果，不能声明执行成功',
                            safe: true, manualReviewRequired: true, at: now(),
                        },
                    });
                } else {
                    const verified = structuredClone(current.spec);
                    verified.writeV1 = { ...verified.writeV1, phase: 'VERIFIED' };
                    const goal = verified.goals.find(item => item.goalKey === admitted.goalKey);
                    if (goal) goal.state = 'VERIFIED';
                    // 任务状态机里没有 'VERIFIED' 状态（VERIFIED 是 goal / 提案阶段），
                    // 因此核验通过后直接进入终局状态，并把核验事实写进 spec 与事件。
                    const terminal = terminalForGoals({ ...current, spec: verified }, verified);
                    current = lifecycle.transition(task.taskKey, current.revision, {
                        state: terminal, spec: verified,
                        eventType: terminal === 'SUCCEEDED' ? 'TASK_SUCCEEDED' : 'TASK_PARTIAL',
                        eventPayload: {
                            goalKey: admitted.goalKey, partId: verified.writeV1.target.partId,
                            stock: verification.stock, verified: true, phase: 'VERIFIED',
                            operationId: execution.operationId,
                        },
                    });
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
            admitted.task = failSafeTask({
                lifecycle, task: failed, goalKey: admitted.goalKey,
                failure: {
                    code: error.code || 'FORMAL_COMMAND_REJECTED',
                    reason: error.message || '正式业务 API 拒绝了本次写入',
                    safe: true, at: now(),
                },
            });
        } else if (lifecycle.store.listSteps(task.taskKey).some(item => item.stepKey === admitted.stepId && item.state === 'RUNNING')) {
            // 结果未知：步骤仍在 RUNNING → UNKNOWN_EFFECT + RECONCILING，绝不自动重发。
            const unknown = lifecycle.store.setStepState(task.taskKey, current.revision, admitted.stepId, 'UNKNOWN_EFFECT', { operationId: admitted.confirmationOperationId, errorCode: error.code || 'COMMAND_RESULT_UNKNOWN' });
            const spec = structuredClone(unknown.spec);
            spec.writeV1 = { ...spec.writeV1, phase: 'RECONCILING', reconciliation: reconcileState(spec.writeV1, now()) };
            admitted.task = lifecycle.transition(task.taskKey, unknown.revision, {
                state: 'RECONCILING', spec, eventType: 'COMMAND_RECONCILING',
                eventPayload: { stepKey: admitted.stepId, operationId: admitted.confirmationOperationId },
            });
        } else {
            // 已经拿到回执但后续事实写入/核验失败：既不能当作"未定"重发，也绝不能声称成功 → 安全失败。
            admitted.task = failSafeTask({
                lifecycle, task: current, goalKey: admitted.goalKey,
                failure: {
                    code: error.code || 'WRITE_BOOKKEEPING_FAILED',
                    reason: error.message || '写入后的事实记录/核验失败，不能声明执行成功',
                    safe: true, manualReviewRequired: true, at: now(),
                },
            });
        }
        throw error;
    }
}

async function reconcileAiTaskCommandV2({ task, lifecycle, readOperation, verifyTarget = defaultVerifyTarget, now = () => new Date().toISOString() }) {
    if (!task || task.state !== 'RECONCILING' || typeof readOperation !== 'function') fail('TASK_RECONCILIATION_INVALID', '当前任务不能执行命令对账');
    if (!task.spec.writeV1) fail('TASK_RECONCILIATION_INVALID', '当前任务没有可对账的冻结提案');
    const steps = lifecycle.store.listSteps(task.taskKey)
        .filter(step => step.access === 'COMMAND' && ['RUNNING', 'UNKNOWN_EFFECT', 'SUCCEEDED'].includes(step.state));
    if (steps.length !== 1) fail('TASK_RECONCILIATION_INVALID', '当前任务没有唯一待对账命令');
    const step = steps[0];
    const writeV1 = task.spec.writeV1;
    const goalKey = step.goalKeys[0];
    const at = now();
    const reconciliation = reconcileState(writeV1, at);
    const formal = await readOperation({ task, step });
    const stage = patch => {
        const spec = structuredClone(task.spec);
        spec.writeV1 = { ...spec.writeV1, reconciliation, ...patch };
        return spec;
    };

    if (!formal || formal.status === 'MISSING') {
        // 单事务写入保证：没有 api_operations 行就等于没有提交。安全失败并要求重新确认，
        // 绝不自动重发；即便上一次调用仍在途，复用同一幂等键也不会产生第二次调整。
        const current = lifecycle.transition(task.taskKey, task.revision, {
            state: 'FAILED',
            spec: stage({
                phase: 'FAILED_SAFE',
                failure: {
                    code: 'OPERATION_MISSING',
                    reason: '正式操作记录不存在，本次没有形成已确认成功的写入；请重新预览并再次确认',
                    safe: true, reconfirmRequired: true, at,
                },
            }),
            eventType: 'WRITE_FAILED_SAFE',
            eventPayload: { stepKey: step.stepKey, status: 'MISSING', attempts: reconciliation.attempts },
        });
        return { task: current, resolved: false, status: 'MISSING' };
    }
    if (formal.status === 'AMBIGUOUS') {
        const current = lifecycle.transition(task.taskKey, task.revision, {
            state: 'FAILED',
            spec: stage({
                phase: 'FAILED_SAFE',
                failure: {
                    code: 'OPERATION_AMBIGUOUS',
                    reason: '正式操作记录不唯一，无法判定本次写入结果，需要人工核对',
                    safe: true, manualReviewRequired: true, at,
                },
            }),
            eventType: 'WRITE_FAILED_SAFE',
            eventPayload: { stepKey: step.stepKey, status: 'AMBIGUOUS', attempts: reconciliation.attempts },
        });
        return { task: current, resolved: false, status: 'AMBIGUOUS' };
    }
    if (formal.status === 'PENDING') {
        const bounded = reconciliation.attempts < RECONCILE_MAX_ATTEMPTS
            && new Date(reconciliation.deadlineAt).getTime() > new Date(at).getTime();
        if (bounded) {
            const current = lifecycle.transition(task.taskKey, task.revision, {
                state: 'RECONCILING',
                spec: stage({ phase: 'RECONCILING' }),
                eventType: 'COMMAND_RECONCILING',
                eventPayload: { stepKey: step.stepKey, status: 'PENDING', attempts: reconciliation.attempts, deadlineAt: reconciliation.deadlineAt },
            });
            return { task: current, resolved: false, status: 'PENDING' };
        }
        const current = lifecycle.transition(task.taskKey, task.revision, {
            state: 'FAILED',
            spec: stage({
                phase: 'FAILED_SAFE',
                failure: {
                    code: 'RECONCILIATION_BOUND_EXCEEDED',
                    reason: `正式操作在 ${reconciliation.attempts} 次对账（上限 ${RECONCILE_MAX_ATTEMPTS} 次、${Math.round(RECONCILE_MAX_ELAPSED_MS / 60000)} 分钟）内仍未完成，已安全终止，需要人工核对`,
                    safe: true, manualReviewRequired: true, at,
                },
            }),
            eventType: 'WRITE_FAILED_SAFE',
            eventPayload: { stepKey: step.stepKey, status: 'PENDING', attempts: reconciliation.attempts, boundExceeded: true },
        });
        return { task: current, resolved: false, status: 'PENDING' };
    }
    if (formal.status !== 'COMPLETED' || !formal.receipt) fail('TASK_RECONCILIATION_INVALID', '正式命令回读结果无效');

    // 已提交：先落 COMMITTED，再用独立回读核验实际库存，最后才允许 VERIFIED/SUCCEEDED。
    let current = step.state === 'SUCCEEDED'
        ? lifecycle.store.getTaskByKey(task.taskKey)
        : lifecycle.completeReconciledCommandStep(task.taskKey, task.revision, step.stepKey, { operationId: formal.receipt.operationId });
    const execution = {
        operationId: formal.receipt.operationId || null,
        capabilityId: formal.receipt.capabilityId || null,
        status: formal.receipt.status || 'completed',
        auditIds: Array.isArray(formal.receipt.auditIds) ? formal.receipt.auditIds : [],
        idempotentReplay: formal.receipt.idempotentReplay === true,
        completedAt: formal.receipt.completedAt || null,
        reconciledAt: at,
    };
    const committed = structuredClone(current.spec);
    committed.writeV1 = { ...committed.writeV1, reconciliation, phase: 'COMMITTED', execution };
    current = lifecycle.transition(task.taskKey, current.revision, {
        state: 'VERIFYING', spec: committed, eventType: 'COMMAND_RECONCILED',
        eventPayload: { stepKey: step.stepKey, operationId: execution.operationId, phase: 'COMMITTED' },
    });

    let verification = null;
    try {
        const observed = await verifyTarget({ target: { partId: writeV1.target.partId, nextStock: writeV1.nextStock } });
        verification = { verified: true, partId: observed.partId, model: observed.model, stock: observed.stock, at };
    } catch (error) {
        verification = { verified: false, code: error?.code || 'WRITE_VERIFICATION_FAILED', reason: error?.message || '回读核验失败', at };
    }
    if (verification.verified) {
        const verified = structuredClone(current.spec);
        verified.writeV1 = { ...verified.writeV1, verification, phase: 'VERIFIED' };
        const goal = verified.goals.find(item => item.goalKey === goalKey);
        if (goal) goal.state = 'VERIFIED';
        const terminal = terminalForGoals({ ...current, spec: verified }, verified);
        current = lifecycle.transition(task.taskKey, current.revision, {
            state: terminal, spec: verified,
            eventType: terminal === 'SUCCEEDED' ? 'TASK_SUCCEEDED' : 'TASK_PARTIAL',
            eventPayload: {
                stepKey: step.stepKey, partId: writeV1.target.partId, stock: verification.stock,
                verified: true, phase: 'VERIFIED', operationId: execution.operationId,
            },
        });
        return { task: current, resolved: true, status: 'COMPLETED', receipt: formal.receipt };
    }
    const failedSpec = structuredClone(current.spec);
    failedSpec.writeV1 = { ...failedSpec.writeV1, verification, phase: 'FAILED_SAFE', failure: { code: verification.code, reason: verification.reason, safe: true, manualReviewRequired: true, at } };
    const failedGoal = failedSpec.goals.find(item => item.goalKey === goalKey);
    if (failedGoal) failedGoal.state = 'FAILED';
    current = lifecycle.transition(task.taskKey, current.revision, {
        state: 'FAILED', spec: failedSpec, eventType: 'WRITE_FAILED_SAFE',
        eventPayload: { stepKey: step.stepKey, code: verification.code },
    });
    return { task: current, resolved: false, status: 'VERIFICATION_FAILED', receipt: formal.receipt };
}

/** 默认对账期回读：走正式业务 API（内部只读通道），不写任何数据。 */
async function defaultVerifyTarget({ target }) {
    const internalFetch = createInternalFetch({ capabilityId: NATIVE_WRITE_V1_CAPABILITY });
    return verifyPartStockTargetState({ internalFetch, getJson, target });
}

module.exports = {
    AiTaskWriteBridgeError,
    N6_1_WRITE_TOOLS,
    NATIVE_WRITE_V1_TOOLS,
    RECONCILE_MAX_ATTEMPTS,
    RECONCILE_MAX_ELAPSED_MS,
    assertExecuteRequest,
    assertFrozenProposalMatches,
    assertNativeWriteV1Scope,
    assertPrepareRequest,
    buildProposalFacts,
    commandStepId,
    defaultVerifyTarget,
    executeAiTaskConfirmedWriteV2,
    nativeTaskContext,
    outcomeView,
    prepareAiTaskWriteConfirmationV2,
    proposalView,
    reconcileAiTaskCommandV2,
    requireWritableTask,
};
