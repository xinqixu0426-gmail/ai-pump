'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..'), delay = ms => new Promise(r => setTimeout(r, ms));
const q = (a, p) => [...a].sort((x, y) => x - y)[Math.ceil(a.length * p) - 1];
const stats = a => ({ median: q(a, .5), p95: q(a, .95) });
function client(port, width) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'certify-v5-f1c-transport-performance.cjs'), '--client', String(port), String(width)], { windowsHide: true });
        let out = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', () => {});
        child.on('error', reject); child.on('close', code => { try { assert.equal(code, 0); resolve(JSON.parse(out.split('\n').find(s => s.startsWith('TRANSPORT_RESULT=')).slice('TRANSPORT_RESULT='.length))); } catch { reject(Error('TRANSPORT_CLIENT_FAILED')); } });
    });
}
const fakeAnswer = async messages => {
    await delay(2);
    const v = JSON.parse(messages[1].content);
    return { content: JSON.stringify({ version: 1, answerStatus: 'ANSWERED', answerText: v.facts.map(f => f.realization).join('\n'),
        claims: v.facts.map((f, i) => ({ claimId: 'c' + (i + 1), claimType: 'FACT', factKey: f.factKey, evidenceRefs: [f.evidenceRef], entityRef: v.entityRef, numericValue: f.numericValue })) }) };
};
async function main() {
    const output = path.join(root, 'docs/ai-governance/data/v5-f2b-answer-performance.json');
    assert.equal(fs.existsSync(output), false);
    const { dbSnapshot } = require('./run-ai-v5e4r-nested-refinement-evaluation.cjs');
    const { openFixture, fixtures } = require('./run-ai-v5f1b-read-certification.cjs');
    const { readTask, freeze } = require('./run-ai-v5f2b-answer-formal.cjs');
    const { composeReadAnswer } = require('../api/services/ai-v5/readAnswerComposer.cjs');
    const { createV5ShadowMirror } = require('../api/services/ai-v5/shadowMirror.cjs');
    const { captureSafeV4ShadowFacts } = require('../api/services/ai-v5/shadowProjection.cjs');
    const before = dbSnapshot(), pre = freeze();
    const saved = console.log; console.log = () => {};
    const fixture = await openFixture(), source = fixtures(fixture.db).get('FLAT_BLADE_PRICE');
    const oracle = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json'), 'utf8')).cases.find(p => p.source_group === 'FLAT_BLADE_PRICE');
    const data = { version: 1, methodology: 'A3C_FIXED_KEEP_ALIVE_EXTERNAL_CLIENT_RESPONSE_FINISH', realAnswerModelCalls: 0,
        controlledAnswerModel: 'FAKE_2MS_REAL_COMPOSER_AND_VALIDATOR', warmup: 24, measured: 200, pairs: [] };
    let block;
    const server = http.createServer(async (req, res) => {
        if (req.url === '/precondition') { res.end('paired-fixture-response'); return; }
        const seq = Number(req.headers['x-fixture-sequence']);
        const row = { start: performance.now(), end: null, measured: seq >= 24, activeAtArrival: ++block.active };
        block.rows.push(row);
        res.once('finish', () => { row.end = performance.now(); block.active--; });
        await delay(20 + 2 * (seq % block.width));
        const taskId = crypto.randomUUID();
        const facts = captureSafeV4ShadowFacts({ requestId: taskId }, { intent: { mode: 'query' }, telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] } },
            { traceId: crypto.randomBytes(16).toString('hex') }, { shadowTaskId: taskId });
        const job = block.mirror.mirror(facts, { sourceRequest: 'synthetic-performance-request' });
        if (job.completion) block.jobs.push(job.completion);
        res.end('paired-fixture-response');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r)); server.keepAliveTimeout = 60000;
    async function mode(width, enabled) {
        const env = { ...process.env, AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1', AI_V5_ANSWER_SHADOW_ENABLED: String(enabled) };
        block = { width, active: 0, rows: [], jobs: [], answers: [], errors: 0, reads: 0 };
        const own = block;
        own.mirror = createV5ShadowMirror({ env, runIndependent: async input => {
            const task = await readTask(oracle, source, input.shadowTaskId);
            if (task.execution.verificationStatus !== 'PASS' || task.execution.resultComparison !== 'MATCH') own.errors++;
            own.reads++;
            const answer = await composeReadAnswer(task, { env, modelRequest: fakeAnswer });
            if (enabled && answer.status !== 'ANSWER_SHADOW_ACCEPTED') own.errors++;
            if (enabled) own.answers.push(answer.durationMs);
            return { readExecution: task.execution, modelCalls: 0, v5ToolCalls: 1 };
        } });
        const transport = await client(server.address().port, width);
        await Promise.all(own.jobs); assert.equal(await own.mirror.waitForIdle(1000), true);
        const rows = own.rows.filter(r => r.measured); assert.equal(rows.length, 200);
        const histogram = {}; for (const r of rows) histogram[r.activeAtArrival] = (histogram[r.activeAtArrival] || 0) + 1;
        return { enabled, latency: stats(rows.map(r => r.end - r.start)), histogram, transport: { reused: transport.reused, newConnections: transport.newConnections, deviation: transport.deviation },
            reads: own.reads, answerCount: own.answers.length, completion: own.answers.length ? stats(own.answers) : null, errors: own.errors };
    }
    try {
        for (const width of [2, 4, 8]) {
            let valid = 0;
            for (let attempt = 0; attempt < 10 && valid < 3; attempt++) {
                const a = await mode(width, attempt % 2 === 1), b = await mode(width, attempt % 2 === 0);
                const off = a.enabled ? b : a, on = a.enabled ? a : b;
                const tv = [...new Set([...Object.keys(off.histogram), ...Object.keys(on.histogram)])].reduce((n, k) => n + Math.abs((off.histogram[k] || 0) / 200 - (on.histogram[k] || 0) / 200), 0) / 2;
                const ok = [off, on].every(m => m.transport.reused === 200 && m.transport.newConnections === 0 && m.errors === 0 && m.reads > 0)
                    && Math.abs(off.transport.deviation.median - on.transport.deviation.median) <= 2
                    && Math.abs(off.transport.deviation.p95 - on.transport.deviation.p95) <= 5 && tv <= .05;
                const median = (on.latency.median / off.latency.median - 1) * 100, p95 = (on.latency.p95 / off.latency.p95 - 1) * 100;
                data.pairs.push({ width, attempt, valid: ok, off, on, foregroundTV: tv, medianOverhead: median, p95Overhead: p95, pass: ok && median <= 5 && p95 <= 10 });
                if (ok) valid++;
                saved(JSON.stringify({ width, attempt, valid: ok, median, p95 }));
            }
        }
    } finally {
        server.closeAllConnections(); await new Promise(r => server.close(r)); data.fixtureSafety = await fixture.close(); console.log = saved;
        data.databaseUnchanged = JSON.stringify(before) === JSON.stringify(dbSnapshot()); data.hashesMatch = JSON.stringify(pre) === JSON.stringify(freeze());
        data.pass = [2, 4, 8].every(w => data.pairs.filter(p => p.width === w && p.valid).length >= 3)
            && data.pairs.filter(p => p.valid).every(p => p.pass) && data.databaseUnchanged && data.fixtureSafety.unchanged && data.hashesMatch;
        fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    }
}
if (require.main === module) main().catch(() => { console.error('ANSWER_PERFORMANCE_FAILED'); process.exitCode = 1; });
