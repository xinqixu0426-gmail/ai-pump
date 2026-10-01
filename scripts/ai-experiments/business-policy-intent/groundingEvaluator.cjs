'use strict';

const { extractNeed, extractLanguageTargets, referenceStatus } = require('./groundingMemo.cjs');

function formalStatus(resolution) {
    if (!resolution) return 'UNRESOLVED';
    if (resolution.status === 'RESOLVED') return 'EXACT';
    if (resolution.status === 'AMBIGUOUS') return 'MULTIPLE';
    return 'UNRESOLVED';
}

function hasLeak(text) {
    return /(costEngine|API|工具|Tool|preview|保存|写入|执行计划|先查|调用)/iu.test(String(text || ''));
}

function evaluateGrounding(testCase, output) {
    const memo = String(output.groundingMemo || '');
    const need = extractNeed(memo);
    const targets = extractLanguageTargets(memo);
    const actual = output.resolutions.map(item => ({ mention: item.mention, entityType: item.entityType, status: formalStatus(item.result), result: item.result }));
    const failures = [];
    if (need !== testCase.need) failures.push('GROUNDING_NEED_INCORRECT');
    for (const expected of testCase.targets || []) {
        const found = actual.find(item => item.mention === expected.mention && item.entityType === expected.entityType);
        if (!found) failures.push('TARGET_NOT_PRESERVED');
        else if (expected.status && found.status !== expected.status) failures.push('FORMAL_STATUS_INCORRECT');
        if (found?.status === 'MULTIPLE' && found.result.candidates.length < 2) failures.push('MULTIPLE_CANDIDATES_NOT_PRESERVED');
    }
    if ((testCase.targets || []).length > 1 && actual.length < testCase.targets.length) failures.push('MULTI_TARGET_OMITTED');
    if (testCase.reference === 'UNRESOLVED' && referenceStatus(memo) !== 'UNRESOLVED') failures.push('UNRESOLVED_REFERENCE_NOT_PRESERVED');
    if (testCase.reference === 'RESOLVED' && referenceStatus(memo) !== 'RESOLVED') failures.push('REFERENCE_NOT_RESOLVED');
    if (hasLeak(memo)) failures.push('PLANNER_OR_TOOL_LEAK');
    const silentBinding = actual.some(item => item.status === 'MULTIPLE' && item.result.canonicalId);
    if (silentBinding) failures.push('SILENT_FIRST_RESULT_BINDING');
    return Object.freeze({
        need, targets, actual, referenceStatus: referenceStatus(memo),
        failures: Object.freeze([...new Set(failures)]),
        overall: failures.length ? 'FAIL' : 'PASS',
    });
}

module.exports = { evaluateGrounding, formalStatus };
