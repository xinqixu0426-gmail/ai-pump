'use strict';

const { Router } = require('express');
const authMiddleware = require('../../authMiddleware.cjs');
const { db, safeInsert, safeUpdate } = require('../../db.cjs');
const { createAiTaskLifecycleV2 } = require('../../services/aiTaskLifecycleV2.cjs');
const { prepareDetachedTaskV2 } = require('../../services/aiTaskControllerV2.cjs');
const { AiTaskWriteBridgeError, executeAiTaskConfirmedWriteV2, prepareAiTaskWriteConfirmationV2, reconcileAiTaskCommandV2 } = require('../../services/aiTaskWriteBridgeV2.cjs');
const { readTaskCommandOperationV2 } = require('../../services/aiTaskOperationReadbackV2.cjs');
const { confirmationSubjectForRequest } = require('../../services/aiToolConfirmation.cjs');
const { resolveAiNativeRollout } = require('../../services/aiNativeRolloutPolicy.cjs');
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
    const status = error instanceof AiTaskPublicError || error instanceof AiTaskWriteBridgeError ? error.statusCode || error.status : error?.code === 'TASK_REVISION_CONFLICT' ? 409 : error?.code === 'TASK_NOT_FOUND' ? 404 : 400;
    return res.status(status).json({ success: false, code: error?.code || 'TASK_REQUEST_FAILED', error: error?.message || '任务请求失败', requestId: res.req?.requestId || null });
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
function createAiTaskRouterV2(options = {}) {
    const router = Router();
    const accessors = options.dbAccessors || { db, safeInsert, safeUpdate };
    const lifecycle = options.lifecycle || createAiTaskLifecycleV2({ dbAccessors: accessors, clock: options.clock });
    const prepare = options.prepareDetachedTask || prepareDetachedTaskV2;
    const auth = options.auth || ownerMiddleware;
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
    router.post('/api/ai/tasks/:taskId/write-preview', async (req, res) => {
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
            // The card is the only token-bearing response. The persisted task
            // remains a public projection and never stores the token/context.
            return res.status(202).json({ success: true, data: { task: acknowledgement(result.task), confirmation: result.confirmation } });
        } catch (error) { return sendError(res, error); }
    });
    router.post('/api/ai/tasks/:taskId/write-execute', async (req, res) => {
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
            return res.json({ success: true, data: { task: acknowledgement(result.task), receipt: commandReceipt(result.receipt) } });
        } catch (error) { return sendError(res, error); }
    });
    router.post('/api/ai/tasks/:taskId/write-reconcile', async (req, res) => {
        try {
            const task = resolveTask(lifecycle, req.params.taskId, req.aiTaskOwner);
            const result = await reconcileAiTaskCommandV2({
                task, lifecycle,
                readOperation: input => (options.readTaskCommandOperation || readTaskCommandOperationV2)({ db: accessors.db, ...input }),
            });
            return res.json({ success: true, data: { task: acknowledgement(result.task), resolved: result.resolved, status: result.status, receipt: commandReceipt(result.receipt) } });
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
