const crypto = require('node:crypto');

const TTL_MS = 15 * 60 * 1000;
const MAX_SESSIONS = 200;
const sessions = new Map();

function sessionKey(subject, conversationId) {
    if (!subject || typeof conversationId !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(conversationId)) return null;
    return crypto.createHash('sha256').update(`${subject}\0${conversationId}`).digest('hex');
}

function beginAssistantSession(subject, conversationId, now = Date.now()) {
    for (const [key, value] of sessions) if (value.expiresAt <= now) sessions.delete(key);
    const key = sessionKey(subject, conversationId);
    const previous = key ? sessions.get(key) : null;
    if (previous?.busy) {
        throw Object.assign(new Error('这个会话上一条请求仍在处理，请停止或等待后继续。'), { code: 'AI_SESSION_BUSY' });
    }
    const state = { previous: previous?.data || null, busy: true, expiresAt: now + TTL_MS };
    if (key) {
        if (sessions.size >= MAX_SESSIONS && !previous) {
            const idle = [...sessions].find(([, value]) => !value.busy);
            if (idle) sessions.delete(idle[0]);
            else throw Object.assign(new Error('当前会话容量已满，请稍后重试。'), { code: 'AI_SESSION_CAPACITY' });
        }
        sessions.set(key, state);
    }
    return {
        previous: state.previous,
        finish(data) {
            if (key && sessions.get(key) === state) sessions.set(key, { busy: false, data, expiresAt: Date.now() + TTL_MS });
        },
        cancel() {
            if (key && sessions.get(key) === state) {
                if (previous) sessions.set(key, { ...previous, busy: false });
                else sessions.delete(key);
            }
        },
    };
}

module.exports = { beginAssistantSession, TTL_MS };
