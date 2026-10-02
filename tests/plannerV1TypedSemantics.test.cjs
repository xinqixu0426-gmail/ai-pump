'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPlannerCapabilityCatalogSnapshot, canCapabilitySatisfyFact } = require('../scripts/ai-experiments/planner-v1/capabilityCatalogSnapshot.cjs');
const { buildPlannerAdmission, validatePlannerAdmission } = require('../scripts/ai-experiments/planner-v1/plannerAdmissionGuard.cjs');
const { parsePlannerMemo } = require('../scripts/ai-experiments/planner-v1/plannerMemo.cjs');
const { validatePlanContract } = require('../scripts/ai-experiments/planner-v1/planContractValidator.cjs');
const { exact, multiple } = require('../scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs');

const catalog = createPlannerCapabilityCatalogSnapshot();
const byId = new Map(catalog.visibleCapabilities.map(item => [item.capabilityId, item]));
const recipe = exact('V750通用款', 'recipe', 11, 'V750-通用款');
const coil = exact('12-120-A', 'coil', 1, '12-120 普通小眼');
const template = exact('通用款模板', 'template', 21, '通用款模板');
function fact(factClass, target) { return { factClass, target }; }
function plan(lines) { return parsePlannerMemo(lines.join('\n')); }
function valid(lines, targets = [recipe]) { return validatePlanContract({ plan: plan(lines), context: { capabilityCatalog: catalog, finalGroundedTargets: targets, admission: buildPlannerAdmission({ rawOwnerInput: '', upstream: { groundingResult: 'EXACT', finalGroundedTargets: targets, policyMemo: '' } }) } }); }

test('TS-01 to TS-06 typed capability target compatibility is derived from descriptors', () => {
    assert.equal(canCapabilitySatisfyFact({ capability: byId.get('recipes.current_costs'), fact: fact('CURRENT_COST', 'V750通用款'), targets: [recipe] }), 'YES');
    assert.equal(canCapabilitySatisfyFact({ capability: byId.get('recipes.current_costs'), fact: fact('CURRENT_COST', '12-120-A'), targets: [coil] }), 'NO');
    assert.equal(canCapabilitySatisfyFact({ capability: byId.get('templates.detail'), fact: fact('FORMAL_DETAIL', '通用款模板'), targets: [template] }), 'YES');
    assert.equal(canCapabilitySatisfyFact({ capability: byId.get('cost.recipe_difference'), fact: fact('COST_DIFFERENCE', 'V750通用款和V110'), targets: [recipe, exact('V110', 'recipe', 14, 'V110-通用款')] }), 'YES');
    assert.equal(canCapabilitySatisfyFact({ capability: byId.get('cost.recipe_difference'), fact: fact('COST_DIFFERENCE', 'V750通用款'), targets: [recipe] }), 'NO');
    assert.equal(canCapabilitySatisfyFact({ capability: byId.get('recipes.scenario_compare_preview'), fact: fact('SCENARIO_COMPARISON', 'V750通用款'), targets: [recipe] }), 'YES');
});

test('TS-07 and TS-08 scenario descriptor exposes audited outputs and rejects absent fact class', () => {
    const preview = byId.get('recipes.scenario_compare_preview');
    assert.deepEqual(preview.produces, ['CURRENT_COST', 'SCENARIO_COST', 'SCENARIO_COMPARISON', 'COST_DIFFERENCE', 'FORMAL_DETAIL']);
    assert.equal(canCapabilitySatisfyFact({ capability: preview, fact: fact('COST_DIFFERENCE', 'V750通用款'), targets: [recipe] }), 'YES');
});

test('AG-01 to AG-05 admission guard rejects only impossible upstream status contradictions', () => {
    const exactAdmission = buildPlannerAdmission({ rawOwnerInput: '', upstream: { groundingResult: 'EXACT', finalGroundedTargets: [recipe], policyMemo: '' } });
    assert.ok(validatePlannerAdmission({ plan: { status: 'BLOCKED_GROUNDING' }, admission: exactAdmission }).includes('STATUS_GROUNDING_CONTRADICTION'));
    assert.ok(validatePlannerAdmission({ plan: { status: 'BLOCKED_AMBIGUITY' }, admission: exactAdmission }).includes('STATUS_GROUNDING_CONTRADICTION'));
    const unresolved = buildPlannerAdmission({ rawOwnerInput: '', upstream: { groundingResult: 'UNRESOLVED', finalGroundedTargets: [], policyMemo: '' } });
    assert.ok(validatePlannerAdmission({ plan: { status: 'READY' }, admission: unresolved }).includes('STATUS_GROUNDING_CONTRADICTION'));
    const many = multiple('12-120', 'coil', [{ canonicalId: 1, canonicalName: 'a' }, { canonicalId: 2, canonicalName: 'b' }]);
    const multipleAdmission = buildPlannerAdmission({ rawOwnerInput: '', upstream: { groundingResult: 'MULTIPLE', finalGroundedTargets: [many], policyMemo: '' } });
    assert.deepEqual(validatePlannerAdmission({ plan: { status: 'BLOCKED_AMBIGUITY' }, admission: multipleAdmission }), []);
    assert.deepEqual(validatePlannerAdmission({ plan: { status: 'READY' }, admission: multipleAdmission }), []);
});

test('AG-06 and AG-07 policy admission catches no-save policy routing while write stage remains blocked', () => {
    const noSave = buildPlannerAdmission({ rawOwnerInput: '先算一下，不保存', upstream: { groundingResult: 'EXACT', finalGroundedTargets: [recipe], policyMemo: '仅允许临时预览' } });
    assert.ok(validatePlannerAdmission({ plan: { status: 'BLOCKED_POLICY' }, admission: noSave }).includes('STATUS_POLICY_CONTRADICTION'));
    assert.equal(valid(['PLAN_STATUS: READY', 'OWNER_GOAL: x', 'WRITE_REQUIRED: YES']).effectivePlanStatus, 'BLOCKED_POLICY');
});

test('BC-01 to BC-05 blocked plan contract rejects future facts and permits policy preview', () => {
    assert.equal(valid(['PLAN_STATUS: BLOCKED_AMBIGUITY', 'OWNER_GOAL: x', 'BLOCK_REASON: multiple', 'RESUME_REQUIREMENT: choose one', 'REQUIRED_FACT: NONE', 'WRITE_REQUIRED: NO'], [multiple('x', 'coil', [{ canonicalId: 1, canonicalName: 'a' }, { canonicalId: 2, canonicalName: 'b' }])]).validationStatus, 'VALID');
    assert.ok(valid(['PLAN_STATUS: BLOCKED_AMBIGUITY', 'OWNER_GOAL: x', 'REQUIRED_FACT: F1 | CURRENT_COST | x | V750通用款 | AUTHORITATIVE_BUSINESS_SOURCE | NONE', 'WRITE_REQUIRED: NO']).violations.some(item => item.code === 'BLOCKED_REQUIRED_FACT_VIOLATION'));
    assert.ok(valid(['PLAN_STATUS: BLOCKED_GROUNDING', 'OWNER_GOAL: x', 'REQUIRED_FACT: F1 | CURRENT_COST | x | V750通用款 | AUTHORITATIVE_BUSINESS_SOURCE | NONE', 'WRITE_REQUIRED: NO']).violations.some(item => item.code === 'BLOCKED_REQUIRED_FACT_VIOLATION'));
    assert.ok(valid(['PLAN_STATUS: BLOCKED_CAPABILITY', 'OWNER_GOAL: x', 'MISSING_CAPABILITY: scenario', 'REQUIRED_FACT: F1 | CURRENT_COST | x | V750通用款 | AUTHORITATIVE_BUSINESS_SOURCE | NONE', 'WRITE_REQUIRED: NO']).violations.some(item => item.code === 'BLOCKED_REQUIRED_FACT_VIOLATION'));
    assert.equal(valid(['PLAN_STATUS: BLOCKED_POLICY', 'OWNER_GOAL: x', 'WRITE_REQUIRED: YES', 'PREVIEW_PLAN_AVAILABLE: YES', 'REQUIRED_FACT: F1 | SCENARIO_COMPARISON | preview | V750通用款 | AUTHORITATIVE_BUSINESS_SOURCE | NONE', 'STEP: P1 | PREVIEW | recipes.scenario_compare_preview | V750通用款 | F1 | NONE']).validationStatus, 'VALID');
});

test('MO-01 to MO-03 multi-output preview and scenario override preservation contract', () => {
    const result = valid(['PLAN_STATUS: READY', 'OWNER_GOAL: x', 'SCENARIO_OVERRIDE: 电缆5米', 'SCENARIO_OVERRIDE: 木箱', 'REQUIRED_FACT: F1 | CURRENT_COST | current | V750通用款 | AUTHORITATIVE_BUSINESS_SOURCE | NONE', 'REQUIRED_FACT: F2 | SCENARIO_COST | scenario | V750通用款 | AUTHORITATIVE_BUSINESS_SOURCE | NONE', 'REQUIRED_FACT: F3 | DERIVED_COMPUTE | delta | V750通用款 | LOCAL_DETERMINISTIC | F1,F2', 'STEP: P1 | PREVIEW | recipes.scenario_compare_preview | V750通用款 | F1,F2 | NONE', 'STEP: P2 | COMPUTE | NONE | inputs=F1,F2 | F3 | P1', 'WRITE_REQUIRED: NO']);
    assert.equal(result.validationStatus, 'VALID');
    assert.equal(result.validatedPlan.steps[0].produces, 'F1,F2');
    assert.ok(valid(['PLAN_STATUS: READY', 'OWNER_GOAL: x', 'REQUIRED_FACT: F1 | CANDIDATE_SET | impossible | V750通用款 | AUTHORITATIVE_BUSINESS_SOURCE | NONE', 'STEP: P1 | PREVIEW | recipes.scenario_compare_preview | V750通用款 | F1 | NONE', 'WRITE_REQUIRED: NO']).violations.some(item => item.code === 'CAPABILITY_OUTPUT_MISMATCH'));
});
