'use strict';

const fs = require('fs');
const path = require('path');
const { parseRequirementMemo } = require('./requirementMemo.cjs');
const { normalizeRequirementStatus } = require('./requirementStatusNormalizer.cjs');
const { detectRequirementContradiction } = require('./requirementContradictionDetector.cjs');
const { runPlannerPipeline } = require('./plannerPipeline.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { UPSTREAM_FIXTURES: U } = require('./frozenUpstreamFixture.cjs');
const { writeM4eEvidence } = require('./write-m4e-evidence.cjs');

const root = path.resolve(__dirname, '../../..');
const catalog = createPlannerCapabilityCatalogSnapshot();
function context(upstream, rawOwnerInput = 'V750通用款做不锈钢接轴成本差多少？') { return { rawOwnerInput, ...upstream, capabilityCatalog: catalog }; }
function requirement(lines, upstream, rawOwnerInput) { return normalizeRequirementStatus({ requirement: parseRequirementMemo(Array.isArray(lines) ? lines.join('\n') : lines), context: context(upstream, rawOwnerInput) }).requirement; }
function check(id, pass, finding) { return Object.freeze({ id, pass: Boolean(pass), finding }); }
function comparison({ fact = 'COST_DIFFERENCE', override = null, targets = ['V750通用款'] } = {}) {
    return [
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', ...targets.map(target => `TARGET: ${target}`), `GOAL_FACT: ${fact}`, 'SELECTION_REQUIREMENT: NONE',
        ...(override ? [`SCENARIO_OVERRIDE: ${override}`] : []), 'WRITE_REQUIRED: NO',
    ].join('\n');
}

async function writeM4fEvidence() {
    const priorSuite = await writeM4eEvidence();
    const one = U.V750_GENERIC_QUALIFIED;
    const pair = Object.freeze({ ...one, finalGroundedTargets: Object.freeze([...one.finalGroundedTargets, ...U.V110.finalGroundedTargets]) });
    const qualifiedPair = U.QUALIFIED_STYLES;
    const singleDifference = requirement(comparison(), one);
    const scenarioComparison = requirement(comparison({ fact: 'SCENARIO_COMPARISON' }), one);
    const overrideDifference = requirement(comparison({ override: '不锈钢接轴 | ROTOR_PROCESS' }), one);
    const pairDifference = requirement(comparison({ targets: ['V750通用款', 'V110'] }), pair);
    const qualifiedDifference = requirement(comparison({ targets: ['V750通用款', 'V750豪贝款'] }), qualifiedPair);
    const scenarioCost = requirement(comparison({ fact: 'SCENARIO_COST' }), one);
    const currentCost = requirement(comparison({ fact: 'CURRENT_COST' }), one);
    const first = comparison();
    const recovered = comparison({ override: '不锈钢接轴 | ROTOR_PROCESS' });
    let calls = 0;
    const retryRecovered = await runPlannerPipeline({ rawOwnerInput: 'V750通用款做不锈钢接轴成本差多少？', upstream: one, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_context, dependencies) => {
        calls += 1;
        return dependencies.retryAddendum ? recovered : first;
    } });
    const retryExhausted = await runPlannerPipeline({ rawOwnerInput: 'V750通用款做不锈钢接轴成本差多少？', upstream: one, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => first });
    let pairCalls = 0;
    await runPlannerPipeline({ rawOwnerInput: 'V750通用款和V110成本差多少？', upstream: pair, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => {
        pairCalls += 1;
        return comparison({ targets: ['V750通用款', 'V110'] });
    } });
    const cases = Object.freeze([
        check('CB-01', detectRequirementContradiction({ requirement: singleDifference, context: context(one) }).reasons.includes('COMPARISON_BASIS_MISSING'), 'one target cost difference without override is incomplete'),
        check('CB-02', detectRequirementContradiction({ requirement: scenarioComparison, context: context(one) }).reasons.includes('COMPARISON_BASIS_MISSING'), 'one target scenario comparison without override is incomplete'),
        check('CB-03', !detectRequirementContradiction({ requirement: overrideDifference, context: context(one) }).reasons.includes('COMPARISON_BASIS_MISSING'), 'scenario override is a comparison basis'),
        check('CB-04', !detectRequirementContradiction({ requirement: pairDifference, context: context(pair) }).reasons.includes('COMPARISON_BASIS_MISSING'), 'two explicit targets are a comparison basis'),
        check('CB-05', !detectRequirementContradiction({ requirement: qualifiedDifference, context: context(qualifiedPair) }).reasons.includes('COMPARISON_BASIS_MISSING'), 'qualified target set is a comparison basis'),
        check('CB-06', !detectRequirementContradiction({ requirement: scenarioCost, context: context(one) }).reasons.includes('COMPARISON_BASIS_MISSING'), 'scenario cost is not necessarily comparison'),
        check('CB-07', !detectRequirementContradiction({ requirement: currentCost, context: context(one) }).reasons.includes('COMPARISON_BASIS_MISSING'), 'current cost is not comparison'),
        check('CB-08', calls === 2 && retryRecovered.requirementAttempts.length === 2, 'comparison basis retry is bounded to one retry'),
        check('CB-09', retryRecovered.requirement.scenarioOverrides.some(override => override.expression === '不锈钢接轴'), 'retry may recover the owner scenario override'),
        check('CB-10', retryExhausted.requirementRetry.exhaustedReasons.includes('COMPARISON_BASIS_MISSING'), 'unrecovered comparison-basis gap remains explicit after retry'),
        check('CB-11', pairCalls === 1, 'two-target comparison does not retry'),
    ]);
    const allCases = Object.freeze([...priorSuite.cases, ...cases]);
    const output = Object.freeze({ phase: 'M4-4F', suite: 'requirement-reliability-plus-comparison-basis', passed: allCases.filter(item => item.pass).length, failed: allCases.filter(item => !item.pass).length, cases: allCases });
    fs.writeFileSync(path.join(root, 'planning/planner/M4-4F-Comparison-Basis-Tests.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}

module.exports = { writeM4fEvidence };
