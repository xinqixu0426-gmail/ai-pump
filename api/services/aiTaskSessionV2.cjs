'use strict';

// N3 keeps clarification state in process memory only.  It deliberately does
// not persist tasks, receipts, answers, or credentials to SQLite.
function createTaskSessionStoreV2({ now = () => Date.now(), ttlMs = 20 * 60 * 1000 } = {}) {
    const sessions = new Map();
    const keyFor = (ownerKey, conversationId) => `${ownerKey}\u0000${conversationId || ''}`;
    function cleanup() { const threshold = now(); for (const [key, session] of sessions) if (session.expiresAtMs <= threshold) sessions.delete(key); }
    function get(ownerKey, conversationId) { cleanup(); return sessions.get(keyFor(ownerKey, conversationId)) || null; }
    function set(ownerKey, conversationId, value) { cleanup(); const session = { ...value, expiresAtMs: now() + ttlMs }; sessions.set(keyFor(ownerKey, conversationId), session); return session; }
    function remove(ownerKey, conversationId) { sessions.delete(keyFor(ownerKey, conversationId)); }
    return Object.freeze({ get, set, remove, cleanup, ttlMs });
}
const defaultTaskSessionStoreV2 = createTaskSessionStoreV2();
module.exports = { createTaskSessionStoreV2, defaultTaskSessionStoreV2 };
