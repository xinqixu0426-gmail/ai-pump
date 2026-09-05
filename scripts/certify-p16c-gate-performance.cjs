'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process'), { EventEmitter } = require('node:events'), Module = require('node:module');
const root = path.resolve(__dirname, '..'), delay = ms => new Promise(r => setTimeout(r, ms));
const q = (a,p) => [...a].sort((x,y) => x-y)[Math.ceil(a.length*p)-1];
const stats = a => ({ median: q(a,.5), p95: q(a,.95) });
async function client(port) {
    return new Promise((resolve,reject) => {
        const child = spawn(process.execPath, [path.join(__dirname, 'certify-v5-f1c-transport-performance.cjs'), '--client', String(port), '4'], { windowsHide: true });
        let out = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', () => {});
        child.on('error', reject); child.on('close', code => { try {
            assert.equal(code,0); resolve(JSON.parse(out.split('\n').find(s => s.startsWith('TRANSPORT_RESULT=')).slice('TRANSPORT_RESULT='.length)));
        } catch { reject(Error('P16C_TRANSPORT_FAILED')); } });
    });
}
async function main() {
    process.env.NODE_ENV = 'test'; process.env.NODE_TEST_CONTEXT = '1'; process.env.AI_OBSERVABILITY_ENABLED = 'false';
    const output = path.join(root, 'docs/ai-governance/data/p16c-gate-performance.json');
    assert.equal(fs.existsSync(output), false);
    const filename = path.join(root, 'api/routes/ai/chat.cjs'), baseline = new Module(filename, module);
    baseline.filename = filename; baseline.paths = Module._nodeModulePaths(path.dirname(filename));
    baseline._compile(execFileSync('git', ['show', '53f630e6d6da79ced4541c3791160c5566db3b4f:api/routes/ai/chat.cjs'], { cwd: root }).toString(), filename);
    const oldHandler = baseline.exports.handleAiChat, newHandler = require(filename).handleAiChat;
    let block;
    const server = http.createServer(async (req,res) => {
        if (req.url === '/precondition') { res.end('paired-fixture-response'); return; }
        const seq = Number(req.headers['x-fixture-sequence']), row = { start: performance.now(), end: null, measured: seq >= 24, active: ++block.active };
        block.rows.push(row); res.once('finish', () => { row.end = performance.now(); block.active--; });
        req.body = { messages: [{ role: 'user', content: 'synthetic-performance-request' }] };
        const response = Object.assign(new EventEmitter(), { setHeader() {}, flushHeaders() {}, write(s) {
            if (s.startsWith('data: ')) { const e = JSON.parse(s.slice(6)); if (!['content','done'].includes(e.type)) block.errors++; }
            return true;
        }, end() { this.writableEnded = true; res.end('paired-fixture-response'); } });
        await (block.current ? newHandler : oldHandler)(req, response, { env: { AI_V5_READ_CANARY_ENABLED: 'false' }, telemetry: { record() {} },
            runAiDispatcherV3: async ({ emit }) => { await delay(20+2*(seq%4)); emit('content', { content: 'synthetic' }); emit('done', {});
                return { intent: { mode: 'query' }, telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] } }; } });
    });
    await new Promise(r => server.listen(0,'127.0.0.1',r)); server.keepAliveTimeout = 60000;
    const data = { version: 1, baselineCommit: '53f630e6d6da79ced4541c3791160c5566db3b4f',
        methodology: 'ACTUAL_CHAT_HANDLER_RESPONSE_FINISH_EXTERNAL_A3C_FIXED_KEEP_ALIVE_CLIENT',
        legacyWorkload: 'SYNTHETIC_20_PLUS_2MS_PER_SLOT', gate: 'OFF', width: 4, warmup: 24, measured: 200,
        targetValidPairs: 3, maxAttempts: 6, pairs: [] };
    fs.writeFileSync(output, JSON.stringify(data,null,2)+'\n', { flag:'wx' });
    async function mode(current) {
        block = { current, rows: [], active: 0, errors: 0 };
        const t = await client(server.address().port), rows = block.rows.filter(r => r.measured), histogram = {};
        assert.equal(rows.length,200); for (const r of rows) histogram[r.active] = (histogram[r.active] || 0)+1;
        return { current, latency: stats(rows.map(r => r.end-r.start)), histogram, errors: block.errors,
            transport: { reused: t.reused, newConnections: t.newConnections, deviation: t.deviation } };
    }
    try {
        for (let attempt=0; attempt<6 && data.pairs.filter(p => p.valid).length<3; attempt++) {
            const a = await mode(attempt%2 === 1), b = await mode(attempt%2 === 0), base = a.current ? b : a, current = a.current ? a : b;
            const tv = [...new Set([...Object.keys(base.histogram),...Object.keys(current.histogram)])].reduce((n,k) => n+Math.abs((base.histogram[k]||0)/200-(current.histogram[k]||0)/200),0)/2;
            const valid = [base,current].every(m => m.transport.reused===200 && m.transport.newConnections===0 && m.errors===0)
                && Math.abs(base.transport.deviation.median-current.transport.deviation.median)<=2
                && Math.abs(base.transport.deviation.p95-current.transport.deviation.p95)<=5 && tv<=.05;
            const medianOverhead=(current.latency.median/base.latency.median-1)*100, p95Overhead=(current.latency.p95/base.latency.p95-1)*100;
            data.pairs.push({ attempt, base, current, foregroundTV: tv, valid, medianOverhead, p95Overhead, pass: valid && medianOverhead<=5 && p95Overhead<=10 });
            fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');
            console.log(JSON.stringify({ attempt,valid,medianOverhead,p95Overhead }));
        }
    } finally {
        server.closeAllConnections(); await new Promise(r => server.close(r));
        const valid = data.pairs.filter(p => p.valid);
        data.pass=valid.length===3 && valid.every(p => p.pass);
        data.medianOverhead=valid.length ? Math.max(...valid.map(p => p.medianOverhead)) : null;
        data.p95Overhead=valid.length ? Math.max(...valid.map(p => p.p95Overhead)) : null;
        fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n'); if(!data.pass) process.exitCode=1;
    }
}
if(require.main===module) main().catch(()=>{ console.error('P16C_PERFORMANCE_STOPPED'); process.exitCode=1; });
