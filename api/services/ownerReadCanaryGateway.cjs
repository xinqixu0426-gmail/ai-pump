'use strict';

const { timingSafeEqual, randomUUID } = require('node:crypto');
const http = require('node:http');
const { verifyAuthentication, isAuthenticatedOwner } = require('./ownerAuthentication.cjs');
const conversation = require('./conversationContext.cjs');

const OWNER_CANARY_PATH = '/api/ai/owner-read-canary';
const APPROVED_FACT_KEYS = Object.freeze(['price.current', 'inventory.quantity', 'coil.inventory', 'recipe.cost.preview']);
const MAX_REQUEST_BYTES = 32768;
const MAX_CANDIDATE_BYTES = 262144;
// Leave time for the real Legacy SSE headers/heartbeat before the public proxy
// read deadline. This is a gateway transport budget, not a model retry/setting.
const MAX_CANDIDATE_WAIT_MS = 60000;

function authenticated(value, secret) {
    if (typeof value !== 'string' || typeof secret !== 'string' || !secret) return false;
    const a = Buffer.from(value), b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
}

function loopbackOrigin(value) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password
        || url.pathname !== '/' || url.search || url.hash) throw Error('CANARY_ORIGIN_INVALID');
    return url.origin;
}

async function boundedBody(stream, limit) {
    let size = 0;
    const chunks = [];
    for await (const chunk of stream) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > limit) throw Error('CANARY_BODY_LIMIT');
        chunks.push(bytes);
    }
    return Buffer.concat(chunks).toString('utf8');
}

// This is a transport completion check, not a second business validator.
// Only the frozen, authenticated Candidate can produce the accepted final stream.
function candidateFinal(text) {
    const events = text.replace(/\r\n/g, '\n').split('\n\n').filter(s => s.trim() && !s.startsWith(':'));
    if (events.length !== 2) return null;
    try {
        const parsed = events.map(s => {
            if (!s.startsWith('data: ') || s.includes('\ndata:')) throw Error('INVALID_SSE');
            return JSON.parse(s.slice(6));
        });
        const [content, done] = parsed;
        if (content.type !== 'content' || Object.keys(content).sort().join(',') !== 'content,type'
            || typeof content.content !== 'string' || !content.content.trim()
            || done.type !== 'done' || Object.keys(done).length !== 1) return null;
        return content.content;
    } catch { return null; }
}

function createOwnerReadCanaryServer(options = {}) {
    const env = options.env || process.env;
    const candidateOrigin = loopbackOrigin(options.candidateOrigin || 'http://127.0.0.1:3102');
    const legacyOrigin = loopbackOrigin(options.legacyOrigin || 'http://127.0.0.1:3002');
    const transport = options.fetch || fetch;
    const candidateTransport = options.candidateFetch || transport;
    const candidateTimeoutMs = options.candidateTimeoutMs ?? MAX_CANDIDATE_WAIT_MS;
    if (!Number.isInteger(candidateTimeoutMs) || candidateTimeoutMs < 1 || candidateTimeoutMs > MAX_CANDIDATE_WAIT_MS) {
        throw Error('CANARY_TIMEOUT_INVALID');
    }
    const legacyTimeoutMs = options.legacyTimeoutMs || 180000;
    const enabled = env.AI_V5_OWNER_CANARY_ENABLED === 'true';
    const secret = env.INTERNAL_SECRET;
    const onOutcome = options.onOutcome || (metadata => console.info(JSON.stringify({ event: 'owner_read_canary', ...metadata })));
    if (typeof secret !== 'string' || !secret) throw Error('CANARY_INTERNAL_AUTH_REQUIRED');

    return http.createServer(async (req, res) => {
        const requestId = randomUUID();
        res.setHeader('X-Request-ID', requestId);
        const meta = { requestId, explicitOwnerCanaryRequested: false, candidateAttempted: false,
            candidateSuccess: false, safeLegacyFallback: false, finalSource: 'none', failureClass: 'NONE' };
        const started = performance.now(), client = new AbortController();
        req.once('aborted', () => client.abort());
        res.once('close', () => { if (!res.writableEnded) client.abort(); });
        const error = (status, code) => {
            if (res.headersSent || res.destroyed) return;
            res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ success: false, code, requestId }));
        };
        try {
            const ordinary = req.url === '/api/ai/chat';
            if (req.method !== 'POST' || (!ordinary && req.url !== OWNER_CANARY_PATH)) { error(404, 'NOT_FOUND'); return; }
            if (!ordinary && !authenticated(req.headers['x-internal-secret'], secret)) { error(401, 'UNAUTHORIZED'); return; }
            let currentEnv = env;
            try { if (options.readConfig) currentEnv = options.readConfig(); } catch { currentEnv = {}; }
            // Cookie identity is verified by the existing stable-principal primitive.
            // Client markers, admin role, IP and internal credentials do not grant owner.
            const cookies = require('cookie').parse(req.headers.cookie || '');
            const authContext = ordinary ? verifyAuthentication(cookies.token, currentEnv) : null;
            meta.ownerAuthenticated = ordinary && isAuthenticatedOwner(authContext, currentEnv);
            meta.ownerDefaultEnabled = currentEnv.AI_V5_OWNER_READ_DEFAULT_ENABLED === 'true';
            let text, body;
            try { text = await boundedBody(req, ordinary ? 102400 : MAX_REQUEST_BYTES); body = JSON.parse(text); }
            catch { error(400, 'INVALID_REQUEST'); return; }
            if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.messages)) {
                error(400, 'INVALID_REQUEST'); return;
            }
            const hasConversation = Object.hasOwn(body, 'conversationId');
            const contextValid = !hasConversation || conversation.validConversationId(body.conversationId);
            const envelope = hasConversation && contextValid
                ? conversation.signConversationContext(authContext, body.conversationId, { ...currentEnv, INTERNAL_SECRET: secret }) : null;
            // Neither Legacy nor the model receives control-plane fields. Preserve all other fields.
            const { conversationId: _conversationId, ...legacyBody } = body;
            const forwardText = hasConversation ? JSON.stringify(legacyBody) : text;
            const headers = { 'Content-Type': 'application/json', 'x-internal-secret': secret };
            // Ordinary Legacy requests retain their original auth, never our service identity.
            const legacyHeaders = ordinary ? { 'Content-Type': 'application/json',
                ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
                ...(req.headers.authorization ? { authorization: req.headers.authorization } : {}),
                ...(req.headers['x-internal-secret'] ? { 'x-internal-secret': req.headers['x-internal-secret'] } : {}) } : headers;
            const optedIn = req.headers['x-pump-v5-use'] === 'true';
            const factKey = req.headers['x-pump-v5-fact'];
            meta.explicitOwnerCanaryRequested = optedIn;
            const lastMessage = body.messages.at(-1);
            const messagesValid = body.messages.length > 0 && body.messages.length <= 50
                && body.messages.every(m => m && ['user','assistant'].includes(m.role) && typeof m.content === 'string'
                    && Object.keys(m).every(k => ['role','content'].includes(k)));
            const contextualCollection = body.messages.length > 1 && !!envelope;
            const candidateShape = contextValid && Object.keys(legacyBody).length === 1 && messagesValid
                && lastMessage?.role === 'user' && (body.messages.length === 1 || contextualCollection);
            const admitted = ordinary ? meta.ownerDefaultEnabled && meta.ownerAuthenticated : enabled && optedIn;
            if (admitted && candidateShape && (factKey === undefined || APPROVED_FACT_KEYS.includes(factKey))) {
                meta.candidateAttempted = true;
                try {
                    const response = await candidateTransport(candidateOrigin + '/api/ai/chat', {
                        method: 'POST', headers: { ...headers, 'x-pump-v5-use': 'true',
                            ...(envelope ? { [conversation.HEADER]: envelope } : {}),
                            ...(factKey === undefined ? {} : { 'x-pump-v5-fact': factKey }) },
                        body: contextualCollection ? JSON.stringify({ messages: [lastMessage], collectionOnly: true }) : forwardText,
                        signal: AbortSignal.any([client.signal, AbortSignal.timeout(candidateTimeoutMs)]),
                        redirect: 'error',
                    });
                    const type = response.headers.get('content-type') || '';
                    const result = response.ok && type.includes('text/event-stream')
                        ? candidateFinal(await boundedBody(response.body, MAX_CANDIDATE_BYTES)) : null;
                    if (!response.ok || !type.includes('text/event-stream')) await response.body?.cancel();
                    if (result !== null && !client.signal.aborted) {
                        meta.candidateSuccess = true; meta.finalSource = 'v5-candidate';
                        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
                        res.end('data: ' + JSON.stringify({ type: 'content', content: result }) + '\n\n'
                            + 'data: ' + JSON.stringify({ type: 'done' }) + '\n\n');
                        return;
                    }
                    meta.failureClass = 'CANDIDATE_NON_SUCCESS';
                } catch { meta.failureClass = 'CANDIDATE_UNAVAILABLE'; }
                meta.safeLegacyFallback = !client.signal.aborted;
            }
            if (client.signal.aborted) return;
            // Forward the original request to the real current implementation once.
            // No V5 flags or write-enabling headers/options are forwarded.
            const legacy = await transport(legacyOrigin + '/api/ai/chat', {
                method: 'POST', headers: legacyHeaders, body: forwardText, redirect: 'error',
                signal: AbortSignal.any([client.signal, AbortSignal.timeout(legacyTimeoutMs)]),
            });
            meta.finalSource = 'legacy';
            res.writeHead(legacy.status, { 'Content-Type': legacy.headers.get('content-type') || 'application/json',
                'Cache-Control': 'no-store' });
            for await (const chunk of legacy.body) {
                if (client.signal.aborted) break;
                if (!res.write(Buffer.from(chunk))) await new Promise(resolve => {
                    const ready = () => { res.off('drain', ready); res.off('close', ready); resolve(); };
                    res.once('drain', ready); res.once('close', ready);
                });
            }
            if (!res.destroyed) res.end();
        } catch {
            meta.failureClass = client.signal.aborted ? 'CLIENT_CANCELLED' : 'LEGACY_TRANSPORT_UNAVAILABLE';
            if (!client.signal.aborted) {
                if (!res.headersSent) error(502, 'LEGACY_UNAVAILABLE');
                else res.destroy();
            }
        } finally {
            // Caller receives only a fixed metadata schema, never transport bodies.
            try { onOutcome({ ...meta, durationMs: performance.now() - started }); } catch { /* no effect on response */ }
        }
    });
}

module.exports = { OWNER_CANARY_PATH, APPROVED_FACT_KEYS, MAX_CANDIDATE_WAIT_MS, authenticated, candidateFinal, createOwnerReadCanaryServer };
