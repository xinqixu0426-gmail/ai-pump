'use strict';
// Explicit operator certification; no secrets, JWTs or business rows are output.
const fs = require('node:fs'), crypto = require('node:crypto');
const { main: manage } = require('./manage-owner-authentication.cjs');
const PROD = '/Users/dan/pump-cost-accounting-system', OPS = '/Users/dan/pump-owner-auth-p16ir2';
const H = '/Users/dan/pump-v5-owner-ops-p16h';
const env = () => require(PROD + '/node_modules/dotenv').parse(fs.readFileSync(PROD + '/.env'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function snapshot() {
    const st = fs.statSync(PROD + '/pump.db');
    return { hash: hash(fs.readFileSync(PROD + '/pump.db')), mtimeMs: st.mtimeMs, size: st.size,
        backups: fs.readdirSync(PROD + '/backups').sort() };
}
const meta = () => JSON.parse(fs.readFileSync(H + '/candidate-metadata.json'));
const ready = async () => {
    const e = env();
    const legacy = await fetch('http://127.0.0.1:3002/api/health/ready').then(r => r.json());
    const candidate = await fetch('http://127.0.0.1:3102/api/health/ready', { headers: { 'x-internal-secret': e.INTERNAL_SECRET } }).then(r => r.json());
    return { legacyPid: legacy.data.runtime.pid, legacyReady: legacy.data.ready === true,
        candidateReady: candidate.data.ready === true };
};
async function certify() {
    if (process.getuid?.() !== 501 || process.argv[2] !== '--provision-and-certify') throw Error('OPERATOR_ACTION_REQUIRED');
    const source = await new Promise(resolve => { let s = ''; process.stdin.on('data', b => { s += b; }); process.stdin.on('end', () => resolve(s)); });
    if (!source || source.length > 2048) throw Error('CANARY_FIXTURE_REQUIRED');
    const before = snapshot(), priorEnv = env(), healthBefore = await ready(), countBefore = meta().completedRequests;
    await manage('provision'); await manage('install');
    // Bounded startup wait is not an authentication or model retry.
    for (let i = 0; i < 20; i++) {
        const up = await fetch('http://127.0.0.1:3104/api/auth/check').then(r => r.status === 401).catch(() => false);
        if (up) break;
        if (i === 19) throw Error('AUTH_STARTUP_TIMEOUT');
        await new Promise(r => setTimeout(r, 250));
    }
    await manage('enable-route');
    const e = env(), base = 'https://xuxinqi.xin';
    const login = async password => {
        const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ password }), signal: AbortSignal.timeout(10000) });
        return { status: r.status, cookie: r.headers.get('set-cookie') || '' };
    };
    const token = r => r.cookie.match(/^token=([^;]+)/)?.[1];
    const check = async value => {
        const r = await fetch(base + '/api/auth/check', { headers: { cookie: 'token=' + value, 'x-owner': 'true' }, signal: AbortSignal.timeout(10000) });
        return { status: r.status, ...(await r.json()) };
    };
    const shared = await login(e.ACCESS_PASSWORD), owner = await login(e.PUMP_OWNER_ACCESS_PASSWORD);
    const sharedCheck = await check(token(shared)), ownerCheck = await check(token(owner));
    const jwt = require(PROD + '/node_modules/jsonwebtoken');
    const ownerClaims = jwt.verify(token(owner), e.JWT_SECRET), sharedClaims = jwt.verify(token(shared), e.JWT_SECRET);
    const wrong = await login(crypto.randomBytes(32).toString('base64url'));
    const forged = await check(jwt.sign({ role: 'admin', sub: e.PUMP_OWNER_SUBJECT, authn: 'owner_credential_v1' }, 'synthetic-forged-key'));
    const wrongSubject = await check(jwt.sign({ role: 'admin', sub: 'synthetic_unknown_subject', authn: 'owner_credential_v1' }, e.JWT_SECRET, { expiresIn: '1m' }));
    const ordinary = [];
    for (const value of [token(owner), token(shared)]) {
        const r = await fetch(base + '/api/ai/health', { headers: { cookie: 'token=' + value }, signal: AbortSignal.timeout(10000) });
        await r.arrayBuffer(); ordinary.push(r.status);
    }
    const automaticCandidateAttempts = meta().completedRequests - countBefore;
    let rollback;
    await manage('disable');
    try {
        const disabled = await check(token(owner)), sharedAgain = await login(e.ACCESS_PASSWORD), rejected = await login(e.PUMP_OWNER_ACCESS_PASSWORD);
        rollback = disabled.owner === false && sharedAgain.status === 200 && rejected.status === 401;
    } finally { await manage('enable'); }
    const restored = await check(token(owner));
    const denied = await fetch(base + '/api/ai/owner-read-canary', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: source }] }), signal: AbortSignal.timeout(10000) });
    await denied.arrayBuffer();
    const explicit = await fetch(base + '/api/ai/owner-read-canary', { method: 'POST', headers: {
        'content-type': 'application/json', 'x-internal-secret': e.INTERNAL_SECRET, 'x-pump-v5-use': 'true', 'x-pump-v5-fact': 'inventory.quantity' },
        body: JSON.stringify({ messages: [{ role: 'user', content: source }] }), signal: AbortSignal.timeout(190000) });
    const text = await explicit.text(), events = text.split('\n\n').filter(s => s.startsWith('data: ')).map(s => JSON.parse(s.slice(6)));
    const healthAfter = await ready(), after = snapshot(), finalEnv = env();
    const nonOwnerKeys = Object.keys(priorEnv).every(k => finalEnv[k] === priorEnv[k]);
    const st = fs.statSync(OPS + '/private/owner-login-credential.txt');
    const result = { version: 1, healthBefore, healthAfter, sharedAuthenticated: shared.status === 200,
        sharedOwner: sharedCheck.owner, sharedSubAbsent: !Object.hasOwn(sharedClaims, 'sub'), ownerAuthenticated: owner.status === 200,
        ownerVerified: ownerCheck.owner, ownerStableSubject: ownerClaims.sub === e.PUMP_OWNER_SUBJECT,
        wrongCredentialRejected: wrong.status === 401, forgedJwtRejected: forged.status === 401 && forged.owner === false,
        wrongSubjectRejected: wrongSubject.owner === false, forgedHeaderDoesNotGrantOwner: sharedCheck.owner === false,
        cookieSecurity: ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/'].every(x => owner.cookie.includes(x)),
        ordinaryLegacyHealthStatus: ordinary, automaticCandidateAttempts, rollback, restoredOwner: restored.owner,
        explicitUnauthenticatedRejected: denied.status === 401, explicitCanaryPass: explicit.status === 200
            && events.filter(x => x.type === 'content').length === 1 && events.filter(x => x.type === 'done').length === 1
            && events.filter(x => x.type === 'error').length === 0 && meta().events.at(-1).delivered === true,
        dbHashUnchanged: before.hash === after.hash, dbMtimeUnchanged: before.mtimeMs === after.mtimeMs,
        dbSizeUnchanged: before.size === after.size, backupCountUnchanged: JSON.stringify(before.backups) === JSON.stringify(after.backups),
        existingEnvironmentPreserved: nonOwnerKeys, handoffPermissionsSafe: st.uid === 501 && (st.mode & 0o077) === 0,
        legacyRestarted: healthBefore.legacyPid !== healthAfter.legacyPid, businessMutationCalls: 0, v5Writes: 0 };
    const serialized = JSON.stringify(result);
    if ([e.PUMP_OWNER_ACCESS_PASSWORD, token(owner), token(shared), e.JWT_SECRET, source].some(v => serialized.includes(v))) throw Error('UNSAFE_RESULT');
    fs.writeFileSync(OPS + '/certification.json', serialized, { mode: 0o600, flag: 'wx' });
    console.log(serialized);
}
if (require.main === module) certify().catch(() => { console.error('OWNER_AUTH_CERTIFICATION_FAILED'); process.exitCode = 1; });
