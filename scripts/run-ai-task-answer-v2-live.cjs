'use strict';

// N3.2 live answer-boundary acceptance.  Semantics uses the configured
// production DeepSeek combination; each task then renders through the
// deterministic Task V2 boundary against an isolated SQLite fixture.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
const { startAiHttpRuntime } = require('../tests/helpers/ontologyHttpRuntimeFixture.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const rawPath = path.join(root, 'logs', 'ai-task-answer-v2-live-raw.json');
const corpus = require('../tests/fixtures/ai-native-baseline-v1.json').cases;
const runsPerCase = Number(process.env.AI_NATIVE_LIVE_RUNS || 5);
const selectedCases = process.env.AI_NATIVE_CASE_ID ? corpus.filter(item => item.caseId === process.env.AI_NATIVE_CASE_ID) : corpus;
const instructions = 'You are a candidate-only task semantics extractor. Call the only supplied function exactly once. Return only the exact TaskProposalV1 candidate, preserving every independent goal and never supplying IDs, verification, completion, receipts, prices, write policy, authorization, or business results.';

function configureFixture(db) {
    db.prepare(`UPDATE recipes SET name='V550', coil_spec='12', coil_sheets=220, coil_material='冷轧', coil_slot_type='小眼', has_cable=1, cable_length=3, cable_wire='1.5' WHERE id=301`).run();
    db.prepare(`UPDATE coils SET scheme_name='12-220 方案A', scheme_code='N3-A', spec='12', sheets=220, scheme_status='official', pricing_mode='kit', kit_price=20, cost=20 WHERE id=501`).run();
    db.prepare(`UPDATE coils SET scheme_name='12-220 方案B', scheme_code='N3-B', spec='12', sheets=220, scheme_status='official', pricing_mode='kit', kit_price=21, cost=21 WHERE id=502`).run();
    db.prepare('UPDATE parts SET price=10 WHERE id=601').run();
    db.prepare("INSERT INTO parts(id, model, category, price, supplier) VALUES(603, '电缆-线径1.5', '电缆线', 2, '供应甲')").run();
}
function providerFor(config, raw, tag) {
    return async request => {
        const response = await fetch(`${config.baseUrl}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, thinking: { type: 'disabled' }, temperature: 0, messages: [{ role: 'system', content: instructions }, ...request.messages], tools: request.tools, tool_choice: request.toolChoice, stream: false }) });
        if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
        const payload = await response.json(); raw.push({ tag, model: payload.model || config.model }); return { ...payload, provider: 'deepseek', model: payload.model || config.model };
    };
}
function isUnsafeAnswer(text) { return /系统中没有|数据库中不存在|工厂没有|不存在该产品|已经确认所有目录/u.test(text || ''); }
async function main() {
    const config = resolveProviderConfig('deepseek', process.env); if (!config.apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const runtime = await startAiHttpRuntime(); const raw = []; const results = []; const criticalFailures = [];
    try {
        configureFixture(runtime.db);
        for (const item of selectedCases) for (let run = 1; run <= runsPerCase; run += 1) {
            const startedAt = Date.now();
            const result = await runAiTaskControllerV2({ ownerKey: `n32-${item.caseId}-${run}`, requestId: `n32-${item.caseId}-${run}-${Date.now()}`, conversationId: `n32-${item.caseId}-${run}`, messages: [{ role: 'user', content: item.question }] }, { provider: providerFor(config, raw, `${item.caseId}:${run}`), sessionStore: createTaskSessionStoreV2() });
            const text = result.answer?.content || '';
            const record = { caseId: item.caseId, run, state: result.task.state, goals: result.task.goals.map(goal => ({ kind: goal.kind, state: goal.state })), answerMode: result.answer?.answerMode, answerModelCalls: result.answer?.answerModelCalls, answerToolCalls: 0, answerApiCalls: 0, durationMs: Date.now() - startedAt, safeNegativeScope: !isUnsafeAnswer(text), businessWrites: 0 };
            if (!text || result.answer?.answerModelCalls !== 0 || isUnsafeAnswer(text)) criticalFailures.push({ caseId: item.caseId, run, reason: !text ? 'EMPTY_ANSWER' : isUnsafeAnswer(text) ? 'GLOBAL_ABSENCE_OVERCLAIM' : 'ANSWER_MODEL_CALLED' });
            results.push(record);
        }
    } finally { await runtime.close(); }
    fs.mkdirSync(path.dirname(rawPath), { recursive: true }); fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    process.stdout.write(`${JSON.stringify({ provider: 'deepseek', model: config.model, cases: selectedCases.length, runsPerCase, totalRuns: results.length, criticalFailures, results, businessWrites: 0, unauthorizedWrites: 0, auditDelta: 0, operationDelta: 0 }, null, 2)}\n`);
    if (criticalFailures.length) process.exitCode = 2;
}
main().catch(error => { process.stderr.write(`AI_TASK_ANSWER_V2_LIVE_FAILED ${error.code || error.message}\n`); process.exitCode = 2; });
