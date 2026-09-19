'use strict';
// Narrow Mac mini operator control. Never prints secrets or reads business rows.
const fs = require('node:fs'), cp = require('node:child_process'), crypto = require('node:crypto');
const OPS = '/Users/dan/pump-owner-auth-p16ir2';
const LEGACY = '/Users/dan/pump-cost-accounting-system';
const ENV = LEGACY + '/.env';
const LABEL = 'org.pump.owner-authentication';
const PLIST = '/Users/dan/Library/LaunchAgents/' + LABEL + '.plist';
const KEYS = ['PUMP_OWNER_ACCESS_PASSWORD', 'PUMP_OWNER_SUBJECT', 'AI_V5_OWNER_SUBJECTS'];
const HANDOFF = OPS + '/private/owner-login-credential.txt';
function secureFile(file) {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) || st.uid !== process.getuid()) throw Error('UNSAFE_CONFIG');
}
function envText() { secureFile(ENV); return fs.readFileSync(ENV, 'utf8'); }
function saveEnv(before, after) {
    if (envText() !== before) throw Error('CONFIG_CONCURRENT_CHANGE');
    const temp = ENV + '.owner-' + crypto.randomBytes(8).toString('hex');
    fs.writeFileSync(temp, after, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temp, ENV);
}
function config() { return require(LEGACY + '/node_modules/dotenv').parse(envText()); }
function provision() {
    const before = envText(), e = config();
    if (KEYS.some(k => Object.hasOwn(e, k)) || fs.existsSync(HANDOFF)) throw Error('OWNER_ALREADY_CONFIGURED');
    if (!e.ACCESS_PASSWORD || !e.JWT_SECRET) throw Error('EXISTING_AUTH_CONFIG_MISSING');
    const password = crypto.randomBytes(32).toString('base64url'), subject = crypto.randomUUID();
    fs.mkdirSync(OPS + '/private', { mode: 0o700 });
    fs.writeFileSync(HANDOFF, password + '\n', { flag: 'wx', mode: 0o600 });
    saveEnv(before, before + '\n# Dedicated owner authentication; P16-I-R2. No default V5 routing.\n'
        + KEYS[0] + '=' + password + '\n' + KEYS[1] + '=' + subject + '\n'
        + KEYS[2] + '=' + JSON.stringify([subject]) + '\n');
    return { provisioned: true, handoff: HANDOFF };
}
function setEnabled(enabled) {
    const before = envText(), e = config();
    if (!e.PUMP_OWNER_SUBJECT || !e.PUMP_OWNER_ACCESS_PASSWORD) throw Error('OWNER_NOT_CONFIGURED');
    const lines = before.split(/\r?\n/), indices = lines.map((s, i) => s.startsWith('AI_V5_OWNER_SUBJECTS=') ? i : -1).filter(i => i >= 0);
    if (indices.length !== 1) throw Error('OWNER_CONFIG_INVALID');
    lines[indices[0]] = 'AI_V5_OWNER_SUBJECTS=' + JSON.stringify(enabled ? [e.PUMP_OWNER_SUBJECT] : []);
    saveEnv(before, lines.join('\n'));
    return { ownerEnabled: enabled };
}
async function cloudflare(configValue) {
    const pem = fs.readFileSync('/Users/dan/.cloudflared/cert.pem', 'utf8');
    const cert = JSON.parse(Buffer.from(pem.match(/-----BEGIN ARGO TUNNEL TOKEN-----([\s\S]*?)-----END/)[1].replace(/\s/g, ''), 'base64'));
    const plist = JSON.parse(cp.execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '/Library/LaunchDaemons/com.cloudflare.cloudflared.plist']));
    const args = plist.ProgramArguments, tunnel = JSON.parse(Buffer.from(args[args.indexOf('--token') + 1], 'base64'));
    const r = await fetch('https://api.cloudflare.com/client/v4/accounts/' + cert.accountID + '/cfd_tunnel/' + tunnel.t + '/configurations', {
        method: configValue ? 'PUT' : 'GET', headers: { Authorization: 'Bearer ' + cert.apiToken,
            'Content-Type': 'application/json', Accept: 'application/json;version=1' },
        ...(configValue ? { body: JSON.stringify({ config: configValue }) } : {}), signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    if (!r.ok || !j.success) throw Error('INGRESS_CONTROL_FAILED');
    return j.result.config;
}
async function route(enabled) {
    const before = await cloudflare();
    const paths = ['^/api/auth/login$', '^/api/auth/check$'];
    const ours = r => r.hostname === 'xuxinqi.xin' && paths.includes(r.path);
    if (before.ingress.filter(ours).some(r => r.service !== 'http://127.0.0.1:3104')) throw Error('AUTH_ROUTE_CONFLICT');
    const other = before.ingress.filter(r => !ours(r));
    if (!other.some(r => r.hostname === 'xuxinqi.xin' && !r.path && r.service === 'http://localhost:3002')) throw Error('LEGACY_ROUTE_MISSING');
    await cloudflare({ ...before, ingress: [...(enabled ? paths.map(path => ({ hostname: 'xuxinqi.xin', path,
        service: 'http://127.0.0.1:3104' })) : []), ...other] });
    const after = await cloudflare();
    if (JSON.stringify(other) !== JSON.stringify(after.ingress.filter(r => !ours(r)))
        || after.ingress.filter(ours).length !== (enabled ? 2 : 0)) throw Error('INGRESS_VERIFICATION_FAILED');
    return { authRoutesEnabled: enabled, otherIngressPreserved: true };
}
function install() {
    const p = { Label: LABEL, ProgramArguments: ['/opt/homebrew/bin/node', OPS + '/scripts/start-owner-authentication.cjs', ENV],
        WorkingDirectory: OPS, RunAtLoad: true, KeepAlive: true, ThrottleInterval: 5, ProcessType: 'Background',
        StandardOutPath: '/dev/null', StandardErrorPath: '/dev/null',
        EnvironmentVariables: { NODE_PATH: LEGACY + '/node_modules', PATH: '/opt/homebrew/bin:/usr/bin:/bin' } };
    const xml = cp.execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', '-', '--', '-'], { input: JSON.stringify(p) });
    fs.writeFileSync(PLIST, xml, { flag: 'wx', mode: 0o600 });
    cp.execFileSync('/bin/launchctl', ['bootstrap', 'gui/501', PLIST], { stdio: 'ignore' });
    return { installed: true };
}
async function main(command) {
    if (process.getuid?.() !== 501) throw Error('OWNER_UID_MISMATCH');
    if (command === 'provision') return provision();
    if (command === 'install') return install();
    if (command === 'enable') return setEnabled(true);
    if (command === 'disable') return setEnabled(false);
    if (command === 'enable-route') return route(true);
    if (command === 'disable-route') return route(false);
    throw Error('UNKNOWN_OPERATION');
}
if (require.main === module) main(process.argv[2]).then(x => console.log(JSON.stringify(x)))
    .catch(() => { console.error('OWNER_AUTH_OPERATION_FAILED'); process.exitCode = 1; });
module.exports = { main };
