'use strict';

// N7.1 isolated rollout drill. It uses a disposable SQLite HTTP fixture and
// retains raw SSE/model material only in ignored logs/.
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');
const { startAiHttpRuntime } = require('../tests/helpers/ontologyHttpRuntimeFixture.cjs');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'logs', 'ai-native-rollout-live-latest.json');
const rawPath = path.join(root, 'logs', 'ai-native-rollout-live-raw.json');
// `--env-file=<path>`：显式提供实时 provider 凭据（进程内加载，不复制、不持久化、不打印）。
const envFileArgument = (process.argv.slice(2).find(entry => entry.startsWith('--env-file=')) || '').slice('--env-file='.length);
dotenv.config({ path: envFileArgument ? path.resolve(envFileArgument) : path.join(root, '.env'), quiet: true });
function git(args) { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); } catch { return null; } }

function requestResponse(token) {
    const req = new EventEmitter();
    req.body = { messages: [{ role: 'user', content: 'V550电缆改5米，卖340毛利多少，做300台库存够不够，先不要保存。' }] };
    req.headers = {};
    req.cookies = token ? { token } : {};
    req.user = { role: 'admin' };
    req.requestId = `n7-live-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const res = new EventEmitter();
    res.writableEnded = false; res.destroyed = false; res.output = '';
    res.setHeader = () => {}; res.flushHeaders = () => {}; res.flush = () => {};
    res.write = chunk => { res.output += String(chunk); return true; };
    res.end = () => { res.writableEnded = true; };
    return { req, res };
}
function events(output) {
    return [...String(output).matchAll(/^data: (.+)$/gmu)].flatMap(match => {
        try { return [JSON.parse(match[1])]; } catch { return []; }
    });
}
function configureFixture(db) {
    db.prepare(`UPDATE recipes SET name='V550', coil_spec='12', coil_sheets=220, coil_material='冷轧', coil_slot_type='小眼', has_cable=1, cable_length=3, cable_wire='1.5' WHERE id=301`).run();
    db.prepare(`UPDATE coils SET scheme_name='12-220 方案A', scheme_code='N7-A', spec='12', sheets=220, scheme_status='official', pricing_mode='kit', kit_price=20, cost=20 WHERE id=501`).run();
    db.prepare(`UPDATE coils SET scheme_name='12-220 方案B', scheme_code='N7-B', spec='12', sheets=220, scheme_status='official', pricing_mode='kit', kit_price=21, cost=21 WHERE id=502`).run();
    db.prepare('UPDATE parts SET price=10 WHERE id=601').run();
    db.prepare(`INSERT INTO parts(id,model,category,price,supplier) VALUES(603,'电缆-线径1.5','电缆线',2,'供应甲')`).run();
}
async function main() {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const keys = ['NODE_ENV', 'ACCESS_PASSWORD', 'JWT_SECRET', 'PUMP_OWNER_ACCESS_PASSWORD', 'PUMP_OWNER_SUBJECT', 'AI_V5_OWNER_SUBJECTS', 'AI_NATIVE_MODE', 'AI_NATIVE_WRITE_ENABLED'];
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    const ownerEnv = {
        ACCESS_PASSWORD: 'n7-shared-login-only', JWT_SECRET: 'n7-owner-jwt-secret',
        PUMP_OWNER_ACCESS_PASSWORD: 'n7-isolated-owner-credential-not-production',
        PUMP_OWNER_SUBJECT: 'n7_isolated_owner_subject', AI_V5_OWNER_SUBJECTS: '["n7_isolated_owner_subject"]',
    };
    Object.assign(process.env, ownerEnv, { NODE_ENV: 'test', AI_NATIVE_WRITE_ENABLED: 'false' });
    const ownerToken = issueOwnerToken(ownerEnv.PUMP_OWNER_ACCESS_PASSWORD, ownerEnv);
    const runtime = await startAiHttpRuntime();
    try {
        configureFixture(runtime.db);
        const { handleAiChat } = require('../api/routes/ai/chat.cjs');
        const rounds = [];
        for (const mode of ['off', 'shadow', 'owner', 'off']) {
            process.env.AI_NATIVE_MODE = mode;
            const { req, res } = requestResponse(ownerToken);
            await handleAiChat(req, res);
            const current = events(res.output);
            const metrics = current.find(item => item.type === 'metrics') || {};
            const provider = current.find(item => item.type === 'provider') || null;
            const error = current.find(item => item.type === 'error') || null;
            rounds.push({ mode, provider: provider ? { provider: provider.provider, model: provider.model, fallback: Boolean(provider.fallback) } : null,
                modelRequestCount: metrics.modelRequestCount ?? null, toolCallCount: metrics.toolCallCount ?? null,
                content: current.some(item => item.type === 'content'), error: error?.code || null,
                nativeStatus: current.find(item => item.type === 'status' && item.stage === 'task_v2')?.stage || null });
            fs.mkdirSync(path.dirname(rawPath), { recursive: true });
            fs.writeFileSync(rawPath, JSON.stringify({ generatedAt: new Date().toISOString(), rounds: [{ mode, events: current }] }, null, 2));
        }
        const [offBefore, shadow, owner, offAfter] = rounds;
        const errors = [];
        if (offBefore.nativeStatus || shadow.nativeStatus || offAfter.nativeStatus) errors.push('legacy_mode_delegated_native');
        if (owner.nativeStatus !== 'task_v2') errors.push('owner_mode_missing_native_delegation');
        if (rounds.some(round => round.error)) errors.push('provider_or_runtime_error');
        if (rounds.some(round => !round.content)) errors.push('missing_answer_content');
        if (rounds.some(round => round.provider?.provider !== 'deepseek')) errors.push('unexpected_provider');
        if (rounds.some(round => round.provider?.fallback)) errors.push('provider_fallback');
        const report = { version: 1, generatedAt: new Date().toISOString(), sourceRevision: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']), sourceDirty: Boolean(git(['status', '--porcelain'])), isolated: true, sequence: 'off->shadow->owner(write=false)->off',
            actualProvider: 'deepseek', writeEnabled: false, businessWrites: 0, rounds, errors };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
        if (errors.length) process.exitCode = 2;
    } finally {
        await runtime.close();
        for (const key of keys) {
            if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
        }
    }
}
main().catch(error => { process.stderr.write(`AI_NATIVE_ROLLOUT_LIVE_FAILED ${error.code || error.message}\n`); process.exitCode = 2; });
