'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const http = require('node:http');
const { ownerConfigValid, issueOwnerToken, verifyAuthentication, isAuthenticatedOwner } = require('../api/services/ownerAuthentication.cjs');
const { createOwnerAuthenticationGateway } = require('../api/services/ownerAuthenticationGateway.cjs');
const fixture = () => ({ ACCESS_PASSWORD: 'synthetic-shared-password', JWT_SECRET: 'synthetic-jwt-test-secret',
    PUMP_OWNER_ACCESS_PASSWORD: 'synthetic-owner-credential-only-for-unit-test', PUMP_OWNER_SUBJECT: 'synthetic_owner_subject_001',
    AI_V5_OWNER_SUBJECTS: '["synthetic_owner_subject_001"]' });
function owner(token, env) { return isAuthenticatedOwner(verifyAuthentication(token, env), env); }
test('defaults unset; shared admin is not an owner', () => {
    assert.equal(ownerConfigValid({}), false);
    assert.equal(issueOwnerToken('x', {}), null);
    const e = fixture(), token = jwt.sign({ role: 'admin' }, e.JWT_SECRET, { expiresIn: '15d' });
    assert.equal(owner(token, e), false);
    assert.equal(jwt.decode(token).sub, undefined);
});
test('dedicated credential produces stable server subject and existing time/role claims', () => {
    const e = fixture(), a = issueOwnerToken(e.PUMP_OWNER_ACCESS_PASSWORD, e), b = issueOwnerToken(e.PUMP_OWNER_ACCESS_PASSWORD, e);
    assert.equal(owner(a, e), true);
    assert.equal(jwt.decode(a).sub, jwt.decode(b).sub);
    assert.equal(jwt.decode(a).role, 'admin');
    assert.deepEqual(Object.keys(jwt.decode(a)).sort(), ['authn', 'exp', 'iat', 'role', 'sub']);
    assert.equal(issueOwnerToken('wrong', e), null);
    assert.equal(issueOwnerToken({ owner: true }, e), null);
});
test('untrusted objects, forged/unsigned/expired tokens and incorrect subject cannot grant owner', () => {
    const e = fixture(), payload = { role: 'admin', sub: e.PUMP_OWNER_SUBJECT, authn: 'owner_credential_v1' };
    assert.equal(isAuthenticatedOwner({ ...payload, exp: Date.now() / 1000 + 100 }, e), false);
    assert.equal(isAuthenticatedOwner(null, e), false);
    for (const token of [jwt.sign(payload, 'wrong-key', { expiresIn: '1h' }),
        jwt.sign(payload, '', { algorithm: 'none', expiresIn: '1h' }),
        jwt.sign(payload, e.JWT_SECRET, { expiresIn: -1 }),
        jwt.sign({ ...payload, sub: 'different_owner_subject' }, e.JWT_SECRET, { expiresIn: '1h' }),
        jwt.sign(payload, e.JWT_SECRET, { algorithm: 'HS384', expiresIn: '1h' })]) assert.equal(owner(token, e), false);
});
test('collision, empty/wildcard/duplicate/malformed allowlist and invalid config fail closed', () => {
    const e = fixture(), token = issueOwnerToken(e.PUMP_OWNER_ACCESS_PASSWORD, e);
    const changes = [{ PUMP_OWNER_ACCESS_PASSWORD: e.ACCESS_PASSWORD }, { AI_V5_OWNER_SUBJECTS: '[]' },
        { AI_V5_OWNER_SUBJECTS: '["*"]' }, { AI_V5_OWNER_SUBJECTS: 'invalid' },
        { AI_V5_OWNER_SUBJECTS: JSON.stringify([e.PUMP_OWNER_SUBJECT, e.PUMP_OWNER_SUBJECT]) },
        { PUMP_OWNER_SUBJECT: '' }, { PUMP_OWNER_ACCESS_PASSWORD: '' }, { JWT_SECRET: '' },
        { PUMP_OWNER_SUBJECT: {} }, { ACCESS_PASSWORD: '' }];
    for (const change of changes) {
        const invalid = { ...e, ...change };
        assert.equal(ownerConfigValid(invalid), false);
        assert.equal(owner(token, invalid), false);
        assert.equal(issueOwnerToken(e.PUMP_OWNER_ACCESS_PASSWORD, invalid), null);
    }
});
test('rollback immediately revokes owner classification, including prior verified contexts', () => {
    const e = fixture(), context = verifyAuthentication(issueOwnerToken(e.PUMP_OWNER_ACCESS_PASSWORD, e), e);
    assert.equal(isAuthenticatedOwner(context, e), true);
    e.AI_V5_OWNER_SUBJECTS = '[]';
    assert.equal(isAuthenticatedOwner(context, e), false);
});

const listen = s => new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
const close = s => new Promise(resolve => { s.close(resolve); s.closeAllConnections(); });
async function setup(t) {
    let e = fixture();
    // Actual existing auth router and middleware with synthetic credentials only.
    const saved = { ...process.env };
    Object.assign(process.env, e, { NODE_ENV: 'production' });
    for (const m of ['../api/routes/auth.cjs', '../api/authMiddleware.cjs']) delete require.cache[require.resolve(m)];
    const app = require('express')();
    app.use(require('express').json(), require('cookie-parser')());
    app.use('/api/auth', require('../api/routes/auth.cjs'));
    app.get('/protected', require('../api/authMiddleware.cjs'), (_req, res) => res.json({ success: true }));
    process.env = saved;
    const legacy = http.createServer(app); await listen(legacy);
    const gateway = createOwnerAuthenticationGateway({ readConfig: () => e, legacyPort: legacy.address().port });
    await listen(gateway);
    t.after(async () => { await close(gateway); await close(legacy); });
    const base = 'http://127.0.0.1:' + gateway.address().port;
    const login = (password, extra = {}) => fetch(base + '/api/auth/login', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-owner': 'true' }, body: JSON.stringify({ password, ...extra }) });
    const check = token => fetch(base + '/api/auth/check', { headers: { cookie: 'token=' + token, 'x-owner': 'true' } });
    return { e, base, login, check, legacy: 'http://127.0.0.1:' + legacy.address().port };
}
test('HTTP existing form, shared login, owner cookie, middleware, logout and rollback', async t => {
    const { e, login, check, legacy } = await setup(t);
    const shared = await login(e.ACCESS_PASSWORD, { owner: true, sub: e.PUMP_OWNER_SUBJECT });
    assert.equal(shared.status, 200);
    const sharedToken = shared.headers.get('set-cookie').match(/^token=([^;]+)/)[1];
    assert.equal((await (await check(sharedToken)).json()).owner, false);
    assert.equal(jwt.decode(sharedToken).sub, undefined);
    const r = await login(e.PUMP_OWNER_ACCESS_PASSWORD);
    assert.equal(r.status, 200);
    const cookie = r.headers.get('set-cookie'), token = cookie.match(/^token=([^;]+)/)[1];
    for (const part of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(cookie.includes(part));
    assert.equal((await (await check(token)).json()).owner, true);
    assert.equal((await fetch(legacy + '/protected', { headers: { cookie: 'token=' + token } })).status, 200);
    const logout = await fetch(legacy + '/api/auth/logout', { method: 'POST', headers: { cookie: 'token=' + token } });
    assert.equal(logout.status, 200);
    assert.ok(logout.headers.get('set-cookie').includes('token=;'));
    assert.equal((await (await check('forged')).json()).owner, false);
    e.AI_V5_OWNER_SUBJECTS = '[]';
    assert.equal((await (await check(token)).json()).owner, false);
    assert.equal((await login(e.PUMP_OWNER_ACCESS_PASSWORD)).status, 401);
    assert.equal((await login(e.ACCESS_PASSWORD)).status, 200);
});
test('HTTP collision leaves shared login working without subject', async t => {
    const { e, login, check } = await setup(t);
    e.PUMP_OWNER_ACCESS_PASSWORD = e.ACCESS_PASSWORD;
    const r = await login(e.ACCESS_PASSWORD), token = r.headers.get('set-cookie').match(/^token=([^;]+)/)[1];
    assert.equal(r.status, 200);
    assert.equal(jwt.decode(token).sub, undefined);
    assert.equal((await (await check(token)).json()).owner, false);
});
test('HTTP limits five attempts and cannot route business or AI calls', async t => {
    const { login, base, e } = await setup(t);
    for (let i = 0; i < 5; i++) assert.equal((await login(e.PUMP_OWNER_ACCESS_PASSWORD)).status, 200);
    assert.equal((await login(e.PUMP_OWNER_ACCESS_PASSWORD)).status, 429);
    for (const path of ['/api/ai/chat', '/api/ai/owner-read-canary', '/api/parts']) {
        assert.equal((await fetch(base + path)).status, 404);
    }
});
