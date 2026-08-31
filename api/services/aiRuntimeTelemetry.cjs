const DEFAULT_WINDOW_SIZE = 100;

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
        errorCode: String(event.errorCode || '').slice(0, 80),
        status: Number.isInteger(Number(event.status)) ? Number(event.status) : null,
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
        };
        samples.push(sample);
        if (samples.length > windowSize) samples.splice(0, samples.length - windowSize);

        totals.requests += 1;
        totals[status] += 1;
        totals.timeouts += timeout ? 1 : 0;
        totals.fallbacks += fallbackCount > 0 ? 1 : 0;
        totals.retries += retryCount;
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
