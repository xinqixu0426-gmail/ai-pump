'use strict';

const { performance } = require('node:perf_hooks');
const {
    fetchProviderWithRetry,
    providerHttpError,
} = require('../aiProvider.cjs');
const { resolveAiProviderConfig } = require('../aiProviderRegistry.cjs');
const {
    V5_TASK_INTERPRETER_PROMPT_VERSION,
    V5_TASK_INTERPRETER_VERSION,
    interpreterEnumContract,
    parseV5TaskInterpretation,
} = require('./taskInterpretationContract.cjs');

const DEFAULT_V5_INTERPRETER_TIMEOUT_MS = 20_000;
const V5_INTERPRETER_RETRY_COUNT = 0;

function buildInterpreterInstruction() {
    const enums = interpreterEnumContract();
    return [
        `Pump AI V5 Task Interpreter prompt version ${V5_TASK_INTERPRETER_PROMPT_VERSION}.`,
        'Return exactly one JSON object and no Markdown or reasoning.',
        'You only classify domain, operation, entity candidates and clarification status.',
        'Never select or name a Tool, choose a business ID, decide policy, verify evidence, or answer the request.',
        'Every candidateText must be copied byte-for-byte from one exact substring of the user request, preserving case, punctuation and numeric-looking text.',
        'Do not normalize, trim, repair, translate, coerce or approximate candidateText.',
        'Schema keys must be exactly: version, domain, operation, entityCandidates, needsClarification, reasonCodes.',
        'Each entity candidate keys must be exactly: entityType, candidateText.',
        `version must be ${V5_TASK_INTERPRETER_VERSION}.`,
        'reasonCodes may contain only INTERPRETATION_COMPLETE, NEEDS_CLARIFICATION, ENTITY_REFERENCE_REQUIRED.',
        `Allowed route tuples: ${JSON.stringify(enums.routes)}.`,
        `Allowed entity types: ${JSON.stringify(enums.entityTypes)}.`,
    ].join('\n');
}

const V5_TASK_INTERPRETER_INSTRUCTION = buildInterpreterInstruction();

function safeUsage(value) {
    if (!value || typeof value !== 'object') return null;
    const promptTokens = Number(value.prompt_tokens);
    const completionTokens = Number(value.completion_tokens);
    const totalTokens = Number(value.total_tokens);
    if (![promptTokens, completionTokens, totalTokens].some(Number.isFinite)) return null;
    return Object.freeze({
        promptTokens: Number.isFinite(promptTokens) ? Math.max(0, promptTokens) : null,
        completionTokens: Number.isFinite(completionTokens) ? Math.max(0, completionTokens) : null,
        totalTokens: Number.isFinite(totalTokens) ? Math.max(0, totalTokens) : null,
    });
}

function configuredInterpreterModel(env = process.env) {
    const config = resolveAiProviderConfig(env);
    return Object.freeze({ provider: config.provider, model: config.model, config });
}

async function requestConfiguredInterpreterModel(messages, options = {}) {
    const env = options.env || process.env;
    const selected = options.selected || configuredInterpreterModel(env);
    const config = selected.config;
    if (!config.apiKey) throw Object.assign(new Error('V5 interpreter provider unavailable'), {
        code: 'V5_SHADOW_INTERPRETER_PROVIDER_UNAVAILABLE',
    });
    const response = await fetchProviderWithRetry(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
            messages,
            stream: false,
        }),
    }, {
        config,
        action: 'V5 Task Interpreter',
        env,
        fetchImpl: options.fetchImpl,
        maxAttempts: 1,
        retryDelayMs: 0,
        signal: options.signal,
        timeoutMs: options.timeoutMs,
    });
    if (!response.ok) {
        const responseText = await response.text();
        throw providerHttpError(response, responseText, config, 'V5 Task Interpreter');
    }
    const data = await response.json();
    return {
        content: data?.choices?.[0]?.message?.content,
        usage: safeUsage(data?.usage),
        provider: config.provider,
        model: config.model,
    };
}

function safeFailure(status, reasonCode, selected, durationMs) {
    return Object.freeze({
        status,
        reasonCode,
        interpretation: null,
        provider: selected?.provider || 'unknown',
        model: selected?.model || 'unknown',
        usage: null,
        durationMs,
        modelCalls: 1,
    });
}

async function interpretV5Task(sourceRequest, options = {}) {
    const started = performance.now();
    let selected;
    try {
        selected = options.selected || configuredInterpreterModel(options.env || process.env);
    } catch {
        selected = { provider: 'unknown', model: 'unknown' };
    }
    if (typeof sourceRequest !== 'string' || sourceRequest.length === 0) {
        return Object.freeze({
            ...safeFailure('INVALID', 'SOURCE_REQUEST_INVALID', selected, performance.now() - started),
            modelCalls: 0,
        });
    }
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.trunc(options.timeoutMs)
        : DEFAULT_V5_INTERPRETER_TIMEOUT_MS;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(Object.assign(new Error('V5 interpreter timeout'), {
            code: 'SHADOW_INTERPRETER_TIMEOUT',
        }));
    }, timeoutMs);
    const modelRequest = options.modelRequest || requestConfiguredInterpreterModel;
    const observeModelCall = options.observeModelCall || ((_metadata, operation) => operation());
    const messages = [
        { role: 'system', content: V5_TASK_INTERPRETER_INSTRUCTION },
        { role: 'user', content: sourceRequest },
    ];
    try {
        const requestPromise = Promise.resolve().then(() => observeModelCall({
            provider: selected.provider,
            model: selected.model,
            streaming: false,
            toolDefinitionCount: 0,
            shadowTaskId: options.shadowTaskId,
        }, () => modelRequest(messages, {
            env: options.env || process.env,
            selected,
            signal: controller.signal,
            timeoutMs,
        })));
        const timeoutPromise = new Promise(resolve => {
            controller.signal.addEventListener('abort', () => resolve({ __interpreterTimeout: true }), { once: true });
        });
        const response = await Promise.race([
            requestPromise.catch(error => ({ __interpreterError: error })),
            timeoutPromise,
        ]);
        if (timedOut || response?.__interpreterTimeout) {
            return safeFailure('TIMEOUT', 'SHADOW_INTERPRETER_TIMEOUT', selected, performance.now() - started);
        }
        if (response?.__interpreterError) {
            return safeFailure('ERROR', 'V5_SHADOW_INTERPRETER_ERROR', selected, performance.now() - started);
        }
        let interpretation;
        try {
            interpretation = parseV5TaskInterpretation(response?.content);
        } catch (error) {
            return safeFailure('INVALID', error.reasonCode || 'INTERPRETATION_INVALID', selected, performance.now() - started);
        }
        return Object.freeze({
            status: 'VALID',
            reasonCode: interpretation.needsClarification
                ? 'INTERPRETATION_NEEDS_CLARIFICATION'
                : 'INTERPRETATION_VALID',
            interpretation,
            provider: response?.provider || selected.provider,
            model: response?.model || selected.model,
            usage: safeUsage({
                prompt_tokens: response?.usage?.promptTokens,
                completion_tokens: response?.usage?.completionTokens,
                total_tokens: response?.usage?.totalTokens,
            }) || response?.usage || null,
            durationMs: performance.now() - started,
            modelCalls: 1,
        });
    } finally {
        clearTimeout(timer);
    }
}

module.exports = {
    DEFAULT_V5_INTERPRETER_TIMEOUT_MS,
    V5_INTERPRETER_RETRY_COUNT,
    V5_TASK_INTERPRETER_INSTRUCTION,
    configuredInterpreterModel,
    interpretV5Task,
    requestConfiguredInterpreterModel,
};
