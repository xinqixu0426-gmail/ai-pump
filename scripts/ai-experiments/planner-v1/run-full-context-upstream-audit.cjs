'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { runBusinessAgent } = require('../business-policy-intent/businessAgent.cjs');
const { runPolicyAgent } = require('../business-policy-intent/policyAgent.cjs');
const { BASE_CASES, NEGATIVE_CASES } = require('./cases.cjs');

const root = path.resolve(__dirname, '../../..');
const IDS = Object.freeze(['P-07', 'P-08', 'P-09', 'P-10', 'P-11', 'P-12', 'P-13', 'P-14', 'P-15', 'P-17', 'N-04', 'N-06']);
const businessModel = fs.readFileSync(path.join(root, 'planning/business-understanding/company-business-model-v1.md'), 'utf8');
const domainPolicy = [fs.readFileSync(path.join(root, 'api/services/ai-assistant/domain-policy.md'), 'utf8'), fs.readFileSync(path.join(root, 'planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md'), 'utf8')].join('\n\n');
function environment() { return { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}), DEEPSEEK_MODEL: 'deepseek-chat' }; }
function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
async function realMemos(userInput, env) {
    const [business, policy] = await Promise.all([
        (async () => { const start = process.hrtime.bigint(); const memo = await runBusinessAgent({ userInput, businessModel }, { env }); return { memo, ms: elapsed(start) }; })(),
        (async () => { const start = process.hrtime.bigint(); const memo = await runPolicyAgent({ userInput, domainPolicy }, { env }); return { memo, ms: elapsed(start) }; })(),
    ]);
    return Object.freeze({ businessMemo: business.memo, policyMemo: policy.memo, timings: Object.freeze({ businessMs: business.ms, policyMs: policy.ms }), modelCalls: Object.freeze({ business: 1, policy: 1 }) });
}
async function main(outputPath) {
    const cases = new Map([...BASE_CASES, ...NEGATIVE_CASES].map(item => [item.id, item]));
    const env = environment(); const results = [];
    for (const id of IDS) {
        const testCase = cases.get(id);
        const memos = await realMemos(testCase.user, env);
        results.push(Object.freeze({ id, rawOwnerInput: testCase.user, ...memos, audit: Object.freeze({ rawOwnerInputPreserved: true, businessMemoPresent: Boolean(memos.businessMemo), policyMemoPresent: Boolean(memos.policyMemo), businessModelSource: 'planning/business-understanding/company-business-model-v1.md', policySources: ['api/services/ai-assistant/domain-policy.md', 'planning/business-understanding/domain-policy-recipe-configurable-cost-v1.md'], businessKnowledgeRequired: id === 'P-12' ? 'rotor process configuration' : id === 'P-13' || id === 'N-04' ? 'cable and packaging configuration' : 'case-specific business meaning', policySemanticsRequired: id === 'P-13' || id === 'N-04' ? 'temporary preview and explicit no-save' : id === 'P-17' ? 'persistent write protected' : 'read/preview boundary', catalogFactRequired: testCase.upstream.finalGroundedTargets.map(target => target.entityType), plannerMissingContext: [] }) }));
    }
    const output = Object.freeze({ phase: 'M4-4K', scope: 'real-frozen-business-policy-handoff', businessModelChars: businessModel.length, domainPolicyChars: domainPolicy.length, modelCalls: { business: results.length, policy: results.length }, results });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ cases: results.length, p12BusinessMemo: results.find(item => item.id === 'P-12').businessMemo, p13PolicyMemo: results.find(item => item.id === 'P-13').policyMemo }, null, 2));
}
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { IDS, realMemos, main, businessModel, domainPolicy, environment };
