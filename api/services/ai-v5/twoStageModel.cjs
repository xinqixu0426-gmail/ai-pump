'use strict';
const { configuredInterpreterModel, requestConfiguredInterpreterModel } = require('./taskInterpreter.cjs');

// Only bounded, allowlisted categories cross the diagnostic boundary. Never copy
// Error.message, stack, provider response bodies, or arbitrary nested causes.
function safeModelError(error) {
    const codes = ['AI_PROVIDER_REQUEST_ERROR','AI_PROVIDER_AUTH_ERROR','AI_PROVIDER_TIMEOUT','AI_PROVIDER_RATE_LIMITED','AI_PROVIDER_UPSTREAM_ERROR','AI_PROVIDER_NETWORK_ERROR','V5_SHADOW_INTERPRETER_PROVIDER_UNAVAILABLE','AI_REQUEST_CANCELLED','STAGE_TIMEOUT'];
    const classes = ['AiProviderHttpError','AiProviderNetworkError','AiProviderTimeoutError','Error','TypeError','SyntaxError','AbortError'];
    const code = codes.includes(error?.code) ? error.code : 'UNKNOWN';
    const timeout = code === 'STAGE_TIMEOUT' || code === 'AI_PROVIDER_TIMEOUT';
    const httpStatus = Number.isInteger(error?.statusCode) && error.statusCode >= 100 && error.statusCode <= 599 ? error.statusCode : null;
    const category = timeout ? 'MODEL_PROVIDER_TIMEOUT'
        : ['AI_PROVIDER_AUTH_ERROR','V5_SHADOW_INTERPRETER_PROVIDER_UNAVAILABLE'].includes(code) ? 'MODEL_PROVIDER_AUTH_ERROR'
        : ['AI_PROVIDER_REQUEST_ERROR','AI_PROVIDER_RATE_LIMITED'].includes(code) ? 'MODEL_PROVIDER_REQUEST_ERROR'
        : 'MODEL_PROVIDER_RESPONSE_ERROR';
    const causeCategories = [];
    const seen = new Set();
    for (let cause = error?.cause; cause && causeCategories.length < 3 && !seen.has(cause); cause = cause.cause) {
        seen.add(cause);
        causeCategories.push(classes.includes(cause.name) ? cause.name : 'UNKNOWN');
    }
    return Object.freeze({ category, errorClass: classes.includes(error?.name) ? error.name : 'UNKNOWN',
        internalCode: code, httpStatus, providerCategory: 'deepseek', timeout,
        retryable: typeof error?.retryable === 'boolean' ? error.retryable : null,
        causeCategories: Object.freeze(causeCategories) });
}

// Request-local configuration: never change the provider of V4 or another task.
async function callStage(messages, options = {}) {
    const env = { ...(options.env || process.env), AI_PROVIDER: 'deepseek', DEEPSEEK_MODEL: 'deepseek-v4-flash' };
    const selected = configuredInterpreterModel(env);
    const timeoutMs = options.timeoutMs || 20000;
    const controller = new AbortController();
    let timer;
    const started = performance.now();
    try {
        const response = await Promise.race([
            Promise.resolve().then(() => (options.observeModelCall || ((meta, fn) => fn()))({
                provider: selected.provider, model: selected.model, toolDefinitionCount: 0,
                shadowTaskId: options.shadowTaskId,
            }, () => (options.modelRequest || requestConfiguredInterpreterModel)(messages, {
                env, selected, signal: controller.signal, timeoutMs,
            }))),
            new Promise((resolve, reject) => {
                timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('STAGE_TIMEOUT'), { code: 'STAGE_TIMEOUT' })); }, timeoutMs);
            }),
        ]);
        return { status: 'OK', content: response?.content, usage: response?.usage || null, durationMs: performance.now() - started };
    } catch (error) {
        const errorMetadata = safeModelError(error);
        return { status: errorMetadata.timeout ? 'TIMEOUT' : 'ERROR', reasonCode: errorMetadata.category,
            errorMetadata, durationMs: performance.now() - started };
    } finally { clearTimeout(timer); }
}
function parseStrict(content, keys) {
    let value;
    try { value = JSON.parse(content); } catch { throw new Error('INVALID_JSON'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())
        || value.version !== 1) throw new Error('INVALID_SCHEMA');
    return value;
}
module.exports = { callStage, parseStrict, safeModelError };
