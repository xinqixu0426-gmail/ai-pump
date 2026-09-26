'use strict';

const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const { db, safeInsert, safeUpdate } = require('../../db.cjs');
const { createAiTaskLifecycleV2 } = require('../../services/aiTaskLifecycleV2.cjs');
const { prepareDetachedTaskV2 } = require('../../services/aiTaskControllerV2.cjs');
const { AiTaskWriteBridgeError, executeAiTaskConfirmedWriteV2, outcomeView, prepareAiTaskWriteConfirmationV2, reconcileAiTaskCommandV2 } = require('../../services/aiTaskWriteBridgeV2.cjs');
const { readTaskCommandOperationV2 } = require('../../services/aiTaskOperationReadbackV2.cjs');
const { confirmationSubjectForRequest } = require('../../services/aiToolConfirmation.cjs');
const { resolveAiNativeRollout } = require('../../services/aiNativeRolloutPolicy.cjs');
const { isAuthenticatedOwner, verifyAuthentication } = require('../../services/ownerAuthentication.cjs');
const {
    AiTaskPublicError, acknowledgement, assertTaskId, parseTaskCancel, parseTaskResume, parseTaskStart,
    publicEvents, publicView, requiredIdempotency, resumeSpec, bindResumeSources, taskRequestId,
} = require('../../services/aiTaskPublicV2.cjs');

function ownerMiddleware(req, res, next) {
    if (process.env.INTERNAL_SECRET && req.headers['x-internal-secret'] === process.env.INTERNAL_SECRET) {
        req.aiTaskOwner = 'internal'; return next();
    }
    return authMiddleware(req, res, () => { req.aiTaskOwner = req.user?.role || 'admin'; next(); });
}
function sendError(res, error) {
    const explicit = Number(error?.statusCode);
    const status = error instanceof AiTaskPublicError || error instanceof AiTaskWriteBridgeError
        ? error.statusCode || error.status
        : error?.code === 'TASK_REVISION_CONFLICT' ? 409
            : error?.code === 'TASK_NOT_FOUND' ? 404
                : Number.isInteger(explicit) && explicit >= 400 && explicit <= 599 ? explicit
                    : 400;
    return res.status(status).json({ success: false, code: error?.code || 'TASK_REQUEST_FAILED', error: error?.message || '任务请求失败', operationId: error?.operationId || null, requestId: res.req?.requestId || null });
}
function resolveTask(lifecycle, taskId, ownerKey) {
    assertTaskId(taskId);
    const task = lifecycle.store.getTaskForOwner(taskId, ownerKey);
    if (!task) throw new AiTaskPublicError('TASK_NOT_FOUND', 404, '任务不存在');
    return task;
}
function assertNativeWriteRollout(req, options = {}) {
    const rollout = (options.resolveAiNativeRollout || resolveAiNativeRollout)({
        request: req,
        env: options.env || process.env,
    });
    if (!rollout.nativeWriteAllowed) {
        throw new AiTaskPublicError('AI_NATIVE_WRITE_DISABLED', 403, 'AI Native 写入当前未开放');
    }
    return rollout;
}
/**
 * NATIVE-W1 §3：Native 写 rollout 门同样是**端点级**入口守卫，且排在 Owner 身份门之前。
 * 这里只判定**全局**写开关（`AI_NATIVE_WRITE_ENABLED`，生产默认 `false`）：
 * 写入未开放时，任何主体——Owner、非 Owner JWT、内部凭据——都得到 `AI_NATIVE_WRITE_DISABLED`，
 * 因此 kill switch 的结论不因身份而异，且先于任何身份判定。
 * 主体是否真的具备 Native 写资格（`nativeWriteAllowed`）由其后的 Owner 身份门与
 * handler 内的完整 rollout 校验继续收敛，三者必须同时通过。
 */
function requireNativeWriteRollout(options = {}) {
    return (req, res, next) => {
        try {
            const rollout = (options.resolveAiNativeRollout || resolveAiNativeRollout)({
                request: req,
                env: options.env || process.env,
            });
            if (!(rollout.config.writeValid && rollout.config.writeEnabled)) {
                throw new AiTaskPublicError('AI_NATIVE_WRITE_DISABLED', 403, 'AI Native 写入当前未开放');
            }
            return next();
        } catch (error) { return sendError(res, error); }
    };
}
/**
 * NATIVE-W1 §9：Native 写入的批准必须来自**规范 Owner 身份**。
 * 非 Owner JWT、内部机器凭据、未认证一律拒绝；内部凭据只授权"服务到服务执行"，不代表用户批准。
 * 该检查只作用于 Native 写端点，不改变其它既有确认端点。
 */
function requireNativeWriteOwner(req, res, next) {
    if (req.headers['x-internal-secret']) {
        return res.status(403).json({
            success: false, code: 'NATIVE_WRITE_OWNER_REQUIRED',
            error: 'Native 写入只能由 Owner 本人批准。',
            requestId: req.requestId || null,
        });
    }
    const token = String(req.cookies?.token || '');
    const authContext = token ? verifyAuthentication(token, process.env) : null;
    if (!isAuthenticatedOwner(authContext, process.env)) {
        return res.status(403).json({
            success: false, code: 'NATIVE_WRITE_OWNER_REQUIRED',
            error: 'Native 写入只能由 Owner 本人批准。',
            requestId: req.requestId || null,
        });
    }
    req.nativeWriteOwner = Object.freeze({ subject: authContext.sub, authn: authContext.authn });
    return next();
}
function createAiTaskRouterV2(options = {}) {
    const router = Router();
    const accessors = options.dbAccessors || { db, safeInsert, safeUpdate };
    const lifecycle = options.lifecycle || createAiTaskLifecycleV2({ dbAccessors: accessors, clock: options.clock });
    const prepare = options.prepareDetachedTask || prepareDetachedTaskV2;
    const auth = options.auth || ownerMiddleware;
    const nativeWriteOwnerGate = options.nativeWriteOwnerGate || requireNativeWriteOwner;
    router.use('/api/ai/tasks', auth);

    router.post('/api/ai/tasks', async (req, res) => {
        try {
            const body = parseTaskStart(req.body || {});
            const idempotencyKey = requiredIdempotency(req.headers['idempotency-key']);
            const existing = lifecycle.store.findTaskForIdempotency(req.aiTaskOwner, idempotencyKey);
            if (existing) {
                if (existing.conversationId !== Number(body.conversationId.slice(5)) || existing.userMessageId !== body.userMessageId) throw new AiTaskPublicError('IDEMPOTENCY_KEY_CONFLICT', 409, '幂等键已用于不同任务请求');
                return res.status(200).json({ success: true, data: acknowledgement(existing) });
            }
            const row = accessors.db.prepare(`SELECT m.content FROM ai_conversations c JOIN ai_conversation_messages m ON m.conversation_id=c.id WHERE c.id=? AND c.owner_key=? AND c.deleted_at IS NULL AND m.id=? AND m.role='user'`).get(Number(body.conversationId.slice(5)), req.aiTaskOwner, body.userMessageId);
            if (!row) throw new AiTaskPublicError('TASK_SOURCE_OWNERSHIP_INVALID', 404, '任务来源消息不存在');
            const taskId = taskRequestId();
            const messageRef = `msg:durable:${body.userMessageId}`;
            const prepared = await prepare({ taskId, ownerKey: req.aiTaskOwner, conversationId: body.conversationId, requestId: taskId, userMessageId: body.userMessageId, messageRef, messages: [{ role: 'user', content: row.content }] }, { ownerKey: req.aiTaskOwner, clock: options.clock, provider: options.provider || null });
            const task = lifecycle.createTask({ ownerKey: req.aiTaskOwner, conversationId: Number(body.conversationId.slice(5)), userMessageId: body.userMessageId, taskKey: taskId, task: prepared.task, recoveryPlan: prepared.recoveryPlan, expiresAt: new Date(Date.now() + (options.taskRetentionMs || 7 * 24 * 60 * 60 * 1000)).toISOString(), idempotencyKey });
            return res.status(202).json({ success: true, data: acknowledgement(task) });
        } catch (error) { return sendError(res, error); }
    });
    router.get('/api/ai/tasks/:taskId', (req, res) => {
        try { const task = resolveTask(lifecycle, req.params.taskId, req.aiTaskOwner); return res.json({ success: true, data: publicView(task, lifecycle.store.listSteps(task.taskKey)) }); } catch (error) { return sendError(res, error); }
    });
    router.get('/api/ai/tasks/:taskId/events', (req, res) => {
        try {
            const task = resolveTask(lifecycle, req.params.taskId, req.aiTaskOwner);
            const afterSeq = req.query.afterSeq === undefined ? 0 : Number(req.query.afterSeq);
            const limit = req.query.limit === undefined ? 50 : Number(req.query.limit);
            return res.json({ success: true, data: publicEvents(task.taskKey, lifecycle.store.listEvents(task.taskKey), { afterSeq, limit }) });
        } catch (error) { return sendError(res, error); }
    });
    router.post('/api/ai/tasks/:taskId/resume', (req, res) => {
        try {
            const request = parseTaskResume(req.body || {}); requiredIdempotency(req.headers['idempotency-key']);
            const task = resolveTask(lifecycle, req.params.taskId, req.aiTaskOwner);
            if (task.revision !== request.expectedRevision) throw new AiTaskPublicError('TASK_REVISION_CONFLICT', 409, '任务已更新，请刷新后重试');
            const spec = bindResumeSources(task, resumeSpec(task, request), request, accessors.db, req.aiTaskOwner);
            const updated = lifecycle.transition(task.taskKey, task.revision, { state: 'RESOLVING', spec, planChanged: true, eventType: 'PLAN_REVISED', eventPayload: { resumed: true, planRevision: task.planRevision + 1 } });
            return res.status(202).json({ success: true, data: acknowledgement(updated) });
        } catch (error) { return sendError(res, error); }
    });
    router.post('/api/ai/tasks/:taskId/cancel', (req, res) => {
        try {
            const request = parseTaskCancel(req.body || {}); requiredIdempotency(req.headers['idempotency-key']);
            const task = resolveTask(lifecycle, req.params.taskId, req.aiTaskOwner);
            if (task.revision !== request.expectedRevision) throw new AiTaskPublicError('TASK_REVISION_CONFLICT', 409, '任务已更新，请刷新后重试');
            let updated;
            const commandInFlight = lifecycle.store.listSteps(task.taskKey)
                .some(step => step.access === 'COMMAND' && (step.state === 'RUNNING' || step.state === 'UNKNOWN_EFFECT' || step.operationId));
            if (!task.lease && !commandInFlight) updated = lifecycle.transition(task.taskKey, task.revision, { state: 'CANCELLED', eventType: 'TASK_CANCELLED', eventPayload: { reason: request.reason || null } });
            else updated = lifecycle.store.requestCancel(task.taskKey, task.revision);
            return res.json({ success: true, data: { taskId: updated.taskKey, revision: updated.revision, state: updated.state } });
        } catch (error) { return sendError(res, error); }
    });
    router.post('/api/ai/tasks/:taskId/write-preview', requireNativeWriteRollout(options), nativeWriteOwnerGate, async (req, res) => {
        try {
            assertNativeWriteRollout(req, options);
            const task = resolveTask(lifecycle, req.params.taskId, req.aiTaskOwner);
            const result = await prepareAiTaskWriteConfirmationV2({
                task,
                request: req.body || {},
                confirmationSubject: options.confirmationSubjectForRequest
                    ? options.confirmationSubjectForRequest(req)
                    : confirmationSubjectForRequest(req),
                lifecycle,
                execute: options.executeToolCall,
            });
            // 卡片是唯一携带 token 的响应；任务公开投影只给业务事实，绝不存 token/哈希。
            return res.status(202).json({
                success: true,
                data: {
                    task: acknowledgement(result.task),
                    confirmation: result.confirmation,
                    proposal: result.proposal,
                },
            });
        } catch (error) { return sendError(res, error); }
    });
    router.post('/api/ai/tasks/:taskId/write-execute', requireNativeWriteRollout(options), nativeWriteOwnerGate, async (req, res) => {
        try {
            assertNativeWriteRollout(req, options);
            const task = resolveTask(lifecycle, req.params.taskId, req.aiTaskOwner);
            const result = await executeAiTaskConfirmedWriteV2({
                task,
                request: req.body || {},
                confirmationSubject: options.confirmationSubjectForRequest
                    ? options.confirmationSubjectForRequest(req)
                    : confirmationSubjectForRequest(req),
                lifecycle,
                executeConfirmed: options.executeConfirmedAiTool,
            });
            return res.json({
                success: true,
                data: {
                    task: acknowledgement(result.task),
                    receipt: commandReceipt(result.receipt),
                    outcome: outcomeView(result.task?.spec?.writeV1),
                },
            });
        } catch (error) { return sendError(res, error); }
    });
    router.post('/api/ai/tasks/:taskId/write-reconcile', requireNativeWriteRollout(options), nativeWriteOwnerGate, async (req, res) => {
        try {
            // ticket §3：对账与执行必须经过**同一个** Native 写 rollout 授权。
            assertNativeWriteRollout(req, options);
            const task = resolveTask(lifecycle, req.params.taskId, req.aiTaskOwner);
            const result = await reconcileAiTaskCommandV2({
                task, lifecycle,
                readOperation: input => (options.readTaskCommandOperation || readTaskCommandOperationV2)({ db: accessors.db, ...input }),
                verifyTarget: options.verifyPartStockTarget,
            });
            return res.json({
                success: true,
                data: {
                    task: acknowledgement(result.task),
                    resolved: result.resolved,
                    status: result.status,
                    receipt: commandReceipt(result.receipt),
                    outcome: outcomeView(result.task?.spec?.writeV1),
                },
            });
        } catch (error) { return sendError(res, error); }
    });
    return router;
}
function commandReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object') return null;
    return {
        operationId: receipt.operationId || null, capabilityId: receipt.capabilityId || null,
        status: receipt.status || null, auditId: receipt.auditId ?? null,
        auditIds: Array.isArray(receipt.auditIds) ? receipt.auditIds : [],
        idempotentReplay: Boolean(receipt.idempotentReplay), completedAt: receipt.completedAt || null,
    };
}
const router = createAiTaskRouterV2();
module.exports = router;
module.exports.createAiTaskRouterV2 = createAiTaskRouterV2;
