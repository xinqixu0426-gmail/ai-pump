'use strict';
const { domainPlannerPrompt, domainPlannerTool, normalizeDomainPlan } = require('./aiGoalPlannerV3.cjs');
const { resolveAiProviderRoute, fetchProviderWithRetry } = require('./aiProvider.cjs');
const schema = domainPlannerTool().function.parameters;
const allowedModes = Object.freeze(['query', 'analysis']);

function normalizeCandidateRisk(raw) {
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
    return Object.freeze({ version: 1, contractValid: true, mode: plan.mode,
        eligible: allowedModes.includes(plan.mode) && plan.needsBusinessData === true
            && !plan.requiresClarification && plan.ambiguities.length === 0
            && plan.contextMode === 'current_turn' && plan.confidence !== 'low' });
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
        const deadline = new Promise((_, reject) => {
            cancel = () => { controller.abort(); reject(Error('RISK_UNAVAILABLE')); };
            options.signal?.addEventListener('abort', cancel, { once: true });
            timer = setTimeout(cancel, options.timeoutMs || 30000);
        });
        const raw = await Promise.race([(options.request || requestRisk)(messages, { ...options, signal: controller.signal }), deadline]);
        if (options.signal?.aborted) throw Error('RISK_REQUEST_CLOSED');
        const result = normalizeCandidateRisk(raw);
        return { ...result, invoked: true, failureClass: result.eligible ? 'NONE' : 'RISK_NOT_ELIGIBLE', durationMs: performance.now() - started };
    } catch {
        return { version: 1, contractValid: false, mode: 'unknown', eligible: false, invoked: true,
            failureClass: 'RISK_UNAVAILABLE', durationMs: performance.now() - started };
    } finally {
        clearTimeout(timer);
        if (cancel) options.signal?.removeEventListener('abort', cancel);
    }
}
module.exports = { classifyCandidateRisk, normalizeCandidateRisk, allowedModes };
