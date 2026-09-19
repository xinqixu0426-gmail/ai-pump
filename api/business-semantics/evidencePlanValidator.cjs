'use strict';

const { BusinessEvidencePlanV1 } = require('./evidencePlanContract.cjs');
const { FactCapabilityRegistry } = require('./factCapabilityRegistry.cjs');

function assert(condition, reason) {
    if (!condition) throw Object.assign(new Error(reason), { code: 'BUSINESS_EVIDENCE_PLAN_INVALID', reason });
}

function validateBusinessEvidencePlan(plan) {
    const c = BusinessEvidencePlanV1;
    assert(plan && typeof plan === 'object' && !Array.isArray(plan), 'PLAN_REQUIRED');
    assert(plan.version === c.version, 'VERSION');
    assert(c.questionKinds.includes(plan.questionKind), 'QUESTION_KIND');
    assert(plan.subject && typeof plan.subject === 'object', 'SUBJECT');
    assert(Array.isArray(plan.requirements), 'REQUIREMENTS');
    for (const requirement of plan.requirements) {
        assert(c.factTypes.includes(requirement.factType), 'UNKNOWN_FACT_TYPE');
        assert(c.requirementStatuses.includes(requirement.status), 'REQUIREMENT_STATUS');
        assert(Boolean(FactCapabilityRegistry[requirement.factType]), 'UNREGISTERED_FACT_TYPE');
        assert(typeof requirement.required === 'boolean' && typeof requirement.reason === 'string', 'REQUIREMENT_FIELDS');
    }
    assert(plan.execution?.bounded === true, 'UNBOUNDED_EXECUTION');
    assert(plan.execution.maxCalls === c.limits.maxCalls, 'MAX_CALLS');
    assert(Array.isArray(plan.execution.calls) && plan.execution.calls.length <= c.limits.maxCalls, 'CALL_LIMIT');
    for (const call of plan.execution.calls) {
        assert(typeof call.capability === 'string' && call.arguments && typeof call.arguments === 'object', 'CALL_FIELDS');
        assert(Array.isArray(call.argumentProvenance), 'CALL_PROVENANCE');
        for (const item of call.argumentProvenance) {
            assert(typeof item.field === 'string' && c.argumentProvenance.includes(item.source), 'CALL_PROVENANCE_SOURCE');
        }
        assert(Array.isArray(call.dependsOnFacts), 'CALL_DEPENDENCIES');
        assert(call.dependsOnFacts.every(fact => c.factTypes.includes(fact)), 'CALL_DEPENDENCY_FACT');
    }
    assert(Buffer.byteLength(JSON.stringify(plan)) <= c.limits.maxPayloadBytes, 'PAYLOAD_TOO_LARGE');
    return true;
}

module.exports = { validateBusinessEvidencePlan };
