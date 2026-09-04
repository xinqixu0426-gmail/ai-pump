'use strict';

const { createLogger } = require('../../logger.cjs');
const { getV5Capability, buildToolCapabilityReverseIndex } = require('./capabilityRegistry.cjs');
const { projectSafeV4Facts } = require('./shadowProjection.cjs');
const { compareV4ActualToV5Shadow } = require('./shadowComparison.cjs');
const { runV5IndependentShadow } = require('./independentShadow.cjs');
const { DEFAULT_V5_INTERPRETER_TIMEOUT_MS } = require('./taskInterpreter.cjs');
const {
    withModelSpan,
    withV5ShadowComparisonSpan,
    withV5ShadowProjectionSpan,
    withV5ShadowSpan,
} = require('../observability.cjs');

const DEFAULT_V5_SHADOW_ENABLED = false;
const DEFAULT_V5_SHADOW_SAMPLE_RATE = 0;
const DEFAULT_V5_SHADOW_MAX_CONCURRENCY = 4;
const DEFAULT_V5_SHADOW_TIMEOUT_MS = 100;
const SHADOW_PROJECT = 'pump-ai-v5e4-independent-shadow';
const logger = createLogger('ai-v5-shadow');

function freeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

function readV5ShadowConfig(env = process.env, options = {}) {
    const enabled = env.AI_V5_SHADOW_ENABLED === 'true';
    const rawRate = env.AI_V5_SHADOW_SAMPLE_RATE;
    const parsedRate = rawRate === undefined || rawRate === '' ? 0 : Number(rawRate);
    const sampleRate = Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 1
        ? parsedRate
        : 0;
    const maxConcurrency = Number.isInteger(options.maxConcurrency) && options.maxConcurrency > 0
        ? options.maxConcurrency
        : DEFAULT_V5_SHADOW_MAX_CONCURRENCY;
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? Math.trunc(options.timeoutMs)
        : DEFAULT_V5_SHADOW_TIMEOUT_MS;
    const configuredInterpreterTimeout = Number(env.AI_V5_INTERPRETER_TIMEOUT_MS);
    const interpreterTimeoutMs = Number.isFinite(options.interpreterTimeoutMs)
        && options.interpreterTimeoutMs > 0
        ? Math.trunc(options.interpreterTimeoutMs)
        : Number.isFinite(configuredInterpreterTimeout)
            && configuredInterpreterTimeout >= 1000 && configuredInterpreterTimeout <= 60_000
            ? Math.trunc(configuredInterpreterTimeout)
            : DEFAULT_V5_INTERPRETER_TIMEOUT_MS;
    return freeze({
        enabled, sampleRate, maxConcurrency, timeoutMs, interpreterTimeoutMs, project: SHADOW_PROJECT,
    });
}

function classifyEligibility(facts) {
    if (!facts || facts.allowWrite || facts.requestMode === 'command'
        || facts.finalV4Status === 'confirmation') {
        return freeze({ eligible: false, status: 'SKIPPED_POLICY', reasonCode: 'WRITE_OR_CONFIRMATION_EXCLUDED' });
    }
    if (!Array.isArray(facts.toolSteps) || facts.toolSteps.length === 0) {
        return freeze({ eligible: false, status: 'SKIPPED_POLICY', reasonCode: 'UNKNOWN_RISK_EXCLUDED' });
    }
    const reverse = buildToolCapabilityReverseIndex();
    for (const step of facts.toolSteps) {
        const ids = reverse[step.toolName] || [];
        if (ids.length !== 1) return freeze({ eligible: false, status: 'SKIPPED_POLICY', reasonCode: 'UNKNOWN_RISK_EXCLUDED' });
        const capability = getV5Capability(ids[0]);
        if (!capability || capability.readWriteClass !== 'READ' || !['L1', 'L2'].includes(capability.riskClass)) {
            return freeze({ eligible: false, status: 'SKIPPED_POLICY', reasonCode: 'WRITE_OR_CRITICAL_EXCLUDED' });
        }
    }
    return freeze({ eligible: true, status: 'ELIGIBLE', reasonCode: 'READ_ONLY_ELIGIBLE' });
}

function safeErrorOutcome(facts, reasonCode) {
    return freeze({
        shadowTaskId: facts?.shadowTaskId || null,
        sourceRequestId: facts?.sourceRequestId || null,
        sourceRequestIdHash: facts?.sourceRequestIdHash || null,
        sourceTraceId: facts?.sourceTraceId || null,
        projectionStatus: 'ERROR',
        entityAssessment: { status: 'UNKNOWN' },
        capabilityAssessment: { status: 'UNKNOWN' },
        toolExposureAssessment: { status: 'UNKNOWN' },
        stateAssessment: { status: 'UNKNOWN' },
        policyAssessment: { status: 'UNKNOWN' },
        evidenceAssessment: { status: 'UNKNOWN' },
        verificationAssessment: { status: 'UNKNOWN' },
        comparisonStatus: 'SHADOW_ERROR',
        reasonCodes: [reasonCode],
    });
}

function assembleOutcome(facts, projection, comparison, independentShadow = null) {
    return freeze({
        shadowTaskId: facts.shadowTaskId,
        sourceRequestId: facts.sourceRequestId,
        sourceRequestIdHash: facts.sourceRequestIdHash,
        sourceTraceId: facts.sourceTraceId,
        projectionStatus: projection.projectionStatus,
        entityAssessment: projection.entityAssessment,
        capabilityAssessment: projection.capabilityAssessment,
        toolExposureAssessment: projection.toolExposureAssessment,
        stateAssessment: projection.stateAssessment,
        policyAssessment: projection.policyAssessment,
        evidenceAssessment: projection.evidenceAssessment,
        verificationAssessment: projection.verificationAssessment,
        argumentAssessment: projection.argumentAssessment,
        availability: projection.availability,
        entityComparison: comparison.entityComparison,
        capabilityComparison: comparison.capabilityComparison,
        toolExposureComparison: comparison.toolExposureComparison,
        argumentComparison: comparison.argumentComparison,
        stateComparison: comparison.stateComparison,
        policyComparison: comparison.policyComparison,
        verificationComparison: comparison.verificationComparison,
        comparisonStatus: comparison.comparisonStatus,
        independentShadow,
        reasonCodes: [...new Set([...projection.reasonCodes, ...comparison.reasonCodes])],
    });
}

function createV5ShadowMirror(options = {}) {
    const config = readV5ShadowConfig(options.env || process.env, options);
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const schedule = typeof options.schedule === 'function' ? options.schedule : setImmediate;
    const project = options.project || projectSafeV4Facts;
    const compare = options.compare || compareV4ActualToV5Shadow;
    const runIndependent = options.runIndependent || runV5IndependentShadow;
    const onOutcome = typeof options.onOutcome === 'function' ? options.onOutcome : () => {};
    const active = new Set();
    const counters = {
        tasksCreated: 0,
        mirroredRequests: 0,
        skippedPolicy: 0,
        skippedSample: 0,
        skippedCapacity: 0,
        shadowErrors: 0,
        shadowTimeouts: 0,
        v5ModelCalls: 0,
        v5ToolCalls: 0,
        v5BusinessApiCalls: 0,
        v5Writes: 0,
    };

    function snapshot() {
        return freeze({ ...counters, active: active.size });
    }

    function mirror(facts, runtimeOptions = {}) {
        if (!config.enabled) return freeze({ shadowStatus: 'DISABLED', completion: null });
        const eligibility = classifyEligibility(facts);
        if (!eligibility.eligible) {
            counters.skippedPolicy += 1;
            return freeze({ shadowStatus: eligibility.status, reasonCode: eligibility.reasonCode, completion: null });
        }
        if (config.sampleRate === 0 || random() >= config.sampleRate) {
            counters.skippedSample += 1;
            return freeze({ shadowStatus: 'SKIPPED_SAMPLE', completion: null });
        }
        if (active.size >= config.maxConcurrency) {
            counters.skippedCapacity += 1;
            return freeze({ shadowStatus: 'SHADOW_SKIPPED_CAPACITY', completion: null });
        }

        counters.tasksCreated += 1;
        counters.mirroredRequests += 1;
        let resolveCompletion;
        const completion = new Promise(resolve => { resolveCompletion = resolve; });
        active.add(completion);
        schedule(() => {
            let timeout;
            const execution = Promise.resolve().then(() => withV5ShadowSpan(facts, async () => {
                const projection = await withV5ShadowProjectionSpan(facts, () => project(facts));
                const comparison = await withV5ShadowComparisonSpan(facts, () => compare(projection));
                const independentShadow = typeof runtimeOptions.sourceRequest === 'string'
                    ? await runIndependent({
                        sourceRequest: runtimeOptions.sourceRequest,
                        shadowTaskId: facts.shadowTaskId,
                    }, {
                        env: runtimeOptions.env || options.env || process.env,
                        modelRequest: runtimeOptions.interpreterModelRequest,
                        timeoutMs: config.interpreterTimeoutMs,
                        observeModelCall: (metadata, operation) => withModelSpan(metadata, operation),
                    })
                    : null;
                counters.v5ModelCalls += Math.max(0, Number(independentShadow?.modelCalls) || 0);
                return assembleOutcome(facts, projection, comparison, independentShadow);
            }));
            const executionTimeoutMs = typeof runtimeOptions.sourceRequest === 'string'
                ? config.interpreterTimeoutMs + Math.max(config.timeoutMs, 100)
                : config.timeoutMs;
            const timeoutResult = new Promise(resolve => {
                timeout = setTimeout(() => resolve(safeErrorOutcome(facts, 'SHADOW_TIMEOUT')), executionTimeoutMs);
                timeout.unref?.();
            });
            Promise.race([execution, timeoutResult]).then(outcome => {
                if (outcome.reasonCodes.includes('SHADOW_TIMEOUT')) counters.shadowTimeouts += 1;
                if (outcome.comparisonStatus === 'SHADOW_ERROR') counters.shadowErrors += 1;
                try { onOutcome(outcome); } catch { /* Observer cannot affect shadow. */ }
                try { runtimeOptions.onOutcome?.(outcome); } catch { /* Observer cannot affect shadow. */ }
                clearTimeout(timeout);
                active.delete(completion);
                resolveCompletion(outcome);
            }).catch(() => {
                counters.shadowErrors += 1;
                const outcome = safeErrorOutcome(facts, 'SHADOW_INTERNAL_ERROR');
                try { onOutcome(outcome); } catch { /* Observer cannot affect shadow. */ }
                try { runtimeOptions.onOutcome?.(outcome); } catch { /* Observer cannot affect shadow. */ }
                clearTimeout(timeout);
                active.delete(completion);
                resolveCompletion(outcome);
            });
        });
        return freeze({ shadowStatus: 'SCHEDULED', shadowTaskId: facts.shadowTaskId, completion });
    }

    async function waitForIdle(timeoutMs = 1000) {
        const deadline = Date.now() + timeoutMs;
        while (active.size > 0 && Date.now() < deadline) {
            await Promise.race([...active, new Promise(resolve => {
                const timer = setTimeout(resolve, Math.min(10, Math.max(1, deadline - Date.now())));
                timer.unref?.();
            })]);
        }
        return active.size === 0;
    }

    return freeze({ config, mirror, snapshot, waitForIdle });
}

let productionMirror = null;
let productionConfigKey = null;

function scheduleV5ShadowMirror(facts, options = {}) {
    try {
        const env = options.env || process.env;
        const key = `${env.AI_V5_SHADOW_ENABLED || ''}:${env.AI_V5_SHADOW_SAMPLE_RATE || ''}:${env.AI_V5_INTERPRETER_TIMEOUT_MS || ''}`;
        if (!productionMirror || key !== productionConfigKey) {
            productionMirror = createV5ShadowMirror({ env, logger: options.logger });
            productionConfigKey = key;
        }
        return productionMirror.mirror(facts, options);
    } catch (error) {
        try {
            (options.logger || logger).warn('V5 shadow 调度失败，V4 继续', {
                errorType: error?.name || 'ShadowError',
                shadowStatus: 'SHADOW_ERROR',
            });
        } catch { /* Logging remains fail-open. */ }
        return freeze({ shadowStatus: 'SHADOW_ERROR', completion: null });
    }
}

module.exports = {
    DEFAULT_V5_SHADOW_ENABLED,
    DEFAULT_V5_SHADOW_MAX_CONCURRENCY,
    DEFAULT_V5_SHADOW_SAMPLE_RATE,
    DEFAULT_V5_SHADOW_TIMEOUT_MS,
    SHADOW_PROJECT,
    classifyEligibility,
    createV5ShadowMirror,
    readV5ShadowConfig,
    scheduleV5ShadowMirror,
};
