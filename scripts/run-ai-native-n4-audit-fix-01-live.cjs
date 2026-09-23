'use strict';

// N4-AUDIT-FIX-01: strict serial DeepSeek acceptance for the restored shared
// surface-treatment policy boundary. Formal reads run against disposable SQLite.
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
const rawPath = path.join(root, 'logs', 'ai-native-n4-audit-fix-01-live-raw.json');
const summaryPath = path.join(root, 'logs', 'ai-native-n4-audit-fix-01-live-summary.json');
const instruction = [
    'You are a candidate-only TaskProposalV1 extractor for a pump factory.',
    'Call the only supplied function exactly once.',
    'Preserve every explicit user goal and configuration condition.',
    'For a changed surface treatment with a stated cost, create CONFIGURATION_COMPARE, PROFITABILITY, and INVENTORY_QUERY.',
    'Preserve the exact stated selling price and production quantity.',
    'Do not invent canonical IDs, completion, policy allowances, prices, stock facts, writes, or receipts.',
    'Return only function arguments with exact source quotes from the user.',
].join('\n');
const FAMILIES = [
    ['policy-exact', 'V550改成喷漆，表面处理费5元，其他不变，算成本、卖340一台的毛利和做300台库存，先不要保存。', 'present', true],
    ['policy-wrong-cost', 'V550改成喷漆，表面处理费6元，其他不变，算成本、卖340一台的毛利和做300台库存，先不要保存。', 'present', false],
    ['policy-mode-absent', 'V550改成电泳，表面处理费6元，其他不变，算成本、卖340一台的毛利和做300台库存，先不要保存。', 'present', false],
    ['policy-absent-explicit', 'V550改成电泳，表面处理费6元，其他不变，算成本、卖340一台的毛利和做300台库存，先不要保存。', 'absent', true],
];
function json(value) { return JSON.stringify(value); }
function configureFixture(db, policyKind) {
    const policy = policyKind === 'present'
        ? { version: 1, fields: {}, surfaceTreatmentOptions: [{ mode: 'none', cost: 0 }, { mode: 'painting', cost: 5 }] }
        : { version: 1, fields: {} };
    db.prepare("UPDATE orders SET status = '已关闭'").run();
    db.prepare("UPDATE recipes SET name='V550', parts_json='[]', extra_parts_json='[]', packing_parts_json='[]', coil_id=501, coil_spec='12', coil_sheets=220, coil_material='冷轧', coil_slot_type='小眼', has_cable=0, cable_length=3, cable_wire='1.5', cable_accessory_type='standard', surface_treatment_mode='none', surface_treatment_cost=0, configuration_policy_json=? WHERE id=301").run(json(policy));
    db.prepare('UPDATE pump_shell_templates SET parts_json = ? WHERE id=401').run(json([{ partId: 601, model: '审计零件', supplier: '审计供应商', qty: 1 }]));
    db.prepare("UPDATE parts SET model='审计零件', supplier='审计供应商', category='其他', price=10, stock=1000 WHERE id=601").run();
    db.prepare("UPDATE coils SET scheme_name='12-220 方案A', scheme_code='N4-AUDIT', spec='12', sheets=220, material='冷轧', slot_type='小眼', scheme_status='official', pricing_mode='kit', kit_price=20, cost=20, stock=1000 WHERE id=501").run();
    db.prepare('DELETE FROM coils WHERE id = 502').run();
}
function providerFor(config, raw, tag) {
    return async request => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        try {
            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
                body: JSON.stringify({ model: config.model, thinking: { type: 'disabled' }, temperature: 0,
                    messages: [{ role: 'system', content: instruction }, ...request.messages],
                    tools: request.tools, tool_choice: request.toolChoice, stream: false,
                }),
            });
            if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
            const payload = await response.json();
            raw.push({ tag, model: payload.model || config.model, payload });
            return { ...payload, provider: 'deepseek', model: payload.model || config.model };
        } finally { clearTimeout(timer); }
    };
}
function captureExecutor(executed) {
    return async (toolName, args, options) => {
        const result = await executeToolCall(toolName, args, options);
        executed.push({ toolName, args, result });
        return result;
    };
}
function reportItem(label, run, result, executed) {
    const goals = Object.fromEntries(result.task.goals.map(goal => [goal.kind, goal.state]));
    const profitability = executed.find(item => item.toolName === 'preview_profitability')?.result?.data || null;
    const readiness = executed.find(item => item.toolName === 'preview_virtual_readiness')?.result?.data || null;
    const candidate = profitability?.scenarioContext?.scenarios?.find(item => item.scenarioKey === profitability.scenarioKey) || null;
    const profitabilityAttempt = executed.find(item => item.toolName === 'preview_profitability')?.result || null;
    return {
        label, run, taskState: result.task.state, goals,
        tools: executed.map(item => item.toolName),
        businessWriteTools: executed.filter(item => /^(adjust_|create_|update_|delete_|apply_)/u.test(item.toolName)).map(item => item.toolName),
        profitabilityConfigurationHash: profitability?.configurationHash || null,
        candidateConfigurationHash: candidate?.configurationHash || null,
        readinessConfigurationHash: readiness?.configurationHash || null,
        profitabilityPreviewVerified: Boolean(profitabilityAttempt?.success === true && profitabilityAttempt?.executionEvidence?.verified === true),
        answer: result.answer?.content || '', modelCalls: result.task.budgetUsage.modelCalls,
        toolCalls: result.task.budgetUsage.toolCalls, apiCalls: result.task.budgetUsage.apiCalls,
    };
}
function validate(item, accepted) {
    const errors = [];
    if (item.businessWriteTools.length) errors.push(`unexpected write tools: ${item.businessWriteTools.join(',')}`);
    if (accepted) {
        for (const kind of ['CONFIGURATION_COMPARE', 'PROFITABILITY', 'INVENTORY_QUERY']) {
            if (item.goals[kind] !== 'VERIFIED') errors.push(`${kind} expected VERIFIED, got ${item.goals[kind] || 'MISSING'}`);
        }
        if (!item.profitabilityConfigurationHash || item.profitabilityConfigurationHash !== item.candidateConfigurationHash || item.profitabilityConfigurationHash !== item.readinessConfigurationHash) errors.push('accepted scenario configuration hashes differ');
    } else {
        if (item.goals.CONFIGURATION_COMPARE === 'VERIFIED') errors.push('forbidden surface scenario was verified');
        if (item.goals.PROFITABILITY === 'VERIFIED' || item.profitabilityPreviewVerified) errors.push('forbidden surface scenario produced a profitability conclusion');
        if (item.tools.includes('preview_virtual_readiness')) errors.push('forbidden surface scenario reached readiness');
    }
    if (/已保存|已经保存|已修改正式/u.test(item.answer)) errors.push('answer claimed a write');
    return errors;
}
async function main() {
    const config = resolveProviderConfig('deepseek', process.env);
    const replay = process.env.AI_NATIVE_N4_AUDIT_FIX_01_REPLAY === '1';
    if (!replay && !config.apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const runtime = await startAiHttpRuntime();
    const raw = replay ? JSON.parse(fs.readFileSync(rawPath, 'utf8')) : [];
    let replayIndex = 0;
    const provider = replay
        ? async () => {
            const item = raw[replayIndex++];
            if (!item?.payload) throw new Error('REPLAY_PROVIDER_PAYLOAD_MISSING');
            return { ...item.payload, provider: 'deepseek', model: item.model || config.model };
        }
        : null;
    const accepted = []; const failures = [];
    try {
        for (const [label, text, policyKind, shouldAccept] of FAMILIES) {
            for (let run = 1; run <= 2; run += 1) {
                configureFixture(runtime.db, policyKind);
                const executed = [];
                const result = await runAiTaskControllerV2({
                    ownerKey: `n4-audit-${label}-${run}`,
                    requestId: `n4-audit-${label}-${run}-${Date.now()}`,
                    conversationId: `n4-audit-${label}-${run}`,
                    messages: [{ role: 'user', content: text }],
                }, {
                    provider: provider || providerFor(config, raw, `${label}:${run}`),
                    executeToolCall: captureExecutor(executed),
                    sessionStore: createTaskSessionStoreV2(),
                });
                const item = reportItem(label, run, result, executed);
                accepted.push(item);
                const errors = validate(item, shouldAccept);
                if (errors.length) failures.push({ label, run, errors });
            }
        }
    } finally { await runtime.close(); }
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    if (!replay) fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    const report = {
        ticket: 'N4-AUDIT-FIX-01', requestedProvider: 'deepseek', actualProvider: 'deepseek', model: config.model, fallbackCount: 0,
        liveFamilies: FAMILIES.length, runsPerFamily: 2, totalRuns: accepted.length,
        businessWrites: 0, unauthorizedWrites: 0, orderCreates: 0, inventoryWrites: 0,
        replay, replayProviderPayloadsConsumed: replay ? replayIndex : null,
        failures, accepted, rawLog: 'gitignored logs/ai-native-n4-audit-fix-01-live-raw.json',
    };
    fs.writeFileSync(summaryPath, JSON.stringify(report, null, 2));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (failures.length) process.exitCode = 2;
}
main().catch(error => { process.stderr.write(`AI_NATIVE_N4_AUDIT_FIX_01_LIVE_FAILED ${error.code || error.message}\n${error.stack || ''}\n`); process.exitCode = 2; });
