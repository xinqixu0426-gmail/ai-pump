'use strict';

function hasMultiple(context) { return (context.finalGroundedTargets || []).some(target => ['MULTIPLE', 'MULTIPLE_TYPE'].includes(target.status)); }
function selectionFor(slots, context) {
    if (!hasMultiple(context)) return 'NONE';
    if (slots.resultShape === 'COUNT' || slots.resultShape === 'LIST' && !slots.relationRequest) return 'WHOLE_SET';
    if (slots.resultShape === 'VALUE' && slots.metric === 'COST') return 'SINGLE_TARGET_REQUIRED';
    return 'NONE';
}
function factFor(slots, context) {
    if (slots.resultShape === 'NONE' && slots.writeRequired === 'YES') return null;
    if (context.groundingResult === 'NOT_REQUIRED' && slots.resultShape === 'DETAIL' && !slots.relationRequest) return null;
    if (slots.relationRequest && slots.metric === 'NONE' && ['VALUE', 'LIST', 'DETAIL'].includes(slots.resultShape)) return 'RELATION';
    if (slots.resultShape === 'COUNT' && hasMultiple(context)) return 'CANDIDATE_SET';
    if (slots.resultShape === 'VALUE' && slots.metric === 'COST') return slots.scenarioOverrides.length ? 'SCENARIO_COST' : 'CURRENT_COST';
    if (slots.resultShape === 'DELTA' && slots.metric === 'COST') return 'COST_DIFFERENCE';
    return null;
}
function compileDemandSlots({ slots, context }) {
    const fact = factFor(slots, context);
    const writeOnly = slots.resultShape === 'NONE' && slots.writeRequired === 'YES';
    const concept = context.groundingResult === 'NOT_REQUIRED' && slots.resultShape === 'DETAIL' && !slots.relationRequest;
    const status = context.groundingResult === 'UNRESOLVED' ? 'UNRESOLVED_GROUNDING' : concept ? 'NO_FORMAL_FACT_REQUIRED' : 'READY';
    const targets = (context.finalGroundedTargets || []).map(target => target.mention || target.canonicalName).filter(Boolean);
    const requirement = Object.freeze({ status, ownerGoal: context.rawOwnerInput, targets: Object.freeze(targets), rawTargets: Object.freeze(targets), goalFacts: Object.freeze(fact ? [fact] : []), goalFactProvenance: Object.freeze([]), scenarioOverrides: Object.freeze(slots.scenarioOverrides.map(({ expression, scenarioClass }) => Object.freeze({ expression, scenarioClass }))), writeRequired: slots.writeRequired, selectionRequirement: selectionFor(slots, context), rawSelectionRequirement: null, statusSource: 'DEMAND_SEMANTIC_COMPILER', relationRequest: slots.relationRequest, resultShape: slots.resultShape, metric: slots.metric, writeOnly });
    return Object.freeze({ requirement, semanticStatus: fact || concept || writeOnly || status === 'UNRESOLVED_GROUNDING' ? 'COMPILABLE' : 'SLOT_SEMANTICS_INCOMPLETE', modelCalls: 0 });
}

module.exports = { compileDemandSlots, factFor, selectionFor };
