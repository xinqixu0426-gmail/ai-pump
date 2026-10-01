'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { runPipeline } = require('./pipeline.cjs');
const { contextProfiles } = require('./contracts.cjs');
const { evaluateMemo } = require('./evaluatorR5.cjs');

const root = path.resolve(__dirname, '../../..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const businessModel = read('planning/business-understanding/company-business-model-v1.md');
const domainPolicy = [read('api/services/ai-assistant/domain-policy.md'), read('planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md')].join('\n\n');
const args = new Map(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=') || true]; }));
const selected = new Set(String(args.get('cases') || '').split(',').filter(Boolean));
const repeat = new Set(String(args.get('repeat') || '').split(',').filter(Boolean));
const outputPath = args.get('output') ? path.resolve(root, String(args.get('output'))) : null;
function expected(persistence, needsClarification, options = {}) { return Object.freeze({ persistence, needsClarification, ...options }); }
const CASES = Object.freeze([
    { id: 'CASE-01', user: '12-120是什么？', expected: expected('NOT_APPLICABLE', false, { objectGroups: [['12-120']], requiredInformation: [['含义', '是什么']] }) },
    { id: 'CASE-02', user: '12-120多少钱？', expected: expected('NOT_APPLICABLE', false, { objectGroups: [['12-120']], requiredInformation: [['成本', '多少钱', '价格']] }) },
    { id: 'CASE-03', user: 'V750纸箱换成木箱差多少钱？', expected: expected('UNSPECIFIED', false, { objectGroups: [['v750']], requiredChanges: [['纸箱', '木箱', '包装']], requiredInformation: [['成本', '差多少', '价格']] }) },
    { id: 'CASE-04', user: 'V750包装改木箱。', expected: expected('UNSPECIFIED', false, { objectGroups: [['v750']], requiredChanges: [['木箱', '包装']], forbiddenInferences: ['纸箱', '当前包装'] }) },
    { id: 'CASE-05', user: 'V750如果做不锈钢接轴成本差多少？', expected: expected('UNSPECIFIED', false, { objectGroups: [['v750']], requiredChanges: [['不锈钢接轴', '转子工艺']], requiredInformation: [['成本', '差多少', '价格']], forbiddenInferences: ['45#', '默认转子'] }) },
    { id: 'CASE-06', user: 'V750电缆5米，木箱，先算一下，不保存。', expected: expected('DO_NOT_SAVE', false, { objectGroups: [['v750']], requiredChanges: [['电缆', '5米'], ['木箱', '包装']], requiredInformation: [['算', '成本', '试算']] }) },
    { id: 'CASE-07', user: '把V750正式配方包装改成木箱并保存。', expected: expected('SAVE', false, { objectGroups: [['v750']], requiredChanges: [['木箱', '包装']] }) },
    { id: 'CASE-08', user: 'V750做电泳成本会增加多少？', expected: expected('UNSPECIFIED', false, { objectGroups: [['v750']], requiredChanges: [['电泳', '表面处理']], requiredInformation: [['成本', '增加', '差额']] }) },
    { id: 'CASE-09', user: 'V750加浮球以后多少钱？', expected: expected('UNSPECIFIED', false, { objectGroups: [['v750']], requiredChanges: [['浮球']], requiredInformation: [['成本', '多少钱', '价格']] }) },
    { id: 'CASE-10', user: 'V750线圈120片改130片要贵多少？', expected: expected('UNSPECIFIED', false, { objectGroups: [['v750']], requiredChanges: [['线圈', '130片']], requiredInformation: [['成本', '贵多少', '差额']] }) },
    { id: 'CASE-11', user: 'V750机筒加长20mm成本差多少？', expected: expected('UNSPECIFIED', false, { objectGroups: [['v750']], requiredChanges: [['机筒', '20mm']], requiredInformation: [['成本', '差多少', '差额']] }) },
    { id: 'CASE-12', user: '模板和配方有什么区别？', expected: expected('NOT_APPLICABLE', false, { objectGroups: [['模板'], ['配方']], requiredInformation: [['区别', '不同']] }) },
    { id: 'CASE-13', user: '通用款模板有哪些固定件？', expected: expected('NOT_APPLICABLE', false, { objectGroups: [['通用款', '模板']], requiredInformation: [['固定件', '固定零件']] }) },
    { id: 'CASE-14', user: '查一下V750成本，还有它现在用哪个线圈。', expected: expected('NOT_APPLICABLE', false, { objectGroups: [['v750']], requiredInformation: [['成本'], ['线圈']] }) },
    { id: 'CASE-15', recentConversation: '我先看看12-120。', user: '刚才那个线圈多少钱？', expected: expected('NOT_APPLICABLE', false, { objectGroups: [['刚才', '线圈', '12-120']], requiredInformation: [['成本', '多少钱', '价格']] }) },
    { id: 'CASE-16', user: 'V750改一下。', expected: expected('UNSPECIFIED', true, { objectGroups: [['v750']] }) },
    { id: 'CASE-17', user: '12-120有两个方案吧？', expected: expected('NOT_APPLICABLE', false, { objectGroups: [['12-120']], requiredInformation: [['两个', '方案']] }) },
    { id: 'CASE-18', user: 'V750就是一个固定成品吧？', expected: expected('NOT_APPLICABLE', false, { objectGroups: [['v750']], requiredInformation: [['固定成品', '是不是']] }) },
    { id: 'CASE-19', user: '贵多少？', expected: expected('NOT_APPLICABLE', true, { requiredInformation: [['贵多少', '成本', '价格']] }) },
    { id: 'CASE-20', user: '这个换木箱多少钱？', expected: expected('UNSPECIFIED', true, { requiredChanges: [['木箱', '包装']], requiredInformation: [['成本', '多少钱', '价格']], noObjectInference: ['v750', 'recipe', '配方', '纸箱', '当前包装'] }) },
]);
function median(items) { const sorted = [...items].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
async function execute(testCase, env, run) {
    const startedAt = new Date().toISOString();
    try {
        const output = await runPipeline({ userInput: testCase.user, recentConversation: testCase.recentConversation || '', businessModel, domainPolicy }, { env });
        return Object.freeze({ id: testCase.id, run, user: testCase.user, recentConversation: testCase.recentConversation || null, startedAt, ...output, evaluation: evaluateMemo(testCase, output) });
    } catch (error) {
        return Object.freeze({ id: testCase.id, run, user: testCase.user, recentConversation: testCase.recentConversation || null, startedAt, error: error.message, evaluation: { business: 'FAIL', policy: 'FAIL', intent: 'FAIL', evaluator: 'FAIL', overall: 'FAIL', deterministicFailures: ['EXPERIMENT_EXECUTION_FAILED'], reviewRequired: [] } });
    }
}
async function main() {
    const env = { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}) };
    env.DEEPSEEK_MODEL = 'deepseek-chat';
    const base = selected.size ? CASES.filter(item => selected.has(item.id)) : CASES;
    const executions = [];
    for (const testCase of base) executions.push(await execute(testCase, env, 1));
    for (const testCase of CASES.filter(item => repeat.has(item.id))) executions.push(await execute(testCase, env, 2));
    const timed = executions.filter(item => item.timings);
    const metrics = { businessMedianMs: median(timed.map(item => item.timings.businessMs)), policyMedianMs: median(timed.map(item => item.timings.policyMs)), intentMedianMs: median(timed.map(item => item.timings.intentMs)), totalMedianMs: median(timed.map(item => item.timings.totalMs)) };
    const result = { provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, policySource: 'BOOTSTRAP_PLUS_CANDIDATE', ontologyUsed: false, ontologyLlmCalls: 0, ontologyResolverCalls: 0, modelCalls: executions.length * 3, contextProfiles: contextProfiles(), metrics, results: executions };
    if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ ...result, results: result.results.map(item => ({ id: item.id, run: item.run, evaluation: item.evaluation, timings: item.timings, error: item.error || null })) }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { CASES };
