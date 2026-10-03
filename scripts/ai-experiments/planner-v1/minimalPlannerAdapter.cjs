'use strict';

const { buildPlannerContext } = require('./plannerContext.cjs');
const { compilePlan } = require('./planCompiler.cjs');
const { writeOnlyBlockedPlan } = require('./demandSlotsPipeline.cjs');

function normalizeRequestMode(memo) { return memo.writeRequired === 'YES' ? 'WRITE' : memo.scenarioChanges.length ? 'PREVIEW' : 'READ'; }
function semanticFact(memo, resolutions) {
    if (memo.writeRequired === 'YES' && memo.requestedResult === 'NONE') return null;
    if (memo.relationRequest && memo.metric === 'NONE' && ['VALUE', 'LIST', 'DETAIL'].includes(memo.requestedResult)) return 'RELATION';
    if (memo.requestedResult === 'COUNT' && resolutions.some(item => ['MULTIPLE', 'MULTIPLE_TYPE'].includes(item.status))) return 'CANDIDATE_SET';
    if (memo.requestedResult === 'LIST' && resolutions.some(item => ['MULTIPLE', 'MULTIPLE_TYPE'].includes(item.status))) return 'CANDIDATE_SET';
    if (memo.metric === 'COST' && memo.requestedResult === 'VALUE') return memo.scenarioChanges.length ? 'SCENARIO_COST' : 'CURRENT_COST';
    if (memo.metric === 'COST' && memo.requestedResult === 'DELTA') return 'COST_DIFFERENCE';
    return null;
}
function compileMinimalPlanner({ memo, resolutions, input, capabilityCatalog }) {
    const concept = memo.requestedResult === 'DETAIL' && memo.metric === 'NONE' && !memo.relationRequest && !memo.scenarioChanges.length && memo.writeRequired === 'NO';
    const writeOnly = memo.requestedResult === 'NONE' && memo.writeRequired === 'YES';
    const unresolved = !concept && !writeOnly && (!resolutions.length || resolutions.some(item => item.status === 'NOT_FOUND'));
    const ambiguous = resolutions.some(item => ['MULTIPLE', 'MULTIPLE_TYPE'].includes(item.status));
    const finalGroundedTargets = concept || unresolved ? [] : resolutions.map(item => item.status === 'EXACT'
        ? Object.freeze({ mention: item.mention, entityType: item.matches[0].entityType, canonicalId: item.matches[0].canonicalId, canonicalName: item.matches[0].canonicalName, status: 'EXACT', source: item.matches[0].source })
        : Object.freeze({ mention: item.mention, entityType: item.status === 'MULTIPLE' ? item.matches[0].entityType : null, status: item.status, candidates: item.matches }));
    const context = buildPlannerContext({ rawOwnerInput: input.rawOwnerInput, capabilityCatalog, upstream: { businessMemo: input.businessMemo, policyMemo: input.policyMemo, groundingResult: concept ? 'NOT_REQUIRED' : unresolved ? 'UNRESOLVED' : ambiguous ? 'MULTIPLE' : 'EXACT', finalGroundedTargets, groundingAmbiguity: ambiguous ? 'catalog candidate set' : 'NONE', candidateSetComplete: ambiguous && resolutions.every(item => item.catalogExhaustive) ? 'YES' : 'UNKNOWN' } });
    const fact = semanticFact(memo, resolutions);
    const requirement = Object.freeze({ status: concept ? 'NO_FORMAL_FACT_REQUIRED' : unresolved ? 'UNRESOLVED_GROUNDING' : 'READY', ownerGoal: input.rawOwnerInput, targets: Object.freeze(finalGroundedTargets.map(item => item.mention)), goalFacts: Object.freeze(fact ? [fact] : []), scenarioOverrides: Object.freeze(memo.scenarioChanges.map(item => ({ expression: item.expression, scenarioClass: item.scenarioClass }))), writeRequired: memo.writeRequired, selectionRequirement: ambiguous && ['VALUE', 'DELTA'].includes(memo.requestedResult) ? 'SINGLE_TARGET_REQUIRED' : ambiguous && ['LIST', 'COUNT'].includes(memo.requestedResult) ? 'WHOLE_SET' : 'NONE', relationRequest: memo.relationRequest, statusSource: 'MINIMAL_CATALOG_ADAPTER' });
    const rawPlan = writeOnly ? writeOnlyBlockedPlan(requirement, context) : compilePlan({ requirement, context });
    return Object.freeze({ requestMode: concept ? 'EXPLAIN' : normalizeRequestMode(memo), context, requirement, rawPlan, downstreamCompilerContractGap: !fact && !concept && !writeOnly && !unresolved });
}
module.exports = { normalizeRequestMode, semanticFact, compileMinimalPlanner };
