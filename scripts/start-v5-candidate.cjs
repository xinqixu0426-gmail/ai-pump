'use strict';

// Separate opt-in executable; never imports api.cjs or starts the legacy dispatcher.
async function startCandidate(options = {}) {
    const { candidateEnabled } = require('../api/services/candidateDatabase.cjs');
    if (!candidateEnabled()) throw new Error('CANDIDATE_DISABLED');
    const port = Number(process.env.PUMP_V5_CANDIDATE_PORT);
    if (!Number.isInteger(port) || port < 1024 || port > 65535 || [3000, 3001, 3002].includes(port)
        || !process.env.INTERNAL_SECRET) throw new Error('CANDIDATE_CONFIG_INVALID');
    process.env.PORT = String(port);
    const obs = require('../api/services/observability.cjs');
    obs.initializeObservability({ ...(options.observability || {}), env: { ...process.env, AI_TRACE_CONTENT: 'metadata',
        AI_OBSERVABILITY_PROJECT: 'pump-v5-local-candidate' } });
    const { db } = require('../api/db.cjs');
    const express = require('express');
    const app = express();
    const { randomUUID } = require('node:crypto');
    app.use((req, res, next) => {
        req.requestId = randomUUID();
        res.setHeader('Cache-Control', 'no-store');
        if (req.headers['x-internal-secret'] !== process.env.INTERNAL_SECRET) {
            return res.status(401).json({ success: false, code: 'CANDIDATE_AUTH_REQUIRED', error: 'Unauthorized' });
        }
        const allowed = (req.method === 'GET' && ['/api/health/ready', '/api/parts', '/api/coils',
            '/api/recipes', '/api/recipes/current-costs'].includes(req.path))
            || (req.method === 'POST' && ['/api/ai/chat', '/api/entity-lookup', '/api/entity-span-candidates'].includes(req.path));
        if (!allowed) return res.status(403).json({ success: false, code: 'CANDIDATE_ROUTE_BLOCKED', error: 'Read-only runtime' });
        next();
    });
    app.use(express.json({ limit: '32kb' }));
    app.get('/api/health/ready', (_req, res) => res.json({ success: true, data: { ready: true, runtime: 'v5-candidate' } }));
    app.post('/api/ai/chat', async (req, res) => {
        if (Object.keys(req.body || {}).some(k => k !== 'messages') || !Array.isArray(req.body.messages)
            || req.body.messages.length !== 1 || req.body.messages[0]?.role !== 'user'
            || typeof req.body.messages[0]?.content !== 'string') {
            return res.status(400).json({ success: false, code: 'CANDIDATE_REQUEST_INVALID', error: 'Invalid request' });
        }
        const controller = new AbortController();
        res.on('close', () => controller.abort());
        const timer = setTimeout(() => controller.abort(), 180000);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        const send = (type, payload) => { if (!controller.signal.aborted) res.write('data: ' + JSON.stringify({ type, ...payload }) + '\n\n'); };
        try {
            const { runCandidateRead } = require('../api/services/ai-v5/candidateRead.cjs');
            const readOptions = await options.readOptions?.(req) || {};
            const outcome = await runCandidateRead({ previewOptIn: req.headers['x-pump-v5-use'] === 'true', internalAuthorized: true,
                sourceRequest: req.body.messages[0].content, factKey: req.headers['x-pump-v5-fact'], signal: controller.signal,
                deliver: body => { if (controller.signal.aborted) return false; send('content', { content: body }); return true; } }, readOptions);
            options.onOutcome?.(outcome);
            if (!outcome.delivered) send('error', { code: 'CANDIDATE_ANSWER_UNAVAILABLE' });
            send('done', {});
        } catch { send('error', { code: 'CANDIDATE_INTERNAL_ERROR' }); }
        finally { clearTimeout(timer); res.end(); }
    });
    app.use('/api', require('../api/routes/cost.cjs'));
    app.use('/api/parts', require('../api/routes/parts.cjs'));
    app.use('/api/coils', require('../api/routes/coils.cjs'));
    app.use('/api/recipes', require('../api/routes/recipes.cjs'));
    app.use('/api/entity-lookup', require('../api/routes/entityLookup.cjs').createEntityLookupRouter({ db }));
    app.use('/api/entity-span-candidates', require('../api/routes/entitySpanCandidates.cjs').createEntitySpanCandidateRouter({ db }));
    app.use((_err, _req, res, _next) => res.status(500).json({ success: false, code: 'CANDIDATE_READ_FAILED', error: 'Read failed' }));
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(port, '127.0.0.1', () => resolve(instance));
        instance.once('error', reject);
    });
    let closing = false;
    async function close() {
        if (closing) return;
        closing = true;
        await new Promise(resolve => server.close(resolve));
        db.close();
        await obs.safeShutdown();
    }
    return { server, close };
}
if (require.main === module) startCandidate().then(runtime => {
    process.once('SIGTERM', () => runtime.close().catch(() => { process.exitCode = 1; }));
    process.once('SIGINT', () => runtime.close().catch(() => { process.exitCode = 1; }));
    process.on('message', message => {
        if (message?.type === 'candidate-stop') runtime.close().then(() => process.disconnect?.())
            .catch(() => { process.exitCode = 1; process.disconnect?.(); });
    });
    if (process.send) process.send({ type: 'candidate-ready', pid: process.pid });
}).catch(() => { console.error('CANDIDATE_START_FAILED'); process.exitCode = 1; });
module.exports = { startCandidate };
