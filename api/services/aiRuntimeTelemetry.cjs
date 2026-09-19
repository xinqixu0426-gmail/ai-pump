const DEFAULT_WINDOW_SIZE = 100;
const { normalizeProviderUsage } = require('./aiTokenBudget.cjs');

function boundedInteger(value, fallback, minimum, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(Math.trunc(parsed), minimum), maximum);
}

function safeProviderEvent(event = {}) {
    return {
        provider: String(event.provider || '').slice(0, 40),
        model: String(event.model || '').slice(0, 120),
        routeReason: String(event.routeReason || '').slice(0, 60),
        fallback: event.fallback === true,
        retry: event.retry === true,
        failed: event.failed === true,
        errorCode: String(event.errorCode || event.code || event.causeCode || '').slice(0, 80),
        status: Number.isInteger(Number(event.status)) ? Number(event.status) : null,
        fallbackFrom: String(event.fallbackFrom || '').slice(0, 40),
        action: String(event.action || '').slice(0, 40),
        attempt: Number.isInteger(Number(event.attempt)) ? Number(event.attempt) : null,
        maxAttempts: Number.isInteger(Number(event.maxAttempts)) ? Number(event.maxAttempts) : null,
        toolChoiceFallback: event.toolChoiceFallback === true,
    };
}

function safeDuration(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(1)) : null;
}

function summarizeValues(values) {
    const valid = values.filter(value => Number.isFinite(value) && value >= 0);
    return {
        sampleCount: valid.length,
        average: valid.length
            ? Number((valid.reduce((sum, value) => sum + value, 0) / valid.length).toFixed(1))
            : 0,
        p95: Number(percentile(valid, 0.95).toFixed(1)),
        maximum: valid.length ? Number(Math.max(...valid).toFixed(1)) : 0,
    };
}

function percentile(values, ratio) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(Math.ceil(sorted.length * ratio) - 1, sorted.length - 1)];
}

function createAiRuntimeTelemetry(options = {}) {
    const windowSize = boundedInteger(
        options.windowSize,
        DEFAULT_WINDOW_SIZE,
        10,
        500
    );
    const startedAt = options.startedAt || new Date().toISOString();
    const samples = [];
    const totals = {
        requests: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        timeouts: 0,
        fallbacks: 0,
        retries: 0,
        usageReportedRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
    };
    let lastRequestAt = null;
    let lastSuccessAt = null;
    let lastFailureAt = null;
    let lastError = null;

    function record(input = {}) {
        const status = ['completed', 'failed', 'cancelled'].includes(input.status)
            ? input.status
            : 'failed';
        const providerEvents = (Array.isArray(input.providerEvents) ? input.providerEvents : [])
            .slice(-20)
            .map(safeProviderEvent);
        const recordedAt = input.recordedAt || new Date().toISOString();
        const errorCode = String(input.errorCode || '').slice(0, 80);
        const timeout = errorCode === 'AI_PROVIDER_TIMEOUT'
            || errorCode === 'AI_REQUEST_TIMEOUT';
        const fallbackCount = providerEvents.filter(event => event.fallback).length;
        const retryCount = providerEvents.filter(event => event.retry).length;
        const selectedProvider = [...providerEvents]
            .reverse()
            .find(event => event.provider && !event.failed && !event.retry) || null;
        const usage = normalizeProviderUsage(input.usage);
        const stageLatencyMs = Object.fromEntries(
            Object.entries(input.stageLatencyMs || {})
                .map(([key, value]) => [String(key).slice(0, 40), safeDuration(value)])
                .filter(([, value]) => value != null)
        );
        const toolSteps = (Array.isArray(input.toolSteps) ? input.toolSteps : [])
            .slice(0, 20)
            .map(step => ({
                capabilityName: String(step?.capabilityName || '').slice(0, 100),
                durationMs: safeDuration(step?.durationMs) || 0,
                success: step?.success === true,
                errorCode: String(step?.errorCode || '').slice(0, 80),
            }));
        const providerAttemptMap = new Map();
        for (const event of providerEvents) {
            if (!event.provider || event.retry) continue;
            const key = `${event.provider}\u0000${event.model}`;
            const current = providerAttemptMap.get(key) || {
                provider: event.provider,
                model: event.model,
                failed: false,
                fallback: false,
            };
            current.failed ||= event.failed;
            current.fallback ||= event.fallback;
            providerAttemptMap.set(key, current);
        }
        const sample = {
            requestId: String(input.requestId || '').slice(0, 128) || null,
            status,
            outcome: String(input.outcome || '').slice(0, 40),
            durationMs: Math.max(0, Number(input.durationMs) || 0),
            provider: selectedProvider?.provider || '',
            model: selectedProvider?.model || '',
            fallback: fallbackCount > 0,
            retries: retryCount,
            errorCode: status === 'completed' ? '' : errorCode || 'AI_REQUEST_FAILED',
            recordedAt,
            providerAttempts: [...providerAttemptMap.values()],
            ttftMs: safeDuration(input.ttftMs),
            usage,
            stageLatencyMs,
            toolSteps,
        };
        samples.push(sample);
        if (samples.length > windowSize) samples.splice(0, samples.length - windowSize);

        totals.requests += 1;
        totals[status] += 1;
        totals.timeouts += timeout ? 1 : 0;
        totals.fallbacks += fallbackCount > 0 ? 1 : 0;
        totals.retries += retryCount;
        if (usage) {
            totals.usageReportedRequests += 1;
            totals.promptTokens += usage.promptTokens || 0;
            totals.completionTokens += usage.completionTokens || 0;
            totals.totalTokens += usage.totalTokens || 0;
        }
        lastRequestAt = recordedAt;
        if (status === 'completed') {
            lastSuccessAt = recordedAt;
        } else {
            lastFailureAt = recordedAt;
            const failedProvider = [...providerEvents].reverse().find(event => event.failed);
            lastError = {
                code: sample.errorCode,
                provider: failedProvider?.provider || sample.provider,
                status: failedProvider?.status || null,
                requestId: sample.requestId,
                at: recordedAt,
            };
        }
        return sample;
    }

    function snapshot() {
        const durations = samples.map(item => item.durationMs);
        const ttftValues = samples.map(item => item.ttftMs).filter(value => value != null);
        const stageNames = new Set(samples.flatMap(item => Object.keys(item.stageLatencyMs)));
        const stages = {};
        for (const stageName of stageNames) {
            stages[stageName] = summarizeValues(samples
                .map(item => item.stageLatencyMs[stageName])
                .filter(value => value != null));
        }
        stages.tools = summarizeValues(samples.flatMap(item => (
            item.toolSteps.map(step => step.durationMs)
        )));
        const providerMap = new Map();
        for (const sample of samples) {
            for (const attempt of sample.providerAttempts) {
                const key = `${attempt.provider}\u0000${attempt.model}`;
                const current = providerMap.get(key) || {
                    provider: attempt.provider,
                    model: attempt.model,
                    requests: 0,
                    failures: 0,
                    fallbacks: 0,
                };
                current.requests += 1;
                current.failures += attempt.failed ? 1 : 0;
                current.fallbacks += attempt.fallback ? 1 : 0;
                providerMap.set(key, current);
            }
        }
        return {
            startedAt,
            windowSize,
            sampleCount: samples.length,
            totals: { ...totals },
            latencyMs: {
                average: durations.length
                    ? Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(1))
                    : 0,
                p95: Number(percentile(durations, 0.95).toFixed(1)),
                maximum: durations.length ? Number(Math.max(...durations).toFixed(1)) : 0,
            },
            ttftMs: summarizeValues(ttftValues),
            stages,
            usage: {
                availability: samples.length
                    ? Number((samples.filter(item => item.usage).length / samples.length).toFixed(3))
                    : 0,
                reportedRequests: samples.filter(item => item.usage).length,
                promptTokens: samples.reduce((sum, item) => sum + (item.usage?.promptTokens || 0), 0),
                completionTokens: samples.reduce((sum, item) => sum + (item.usage?.completionTokens || 0), 0),
                totalTokens: samples.reduce((sum, item) => sum + (item.usage?.totalTokens || 0), 0),
                source: 'provider_reported_only',
            },
            lastRequestAt,
            lastSuccessAt,
            lastFailureAt,
            lastError: lastError ? { ...lastError } : null,
            providers: [...providerMap.values()].sort((left, right) => (
                right.requests - left.requests
                || left.provider.localeCompare(right.provider)
            )),
        };
    }

    return { record, snapshot };
}

const aiRuntimeTelemetry = createAiRuntimeTelemetry();

module.exports = {
    DEFAULT_WINDOW_SIZE,
    aiRuntimeTelemetry,
    createAiRuntimeTelemetry,
};
