'use strict';

// Protected writes are selected from the formal registry, then preflighted by
// the existing executor.  This adapter owns neither business math nor command
// semantics: it only binds an already-verified identity to a frozen formal
// proposal and projects safe UI/model facts.
const { getAiCapability } = require('../../capabilities/registry.cjs');
const { executeToolCall, getWriteConfirmationExecutionContext } = require('../../routes/ai/executor.cjs');
const { executeConfirmedAiTool } = require('../aiConfirmedToolExecution.cjs');
const { inspectAiToolConfirmation } = require('../aiToolConfirmation.cjs');

const PROTECTED_WRITE_DEFINITIONS = Object.freeze({
    adjust_part_stock: Object.freeze({ capabilityId: 'ai.adjust_part_stock', formalCapabilityId: 'inventory.parts.batch_adjust_stock', domain: 'part_stock', entityType: 'part' }),
    adjust_coil_stock: Object.freeze({ capabilityId: 'ai.adjust_coil_stock', formalCapabilityId: 'inventory.coils.adjust_stock', domain: 'coil_stock', entityType: 'coil' }),
    update_recipe: Object.freeze({ capabilityId: 'ai.update_recipe', formalCapabilityId: 'recipes.update', domain: 'recipe', entityType: 'recipe' }),
    update_order_status: Object.freeze({ capabilityId: 'ai.update_order_status', formalCapabilityId: 'orders.change_status', domain: 'order', entityType: 'order' }),
});
const NOT_READY_WRITE_CAPABILITIES = Object.freeze([
    'quotation status/update: no Assistant protected preflight adapter',
    'customer update: no Assistant protected preflight adapter',
]);

class ProtectedWriteError extends Error {
    constructor(code, message, statusCode = 400) { super(message); this.name = 'ProtectedWriteError'; this.code = code; this.statusCode = statusCode; }
}
function ownerSubject(value) {
    const subject = String(value || '').trim();
    if (!subject) throw new ProtectedWriteError('AI_ASSISTANT_CONFIRMATION_SUBJECT_REQUIRED', '缺少已认证 Owner 主体，不能签发确认。', 401);
    return subject;
}
function requireWriteAllowed(value) {
    if (value !== true) throw new ProtectedWriteError('AI_ASSISTANT_WRITE_DISABLED', 'AI 写入当前未开放，本次没有执行任何修改。', 403);
}
function registryDefinition(toolName) {
    const definition = PROTECTED_WRITE_DEFINITIONS[toolName];
    const capability = getAiCapability(toolName);
    if (!definition || !capability || capability.access !== 'write' || capability.requiresConfirmation !== true
        || capability.capabilityId !== definition.capabilityId) {
        throw new ProtectedWriteError('UNSUPPORTED_WRITE', '该正式修改当前没有可用的受保护预览/确认路径。');
    }
    return { definition, capability };
}
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function safeRows(rows) {
    return (Array.isArray(rows) ? rows : []).slice(0, 12).map(row => ({
        label: String(row?.label || '').slice(0, 80), value: String(row?.value ?? '').slice(0, 240),
    })).filter(row => row.label && row.value).map(row => ({
        // Formal preflights can include an internal target marker for generic
        // executor confirmation UI.  The Assistant projection never needs it.
        ...row,
        value: row.value.replace(/[（(]?\s*#\d+\s*[）)]?/g, '').replace(/\s{2,}/g, ' ').trim(),
    }));
}
function publicProposal(toolName, confirmation) {
    const context = confirmation?.executionContext || {};
    const warnings = Array.isArray(context.warnings) ? context.warnings.map(item => String(item).slice(0, 240)) : [];
    if (toolName === 'adjust_part_stock') {
        const item = confirmation?.proposal?.items?.[0];
        if (!item || !String(item.model || '').trim()) throw new ProtectedWriteError('AI_ASSISTANT_PREFLIGHT_INVALID', '正式零件库存预览不完整。');
        return Object.freeze({ capabilityId: 'inventory.parts.batch_adjust_stock', target: { entityType: 'part', displayName: String(item.model) },
            changes: [{ field: 'stock', current: Number(item.currentStock), proposed: Number(item.nextStock), delta: Number(item.delta) }],
            currentState: { stock: Number(item.currentStock) }, proposedState: { stock: Number(item.nextStock) },
            warnings, confirmationRequired: true,
            item: { model: String(item.model), currentStock: Number(item.currentStock), delta: Number(item.delta), nextStock: Number(item.nextStock), clampedToZero: item.clampedToZero === true } });
    }
    if (toolName === 'adjust_coil_stock') {
        const item = Array.isArray(context.resolved) && context.resolved.length === 1 ? context.resolved[0] : null;
        if (!item) throw new ProtectedWriteError('AI_ASSISTANT_PREFLIGHT_INVALID', '正式线圈库存预览不完整。');
        const current = numberOrNull(item.previousStock); const delta = numberOrNull(item.changeQty);
        return Object.freeze({ capabilityId: 'inventory.coils.adjust_stock', target: { entityType: 'coil', displayName: [item.model, item.material, item.slotType].filter(Boolean).join(' / ') },
            changes: [{ field: 'stock', current, proposed: current + delta, delta }], currentState: { stock: current }, proposedState: { stock: current + delta }, warnings, confirmationRequired: true });
    }
    if (toolName === 'update_recipe') {
        const draft = context.draft || {}; const target = context.recipeName || draft.name;
        if (!target) throw new ProtectedWriteError('AI_ASSISTANT_PREFLIGHT_INVALID', '正式配方预览不完整。');
        return Object.freeze({ capabilityId: 'recipes.update', target: { entityType: 'recipe', displayName: String(target) },
            changes: safeRows(confirmation?.rows).map(row => ({ field: row.label, current: null, proposed: row.value })),
            currentState: {}, proposedState: { name: draft.name || target, spec: draft.spec ?? null }, warnings, confirmationRequired: true });
    }
    if (toolName === 'update_order_status') {
        if (!context.orderName || !context.status) throw new ProtectedWriteError('AI_ASSISTANT_PREFLIGHT_INVALID', '正式订单状态预览不完整。');
        return Object.freeze({ capabilityId: 'orders.change_status', target: { entityType: 'order', displayName: String(context.orderName) },
            changes: [{ field: 'status', current: context.oldStatus || null, proposed: context.status }], currentState: { status: context.oldStatus || null }, proposedState: { status: context.status }, warnings, confirmationRequired: true });
    }
    throw new ProtectedWriteError('UNSUPPORTED_WRITE', '该正式修改当前没有可用的受保护预览/确认路径。');
}

function assertPreflightIdentity(toolName, expectedIdentity, confirmation) {
    if (!expectedIdentity) return;
    const expectedId = Number(expectedIdentity.id);
    const context = confirmation?.executionContext || {};
    const actualId = toolName === 'adjust_part_stock'
        ? Number(confirmation?.proposal?.items?.[0]?.partId)
        : toolName === 'adjust_coil_stock'
            ? Number(context?.resolved?.[0]?.coilId)
            : toolName === 'update_recipe'
                ? Number(context?.recipeId)
                : toolName === 'update_order_status'
                    ? Number(context?.orderId)
                    : NaN;
    if (!Number.isSafeInteger(expectedId) || expectedId <= 0 || actualId !== expectedId) {
        throw new ProtectedWriteError('AI_ASSISTANT_IDENTITY_PREVIEW_MISMATCH', '正式预览目标与本轮已验证身份不一致，不能签发确认。');
    }
}

async function prepareProtectedWriteProposal({ toolName, args, expectedIdentity = null, confirmationSubject, signal }, dependencies = {}) {
    requireWriteAllowed(dependencies.writeAllowed);
    const subject = ownerSubject(confirmationSubject);
    registryDefinition(toolName);
    const execute = dependencies.executeToolCall || executeToolCall;
    const result = await execute(toolName, args, { allowWrite: false, confirmationSubject: subject, signal });
    if (!result?.success || !result.requiresConfirmation || !result.confirmation?.confirmationToken) {
        const error = new ProtectedWriteError(result?.code || 'AI_ASSISTANT_PREFLIGHT_FAILED', result?.error || '正式预览未能签发受保护确认。');
        throw error;
    }
    // executor returns the context only at trusted process scope; it is never
    // placed in the model or SSE projection.
    const trustedConfirmation = { ...result.confirmation,
        executionContext: result.confirmation.executionContext || getWriteConfirmationExecutionContext(result.confirmation) };
    assertPreflightIdentity(toolName, expectedIdentity, trustedConfirmation);
    const proposal = publicProposal(toolName, trustedConfirmation);
    return Object.freeze({ proposal, confirmation: Object.freeze({ confirmationToken: result.confirmation.confirmationToken, expiresAt: result.confirmation.expiresAt || null }) });
}
function supportedToolFromToken(token, subject, inspect = inspectAiToolConfirmation) {
    const metadata = inspect({ confirmationToken: token, subject });
    registryDefinition(metadata.toolName);
    return metadata.toolName;
}
function stale(error) {
    return /(?:version|preview|stale|conflict|expectedupdatedat)/i.test(`${error?.code || ''} ${error?.message || ''}`);
}
function publicReadback(toolName, result = {}) {
    const readback = result.readback;
    if (toolName === 'adjust_part_stock') {
        const item = Array.isArray(readback) && readback.length === 1 ? readback[0] : null;
        if (!item || !String(item.model || '').trim() || !Number.isFinite(Number(item.stock))) return null;
        return { entityType: 'part', displayName: String(item.model), state: { stock: Number(item.stock) } };
    }
    if (toolName === 'adjust_coil_stock') {
        const item = Array.isArray(readback) && readback.length === 1 ? readback[0] : null;
        if (!item || !String(item.model || '').trim() || !Number.isFinite(Number(item.stock))) return null;
        return { entityType: 'coil', displayName: String(item.model), state: { stock: Number(item.stock) } };
    }
    if (toolName === 'update_recipe') {
        if (!readback || !String(readback.name || '').trim()) return null;
        return { entityType: 'recipe', displayName: String(readback.name), state: { name: String(readback.name), spec: readback.spec ?? null } };
    }
    if (toolName === 'update_order_status') {
        if (!readback || !String(readback.status || '').trim()) return null;
        return { entityType: 'order', displayName: String(readback.contractNo || readback.customerName || '正式订单'), state: { status: String(readback.status) } };
    }
    return null;
}
async function executeProtectedWriteConfirmation({ confirmationToken, confirmationSubject }, dependencies = {}) {
    requireWriteAllowed(dependencies.writeAllowed);
    const subject = ownerSubject(confirmationSubject); const token = String(confirmationToken || '').trim();
    if (!token) throw new ProtectedWriteError('AI_ASSISTANT_CONFIRMATION_TOKEN_REQUIRED', '缺少确认凭证。');
    const toolName = supportedToolFromToken(token, subject, dependencies.inspectAiToolConfirmation || inspectAiToolConfirmation);
    const executeConfirmed = dependencies.executeConfirmedAiTool || executeConfirmedAiTool;
    let receipt;
    try {
        receipt = await executeConfirmed({ confirmationToken: token, subject, expectedToolName: toolName, execute: dependencies.executeToolCall || executeToolCall });
    } catch (error) {
        if (stale(error)) throw new ProtectedWriteError('STALE_PROPOSAL', '当前正式状态已变化，请重新生成修改方案。', 409);
        if (error?.operationId) { const unknown = new ProtectedWriteError('UNKNOWN_EFFECT', '暂时无法确认本次正式修改结果，请先核对当前状态后再操作。', 409); unknown.operationId = error.operationId; unknown.manualReviewRequired = true; throw unknown; }
        throw error;
    }
    if (receipt?.name !== toolName) throw new ProtectedWriteError('AI_ASSISTANT_READBACK_MISSING', '正式命令回执与确认内容不一致。', 502);
    const verified = publicReadback(toolName, receipt.result);
    if (!verified) throw new ProtectedWriteError('AI_ASSISTANT_READBACK_MISSING', '正式修改未返回可验证回读，不能确认完成。', 502);
    return Object.freeze({ status: 'COMPLETED', outcome: Object.freeze({ verified: true, capabilityId: registryDefinition(toolName).definition.formalCapabilityId, target: Object.freeze({ entityType: verified.entityType, displayName: verified.displayName }), state: Object.freeze(verified.state), idempotentReplay: receipt.idempotentReplay === true }) });
}
function protectedToolDefinitions() { return Object.entries(PROTECTED_WRITE_DEFINITIONS).map(([toolName, definition]) => Object.freeze({ toolName, ...definition })); }
function selectProtectedWriteTools(judge = {}) {
    const domains = new Set(Array.isArray(judge.domains) ? judge.domains.map(value => String(value)) : []);
    const available = protectedToolDefinitions();
    const selected = available.filter(item => (
        domains.size === 0 || domains.has(item.domain) || domains.has(item.entityType)
        || (item.domain === 'part_stock' && (domains.has('catalog') || domains.has('inventory')))
        || (item.domain === 'coil_stock' && (domains.has('coil') || domains.has('inventory')))
    ));
    // An underspecified mutation must be clarified by the model; exposing the
    // bounded protected adapters lets it resolve identity without ever seeing
    // a direct write command.
    return selected.length > 0 ? selected : available;
}

module.exports = { NOT_READY_WRITE_CAPABILITIES, PROTECTED_WRITE_DEFINITIONS, ProtectedWriteError, assertPreflightIdentity, executeProtectedWriteConfirmation, prepareProtectedWriteProposal, protectedToolDefinitions, publicProposal, publicReadback, registryDefinition, selectProtectedWriteTools };
