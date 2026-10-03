'use strict';

const { buildPlannerContext } = require('./plannerContext.cjs');
const { compilePlan } = require('./planCompiler.cjs');
const { writeOnlyBlockedPlan } = require('./demandSlotsPipeline.cjs');

function groundedTargetsFor(memo, identity) {
    if (identity.status === 'AMBIGUOUS' && identity.candidateSet.length) {
        return Object.freeze([Object.freeze({ mention: identity.query, entityType: identity.candidateSet[0].entityType, status: 'MULTIPLE', candidates: identity.candidateSet })]);
    }
    return Object.freeze(identity.validatedReferences.map(reference => Object.freeze({ mention: reference.canonicalName, canonicalName: reference.canonicalName, canonicalId: reference.canonicalId, entityType: reference.entityType, status: 'EXACT', source: reference.source })));
}
function factFor(memo, context) {
    if (memo.requestedResult === 'NONE' && memo.writeRequired === 'YES') return null;
    if (memo.requestMode === 'EXPLAIN' && memo.requestedResult === 'DETAIL') return null;
    if (memo.relationRequest && memo.metric === 'NONE' && ['VALUE', 'LIST', 'DETAIL'].includes(memo.requestedResult)) return 'RELATION';
    if (memo.requestedResult === 'COUNT' && context.finalGroundedTargets.some(target => target.status === 'MULTIPLE')) return 'CANDIDATE_SET';
    if (memo.requestedResult === 'LIST' && context.finalGroundedTargets.some(target => target.status === 'MULTIPLE')) return 'CANDIDATE_SET';
    if (memo.requestedResult === 'VALUE' && memo.metric === 'COST') return memo.scenarioChanges.length ? 'SCENARIO_COST' : 'CURRENT_COST';
    if (memo.requestedResult === 'DELTA' && memo.metric === 'COST') return 'COST_DIFFERENCE';
    return null;
}
function compileFullContextPlan({ memo, identity, rawOwnerInput, businessMemo, policyMemo, catalogSnapshot, capabilityCatalog }) {
    const finalGroundedTargets = groundedTargetsFor(memo, identity);
    const unresolved = ['NOT_FOUND', 'MISMATCH'].includes(identity.status) && memo.requestMode !== 'EXPLAIN';
    const context = buildPlannerContext({ rawOwnerInput, capabilityCatalog, upstream: { businessMemo, policyMemo, groundingResult: unresolved ? 'UNRESOLVED' : identity.status === 'AMBIGUOUS' ? 'MULTIPLE' : memo.requestMode === 'EXPLAIN' ? 'NOT_REQUIRED' : 'EXACT', finalGroundedTargets: unresolved ? [] : finalGroundedTargets, groundingAmbiguity: identity.status === 'AMBIGUOUS' ? 'catalog candidate set' : 'NONE', candidateSetComplete: identity.candidateSet.length ? 'YES' : 'UNKNOWN' } });
    const fact = factFor(memo, context);
    const writeOnly = memo.requestedResult === 'NONE' && memo.writeRequired === 'YES';
    const requirement = Object.freeze({ status: unresolved ? 'UNRESOLVED_GROUNDING' : memo.requestMode === 'EXPLAIN' ? 'NO_FORMAL_FACT_REQUIRED' : 'READY', ownerGoal: rawOwnerInput, targets: Object.freeze(finalGroundedTargets.map(target => target.mention)), goalFacts: Object.freeze(fact ? [fact] : []), scenarioOverrides: Object.freeze(memo.scenarioChanges.map(change => Object.freeze({ expression: change.expression, scenarioClass: change.scenarioClass }))), writeRequired: memo.writeRequired, selectionRequirement: identity.status === 'AMBIGUOUS' && ['VALUE', 'DELTA'].includes(memo.requestedResult) ? 'SINGLE_TARGET_REQUIRED' : identity.status === 'AMBIGUOUS' && ['COUNT', 'LIST'].includes(memo.requestedResult) ? 'WHOLE_SET' : 'NONE', relationRequest: memo.relationRequest, statusSource: 'FULL_CONTEXT_IDENTITY_ADAPTER' });
    const rawPlan = writeOnly ? writeOnlyBlockedPlan(requirement, context) : compilePlan({ requirement, context });
    return Object.freeze({ context, requirement, rawPlan, catalogSource: catalogSnapshot.sourceMode, downstreamCompilerContractGap: !fact && !writeOnly && !unresolved && memo.requestMode !== 'EXPLAIN' });
}
module.exports = { compileFullContextPlan, groundedTargetsFor, factFor };
