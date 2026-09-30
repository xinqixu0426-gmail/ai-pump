'use strict';

function has(text, ...terms) { return terms.some(term => text.includes(term)); }
function evaluateRun(run) {
    const business = run.businessMemo || '';
    const ontology = run.ontologyMemo || '';
    const intent = run.intentMemo || '';
    const all = `${business}\n${ontology}\n${intent}`;
    const evaluators = {
        businessContextRelevance: () => {
            const needs = {
                'CTX-01': ['12-120', 'common'], 'CTX-02': ['12-120'], 'CTX-03': ['包装', 'V750'], 'CTX-04': ['不锈钢接轴'],
                'CTX-05': ['电缆', '包装'], 'CTX-06': ['包装'], 'CTX-07': ['包装'], 'CTX-08': ['模板', '配方'],
                'CTX-09': ['模板', '固定'], 'CTX-10': ['配方', '线圈'], 'CTX-11': ['12-120'], 'CTX-12': ['V750'],
                'ADV-01': ['12-120'], 'ADV-02': ['V750'], 'ADV-03': ['木箱', '纸箱'], 'ADV-04': ['木箱'],
            }[run.id] || [];
            return needs.every(term => business.includes(term));
        },
        policyRelevance: () => !/完整规则如下|RULE-01.{0,30}RULE-08/s.test(business),
        ontologyContextRelevance: () => {
            const needDesignation = ['CTX-01', 'CTX-02', 'CTX-11', 'ADV-01'].includes(run.id);
            const needRecipe = /V750/.test(run.userInput);
            const needTemplate = /模板/.test(run.userInput);
            return (!needDesignation || /12-120|coil\.commonDesignation|common designation/i.test(ontology))
                && (!needRecipe || /recipe|配方/i.test(ontology)) && (!needTemplate || /template|模板/i.test(ontology));
        },
        noFormalFactHallucination: () => !/(当前数据库有|数据库中有|目前有\d+个|现有\d+个|成本是\s*[¥￥]?\d|库存为\s*\d+)/.test(all),
        intentCompleteness: () => {
            const rules = {
                'CTX-01': t => has(t, '含义', '是什么') && t.includes('12-120'),
                'CTX-02': t => t.includes('成本') && t.includes('12-120'),
                'CTX-03': t => t.includes('纸箱') && t.includes('木箱') && t.includes('成本') && t.includes('差'),
                'CTX-04': t => t.includes('不锈钢接轴') && t.includes('成本') && !/普通零件/.test(t),
                'CTX-05': t => t.includes('5米') && t.includes('木箱') && /(不保存|不持久|临时|先算)/.test(t),
                'CTX-06': t => t.includes('木箱') && /(保存|持久|正式修改)/.test(t),
                'CTX-07': t => t.includes('木箱') && /(未明确|没有明确|未说明|不明确)/.test(t),
                'CTX-08': t => t.includes('模板') && t.includes('配方') && /(区别|比较|不同)/.test(t),
                'CTX-09': t => t.includes('固定') && /(零件|固定件)/.test(t),
                'CTX-10': t => t.includes('成本') && /(线圈|配置的线圈)/.test(t),
                'CTX-11': t => /(12-120|刚才那个线圈)/.test(t) && t.includes('成本'),
                'CTX-12': t => t.includes('V750') && /(改什么|没有说明|未说明)/.test(t),
                'ADV-01': t => t.includes('12-120') && /(是否|询问|问)/.test(t),
                'ADV-02': t => t.includes('固定成品') && /(是否|询问|问)/.test(t),
                'ADV-03': t => t.includes('木箱') && t.includes('纸箱') && /(缺少|未提供|哪个配方|配方上下文)/.test(t),
                'ADV-04': t => t.includes('木箱') && /(指代|对象|不知道|不清楚)/.test(t),
            }[run.id];
            return rules ? rules(intent) : false;
        },
        intentBoundary: () => !/(意图不清楚|目标不明确)/.test(intent) || ['CTX-12', 'ADV-03', 'ADV-04'].includes(run.id),
        languageFidelity: () => !/(木箱并保存|正式保存)/.test(intent) || ['CTX-06'].includes(run.id),
    };
    const intentDimensions = new Set(['intentCompleteness', 'intentBoundary', 'languageFidelity']);
    const dims = Object.fromEntries(Object.entries(evaluators).map(([key, fn]) => [key, Boolean(fn(intentDimensions.has(key) ? intent : all))]));
    const businessOk = dims.businessContextRelevance;
    const ontologyOk = dims.ontologyContextRelevance && dims.noFormalFactHallucination;
    const intentOk = dims.intentCompleteness && dims.intentBoundary && dims.languageFidelity;
    const failed = Object.values(dims).filter(value => !value).length;
    const critical = ['CTX-02','CTX-03','CTX-04','CTX-05','CTX-06','CTX-10','CTX-11','ADV-04'].includes(run.id) && !intentOk;
    return Object.freeze({ dimensions: dims, business: businessOk ? 'PASS' : failed > 2 ? 'FAIL' : 'PARTIAL',
        ontology: ontologyOk ? 'PASS' : failed > 2 ? 'FAIL' : 'PARTIAL', intent: intentOk ? 'PASS' : failed > 2 ? 'FAIL' : 'PARTIAL',
        overall: failed === 0 ? 'PASS' : failed <= 2 ? 'PARTIAL' : 'FAIL', criticalFailure: critical });
}

module.exports = { evaluateRun };
