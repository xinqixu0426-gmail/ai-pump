'use strict';

function hasMultiple(context) { return (context.finalGroundedTargets || []).some(target => target.status === 'MULTIPLE' || target.status === 'MULTIPLE_TYPE'); }
function statusFor(goalSpec, context) {
    if (context.groundingResult === 'UNRESOLVED') return 'UNRESOLVED_GROUNDING';
    if (goalSpec.goalKind === 'EXPLAIN' || context.groundingResult === 'NOT_REQUIRED') return 'NO_FORMAL_FACT_REQUIRED';
    return 'READY';
}
function factFor(goalSpec) {
    switch (goalSpec.goalKind) {
    case 'READ_VALUE': return goalSpec.metric === 'COST' ? 'CURRENT_COST' : 'OTHER';
    case 'READ_RELATION': return 'RELATION';
    case 'LIST': return 'RELATION';
    case 'COUNT': return 'CANDIDATE_SET';
    case 'PREVIEW_SCENARIO': return goalSpec.metric === 'COST' ? 'SCENARIO_COST' : 'FORMAL_DETAIL';
    case 'COMPARE_TARGETS':
    case 'COMPARE_SCENARIO': return 'COST_DIFFERENCE';
    default: return null;
    }
}
function selectionFor(goalSpec, context) {
    if (!hasMultiple(context)) return 'NONE';
    if (['COUNT', 'LIST'].includes(goalSpec.goalKind)) return 'WHOLE_SET';
    if (goalSpec.goalKind === 'READ_VALUE') return 'SINGLE_TARGET_REQUIRED';
    return 'NONE';
}
function compileGoalSpecToRequirement({ goalSpec, context }) {
    const fact = factFor(goalSpec);
    return Object.freeze({
        status: statusFor(goalSpec, context),
        ownerGoal: context.rawOwnerInput,
        targets: Object.freeze(goalSpec.targets || []),
        rawTargets: Object.freeze(goalSpec.rawTargets || goalSpec.targets || []),
        goalFacts: Object.freeze(fact ? [fact] : []),
        goalFactProvenance: Object.freeze([]),
        scenarioOverrides: Object.freeze(goalSpec.scenarioOverrides || []),
        writeRequired: goalSpec.writeRequired,
        selectionRequirement: selectionFor(goalSpec, context),
        rawSelectionRequirement: null,
        statusSource: 'GOAL_TO_FACT_COMPILER',
        relationRequest: goalSpec.relationRequest || null,
        goalKind: goalSpec.goalKind,
        resultShape: goalSpec.resultShape,
        metric: goalSpec.metric,
    });
}

module.exports = { compileGoalSpecToRequirement, factFor, selectionFor, statusFor };
