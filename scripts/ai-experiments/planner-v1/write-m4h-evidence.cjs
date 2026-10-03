'use strict';

const fs = require('fs');
const path = require('path');
const { parseRequirementMemo } = require('./requirementMemo.cjs');
const { normalizeRequirementStatus } = require('./requirementStatusNormalizer.cjs');
const { validateRequirementMemo } = require('./requirementValidator.cjs');
const { runPlannerPipeline } = require('./plannerPipeline.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { UPSTREAM_FIXTURES: U } = require('./frozenUpstreamFixture.cjs');

const root = path.resolve(__dirname, '../../..');
const catalog = createPlannerCapabilityCatalogSnapshot();
function context(upstream, rawOwnerInput) { return { rawOwnerInput, ...upstream, capabilityCatalog: catalog, goalProvenanceRequired: true }; }
function normalize(lines, upstream, rawOwnerInput) { return normalizeRequirementStatus({ requirement: parseRequirementMemo(lines.join('\n')), context: context(upstream, rawOwnerInput) }); }
function check(id, pass, finding) { return Object.freeze({ id, pass: Boolean(pass), finding }); }

async function writeM4hEvidence() {
    const owner = 'V750通用款做电泳成本增加多少？';
    const valid = normalize([
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', 'TARGET: V750通用款',
        'GOAL_FACT: COST_DIFFERENCE | OWNER_SPAN=成本增加多少', 'SELECTION_REQUIREMENT: NONE',
        'SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO',
    ], U.V750_GENERIC_QUALIFIED, owner);
    const current = normalize([
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', 'TARGET: V750通用款',
        'GOAL_FACT: CURRENT_COST | OWNER_SPAN=成本增加多少', 'SELECTION_REQUIREMENT: NONE',
        'SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO',
    ], U.V750_GENERIC_QUALIFIED, owner);
    const multiOwner = '查一下V750通用款现在用哪个线圈，再告诉我当前成本。';
    const multiGoal = normalize([
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 两项读取', 'TARGET: V750通用款',
        'GOAL_FACT: RELATION | OWNER_SPAN=现在用哪个线圈', 'GOAL_FACT: CURRENT_COST | OWNER_SPAN=当前成本',
        'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO',
    ], U.V750_GENERIC_QUALIFIED, multiOwner);
    const exactSelection = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'GOAL_FACT: CURRENT_COST | OWNER_SPAN=成本', 'SELECTION_REQUIREMENT: SINGLE_TARGET_REQUIRED', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED, 'V750通用款成本');
    const setSelection = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: 12-120', 'GOAL_FACT: CANDIDATE_SET | OWNER_SPAN=几个方案', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.COIL_GENERIC, '12-120有几个方案？');
    const deduped = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'TARGET: V750-通用款', 'GOAL_FACT: CURRENT_COST | OWNER_SPAN=成本', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED, 'V750通用款成本');
    const first = [
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', 'TARGET: V750通用款',
        'GOAL_FACT: COST_DIFFERENCE | OWNER_SPAN=成本增加多少', 'GOAL_FACT: CURRENT_COST | OWNER_SPAN=成本增加多少',
        'GOAL_FACT: RELATION | OWNER_SPAN=成本增加多少', 'SELECTION_REQUIREMENT: SINGLE_TARGET_REQUIRED',
        'SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO',
    ].join('\n');
    const recovered = [
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', 'TARGET: V750通用款',
        'GOAL_FACT: COST_DIFFERENCE | OWNER_SPAN=成本增加多少', 'SELECTION_REQUIREMENT: NONE',
        'SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO',
    ].join('\n');
    let calls = 0;
    const recoveredOutput = await runPlannerPipeline({ rawOwnerInput: owner, upstream: Object.freeze({ ...U.V750_GENERIC_QUALIFIED, goalProvenanceRequired: true }), capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => {
        calls += 1;
        return dependencies.retryAddendum ? recovered : first;
    } });
    const exhausted = await runPlannerPipeline({ rawOwnerInput: owner, upstream: Object.freeze({ ...U.V750_GENERIC_QUALIFIED, goalProvenanceRequired: true }), capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => first });
    const cases = Object.freeze([
        check('GP-01', validateRequirementMemo({ requirement: valid.requirement, context: context(U.V750_GENERIC_QUALIFIED, owner) }).validationStatus === 'VALID', 'COST_DIFFERENCE has an exact terminal owner span'),
        check('GP-02', validateRequirementMemo({ requirement: current.requirement, context: context(U.V750_GENERIC_QUALIFIED, owner) }).violations.some(item => item.code === 'REQUIREMENT_GOAL_FACT_PROVENANCE_UNSUPPORTED'), 'comparison wording cannot support CURRENT_COST as an independent terminal goal'),
        check('GP-03', validateRequirementMemo({ requirement: Object.freeze({ ...valid.requirement, goalFacts: Object.freeze(['RELATION']), goalFactProvenance: Object.freeze([{ factClass: 'RELATION', ownerSpan: '成本增加多少' }]) }), context: context(U.V750_GENERIC_QUALIFIED, owner) }).violations.some(item => item.code === 'REQUIREMENT_GOAL_FACT_PROVENANCE_UNSUPPORTED'), 'relation without relationship wording is overexpanded'),
        check('GP-04', validateRequirementMemo({ requirement: multiGoal.requirement, context: context(U.V750_GENERIC_QUALIFIED, multiOwner) }).validationStatus === 'VALID', 'explicit CURRENT_COST owner span is valid'),
        check('GP-05', multiGoal.requirement.goalFactProvenance.some(item => item.factClass === 'RELATION' && item.ownerSpan === '现在用哪个线圈'), 'explicit relation owner span is retained'),
        check('GP-06', multiGoal.requirement.goalFacts.length === 2, 'two explicit owner terminal goals stay distinct'),
        check('GP-07', validateRequirementMemo({ requirement: Object.freeze({ ...multiGoal.requirement, goalFacts: Object.freeze(['CURRENT_COST']), goalFactProvenance: Object.freeze([{ factClass: 'CURRENT_COST', ownerSpan: '当前成本' }]) }), context: context(U.V750_GENERIC_QUALIFIED, multiOwner) }).validationStatus === 'VALID', 'provenance validation does not infer or add a dropped multi-goal'),
        check('GP-08', exactSelection.requirement.selectionRequirement === 'NONE', 'EXACT grounding normalizes redundant single-target selection'),
        check('GP-09', normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'GOAL_FACT: CURRENT_COST | OWNER_SPAN=成本', 'SELECTION_REQUIREMENT: SINGLE_TARGET_REQUIRED', 'WRITE_REQUIRED: NO'], U.QUALIFIED_STYLES, 'V750通用款成本').requirement.selectionRequirement === 'NONE', 'qualified target set is not unresolved ambiguity'),
        check('GP-10', normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750', 'GOAL_FACT: CURRENT_COST | OWNER_SPAN=成本', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.V750_GENERIC, 'V750成本').requirement.selectionRequirement === 'SINGLE_TARGET_REQUIRED', 'candidate-specific fact over unresolved MULTIPLE requires a selection'),
        check('GP-11', setSelection.requirement.selectionRequirement === 'WHOLE_SET', 'candidate-set goal over MULTIPLE consumes the whole set'),
        check('GP-12', deduped.requirement.targets.length === 1 && deduped.targetDeduplications === 1, 'mention and canonical name of the same frozen target dedupe'),
        check('GP-13', normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'TARGET: V110', 'GOAL_FACT: COST_DIFFERENCE | OWNER_SPAN=成本差多少', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], Object.freeze({ ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: Object.freeze([...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, ...U.V110.finalGroundedTargets]) }), 'V750通用款和V110成本差多少').requirement.targets.length === 2, 'two different formal identities do not dedupe'),
        check('GP-14', calls === 2 && recoveredOutput.requirementRetry.reasons.includes('GOAL_FACT_OVEREXPANDED'), 'overexpanded goal fact triggers exactly one retry'),
        check('GP-15', recoveredOutput.requirementValidation.validationStatus === 'VALID' && recoveredOutput.requirement.goalFacts.length === 1, 'retry retains only a minimal valid terminal goal'),
        check('GP-16', exhausted.requirementRetry.exhaustedReasons.includes('GOAL_FACT_OVEREXPANDED'), 'persistent overexpansion remains a failure'),
        check('GP-17', exhausted.requirementAttempts.length === 2, 'goal-minimality retry is bounded to two attempts'),
    ]);
    const output = Object.freeze({ phase: 'M4-4H', suite: 'terminal-goal-provenance-and-minimality', passed: cases.filter(item => item.pass).length, failed: cases.filter(item => !item.pass).length, cases });
    fs.writeFileSync(path.join(root, 'planning/planner/M4-4H-Terminal-Goal-Tests.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}

module.exports = { writeM4hEvidence };
