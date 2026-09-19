'use strict';

const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const trusted = new WeakSet();
const OWNER_AUTH_VERSION = 1;
const subjectPattern = /^[A-Za-z0-9_-]{16,128}$/;

function equalCredential(left, right) {
    if (typeof left !== 'string' || typeof right !== 'string') return false;
    return crypto.timingSafeEqual(crypto.createHash('sha256').update(left).digest(),
        crypto.createHash('sha256').update(right).digest());
}

// No environment defaults grant identity; a single exact subject is the MVP.
function ownerConfigValid(env = {}) {
    try {
        const password = env.PUMP_OWNER_ACCESS_PASSWORD;
        const subject = env.PUMP_OWNER_SUBJECT;
        const subjects = JSON.parse(env.AI_V5_OWNER_SUBJECTS || '[]');
        return typeof password === 'string' && password.length >= 32 && password.length <= 512
            && typeof env.ACCESS_PASSWORD === 'string' && env.ACCESS_PASSWORD.length > 0
            && typeof env.JWT_SECRET === 'string' && env.JWT_SECRET.length > 0
            && typeof subject === 'string' && subjectPattern.test(subject)
            && Array.isArray(subjects) && subjects.length === 1 && subjects[0] === subject
            && !equalCredential(password, env.ACCESS_PASSWORD);
    } catch { return false; }
}

function issueOwnerToken(password, env = {}) {
    if (!ownerConfigValid(env) || !equalCredential(password, env.PUMP_OWNER_ACCESS_PASSWORD)) return null;
    return jwt.sign({ role: 'admin', sub: env.PUMP_OWNER_SUBJECT, authn: 'owner_credential_v1' },
        env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '15d' });
}

function verifyAuthentication(token, env = {}) {
    try {
        const decoded = jwt.verify(token, env.JWT_SECRET, { algorithms: ['HS256'] });
        if (!decoded || typeof decoded !== 'object' || !Number.isFinite(decoded.exp)
            || !Number.isFinite(decoded.iat)) return null;
        const context = Object.freeze({ role: decoded.role, sub: decoded.sub, authn: decoded.authn,
            exp: decoded.exp });
        trusted.add(context);
        return context;
    } catch { return null; }
}

function isAuthenticatedOwner(authContext, env = {}) {
    return !!authContext && trusted.has(authContext) && ownerConfigValid(env)
        && authContext.exp > Date.now() / 1000
        && authContext.authn === 'owner_credential_v1'
        && authContext.sub === env.PUMP_OWNER_SUBJECT;
}

module.exports = { OWNER_AUTH_VERSION, ownerConfigValid, issueOwnerToken, verifyAuthentication,
    isAuthenticatedOwner };
