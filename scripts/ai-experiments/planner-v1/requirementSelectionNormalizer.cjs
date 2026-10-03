'use strict';

function hasUnresolvedMultiple(context) {
    return (context.finalGroundedTargets || []).some(target => target.status === 'MULTIPLE' || target.status === 'MULTIPLE_TYPE');
}

function normalizeSelectionRequirement({ requirement, context }) {
    const rawSelectionRequirement = requirement.selectionRequirement;
    let effectiveSelectionRequirement;
    if (!hasUnresolvedMultiple(context)) effectiveSelectionRequirement = 'NONE';
    else effectiveSelectionRequirement = requirement.goalFacts.includes('CANDIDATE_SET') ? 'WHOLE_SET' : 'SINGLE_TARGET_REQUIRED';
    return Object.freeze({ rawSelectionRequirement, effectiveSelectionRequirement, selectionNormalized: rawSelectionRequirement !== effectiveSelectionRequirement });
}

module.exports = { normalizeSelectionRequirement };
