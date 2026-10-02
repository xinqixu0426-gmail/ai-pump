'use strict';

const fs = require('fs');
const path = require('path');
const { parseRequirementMemo } = require('./requirementMemo.cjs');
const { normalizeRequirementStatus } = require('./requirementStatusNormalizer.cjs');
const { validateRequirementMemo } = require('./requirementValidator.cjs');
const { detectRequirementContradiction } = require('./requirementContradictionDetector.cjs');
const { compilePlan } = require('./planCompiler.cjs');
const { runPlannerPipeline } = require('./plannerPipeline.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { UPSTREAM_FIXTURES: U } = require('./frozenUpstreamFixture.cjs');

const root = path.resolve(__dirname, '../../..');
const catalog = createPlannerCapabilityCatalogSnapshot();
function context(upstream, rawOwnerInput = 'V750通用款加浮球以后多少钱？') { return { rawOwnerInput, ...upstream, capabilityCatalog: catalog }; }
function parse(lines) { return parseRequirementMemo(lines.join('\n')); }
function normalize(lines, upstream, rawOwnerInput) { return normalizeRequirementStatus({ requirement: parse(lines), context: context(upstream, rawOwnerInput) }); }
function check(id, pass, finding) { return Object.freeze({ id, pass: Boolean(pass), finding }); }

async function writeM4eEvidence() {
    const unresolved = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.UNRESOLVED, '这个多少钱？');
    const multiple = normalize(['REQUIREMENT_STATUS: UNRESOLVED_GROUNDING', 'OWNER_GOAL: x', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: SINGLE_TARGET_REQUIRED', 'WRITE_REQUIRED: NO'], U.COIL_GENERIC, '12-120多少钱？');
    const exact = normalize(['REQUIREMENT_STATUS: UNRESOLVED_GROUNDING', 'OWNER_GOAL: x', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED);
    const concept = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.CONCEPT, '模板和配方有什么区别？');
    const relation = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: 通用款模板', 'GOAL_FACT: RELATION', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.TEMPLATE, '通用款模板有哪些固定件？');
    const unresolvedGoal = normalize(['REQUIREMENT_STATUS: UNRESOLVED_GROUNDING', 'OWNER_GOAL: x', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.UNRESOLVED, '这个多少钱？');
    const currentScenario = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 加浮球 | FLOAT', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED);
    const scenarioCost = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'GOAL_FACT: SCENARIO_COST', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 加浮球 | FLOAT', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED);
    const difference = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'GOAL_FACT: COST_DIFFERENCE', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 加浮球 | FLOAT', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED);
    const underclassified = normalize(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'GOAL_FACT: COST_DIFFERENCE', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 加浮球 | OTHER', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED);
    let calls = 0;
    const retryOutput = await runPlannerPipeline({ rawOwnerInput: 'V750通用款加浮球以后多少钱？', upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => {
        calls += 1;
        return dependencies.retryAddendum ? 'REQUIREMENT_STATUS: READY\nOWNER_GOAL: x\nTARGET: V750通用款\nGOAL_FACT: SCENARIO_COST\nSELECTION_REQUIREMENT: NONE\nSCENARIO_OVERRIDE: 加浮球 | FLOAT\nWRITE_REQUIRED: NO' : 'REQUIREMENT_STATUS: READY\nOWNER_GOAL: x\nTARGET: V750通用款\nGOAL_FACT: CURRENT_COST\nSELECTION_REQUIREMENT: NONE\nSCENARIO_OVERRIDE: 加浮球 | FLOAT\nWRITE_REQUIRED: NO';
    } });
    const writeOutput = await runPlannerPipeline({ rawOwnerInput: 'V750通用款加浮球，先算一下，不保存。', upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => dependencies.retryAddendum ? 'REQUIREMENT_STATUS: READY\nOWNER_GOAL: x\nTARGET: V750通用款\nGOAL_FACT: SCENARIO_COST\nSELECTION_REQUIREMENT: NONE\nSCENARIO_OVERRIDE: 加浮球 | FLOAT\nWRITE_REQUIRED: YES' : 'REQUIREMENT_STATUS: READY\nOWNER_GOAL: x\nTARGET: V750通用款\nGOAL_FACT: CURRENT_COST\nSELECTION_REQUIREMENT: NONE\nSCENARIO_OVERRIDE: 加浮球 | FLOAT\nWRITE_REQUIRED: NO' });
    const cases = Object.freeze([
        check('RN-01', unresolved.effectiveStatus === 'UNRESOLVED_GROUNDING', 'UNRESOLVED overrides raw READY'),
        check('RN-02', multiple.effectiveStatus === 'READY', 'MULTIPLE overrides raw unresolved'),
        check('RN-03', exact.effectiveStatus === 'READY', 'EXACT overrides raw unresolved'),
        check('RN-04', concept.effectiveStatus === 'NO_FORMAL_FACT_REQUIRED', 'concept upstream controls no-formal status'),
        check('RN-05', validateRequirementMemo({ requirement: relation.requirement, context: context(U.TEMPLATE, '通用款模板有哪些固定件？') }).validationStatus === 'VALID', 'RELATION is valid for template fixed-part goal'),
        check('RN-06', relation.requirement.goalFacts.includes('RELATION'), 'FACT equivalence accepts a relation goal'),
        check('RN-07', validateRequirementMemo({ requirement: unresolvedGoal.requirement, context: context(U.UNRESOLVED, '这个多少钱？') }).validationStatus === 'VALID' && compilePlan({ requirement: unresolvedGoal.requirement, context: context(U.UNRESOLVED, '这个多少钱？') }).status === 'BLOCKED_GROUNDING', 'unresolved keeps cost goal while compiler blocks'),
        check('RN-08', detectRequirementContradiction({ requirement: currentScenario.requirement, context: context(U.V750_GENERIC_QUALIFIED) }).reasons.includes('SCENARIO_GOAL_MISSING'), 'current-only scenario cost goal contradicts override'),
        check('RN-09', !detectRequirementContradiction({ requirement: scenarioCost.requirement, context: context(U.V750_GENERIC_QUALIFIED) }).detected, 'scenario cost has no contradiction'),
        check('RN-10', !detectRequirementContradiction({ requirement: difference.requirement, context: context(U.V750_GENERIC_QUALIFIED) }).detected, 'cost difference has no contradiction'),
        check('RN-11', detectRequirementContradiction({ requirement: underclassified.requirement, context: context(U.V750_GENERIC_QUALIFIED) }).reasons.includes('SCENARIO_CLASS_UNDERCLASSIFIED'), 'memo-supported OTHER triggers recheck'),
        check('RN-12', calls === 2 && retryOutput.requirementAttempts.length === 2, 'pipeline allows one retry only'),
        check('RN-13', retryOutput.requirement.targets.every(target => target === 'V750通用款'), 'retry target remains grounded'),
        check('RN-14', writeOutput.requirementValidation.violations.some(item => item.code === 'REQUIREMENT_WRITE_INTENT_CONTRADICTION'), 'retry cannot reverse explicit no-save intent'),
        check('RN-15', retryOutput.requirementValidation.validationStatus === 'VALID', 'retry result is validated'),
    ]);
    const output = Object.freeze({ phase: 'M4-4E', suite: 'requirement-reliability', passed: cases.filter(item => item.pass).length, failed: cases.filter(item => !item.pass).length, cases });
    fs.writeFileSync(path.join(root, 'planning/planner/M4-4E-Requirement-Reliability-Tests.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}

function writeNotRunFullEvidence() {
    const output = Object.freeze({ phase: 'M4-4E', scope: 'full', status: 'NOT_RUN', reason: 'REPEAT_RELIABILITY_PREREQUISITE_FAILED', failedRepeat: 'P-12_ROTOR_PROCESS 4/5; one Requirement call omitted the owner scenario override and did not meet the approved retry triggers.', compilerModelCalls: 0, frozenUpstreamChanged: false });
    fs.writeFileSync(path.join(root, 'planning/planner/M4-4E-Full-Smoke.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}

module.exports = { writeM4eEvidence, writeNotRunFullEvidence };
