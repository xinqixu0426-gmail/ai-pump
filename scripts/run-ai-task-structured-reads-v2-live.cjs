'use strict';

// N4.1A live acceptance. DeepSeek only proposes TaskProposalV1 candidates;
// every formal read uses the isolated temporary SQLite HTTP fixture. Raw model
// payloads live solely in gitignored logs/.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
const { startAiHttpRuntime } = require('../tests/helpers/ontologyHttpRuntimeFixture.cjs');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const rawPath = path.join(root, 'logs', 'ai-task-structured-reads-v2-live-raw.json');
const instructions = [
    'You are a candidate-only TaskProposalV1 extractor. Call the sole supplied function exactly once.',
    'Return only {"proposal": TaskProposalV1}; never execute a business action or make up formal facts.',
    'TaskProposalV1 exact fields: version=1, goalSummary, subjects, scenarios, goals, unparsedSpans.',
    'Subject exact fields: subjectKey, mention, typeHints, sources. Use sourceQuote exactly copied from the user for every source.',
    'Goal exact fields: goalKey, kind, description, subjectKeys, scenarioKeys, dependsOn, requestedBasis, sources, quantity, unitPrice.',
    'Scenario exact fields: scenarioKey, label, baseSubjectKey, overrides, sources. Override exact fields: field, value, unit, sources.',
    'Allowed goal kinds: CURRENT_COST, CONFIGURATION_COMPARE, COIL_QUERY, INVENTORY_QUERY, ORDER_READINESS, CUSTOMER_HISTORY, QUOTATION_QUERY, MANAGEMENT_OVERVIEW, BUSINESS_CHANGES, IMPACT_INVESTIGATION, PROFITABILITY, PREPARE_CHANGE, APPLY_CHANGE, OTHER.',
    'Allowed subject hints: part, coil, template, recipe, customer, quotation, order, file, knowledge, business_record.',
    'A customer-history goal keeps a customer mention as type customer. An explicit order number is type order. 12-200 is type coil. V550 is type recipe.',
    'Preserve each independent user objective. Do not replace a customer history with a current quotation query. Do not infer IDs, prices, availability, completeness, approval, writes, receipts, or verification.',
    'Use null for absent quantity or unitPrice. Never add canonicalId, entityId, recipeId, coilId, partId, verified, complete, allowWrite, approval, receipt, operationId, or businessWritePolicy.',
].join('\n');

function configureFixture(db) {
    db.prepare("UPDATE customers SET name = 'ABC' WHERE id = 1").run();
    db.prepare("UPDATE recipes SET name = 'V550', coil_spec = '12', coil_sheets = 200, coil_material = '冷轧', coil_slot_type = '小眼', has_cable = 1, cable_length = 3, cable_wire = '1.5' WHERE id = 301").run();
    db.prepare("UPDATE coils SET scheme_name = '12-200 正式方案', scheme_code = 'N4-OFFICIAL', spec = '12', sheets = 200, scheme_status = 'official', pricing_mode = 'kit', kit_price = 20, cost = 20, stock = 12 WHERE id = 501").run();
    db.prepare("INSERT OR REPLACE INTO coils(id, scheme_name, scheme_code, spec, sheets, material, scheme_status, pricing_mode, kit_price, cost, stock) VALUES(502, '12-200 测试方案', 'N4-TESTING', '12', 200, '冷轧', 'testing', 'kit', 21, 21, 99)").run();
    db.prepare("UPDATE orders SET customer_id = 1, customer_name = 'ABC', status = '待采购' WHERE id = 101").run();
    db.prepare("UPDATE quotations SET customer_id = 1, status = '报价中' WHERE id = 701").run();
    db.prepare("UPDATE parts SET model = '零件A', supplier = '供应甲', stock = 8, price = 10 WHERE id = 601").run();
    db.prepare("INSERT OR REPLACE INTO parts(id, model, category, price, supplier) VALUES(603, '电缆-线径1.5', '电缆线', 2, '供应甲')").run();
}

function providerFor(config, raw, tag) {
    return async request => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        try {
            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: 'POST', signal: controller.signal,
                headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
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
    return {
        label, state: task.state, planRevision: task.planRevision,
        goals: task.goals.map(goal => ({ kind: goal.kind, state: goal.state, blockers: goal.blockers.map(blocker => blocker.code) })),
        facts: task.facts.map(fact => ({ predicate: fact.key.predicate, entityType: fact.key.entityType, entityId: fact.key.entityId, complete: fact.complete })),
        budget: task.budgetUsage, answer: result.answer?.content || null, answerMode: result.answer?.answerMode || null,
    };
}

const SCENARIOS = Object.freeze([
    ['customer-history-cost', 'ABC客户以前报过 V550 什么价格？V550 当前成本多少？'],
    ['customer-all-history', 'ABC客户全部报价历史和订单历史有哪些？'],
    ['order-readiness', '订单101现在为什么还不能生产？缺什么？下一步要做什么？'],
    ['quotation-query', '当前有哪些正式报价？'],
    ['management', '管理待办和风险有哪些需要优先处理？'],
    ['business-changes', '最近改了什么业务记录？'],
    ['coil-catalogue', '12-200有哪些方案，包括测试方案？'],
    ['coil-inventory', '12-200库存还有多少？'],
    ['part-inventory-gap', '零件A库存还有多少？'],
    ['impact-gap', 'V550 影响哪些对象，需要重算或复核吗？'],
]);

async function runRound(round, config, raw) {
    const { runAiTaskControllerV2 } = require('../api/services/aiTaskControllerV2.cjs');
    const { createTaskSessionStoreV2 } = require('../api/services/aiTaskSessionV2.cjs');
    const results = [];
    for (const [label, text] of SCENARIOS) {
        const result = await runAiTaskControllerV2({
            ownerKey: `n4-live-owner-${round}-${label}`,
            requestId: `n4-${round}-${label}-${Date.now()}`,
            conversationId: `n4-${round}-${label}`,
            messages: [{ role: 'user', content: text }],
        }, { provider: providerFor(config, raw, `${round}:${label}`), sessionStore: createTaskSessionStoreV2() });
        results.push(summarize(label, result));
    }
    return results;
}

function goal(item, kind) { return item.goals.find(entry => entry.kind === kind); }
function validate(rounds) {
    const errors = [];
    for (const items of rounds) {
        for (const item of items) {
            const find = kind => goal(item, kind);
            if (item.budget.toolCalls > 10 || item.budget.modelCalls > 2) errors.push(`${item.label}: budget exceeded`);
            if (item.label === 'customer-history-cost' && !(find('CUSTOMER_HISTORY')?.state === 'VERIFIED' && find('CURRENT_COST')?.state === 'VERIFIED')) errors.push('customer-history-cost: independent history and current cost were not both verified');
            if (item.label === 'customer-history-cost' && !/不同时间和价格口径/u.test(item.answer || '')) errors.push('customer-history-cost: answer did not separate historical and current basis');
            if (item.label === 'customer-all-history' && find('CUSTOMER_HISTORY')?.state !== 'VERIFIED') errors.push('customer-all-history: complete formal history did not verify');
            if (item.label === 'order-readiness' && !(find('ORDER_READINESS')?.state === 'VERIFIED' && /不承诺产能、交期或工程性能/u.test(item.answer || ''))) errors.push('order-readiness: formal package or answer boundary missing');
            if (item.label === 'quotation-query' && find('QUOTATION_QUERY')?.state !== 'VERIFIED') errors.push('quotation-query: formal current quotation query did not verify');
            if (item.label === 'management' && find('MANAGEMENT_OVERVIEW')?.state !== 'VERIFIED') errors.push('management: formal action center did not verify');
            if (item.label === 'business-changes' && find('BUSINESS_CHANGES')?.state !== 'VERIFIED') errors.push('business-changes: formal event log did not verify');
            if (item.label === 'coil-catalogue' && !(find('COIL_QUERY')?.state === 'VERIFIED' && /official.*testing|testing.*official/u.test(item.answer || ''))) errors.push('coil-catalogue: testing visibility boundary missing');
            if (item.label === 'coil-inventory' && find('INVENTORY_QUERY')?.state !== 'NEEDS_INPUT') errors.push('coil-inventory: ambiguous variants were aggregated or not clarified');
            if (item.label === 'part-inventory-gap' && !find('INVENTORY_QUERY')?.blockers.includes('N4.1A_CAPABILITY_GAP')) errors.push('part-inventory-gap: unsupported current part binding was not recorded as capability gap');
            if (item.label === 'impact-gap' && !find('IMPACT_INVESTIGATION')?.blockers.includes('N4.1A_CAPABILITY_GAP')) errors.push('impact-gap: unsafe generic impact was not recorded as capability gap');
            if (/已保存|已修改|已提交|已经写入/u.test(item.answer || '')) errors.push(`${item.label}: answer claimed a business write`);
        }
    }
    return errors;
}

async function main() {
    const config = resolveProviderConfig('deepseek', process.env);
    if (!config.apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const runtime = await startAiHttpRuntime();
    try {
        configureFixture(runtime.db);
        const raw = [];
        const rounds = [];
        for (let round = 1; round <= 2; round += 1) rounds.push(await runRound(round, config, raw));
        fs.mkdirSync(path.dirname(rawPath), { recursive: true });
        fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
        const errors = validate(rounds);
        process.stdout.write(`${JSON.stringify({ requestedProvider: 'deepseek', actualProvider: 'deepseek', model: config.model, fallbackCount: 0, rounds, errors, businessWrites: 0, unauthorizedWrites: 0, database: 'temporary SQLite fixture' }, null, 2)}\n`);
        if (errors.length) process.exitCode = 2;
    } finally { await runtime.close(); }
}

main().catch(error => { process.stderr.write(`AI_TASK_STRUCTURED_READS_V2_LIVE_FAILED ${error.code || error.message}\n${error.stack || ''}\n`); process.exitCode = 2; });
