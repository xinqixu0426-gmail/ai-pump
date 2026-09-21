const express = require('express');
const { createLogger } = require('../../logger.cjs');
const authMiddleware = require('../../authMiddleware.cjs');
const { aiProviderCapabilities } = require('../../services/aiProvider.cjs');
const { normalizeProviderPreference, resolveProviderPreference } = require('../../services/aiProviderRegistry.cjs');
const { runAiDispatcherV3 } = require('../../services/aiDispatcherV3.cjs');
const {
    AiToolConfirmationError,
    confirmationSubjectForRequest,
} = require('../../services/aiToolConfirmation.cjs');
const { executeConfirmedAiTool } = require('../../services/aiConfirmedToolExecution.cjs');
const { reviseAiToolConfirmation } = require('../../services/aiToolConfirmationRevision.cjs');
const { normalizeResolutionContext } = require('../../services/aiResourceResolutionV3.cjs');
const { normalizeAiTurnStateV3 } = require('../../services/aiTurnStateV3.cjs');
const { aiRuntimeTelemetry } = require('../../services/aiRuntimeTelemetry.cjs');
const { getAiHealth } = require('../../services/aiHealth.cjs');
const {
    isOntologyRelationCanaryRequestEligible,
    isOwnerScopedAiCanaryRequestEligible,
    isTrustedInternalAiRequest,
} = require('../../services/ontologyRelationCanaryEligibility.cjs');
const {
    loadAiConversationContinuation,
    loadAiRecentPartWrite,
} = require('../../services/aiConversations.cjs');

const router = express.Router();
const aiChatLogger = createLogger('ai-chat');
const DEFAULT_AI_CHAT_TIMEOUT_MS = 180 * 1000;
const DEFAULT_SSE_HEARTBEAT_MS = 15 * 1000;

function boundedDuration(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), minimum), maximum);
}

function aiChatTimeoutMs(env = process.env) {
    return boundedDuration(
        env.AI_CHAT_TIMEOUT_MS,
        DEFAULT_AI_CHAT_TIMEOUT_MS,
        10 * 1000,
        15 * 60 * 1000
    );
}

function sseHeartbeatMs(env = process.env) {
    return boundedDuration(
        env.AI_SSE_HEARTBEAT_MS,
        DEFAULT_SSE_HEARTBEAT_MS,
        5 * 1000,
        60 * 1000
    );
}

function requestAbortError(code, message) {
    const error = new Error(message);
    error.name = 'AbortError';
    error.code = code;
    return error;
}

function buildAiTurnMetrics(runtimeTelemetry = {}, routeMetrics = {}) {
    const durationMs = Math.max(0, Math.trunc(Number(routeMetrics.durationMs) || 0));
    const firstContentMs = routeMetrics.firstContentMs != null && Number.isFinite(Number(routeMetrics.firstContentMs))
        ? Math.max(0, Math.trunc(Number(routeMetrics.firstContentMs)))
        : null;
    const modelDurationMs = runtimeTelemetry.providerDurationMs != null && Number.isFinite(Number(runtimeTelemetry.providerDurationMs))
        ? Math.max(0, Math.trunc(Number(runtimeTelemetry.providerDurationMs)))
        : null;
    const toolDurationMs = (Array.isArray(runtimeTelemetry.toolSteps) ? runtimeTelemetry.toolSteps : [])
        .reduce((sum, step) => sum + (Number.isFinite(Number(step?.durationMs)) ? Math.max(0, Number(step.durationMs)) : 0), 0);
    const usage = runtimeTelemetry.usage && Number.isFinite(Number(runtimeTelemetry.usage.totalTokens))
        ? {
            promptTokens: Math.max(0, Math.trunc(Number(runtimeTelemetry.usage.promptTokens) || 0)),
            completionTokens: Math.max(0, Math.trunc(Number(runtimeTelemetry.usage.completionTokens) || 0)),
            totalTokens: Math.max(0, Math.trunc(Number(runtimeTelemetry.usage.totalTokens) || 0)),
        }
        : null;
    const generationTokensPerSecond = Number(runtimeTelemetry.generationTiming?.tokensPerSecond);
    const hasGenerationTiming = Number.isFinite(generationTokensPerSecond) && generationTokensPerSecond >= 0;
    const generationTimingSource = ['provider_timings', 'stream_observed']
        .includes(runtimeTelemetry.generationTiming?.source)
        ? runtimeTelemetry.generationTiming.source
        : hasGenerationTiming
            ? 'provider_timings'
            : null;
    return {
        durationMs,
        firstContentMs,
        modelDurationMs,
        toolDurationMs: Math.trunc(toolDurationMs),
        modelRequestCount: Math.max(0, Math.trunc(Number(runtimeTelemetry.modelRequestCount) || 0)),
        toolCallCount: Math.max(0, Math.trunc(Number(runtimeTelemetry.executedTools) || 0)),
        tokensPerSecond: hasGenerationTiming && generationTimingSource
            ? generationTokensPerSecond
            : null,
        tokensPerSecondSource: hasGenerationTiming ? generationTimingSource : null,
        usage,
    };
}

function confirmAuth(req, res, next) {
    if (isTrustedInternalAiRequest(req, process.env)) {
        return next();
    }
    return authMiddleware(req, res, next);
}

router.get('/api/ai/capabilities', confirmAuth, (req, res) => {
    try {
        res.json({ success: true, data: aiProviderCapabilities() });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.get('/api/ai/health', confirmAuth, (req, res) => {
    try {
        res.json({ success: true, data: getAiHealth() });
    } catch (error) {
        res.status(500).json({
            success: false,
            code: error.code || 'AI_HEALTH_READ_FAILED',
            error: error.message,
            requestId: req.requestId || null,
        });
    }
});

async function handleAiChat(req, res, options = {}) {
    let providerPreference = null;
    try {
        providerPreference = normalizeProviderPreference(req.body?.providerPreference);
        if (providerPreference) resolveProviderPreference(providerPreference, options.env || process.env);
    } catch (error) {
        return res.status(error.statusCode || 400).json({
            success: false,
            code: error.code || 'AI_PROVIDER_SELECTION_INVALID',
            error: error.message,
            requestId: req.requestId || null,
        });
    }
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const startedAt = Date.now();
    const providerEvents = [];
    const controller = new AbortController();
    let settled = false;
    let clientDisconnected = false;
    let ttftMs = null;
    const telemetry = options.telemetry || aiRuntimeTelemetry;
    const timeoutMs = options.timeoutMs || aiChatTimeoutMs(options.env);
    const timeout = setTimeout(() => {
        controller.abort(requestAbortError('AI_REQUEST_TIMEOUT', `AI 请求超过 ${timeoutMs}ms，已停止`));
    }, timeoutMs);
    timeout.unref?.();
    const abortFromClient = () => {
        if (settled || res.writableEnded) return;
        clientDisconnected = true;
        controller.abort(requestAbortError('AI_REQUEST_CANCELLED', '用户已停止本次 AI 请求'));
    };
    req.once?.('aborted', abortFromClient);
    res.once?.('close', abortFromClient);
    const heartbeat = setInterval(() => {
        if (clientDisconnected || res.writableEnded || res.destroyed) return;
        res.write(': heartbeat\n\n');
        if (typeof res.flush === 'function') res.flush();
    }, options.heartbeatMs || sseHeartbeatMs(options.env));
    heartbeat.unref?.();

    const sendFinal = (type, payload = {}) => {
        if (clientDisconnected || res.writableEnded || res.destroyed) return;
        if (type === 'content' && ttftMs == null) ttftMs = Date.now() - startedAt;
        res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`);
        if (typeof res.flush === 'function') res.flush();
        return true;
    };
    let pendingDone = false;
    const send = (type, payload = {}) => {
        if (type === 'done') {
            pendingDone = true;
            return true;
        }
        return sendFinal(type, payload);
    };
    let lastProviderKey = '';
    const onProvider = info => {
        providerEvents.push({ ...info });
        const key = `${info.provider}:${info.model}:${info.fallback ? 'fallback' : 'primary'}`;
        if (key === lastProviderKey) return;
        lastProviderKey = key;
        send('provider', info);
    };

    try {
        const runtimeEnv = options.env || process.env;
        const trustedInternalRequest = isTrustedInternalAiRequest(req, runtimeEnv);
        const ownerKey = trustedInternalRequest ? 'internal' : (req.user?.role || 'admin');
        const persistedConversationContext = (options.loadAiConversationContinuation || loadAiConversationContinuation)(
            ownerKey,
            req.body?.conversationId
        );
        const recentPartWrite = (options.loadAiRecentPartWrite || loadAiRecentPartWrite)(
            ownerKey,
            req.body?.conversationId
        );
        const result = await (options.runAiDispatcherV3 || runAiDispatcherV3)({
            messages: req.body?.messages,
            conversationId: req.body?.conversationId,
            persistedConversationContext,
            recentPartWrite,
            pageContext: req.body?.pageContext,
            resolutionContext: normalizeResolutionContext(req.body?.resolutionContext),
            turnState: normalizeAiTurnStateV3(req.body?.turnState),
            providerPreference,
            ontologyRelationCanaryEligible: isOntologyRelationCanaryRequestEligible(req, runtimeEnv),
            impactEnforcementCanaryEligible: isOwnerScopedAiCanaryRequestEligible(req, runtimeEnv),
            confirmationSubject: confirmationSubjectForRequest(req),
            stream: true,
            emit: send,
            onProvider,
            signal: controller.signal,
            requestId: req.requestId || null,
        });
        const durationMs = Date.now() - startedAt;
        sendFinal('metrics', buildAiTurnMetrics(result?.telemetry, {
            durationMs,
            firstContentMs: ttftMs,
        }));
        if (pendingDone) sendFinal('done');
        telemetry.record({
            requestId: req.requestId,
            status: 'completed',
            outcome: result?.telemetry?.outcome || 'completed',
            durationMs: Date.now() - startedAt,
            providerEvents,
            ttftMs,
            usage: result?.telemetry?.usage || null,
            stageLatencyMs: result?.telemetry?.stageLatencyMs || {},
            toolSteps: result?.telemetry?.toolSteps || [],
        });
    } catch (error) {
        const abortCode = controller.signal.aborted
            ? controller.signal.reason?.code || error.code
            : '';
        if (abortCode === 'AI_REQUEST_CANCELLED') {
            telemetry.record({
                requestId: req.requestId,
                status: 'cancelled',
                outcome: 'cancelled',
                durationMs: Date.now() - startedAt,
                providerEvents,
                ttftMs,
                errorCode: abortCode,
            });
            return;
        }
        const errorCode = abortCode || error.code || 'ai_dispatcher_v3_error';
        telemetry.record({
            requestId: req.requestId,
            status: 'failed',
            outcome: 'failed',
            durationMs: Date.now() - startedAt,
            providerEvents,
            ttftMs,
            errorCode,
        });
        aiChatLogger.error('AI 对话失败', {
            code: errorCode,
            message: error.message,
            causeCode: error.cause?.code || error.cause?.cause?.code || null,
            provider: error.details?.provider || null,
            action: error.details?.action || null,
            requestId: req.requestId || null,
        });
        sendFinal('error', { message: error.message, code: errorCode });
    } finally {
        settled = true;
        clearTimeout(timeout);
        clearInterval(heartbeat);
        req.removeListener?.('aborted', abortFromClient);
        res.removeListener?.('close', abortFromClient);
        if (!res.writableEnded && !res.destroyed) res.end();
    }
}

router.post('/api/ai/chat', confirmAuth, handleAiChat);

router.post('/api/ai/confirm-tool/preview', confirmAuth, async (req, res) => {
    const confirmationSubject = confirmationSubjectForRequest(req);
    const { confirmationToken, toolName, args } = req.body || {};
    if (!confirmationToken || !toolName || !args || typeof args !== 'object' || Array.isArray(args)) {
        return res.status(400).json({
            success: false,
            code: 'confirmation_revision_payload_required',
            error: '缺少确认凭证、能力名称或修改后的参数',
            requestId: req.requestId || null,
        });
    }
    try {
        const data = await reviseAiToolConfirmation({
            confirmationToken,
            subject: confirmationSubject,
            toolName,
            args,
        });
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(error.statusCode || 500).json({
            success: false,
            code: error.code || 'confirmation_revision_error',
            error: error.message,
            requestId: req.requestId || null,
        });
    }
});

router.post('/api/ai/confirm-tool', confirmAuth, async (req, res) => {
    const confirmationSubject = confirmationSubjectForRequest(req);
    const { confirmationToken, toolName, args } = req.body || {};
    if (!confirmationToken) {
        return res.status(409).json({
            success: false,
            code: 'confirmation_token_required',
            error: '旧确认请求不能直接执行，请重新发起操作并核对新的确认卡片',
            requestId: req.requestId || null,
        });
    }

    try {
        const receipt = await executeConfirmedAiTool({
            confirmationToken,
            subject: confirmationSubject,
            expectedToolName: toolName,
            expectedArgs: Object.hasOwn(req.body || {}, 'args') ? args : undefined,
        });
        return res.json({ success: true, data: receipt });
    } catch (error) {
        const statusCode = error instanceof AiToolConfirmationError
            ? error.statusCode
            : error.statusCode || 500;
        return res.status(statusCode).json({
            success: false,
            code: error.code || 'confirmation_execution_error',
            error: error.message,
            operationId: error.operationId || null,
            requestId: req.requestId || null,
        });
    }
});

async function processAiChat(text, options = {}) {
    return runAiDispatcherV3({
        messages: [
            ...(Array.isArray(options.context) ? options.context : []),
            { role: 'user', content: text },
        ],
        promptSuffix: options.promptSuffix,
        conversationId: options.conversationId,
        allowWrite: Boolean(options.allowWrite),
        pageContext: options.pageContext,
        resolutionContext: options.resolutionContext,
        turnState: options.turnState,
        providerPreference: normalizeProviderPreference(options.providerPreference),
        confirmationSubject: options.confirmationSubject || 'internal:process-ai-chat',
        fetchAiProvider: options.fetchAiProvider,
        env: options.env,
        // processAiChat is an internal server-side entry point. The runtime still requires the
        // independent environment flags before either canary can become authoritative.
        ontologyRelationCanaryEligible: true,
        impactEnforcementCanaryEligible: true,
        dbAccessors: options.dbAccessors,
        stream: false,
        signal: options.signal,
        requestId: options.requestId || null,
    });
}

module.exports = {
    DEFAULT_AI_CHAT_TIMEOUT_MS,
    DEFAULT_SSE_HEARTBEAT_MS,
    aiChatTimeoutMs,
    buildAiTurnMetrics,
    handleAiChat,
    processAiChat,
    router,
    sseHeartbeatMs,
};
