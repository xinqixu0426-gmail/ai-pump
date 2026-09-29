'use strict';

// This is deliberately a thin owner-side adapter.  It has no database access
// and delegates preflight, confirmation binding, command execution and
// readback to the existing formal AI executor chain.
const { executeToolCall } = require('../../routes/ai/executor.cjs');
const { executeConfirmedAiTool } = require('../aiConfirmedToolExecution.cjs');

const PART_STOCK_TOOL = 'adjust_part_stock';
const PART_STOCK_CAPABILITY = 'inventory.parts.batch_adjust_stock';

class ProtectedPartStockError extends Error {
    constructor(code, message) { super(message); this.name = 'ProtectedPartStockError'; this.code = code; }
}

function ownerSubject(value) {
    const subject = String(value || '').trim();
    if (!subject) throw new ProtectedPartStockError('AI_ASSISTANT_CONFIRMATION_SUBJECT_REQUIRED', '缺少已认证 Owner 主体，不能签发库存调整确认。');
    return subject;
}
function requireWriteAllowed(dependencies) {
    if (dependencies?.writeAllowed !== true) throw new ProtectedPartStockError('AI_ASSISTANT_WRITE_DISABLED', 'AI 写入当前未开放，本次没有执行任何修改。');
}

function boundPart(part) {
    const id = Number(part?.id);
    const model = String(part?.model || '').trim();
    if (!Number.isSafeInteger(id) || id <= 0 || !model) throw new ProtectedPartStockError('AI_ASSISTANT_PART_IDENTITY_UNVERIFIED', '零件必须来自本轮唯一正式身份结果。');
    return { id, model };
}

function integerDelta(value) {
    const delta = Number(value);
    if (!Number.isSafeInteger(delta) || delta === 0) throw new ProtectedPartStockError('AI_ASSISTANT_PART_STOCK_DELTA_INVALID', '库存调整量必须是非零整数。');
    return delta;
}

function proposalView(confirmation) {
    const item = confirmation?.proposal?.items?.[0];
    if (!item || !Number.isSafeInteger(Number(item.partId))) throw new ProtectedPartStockError('AI_ASSISTANT_PART_STOCK_PREVIEW_INVALID', '正式库存预览未返回完整的单一零件提案。');
    if (confirmation?.proposal?.capabilityId !== PART_STOCK_CAPABILITY) throw new ProtectedPartStockError('AI_ASSISTANT_PART_STOCK_CAPABILITY_MISMATCH', '正式库存预览能力与受保护写范围不一致。');
    return Object.freeze({
        capability: PART_STOCK_TOOL,
        part: Object.freeze({ id: Number(item.partId), model: String(item.model || '').trim() }),
        currentStock: Number(item.currentStock),
        delta: Number(item.delta),
        nextStock: Number(item.nextStock),
        clampedToZero: item.clampedToZero === true,
        expiresAt: confirmation.expiresAt || null,
    });
}

async function prepareProtectedPartStockProposal(input = {}, dependencies = {}) {
    requireWriteAllowed(dependencies);
    const subject = ownerSubject(input.confirmationSubject);
    const part = boundPart(input.part);
    const delta = integerDelta(input.delta);
    const execute = dependencies.executeToolCall || executeToolCall;
    const result = await execute(PART_STOCK_TOOL, { items: [{ model: part.model, changeQty: delta }] }, {
        allowWrite: false,
        confirmationSubject: subject,
        signal: input.signal,
    });
    if (!result?.success || !result.requiresConfirmation || !result.confirmation?.confirmationToken) {
        throw new ProtectedPartStockError('AI_ASSISTANT_PART_STOCK_PREVIEW_FAILED', '正式库存预览未能签发受保护确认。');
    }
    const proposal = proposalView(result.confirmation);
    if (proposal.part.id !== part.id || proposal.part.model !== part.model || proposal.delta !== delta) {
        throw new ProtectedPartStockError('AI_ASSISTANT_PART_STOCK_PREVIEW_MISMATCH', '正式库存预览与本轮已绑定零件身份或调整量不一致。');
    }
    return Object.freeze({
        proposal,
        confirmation: Object.freeze({
            confirmationToken: result.confirmation.confirmationToken,
            operationId: result.confirmation.operationId || null,
            expiresAt: result.confirmation.expiresAt || null,
        }),
    });
}

async function executeProtectedPartStockConfirmation(input = {}, dependencies = {}) {
    requireWriteAllowed(dependencies);
    const subject = ownerSubject(input.confirmationSubject);
    const token = String(input.confirmationToken || '').trim();
    if (!token) throw new ProtectedPartStockError('AI_ASSISTANT_CONFIRMATION_TOKEN_REQUIRED', '缺少确认凭证。');
    const executeConfirmed = dependencies.executeConfirmedAiTool || executeConfirmedAiTool;
    let receipt;
    try {
        receipt = await executeConfirmed({
            confirmationToken: token,
            subject,
            expectedToolName: PART_STOCK_TOOL,
            execute: dependencies.executeToolCall || executeToolCall,
        });
    } catch (error) {
        // executeConfirmedAiTool annotates a consumed confirmation with its
        // operationId.  Without a neutral formal operation lookup outside Task
        // V2, that is an uncertain command outcome, never a retryable failure.
        if (error?.operationId) {
            const unknown = new ProtectedPartStockError('UNKNOWN_EFFECT', '这次库存调整的最终结果无法确认。不要重复提交，请先核对正式库存/操作记录。');
            unknown.operationId = error.operationId;
            unknown.manualReviewRequired = true;
            throw unknown;
        }
        throw error;
    }
    const readback = Array.isArray(receipt?.result?.readback) ? receipt.result.readback : [];
    if (receipt?.name !== PART_STOCK_TOOL || readback.length !== 1) {
        throw new ProtectedPartStockError('AI_ASSISTANT_PART_STOCK_READBACK_MISSING', '正式库存命令未返回可验证的单项回读。');
    }
    return Object.freeze({
        status: 'COMPLETED',
        receipt: Object.freeze({
            operationId: receipt.operationId || null,
            auditIds: Array.isArray(receipt.auditIds) ? receipt.auditIds : [],
            idempotentReplay: receipt.idempotentReplay === true,
            readback: Object.freeze(readback.map(item => Object.freeze({ id: Number(item.id), model: String(item.model || ''), stock: Number(item.stock) }))),
        }),
    });
}

module.exports = { PART_STOCK_TOOL, PART_STOCK_CAPABILITY, ProtectedPartStockError, prepareProtectedPartStockProposal, executeProtectedPartStockConfirmation };
