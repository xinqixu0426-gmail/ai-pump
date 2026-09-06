'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { fixtures } = require('./run-ai-v5f1b-read-certification.cjs');
const { required } = require('./run-ai-v5f2b-answer-formal.cjs');
const root = path.resolve(__dirname, '..');
const corpus = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json'))).cases;
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function logical(file) {
    const db = new Database(file, { readonly: true });
    try {
        const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all();
        return hash(JSON.stringify(tables.map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()
            .map(row => JSON.stringify(row)).sort()])));
    } finally { db.close(); }
}
async function worker() {
    const logs = [], spans = [], { AsyncLocalStorage } = require('node:async_hooks'), als = new AsyncLocalStorage();
    for (const method of ['log', 'error', 'warn', 'info', 'debug']) console[method] = (...args) => logs.push(args.map(String).join(' '));
    const oracleDb = new Database(process.env.PUMP_V5_CANDIDATE_DATABASE, { readonly: true });
    const sources = fixtures(oracleDb); oracleDb.close();
    const phoenixModule = { register: () => ({ getTracer: () => ({ startActiveSpan(name, options, fn) {
        const parent = als.getStore(), record = { id: crypto.randomUUID(), parent: parent?.id || null, root: parent?.root || null, name, attributes: { ...options.attributes } };
        if (!parent) record.root = record.id; spans.push(record);
        return als.run(record, () => fn({ setAttributes(a) { Object.assign(record.attributes, a); }, setAttribute(k, v) { record.attributes[k] = v; }, setStatus() {}, end() {}, updateName() {} }));
    } }), forceFlush: async () => {}, shutdown: async () => {} }) };
    const runtime = await require('./start-v5-candidate.cjs').startCandidate({ observability: { phoenixModule, logger: { warn() {} } },
        readOptions: async req => {
            const entry = [...sources].find(([, s]) => s.source === req.body.messages[0].content);
            if (!entry) return {};
            const oracle = corpus.find(p => p.source_group === entry[0]);
            return { executionOptions: { compare: await require('./run-ai-v5-p16c-certification.cjs').comparator(oracle, entry[1]) } };
        }, onOutcome: outcome => process.send({ type: 'outcome', outcome }) });
    process.on('message', async message => {
        if (message.type !== 'stop') return;
        await runtime.close();
        const visible = JSON.stringify({ logs, spans });
        process.send({ type: 'closed', trace: { spans: spans.length,
            orphans: spans.filter(s => s.name !== 'invoke_agent pump_factory_assistant' && !s.parent).length,
            crossRequest: spans.filter(s => s.attributes['pump.ai.v5.shadow_task_id']).filter(s => spans.find(p => p.id === s.root)?.attributes['pump.request.id'] !== s.attributes['pump.ai.v5.shadow_task_id']).length,
            sourceLeaks: [...sources.values()].filter(s => visible.includes(s.source) || visible.includes(s.mention)).length,
            forbiddenFields: (visible.match(/"(?:answerText|numericValue|runtimeValue|canonicalId|stock|currentTotalCost|price)"\s*:/gu) || []).length } });
        process.disconnect();
    });
    process.send({ type: 'ready', pid: process.pid });
}
async function main() {
    require('dotenv').config({ quiet: true });
    assert.ok(process.env.DEEPSEEK_API_KEY, 'PROVIDER_UNAVAILABLE');
    const output = path.join(root, 'docs/ai-governance/data/p16e-r4l-close-candidate-certification.json');
    assert.equal(fs.existsSync(output), false, 'CERTIFICATION_ALREADY_EXISTS');
    // Reserve the one-shot run before any external call. Interrupted runs cannot be
    // silently repeated; partial safe evidence stays at the same path.
    fs.writeFileSync(output, JSON.stringify({ status: 'STARTED', paths: [] }) + '\n', { flag: 'wx' });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-candidate-formal-')), file = path.join(dir, 'fixture.db');
    const source = new Database(path.join(root, 'pump.db'), { readonly: true });
    await source.backup(file); source.close();
    const before = logical(file), physical = hash(fs.readFileSync(file));
    const fixtureDb = new Database(file, { readonly: true }), sources = fixtures(fixtureDb); fixtureDb.close();
    const net = require('node:net'), reservation = net.createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
    const secret = crypto.randomUUID();
    const child = require('node:child_process').fork(__filename, ['--worker'], { silent: true, env: { ...process.env,
        PUMP_V5_CANDIDATE_RUNTIME: 'true', PUMP_V5_CANDIDATE_DATABASE: file, PUMP_V5_CANDIDATE_PORT: String(port),
        INTERNAL_SECRET: secret, AI_OBSERVABILITY_ENABLED: 'true', AI_V5_READ_CANARY_ENABLED: 'true', AI_V5_READ_CANARY_AUTHORITATIVE_ENABLED: 'true' } });
    child.stdout.resume(); child.stderr.resume();
    const data = { frozenPaths: 15, paths: [], port, independentPid: child.pid !== process.pid, fixture: 'LOCAL_READONLY_COPY', productionAccessed: false };
    let latest, closed;
    child.on('message', m => { if (m.type === 'outcome') latest = m.outcome; if (m.type === 'closed') closed = m; });
    const exited = new Promise(resolve => child.once('exit', resolve));
    try {
        await new Promise((resolve, reject) => { child.on('message', m => { if (m.type === 'ready') resolve(); }); child.once('exit', () => reject(Error('CANDIDATE_START_FAILED'))); });
        for (const item of corpus) {
            latest = null;
            const start = performance.now();
            const response = await fetch(`http://127.0.0.1:${port}/api/ai/chat`, { method: 'POST', headers: {
                'Content-Type': 'application/json', 'x-internal-secret': secret, 'x-pump-v5-use': 'true', 'x-pump-v5-fact': required[item.source_group] },
            body: JSON.stringify({ messages: [{ role: 'user', content: sources.get(item.source_group).source }] }) });
            const events = (await response.text()).split('\n\n').filter(Boolean).map(s => JSON.parse(s.slice(6)));
            await new Promise(resolve => setImmediate(resolve));
            const bodies = events.filter(e => e.type === 'content');
            data.paths.push({ caseId: item.case_id, sourceGroup: item.source_group, factKey: required[item.source_group],
                latencyMs: performance.now() - start, final: bodies.length === 1 && typeof bodies[0].content === 'string' && bodies[0].content.length > 0,
                rawExposed: bodies.some(e => e.content.startsWith('{') || e.content.includes('evidenceRefs')), ...latest });
            fs.writeFileSync(output, JSON.stringify({ ...data, status: 'RUNNING' }, null, 2) + '\n');
            console.log(JSON.stringify({ caseId: item.case_id, validationPass: latest?.validationPass, failureClass: latest?.failureClass }));
        }
    } catch { data.failure = 'CANDIDATE_CERTIFICATION_FAILED'; }
    finally {
        if (child.connected) child.send({ type: 'stop' });
        data.exitCode = await exited; data.trace = closed?.trace;
        data.logicalState = before === logical(file) ? 'MATCH' : 'MISMATCH';
        data.physicalUnchanged = physical === hash(fs.readFileSync(file));
        const latency = data.paths.map(p => p.latencyMs).sort((a, b) => a - b);
        data.median = latency[Math.ceil(latency.length * .5) - 1]; data.p95 = latency[Math.ceil(latency.length * .95) - 1];
        const riskLatency = data.paths.map(p => p.risk?.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
        data.riskMedian = riskLatency[Math.ceil(riskLatency.length * .5) - 1]; data.riskP95 = riskLatency[Math.ceil(riskLatency.length * .95) - 1];
        data.portClosed = await fetch(`http://127.0.0.1:${port}/api/health/ready`).then(() => false, () => true);
        data.riskSuccesses = data.paths.filter(p => p.risk?.contractValid && p.risk.eligible).length;
        data.safeAvailabilityFallbacks = data.paths.filter(p => p.safeAvailabilityFallback === true).length;
        data.validatedAnswers = data.paths.filter(p => p.final && p.validationPass).length;
        const safeFallback = p => p.safeAvailabilityFallback === true && p.risk?.eligible === false && !p.attempted
            && !p.eligible && !p.final && !p.delivered && !p.toolCalls && !p.modelCalls;
        data.pass = !data.failure && data.paths.length === 15 && data.paths.every(p => safeFallback(p) || (p.final && !p.rawExposed && p.validationPass
            && p.resultEquivalence === 'MATCH' && p.evidenceVerification === 'PASS')) && data.logicalState === 'MATCH' && data.physicalUnchanged
            && data.exitCode === 0 && data.trace && ['orphans', 'crossRequest', 'sourceLeaks', 'forbiddenFields'].every(k => data.trace[k] === 0);
        data.pass = data.pass && data.portClosed;
        data.status = 'COMPLETED';
        fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
        console.log(JSON.stringify({ pass: data.pass, count: data.paths.length, trace: data.trace, median: data.median, p95: data.p95 }));
        if (!data.pass) process.exitCode = 1;
    }
}
if (require.main === module) (process.argv.includes('--worker') ? worker() : main()).catch(() => { console.error('CANDIDATE_CERTIFICATION_PREFLIGHT_FAILED'); process.exitCode = 1; });
