'use strict';

const express = require('express');
const { runAiAssistant, confirmAiAssistantProtectedWriteProposal } = require('../../services/ai-assistant/runtime.cjs');
const { writeAllowed } = require('../../services/ai-assistant/policy.cjs');
const { ownerAuth } = require('./ownerAuth.cjs');

const router = express.Router();
const DEFAULT_AI_CHAT_TIMEOUT_MS = 180_000;
const DEFAULT_SSE_HEARTBEAT_MS = 15_000;
function boundedDuration(value, fallback, minimum, maximum) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), minimum), maximum) : fallback; }
function aiChatTimeoutMs(env = process.env) { return boundedDuration(env.AI_CHAT_TIMEOUT_MS, DEFAULT_AI_CHAT_TIMEOUT_MS, 10_000, 900_000); }
function sseHeartbeatMs(env = process.env) { return boundedDuration(env.AI_SSE_HEARTBEAT_MS, DEFAULT_SSE_HEARTBEAT_MS, 5_000, 60_000); }
function plainMessages(messages) {
    const valid = (Array.isArray(messages) ? messages : []).filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string' && item.content.trim());
    const current = [...valid].reverse().find(item => item.role === 'user'); if (!current) return null;
    const index = valid.lastIndexOf(current);
    return {
        userMessage: current.content.trim(),
        recentConversation: valid.slice(Math.max(0, index - 4), index).map(item => ({ role: item.role, content: item.content.slice(0, 2_000) })),
        attachments: Array.isArray(current.attachments) ? current.attachments : [],
    };
}
function writeSse(res, type, payload = {}) { res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`); }
function proposalEvent(result) {
    const proposal = result.proposal;
    return { stage: 'AI_ASSISTANT_WRITE_PROPOSAL', proposal: {
        capabilityId: proposal.capabilityId, target: proposal.target, changes: proposal.changes,
        currentState: proposal.currentState, proposedState: proposal.proposedState,
        warnings: proposal.warnings, confirmationRequired: proposal.confirmationRequired,
        ...(proposal.item ? { item: proposal.item } : {}),
    }, confirmation: { confirmationToken: result.confirmation.confirmationToken, expiresAt: result.confirmation.expiresAt } };
}
function resolveWriteAllowed(options = {}) {
    if (typeof options.writeAllowed === 'function') return options.writeAllowed(options.env || process.env) === true;
    return writeAllowed(options.env || process.env) === true;
}
async function handleAiChat(req, res, options = {}) {
    const parsed = plainMessages(req.body?.messages);
    if (!parsed) return res.status(400).json({ success: false, code: 'AI_ASSISTANT_INPUT_INVALID', error: '缺少用户消息。' });
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Connection', 'keep-alive'); res.flushHeaders();
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), options.timeoutMs || aiChatTimeoutMs(options.env)); timeout.unref?.();
    const heartbeat = setInterval(() => { if (!res.writableEnded) res.write(': heartbeat\n\n'); }, options.heartbeatMs || sseHeartbeatMs(options.env)); heartbeat.unref?.();
    try {
        const result = await (options.runAiAssistant || runAiAssistant)({ ...parsed, pageContext: req.body?.pageContext, confirmationSubject: req.aiAssistantOwner.sub, signal: controller.signal, requestId: req.requestId || null }, { writeAllowed: resolveWriteAllowed(options), judgeModelCall: options.judgeModelCall, mainModelCall: options.mainModelCall, executeToolCall: options.executeToolCall, policySnapshot: options.policySnapshot, contextBuilder: options.contextBuilder });
        writeSse(res, 'provider', { provider: 'deepseek', displayName: 'DeepSeek' }); writeSse(res, 'content', { content: result.answer });
        if (result.status === 'PROPOSAL_READY') writeSse(res, 'write_proposal', proposalEvent(result));
        writeSse(res, 'done');
    } catch (error) { writeSse(res, 'error', { code: error.code || 'AI_ASSISTANT_FAILED', message: error.message || 'AI 助手执行失败。' }); }
    finally { clearTimeout(timeout); clearInterval(heartbeat); res.end(); }
}
async function handleWriteConfirm(req, res, options = {}) {
    const confirmationToken = String(req.body?.confirmationToken || '').trim();
    if (!confirmationToken || Object.keys(req.body || {}).some(key => key !== 'confirmationToken')) return res.status(400).json({ success: false, code: 'AI_ASSISTANT_CONFIRMATION_TOKEN_REQUIRED', error: '确认请求只接受确认凭证。' });
    if (!resolveWriteAllowed(options)) return res.status(403).json({ success: false, code: 'AI_ASSISTANT_WRITE_DISABLED', error: 'AI 写入当前未开放，本次没有执行任何修改。' });
    try {
        const confirm = options.confirmAiAssistantProtectedWriteProposal
            || options.confirmAiAssistantPartStockProposal
            || confirmAiAssistantProtectedWriteProposal;
        const data = await confirm({ confirmationToken, confirmationSubject: req.aiAssistantOwner.sub }, { writeAllowed: true, executeToolCall: options.executeToolCall, executeConfirmedAiTool: options.executeConfirmedAiTool, inspectAiToolConfirmation: options.inspectAiToolConfirmation });
        return res.json({ success: true, data: { outcome: data.outcome } });
    } catch (error) { return res.status(error.statusCode || (error.code === 'UNKNOWN_EFFECT' ? 409 : 400)).json({ success: false, code: error.code || 'AI_ASSISTANT_CONFIRMATION_FAILED', error: error.message, manualReviewRequired: error.manualReviewRequired === true }); }
}
router.post('/api/ai/chat', ownerAuth, handleAiChat);
router.post('/api/ai/write/confirm', ownerAuth, handleWriteConfirm);
function createAiChatRouter(options = {}) { const scoped = express.Router(); scoped.post('/api/ai/chat', ownerAuth, (req, res) => handleAiChat(req, res, options)); scoped.post('/api/ai/write/confirm', ownerAuth, (req, res) => handleWriteConfirm(req, res, options)); return scoped; }
module.exports = { DEFAULT_AI_CHAT_TIMEOUT_MS, DEFAULT_SSE_HEARTBEAT_MS, aiChatTimeoutMs, createAiChatRouter, handleAiChat, handleWriteConfirm, ownerAuth, plainMessages, proposalEvent, resolveWriteAllowed, router, sseHeartbeatMs };
