'use strict';

const { normalizeSelectionRequirement } = require('./requirementSelectionNormalizer.cjs');
const { dedupeRequirementTargets } = require('./requirementTargetDedupe.cjs');

function effectiveStatus(context) {
    if (context.groundingResult === 'UNRESOLVED') return Object.freeze({ status: 'UNRESOLVED_GROUNDING', source: 'FROZEN_GROUNDING' });
    if (context.groundingResult === 'NOT_REQUIRED') return Object.freeze({ status: 'NO_FORMAL_FACT_REQUIRED', source: 'CONCEPT_UPSTREAM' });
    return Object.freeze({ status: 'READY', source: 'FROZEN_GROUNDING' });
}

function normalizeRequirementStatus({ requirement, context }) {
    const effective = effectiveStatus(context);
    const rawStatus = requirement.status;
    const selection = normalizeSelectionRequirement({ requirement, context });
    const dedupe = dedupeRequirementTargets({ requirement, context });
    return Object.freeze({
        rawStatus,
        effectiveStatus: effective.status,
        statusSource: effective.source,
        statusNormalized: rawStatus !== effective.status,
        rawSelectionRequirement: selection.rawSelectionRequirement,
        effectiveSelectionRequirement: selection.effectiveSelectionRequirement,
        selectionNormalized: selection.selectionNormalized,
        targetDeduplications: dedupe.targetDeduplications,
        requirement: Object.freeze({ ...requirement, targets: dedupe.targets, rawTargets: dedupe.rawTargets, rawStatus, status: effective.status, statusSource: effective.source, rawSelectionRequirement: selection.rawSelectionRequirement, selectionRequirement: selection.effectiveSelectionRequirement, selectionNormalized: selection.selectionNormalized, targetDeduplications: dedupe.targetDeduplications }),
    });
}

module.exports = { effectiveStatus, normalizeRequirementStatus };
