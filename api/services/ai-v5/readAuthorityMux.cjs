'use strict';

function authorityEnabled(req, env = process.env) {
    return env.AI_V5_READ_CANARY_ENABLED === 'true'
        && env.AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED === 'true'
        && req.headers?.['x-pump-v5-use'] === 'true'
        && Boolean(env.INTERNAL_SECRET) && req.headers?.['x-internal-secret'] === env.INTERNAL_SECRET;
}

// Request-local final-response selection. P16-C's HTTP preview adapter is unchanged.
function createReadAuthorityMux(req, send, signal, options = {}) {
    const env = options.env || process.env, enabled = authorityEnabled(req, env);
    let events = [], validatedBody = null, complete = false;
    const state = { requested: req.headers?.['x-pump-v5-use'] === 'true', previewRequested: req.headers?.['x-pump-v5-preview'] === 'true',
        enabled, attempted: false, eligible: false, validationPass: false, fallback: false, failureClass: 'NONE', finalSource: 'legacy/current' };
    function emit(type, payload) {
        if (!enabled) return send(type, payload);
        if (complete || signal.aborted) return false;
        events.push([type, payload]); return true;
    }
    function flushLegacy() {
        if (complete) return;
        const pending = events; events = []; validatedBody = null; complete = true;
        if (!signal.aborted) for (const [type,payload] of pending) send(type,payload);
    }
    async function finalize(result) {
        if (complete) return { ...state };
        if (!enabled) {
            complete = true;
            try { await require('../observability.cjs').recordReadAuthority(state); } catch { /* Fail-open metadata. */ }
            try { options.onAuthorityOutcome?.({ ...state }); } catch { /* Metadata only. */ }
            return { ...state };
        }
        const started = performance.now();
        let outcome;
        try {
            const { runReadCanary } = require('./readCanary.cjs');
            const { captureSafeV4ShadowFacts } = require('./shadowProjection.cjs');
            const { extractSourceUserRequest } = require('./independentShadow.cjs');
            // Reuse the frozen internal read/validated-delivery chain only after the independent
            // authority gate. No x-pump-v5-preview request is synthesized or changed.
            outcome = await runReadCanary({ previewOptIn: true, internalAuthorized: true,
                sourceRequest: extractSourceUserRequest(req.body?.messages), factKey: req.headers?.['x-pump-v5-fact'], signal,
                legacyFacts: captureSafeV4ShadowFacts({}, result, {}),
                deliver: body => { if (signal.aborted || complete) return false; validatedBody = body; return true; } },
            { ...options, env });
            state.attempted = outcome.attempted === true; state.eligible = outcome.eligible === true;
            state.validationPass = outcome.validationPass === true; state.failureClass = outcome.failureClass;
            if (state.validationPass && outcome.delivered === true && typeof validatedBody === 'string' && !signal.aborted) {
                // Only the private validated sink can set this body. Raw model content is unavailable.
                events = []; complete = true;
                send('provider', { provider: 'deepseek', model: 'deepseek-v4-flash', fallback: false });
                send('content', { content: validatedBody });
                send('done', {});
                state.finalSource = 'v5-authoritative-canary';
            } else { state.fallback = true; flushLegacy(); }
        } catch {
            state.failureClass = 'AUTHORITY_INTERNAL_ERROR'; state.fallback = true; flushLegacy();
        } finally {
            validatedBody = null; events = [];
        }
        const metadata = { ...state, durationMs: performance.now() - started, ...(outcome ? { read: outcome } : {}) };
        try { await require('../observability.cjs').recordReadAuthority(metadata); } catch { /* Metadata cannot change final response. */ }
        try { options.onAuthorityOutcome?.(metadata); } catch { /* Test/metadata observer only. */ }
        return metadata;
    }
    function close() { complete = true; validatedBody = null; events = []; }
    return { enabled, emit, finalize, flushLegacy, close };
}
module.exports = { authorityEnabled, createReadAuthorityMux };
