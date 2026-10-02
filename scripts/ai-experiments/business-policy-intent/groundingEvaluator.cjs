'use strict';

function normalize(value) { return String(value || '').replace(/[，。！？、\s]/gu, ''); }

function expressionHasTerms(expression, terms) {
    const value = normalize(expression);
    return terms.every(term => value.includes(normalize(term)));
}

function roleMatches(output, expected) {
    return output.roles.some(actual => actual.role === expected.role && expressionHasTerms(actual.expression, expected.terms || [expected.expression]));
}

function supportedByOwnerWording(expression, testCase) {
    const source = `${testCase.user || ''}\n${testCase.recentOwnerWording || ''}\n${testCase.resolvedLanguageReference || ''}`;
    if (normalize(source).includes(normalize(expression))) return true;
    // A classifier may compose explicitly adjacent model/style qualifiers into
    // a lookup mention (for example 通用款 + V750). Every component must still
    // be present in Owner wording; this never licenses an invented source.
    const composedTerms = String(expression || '').match(/V\d+|[\u4e00-\u9fff]{2,}款/gu) || [];
    return composedTerms.length > 1 && composedTerms.every(term => normalize(source).includes(normalize(term)));
}

function hasForbiddenLeak(text) {
    return /(entity.?type|REQUEST_CLASS|GROUNDING_NEED|resolver|候选|canonical|数据库|工具|API|计划|保存|写入|costEngine)/iu.test(String(text || ''));
}

function evaluateGrounding(testCase, output) {
    const failures = [];
    if (testCase.referenceStatus && output.reference.status !== testCase.referenceStatus) failures.push('REFERENCE_STATUS_INCORRECT');
    if (testCase.referenceSurface && output.reference.surface !== testCase.referenceSurface) failures.push('REFERENCE_SURFACE_INCORRECT');
    if (testCase.resolvedLanguageReference && output.reference.resolvedLanguageReference !== testCase.resolvedLanguageReference) failures.push('REFERENCE_RESOLUTION_INCORRECT');
    if (output.gate !== testCase.gate) failures.push('GATE_INCORRECT');
    if (testCase.roleCalls !== undefined && output.modelCalls.role !== testCase.roleCalls) failures.push('ROLE_CALL_CONTRACT_BREACH');
    if (testCase.resolverCalls !== undefined) {
        const actualCalls = output.formalResults.reduce((sum, item) => sum + item.typeResults.length, 0);
        if (actualCalls !== testCase.resolverCalls) failures.push('RESOLVER_CALL_CONTRACT_BREACH');
    }
    for (const expected of testCase.roles || []) if (!roleMatches(output, expected)) failures.push(`ROLE_NOT_PRESERVED:${expected.terms?.join('+') || expected.expression}`);
    for (const actual of output.roles) if (!supportedByOwnerWording(actual.expression, testCase)) failures.push('UNSUPPORTED_ROLE_SPAN');
    for (const expected of testCase.targets || []) {
        const found = output.formalResults.find(item => expressionHasTerms(item.mention, expected.terms || [expected.mention]));
        if (!found) failures.push('FORMAL_TARGET_NOT_RESOLVED');
        else {
            if (expected.entityType && found.entityType !== expected.entityType) failures.push('RESOLVER_ENTITY_TYPE_INCORRECT');
            if (expected.status && found.status !== expected.status) failures.push('FORMAL_STATUS_INCORRECT');
            if (found.status === 'MULTIPLE' && found.candidates.length < 2) failures.push('MULTIPLE_CANDIDATES_NOT_PRESERVED');
        }
    }
    if ((testCase.targets || []).length > 1 && output.formalResults.length < testCase.targets.length) failures.push('MULTI_TARGET_OMITTED');
    if (output.gate !== 'RUN' && output.formalResults.length) failures.push('STOP_GATE_CALLED_RESOLVER');
    if (output.roles.some(item => item.role !== 'FORMAL_ENTITY_CANDIDATE' && output.formalTargets.some(target => target.mention === item.expression))) failures.push('NON_FORMAL_ROLE_REACHED_RESOLVER');
    if (hasForbiddenLeak(output.roleMemo)) failures.push('ROLE_SCOPE_LEAK');
    if (output.formalResults.some(result => result.status === 'MULTIPLE' && result.canonicalId)) failures.push('SILENT_FIRST_RESULT_BINDING');
    if (output.formalResults.some(result => result.status === 'MULTIPLE_TYPE' && result.entityType)) failures.push('CROSS_TYPE_SILENT_SELECTION');
    return Object.freeze({
        reference: output.reference, gate: output.gate, roles: output.roles, formalResults: output.formalResults,
        failures: Object.freeze([...new Set(failures)]), overall: failures.length ? 'FAIL' : 'PASS',
    });
}

module.exports = { evaluateGrounding, expressionHasTerms, supportedByOwnerWording };
