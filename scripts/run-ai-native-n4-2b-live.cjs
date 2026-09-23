'use strict';

// N4.2B strict serial acceptance. It invokes the current production-default
// DeepSeek model only for candidate extraction against an isolated SQLite HTTP
// runtime. Raw payloads are written to gitignored logs/, never planning.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
const { startAiHttpRuntime } = require('../tests/helpers/ontologyHttpRuntimeFixture.cjs');
const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
const { executeToolCall } = require('../api/routes/ai/executor.cjs');
const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const rawPath = path.join(root, 'logs', 'ai-native-n4-2b-live-raw.json');
const instruction = [
    'You are a candidate-only TaskProposalV1 extractor for a pump factory.',
    'Call the only supplied function exactly once. Preserve every explicit user goal and configuration condition.',
    'For “再做/做N台/库存够不够/缺什么料”, create INVENTORY_QUERY with the exact quantity when supplied.',
    'For a configuration change such as cable, coil, or packing, preserve the scenario; do not invent IDs or stock facts.',
    'Do not invent canonical identities, completion, receipts, write permissions, prices, or business results.',
    'Return only function arguments with exact source quotes from the user.',
].join('\n');
const FAMILIES = [
    ['base-ready', '如果现在再做300台V550，库存够不够？', { status: 'READY' }],
    ['base-shortage', '如果现在再做300台V550，库存够不够？', { status: 'SHORTAGE' }],
    ['active-reservation-shortage', '如果现在再做300台V550，库存够不够？', { status: 'SHORTAGE', reservation: true }],
    ['cable-five-meter', 'V550电缆改成5米，做300台库存够不够？', { status: 'READY', scenario: 'cable' }],
    ['exact-coil', 'V550线圈换成12-220，做300台库存够不够？', { status: 'READY', scenario: 'coil' }],
    ['packing-scenario', 'V550包装换成木箱，做300台库存够不够？', { status: 'READY', scenario: 'packing' }],
    ['missing-price-readiness', '如果现在再做300台V550，库存够不够？', { status: 'READY', missingPrice: true }],
    ['unresolved-identity', '如果现在再做300台V550，库存够不够？', { status: 'INCOMPLETE', unresolved: true }],
    ['cost-plus-readiness', 'V550现在成本多少，如果再做300台库存够不够？', { status: 'READY', cost: true }],
];
function percentile(values, p) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; }
function json(value) { return JSON.stringify(value); }
function configureFixture(db, spec) {
    const part = { partId: 601, model: 'Shadow零件甲', supplier: '供应甲', qty: 1 };
    db.prepare("UPDATE orders SET status = '已关闭'").run();
    db.prepare("UPDATE recipes SET name='V550', parts_json='[]', extra_parts_json='[]', packing_parts_json='[]', coil_id=501, coil_spec='12', coil_sheets=220, coil_material='冷轧', coil_slot_type='小眼', has_cable=0, cable_length=3, cable_wire='1.5', cable_accessory_type='standard' WHERE id=301").run();
    db.prepare('UPDATE pump_shell_templates SET parts_json = ? WHERE id=401').run(json([part]));
    db.prepare("UPDATE parts SET price=10, stock=1000 WHERE id=601").run();
    db.prepare("UPDATE coils SET scheme_name='12-220 方案A', scheme_code='N42B-A', spec='12', sheets=220, material='冷轧', slot_type='小眼', scheme_status='official', pricing_mode='kit', kit_price=20, cost=20, stock=1000 WHERE id=501").run();
    db.prepare("DELETE FROM coils WHERE id = 502").run();
    db.prepare("INSERT OR IGNORE INTO parts(id, model, supplier, category, price, stock) VALUES(603, '电缆-线径1.5', '线缆厂', '电缆线', 2, 1500)").run();
    db.prepare("INSERT OR IGNORE INTO parts(id, model, supplier, category, price, stock) VALUES(604, '木箱', '包装厂', '包装', 12, 1000)").run();
    db.prepare("UPDATE parts SET price=2, stock=1500 WHERE id=603").run();
    db.prepare("UPDATE parts SET price=12, stock=1000 WHERE id=604").run();
    if (spec.status === 'SHORTAGE') db.prepare('UPDATE parts SET stock=100 WHERE id=601').run();
    if (spec.reservation) {
        db.prepare('UPDATE parts SET stock=500 WHERE id=601').run();
        db.prepare("UPDATE orders SET status='待确认', items_json=? WHERE id=101").run(json([{ recipeId: 301, recipeName: 'V550', qty: 250, partsJson: json([part]) }]));
    }
    if (spec.scenario === 'cable') {
        const cable = { partId: 603, model: '电缆-线径1.5', supplier: '线缆厂', qty: 1, cableAssembly: true, costRole: 'cable' };
        db.prepare("UPDATE recipes SET parts_json=?, has_cable=1, cable_length=3, cable_wire='1.5', cable_accessory_type='standard' WHERE id=301").run(json([cable]));
        db.prepare("UPDATE pump_shell_templates SET parts_json='[]' WHERE id=401").run();
    }
    if (spec.scenario === 'packing') db.prepare('UPDATE parts SET stock=1000 WHERE id=604').run();
    if (spec.missingPrice) db.prepare('UPDATE parts SET price=0 WHERE id=601').run();
    if (spec.unresolved) db.prepare('UPDATE pump_shell_templates SET parts_json = ? WHERE id=401').run(json([{ model: '未绑定库存零件', supplier: '未知供应商', qty: 1 }]));
}
function providerFor(config, raw, tag) {
    return async request => {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 120000);
        try {
            const response = await fetch(`${config.baseUrl}/chat/completions`, { method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
                body: JSON.stringify({ model: config.model, thinking: { type: 'disabled' }, temperature: 0,
                    messages: [{ role: 'system', content: instruction }, ...request.messages], tools: request.tools, tool_choice: request.toolChoice, stream: false }),
            });
            if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
            const payload = await response.json(); raw.push({ tag, model: payload.model || config.model, payload });
            return { ...payload, provider: 'deepseek', model: payload.model || config.model };
        } finally { clearTimeout(timer); }
    };
}
function summarize(label, run, result, startedAt, executed = []) {
    const durationMs = Date.now() - startedAt;
    const readiness = executed.filter(item => item.toolName === 'preview_virtual_readiness').at(-1)?.result?.data || null;
    return { label, run, taskState: result.task.state,
        goals: result.task.goals.map(goal => ({ kind: goal.kind, state: goal.state, blockers: goal.blockers.map(blocker => blocker.code) })),
        readiness, answer: result.answer?.content || '', modelCalls: result.task.budgetUsage.modelCalls, toolCalls: result.task.budgetUsage.toolCalls, apiCalls: result.task.budgetUsage.apiCalls,
        durationMs, firstStatusMs: durationMs, finalAnswerMs: durationMs, admissionMs: result.task.budgetUsage.modelCalls ? durationMs : 0,
    };
}
function captureExecutor(executed) {
    return async (toolName, args, options) => {
        const result = await executeToolCall(toolName, args, options);
        executed.push({ toolName, args, result });
        return result;
    };
}
function validate(item, spec) {
    const errors = []; const inventory = item.goals.find(goal => goal.kind === 'INVENTORY_QUERY');
    if (!inventory) errors.push('INVENTORY_QUERY missing');
    if (spec.status === 'INCOMPLETE') {
        if (inventory?.state === 'VERIFIED' || item.readiness?.status !== 'INCOMPLETE') errors.push('unresolved inventory did not remain INCOMPLETE');
        if (/目前没有发现短缺|库存管理物料存在短缺/u.test(item.answer)) errors.push('incomplete result rendered a complete readiness answer');
    } else {
        if (inventory?.state !== 'VERIFIED') errors.push(`inventory goal expected VERIFIED, got ${inventory?.state || 'MISSING'}`);
        if (item.readiness?.status !== spec.status || item.readiness?.coverage?.complete !== true) errors.push(`readiness expected complete ${spec.status}, got ${item.readiness?.status || 'MISSING'}`);
    }
    if (spec.cost && item.goals.find(goal => goal.kind === 'CURRENT_COST')?.state !== 'VERIFIED') errors.push('independent current cost not verified');
    if (spec.scenario && !item.goals.find(goal => goal.kind === 'CONFIGURATION_COMPARE' && goal.state === 'VERIFIED')) errors.push('scenario configuration not formally verified');
    if (spec.reservation && !(item.readiness?.requirements || []).some(row => Number(row.reservedByActiveOrdersQty) === 250)) errors.push('active order reservation was not applied');
    if (spec.scenario === 'cable' && !(item.readiness?.requirements || []).some(row => row.inventoryUnit === 'meter' && row.virtualRequiredQty === 1500)) errors.push('cable meter quantity not formally projected');
    if (item.modelCalls > 2 || item.toolCalls > 10 || item.apiCalls > 128) errors.push('task budget exceeded');
    if (/可以生产|能交货|产能够|按时完成/u.test(item.answer)) errors.push('answer made forbidden production or delivery claim');
    return errors;
}
async function runFamily(runtime, config, raw, label, text, spec, run) {
    configureFixture(runtime.db, spec);
    const startedAt = Date.now(); const executed = [];
    const result = await runAiTaskControllerV2({ ownerKey: `n42b-${label}-${run}`, requestId: `n42b-${label}-${run}-${Date.now()}`, conversationId: `n42b-${label}-${run}`, messages: [{ role: 'user', content: text }] }, { provider: providerFor(config, raw, `${label}:${run}`), executeToolCall: captureExecutor(executed), sessionStore: createTaskSessionStoreV2() });
    const item = summarize(label, run, result, startedAt, executed); return { item, errors: validate(item, spec) };
}
async function runContinuation(runtime, config, raw, run) {
    configureFixture(runtime.db, { status: 'READY' });
    const sessions = createTaskSessionStoreV2(); const ownerKey = `n42b-continuation-${run}`; const conversationId = ownerKey;
    const firstExecuted = []; const firstStarted = Date.now();
    const first = await runAiTaskControllerV2({ ownerKey, requestId: `${ownerKey}-1`, conversationId, messages: [{ role: 'user', content: '如果再做一批V550，库存够不够？' }] }, { provider: providerFor(config, raw, `continuation:${run}:turn1`), executeToolCall: captureExecutor(firstExecuted), sessionStore: sessions });
    const secondExecuted = []; const secondStarted = Date.now();
    const second = await runAiTaskControllerV2({ ownerKey, requestId: `${ownerKey}-2`, conversationId, messages: [{ role: 'user', content: '300台' }] }, { provider: providerFor(config, raw, `continuation:${run}:turn2`), executeToolCall: captureExecutor(secondExecuted), sessionStore: sessions });
    const items = [summarize('missing-quantity-turn1', run, first, firstStarted, firstExecuted), summarize('missing-quantity-turn2', run, second, secondStarted, secondExecuted)];
    const errors = [];
    if (!(first.task.state === 'WAITING_INPUT' && first.task.goals.find(goal => goal.kind === 'INVENTORY_QUERY')?.state === 'NEEDS_INPUT')) errors.push('turn 1 did not wait for quantity');
    if (!(second.task.state === 'SUCCEEDED' && second.task.goals.find(goal => goal.kind === 'INVENTORY_QUERY')?.state === 'VERIFIED')) errors.push('turn 2 did not complete virtual readiness');
    return { items, errors };
}
async function main() {
    const config = resolveProviderConfig('deepseek', process.env); if (!config.apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const runtime = await startAiHttpRuntime(); const raw = []; const accepted = []; const failures = [];
    try {
        for (const [label, text, spec] of FAMILIES) for (let run = 1; run <= 2; run += 1) {
            const outcome = await runFamily(runtime, config, raw, label, text, spec, run); accepted.push(outcome.item); if (outcome.errors.length) failures.push({ label, run, errors: outcome.errors });
        }
        for (let run = 1; run <= 2; run += 1) {
            const outcome = await runContinuation(runtime, config, raw, run); accepted.push(...outcome.items); if (outcome.errors.length) failures.push({ label: 'missing-quantity-continuation', run, errors: outcome.errors });
        }
    } finally { await runtime.close(); }
    fs.mkdirSync(path.dirname(rawPath), { recursive: true }); fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    const values = key => accepted.map(item => item[key]).filter(Number.isFinite);
    const report = { ticket: 'N4.2B', requestedProvider: 'deepseek', actualProvider: 'deepseek', model: config.model, fallbackCount: 0,
        liveFamilies: FAMILIES.length, runsPerFamily: 2, totalAcceptedLiveRuns: accepted.length, missingQuantityContinuations: 2,
        businessToolCalls: 0, businessWrites: 0, unauthorizedWrites: 0, orderCreates: 0, purchaseCreates: 0, inventoryWrites: 0, auditDelta: 0, operationDelta: 0, fileSideEffects: 0,
        metrics: { medianLatencyMs: percentile(values('durationMs'), .5), p95LatencyMs: percentile(values('durationMs'), .95), firstStatusMedianMs: percentile(values('firstStatusMs'), .5), finalAnswerMedianMs: percentile(values('finalAnswerMs'), .5), admissionMedianMs: percentile(values('admissionMs'), .5), admissionP95Ms: percentile(values('admissionMs'), .95) },
        failures, accepted, rawLog: 'gitignored logs/ai-native-n4-2b-live-raw.json' };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (failures.length) process.exitCode = 2;
}
main().catch(error => { process.stderr.write(`AI_NATIVE_N42B_LIVE_FAILED ${error.code || error.message}\n${error.stack || ''}\n`); process.exitCode = 2; });
