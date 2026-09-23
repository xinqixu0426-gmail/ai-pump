'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
const { extractTaskSemanticsV2 } = require('../api/services/aiTaskSemanticsV2.cjs');

const root = path.resolve(__dirname, '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/ai-task-semantics-v2-cases.json'), 'utf8'));
const rawPath = path.join(root, 'logs', 'ai-task-semantics-v2-live-raw.json');
const instructions = [
    'You are a candidate-only task semantics extractor. You must call the only supplied function once.',
    'Return {"proposal": TaskProposalV1}. Do not add any fields beyond the exact fields below.',
    'TaskProposalV1 fields: version=1, goalSummary, subjects, scenarios, goals, unparsedSpans.',
    'subject fields: subjectKey, mention, typeHints, sources. scenario fields: scenarioKey, label, baseSubjectKey, overrides, sources.',
    'override fields: field, value, unit, sources. goal fields: goalKey, kind, description, subjectKeys, scenarioKeys, dependsOn, requestedBasis, sources, quantity, unitPrice.',
    'quantity and unitPrice are either null or {value,unit,sources}. Every sources element must be {"sourceQuote":"exact text copied from the user"}.',
    'Allowed goal kinds include CURRENT_COST, CONFIGURATION_COMPARE, COIL_QUERY, INVENTORY_QUERY, PROFITABILITY, PREPARE_CHANGE, APPLY_CHANGE, OTHER.',
    'Allowed override fields include cableLength, coilSelection, hasCable, hasFloat, packingSelection. Never supply canonical IDs, prices, inventory, verified flags, complete flags, authorization, approvals, receipts, or write policy.',
    'Treat configuration wording as a candidate scenario. Preserve every independent goal, quantity, selling price, negation and condition. Do not execute anything.',
].join('\n');

function summarize(caseData, result) {
    const expected = caseData.expectedGoalKinds;
    const actual = Array.isArray(result.proposal?.goals) ? result.proposal.goals.map(goal => goal.kind) : [];
    const missing = expected.filter(item => !actual.includes(item));
    const extra = actual.filter(item => !expected.includes(item));
    return { caseId: caseData.caseId, status: result.status, modelCalls: result.telemetry.modelCalls, formatRepairCalls: result.telemetry.formatRepairCalls, provider: result.telemetry.provider, model: result.telemetry.model, goals: actual, missing, extra, blockers: result.blockers.map(item => item.code) };
}

async function main() {
    const config = resolveProviderConfig('deepseek', process.env);
    if (!config.apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
    const cases = fixture.cases.filter(item => item.core === true);
    if (!cases.length) throw new Error('NO_MODEL_ASSISTED_CORE_CASES');
    const raw = [];
    const report = [];
    for (let round = 1; round <= 2; round += 1) for (const caseData of cases) {
        const provider = async request => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 120000);
            const response = await fetch(`${config.baseUrl}/chat/completions`, {
                method: 'POST', signal: controller.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
                body: JSON.stringify({ model: config.model, thinking: { type: 'disabled' }, temperature: 0, messages: [{ role: 'system', content: instructions }, ...request.messages], tools: request.tools, tool_choice: request.toolChoice, stream: false }),
            });
            clearTimeout(timeout);
            if (!response.ok) throw new Error(`DEEPSEEK_HTTP_${response.status}`);
            const payload = await response.json();
            raw.push({ round, caseId: caseData.caseId, response: payload });
            return { ...payload, provider: 'deepseek', model: payload.model || config.model };
        };
        const result = await extractTaskSemanticsV2({ messageRef: `live:${round}:${caseData.caseId}`, text: caseData.text, provider });
        report.push({ round, ...summarize(caseData, result) });
    }
    fs.mkdirSync(path.dirname(rawPath), { recursive: true });
    fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
    process.stdout.write(`${JSON.stringify({ requestedProvider: 'deepseek', cases: report }, null, 2)}\n`);
    if (report.some(item => item.status !== 'COMPLETE' || item.missing.length || item.extra.length || item.provider !== 'deepseek' || item.modelCalls !== 1)) process.exitCode = 2;
}

main().catch(error => { process.stderr.write(`AI_TASK_SEMANTICS_V2_LIVE_FAILED ${error.code || error.message}\n`); process.exitCode = 2; });
