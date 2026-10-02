'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { parseRequirementMemo } = require('../scripts/ai-experiments/planner-v1/requirementMemo.cjs');
const { validateRequirementMemo } = require('../scripts/ai-experiments/planner-v1/requirementValidator.cjs');
const { UPSTREAM_FIXTURES: U } = require('../scripts/ai-experiments/planner-v1/frozenUpstreamFixture.cjs');

function validate(lines, upstream = U.V750_GENERIC_QUALIFIED, rawOwnerInput = 'V750通用款电缆5米，木箱，先算一下，不保存。') {
    return validateRequirementMemo({ requirement: parseRequirementMemo(lines.join('\n')), context: { rawOwnerInput, ...upstream } });
}

test('Requirement memo accepts grounded fact needs, selection, owner override provenance, and write state', () => {
    const result = validate(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: 场景预览', 'TARGET: V750通用款', 'GOAL_FACT: SCENARIO_COMPARISON', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 电缆5米 | CABLE', 'SCENARIO_OVERRIDE: 木箱 | PACKAGING', 'WRITE_REQUIRED: NO']);
    assert.equal(result.validationStatus, 'VALID');
});

test('Requirement memo rejects invented targets, invalid facts, and override text absent from owner wording', () => {
    const result = validate(['REQUIREMENT_STATUS: READY', 'OWNER_GOAL: x', 'TARGET: V999', 'GOAL_FACT: INVENTED_FACT', 'SELECTION_REQUIREMENT: NONE', 'SCENARIO_OVERRIDE: 纸箱 | PACKAGING', 'WRITE_REQUIRED: NO']);
    assert.ok(result.violations.some(item => item.code === 'REQUIREMENT_TARGET_NOT_FROM_GROUNDING'));
    assert.ok(result.violations.some(item => item.code === 'REQUIREMENT_GOAL_FACT_INVALID'));
    assert.ok(result.violations.some(item => item.code === 'REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING'));
});

test('Requirement memo enforces unresolved and no-formal-fact contracts', () => {
    assert.equal(validate(['REQUIREMENT_STATUS: UNRESOLVED_GROUNDING', 'OWNER_GOAL: x', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.UNRESOLVED, '这个多少钱？').validationStatus, 'VALID');
    assert.equal(validate(['REQUIREMENT_STATUS: NO_FORMAL_FACT_REQUIRED', 'OWNER_GOAL: x', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.CONCEPT, '模板和配方有什么区别？').validationStatus, 'VALID');
    assert.ok(validate(['REQUIREMENT_STATUS: NO_FORMAL_FACT_REQUIRED', 'OWNER_GOAL: x', 'GOAL_FACT: CURRENT_COST', 'SELECTION_REQUIREMENT: NONE', 'WRITE_REQUIRED: NO'], U.CONCEPT, '模板和配方有什么区别？').violations.some(item => item.code === 'REQUIREMENT_NO_FACT_CONTRADICTION'));
});
