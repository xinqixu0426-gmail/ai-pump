'use strict';

function effectiveStatus(context) {
    if (context.groundingResult === 'UNRESOLVED') return Object.freeze({ status: 'UNRESOLVED_GROUNDING', source: 'FROZEN_GROUNDING' });
    if (context.groundingResult === 'NOT_REQUIRED') return Object.freeze({ status: 'NO_FORMAL_FACT_REQUIRED', source: 'CONCEPT_UPSTREAM' });
    return Object.freeze({ status: 'READY', source: 'FROZEN_GROUNDING' });
}

function normalizeRequirementStatus({ requirement, context }) {
    const effective = effectiveStatus(context);
    const rawStatus = requirement.status;
    return Object.freeze({
        rawStatus,
        effectiveStatus: effective.status,
        statusSource: effective.source,
        statusNormalized: rawStatus !== effective.status,
        requirement: Object.freeze({ ...requirement, rawStatus, status: effective.status, statusSource: effective.source }),
    });
}

module.exports = { effectiveStatus, normalizeRequirementStatus };
