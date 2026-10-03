'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseRequirementMemo } = require('../scripts/ai-experiments/planner-v1/requirementMemo.cjs');
const { normalizeRequirementStatus } = require('../scripts/ai-experiments/planner-v1/requirementStatusNormalizer.cjs');
const { validateRequirementMemo } = require('../scripts/ai-experiments/planner-v1/requirementValidator.cjs');
const { detectRequirementContradiction } = require('../scripts/ai-experiments/planner-v1/requirementContradictionDetector.cjs');
const { compilePlan } = require('../scripts/ai-experiments/planner-v1/planCompiler.cjs');
const { createPlannerCapabilityCatalogSnapshot } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');
const { runPlannerPipeline } = require('../scripts/ai-experiments/planner-v1/plannerPipeline.cjs');
const { evaluateRequirement } = require('../scripts/ai-experiments/planner-v1/plannerEvaluator.cjs');
const { UPSTREAM_FIXTURES: U } = require('../scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs');

const catalog = createPlannerCapabilityCatalogSnapshot();
function context(upstream, rawOwnerInput = 'V750通用款加浮球以后多少钱？') { return { rawOwnerInput, ...upstream, capabilityCatalog: catalog }; }
function provenanceContext(upstream, rawOwnerInput) { return { ...context(upstream, rawOwnerInput), goalProvenanceRequired: true }; }
function parsed(lines) { return parseRequirementMemo(lines.join('\n')); }
function normalized(lines, upstream, rawOwnerInput) { return normalizeRequirementStatus({ requirement: parsed(lines), context: context(upstream, rawOwnerInput) }); }
function provenanceNormalized(lines, upstream, rawOwnerInput) { return normalizeRequirementStatus({ requirement: parsed(lines), context: provenanceContext(upstream, rawOwnerInput) }); }
function memo({ status = 'READY', fact = 'SCENARIO_COST', target = 'V750通用款', override = '加浮球 | FLOAT', write = 'NO' } = {}) { return [`REQUIREMENT_STATUS: ${status}`, 'OWNER_GOAL: 场景成本', `TARGET: ${target}`, `GOAL_FACT: ${fact}`, 'SELECTION_REQUIREMENT: NONE', `SCENARIO_OVERRIDE: ${override}`, `WRITE_REQUIRED: ${write}`].join('\n'); }

test('RN-01 to RN-04 normalize Requirement status only from frozen upstream evidence', () => {
    assert.equal(normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.UNRESOLVED, '这个多少钱？').effectiveStatus, 'UNRESOLVED_GROUNDING');
    assert.equal(normalized(['REQUIREMENT_STATUS: UNRESOLVED_GROUNDING', 'OWNER_GOAL: x', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: SINGLE_TARGET_REQUIRED', 'WRITE_REQUIRED: NO'], U.COIL_GENERIC, '12-120多少钱？').effectiveStatus, 'READY');
    assert.equal(normalized(['REQUIREMENT_STATUS: UNRESOLVED_GROUNDING', 'OWNER_GOAL: x', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED).effectiveStatus, 'READY');
    assert.equal(normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.CONCEPT, '模板和配方有什么区别？').effectiveStatus, 'NO_FORMAL_FACT_REQUIRED');
});

test('RN-05 to RN-07 accept relation equivalence and preserve unresolved goal facts safely', () => {
    const relation = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 读取固定件关系', 'TARGET: 通用款模板', 'GOAL_FACT: RELATION', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.TEMPLATE, '通用款模板有哪些固定件？');
    assert.equal(validateRequirementMemo({ requirement: relation.requirement, context: context(U.TEMPLATE, '通用款模板有哪些固定件？') }).validationStatus, 'VALID');
    const detailAndRelation = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 读取固定件关系', 'TARGET: 通用款模板', 'GOAL_FACT: FORMAL_DETAIL', 'GOAL_FACT: RELATION', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.TEMPLATE, '通用款模板有哪些固定件？');
    assert.equal(validateRequirementMemo({ requirement: detailAndRelation.requirement, context: context(U.TEMPLATE, '通用款模板有哪些固定件？') }).validationStatus, 'VALID');
    const unresolved = normalized(['REQUIREMENT_STATUS: UNRESOLVED_GROUNDING', 'OWNER_GOAL: 获取成本', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.UNRESOLVED, '这个多少钱？');
    assert.equal(validateRequirementMemo({ requirement: unresolved.requirement, context: context(U.UNRESOLVED, '这个多少钱？') }).validationStatus, 'VALID');
    assert.equal(compilePlan({ requirement: unresolved.requirement, context: context(U.UNRESOLVED, '这个多少钱？') }).status, 'BLOCKED_GROUNDING');
    const broadOverrides = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景预览', 'TARGET: V750通用款', 'GOAL_FACT: SCENARIO_COST', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: V750通用款电缆5米，木箱 | CABLE', 'SCENARIO_OVERRIDE: V750通用款电缆5米，木箱 | PACKAGING', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED, 'V750通用款电缆5米，木箱，先算一下，不保存。');
    const broadValidation = validateRequirementMemo({ requirement: broadOverrides.requirement, context: context(U.V750_GENERIC_QUALIFIED, 'V750通用款电缆5米，木箱，先算一下，不保存。') });
    const evaluation = evaluateRequirement({ requirement: { facts: ['SCENARIO_COST'], overrides: ['电缆5米', '木箱'], classes: ['CABLE', 'PACKAGING'], write: 'NO' } }, { requirement: broadOverrides.requirement, requirementValidation: broadValidation, context: context(U.V750_GENERIC_QUALIFIED, 'V750通用款电缆5米，木箱，先算一下，不保存。'), requirementMemo: broadOverrides.requirement.raw });
    assert.equal(evaluation.overall, 'PASS');
});

test('RN-08 to RN-11 detect only structural scenario contradictions', () => {
    const currentOnly = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景价格', 'TARGET: V750通用款', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 加浮球 | FLOAT', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED).requirement;
    assert.ok(detectRequirementContradiction({ requirement: currentOnly, context: context(U.V750_GENERIC_QUALIFIED) }).reasons.includes('SCENARIO_GOAL_MISSING'));
    const scenarioCost = normalized(memo().split('\n'), U.V750_GENERIC_QUALIFIED).requirement;
    assert.equal(detectRequirementContradiction({ requirement: scenarioCost, context: context(U.V750_GENERIC_QUALIFIED) }).detected, false);
    const difference = normalized(memo({ fact: 'COST_DIFFERENCE' }).split('\n'), U.V750_GENERIC_QUALIFIED).requirement;
    assert.equal(detectRequirementContradiction({ requirement: difference, context: context(U.V750_GENERIC_QUALIFIED) }).detected, false);
    const underclassified = normalized(memo({ fact: 'COST_DIFFERENCE', override: '加浮球 | OTHER' }).split('\n'), U.V750_GENERIC_QUALIFIED).requirement;
    assert.ok(detectRequirementContradiction({ requirement: underclassified, context: context(U.V750_GENERIC_QUALIFIED) }).reasons.includes('SCENARIO_CLASS_UNDERCLASSIFIED'));
});

test('RN-12 to RN-15 bound retry preserves target and explicit write intent', async () => {
    let calls = 0;
    const output = await runPlannerPipeline({ rawOwnerInput: 'V750通用款加浮球以后多少钱？', upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => {
        calls += 1;
        return dependencies.retryAddendum ? memo() : memo({ fact: 'CURRENT_COST' });
    } });
    assert.equal(calls, 2);
    assert.equal(output.requirementAttempts.length, 2);
    assert.equal(output.requirementRetry.triggered, true);
    assert.equal(output.requirement.targets[0], 'V750通用款');
    assert.equal(output.requirementValidation.validationStatus, 'VALID');
    const badWrite = await runPlannerPipeline({ rawOwnerInput: 'V750通用款加浮球，先算一下，不保存。', upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => dependencies.retryAddendum ? memo({ write: 'YES' }) : memo({ fact: 'CURRENT_COST' }) });
    assert.ok(badWrite.requirementValidation.violations.some(item => item.code === 'REQUIREMENT_WRITE_INTENT_CONTRADICTION'));
});

test('CB-01 to CB-07 detect only comparison goals without a retained basis', () => {
    const oneTarget = U.V750_GENERIC_QUALIFIED;
    const twoTargets = Object.freeze({ ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: Object.freeze([...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, ...U.V110.finalGroundedTargets]) });
    const qualifiedPair = U.QUALIFIED_STYLES;
    const comparison = (fact, override = 'NONE', upstream = oneTarget) => normalized([
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', 'TARGET: V750通用款', `GOAL_FACT: ${fact}`, 'SELECTION_REQUIREMENT: NONE',
        ...(override === 'NONE' ? [] : [`SCENARIO_OVERRIDE: ${override}`]), 'WRITE_REQUIRED: NO',
    ], upstream).requirement;
    assert.ok(detectRequirementContradiction({ requirement: comparison('COST_DIFFERENCE'), context: context(oneTarget) }).reasons.includes('COMPARISON_BASIS_MISSING'));
    assert.ok(detectRequirementContradiction({ requirement: comparison('SCENARIO_COMPARISON'), context: context(oneTarget) }).reasons.includes('COMPARISON_BASIS_MISSING'));
    assert.equal(detectRequirementContradiction({ requirement: comparison('COST_DIFFERENCE', '加浮球 | FLOAT'), context: context(oneTarget) }).reasons.includes('COMPARISON_BASIS_MISSING'), false);
    assert.equal(detectRequirementContradiction({ requirement: comparison('COST_DIFFERENCE', 'NONE', twoTargets), context: context(twoTargets) }).reasons.includes('COMPARISON_BASIS_MISSING'), false);
    assert.equal(detectRequirementContradiction({ requirement: comparison('COST_DIFFERENCE', 'NONE', qualifiedPair), context: context(qualifiedPair) }).reasons.includes('COMPARISON_BASIS_MISSING'), false);
    assert.equal(detectRequirementContradiction({ requirement: comparison('SCENARIO_COST'), context: context(oneTarget) }).reasons.includes('COMPARISON_BASIS_MISSING'), false);
    assert.equal(detectRequirementContradiction({ requirement: comparison('CURRENT_COST'), context: context(oneTarget) }).reasons.includes('COMPARISON_BASIS_MISSING'), false);
});

test('CB-08 to CB-11 bound comparison-basis retry without inventing a basis', async () => {
    const first = memo({ fact: 'COST_DIFFERENCE', override: 'NONE' });
    const recovered = memo({ fact: 'COST_DIFFERENCE', override: '不锈钢接轴 | ROTOR_PROCESS' });
    let calls = 0;
    const recoveredOutput = await runPlannerPipeline({ rawOwnerInput: 'V750通用款做不锈钢接轴成本差多少？', upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => {
        calls += 1;
        return dependencies.retryAddendum ? recovered : first;
    } });
    assert.equal(calls, 2);
    assert.ok(recoveredOutput.requirementRetry.reasons.includes('COMPARISON_BASIS_MISSING'));
    assert.equal(recoveredOutput.requirement.scenarioOverrides[0].expression, '不锈钢接轴');
    const exhaustedOutput = await runPlannerPipeline({ rawOwnerInput: 'V750通用款做不锈钢接轴成本差多少？', upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => first });
    assert.equal(exhaustedOutput.requirementAttempts.length, 2);
    assert.ok(exhaustedOutput.requirementRetry.exhaustedReasons.includes('COMPARISON_BASIS_MISSING'));
    const pairUpstream = Object.freeze({ ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: Object.freeze([...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, ...U.V110.finalGroundedTargets]) });
    let pairCalls = 0;
    await runPlannerPipeline({ rawOwnerInput: 'V750通用款和V110成本差多少？', upstream: pairUpstream, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => {
        pairCalls += 1;
        return ['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', 'TARGET: V750通用款', 'TARGET: V110', 'GOAL_FACT: COST_DIFFERENCE', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'].join('\n');
    } });
    assert.equal(pairCalls, 1);
});

test('OP-01 to OP-05 preserve strict owner-span override provenance', () => {
    const owner = 'V750通用款做电泳成本增加多少？';
    const validLong = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景成本', 'TARGET: V750通用款', 'GOAL_FACT: COST_DIFFERENCE', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED, owner);
    const validShort = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景成本', 'TARGET: V750通用款', 'GOAL_FACT: COST_DIFFERENCE', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED, owner);
    const invalid = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景成本', 'TARGET: V750通用款', 'GOAL_FACT: COST_DIFFERENCE', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 增加电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED, owner);
    const multiOwner = 'V750通用款电缆5米，木箱，先算一下，不保存。';
    const cable = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景成本', 'TARGET: V750通用款', 'GOAL_FACT: SCENARIO_COST', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 电缆5米 | CABLE', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED, multiOwner);
    const rewrittenCable = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景成本', 'TARGET: V750通用款', 'GOAL_FACT: SCENARIO_COST', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 改成5米电缆 | CABLE', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED, multiOwner);
    assert.equal(validateRequirementMemo({ requirement: validLong.requirement, context: context(U.V750_GENERIC_QUALIFIED, owner) }).validationStatus, 'VALID');
    assert.equal(validateRequirementMemo({ requirement: validShort.requirement, context: context(U.V750_GENERIC_QUALIFIED, owner) }).validationStatus, 'VALID');
    assert.ok(validateRequirementMemo({ requirement: invalid.requirement, context: context(U.V750_GENERIC_QUALIFIED, owner) }).violations.some(item => item.code === 'REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING'));
    assert.equal(validateRequirementMemo({ requirement: cable.requirement, context: context(U.V750_GENERIC_QUALIFIED, multiOwner) }).validationStatus, 'VALID');
    assert.ok(validateRequirementMemo({ requirement: rewrittenCable.requirement, context: context(U.V750_GENERIC_QUALIFIED, multiOwner) }).violations.some(item => item.code === 'REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING'));
});

test('OP-06 to OP-12 retry only invalid override provenance and remains bounded', async () => {
    const owner = 'V750通用款做电泳成本增加多少？';
    const invalid = ['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景成本', 'TARGET: V750通用款', 'GOAL_FACT: COST_DIFFERENCE', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 增加电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO'].join('\n');
    const recovered = invalid.replace('增加电泳', '做电泳');
    let calls = 0;
    const output = await runPlannerPipeline({ rawOwnerInput: owner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => {
        calls += 1;
        return dependencies.retryAddendum ? recovered : invalid;
    } });
    assert.equal(calls, 2);
    assert.ok(output.requirementRetry.reasons.includes('OVERRIDE_PROVENANCE_INVALID'));
    assert.equal(output.requirementValidation.validationStatus, 'VALID');
    assert.equal(output.requirement.targets[0], 'V750通用款');
    const exhausted = await runPlannerPipeline({ rawOwnerInput: owner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => invalid });
    assert.equal(exhausted.requirementAttempts.length, 2);
    assert.ok(exhausted.requirementRetry.exhaustedReasons.includes('OVERRIDE_PROVENANCE_INVALID'));
    let validCalls = 0;
    await runPlannerPipeline({ rawOwnerInput: owner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => {
        validCalls += 1;
        return recovered;
    } });
    assert.equal(validCalls, 1);
    const multiOwner = 'V750通用款电缆5米，木箱，先算一下，不保存。';
    const multiValid = ['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景成本', 'TARGET: V750通用款', 'GOAL_FACT: SCENARIO_COST', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 电缆5米 | CABLE', 'SCENARIO_OVERRIDE: 木箱 | PACKAGING', 'WRITE_REQUIRED: NO'].join('\n');
    const multiInvalid = multiValid.replace('木箱 | PACKAGING', '改木箱包装 | PACKAGING');
    let multiCalls = 0;
    const multiOutput = await runPlannerPipeline({ rawOwnerInput: multiOwner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => {
        multiCalls += 1;
        return dependencies.retryAddendum ? multiValid : multiInvalid;
    } });
    assert.equal(multiCalls, 2);
    assert.ok(multiOutput.requirementRetry.reasons.includes('OVERRIDE_PROVENANCE_INVALID'));
    assert.equal(multiOutput.requirementValidation.validationStatus, 'VALID');
    let multiValidCalls = 0;
    await runPlannerPipeline({ rawOwnerInput: multiOwner, upstream: U.V750_GENERIC_QUALIFIED, capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => {
        multiValidCalls += 1;
        return multiValid;
    } });
    assert.equal(multiValidCalls, 1);
});

test('GP-01 to GP-07 validate terminal Goal Fact provenance without deleting legitimate multi-goals', () => {
    const owner = 'V750通用款做电泳成本增加多少？';
    const costDifference = provenanceNormalized([
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', 'TARGET: V750通用款',
        'GOAL_FACT: COST_DIFFERENCE | OWNER_SPAN=成本增加多少', 'SELECTION_REQUIREMENT: NONE',
        'SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO',
    ], U.V750_GENERIC_QUALIFIED, owner);
    assert.equal(validateRequirementMemo({ requirement: costDifference.requirement, context: provenanceContext(U.V750_GENERIC_QUALIFIED, owner) }).validationStatus, 'VALID');
    const currentCost = provenanceNormalized([
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', 'TARGET: V750通用款',
        'GOAL_FACT: CURRENT_COST | OWNER_SPAN=成本增加多少', 'SELECTION_REQUIREMENT: NONE',
        'SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO',
    ], U.V750_GENERIC_QUALIFIED, owner);
    assert.ok(validateRequirementMemo({ requirement: currentCost.requirement, context: provenanceContext(U.V750_GENERIC_QUALIFIED, owner) }).violations.some(item => item.code === 'REQUIREMENT_GOAL_FACT_PROVENANCE_UNSUPPORTED'));
    const relation = provenanceNormalized([
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 比较成本', 'TARGET: V750通用款',
        'GOAL_FACT: RELATION | OWNER_SPAN=成本增加多少', 'SELECTION_REQUIREMENT: NONE',
        'SCENARIO_OVERRIDE: 做电泳 | SURFACE_TREATMENT', 'WRITE_REQUIRED: NO',
    ], U.V750_GENERIC_QUALIFIED, owner);
    assert.ok(validateRequirementMemo({ requirement: relation.requirement, context: provenanceContext(U.V750_GENERIC_QUALIFIED, owner) }).violations.some(item => item.code === 'REQUIREMENT_GOAL_FACT_PROVENANCE_UNSUPPORTED'));
    const multiOwner = '查一下V750通用款现在用哪个线圈，再告诉我当前成本。';
    const multiGoal = provenanceNormalized([
        'REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 两项读取', 'TARGET: V750通用款',
        'GOAL_FACT: RELATION | OWNER_SPAN=现在用哪个线圈', 'GOAL_FACT: CURRENT_COST | OWNER_SPAN=当前成本',
        'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO',
    ], U.V750_GENERIC_QUALIFIED, multiOwner);
    assert.equal(validateRequirementMemo({ requirement: multiGoal.requirement, context: provenanceContext(U.V750_GENERIC_QUALIFIED, multiOwner) }).validationStatus, 'VALID');
    const missingGoal = evaluateRequirement({ requirement: { facts: ['RELATION', 'CURRENT_COST'] } }, { requirement: Object.freeze({ ...multiGoal.requirement, goalFacts: Object.freeze(['CURRENT_COST']) }), requirementValidation: validateRequirementMemo({ requirement: multiGoal.requirement, context: provenanceContext(U.V750_GENERIC_QUALIFIED, multiOwner) }), context: provenanceContext(U.V750_GENERIC_QUALIFIED, multiOwner) });
    assert.ok(missingGoal.failures.includes('REQUIREMENT_GOAL_FACT_MISSING:RELATION'));
});

test('GP-08 to GP-13 normalize redundant selection and dedupe only identical frozen identities', () => {
    const exact = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: SINGLE_TARGET_REQUIRED', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED);
    assert.equal(exact.requirement.selectionRequirement, 'NONE');
    const qualified = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: SINGLE_TARGET_REQUIRED', 'WRITE_REQUIRED: NO'], U.QUALIFIED_STYLES);
    assert.equal(qualified.requirement.selectionRequirement, 'NONE');
    const multipleCost = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.V750_GENERIC);
    assert.equal(multipleCost.requirement.selectionRequirement, 'SINGLE_TARGET_REQUIRED');
    const multipleSet = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: 12-120', 'GOAL_FACT: CANDIDATE_SET', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.COIL_GENERIC);
    assert.equal(multipleSet.requirement.selectionRequirement, 'WHOLE_SET');
    const duplicate = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'TARGET: V750-通用款', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.V750_GENERIC_QUALIFIED);
    assert.equal(duplicate.requirement.targets.length, 1);
    assert.equal(duplicate.targetDeduplications, 1);
    const pairUpstream = Object.freeze({ ...U.V750_GENERIC_QUALIFIED, finalGroundedTargets: Object.freeze([...U.V750_GENERIC_QUALIFIED.finalGroundedTargets, ...U.V110.finalGroundedTargets]) });
    const pair = normalized(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V750通用款', 'TARGET: V110', 'GOAL_FACT: COST_DIFFERENCE', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], pairUpstream);
    assert.equal(pair.requirement.targets.length, 2);
});

test('GP-14 to GP-17 retry exactly once for Goal Fact overexpansion and retains a minimal valid terminal goal', async () => {
    const owner = 'V750通用款做电泳成本增加多少？';
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
    const output = await runPlannerPipeline({ rawOwnerInput: owner, upstream: Object.freeze({ ...U.V750_GENERIC_QUALIFIED, goalProvenanceRequired: true }), capabilityCatalog: catalog }, { runRequirementPlannerAgent: async (_input, dependencies) => {
        calls += 1;
        return dependencies.retryAddendum ? recovered : first;
    } });
    assert.equal(calls, 2);
    assert.ok(output.requirementRetry.reasons.includes('GOAL_FACT_OVEREXPANDED'));
    assert.equal(output.requirementValidation.validationStatus, 'VALID');
    assert.deepEqual(output.requirement.goalFacts, ['COST_DIFFERENCE']);
    assert.equal(output.requirement.selectionRequirement, 'NONE');
    assert.equal(output.requirement.targets.length, 1);
    const exhausted = await runPlannerPipeline({ rawOwnerInput: owner, upstream: Object.freeze({ ...U.V750_GENERIC_QUALIFIED, goalProvenanceRequired: true }), capabilityCatalog: catalog }, { runRequirementPlannerAgent: async () => first });
    assert.equal(exhausted.requirementAttempts.length, 2);
    assert.ok(exhausted.requirementRetry.exhaustedReasons.includes('GOAL_FACT_OVEREXPANDED'));
});
