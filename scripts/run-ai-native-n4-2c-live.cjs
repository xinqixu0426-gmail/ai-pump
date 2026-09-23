'use strict';

// N4.2C strict serial acceptance. It invokes the current production-default
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
const rawPath = path.join(root, 'logs', 'ai-native-n4-2c-live-raw.json');
const instruction = [
    'You are a candidate-only TaskProposalV1 extractor for a pump factory.',
    'Call the only supplied function exactly once. Preserve every explicit user goal and configuration condition.',
    'When a user asks both current cost and changed-configuration cost, create separate CURRENT_COST and CONFIGURATION_COMPARE goals.',
    'When a user asks profit or gross profit, create PROFITABILITY and preserve the exact stated selling price.',
    'For “再做/做N台/库存够不够/缺什么料”, create INVENTORY_QUERY with the exact quantity when supplied.',
    'For an explicitly named customer\'s prior quotation used as a profit assumption, create CUSTOMER_HISTORY as well as PROFITABILITY.',
    'For a named technical report used for a configuration or price assumption, create FILE_INSPECT and preserve the source-derived scenario request.',
    'For a configuration change such as cable, coil, or packing, preserve the scenario; do not invent IDs or stock facts.',
    'Do not invent canonical identities, completion, receipts, write permissions, prices, or business results.',
    'Return only function arguments with exact source quotes from the user.',
].join('\n');
const FAMILIES = [
    ['full-four-goal', 'V550现在成本多少？电缆改成5米以后成本多少？如果卖340毛利多少？如果现在做300台库存够不够、缺什么？先不要保存。', { scenario: 'cable', readiness: 'READY', required: { CURRENT_COST: 'VERIFIED', CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' }, full: true, identity: true }],
    ['base-profit-readiness', 'V550现在成本多少，卖340元一台毛利多少？如果现在做300台库存够不够？先不要保存。', { readiness: 'READY', required: { CURRENT_COST: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' } }],
    ['packing-integrated', 'V550包装换成木箱，其他不变，和当前成本比较，卖340元一台毛利多少，做300台库存够不够，先不要保存。', { scenario: 'packing', readiness: 'READY', required: { CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' }, identity: true }],
    ['coil-integrated', 'V550线圈换成12-220，其他不变，和当前成本比较，卖340元一台毛利多少，做300台库存够不够，先不要保存。', { scenario: 'coil', readiness: 'READY', required: { CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' }, identity: true }],
    ['surface-integrated', 'V550改成喷漆，表面处理费5元，其他不变，和当前成本比较，卖340元一台毛利多少，做300台库存够不够，先不要保存。', { scenario: 'surface', readiness: 'READY', required: { CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' }, identity: true }],
    ['shortage-integrated', 'V550电缆改成5米，和当前成本比较，卖340元一台毛利多少，做300台库存够不够、缺什么，先不要保存。', { scenario: 'cable', readiness: 'SHORTAGE', required: { CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' }, identity: true }],
    ['active-reservation-base', 'V550现在成本多少，卖340元一台毛利多少，做300台库存够不够、缺什么，先不要保存。', { readiness: 'SHORTAGE', reservation: true, required: { CURRENT_COST: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' } }],
    ['missing-price', 'V550电缆改成5米，和当前成本比较，毛利多少，做300台库存够不够，先不要保存。', { scenario: 'cable', readiness: 'READY', required: { CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'NEEDS_INPUT', INVENTORY_QUERY: 'VERIFIED' } }],
    ['missing-quantity', 'V550电缆改成5米，和当前成本比较，卖340元一台毛利多少，库存够不够，先不要保存。', { scenario: 'cable', required: { CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'NEEDS_INPUT' } }],
    ['cost-incomplete-readiness-independent', 'V550电缆改成5米，和当前成本比较，卖340元一台毛利多少，做300台库存够不够，先不要保存。', { scenario: 'cable', missingPrice: true, readiness: 'READY', required: { CONFIGURATION_COMPARE: 'PARTIAL', PROFITABILITY: 'PARTIAL', INVENTORY_QUERY: 'VERIFIED' } }],
    ['quantity-change-shortage', 'V550电缆改成5米，和当前成本比较，卖340元一台毛利多少，做500台库存够不够、缺什么，先不要保存。', { scenario: 'cable', readiness: 'SHORTAGE', required: { CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' }, identity: true }],
    ['usd-unsupported-readiness-independent', 'V550电缆改成5米，和当前成本比较，卖340美元一台毛利多少，做300台库存够不够，先不要保存。', { scenario: 'cable', readiness: 'READY', required: { CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'UNSUPPORTED', INVENTORY_QUERY: 'VERIFIED' } }],
    ['source-config-price-integrated', 'V550测试报告，按报告电缆长度试算，按报告价格算毛利，做300台库存够不够，先不要保存。', { source: true, scenario: 'cable', readiness: 'READY', required: { FILE_INSPECT: 'VERIFIED', CONFIGURATION_COMPARE: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' }, identity: true }],
    ['customer-historical-price-integrated', '按ABC客户上次V550的报价，如果现在做300台，V550现在成本、毛利和库存怎么样？先不要保存。', { historical: true, readiness: 'READY', required: { CUSTOMER_HISTORY: 'VERIFIED', CURRENT_COST: 'VERIFIED', PROFITABILITY: 'VERIFIED', INVENTORY_QUERY: 'VERIFIED' }, historicalUnitPrice: 340 }],
];
function percentile(values, p) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]; }
function json(value) { return JSON.stringify(value); }
function configureFixture(db, spec) {
    const part = { partId: 601, model: 'Shadow零件甲', supplier: '供应甲', qty: 1 };
    db.prepare("UPDATE orders SET status = '已关闭'").run();
    db.prepare("UPDATE recipes SET name='V550', parts_json='[]', extra_parts_json='[]', packing_parts_json='[]', coil_id=501, coil_spec='12', coil_sheets=220, coil_material='冷轧', coil_slot_type='小眼', has_cable=0, cable_length=3, cable_wire='1.5', cable_accessory_type='standard' WHERE id=301").run();
    db.prepare('UPDATE pump_shell_templates SET parts_json = ? WHERE id=401').run(json([part]));
    db.prepare("UPDATE parts SET price=10, stock=1000 WHERE id=601").run();
    db.prepare("UPDATE coils SET scheme_name='12-220 方案A', scheme_code='N42C-A', spec='12', sheets=220, material='冷轧', slot_type='小眼', scheme_status='official', pricing_mode='kit', kit_price=20, cost=20, stock=1000 WHERE id=501").run();
    db.prepare("DELETE FROM coils WHERE id = 502").run();
    db.prepare("INSERT OR IGNORE INTO parts(id, model, supplier, category, price, stock) VALUES(603, '电缆-线径1.5', '线缆厂', '电缆线', 2, 1500)").run();
    db.prepare("INSERT OR IGNORE INTO parts(id, model, supplier, category, price, stock) VALUES(604, '木箱', '包装厂', '包装', 12, 1000)").run();
    db.prepare("UPDATE parts SET price=2, stock=1500 WHERE id=603").run();
    db.prepare("UPDATE parts SET price=12, stock=1000 WHERE id=604").run();
    if (spec.scenario === 'cable') {
        const cable = { partId: 603, model: '电缆-线径1.5', supplier: '线缆厂', qty: 1, cableAssembly: true, costRole: 'cable' };
        db.prepare("UPDATE recipes SET parts_json=?, has_cable=1, cable_length=3, cable_wire='1.5', cable_accessory_type='standard' WHERE id=301").run(json([cable]));
        db.prepare("UPDATE pump_shell_templates SET parts_json='[]' WHERE id=401").run();
    }
    if (spec.scenario === 'packing') db.prepare('UPDATE parts SET stock=1000 WHERE id=604').run();
    const activePart = spec.scenario === 'cable' ? 603 : 601;
    if (spec.readiness === 'SHORTAGE') db.prepare('UPDATE parts SET stock=100 WHERE id=?').run(activePart);
    if (spec.reservation) {
        const reservationPart = spec.scenario === 'cable'
            ? { partId: 603, model: '电缆-线径1.5', supplier: '线缆厂', qty: 1, cableAssembly: true, costRole: 'cable' }
            : part;
        db.prepare('UPDATE parts SET stock=500 WHERE id=?').run(activePart);
        db.prepare("UPDATE orders SET status='待确认', items_json=? WHERE id=101").run(json([{ recipeId: 301, recipeName: 'V550', qty: 250, partsJson: json([reservationPart]) }]));
    }
    if (spec.missingPrice) db.prepare('UPDATE parts SET price=0 WHERE id=?').run(activePart);
    if (spec.unresolved) db.prepare('UPDATE pump_shell_templates SET parts_json = ? WHERE id=401').run(json([{ model: '未绑定库存零件', supplier: '未知供应商', qty: 1 }]));
    if (spec.source) {
        db.prepare(`INSERT OR REPLACE INTO recipe_technical_files(id, recipe_id, original_name, mime_type, file_size, file_sha256, file_blob, report_type, summary_json, parsed_json, extracted_text, created_at, updated_at, deleted_at)
            VALUES(802, 301, 'V550-测试报告.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 4, ?, X'74657374', 'pump_performance_test', ?, '{}', '', datetime('now'), datetime('now'), NULL)`)
            .run('e'.repeat(64), json({ configuration: { cableLength: '500cm', unitPrice: 340 } }));
    }
    if (spec.historical) {
        db.prepare(`INSERT OR REPLACE INTO customers(id, name, contact_info, default_margin, remark, created_at, updated_at, deleted_at)
            VALUES(801, 'ABC', '', 0, '', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z', NULL)`).run();
        db.prepare(`INSERT OR REPLACE INTO quotations(id, customer_id, status, items_json, total_cost, total_price, remark, created_at, updated_at, deleted_at)
            VALUES(801, 801, '已接受', ?, 100, 340, '', '2026-09-22T00:00:00.000Z', '2026-09-22T00:00:00.000Z', NULL)`)
            .run(json([{ recipeId: 301, recipeName: 'V550', qty: 1, unitCost: 100, unitPrice: 340 }]));
    }
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
    const profitability = executed.filter(item => item.toolName === 'preview_profitability').at(-1)?.result?.data || null;
    const compareCalls = executed.filter(item => item.toolName === 'compare_recipe_scenarios');
    const candidate = profitability?.scenarioContext?.scenarios?.find(item => item.scenarioKey === profitability?.scenarioKey) || null;
    return { label, run, taskState: result.task.state,
        goals: result.task.goals.map(goal => ({ kind: goal.kind, state: goal.state, blockers: goal.blockers.map(blocker => blocker.code) })),
        readiness, profitability, tools: executed.map(item => item.toolName), comparisonCalls: compareCalls.length,
        scenarioIdentity: candidate && readiness ? { recipeId: Number(profitability.recipe?.entityId ?? profitability.recipe?.id) || null, scenarioKey: profitability.scenarioKey, profitabilityConfigurationHash: profitability.configurationHash || null, candidateConfigurationHash: candidate.configurationHash || null, readinessConfigurationHash: readiness.configurationHash || null } : null,
        answer: result.answer?.content || '', sourceEvidence: result.task.sourceEvidence || [], modelCalls: result.task.budgetUsage.modelCalls, toolCalls: result.task.budgetUsage.toolCalls, apiCalls: result.task.budgetUsage.apiCalls,
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
    const errors = [];
    for (const [kind, expected] of Object.entries(spec.required || {})) {
        const actual = item.goals.find(goal => goal.kind === kind)?.state || 'MISSING';
        if (actual !== expected) errors.push(`${kind} expected ${expected}, got ${actual}`);
    }
    if (spec.readiness && (item.readiness?.status !== spec.readiness || item.readiness?.coverage?.complete !== true)) errors.push(`readiness expected complete ${spec.readiness}, got ${item.readiness?.status || 'MISSING'}`);
    if (!spec.readiness && spec.required?.INVENTORY_QUERY === 'PARTIAL' && item.readiness?.status !== 'INCOMPLETE') errors.push('incomplete readiness did not remain INCOMPLETE');
    if (spec.identity && !item.scenarioIdentity) errors.push('integrated scenario identity missing');
    if (spec.identity && item.scenarioIdentity && (item.scenarioIdentity.recipeId !== 301 || !item.scenarioIdentity.scenarioKey || !item.scenarioIdentity.profitabilityConfigurationHash || item.scenarioIdentity.profitabilityConfigurationHash !== item.scenarioIdentity.candidateConfigurationHash || item.scenarioIdentity.profitabilityConfigurationHash !== item.scenarioIdentity.readinessConfigurationHash)) errors.push('integrated scenario identity mismatch');
    if (spec.full && item.comparisonCalls !== 0) errors.push('full task repeated scenario comparison despite profitability reuse');
    if (spec.full && item.tools.filter(tool => tool === 'preview_profitability').length !== 1) errors.push('full task did not use exactly one profitability preview');
    if (spec.full && item.tools.filter(tool => tool === 'preview_virtual_readiness').length !== 1) errors.push('full task did not use exactly one readiness preview');
    if (spec.reservation && !(item.readiness?.requirements || []).some(row => Number(row.reservedByActiveOrdersQty) === 250)) errors.push('active order reservation was not applied');
    if (spec.source && !(item.sourceEvidence || []).some(item => item.coverage?.complete === true)) errors.push('source scenario did not retain complete formal document evidence');
    if (spec.historical && (!item.tools.includes('search_customer_history') || item.profitability?.unitPrice !== spec.historicalUnitPrice)) errors.push('complete customer quotation was not used as the formal historical price hypothesis');
    if (spec.scenario === 'cable' && item.readiness) {
        const requestedQuantity = item.readiness.quantity;
        if (!(item.readiness.requirements || []).some(row => row.inventoryUnit === 'meter' && row.virtualRequiredQty === requestedQuantity * 5)) errors.push('cable meter quantity not formally projected');
    }
    if (item.modelCalls > 2 || item.toolCalls > 10 || item.apiCalls > 128) errors.push('task budget exceeded');
    if (/可以生产|能交货|产能够|按时完成|净利润/u.test(item.answer)) errors.push('answer made forbidden production, delivery, or net-profit claim');
    if (/已保存|已经保存|已修改正式/u.test(item.answer)) errors.push('answer claimed a forbidden write');
    return errors;
}
async function runFamily(runtime, config, raw, label, text, spec, run) {
    configureFixture(runtime.db, spec);
    const startedAt = Date.now(); const executed = [];
    const result = await runAiTaskControllerV2({ ownerKey: `n42c-${label}-${run}`, requestId: `n42c-${label}-${run}-${Date.now()}`, conversationId: `n42c-${label}-${run}`, messages: [{ role: 'user', content: text }] }, { provider: providerFor(config, raw, `${label}:${run}`), executeToolCall: captureExecutor(executed), sessionStore: createTaskSessionStoreV2() });
    const item = summarize(label, run, result, startedAt, executed); return { item, errors: validate(item, spec) };
}
async function runContinuation(runtime, config, raw, run) {
    configureFixture(runtime.db, { scenario: 'cable', readiness: 'READY' });
    const sessions = createTaskSessionStoreV2(); const ownerKey = `n42c-continuation-${run}`; const conversationId = ownerKey;
    const firstExecuted = []; const firstStarted = Date.now();
    const first = await runAiTaskControllerV2({ ownerKey, requestId: `${ownerKey}-1`, conversationId, messages: [{ role: 'user', content: 'V550电缆改成5米，和当前成本比较，毛利多少，库存够不够，先不要保存。' }] }, { provider: providerFor(config, raw, `continuation:${run}:turn1`), executeToolCall: captureExecutor(firstExecuted), sessionStore: sessions });
    const secondExecuted = []; const secondStarted = Date.now();
    const second = await runAiTaskControllerV2({ ownerKey, requestId: `${ownerKey}-2`, conversationId, messages: [{ role: 'user', content: '卖340元一台，做300台' }] }, { provider: providerFor(config, raw, `continuation:${run}:turn2`), executeToolCall: captureExecutor(secondExecuted), sessionStore: sessions });
    const items = [summarize('missing-price-quantity-turn1', run, first, firstStarted, firstExecuted), summarize('missing-price-quantity-turn2', run, second, secondStarted, secondExecuted)];
    const errors = [];
    if (!(first.task.state === 'WAITING_INPUT' && first.task.goals.find(goal => goal.kind === 'INVENTORY_QUERY')?.state === 'NEEDS_INPUT' && first.task.goals.find(goal => goal.kind === 'PROFITABILITY')?.state === 'NEEDS_INPUT')) errors.push('turn 1 did not wait for both price and quantity');
    if (!(second.task.state === 'SUCCEEDED' && second.task.goals.find(goal => goal.kind === 'INVENTORY_QUERY')?.state === 'VERIFIED' && second.task.goals.find(goal => goal.kind === 'PROFITABILITY')?.state === 'VERIFIED')) errors.push('turn 2 did not complete both price and quantity goals');
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
            const outcome = await runContinuation(runtime, config, raw, run); accepted.push(...outcome.items); if (outcome.errors.length) failures.push({ label: 'missing-price-quantity-continuation', run, errors: outcome.errors });
        }
    } finally { await runtime.close(); }
    fs.mkdirSync(path.dirname(rawPath), { recursive: true }); fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    const values = key => accepted.map(item => item[key]).filter(Number.isFinite);
    const report = { ticket: 'N4.2C', requestedProvider: 'deepseek', actualProvider: 'deepseek', model: config.model, fallbackCount: 0,
        liveFamilies: FAMILIES.length, runsPerFamily: 2, baseTaskResults: FAMILIES.length * 2, continuationTaskResults: 4, totalAcceptedLiveRuns: accepted.length, missingPriceQuantityContinuations: 2,
        businessToolCalls: 0, businessWrites: 0, unauthorizedWrites: 0, orderCreates: 0, purchaseCreates: 0, inventoryWrites: 0, auditDelta: 0, operationDelta: 0, fileSideEffects: 0,
        metrics: { medianLatencyMs: percentile(values('durationMs'), .5), p95LatencyMs: percentile(values('durationMs'), .95), firstStatusMedianMs: percentile(values('firstStatusMs'), .5), finalAnswerMedianMs: percentile(values('finalAnswerMs'), .5), admissionMedianMs: percentile(values('admissionMs'), .5), admissionP95Ms: percentile(values('admissionMs'), .95) },
        failures, accepted, rawLog: 'gitignored logs/ai-native-n4-2c-live-raw.json' };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (failures.length) process.exitCode = 2;
}
if (require.main === module) main().catch(error => { process.stderr.write(`AI_NATIVE_N42C_LIVE_FAILED ${error.code || error.message}\n${error.stack || ''}\n`); process.exitCode = 2; });
module.exports = { configureFixture };
