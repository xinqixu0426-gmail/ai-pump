'use strict';

/**
 * NATIVE-W1.5 —— 聊天回合 → W1 提案桥（**只准备，不执行**）。
 *
 * 职责边界（ticket §8–§13）：
 *   - 唯一获批能力：`adjust_part_stock` / `inventory.parts.batch_adjust_stock`；
 *   - 判定完全确定性（0 次额外模型调用）：库存语义 + 明确增减动作 + 明确数量；
 *   - 目标身份不在这里解析：由**既有 W1 正式预览**（canonical resolver）决定 0/多匹配；
 *   - 不复制预览/确认/幂等/执行/对账/回读逻辑：直接调用既有
 *     `prepareAiTaskWriteConfirmationV2`（W1 桥）；
 *   - 同步推进既有合法状态序列 NEW → UNDERSTANDING → RESOLVING → RUNNING，
 *     由 W1 桥把任务推进到 `WAITING_APPROVAL`；**不启用 worker**；
 *   - 本模块永不执行写入：预检以 `allowWrite:false` 调用，执行只可能发生在
 *     后续独立的 Owner 确认请求（既有的 `write-execute`）。
 *
 * 失败一律降级为安全结论（澄清 / 不支持 / 预览拒绝），绝不伪造提案、绝不偷跑写入。
 */

const crypto = require('node:crypto');
const { createAiTaskLifecycleV2 } = require('./aiTaskLifecycleV2.cjs');
const { prepareAiTaskWriteConfirmationV2 } = require('./aiTaskWriteBridgeV2.cjs');
const { createEnvelope } = require('./aiTaskControllerV2.cjs');
const { executeToolCall } = require('../routes/ai/executor.cjs');
const { detectProtectedCommandRoute, parsePartStockAdjustment } = require('./aiProtectedCommandRoute.cjs');
const { NATIVE_WRITE_V1_CAPABILITY, NATIVE_WRITE_V1_TOOL } = require('./aiNativeWriteScope.cjs');

const WRITE_PROPOSAL_GOAL_KEY = 'prepare_part_stock_adjust';
const WRITE_PROPOSAL_GOAL_DESCRIPTION = '准备零件库存调整方案';
const TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_GOAL_ACTIVE_MS = 120000;

/** 澄清/拒绝原因 → 稳定的用户文案与错误码（§6/§20）。 */
const INTENT_FEEDBACK = Object.freeze({
    target_required: { code: 'NATIVE_WRITE_TARGET_REQUIRED', message: '请说明要调整的零件，例如「把 6202 轴承库存增加 100」。' },
    target_multi: { code: 'NATIVE_WRITE_SINGLE_TARGET_REQUIRED', message: '一次只能调整一个零件的库存，请分开提交。' },
    quantity_required: { code: 'NATIVE_WRITE_QUANTITY_REQUIRED', message: '请说明要调整的数量，例如「把 6202 轴承库存增加 100」。' },
    quantity_ambiguous: { code: 'NATIVE_WRITE_QUANTITY_AMBIGUOUS', message: '这句话里出现了多个不同的调整数量，请只保留一个再提交。' },
    action_ambiguous: { code: 'NATIVE_WRITE_ACTION_AMBIGUOUS', message: '请明确是要增加还是减少库存，例如「库存增加 100」或「库存减少 20」。' },
    sign_ambiguous: { code: 'NATIVE_WRITE_ACTION_AMBIGUOUS', message: '请明确是要增加还是减少库存，例如「库存增加 100」或「库存减少 20」。' },
    not_stock_intent: { code: 'NATIVE_WRITE_UNSUPPORTED', message: '该写操作当前未开放；目前只支持单个零件的库存调整。' },
    source_mismatch: { code: 'NATIVE_WRITE_SOURCE_MISMATCH', message: '这条消息还没有正式保存到会话中，请重新发送一次再操作。' },
});

/** 正式预览拒绝码 → 安全的用户文案（不透露内部实现）。 */
const PREVIEW_FEEDBACK = Object.freeze({
    part_stock_target_not_found: '没有找到要调整的零件，请确认型号后重新提交。',
    part_stock_target_ambiguous: '找到多个匹配的零件，无法确定要调整哪一个，请改用更精确的型号。',
    part_stock_model_required: '请说明要调整的零件型号，例如「把 6202 轴承库存增加 100」。',
    NATIVE_WRITE_TARGET_MODEL_REQUIRED: '请说明要调整的零件型号，例如「把 6202 轴承库存增加 100」。',
    part_stock_change_qty_invalid: '库存调整数量必须是明确的非零整数。',
    NATIVE_WRITE_QUANTITY_INVALID: '库存调整数量必须是明确的非零整数。',
    NATIVE_WRITE_SINGLE_TARGET_REQUIRED: '一次只能调整一个零件的库存，请分开提交。',
    part_stock_model_duplicate: '一次只能调整一个零件的库存，请分开提交。',
    NATIVE_WRITE_CAPABILITY_UNSUPPORTED: '该写操作当前未开放；目前只支持单个零件的库存调整。',
    AI_NATIVE_WRITE_DISABLED: 'AI 写入当前未开放，本次没有执行任何修改。',
});

function feedbackForReason(reason) {
    return INTENT_FEEDBACK[reason] || INTENT_FEEDBACK.not_stock_intent;
}

/** 预检包装：保留正式预览的根因码，供上层给出精确但安全的失败文案。 */
function preflightPreservingCode(execute) {
    return async (toolName, args, options = {}) => {
        const result = await execute(toolName, args, options);
        if (result && result.success === false) {
            const error = new Error(result.error || '正式预览没有生成有效确认卡');
            error.code = result.code || 'ai_write_preflight_failed';
            throw error;
        }
        return result;
    };
}

/**
 * 构造 W1 提案任务信封：写策略只对**这一个能力的一次冻结提案**生效。
 * 不是通用写权限：策略值为 CONFIRMATION_REQUIRED，且必须由 Owner 确认后才可能执行。
 */
function buildWriteProposalEnvelope({ taskKey, ownerKey, conversationId, message, clock = Date }) {
    const task = createEnvelope({
        taskId: taskKey,
        ownerKey,
        conversationId,
        requestId: taskKey,
        userGoal: message,
        writePolicy: 'CONFIRMATION_REQUIRED',
        clock,
        maxActiveMs: MAX_GOAL_ACTIVE_MS,
    });
    task.executionMode = 'DETACHED';
    task.goals = [{
        goalKey: WRITE_PROPOSAL_GOAL_KEY,
        kind: 'PREPARE_CHANGE',
        description: WRITE_PROPOSAL_GOAL_DESCRIPTION,
        subjectKeys: [],
        scenarioKeys: [],
        dependsOn: [],
        state: 'PENDING',
        factIds: [],
        sourceEvidenceIds: [],
        blockers: [],
        requirements: [],
    }];
    return task;
}

/** 面向 W2 的结构化提案事件：只含展示事实 + 不透明服务端身份（§13）。 */
function buildProposalTransport({ task, proposal, confirmation, writeV1, args }) {
    const preview = Array.isArray(writeV1?.previewFacts) ? writeV1.previewFacts[0] : null;
    return {
        type: 'write_proposal',
        stage: 'NATIVE_WRITE_PROPOSAL',
        proposal: {
            kind: 'part_stock_adjust',
            capabilityId: NATIVE_WRITE_V1_CAPABILITY,
            items: [{
                partId: proposal.partId,
                model: proposal.model,
                currentStock: proposal.currentStock,
                delta: proposal.delta,
                nextStock: proposal.nextStock,
                clampedToZero: preview?.clampedToZero === true,
            }],
        },
        confirmation: {
            confirmationToken: confirmation.confirmationToken,
            operationId: confirmation.operationId || null,
            expiresAt: confirmation.expiresAt || null,
            toolName: NATIVE_WRITE_V1_TOOL,
            args,
        },
        task: {
            taskId: task.taskKey,
            revision: task.revision,
            state: task.state,
            statusPath: `/api/ai/tasks/${task.taskKey}`,
        },
    };
}

function createNativeWriteProposalChatBridge(dependencies = {}) {
    const lifecycle = dependencies.lifecycle || createAiTaskLifecycleV2({ dbAccessors: dependencies.dbAccessors });
    const prepare = dependencies.prepare || prepareAiTaskWriteConfirmationV2;
    const execute = dependencies.execute || executeToolCall;
    const clock = dependencies.clock || Date;
    const now = dependencies.now || (() => new Date().toISOString());

    /**
     * @returns {{ok:true, task, proposal, confirmation, transport}
     *          |{ok:false, kind:'clarification'|'unsupported'|'preview_rejected', code, message}}
     */
    return async function prepareNativeWriteProposalFromChat(input = {}) {
        const ownerKey = String(input.ownerKey || '').trim();
        const source = input.sourceMessage;
        const confirmationSubject = String(input.confirmationSubject || '').trim();
        if (!ownerKey || !source || !source.content || !confirmationSubject) {
            const feedback = feedbackForReason('not_stock_intent');
            return { ok: false, kind: 'unsupported', ...feedback };
        }
        // 权威文本 = 库里持久化的用户消息。若请求里的最新用户消息还没被持久化（内容不一致），
        // 绝不拿「另一条消息」生成提案——否则用户看到的卡片会对应错的消息。
        const requestedText = typeof input.requestedText === 'string' ? input.requestedText.trim() : '';
        if (requestedText && requestedText !== String(source.content).trim()) {
            const feedback = feedbackForReason('source_mismatch');
            return { ok: false, kind: 'clarification', ...feedback };
        }
        // 再跑一次同一套确定性判据（含否定/疑问守卫）。
        const route = detectProtectedCommandRoute([{ role: 'user', content: source.content }]);
        if (!route || route.preferredCapability !== NATIVE_WRITE_V1_TOOL) {
            const feedback = feedbackForReason('not_stock_intent');
            return { ok: false, kind: 'unsupported', ...feedback };
        }
        const parsed = parsePartStockAdjustment(source.content);
        if (!parsed.ok) {
            const feedback = feedbackForReason(parsed.reason);
            return { ok: false, kind: 'clarification', ...feedback };
        }

        const taskKey = crypto.randomUUID();
        // 信封的 conversationId 是传输层标识（`chat-<id>`，字符串，受 TASK_CONVERSATION 校验）；
        // DB 行上的 conversation_id 是数字外键，两者用途不同，必须分开传。
        const conversationTransportId = String(input.conversationTransportId || '').trim()
            || `chat-${source.conversationId}`;
        const envelope = buildWriteProposalEnvelope({
            taskKey, ownerKey, conversationId: conversationTransportId, message: source.content, clock,
        });
        let task = lifecycle.createTask({
            ownerKey,
            conversationId: source.conversationId,
            userMessageId: source.userMessageId,
            taskKey,
            task: envelope,
            expiresAt: new Date(new Date(now()).getTime() + TASK_RETENTION_MS).toISOString(),
            idempotencyKey: `native-w1-proposal:${taskKey}`,
        });
        // 同步走完既有合法序列（不启用 worker）：NEW → UNDERSTANDING → RESOLVING → RUNNING。
        for (const state of ['UNDERSTANDING', 'RESOLVING', 'RUNNING']) {
            task = lifecycle.transition(taskKey, task.revision, { state, eventType: 'STATE_CHANGED' });
        }

        let prepared = null;
        try {
            prepared = await prepare({
                task,
                request: {
                    version: 1,
                    expectedRevision: task.revision,
                    goalKey: WRITE_PROPOSAL_GOAL_KEY,
                    toolName: NATIVE_WRITE_V1_TOOL,
                    args: parsed.args,
                },
                confirmationSubject,
                lifecycle,
                execute: preflightPreservingCode(execute),
                now,
            });
        } catch (error) {
            // 预检/提案失败：不留悬挂任务，也不产生任何写入。
            try {
                const current = lifecycle.store.getTaskByKey(taskKey);
                if (current && !['SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIAL', 'UNSUPPORTED'].includes(current.state)) {
                    lifecycle.transition(taskKey, current.revision, { state: 'FAILED', eventType: 'TASK_FAILED' });
                }
            } catch { /* 清理是尽力而为，绝不影响安全结论 */ }
            const code = String(error?.code || 'NATIVE_WRITE_PREVIEW_REJECTED');
            return {
                ok: false,
                kind: 'preview_rejected',
                code,
                message: PREVIEW_FEEDBACK[code] || '本次库存调整方案没有生成，也未执行任何修改。请核对零件型号和数量后重试。',
            };
        }

        const transport = buildProposalTransport({
            task: prepared.task,
            proposal: prepared.proposal,
            confirmation: prepared.confirmation,
            writeV1: prepared.task.spec.writeV1,
            args: parsed.args,
        });
        return {
            ok: true,
            task: prepared.task,
            proposal: prepared.proposal,
            confirmation: prepared.confirmation,
            transport,
        };
    };
}

module.exports = {
    INTENT_FEEDBACK,
    PREVIEW_FEEDBACK,
    WRITE_PROPOSAL_GOAL_KEY,
    buildProposalTransport,
    buildWriteProposalEnvelope,
    createNativeWriteProposalChatBridge,
};
