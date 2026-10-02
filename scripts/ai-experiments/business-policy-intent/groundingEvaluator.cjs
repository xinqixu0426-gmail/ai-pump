'use strict';

const { alignRoleExpressionToWorkingUtterance } = require('./spanAlignment.cjs');

function normalize(value) { return String(value || '').replace(/[，。！？、\s]/gu, ''); }

function expressionHasTerms(expression, terms) {
    const value = normalize(expression);
    return terms.every(term => value.includes(normalize(term)));
}

function roleMatches(output, expected) {
    return output.roles.some(actual => actual.role === expected.role && expressionHasTerms(actual.expression, expected.terms || [expected.expression]));
}

function supportedByWorkingUtterance(expression, output) {
    const source = String(output.workingUtterance || '');
    if (normalize(source).includes(normalize(expression))) return true;
    // A classifier may compose explicitly adjacent model/style qualifiers into
    // a lookup mention (for example 通用款 + V750). Every component must still
    // be present in Owner wording; this never licenses an invented source.
    const composedTerms = String(expression || '').match(/V\d+|[\u4e00-\u9fff]{2,}款/gu) || [];
    return composedTerms.length > 1 && composedTerms.every(term => normalize(source).includes(normalize(term)));
}

function roleWarnings(output) {
    return (output.roles || []).flatMap(role => {
        const alignment = alignRoleExpressionToWorkingUtterance(role.expression, output.workingUtterance);
        return alignment.status === 'UNIQUE_MATCH'
            ? []
            : [`ROLE_OUT_OF_WORKING_UTTERANCE_WARNING:${role.expression}`];
    });
}

function hasForbiddenLeak(text) {
    return /(entity.?type|REQUEST_CLASS|GROUNDING_NEED|resolver|候选|canonical|数据库|工具|API|计划|保存|写入|costEngine)/iu.test(String(text || ''));
}

function evaluateGrounding(testCase, output) {
    const failures = [];
    const warnings = roleWarnings(output);
    const conceptMatched = output.conceptFastPath?.status === 'MATCHED_CONCEPT_ONLY';
    const contradiction = output.roleContradiction;
    if (testCase.conceptFastPath === 'MATCHED_CONCEPT_ONLY' && !conceptMatched) failures.push('CONCEPT_FAST_PATH_INCORRECT');
    if (testCase.conceptFastPath === 'NOT_MATCHED' && conceptMatched) failures.push('CONCEPT_FALSE_POSITIVE');
    if (testCase.gate === 'RUN' && conceptMatched) failures.push('CONCEPT_FALSE_POSITIVE');
    if (conceptMatched && output.modelCalls.role !== 0) failures.push('CONCEPT_FAST_PATH_ROLE_CALL_BREACH');
    const probeResults = output.probeResults || [];
    const finalTargets = output.finalGroundedTargets || [];
    if (conceptMatched && probeResults.length !== 0) failures.push('CONCEPT_FAST_PATH_RESOLVER_CALL_BREACH');
    if (testCase.referenceStatus && output.reference.status !== testCase.referenceStatus) failures.push('REFERENCE_STATUS_INCORRECT');
    if (testCase.referenceSurface && output.reference.surface !== testCase.referenceSurface) failures.push('REFERENCE_SURFACE_INCORRECT');
    if (testCase.resolvedLanguageReference && output.reference.resolvedLanguageReference !== testCase.resolvedLanguageReference) failures.push('REFERENCE_RESOLUTION_INCORRECT');
    if (testCase.workingUtterance && output.workingUtterance !== testCase.workingUtterance) failures.push('WORKING_UTTERANCE_INCORRECT');
    if (testCase.referenceStatus === 'RESOLVED') {
        if (!output.referenceRewrite?.applied) failures.push('REFERENCE_REWRITE_NOT_APPLIED');
        if (output.reference.surface !== output.reference.resolvedLanguageReference && output.workingUtterance.includes(output.reference.surface)) failures.push('REFERENCE_SURFACE_NOT_REMOVED');
        if (!output.workingUtterance.includes(output.reference.resolvedLanguageReference || '')) failures.push('RESOLVED_EXPRESSION_NOT_INSERTED');
    }
    if (output.gate !== testCase.gate) failures.push('GATE_INCORRECT');
    if ((output.roleAttempts || 0) > 2) failures.push('ROLE_RETRY_MAX_ATTEMPTS_BREACH');
    if (contradiction?.triggered && !output.roleRetryTriggered) failures.push('ROLE_RETRY_FALSE_NEGATIVE');
    if (!contradiction?.triggered && output.roleRetryTriggered) failures.push('ROLE_RETRY_FALSE_POSITIVE');
    if (output.roleStatus === 'UNRESOLVED_AFTER_RETRY') failures.push('ROLE_UNRESOLVED_AFTER_RETRY');
    if (testCase.roleCalls !== undefined) {
        const actualRoleCalls = output.modelCalls.role;
        const roleCallValid = output.roleRetryTriggered
            ? actualRoleCalls >= testCase.roleCalls && actualRoleCalls <= 2
            : actualRoleCalls === testCase.roleCalls;
        if (!roleCallValid) failures.push('ROLE_CALL_CONTRACT_BREACH');
    }
    if (testCase.resolverCalls !== undefined) {
        const actualCalls = probeResults.reduce((sum, item) => sum + item.typeResults.length, 0);
        if (testCase.resolverCalls === 0 ? actualCalls !== 0 : actualCalls < testCase.resolverCalls) failures.push('RESOLVER_CALL_CONTRACT_BREACH');
    }
    for (const expected of testCase.roles || []) {
        if (conceptMatched && expected.role === 'CONCEPT_ONLY') continue;
        if (!roleMatches(output, expected)) failures.push(`ROLE_NOT_PRESERVED:${expected.terms?.join('+') || expected.expression}`);
    }
    for (const expected of testCase.targets || []) {
        const found = finalTargets.find(item => expressionHasTerms(item.mention, expected.terms || [expected.mention]));
        if (!found) failures.push('FINAL_TARGET_NOT_RESOLVED');
        else {
            if (expected.entityType && found.entityType !== expected.entityType) failures.push('RESOLVER_ENTITY_TYPE_INCORRECT');
            if (expected.status && found.status !== expected.status) failures.push('FORMAL_STATUS_INCORRECT');
            if (found.status === 'MULTIPLE' && found.candidates.length < 2) failures.push('MULTIPLE_CANDIDATES_NOT_PRESERVED');
        }
    }
    if ((testCase.targets || []).length > 1 && finalTargets.length < testCase.targets.length) failures.push('MULTI_TARGET_OMITTED');
    if (output.gate !== 'RUN' && probeResults.length) failures.push('STOP_GATE_CALLED_RESOLVER');
    if (output.roles.some(item => item.role !== 'FORMAL_ENTITY_CANDIDATE' && (output.candidateProposals || []).some(target => target.expression === item.expression))) failures.push('NON_FORMAL_ROLE_REACHED_RESOLVER');
    if ((output.candidateProposals || []).some(target => target.source !== 'ROLE_CLASSIFIER'
        || target.expression !== target.alignedWorkingSpan
        || !String(output.workingUtterance || '').includes(target.expression)
        || alignRoleExpressionToWorkingUtterance(target.sourceExpression, output.workingUtterance).status !== 'UNIQUE_MATCH')) {
        failures.push('CANDIDATE_PROPOSAL_PROVENANCE_FAIL');
    }
    if (output.reference.status === 'RESOLVED' && probeResults.some(result => result.mention === output.reference.surface)) failures.push('OLD_REFERENCE_TARGET_REACHED_RESOLVER');
    if (hasForbiddenLeak(output.roleMemo)) failures.push('ROLE_SCOPE_LEAK');
    if (probeResults.some(result => result.status === 'MULTIPLE' && result.canonicalId)) failures.push('SILENT_FIRST_RESULT_BINDING');
    if (probeResults.some(result => result.status === 'MULTIPLE_TYPE' && result.entityType)) failures.push('CROSS_TYPE_SILENT_SELECTION');
    if (finalTargets.some(target => target.status === 'UNRESOLVED' || target.source === 'UNRESOLVED_PROPOSAL_WARNING')) failures.push('UNRESOLVED_PROPOSAL_ACCEPTED_AS_TARGET');
    return Object.freeze({
        reference: output.reference, conceptFastPath: output.conceptFastPath || null, roleContradiction: contradiction || null, roleAttempts: output.roleAttempts || 0, roleRetryTriggered: output.roleRetryTriggered || false, gate: output.gate, roles: output.roles, candidateProposals: output.candidateProposals || Object.freeze([]), probeResults, finalGroundedTargets: finalTargets,
        warnings: Object.freeze([...new Set(warnings)]),
        failures: Object.freeze([...new Set(failures)]), overall: failures.length ? 'FAIL' : 'PASS',
    });
}

module.exports = { evaluateGrounding, expressionHasTerms, supportedByWorkingUtterance, roleWarnings };
