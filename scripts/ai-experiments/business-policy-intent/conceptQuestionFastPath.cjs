'use strict';

const FORMAL_FACT_SIGNALS = Object.freeze([
    '多少钱', '价格', '成本', '库存', '现货', '几个方案', '多少方案', '哪个', '哪些',
    '现在', '当前', '用了什么', '用哪个', '有哪些固定件', '固定件列表', '数量', '报价',
    '配方内容', 'BOM内容', '正式记录',
]);

function withoutTerminalPunctuation(value) {
    return String(value || '').trim().replace(/[？?。！!]+$/u, '');
}

function detectConceptQuestionFastPath(workingUtterance) {
    const source = String(workingUtterance || '');
    const sentence = withoutTerminalPunctuation(source);
    const formalSignals = FORMAL_FACT_SIGNALS.filter(signal => sentence.includes(signal));
    const base = {
        source: 'DETERMINISTIC_CONCEPT_FAST_PATH',
        workingUtterance: source,
        negativeFormalFactSignalsChecked: FORMAL_FACT_SIGNALS,
        detectedFormalFactSignals: formalSignals,
    };
    if (!sentence || formalSignals.length) return Object.freeze({ ...base, status: 'NOT_MATCHED', patternFamily: null, matchedSurface: null, reason: formalSignals.length ? 'FORMAL_FACT_SIGNAL_PRESENT' : 'EMPTY_INPUT' });

    const patterns = [
        ['DEFINITION_WHAT_IS', /^.+?(?:到底)?(?:在我们(?:这里|业务里)?|在系统里)?是什么$/u],
        ['DEFINITION_WHAT_DOES_IT_MEAN', /^.+?(?:代表)?什么意思$/u],
        ['DEFINITION_NAMING_MEANING', /^.+?这个叫法是什么意思$/u],
        ['CONCEPT_COMPARISON', /^.+?(?:和|跟|与).+?(?:有什么)?区别(?:是什么)?$/u],
        ['BUSINESS_CLASSIFICATION', /^.+?(?:在我们(?:这里|业务里)?|在系统里)(?:分别)?算什么$/u],
        ['BUSINESS_CLASSIFICATION', /^.+?属于什么业务概念$/u],
        ['BUSINESS_CLASSIFICATION', /^.+?(?:(?:在我们(?:这里|业务里)?|在系统里)(?:是|算)|算|是)配置还是固定件$/u],
        ['DEFINITION_CONFIRMATION', /^.+?(?:就是|算).+吧$/u],
    ];
    const match = patterns.find(([, pattern]) => pattern.test(sentence));
    if (!match) return Object.freeze({ ...base, status: 'NOT_MATCHED', patternFamily: null, matchedSurface: null, reason: 'NO_HIGH_PRECISION_CONCEPT_PATTERN' });
    return Object.freeze({ ...base, status: 'MATCHED_CONCEPT_ONLY', patternFamily: match[0], matchedSurface: sentence, reason: 'HIGH_PRECISION_CONCEPT_PATTERN' });
}

module.exports = { FORMAL_FACT_SIGNALS, detectConceptQuestionFastPath };
