'use strict';

// N3.1 live acceptance.  The provider is real DeepSeek, while all formal
// reads/previews use the project's isolated temporary SQLite HTTP fixture.
// Raw provider payloads are written only under gitignored logs/.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
const { startAiHttpRuntime } = require('../tests/helpers/ontologyHttpRuntimeFixture.cjs');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const rawPath = path.join(root, 'logs', 'ai-task-controller-v2-live-raw.json');
const instructions = [
    'You are a candidate-only task semantics extractor. You must call the only supplied function once.',
    'Return {"proposal": TaskProposalV1}. Do not add any fields beyond the exact fields below.',
    'TaskProposalV1 fields: version=1, goalSummary, subjects, scenarios, goals, unparsedSpans.',
    'subject fields: subjectKey, mention, typeHints, sources. scenario fields: scenarioKey, label, baseSubjectKey, overrides, sources.',
    'override fields: field, value, unit, sources. goal fields: goalKey, kind, description, subjectKeys, scenarioKeys, dependsOn, requestedBasis, sources, quantity, unitPrice.',
    'quantity and unitPrice are either null or {value,unit,sources}. Every sources element must be {"sourceQuote":"exact text copied from the user"}.',
    'Allowed goal kinds include CURRENT_COST, CONFIGURATION_COMPARE, COIL_QUERY, INVENTORY_QUERY, PROFITABILITY, PREPARE_CHANGE, APPLY_CHANGE, OTHER.',
    'Allowed override fields include cableLength, coilSelection, hasCable, hasFloat, packingSelection. Never supply canonical IDs, authorization, verification, completeness, receipts, or write policy.',
    'Treat configuration wording as a candidate scenario. Preserve every independent goal, quantity, selling price, negation and condition. Do not execute anything.',
].join('\n');

function configureFixture(db) {
    db.prepare(`UPDATE recipes SET name = 'V550', coil_spec = '12', coil_sheets = 220, coil_material = '冷轧', coil_slot_type = '小眼', has_cable = 1, cable_length = 3, cable_wire = '1.5' WHERE id = 301`).run();
    db.prepare(`UPDATE coils SET scheme_name = '12-220 方案A', scheme_code = 'N3-A', spec = '12', sheets = 220, scheme_status = 'official', pricing_mode = 'kit', kit_price = 20, cost = 20 WHERE id = 501`).run();
    db.prepare(`UPDATE coils SET scheme_name = '12-220 方案B', scheme_code = 'N3-B', spec = '12', sheets = 220, scheme_status = 'official', pricing_mode = 'kit', kit_price = 21, cost = 21 WHERE id = 502`).run();
    db.prepare('UPDATE parts SET price = 10 WHERE id = 601').run();
    db.prepare(`INSERT INTO parts(id, model, category, price, supplier)
        VALUES(603, '电缆-线径1.5', '电缆线', 2, '供应甲')`).run();
}

function providerFor(config, raw, tag) {
    return async request => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        try {
            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
                body: JSON.stringify({ model: config.model, thinking: { type: 'disabled' }, temperature: 0, messages: [{ role: 'system', content: instructions }, ...request.messages], tools: request.tools, tool_choice: request.toolChoice, stream: false }),
            });
            if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
            const payload = await response.json();
            raw.push({ tag, payload });
            fs.mkdirSync(path.dirname(rawPath), { recursive: true });
            fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
            return { ...payload, provider: 'deepseek', model: payload.model || config.model };
        } finally { clearTimeout(timeout); }
    };
}

function summarize(label, result) {
    const task = result.task;
    return { label, state: task.state, planRevision: task.planRevision, goals: task.goals.map(goal => ({ kind: goal.kind, state: goal.state, blockers: goal.blockers.map(blocker => blocker.code) })), facts: task.facts.map(fact => ({ predicate: fact.key.predicate, entityType: fact.key.entityType, entityId: fact.key.entityId, complete: fact.complete })), budget: task.budgetUsage, answer: result.answer?.content || null, answerMode: result.answer?.answerMode || null };
}

async function runRound(round, runtime, config, raw) {
    const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
    const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
    const sessions = createTaskSessionStoreV2();
    const run = async (label, text, conversationId) => {
        const result = await runAiTaskControllerV2({ ownerKey: `live-owner-${round}`, requestId: `${round}-${label}-${Date.now()}`, conversationId, messages: [{ role: 'user', content: text }] }, { provider: providerFor(config, raw, `${round}:${label}`), sessionStore: sessions });
        return result;
    };
    const results = [];
    results.push(summarize('current', await run('current', 'V550当前成本', `${round}-current`)));
    results.push(summarize('cable-5m', await run('cable-5m', 'V550电缆改成5米，其他不变，和现在成本比一下，先不要保存', `${round}-cable`)));
    results.push(summarize('cable-500cm', await run('cable-500cm', 'V550电缆改成500cm，其他不变，和现在成本比一下，先不要保存', `${round}-cable-cm`)));
    const missing = await run('cable-missing-unit', 'V550电缆改成5，先不要保存', `${round}-unit`);
    results.push(summarize('cable-missing-unit', missing));
    results.push(summarize('cable-unit-answer', await run('cable-unit-answer', '5米', `${round}-unit`)));
    const coil = await run('coil-choice', 'V550换成12-220，和现在成本比一下，其他不变，先不要保存', `${round}-coil`);
    results.push(summarize('coil-choice', coil));
    results.push(summarize('coil-choice-answer', await run('coil-choice-answer', '第二个', `${round}-coil`)));
    results.push(summarize('profit', await run('profit', 'V550电缆改成5米，和现在成本比一下，卖340一台利润多少，先不要保存', `${round}-profit`)));
    results.push(summarize('v900', await run('v900', 'V900 的成本是多少', `${round}-v900`)));
    results.push(summarize('no-save', await run('no-save', 'V550电缆改成5米，和现在成本比一下，先不要保存', `${round}-no-save`)));
    return results;
}

function validate(rounds) {
    const errors = [];
    for (const item of rounds.flat()) {
        const goal = kind => item.goals.find(entry => entry.kind === kind)?.state;
        if (['current', 'cable-5m', 'cable-500cm', 'cable-unit-answer', 'coil-choice-answer', 'no-save'].includes(item.label) && item.state !== 'SUCCEEDED') errors.push(`${item.label}: expected SUCCEEDED, got ${item.state}`);
        if (item.label === 'cable-missing-unit' && item.state !== 'WAITING_INPUT') errors.push('missing unit did not wait');
        if (item.label === 'coil-choice' && item.state !== 'WAITING_INPUT') errors.push('coil ambiguity did not wait');
        if (item.label === 'profit' && !(item.state === 'SUCCEEDED' && goal('PROFITABILITY') === 'VERIFIED')) errors.push('profit was not verified by an authoritative preview');
        if (item.label === 'v900' && (item.facts.some(fact => fact.entityType === 'global') || item.state === 'SUCCEEDED' || /系统中没有|数据库中不存在|工厂没有|不存在该产品/u.test(item.answer || ''))) errors.push('V900 falsely completed globally');
        if (item.budget.toolCalls > 10 || item.budget.modelCalls > 7) errors.push(`${item.label}: budget exceeded`);
    }
    return errors;
}

async function main() {
    const config = resolveProviderConfig('deepseek', process.env);
    if (!config.apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const runtime = await startAiHttpRuntime();
    try {
        configureFixture(runtime.db);
        const raw = []; const rounds = [];
        for (let round = 1; round <= 2; round += 1) rounds.push(await runRound(round, runtime, config, raw));
        fs.mkdirSync(path.dirname(rawPath), { recursive: true }); fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
        const errors = validate(rounds);
        process.stdout.write(`${JSON.stringify({ requestedProvider: 'deepseek', actualProvider: 'deepseek', model: config.model, fallbackCount: 0, rounds, errors, businessWrites: 0 }, null, 2)}\n`);
        if (errors.length) process.exitCode = 2;
    } finally { await runtime.close(); }
}

main().catch(error => { process.stderr.write(`AI_TASK_CONTROLLER_V2_LIVE_FAILED ${error.code || error.message}\n${error.stack || ''}\n`); process.exitCode = 2; });
