'use strict';

function buildPlannerContext({ rawOwnerInput, upstream, capabilityCatalog }) {
    return Object.freeze({
        rawOwnerInput,
        businessMemo: upstream.businessMemo,
        policyMemo: upstream.policyMemo,
        groundingResult: upstream.groundingResult,
        finalGroundedTargets: upstream.finalGroundedTargets || Object.freeze([]),
        groundingAmbiguity: upstream.groundingAmbiguity || 'NONE',
        capabilityCatalog,
    });
}

module.exports = { buildPlannerContext };
