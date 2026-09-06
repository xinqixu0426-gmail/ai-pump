'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { isAuthenticatedOwner } = require('./ownerAuthentication.cjs');
const contextStorage = new AsyncLocalStorage();
const HEADER = 'x-pump-v5-conversation-context';

// Existing persisted chat IDs are technical handles, not business identities or secrets.
function validConversationId(value) {
    return typeof value === 'string' && /^chat-[1-9][0-9]{0,15}$/.test(value)
        && Number.isSafeInteger(Number(value.slice(5)));
}
function mac(secret, value) {
    return createHmac('sha256', secret).update(value).digest('hex');
}
function signConversationContext(auth, conversationId, env) {
    if (!validConversationId(conversationId) || !isAuthenticatedOwner(auth, env)
        || typeof env.INTERNAL_SECRET !== 'string' || !env.INTERNAL_SECRET) return null;
    const contextKey = mac(env.INTERNAL_SECRET, JSON.stringify(['conversation-v1', auth.sub, conversationId]));
    const payload = Buffer.from(JSON.stringify({ version: 1, conversationId, contextKey })).toString('base64url');
    return payload + '.' + mac(env.INTERNAL_SECRET, payload);
}
function verifyConversationContext(value, secret) {
    if (value === undefined) return null;
    const invalid = () => { throw Error('CONVERSATION_CONTEXT_INVALID'); };
    if (typeof secret !== 'string' || !secret || typeof value !== 'string' || value.length > 512) return invalid();
    const parts = value.split('.');
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) return invalid();
    if (!timingSafeEqual(Buffer.from(parts[1]), Buffer.from(mac(secret, parts[0])))) return invalid();
    let data;
    try { data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { return invalid(); }
    if (!data || Object.keys(data).sort().join(',') !== 'contextKey,conversationId,version'
        || data.version !== 1 || !validConversationId(data.conversationId)
        || typeof data.contextKey !== 'string' || !/^[a-f0-9]{64}$/.test(data.contextKey)) return invalid();
    return Object.freeze(data);
}
function withConversationContext(context, action) { return contextStorage.run(context, action); }
function getConversationContext() { return contextStorage.getStore() || null; }

module.exports = { HEADER, validConversationId, signConversationContext, verifyConversationContext,
    withConversationContext, getConversationContext };
