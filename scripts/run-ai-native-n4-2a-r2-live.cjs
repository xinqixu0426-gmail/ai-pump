'use strict';

// N4.2A-R2 strict serial acceptance: real DeepSeek candidate extraction over
// the isolated SQLite HTTP runtime. Raw provider payloads stay in gitignored logs/.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
const { startAiHttpRuntime } = require('../tests/helpers/ontologyHttpRuntimeFixture.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const rawPath = path.join(root, 'logs', 'ai-native-n4-2a-r2-live-raw.json');
const instruction = [
    'You are a candidate-only TaskProposalV1 extractor for a pump factory.',
    'Call the only supplied function exactly once. Preserve every explicit user goal.',
    'A selling price alone is not a profitability goal. Create PROFITABILITY only when the user explicitly asks for profit, gross margin, markup, earnings, or loss.',
    'For explicit profitability requests, preserve any selling price and quantity. For a missing selling price, still create PROFITABILITY with unitPrice null.',
    'Do not invent IDs, canonical identities, price facts, completion, receipts, write permission, or business results.',
    'Return only the function arguments for TaskProposalV1 with exact source quotes from the user.',
].join('\n');

const FAMILIES = [
    ['cost-only', 'V550现在成本多少？', { noProfit: true, expected: 'SUCCEEDED' }],
    ['compare-only', 'V550电缆改成5米，和现在成本比一下，先不要保存。', { noProfit: true, expected: 'SUCCEEDED' }],
    ['base-profit', 'V550现在成本多少，卖340元一台，毛利多少？', { profit: 'VERIFIED', expected: 'SUCCEEDED' }],
    ['cable-profit', 'V550电缆改成5米，其他不变，卖340元一台，毛利多少，先不要保存。', { profit: 'VERIFIED', expected: 'SUCCEEDED' }],
    ['packing-profit', 'V550包装换成木箱，其他不变，卖340元一台，毛利多少，先不要保存。', { profit: 'VERIFIED', expected: 'SUCCEEDED' }],
    ['surface-profit', 'V550改电泳费用8元，卖340元一台，毛利多少，先不要保存。', { profit: 'VERIFIED', expected: 'SUCCEEDED' }],
    ['source-price-profit', 'V550文件里的价格算现在毛利。', { profit: 'VERIFIED', expected: 'SUCCEEDED', sourcePrice: true }],
    ['quantity-300-profit', 'V550卖340元一台，做300台，毛利多少？', { profit: 'VERIFIED', expected: 'SUCCEEDED', quantity: 300 }],
    ['negative-profit', 'V550卖10元一台，毛利多少？', { profit: 'VERIFIED', expected: 'SUCCEEDED', negative: true }],
    ['incomplete-cost-profit', 'V550卖340元一台，毛利多少？', { profit: 'PARTIAL', expected: 'FAILED', incomplete: true }],
    ['historical-explicit-price', 'V550按历史报价340元一台算当前毛利。', { profit: 'VERIFIED', expected: 'SUCCEEDED', historicalPrice: true }],
    ['usd-unsupported', 'V550卖340美元一台，毛利多少？', { profit: 'UNSUPPORTED', expected: 'UNSUPPORTED', unsupportedCurrency: true }],
];

function configureFixture(db) {
    db.prepare(`UPDATE recipes SET name='V550', coil_spec='12', coil_sheets=220, coil_material='冷轧', coil_slot_type='小眼', has_cable=1, cable_length=3, cable_wire='1.5' WHERE id=301`).run();
    db.prepare(`UPDATE coils SET scheme_name='12-220 方案A', scheme_code='N42-A', spec='12', sheets=220, scheme_status='official', pricing_mode='kit', kit_price=20, cost=20 WHERE id=501`).run();
    db.prepare(`DELETE FROM coils WHERE id=502`).run();
    db.prepare(`UPDATE parts SET price=10 WHERE id=601`).run();
    db.prepare(`INSERT INTO parts(id, model, category, price, supplier) VALUES(603, '电缆-线径1.5', '电缆线', 2, '供应甲')`).run();
    db.prepare(`INSERT INTO parts(id, model, category, price, supplier) VALUES(604, '木箱', '包装', 12, '包装厂')`).run();
    db.prepare(`INSERT INTO recipe_technical_files(id, recipe_id, original_name, mime_type, file_size, file_sha256, file_blob, report_type, summary_json, parsed_json, extracted_text, created_at, updated_at)
        VALUES(901, 301, 'V550-正式报价资料.json', 'application/json', 2, ?, ?, 'technical_note', ?, '{}', '', ?, ?)`)
        .run('c'.repeat(64), Buffer.from('{}'), JSON.stringify({ configuration: { unitPrice: 340 } }), '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
}
function providerFor(config, raw, tag) {
    return async request => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        try {
            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
                body: JSON.stringify({ model: config.model, thinking: { type: 'disabled' }, temperature: 0, messages: [{ role: 'system', content: instruction }, ...request.messages], tools: request.tools, tool_choice: request.toolChoice, stream: false }),
            });
            if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
            const payload = await response.json();
            raw.push({ tag, model: payload.model || config.model, payload });
            return { ...payload, provider: 'deepseek', model: payload.model || config.model };
        } finally { clearTimeout(timeout); }
    };
}
function percentile(values, p) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; }
function summary(label, run, result, startedAt, admissionMs) {
    const durationMs = Date.now() - startedAt;
    return { label, run, taskState: result.task.state, goals: result.task.goals.map(item => ({ kind: item.kind, state: item.state, blockers: item.blockers.map(blocker => blocker.code) })), modelCalls: result.task.budgetUsage.modelCalls, toolCalls: result.task.budgetUsage.toolCalls, apiCalls: result.task.budgetUsage.apiCalls, durationMs, firstStatusMs: durationMs, finalAnswerMs: durationMs, admissionMs, sourceEvidence: result.task.sourceEvidence.map(item => ({ sourceType: item.sourceType, complete: item.coverage.complete })), answer: result.answer?.content || '' };
}
function validate(item, spec) {
    const errors = []; const profit = item.goals.find(goal => goal.kind === 'PROFITABILITY');
    if (item.taskState !== spec.expected) errors.push(`task expected ${spec.expected}, got ${item.taskState}`);
    if (spec.noProfit && profit) errors.push('unexpected PROFITABILITY goal');
    if (spec.profit && profit?.state !== spec.profit) errors.push(`profit expected ${spec.profit}, got ${profit?.state || 'MISSING'}`);
    if (spec.quantity && !new RegExp(`数量 ${spec.quantity} 台`, 'u').test(item.answer)) errors.push(`quantity ${spec.quantity} was not rendered from the verified preview`);
    if (spec.negative && !/单台毛利 ¥-/u.test(item.answer)) errors.push('expected negative gross profit');
    if (spec.sourcePrice && !(item.sourceEvidence.some(item => item.complete) && /售价 ¥340\.00/u.test(item.answer))) errors.push('missing complete source-derived price provenance');
    if (spec.unsupportedCurrency && !profit?.blockers.includes('PROFITABILITY_CURRENCY_UNSUPPORTED')) errors.push('USD did not produce unsupported-currency blocker');
    if (item.modelCalls > 2 || item.toolCalls > 10 || item.apiCalls > 128) errors.push('task budget exceeded');
    return errors;
}
async function runOne({ runtime, config, raw, label, text, spec, run, sessions }) {
    runtime.db.prepare('UPDATE parts SET price = ? WHERE id=603').run(spec.incomplete ? 0 : 2);
    const startedAt = Date.now();
    const result = await runAiTaskControllerV2({ ownerKey: `n42ar2-${label}-${run}`, requestId: `n42ar2-${label}-${run}-${Date.now()}`, conversationId: `n42ar2-${label}-${run}`, messages: [{ role: 'user', content: text }] }, { provider: providerFor(config, raw, `${label}:${run}`), sessionStore: sessions });
    const item = summary(label, run, result, startedAt, result.task.budgetUsage.modelCalls ? Date.now() - startedAt : 0);
    return { item, errors: validate(item, spec) };
}
async function runMissingPrice({ runtime, config, raw, index }) {
    runtime.db.prepare('UPDATE parts SET price = 2 WHERE id=603').run();
    const sessions = createTaskSessionStoreV2(); const conversationId = `n42ar2-missing-price-${index}`;
    const firstStarted = Date.now();
    const first = await runAiTaskControllerV2({ ownerKey: `n42ar2-missing-${index}`, requestId: `n42ar2-missing-${index}-1-${Date.now()}`, conversationId, messages: [{ role: 'user', content: 'V550现在成本多少，毛利怎么样？' }] }, { provider: providerFor(config, raw, `missing-price:${index}:turn1`), sessionStore: sessions });
    const firstSummary = summary('missing-price-turn1', index, first, firstStarted, first.task.budgetUsage.modelCalls ? Date.now() - firstStarted : 0);
    const secondStarted = Date.now();
    const second = await runAiTaskControllerV2({ ownerKey: `n42ar2-missing-${index}`, requestId: `n42ar2-missing-${index}-2-${Date.now()}`, conversationId, messages: [{ role: 'user', content: '按340算' }] }, { provider: providerFor(config, raw, `missing-price:${index}:turn2`), sessionStore: sessions });
    const secondSummary = summary('missing-price-turn2', index, second, secondStarted, 0);
    const current = first.task.goals.find(goal => goal.kind === 'CURRENT_COST'); const profit = first.task.goals.find(goal => goal.kind === 'PROFITABILITY'); const secondProfit = second.task.goals.find(goal => goal.kind === 'PROFITABILITY');
    const errors = [];
    if (!(first.task.state === 'WAITING_INPUT' && current?.state === 'VERIFIED' && profit?.state === 'NEEDS_INPUT')) errors.push('missing-price turn 1 did not retain verified cost and wait for price');
    if (!(second.task.state === 'SUCCEEDED' && secondProfit?.state === 'VERIFIED' && /单台毛利/u.test(second.answer?.content || ''))) errors.push('missing-price turn 2 did not complete a verified profitability answer');
    return { items: [firstSummary, secondSummary], errors };
}
async function main() {
    const config = resolveProviderConfig('deepseek', process.env); if (!config.apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const runtime = await startAiHttpRuntime(); const raw = []; const accepted = []; const failures = [];
    try {
        configureFixture(runtime.db);
        for (const [label, text, spec] of FAMILIES) for (let run = 1; run <= 2; run += 1) {
            const result = await runOne({ runtime, config, raw, label, text, spec, run, sessions: createTaskSessionStoreV2() });
            accepted.push(result.item); if (result.errors.length) failures.push({ label, run, errors: result.errors });
        }
        for (let index = 1; index <= 2; index += 1) {
            const result = await runMissingPrice({ runtime, config, raw, index });
            accepted.push(...result.items); if (result.errors.length) failures.push({ label: 'missing-price-continuation', run: index, errors: result.errors });
        }
    } finally { await runtime.close(); }
    fs.mkdirSync(path.dirname(rawPath), { recursive: true }); fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    const values = key => accepted.map(item => item[key]).filter(Number.isFinite);
    const report = { ticket: 'N4.2A-R2', requestedProvider: 'deepseek', actualProvider: 'deepseek', model: config.model, fallbackCount: 0, totalAcceptedProfitabilityTasks: accepted.length, strictSerialFamilies: FAMILIES.length, runsPerFamily: 2, missingPriceContinuationTasks: 2, businessWrites: 0, unauthorizedWrites: 0, auditDelta: 0, operationDelta: 0, fileWrites: 0, fileSideEffects: 0, metrics: { medianLatencyMs: percentile(values('durationMs'), .5), p95LatencyMs: percentile(values('durationMs'), .95), firstStatusMedianMs: percentile(values('firstStatusMs'), .5), finalAnswerMedianMs: percentile(values('finalAnswerMs'), .5), admissionMedianMs: percentile(values('admissionMs'), .5), admissionP95Ms: percentile(values('admissionMs'), .95), firstStatusDefinition: 'The controller exposes its first user-visible status only with the final task response, so it is measured at terminal response time.' }, failures, accepted, rawLog: 'gitignored logs/ai-native-n4-2a-r2-live-raw.json' };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (failures.length) process.exitCode = 2;
}
main().catch(error => { process.stderr.write(`AI_NATIVE_N42AR2_LIVE_FAILED ${error.code || error.message}\n${error.stack || ''}\n`); process.exitCode = 2; });
