'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { runGroundingPipeline, FANOUT_ENTITY_TYPES } = require('./groundingPipeline.cjs');
const { createGroundingFixture } = require('./groundingFixture.cjs');
const { evaluateGrounding } = require('./groundingEvaluator.cjs');

const root = path.resolve(__dirname, '../../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const businessModel = read('planning/business-understanding/company-business-model-v1.md');
const domainPolicy = [read('api/services/ai-assistant/domain-policy.md'), read('planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md')].join('\n\n');
const args = new Map(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=') || true]; }));
const scope = String(args.get('scope') || 'targeted');
const outputPath = args.get('output') ? path.resolve(root, String(args.get('output'))) : null;

const role = (terms, roleName) => Object.freeze({ terms: Array.isArray(terms) ? terms : [terms], role: roleName });
const target = (terms, entityType, status) => Object.freeze({ terms: Array.isArray(terms) ? terms : [terms], entityType, status });
const formal = value => role(value, 'FORMAL_ENTITY_CANDIDATE');
const config = value => role(value, 'CONFIG_VALUE');
const concept = value => role(value, 'CONCEPT_ONLY');
const resolverCallsFor = targets => (targets || []).length * FANOUT_ENTITY_TYPES.length;

const TARGETED_CASES = Object.freeze([
    { id: 'T-01', user: '这个换木箱多少钱？', referenceStatus: 'UNRESOLVED', referenceSurface: '这个', gate: 'STOP_UNRESOLVED_REFERENCE', roleCalls: 0, resolverCalls: 0 },
    { id: 'T-02', user: '这个多少钱？', referenceStatus: 'UNRESOLVED', referenceSurface: '这个', gate: 'STOP_UNRESOLVED_REFERENCE', roleCalls: 0, resolverCalls: 0 },
    { id: 'T-03', user: 'V750换木箱多少钱？', referenceStatus: 'NONE', roles: [formal('V750'), config('木箱')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'T-04', user: 'V750加浮球多少钱？', referenceStatus: 'NONE', roles: [formal('V750'), config('浮球')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'T-05', user: 'V750做电泳成本差多少？', referenceStatus: 'NONE', roles: [formal('V750'), config('电泳')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'T-06', user: 'V750如果做不锈钢接轴成本差多少？', referenceStatus: 'NONE', roles: [formal('V750'), config('不锈钢接轴')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'T-07', user: '12-120多少钱？', referenceStatus: 'NONE', roles: [formal('12-120')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('12-120', 'coil', 'MULTIPLE')] },
    { id: 'T-08', user: '12-120有两个方案吧？', referenceStatus: 'NONE', roles: [formal('12-120')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('12-120', 'coil', 'MULTIPLE')] },
    { id: 'T-09', user: '模板和配方有什么区别？', referenceStatus: 'NONE', roles: [concept('模板'), concept('配方')], gate: 'STOP_CONCEPT_ONLY', roleCalls: 1, resolverCalls: 0 },
    { id: 'T-10', user: '刚才那个线圈多少钱？', recentOwnerWording: '我先看看12-120。', referenceStatus: 'RESOLVED', referenceSurface: '刚才那个线圈', resolvedLanguageReference: '12-120', roles: [formal('12-120')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('12-120', 'coil', 'MULTIPLE')] },
]);

const FULL_CASES = Object.freeze([
    { id: 'G-01', user: '模板和配方有什么区别？', referenceStatus: 'NONE', roles: [concept('模板'), concept('配方')], gate: 'STOP_CONCEPT_ONLY', roleCalls: 1, resolverCalls: 0 },
    { id: 'G-02', user: '12-120是什么意思？', referenceStatus: 'NONE', roles: [concept('12-120')], gate: 'STOP_CONCEPT_ONLY', roleCalls: 1, resolverCalls: 0 },
    { id: 'G-03', user: '12-120多少钱？', referenceStatus: 'NONE', roles: [formal('12-120')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('12-120', 'coil', 'MULTIPLE')] },
    { id: 'G-04', user: '12-120有两个方案吧？', referenceStatus: 'NONE', roles: [formal('12-120')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('12-120', 'coil', 'MULTIPLE')] },
    { id: 'G-05', user: '查一下V750成本。', referenceStatus: 'NONE', roles: [formal('V750')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-06', user: '查一下V750现在用哪个线圈。', referenceStatus: 'NONE', roles: [formal('V750')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-07', user: '通用款模板有哪些固定件？', referenceStatus: 'NONE', roles: [formal('通用款模板')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('通用款模板', 'template', 'EXACT')] },
    { id: 'G-08', user: 'V750如果做不锈钢接轴成本差多少？', referenceStatus: 'NONE', roles: [formal('V750'), config('不锈钢接轴')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-09', user: 'V750加浮球以后多少钱？', referenceStatus: 'NONE', roles: [formal('V750'), config('浮球')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-10', user: 'V750纸箱换木箱差多少钱？', referenceStatus: 'NONE', roles: [formal('V750'), config('纸箱'), config('木箱')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-11', user: '刚才那个线圈多少钱？', recentOwnerWording: '我先看看12-120。', referenceStatus: 'RESOLVED', referenceSurface: '刚才那个线圈', resolvedLanguageReference: '12-120', roles: [formal('12-120')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('12-120', 'coil', 'MULTIPLE')] },
    { id: 'G-12', user: '这个换木箱多少钱？', referenceStatus: 'UNRESOLVED', referenceSurface: '这个', gate: 'STOP_UNRESOLVED_REFERENCE', roleCalls: 0, resolverCalls: 0 },
    { id: 'G-13', user: '它现在成本多少？', recentOwnerWording: '刚才看的是V750通用款。', referenceStatus: 'RESOLVED', referenceSurface: '它', resolvedLanguageReference: 'V750通用款', roles: [formal(['V750', '通用款'])], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target(['V750', '通用款'], 'recipe', 'EXACT')] },
    { id: 'G-14', user: 'V750就是固定成品吧？', referenceStatus: 'NONE', roles: [concept('V750')], gate: 'STOP_CONCEPT_ONLY', roleCalls: 1, resolverCalls: 0 },
    { id: 'G-15', user: 'V750包装改木箱。', referenceStatus: 'NONE', roles: [formal('V750'), config('木箱')], gate: 'RUN', roleCalls: 1, resolverCalls: 4, targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-16', user: '木箱和纸箱在我们系统里分别算什么？', referenceStatus: 'NONE', roles: [concept('木箱'), concept('纸箱')], gate: 'STOP_CONCEPT_ONLY', roleCalls: 1, resolverCalls: 0 },
    { id: 'N-01', user: '随便看看模板是什么', referenceStatus: 'NONE', roles: [concept('模板')], gate: 'STOP_CONCEPT_ONLY', roleCalls: 1, resolverCalls: 0 },
    { id: 'N-02', user: '这个多少钱？', referenceStatus: 'UNRESOLVED', referenceSurface: '这个', gate: 'STOP_UNRESOLVED_REFERENCE', roleCalls: 0, resolverCalls: 0 },
    { id: 'N-03', user: 'V750、V110现在分别多少钱？', referenceStatus: 'NONE', roles: [formal('V750'), formal('V110')], gate: 'RUN', roleCalls: 1, resolverCalls: 8, targets: [target('V750', 'recipe', 'MULTIPLE'), target('V110', 'recipe', 'EXACT')] },
    { id: 'N-04', user: '12-120和12-130分别多少钱？', referenceStatus: 'NONE', roles: [formal('12-120'), formal('12-130')], gate: 'RUN', roleCalls: 1, resolverCalls: 8, targets: [target('12-120', 'coil', 'MULTIPLE'), target('12-130', 'coil', 'EXACT')] },
    { id: 'N-05', user: '通用款和豪贝款的V750成本分别多少？', referenceStatus: 'NONE', roles: [formal(['V750', '通用款']), formal(['V750', '豪贝款'])], gate: 'RUN', roleCalls: 1, resolverCalls: 8, targets: [target(['V750', '通用款'], 'recipe', 'EXACT'), target(['V750', '豪贝款'], 'recipe', 'EXACT')] },
]);

const FULL_REPEATS = Object.freeze(['G-03', 'G-05', 'G-06', 'G-07', 'G-08', 'G-11', 'G-12', 'G-13', 'N-03', 'N-05']);
function median(items) { const sorted = [...items].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }

async function execute(testCase, env, run, fixture) {
    const startedAt = new Date().toISOString();
    try {
        const output = await runGroundingPipeline({ userInput: testCase.user, recentOwnerWording: testCase.recentOwnerWording || '', businessModel, domainPolicy }, {
            env,
            lookupEntities: async (_fetch, request) => fixture.lookupEntities(request),
            internalFetch: () => { throw new Error('GROUNDING_FIXTURE_LOOKUP_DOES_NOT_FETCH'); },
        });
        return Object.freeze({ id: testCase.id, run, user: testCase.user, recentOwnerWording: testCase.recentOwnerWording || null, startedAt, ...output, evaluation: evaluateGrounding(testCase, output) });
    } catch (error) {
        return Object.freeze({ id: testCase.id, run, user: testCase.user, recentOwnerWording: testCase.recentOwnerWording || null, startedAt, error: error.message, evaluation: { overall: 'FAIL', failures: ['EXPERIMENT_EXECUTION_FAILED'] } });
    }
}

async function main() {
    const env = { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}) };
    env.DEEPSEEK_MODEL = 'deepseek-chat';
    const base = scope === 'full' ? FULL_CASES : TARGETED_CASES;
    const repeats = scope === 'full' ? FULL_CASES.filter(item => FULL_REPEATS.includes(item.id)) : [];
    const fixture = createGroundingFixture();
    try {
        console.error(`M4-3A-R4 ${scope} grounding smoke starting: ${base.length + repeats.length} runs`);
        const executions = [];
        for (const testCase of base) executions.push(await execute(testCase, env, 1, fixture));
        for (const testCase of repeats) executions.push(await execute(testCase, env, 2, fixture));
        const timed = executions.filter(item => item.timings);
        const modelCalls = executions.reduce((sum, item) => sum + (item.modelCalls ? Object.values(item.modelCalls).reduce((subtotal, value) => subtotal + value, 0) : 0), 0);
        const resolverCalls = executions.reduce((sum, item) => sum + (item.formalResults?.reduce((subtotal, result) => subtotal + result.typeResults.length, 0) || 0), 0);
        const metrics = { businessMedianMs: median(timed.map(item => item.timings.businessMs)), policyMedianMs: median(timed.map(item => item.timings.policyMs)), referenceMedianMs: median(timed.map(item => item.timings.referenceMs)), roleMedianMs: median(timed.map(item => item.timings.roleMs)), resolverFanoutMedianMs: median(timed.map(item => item.timings.resolverFanoutMs)), totalMedianMs: median(timed.map(item => item.timings.totalMs)) };
        const result = { phase: 'M4-3A-R4', scope, provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, policySource: 'BOOTSTRAP_PLUS_CANDIDATE', ontologyUsed: true, intentAgentCalls: 0, utteranceExtractorCalls: 0, modelCalls, resolverCalls, fixtureSource: fixture.source, metrics, results: executions };
        if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(JSON.stringify({ ...result, results: executions.map(item => ({ id: item.id, run: item.run, evaluation: item.evaluation, reference: item.reference, roles: item.roles, gate: item.gate, formalResults: item.formalResults?.map(value => ({ mention: value.mention, entityType: value.entityType, status: value.status, typeResults: value.typeResults.map(type => ({ entityType: type.entityType, status: type.result.status })) })), timings: item.timings, error: item.error || null })) }, null, 2));
    } finally { fixture.close(); }
}

if (process.argv[1] && path.basename(process.argv[1]) === 'run-grounding-smoke.cjs') {
    const keepAlive = setInterval(() => {}, 1_000);
    main().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
}

module.exports = { TARGETED_CASES, FULL_CASES, FULL_REPEATS, execute, resolverCallsFor };
