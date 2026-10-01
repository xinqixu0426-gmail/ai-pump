'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { runGroundingPipeline } = require('./groundingPipeline.cjs');
const { createGroundingFixture } = require('./groundingFixture.cjs');
const { evaluateGrounding } = require('./groundingEvaluator.cjs');

const root = path.resolve(__dirname, '../../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const businessModel = read('planning/business-understanding/company-business-model-v1.md');
const domainPolicy = [read('api/services/ai-assistant/domain-policy.md'), read('planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md')].join('\n\n');
const args = new Map(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=') || true]; }));
const selected = new Set(String(args.get('cases') || '').split(',').filter(Boolean));
const repeat = new Set(String(args.get('repeat') || '').split(',').filter(Boolean));
const outputPath = args.get('output') ? path.resolve(root, String(args.get('output'))) : null;
const target = (mention, entityType, status) => Object.freeze({ mention, entityType, status });
const CASES = Object.freeze([
    { id: 'G-01', user: '模板和配方有什么区别？', need: 'NOT_REQUIRED' },
    { id: 'G-02', user: '12-120是什么意思？', need: 'NOT_REQUIRED' },
    { id: 'G-03', user: '12-120多少钱？', need: 'REQUIRED', targets: [target('12-120', 'coil', 'MULTIPLE')] },
    { id: 'G-04', user: '12-120有两个方案吧？', need: 'REQUIRED', targets: [target('12-120', 'coil', 'MULTIPLE')] },
    { id: 'G-05', user: '查一下V750成本。', need: 'REQUIRED', targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-06', user: '查一下V750现在用哪个线圈。', need: 'REQUIRED', targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-07', user: '通用款模板有哪些固定件？', need: 'REQUIRED', targets: [target('通用款模板', 'template', 'EXACT')] },
    { id: 'G-08', user: 'V750如果做不锈钢接轴成本差多少？', need: 'REQUIRED', targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-09', user: 'V750加浮球以后多少钱？', need: 'REQUIRED', targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-10', user: 'V750纸箱换木箱差多少钱？', need: 'REQUIRED', targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-11', user: '刚才那个线圈多少钱？', recentOwnerWording: '我先看看12-120。', need: 'REQUIRED', reference: 'RESOLVED', targets: [target('12-120', 'coil', 'MULTIPLE')] },
    { id: 'G-12', user: '这个换木箱多少钱？', need: 'REQUIRED', reference: 'UNRESOLVED' },
    { id: 'G-13', user: '它现在成本多少？', recentOwnerWording: '刚才看的是V750通用款。', need: 'REQUIRED', reference: 'RESOLVED', targets: [target('V750通用款', 'recipe', 'EXACT')] },
    { id: 'G-14', user: 'V750就是固定成品吧？', need: 'NOT_REQUIRED' },
    { id: 'G-15', user: 'V750包装改木箱。', need: 'REQUIRED', targets: [target('V750', 'recipe', 'MULTIPLE')] },
    { id: 'G-16', user: '木箱和纸箱在我们系统里分别算什么？', need: 'NOT_REQUIRED' },
    { id: 'N-01', user: '随便看看模板是什么', need: 'NOT_REQUIRED' },
    { id: 'N-02', user: '这个多少钱？', need: 'REQUIRED', reference: 'UNRESOLVED' },
    { id: 'N-03', user: 'V750、V110现在分别多少钱？', need: 'REQUIRED', targets: [target('V750', 'recipe', 'MULTIPLE'), target('V110', 'recipe', 'EXACT')] },
    { id: 'N-04', user: '12-120和12-130分别多少钱？', need: 'REQUIRED', targets: [target('12-120', 'coil', 'MULTIPLE'), target('12-130', 'coil', 'EXACT')] },
    { id: 'N-05', user: '通用款和豪贝款的V750成本分别多少？', need: 'REQUIRED', targets: [target('通用款V750', 'recipe', 'EXACT'), target('豪贝款V750', 'recipe', 'EXACT')] },
]);
function median(items) { const sorted = [...items].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
async function execute(testCase, env, run, fixture) {
    const startedAt = new Date().toISOString();
    let resolverCalls = 0;
    try {
        const output = await runGroundingPipeline({ userInput: testCase.user, recentOwnerWording: testCase.recentOwnerWording || '', businessModel, domainPolicy }, {
            env,
            lookupEntities: async (_fetch, request) => {
                resolverCalls += 1;
                return fixture.lookupEntities(request);
            },
            internalFetch: () => { throw new Error('GROUNDING_FIXTURE_LOOKUP_DOES_NOT_FETCH'); },
        });
        return Object.freeze({ id: testCase.id, run, user: testCase.user, recentOwnerWording: testCase.recentOwnerWording || null,
            startedAt, ...output, resolverCalls, evaluation: evaluateGrounding(testCase, output) });
    } catch (error) {
        return Object.freeze({ id: testCase.id, run, user: testCase.user, recentOwnerWording: testCase.recentOwnerWording || null,
            startedAt, error: error.message, resolverCalls, evaluation: { overall: 'FAIL', failures: ['EXPERIMENT_EXECUTION_FAILED'] } });
    }
}
async function main() {
    const env = { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}) };
    env.DEEPSEEK_MODEL = 'deepseek-chat';
    const base = selected.size ? CASES.filter(item => selected.has(item.id)) : CASES;
    const fixture = createGroundingFixture();
    try {
        console.error(`M4-3A grounding smoke starting: ${base.length + [...repeat].length} runs`);
        const executions = [];
        for (const testCase of base) executions.push(await execute(testCase, env, 1, fixture));
        for (const testCase of CASES.filter(item => repeat.has(item.id))) executions.push(await execute(testCase, env, 2, fixture));
        const timed = executions.filter(item => item.timings);
        const metrics = { businessMedianMs: median(timed.map(item => item.timings.businessMs)), policyMedianMs: median(timed.map(item => item.timings.policyMs)), groundingModelMedianMs: median(timed.map(item => item.timings.groundingModelMs)), groundingResolverMedianMs: median(timed.map(item => item.timings.resolverMs)), totalMedianMs: median(timed.map(item => item.timings.totalMs)) };
        const result = { provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, policySource: 'BOOTSTRAP_PLUS_CANDIDATE', ontologyUsed: true, ontologyLlmCalls: 0, ontologyResolverCalls: executions.reduce((sum, item) => sum + item.resolverCalls, 0), intentAgentCalls: 0, utteranceExtractorCalls: 0, modelCalls: executions.length * 3, fixtureSource: fixture.source, metrics, results: executions };
        if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
        console.log(JSON.stringify({ ...result, results: result.results.map(item => ({ id: item.id, run: item.run, evaluation: item.evaluation, timings: item.timings, resolverCalls: item.resolverCalls, error: item.error || null })) }, null, 2));
    } finally { fixture.close(); }
}
if (process.argv[1] && path.basename(process.argv[1]) === 'run-grounding-smoke.cjs') {
    const keepAlive = setInterval(() => {}, 1_000);
    main().catch(error => { console.error(error.stack || error); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
}
module.exports = { CASES };
