'use strict';

function formalStatus(resolution) {
    if (!resolution) return 'UNRESOLVED';
    if (resolution.status === 'RESOLVED') return 'EXACT';
    if (resolution.status === 'AMBIGUOUS') return 'MULTIPLE';
    return 'UNRESOLVED';
}

function hasForbiddenLeak(text) {
    return /(调用\s*(?:resolver|API|工具)|costEngine|preview|persist|工具计划|执行计划|写入|保存|数据库(?:\s*(?:ID|记录))?)/iu.test(String(text || ''));
}

function hasRole(output, expected) {
    return output.roles.some(role => role.expression === expected.expression && role.role === expected.role && (!expected.entityType || role.entityType === expected.entityType));
}

function evaluateGrounding(testCase, output) {
    const failures = [];
    const actual = output.resolutions.map(item => ({ mention: item.mention, entityType: item.entityType, status: formalStatus(item.result), result: item.result }));
    if (output.requestClass !== testCase.requestClass) failures.push('REQUEST_CLASS_INCORRECT');
    if (testCase.referenceStatus && output.reference.status !== testCase.referenceStatus) failures.push('REFERENCE_STATUS_INCORRECT');
    if (testCase.referenceSurface && output.reference.surface !== testCase.referenceSurface) failures.push('REFERENCE_SURFACE_INCORRECT');
    if (testCase.resolvedLanguageReference && output.reference.resolvedLanguageReference !== testCase.resolvedLanguageReference) failures.push('REFERENCE_RESOLUTION_INCORRECT');
    for (const expected of testCase.roles || []) if (!hasRole(output, expected)) failures.push(`ROLE_NOT_PRESERVED:${expected.expression}`);
    for (const expected of testCase.targets || []) {
        const found = actual.find(item => item.mention === expected.mention && item.entityType === expected.entityType);
        if (!found) failures.push('FORMAL_TARGET_NOT_RESOLVED');
        else if (expected.status && found.status !== expected.status) failures.push('FORMAL_STATUS_INCORRECT');
        if (found?.status === 'MULTIPLE' && found.result.candidates.length < 2) failures.push('MULTIPLE_CANDIDATES_NOT_PRESERVED');
    }
    if ((testCase.targets || []).length > 1 && actual.length < testCase.targets.length) failures.push('MULTI_TARGET_OMITTED');
    if (output.gate !== testCase.gate) failures.push('GATE_INCORRECT');
    if (output.groundingNeed !== testCase.need) failures.push('GROUNDING_NEED_INCORRECT');
    if (testCase.resolverCalls !== undefined && output.resolutions.length !== testCase.resolverCalls) failures.push('RESOLVER_CALL_CONTRACT_BREACH');
    const nonFormalRole = output.roles.find(role => role.role !== 'FORMAL_ENTITY_CANDIDATE' && output.formalTargets.some(target => target.mention === role.expression));
    if (nonFormalRole) failures.push('NON_FORMAL_ROLE_REACHED_RESOLVER');
    if (output.gate !== 'RUN' && output.resolutions.length) failures.push('STOP_GATE_CALLED_RESOLVER');
    if (hasForbiddenLeak(output.referenceMemo) || hasForbiddenLeak(output.roleMemo)) failures.push('PLANNER_OR_TOOL_LEAK');
    const silentBinding = actual.some(item => item.status === 'MULTIPLE' && item.result.canonicalId);
    if (silentBinding) failures.push('SILENT_FIRST_RESULT_BINDING');
    return Object.freeze({
        requestClass: output.requestClass,
        groundingNeed: output.groundingNeed,
        gate: output.gate,
        reference: output.reference,
        roles: output.roles,
        actual,
        failures: Object.freeze([...new Set(failures)]),
        overall: failures.length ? 'FAIL' : 'PASS',
    });
}

module.exports = { evaluateGrounding, formalStatus, hasForbiddenLeak };
