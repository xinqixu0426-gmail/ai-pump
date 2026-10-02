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
function context(upstream, rawOwnerInput) { return { rawOwnerInput, ...upstream, capabilityCatalog: catalog }; }
function parse(lines, upstream, rawOwnerInput) { return normalizeRequirementStatus({ requirement: parseRequirementMemo(lines.join('\n')), context: context(upstream, rawOwnerInput) }); }
function check(id, pass, finding) { return Object.freeze({ id, pass: Boolean(pass), finding }); }
function memo({ override = '做电泳 | SURFACE_TREATMENT', fact = 'COST_DIFFERENCE', write = 'NO' } = {}) { return ['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景成本', 'TARGET: V750通用款', `GOAL_FACT: ${fact}`, 'SELECTION_REQUIREMENT: NONE', `SCENARIO_OVERRIDE: ${override}`, `WRITE_REQUIRED: ${write}`].join('\n'); }

async function writeM4gEvidence() {
    const owner = 'V750通用款做电泳成本增加多少？';
    const validLong = parse(memo().split('\n'), U.V750_GENERIC_QUALIFIED, owner);
    const validShort = parse(memo({ override: '电泳 | SURFACE_TREATMENT' }).split('\n'), U.V750_GENERIC_QUALIFIED, owner);
    const invalid = parse(memo({ override: '增加电泳 | SURFACE_TREATMENT' }).split('\n'), U.V750_GENERIC_QUALIFIED, owner);
    const multiOwner = 'V750通用款电缆5米，木箱，先算一下，不保存。';
    const cable = parse(memo({ override: '电缆5米 | CABLE', fact: 'SCENARIO_COST' }).split('\n'), U.V750_GENERIC_QUALIFIED, multiOwner);
    const rewrittenCable = parse(memo({ override: '改成5米电缆 | CABLE', fact: 'SCENARIO_COST' }).split('\n'), U.V750_GENERIC_QUALIFIED, multiOwner);
    const invalidMemo = memo({ override: '增加电泳 | SURFACE_TREATMENT' });
    const recoveredMemo = memo({ override: '做电泳 | SURFACE_TREATMENT' });
    let retryCalls = 0;
    const recovered = await runPlannerPipeline({ rawOwnerInput: owner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => {
        retryCalls += 1;
        return dependencies.retryAddendum ? recoveredMemo : invalidMemo;
    } });
    const exhausted = await runPlannerPipeline({ rawOwnerInput: owner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => invalidMemo });
    let validCalls = 0;
    await runPlannerPipeline({ rawOwnerInput: owner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => {
        validCalls += 1;
        return recoveredMemo;
    } });
    const multiValid = ['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景成本', 'TARGET: V750通用款', 'GOAL_FACT: SCENARIO_COST', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 电缆5米 | CABLE', 'SCENARIO_OVERRIDE: 木箱 | PACKAGING', 'WRITE_REQUIRED: NO'].join('\n');
    const multiInvalid = multiValid.replace('木箱 | PACKAGING', '改木箱包装 | PACKAGING');
    let multiCalls = 0;
    const multiRecovered = await runPlannerPipeline({ rawOwnerInput: multiOwner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => {
        multiCalls += 1;
        return dependencies.retryAddendum ? multiValid : multiInvalid;
    } });
    let multiValidCalls = 0;
    await runPlannerPipeline({ rawOwnerInput: multiOwner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => {
        multiValidCalls += 1;
        return multiValid;
    } });
    const previous = JSON.parse(fs.readFileSync(path.join(root, 'planning/planner/M4-4F-Comparison-Basis-Tests.json'), 'utf8'));
    const cases = Object.freeze([
        check('OP-01', validateRequirementMemo({ requirement: validLong.requirement, context: context(U.V750_GENERIC_QUALIFIED, owner) }).validationStatus === 'VALID', 'owner span 做电泳 is valid'),
        check('OP-02', validateRequirementMemo({ requirement: validShort.requirement, context: context(U.V750_GENERIC_QUALIFIED, owner) }).validationStatus === 'VALID', 'owner subspan 电泳 is valid'),
        check('OP-03', validateRequirementMemo({ requirement: invalid.requirement, context: context(U.V750_GENERIC_QUALIFIED, owner) }).violations.some(item => item.code === 'REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING'), 'paraphrase 增加电泳 is invalid'),
        check('OP-04', validateRequirementMemo({ requirement: cable.requirement, context: context(U.V750_GENERIC_QUALIFIED, multiOwner) }).validationStatus === 'VALID', 'owner span 电缆5米 is valid'),
        check('OP-05', validateRequirementMemo({ requirement: rewrittenCable.requirement, context: context(U.V750_GENERIC_QUALIFIED, multiOwner) }).violations.some(item => item.code === 'REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING'), 'paraphrase 改成5米电缆 is invalid'),
        check('OP-06', retryCalls === 2 && recovered.requirementRetry.reasons.includes('OVERRIDE_PROVENANCE_INVALID'), 'invalid provenance triggers one retry'),
        check('OP-07', recovered.requirementValidation.validationStatus === 'VALID' && recovered.requirement.scenarioOverrides[0].expression === '做电泳', 'retry restores an exact owner span'),
        check('OP-08', exhausted.requirementRetry.exhaustedReasons.includes('OVERRIDE_PROVENANCE_INVALID'), 'persistently invalid provenance stays a failure'),
        check('OP-09', exhausted.requirementAttempts.length === 2, 'retry remains bounded to one retry'),
        check('OP-10', validCalls === 1, 'valid first span does not retry'),
        check('OP-11', multiValidCalls === 1, 'both valid owner override spans do not retry'),
        check('OP-12', multiCalls === 2 && multiRecovered.requirementRetry.reasons.includes('OVERRIDE_PROVENANCE_INVALID'), 'one invalid override makes the whole requirement retry'),
    ]);
    const allCases = Object.freeze([...previous.cases, ...cases]);
    const output = Object.freeze({ phase: 'M4-4G', suite: 'requirement-reliability-comparison-and-override-provenance', passed: allCases.filter(item => item.pass).length, failed: allCases.filter(item => !item.pass).length, cases: allCases });
    fs.writeFileSync(path.join(root, 'planning/planner/M4-4G-Override-Provenance-Tests.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}

module.exports = { writeM4gEvidence };
