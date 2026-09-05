'use strict';
const { randomUUID } = require('node:crypto');
const { createV5Task, createV5EntityReference } = require('./contracts.cjs');
const { createV5InterpreterInputEnvelope } = require('./taskInterpreterInput.cjs');
const { interpretCandidateSetTask } = require('./candidateSetTwoStageInterpreter.cjs');
const { routeV5Capability } = require('./capabilityRouter.cjs');
const { transitionTask } = require('./taskState.cjs');
const { selectReadExecution } = require('./readExecutionRegistry.cjs');
const { runReadExecutionShadow } = require('./readExecutionShadow.cjs');
const { composeReadAnswerForCanary } = require('./readAnswerComposer.cjs');
const { captureSafeV4ShadowFacts } = require('./shadowProjection.cjs');
const { classifyEligibility } = require('./shadowMirror.cjs');
const { extractSourceUserRequest } = require('./independentShadow.cjs');
const obs = require('../observability.cjs');

// Explicit preview scope, not an intent classifier or a second capability registry.
const FACT_CAPABILITY = Object.freeze({ 'price.current': 'inventory.read', 'inventory.quantity': 'inventory.read',
    'coil.inventory': 'coil.read', 'recipe.cost.preview': 'recipe.cost.preview' });
function canaryGate(input, env = process.env) {
    return env.AI_V5_READ_CANARY_ENABLED === 'true' && input.previewOptIn === true && input.internalAuthorized === true;
}
async function runReadCanary(input, options = {}) {
    const env = options.env || process.env, started = performance.now();
    const state = { globalEnabled: env.AI_V5_READ_CANARY_ENABLED === 'true', previewOptIn: input.previewOptIn === true,
        attempted: false, eligible: false, validationPass: false, delivered: false, exposed: false, failureClass: 'NONE' };
    const finish = () => ({ ...state, durationMs: performance.now() - started });
    // No Interpreter/Tool/Composer entry is reachable from either gate alone.
    if (!canaryGate(input, env)) return finish();
    const taskId = randomUUID();
    // Request-local activation never changes process env or production shadow sampling.
    const runtimeEnv = { ...env, AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true', AI_V5_ANSWER_SHADOW_ENABLED: 'true' };
    return obs.withAgentSpan({ requestId: taskId, route: 'v5_read_canary' }, () => obs.withReadCanarySpan(state, async () => {
        try {
            if (!Object.hasOwn(FACT_CAPABILITY, input.factKey) || typeof input.deliver !== 'function' || input.signal?.aborted) {
                state.failureClass = 'PREVIEW_SCOPE_INVALID'; return finish();
            }
            if (!classifyEligibility(input.legacyFacts).eligible) { state.failureClass = 'LEGACY_POLICY_EXCLUDED'; return finish(); }
            state.attempted = true;
            const envelope = createV5InterpreterInputEnvelope({ rawUserRequest: input.sourceRequest, pageContext: null });
            const interpreted = await (options.interpret || interpretCandidateSetTask)(envelope, {
                env: runtimeEnv, shadowTaskId: taskId, modelRequest: options.interpreterModelRequest,
                internalFetch: options.internalFetch, lookupEntities: options.lookupEntities,
            });
            const identity = interpreted.resolvedIdentity, interpretation = interpreted.interpretation;
            if (input.signal?.aborted) { state.failureClass = 'REQUEST_CLOSED'; return finish(); }
            if (interpreted.status !== 'VALID' || interpretation?.needsClarification || !identity
                || interpretation.entityCandidates?.length !== 1 || interpreted.architectureMetadata?.complete !== true
                || interpreted.architectureMetadata?.finalEntityStatus !== 'FINAL_ENTITY_RESOLVED') {
                state.failureClass = 'INTERPRETER_UNAVAILABLE'; return finish();
            }
            const entity = createV5EntityReference({ entityType: identity.entityType, canonicalEntityId: identity.canonicalId,
                rawMention: interpretation.entityCandidates[0].candidateText, resolutionReceiptRef: taskId + ':v3-finalization' });
            const routeInput = { domain: interpretation.domain, operation: interpretation.operation, entityType: identity.entityType };
            const task = createV5Task({ taskId, createdAt: new Date().toISOString(), intent: routeInput, entityContext: [entity] });
            let routingTask = task;
            for (const stateName of ['UNDERSTANDING', 'RESOLVING_ENTITY', 'ROUTING']) {
                routingTask = transitionTask(routingTask, stateName, { reasonCode: 'CANARY_INTERPRETATION_VALID' });
            }
            const route = routeV5Capability(routingTask, routeInput);
            if (route.outcome !== 'SELECTED' || route.capabilityId !== FACT_CAPABILITY[input.factKey]
                || selectReadExecution(route.capabilityId).status !== 'UNIQUE') {
                state.failureClass = 'READ_SCOPE_EXCLUDED'; return finish();
            }
            state.eligible = true;
            const execution = await runReadExecutionShadow({ task, routeInput, capabilityId: route.capabilityId,
                authoritativeCandidate: identity, requiredFactKeys: input.factKey === 'price.current' ? [input.factKey] : [] },
            { env: runtimeEnv, ...(options.executionOptions || {}) });
            state.readExecution = execution.executionStatus; state.resultEquivalence = execution.resultComparison;
            state.evidenceVerification = execution.verificationStatus; state.toolCalls = execution.toolCalls;
            if (input.signal?.aborted) { state.failureClass = 'REQUEST_CLOSED'; return finish(); }
            const answer = await composeReadAnswerForCanary({ execution, taskId, entity,
                userRequest: input.sourceRequest, requiredFactKeys: [input.factKey] },
            { ...(options.answerOptions || {}), env: runtimeEnv, previewOptIn: true, internalAuthorized: true, signal: input.signal }, body => {
                if (input.signal?.aborted) return;
                // Only a validated body is sent, synchronously; never retained in state or result.
                if (input.deliver(body) === true) { state.delivered = true; state.exposed = true; }
            });
            state.validationPass = answer.status === 'ANSWER_SHADOW_ACCEPTED';
            for (const key of ['contractValid', 'evidenceRefsValid', 'groundingValid', 'requiredFactCoverage', 'numericValid', 'entityValid',
                'modelCalls', 'unsupportedClaimCount', 'internalLeakageCount']) state[key] = answer[key] ?? 0;
            if (!state.validationPass) state.failureClass = answer.modelTimeout ? 'ANSWER_TIMEOUT' : answer.modelError ? 'ANSWER_MODEL_ERROR'
                : answer.status === 'ANSWER_NOT_GENERATED' ? 'EVIDENCE_UNAVAILABLE' : 'ANSWER_VALIDATION_FAILED';
            else if (!state.exposed) state.failureClass = 'REQUEST_CLOSED';
            return finish();
        } catch { state.failureClass = 'PREVIEW_INTERNAL_ERROR'; return finish(); }
    }));
}

// The sole HTTP adapter: existing internal identity + strict explicit marker.
async function previewAfterLegacy(req, result, send, signal, options = {}) {
    const env = options.env || process.env;
    const previewOptIn = req.headers?.['x-pump-v5-preview'] === 'true';
    const internalAuthorized = Boolean(env.INTERNAL_SECRET) && req.headers?.['x-internal-secret'] === env.INTERNAL_SECRET;
    const input = { previewOptIn, internalAuthorized };
    if (!canaryGate(input, env)) {
        // Synchronous metadata only; no V5 execution, content or new response field.
        await obs.recordReadCanaryGate({ globalEnabled: env.AI_V5_READ_CANARY_ENABLED === 'true', previewOptIn });
        return;
    }
    try {
        const outcome = await runReadCanary({ ...input, factKey: req.headers?.['x-pump-v5-fact'], signal,
            sourceRequest: extractSourceUserRequest(req.body?.messages),
            legacyFacts: captureSafeV4ShadowFacts({}, result, {}),
            deliver: body => {
                if (signal.aborted) return false;
                return send('v5_preview', { preview: true, authoritative: false, answerText: body }) === true;
            } }, options);
        options.onOutcome?.(outcome);
    } catch { /* Preview/observability can never break the completed legacy response. */ }
}
module.exports = { canaryGate, runReadCanary, previewAfterLegacy };
