'use strict';

const { buildPlannerAdmission } = require('./plannerAdmissionGuard.cjs');

function buildPlannerContext({ rawOwnerInput, upstream, capabilityCatalog }) {
    const context = {
        rawOwnerInput,
        businessMemo: upstream.businessMemo,
        policyMemo: upstream.policyMemo,
        groundingResult: upstream.groundingResult,
        finalGroundedTargets: upstream.finalGroundedTargets || Object.freeze([]),
        groundingAmbiguity: upstream.groundingAmbiguity || 'NONE',
        candidateSetComplete: upstream.candidateSetComplete || 'UNKNOWN',
        goalProvenanceRequired: upstream.goalProvenanceRequired === true,
        capabilityCatalog,
    };
    return Object.freeze({ ...context, admission: buildPlannerAdmission({ rawOwnerInput, upstream }) });
}

module.exports = { buildPlannerContext };
