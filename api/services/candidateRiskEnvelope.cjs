'use strict';
const { domainPlannerPrompt, domainPlannerTool, normalizeDomainPlan } = require('./aiGoalPlannerV3.cjs');
const { resolveAiProviderRoute, fetchProviderWithRetry } = require('./aiProvider.cjs');
const schema = domainPlannerTool().function.parameters;
const allowedModes = Object.freeze(['query', 'analysis']);

function normalizeCandidateRisk(raw, collectionContext = null) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
        || Object.keys(raw).some(k => !Object.hasOwn(schema.properties, k))
        || schema.required.some(k => !Object.hasOwn(raw, k))) throw Error('RISK_CONTRACT_INVALID');
    for (const [key, definition] of Object.entries(schema.properties)) {
        const value = raw[key];
        if (definition.type === 'array') {
            if (!Array.isArray(value) || value.length > definition.maxItems
                || value.some(v => typeof v !== 'string' || (definition.items.enum && !definition.items.enum.includes(v)))) throw Error('RISK_CONTRACT_INVALID');
        } else if (typeof value !== definition.type || (definition.enum && !definition.enum.includes(value))) throw Error('RISK_CONTRACT_INVALID');
    }
    const plan = normalizeDomainPlan(raw);
    // Collection safety is separate from business dependency/context. Narrow eligibility is unchanged.
    const riskClass = plan.mode === 'command' ? 'WRITE_OR_MUTATION'
        : allowedModes.includes(plan.mode) && plan.confidence !== 'low' && plan.ambiguities.length === 0
            ? 'READ_SAFE' : 'UNAVAILABLE_OR_UNKNOWN';
    const contextual = !!collectionContext && ['orders','customers','parts','recipes','coils'].includes(collectionContext.resourceType)
        && plan.contextMode === 'previous_turn';
    return Object.freeze({ version: 1, contractValid: true, riskClass, mode: plan.mode, ...(contextual ? { contextual: true } : {}),
        // A verified current collection supplies the missing data dependency, not risk authority.
        // This exception is contextual only; downstream still permits continue/ordinal only.
        eligible: allowedModes.includes(plan.mode) && (plan.needsBusinessData === true || contextual)
            && !plan.requiresClarification && plan.ambiguities.length === 0
            && (plan.contextMode === 'current_turn' || contextual) && plan.confidence !== 'low' });
}

async function requestRisk(messages, options) {
    const env = options.env || process.env;
    const config = resolveAiProviderRoute(messages, { env, attachmentMode: 'metadata' });
    if (!config.apiKey) throw Error('RISK_PROVIDER_UNAVAILABLE');
    const response = await fetchProviderWithRetry(`${config.baseUrl}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, stream: false, messages,
            ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}) }),
    }, { config, env, signal: options.signal, timeoutMs: 30000, maxAttempts: 1 });
    const data = await response.json();
    const message = data.choices?.[0]?.message;
    if (!response.ok || data.error || message?.tool_calls?.length || typeof message?.content !== 'string') throw Error('RISK_MODEL_FAILED');
    return JSON.parse(message.content);
}

async function classifyCandidateRisk(source, options = {}) {
    const started = performance.now();
    const controller = new AbortController();
    let timer, cancel;
    try {
        if (typeof source !== 'string' || !source.trim() || options.signal?.aborted) throw Error('RISK_INPUT_INVALID');
        // Transport-only adaptation of the existing function-output schema. No new risk rules,
        // examples, business context, capabilities, tool calls or classification prompt tuning.
        const messages = [{ role: 'system', content: domainPlannerPrompt(null, null, null) },
            { role: 'system', content: 'Transport: return only a JSON object matching this existing output schema; do not call a function.\n' + JSON.stringify(schema) },
            { role: 'user', content: source }];
        if (options.collectionContext && ['orders','customers','parts','recipes','coils'].includes(options.collectionContext.resourceType)) {
            const customerChoice = options.collectionContext.resourceType === 'customers'
                && options.collectionContext.query?.kind === 'choice';
            messages.splice(2, 0, { role: 'system', content: 'Server control context: the current verified bounded collection is '
                + options.collectionContext.resourceType + '. A continuation or ordinal detail request may refer to this collection using previous_turn. '
                + (customerChoice ? 'The server is awaiting an explicit customer selection or a literal customer-name keyword/surname to refine candidates for the pending read-only request. Such a keyword reply has an explicit customer resource context; it does not select a canonical customer or authorize any mutation. ' : '')
                + 'No business facts, cursor, identities or past assistant claims are provided. All original command/risk rules remain unchanged.' });
        }
        const deadline = new Promise((_, reject) => {
            cancel = () => { controller.abort(); reject(Error('RISK_UNAVAILABLE')); };
            options.signal?.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(cancel, options.timeoutMs || 30000);
        });
        const raw = await Promise.race([(options.request || requestRisk)(messages, { ...options, signal: controller.signal }), deadline]);
        if (options.signal?.aborted) throw Error('RISK_REQUEST_CLOSED');
        const result = normalizeCandidateRisk(raw, options.collectionContext);
        return { ...result, invoked: true, failureClass: result.eligible ? 'NONE' : 'RISK_NOT_ELIGIBLE', durationMs: performance.now() - started };
    } catch {
        return { version: 1, contractValid: false, riskClass:'UNAVAILABLE_OR_UNKNOWN', mode: 'unknown', eligible: false, invoked: true,
            failureClass: 'RISK_UNAVAILABLE', durationMs: performance.now() - started };
    } finally {
        clearTimeout(timer);
        if (cancel) options.signal?.removeEventListener('abort', cancel);
    }
}
module.exports = { classifyCandidateRisk, normalizeCandidateRisk, allowedModes };
