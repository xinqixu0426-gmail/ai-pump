'use strict';

const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { runBusinessAgent } = require('./businessAgent.cjs');
const { runSemanticAgent } = require('./semanticAgent.cjs');
const { runOntologyAgent } = require('./ontologyAgent.cjs');
const { contextProfiles } = require('./contracts.cjs');

const root = path.resolve(__dirname, '../../..');
const businessModel = fs.readFileSync(path.join(root, 'planning/business-understanding/company-business-model-v1.md'), 'utf8');
const args = new Map(process.argv.slice(2).map(value => { const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=') || true]; }));
const selected = new Set(String(args.get('cases') || '').split(',').filter(Boolean));
const repeat = new Set(String(args.get('repeat') || '').split(',').filter(Boolean));

const CASES = Object.freeze([
    { id: 'ISO-01', user: '12-120是什么？' },
    { id: 'ISO-02', user: '12-120多少钱？' },
    { id: 'ISO-03', user: 'V750纸箱换成木箱差多少钱？' },
    { id: 'ISO-04', user: 'V750如果做不锈钢接轴成本差多少？' },
    { id: 'ISO-05', user: '把V750正式配方包装改成木箱并保存。' },
    { id: 'ISO-06', user: 'V750电缆5米，木箱，先算一下，不保存。' },
    { id: 'ISO-07', user: '模板和配方有什么区别？' },
    { id: 'ISO-08', user: '通用款模板有哪些固定件？' },
    { id: 'ISO-09', user: '刚才那个线圈多少钱？', languageContext: '上一轮用户说：我先看一下12-120。该上下文没有 canonical identity。' },
    { id: 'ISO-10', user: 'V750改一下。' },
]);
function string(value) { return JSON.stringify(value); }
function contains(value, text) { return string(value).includes(text); }
function layerLeak(contract, layer) {
    const text = string(contract);
    if (layer === 'business') {
        if (/\b(?:recipe|coil|part)-[\w-]+\b/i.test(text) || /\b(?:tool|api|capability)\b/i.test(text)) return 'BUSINESS_LEAK';
        if (/(PREVIEW|PERSIST|SAVE|DO_NOT_SAVE)/.test(text)) return 'BUSINESS_POLICY_LEAK';
    }
    if (layer === 'semantic') {
        if (/\b(?:recipe|coil|part)-[\w-]+\b/i.test(text) || /\b(?:tool|api|capability)\b/i.test(text)) return 'SEMANTIC_LEAK';
        if (/(PREVIEW|PERSIST_REQUESTED|AMBIGUOUS|candidates)/.test(text)) return 'SEMANTIC_ONTOLOGY_OR_POLICY_LEAK';
    }
    if (layer === 'ontology' && /(成本|库存|预览|保存|写入|成本差额|PREVIEW|PERSIST)/.test(text)) return 'ONTOLOGY_BUSINESS_LEAK';
    return null;
}
function hasBinding(grounding, mention, status) { return grounding.bindings.some(item => item.mention === mention && item.status === status); }
function evaluate(item) {
    const { id, business, semantic, grounding } = item;
    if (!business || !semantic || !grounding) {
        return Object.freeze({ business: !item.businessError, semantic: !item.semanticError,
            ontology: !item.ontologyError, overall: false,
            failures: [item.businessError, item.semanticError, item.ontologyError].filter(Boolean) });
    }
    const businessLeak = layerLeak(business, 'business'); const semanticLeak = layerLeak(semantic, 'semantic'); const ontologyLeak = layerLeak(grounding, 'ontology');
    const common = { business: !businessLeak, semantic: !semanticLeak, ontology: !ontologyLeak };
    const mention = value => semantic.mentions.includes(value);
    const change = value => semantic.requestedChanges.some(item => contains(item, value));
    const info = value => semantic.requestedInformation.some(item => item.includes(value));
    const missing = value => semantic.missingSemanticInformation.some(item => item.includes(value));
    const ref = value => semantic.references.some(item => item.type === 'CONVERSATION_REFERENCE' && item.text.includes(value));
    const extra = (() => {
        switch (id) {
        case 'ISO-01': return mention('12-120') && info('含义') && semantic.missingSemanticInformation.length === 0 && hasBinding(grounding, '12-120', 'AMBIGUOUS');
        case 'ISO-02': return mention('12-120') && info('成本') && semantic.explicitPersistenceSignal === 'NONE' && semantic.missingSemanticInformation.length === 0 && hasBinding(grounding, '12-120', 'AMBIGUOUS');
        case 'ISO-03': return mention('V750') && change('木箱') && info('成本') && semantic.explicitPersistenceSignal === 'NONE' && hasBinding(grounding, 'V750', 'AMBIGUOUS');
        case 'ISO-04': return mention('V750') && mention('不锈钢接轴') && change('不锈钢接轴') && info('成本') && semantic.explicitPersistenceSignal === 'NONE' && !contains(grounding, 'PART');
        case 'ISO-05': return change('木箱') && semantic.explicitPersistenceSignal === 'SAVE' && grounding.bindings.some(item => item.mention.startsWith('V750'));
        case 'ISO-06': return change('5米') && change('木箱') && semantic.explicitPersistenceSignal === 'DO_NOT_SAVE' && grounding.bindings.some(item => item.mention === 'V750');
        case 'ISO-07': return mention('模板') && mention('配方') && info('区别') && grounding.bindings.length === 0;
        case 'ISO-08': return mention('通用款模板') && info('固定') && hasBinding(grounding, '通用款模板', 'UNIQUE');
        case 'ISO-09': return ref('刚才那个线圈') && info('成本') && hasBinding(grounding, '12-120', 'AMBIGUOUS');
        case 'ISO-10': return mention('V750') && missing('修改') && missing('改成') && grounding.bindings.some(item => item.mention === 'V750');
        default: return false;
        }
    })();
    return Object.freeze({ business: common.business, semantic: common.semantic && extra, ontology: common.ontology && extra,
        overall: common.business && common.semantic && common.ontology && extra, failures: [businessLeak, semanticLeak, ontologyLeak].filter(Boolean) });
}
async function execute(testCase, env) {
    let business;
    try { business = await runBusinessAgent({ userInput: testCase.user, businessModel }, { env }); }
    catch (error) { return Object.freeze({ id: testCase.id, business: null, semantic: null, grounding: null, businessError: error.message }); }
    let semantic;
    try { semantic = await runSemanticAgent({ userInput: testCase.user, businessContract: business, languageContext: testCase.languageContext || '' }, { env }); }
    catch (error) { return Object.freeze({ id: testCase.id, business, semantic: null, grounding: null, semanticError: error.message }); }
    try {
        const grounding = runOntologyAgent({ semanticContract: semantic, businessContract: business });
        return Object.freeze({ id: testCase.id, business, semantic, grounding });
    } catch (error) {
        return Object.freeze({ id: testCase.id, business, semantic, grounding: null, ontologyError: error.message });
    }
}
async function main() {
    const env = { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}) };
    env.DEEPSEEK_MODEL = 'deepseek-chat';
    const base = selected.size ? CASES.filter(item => selected.has(item.id)) : CASES;
    const executions = [];
    for (const testCase of base) executions.push({ run: 1, ...(await execute(testCase, env)) });
    for (const testCase of CASES.filter(item => repeat.has(item.id))) executions.push({ run: 2, ...(await execute(testCase, env)) });
    const results = executions.map(item => ({ ...item, result: evaluate(item) }));
    console.log(JSON.stringify({ provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, ontologyLlmCalls: 0, modelCalls: results.length * 2,
        contextProfiles: contextProfiles(), results }, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });

module.exports = { CASES, evaluate };
