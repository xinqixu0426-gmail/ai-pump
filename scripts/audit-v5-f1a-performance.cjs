'use strict';
// Audit-only synthetic server. No provider, real Executor, Business API or DB import.
const http = require('node:http');
const path = require('node:path');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const mod = name => require(path.join(root, 'api/services/ai-v5', `${name}.cjs`));
const { createV5ShadowMirror } = mod('shadowMirror');
const { captureSafeV4ShadowFacts } = mod('shadowProjection');
const { createV5InterpreterInputEnvelope } = mod('taskInterpreterInput');
const { createV5Task, createV5EntityReference } = mod('contracts');
const { runReadExecutionShadow } = mod('readExecutionShadow');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function summary(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return { median: sorted[Math.ceil(sorted.length / 2) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
}
async function measure(mode, set) {
    const enabled = !['A', 'A_LOAD'].includes(mode);
    const execution = ['C', 'D'].includes(mode);
    const env = { AI_V5_SHADOW_ENABLED: String(enabled), AI_V5_EXECUTION_SHADOW_ENABLED: String(execution), AI_V5_SHADOW_SAMPLE_RATE: '1' };
    let count = 0, fixtureExecutions = 0, beforeEnd = 0, beforeFinish = 0, state;
    const commits = [], clientTimes = [], completions = [];
    const mirror = createV5ShadowMirror({ env, runIndependent: async () => {
        const current = state;
        if (!current.ended) beforeEnd++;
        if (!current.finished) beforeFinish++;
        await delay(2); // Identical synthetic interpreter in B/C/D; no model.
        let result;
        if (execution) {
            const taskId = `audit-${mode}-${set}-${count}`;
            result = await runReadExecutionShadow({ capabilityId: 'inventory.read',
                routeInput: { domain: 'catalog', operation: 'read_inventory', entityType: 'part' },
                task: createV5Task({ taskId, createdAt: new Date().toISOString(), entityContext: [createV5EntityReference({
                    entityType: 'part', rawMention: 'synthetic-only-', canonicalEntityId: '123', resolutionReceiptRef: `${taskId}:resolve`,
                })] }) }, { env, execute: async (_, __, options) => {
                assert.equal(options.allowWrite, false); fixtureExecutions++;
                await delay(2);
                return { success: true, count: 1, truncated: false, parts: [{ id: '123', stock: 1 }],
                    executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/fixture' }] } };
            } });
            assert.equal(result.verificationStatus, 'PASS');
        }
        return { modelCalls: 0, v5ToolCalls: result?.toolCalls || 0, readExecution: result };
    } });
    const server = http.createServer(async (_, res) => {
        const started = performance.now();
        state = { ended: false, finished: false };
        const current = state;
        const envelope = enabled ? createV5InterpreterInputEnvelope({ rawUserRequest: 'synthetic-only-', pageContext: null }) : null;
        await delay(20); // Fixed fake V4 response generation; never invokes V4 model.
        let job;
        if (enabled) {
            const facts = captureSafeV4ShadowFacts({ requestId: `audit-${count}` },
                { intent: { mode: 'query' }, telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] } },
                { traceId: String(count + 1).padStart(32, '0') }, { shadowTaskId: `audit-${mode}-${set}-${count}` });
            job = mirror.mirror(facts, { interpreterEnvelope: envelope });
        }
        res.on('finish', () => {
            current.finished = true;
            if (count >= 5) commits.push(performance.now() - started);
        });
        res.end('synthetic-response'); current.ended = true;
        current.completion = Promise.resolve(job?.completion).then(() => {
            if (enabled && count >= 5) completions.push(performance.now() - started);
        });
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const background = ['D', 'A_LOAD'].includes(mode) ? setInterval(() => {
        const until = performance.now() + 4;
        while (performance.now() < until) { /* controlled same-event-loop contention, no IO */ }
    }, 10) : null;
    const agent = new http.Agent({ keepAlive: true });
    try {
        for (count = 0; count < 55; count++) {
            const started = performance.now();
            await new Promise((resolve, reject) => http.get({ hostname: '127.0.0.1', port: server.address().port, agent }, res => {
                let body = ''; res.on('data', data => { body += data; });
                res.on('end', () => { assert.equal(body, 'synthetic-response'); resolve(); });
            }).on('error', reject));
            if (count >= 5) clientTimes.push(performance.now() - started);
            await state.completion; // Excluded from V4 commit/client measurement.
        }
        assert.equal(commits.length, 50);
        assert.equal(mirror.snapshot().shadowErrors, 0);
        return { mode, set, warmup: 5, measured: 50, responseCommitMs: summary(commits),
            clientResponseMs: summary(clientTimes), shadowCompletionMs: enabled ? summary(completions) : null,
            fixtureExecutions, beforeEnd, beforeFinish };
    } finally {
        clearInterval(background); agent.destroy(); await new Promise(resolve => server.close(resolve));
    }
}
async function main() {
    const records = [];
    // Predeclared rotated blocks. D is compared both with A and matched A_LOAD.
    const orders = [['A', 'B', 'C', 'A_LOAD', 'D'], ['B', 'C', 'D', 'A', 'A_LOAD'], ['D', 'A_LOAD', 'A', 'C', 'B']];
    for (let set = 0; set < orders.length; set++) for (const mode of orders[set]) records.push(await measure(mode, set + 1));
    for (const record of records) {
        const baseline = records.find(r => r.set === record.set && r.mode === 'A');
        record.overheadPercent = Object.fromEntries(['median', 'p95'].map(k => [k, (record.responseCommitMs[k] / baseline.responseCommitMs[k] - 1) * 100]));
        if (record.mode === 'D') {
            const loaded = records.find(r => r.set === record.set && r.mode === 'A_LOAD');
            record.matchedLoadOverheadPercent = Object.fromEntries(['median', 'p95'].map(k => [k, (record.responseCommitMs[k] / loaded.responseCommitMs[k] - 1) * 100]));
        }
    }
    console.log(JSON.stringify({ node: process.version, platform: process.platform, records,
        realModelCalls: 0, realBusinessApiCalls: 0, realToolExecutions: 0, writes: 0 }));
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
