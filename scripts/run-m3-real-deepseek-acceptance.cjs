'use strict';

// Operational evidence runner for M3-5. It targets an already started
// isolated API and never calls the confirmation endpoint. The report excludes
// tokens, internal IDs, tool arguments, and business values.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
require('dotenv').config({ quiet: true });

const root = path.join(__dirname, '..');
const baseUrl = String(process.env.AI_M3_ACCEPTANCE_BASE_URL || 'http://127.0.0.1:3302').replace(/\/$/, '');
const reportPath = path.join(root, 'output', 'm3-technical-acceptance', 'latest.json');
const { issueOwnerToken } = require('../api/services/ownerAuthentication.cjs');

function percentile(values, ratio) {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}
function parseSse(body) {
    return body.split('\n').filter(line => line.startsWith('data: ')).flatMap(line => {
        try { return [JSON.parse(line.slice(6))]; } catch { return []; }
    });
}
function safeMetrics(metrics = {}) {
    return {
        routeClass: metrics.routeClass || null,
        judgeUsed: metrics.judgeUsed === true,
        judgeModelCalls: Number(metrics.judgeModelCalls ?? (metrics.judgeUsed ? 1 : 0)),
        mainModelCalls: Number(metrics.mainModelCalls ?? 0),
        toolCallCount: Number(metrics.toolCallCount ?? 0),
        totalLatencyMs: Number(metrics.durationMs ?? metrics.timings?.totalLatencyMs ?? 0),
        timings: Object.fromEntries(Object.entries(metrics.timings || {}).map(([name, value]) => [name, Number(value) || 0])),
    };
}
async function main() {
    const token = issueOwnerToken(process.env.PUMP_OWNER_ACCESS_PASSWORD, process.env);
    if (!token) throw new Error('Owner runtime credentials are unavailable; cannot run the authenticated technical acceptance.');
    const sourceDb = process.env.PUMP_TEST_DATABASE_PATH || path.join(root, 'pump.db');
    const db = new Database(sourceDb, { readonly: true });
    const pageRecipe = db.prepare('SELECT id, name FROM recipes WHERE deleted_at IS NULL ORDER BY id LIMIT 1').get() || null;
    db.close();
    const results = [];
    const chats = new Map();
    async function ask(id, input, options = {}) {
        const conversation = chats.get(options.conversation || id) || [];
        const messages = [...conversation, { role: 'user', content: input }];
        const startedAt = Date.now();
        const response = await fetch(`${baseUrl}/api/ai/chat`, {
            method: 'POST', signal: AbortSignal.timeout(180_000),
            headers: { 'content-type': 'application/json', cookie: `token=${token}` },
            body: JSON.stringify({ messages, ...(options.pageContext ? { pageContext: options.pageContext } : {}) }),
        });
        const events = parseSse(await response.text());
        const content = events.filter(event => event.type === 'content').map(event => String(event.content || '')).join('');
        const referenceEntities = events.find(event => event.type === 'reference_context')?.entities || [];
        const metrics = safeMetrics(events.find(event => event.type === 'metrics'));
        const errors = events.filter(event => event.type === 'error').map(event => String(event.code || 'AI_ASSISTANT_FAILED'));
        const proposal = events.some(event => event.type === 'write_proposal');
        const done = events.some(event => event.type === 'done');
        const goalStatuses = Array.isArray(events.find(event => event.type === 'metrics')?.goalStatuses)
            ? events.find(event => event.type === 'metrics').goalStatuses : [];
        const result = {
            id, type: options.type || 'REAL_MODEL', httpStatus: response.status, done,
            errors, proposal, answerLength: content.length, referenceEntityCount: Array.isArray(referenceEntities) ? referenceEntities.length : 0,
            latencyMs: Date.now() - startedAt, metrics,
            statusEvents: events.filter(event => event.type === 'status').map(event => String(event.status || '')).slice(0, 8),
            outcome: response.ok && done && errors.length === 0 && content.length > 0 && !proposal
                ? (goalStatuses.some(status => ['PARTIAL', 'UNAVAILABLE', 'CLARIFICATION'].includes(status)) ? 'PARTIAL' : 'SUPPORTED')
                : 'PROVIDER_FAILURE',
        };
        results.push(result);
        chats.set(options.conversation || id, [...messages, { role: 'assistant', content, referenceEntities }]);
        console.log(JSON.stringify({ id, outcome: result.outcome, routeClass: metrics.routeClass, judgeUsed: metrics.judgeUsed, latencyMs: result.latencyMs, errors, proposal }));
        return result;
    }

    await ask('R-01', 'V550现在成本多少？');
    await ask('R-02', 'V550现在成本多少？顺便看看12-120还有多少库存。');
    await ask('R-03', 'V750按现在配置卖360，毛利多少？');
    await ask('R-04', '如果O型圈-110*2.65库存增加10，会变成多少？先不要保存。');
    await ask('R-05', '查一下最近5个订单。');
    await ask('R-06', 'V550的技术参数是什么？');
    await ask('R-07', 'V550现在成本多少？', { conversation: 'reference-cost' });
    await ask('R-08', '那V750呢？', { conversation: 'reference-cost' });
    await ask('R-09', '这两个差多少？', { conversation: 'reference-cost' });
    if (pageRecipe) await ask('M35-R10', '这个配方有哪些零件？', {
        pageContext: { resourceType: 'recipe', resourceId: pageRecipe.id, path: `/recipes/${pageRecipe.id}`, view: 'detail' },
    });
    await ask('M35-R11', '最近有哪些报价？');
    await ask('M35-R12', '最近有哪些业务变更？');

    const groups = results.reduce((all, result) => {
        const routeClass = result.metrics.routeClass || 'GENERAL';
        (all[routeClass] ||= []).push(result);
        return all;
    }, Object.create(null));
    const benchmark = Object.fromEntries(Object.entries(groups).map(([routeClass, items]) => {
        const latencies = items.map(item => item.metrics.totalLatencyMs || item.latencyMs).filter(value => value > 0);
        return [routeClass, {
            count: items.length, medianMs: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95),
            judgeCallsMedian: percentile(items.map(item => item.metrics.judgeModelCalls), 0.5),
            mainCallsMedian: percentile(items.map(item => item.metrics.mainModelCalls), 0.5),
            toolCallsMedian: percentile(items.map(item => item.metrics.toolCallCount), 0.5),
        }];
    }));
    const report = {
        schemaVersion: 1, generatedAt: new Date().toISOString(), isolated: true, productionUpdated: false,
        total: results.length, supported: results.filter(item => item.outcome === 'SUPPORTED').length,
        providerFailures: results.filter(item => item.outcome === 'PROVIDER_FAILURE').length,
        benchmark, results,
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ status: report.providerFailures === 0 ? 'PASS' : 'FAIL', reportPath, total: report.total, supported: report.supported, benchmark }, null, 2));
    if (report.providerFailures) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
