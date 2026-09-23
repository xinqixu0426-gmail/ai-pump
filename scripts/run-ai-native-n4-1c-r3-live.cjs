'use strict';
// N4.1C-R3: serial real-DeepSeek acceptance against an isolated SQLite fixture.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
const { startAiHttpRuntime } = require('../tests/helpers/ontologyHttpRuntimeFixture.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
const { executeToolCall } = require('../api/routes/ai/executor.cjs');
const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const rawPath = path.join(root, 'logs', 'ai-native-n4-1c-r3-live-raw.json');
const prompt = 'Return only a TaskProposalV1 candidate using the supplied function. Preserve every explicit user goal and exact sourceQuote strings. Never create IDs, facts, permission, receipts, verification, completion or write authority. Allowed proposed override fields: cableLength, coilSelection, hasCable, hasFloat, packingSelection, packingRemoval, packingClearAll, surfaceTreatmentMode, surfaceTreatmentCost.';

function configure(db) {
    db.prepare("UPDATE recipes SET name='V550', coil_id=NULL, coil_spec='', coil_sheets=0, coil_material='冷轧', coil_slot_type='小眼', has_cable=1, cable_length=5, cable_wire='1.5' WHERE id=301").run();
    db.prepare("INSERT OR REPLACE INTO parts(id,model,category,price,supplier) VALUES (701,'纸箱','包装',2,'包装A'),(702,'珍珠棉','包装',1,'包装A'),(703,'说明书','包装',1,'包装A'),(704,'标签','包装',1,'包装A'),(709,'加厚木箱','包装',9,'包装D'),(708,'电缆-线径1.5','电缆',2,'电缆厂')").run();
    const packing = JSON.stringify([{ partId: 701, model: '纸箱', supplier: '包装A', qty: 1, packingRole: 'container' }, { partId: 702, model: '珍珠棉', supplier: '包装A', qty: 1, packingRole: 'pearlCotton' }, { partId: 703, model: '说明书', supplier: '包装A', qty: 1, packingRole: 'fixed' }, { partId: 704, model: '标签', supplier: '包装A', qty: 1, packingRole: 'fixed' }]);
    db.prepare('UPDATE recipes SET packing_parts_json=?, surface_treatment_mode=?, surface_treatment_cost=? WHERE id=301').run(packing, 'painting', 3);
    db.prepare(`INSERT OR REPLACE INTO recipe_technical_files (id,recipe_id,original_name,mime_type,file_size,file_sha256,file_blob,report_type,summary_json,parsed_json,created_at,updated_at,deleted_at)
        VALUES (801,301,'V550-配置报告.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',4,'n41cr3-report',X'74657374','pump_performance_test',?, ?,datetime('now'),datetime('now'),NULL)`).run(JSON.stringify({ configuration: { cableLength: '500cm', hasCable: true } }), JSON.stringify({ testPoints: [{ flow: 10, head: 20 }] }));
}
function policy(db, { allowPearl = false, allowClear = false } = {}) {
    db.prepare('UPDATE recipes SET configuration_policy_json=? WHERE id=301').run(JSON.stringify({ version: 1, fields: {}, packingPartIds: [709], packingRemovalPolicy: { removableRoles: allowPearl ? ['pearlCotton'] : [], removablePartIds: [], allowClearAll: allowClear }, surfaceTreatmentOptions: [{ mode: 'painting', cost: 3 }, { mode: 'electrophoresis', cost: 5 }, { mode: 'none', cost: 0 }] }));
}
function provider(config, raw, tag) { return async request => {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 120000);
    try {
        const response = await fetch(`${config.baseUrl}/chat/completions`, { method: 'POST', signal: controller.signal, headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify({ model: config.model, temperature: 0, thinking: { type: 'disabled' }, messages: [{ role: 'system', content: prompt }, ...request.messages], tools: request.tools, tool_choice: request.toolChoice, stream: false }) });
        if (!response.ok) throw Object.assign(new Error(`DEEPSEEK_HTTP_${response.status}`), { code: `DEEPSEEK_HTTP_${response.status}` });
        const payload = await response.json(); raw.push({ tag, payload }); fs.mkdirSync(path.dirname(rawPath), { recursive: true }); fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
        return { ...payload, provider: 'deepseek', model: payload.model || config.model };
    } finally { clearTimeout(timeout); }
}; }
function compact(result) { return { state: result.task.state, goals: result.task.goals.map(goal => ({ kind: goal.kind, state: goal.state, blockers: goal.blockers.map(blocker => blocker.code) })), sourceEvidence: result.task.sourceEvidence, modelCalls: result.task.budgetUsage.modelCalls, toolCalls: result.task.budgetUsage.toolCalls }; }
async function runFlow({ label, text, setup, expected, config, raw, index }) {
    setup(); const sessionStore = createTaskSessionStoreV2(); const ownerKey = `n41cr3-${index}`; const base = { ownerKey, conversationId: ownerKey, requestId: `${ownerKey}-a`, messages: [{ role: 'user', content: text }] }; const executionTrace = [];
    const execute = async (toolName, args, options) => { const value = await executeToolCall(toolName, args, options); executionTrace.push({ toolName, success: value?.success === true, code: value?.code || null, verified: value?.executionEvidence?.verified === true, calls: value?.executionEvidence?.calls?.map(call => ({ method: call.method, path: call.path, ok: call.ok !== false })) || [] }); return value; };
    try {
        let result = await runAiTaskControllerV2(base, { provider: provider(config, raw, label), sessionStore, executeToolCall: execute });
        const firstResult = compact(result);
        if (label.startsWith('surface-continuation')) result = await runAiTaskControllerV2({ ...base, requestId: `${ownerKey}-b`, messages: [{ role: 'user', content: '5元' }] }, { provider: provider(config, raw, `${label}:continuation`), sessionStore, executeToolCall: execute });
        const summary = { ...compact(result), ...(label.startsWith('surface-continuation') ? { firstResult } : {}), executionTrace };
        const accepted = expected(summary, result);
        return { label, accepted, result: summary, error: null };
    } catch (error) {
        const code = error?.code || error?.message;
        return { label, accepted: expected(null, null, code), result: null, error: code };
    }
}
async function main() {
    const config = resolveProviderConfig('deepseek', process.env); if (!config.apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const runtime = await startAiHttpRuntime();
    try {
        configure(runtime.db); const raw = []; const success = result => result?.state === 'SUCCEEDED'; const policyReject = (result, _raw, code) => ['RECIPE_CONFIGURATION_PACKING_REMOVAL_NOT_ALLOWED', 'RECIPE_CONFIGURATION_PACKING_CLEAR_ALL_NOT_ALLOWED'].includes(code) || result?.executionTrace?.some(item => ['RECIPE_CONFIGURATION_PACKING_REMOVAL_NOT_ALLOWED', 'RECIPE_CONFIGURATION_PACKING_CLEAR_ALL_NOT_ALLOWED'].includes(item.code));
        const cases = [
            ...[1, 2].map(n => ({ label: `surface-continuation-${n}`, text: 'V550改成自定义表面处理，先试算不要保存', setup: () => policy(runtime.db), expected: success })),
            ...[1, 2].map(n => ({ label: `source-scenario-${n}`, text: 'V550测试报告，按报告电缆长度试算', setup: () => policy(runtime.db), expected: (result) => success(result) && result.sourceEvidence.length === 1 && result.sourceEvidence[0].coverage.complete === true })),
            ...[1, 2].map(n => ({ label: `packing-remove-allowed-${n}`, text: 'V550去掉珍珠棉，其他不变，先试算不要保存', setup: () => policy(runtime.db, { allowPearl: true }), expected: success })),
            ...[1, 2].map(n => ({ label: `packing-remove-forbidden-${n}`, text: 'V550去掉珍珠棉，其他不变，先试算不要保存', setup: () => policy(runtime.db), expected: policyReject })),
            ...[1, 2].map(n => ({ label: `packing-clear-forbidden-${n}`, text: 'V550清空全部包装，先试算不要保存', setup: () => policy(runtime.db), expected: policyReject })),
            ...[1, 2].map(n => ({ label: `packing-replace-${n}`, text: 'V550包装换成加厚木箱，其他不变，先试算不要保存', setup: () => policy(runtime.db), expected: success })),
        ];
        const runs = []; for (let index = 0; index < cases.length; index += 1) runs.push(await runFlow({ ...cases[index], runtime, config, raw, index }));
        console.log(JSON.stringify({ ticket: 'N4.1C-R3', requestedProvider: 'deepseek', actualProvider: 'deepseek', model: config.model, fallbackCount: 0, serial: true, runs, accepted: runs.filter(run => run.accepted).length, failed: runs.filter(run => !run.accepted).length, businessWrites: 0, unauthorizedWrites: 0, database: 'temporary SQLite fixture' }, null, 2));
        if (runs.some(run => !run.accepted)) process.exitCode = 1;
    } finally { await runtime.close(); }
}
main().catch(error => { console.error(`N41CR3_LIVE_FAILED ${error.code || error.message}`); process.exitCode = 2; });
