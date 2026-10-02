'use strict';

const { SCENARIO_CLASSES } = require('./requirementMemo.cjs');

const SCENARIO_GOAL_FACTS = new Set(['SCENARIO_COST', 'SCENARIO_COMPARISON', 'COST_DIFFERENCE']);
const COST_GOAL_FACTS = new Set(['CURRENT_COST', 'SCENARIO_COST', 'SCENARIO_COMPARISON', 'COST_DIFFERENCE']);
const COMPARISON_GOAL_FACTS = new Set(['SCENARIO_COMPARISON', 'COST_DIFFERENCE']);

function normalized(value) { return String(value || '').normalize('NFKC').replace(/\s/gu, '').toLowerCase(); }

function businessMemoHasClassificationEvidence(override, businessMemo) {
    const expression = normalized(override.expression);
    const memo = normalized(businessMemo);
    const sharedSpan = [...expression].some((_, index) => {
        for (let end = expression.length; end - index >= 2; end -= 1) if (memo.includes(expression.slice(index, end))) return true;
        return false;
    });
    return Boolean(sharedSpan && /可配置|工艺|配置|process|configuration/u.test(String(businessMemo || '')));
}

function hasExplicitComparisonBasis(context) {
    const targets = context.finalGroundedTargets || [];
    return targets.length >= 2;
}

function detectComparisonBasisMissing({ requirement, context }) {
    const comparisonGoal = requirement.goalFacts.some(fact => COMPARISON_GOAL_FACTS.has(fact));
    if (!comparisonGoal || requirement.scenarioOverrides.length > 0 || hasExplicitComparisonBasis(context)) return false;
    return (context.finalGroundedTargets || []).length <= 1;
}

function detectOverrideProvenanceInvalid({ requirement, validation }) {
    const violations = validation?.violations || [];
    const provenanceInvalid = violations.some(violation => violation.code === 'REQUIREMENT_OVERRIDE_NOT_IN_OWNER_WORDING');
    const scenarioClassesValid = requirement.scenarioOverrides.length > 0 && requirement.scenarioOverrides.every(override => SCENARIO_CLASSES.has(override.scenarioClass));
    const targetsFromGrounding = !violations.some(violation => violation.code === 'REQUIREMENT_TARGET_NOT_FROM_GROUNDING');
    return provenanceInvalid && scenarioClassesValid && targetsFromGrounding;
}

function detectRequirementContradiction({ requirement, context, validation = null }) {
    const reasons = [];
    const hasScenario = requirement.scenarioOverrides.length > 0;
    const hasScenarioGoal = requirement.goalFacts.some(fact => SCENARIO_GOAL_FACTS.has(fact));
    const hasCostGoal = requirement.goalFacts.some(fact => COST_GOAL_FACTS.has(fact));
    if (hasScenario && hasCostGoal && !hasScenarioGoal) reasons.push('SCENARIO_GOAL_MISSING');
    if (hasScenario && requirement.scenarioOverrides.some(override => override.scenarioClass === 'OTHER' && businessMemoHasClassificationEvidence(override, context.businessMemo))) reasons.push('SCENARIO_CLASS_UNDERCLASSIFIED');
    if (detectComparisonBasisMissing({ requirement, context })) reasons.push('COMPARISON_BASIS_MISSING');
    if (detectOverrideProvenanceInvalid({ requirement, validation })) reasons.push('OVERRIDE_PROVENANCE_INVALID');
    return Object.freeze({ detected: reasons.length > 0, reasons: Object.freeze(reasons) });
}

function retryAddendum(reasons) {
    const instructions = [];
    if (reasons.includes('SCENARIO_GOAL_MISSING')) instructions.push('上一轮 Requirement 中存在明确 scenario override，但 Goal Fact 仍是当前状态事实。请重新检查老板要的是当前值、场景值，还是场景前后的差异。不要改变 frozen Grounded Target。');
    if (reasons.includes('SCENARIO_CLASS_UNDERCLASSIFIED')) instructions.push('上一轮 scenario class 使用 OTHER，但 Business Memo 对该配置提供了可归类的业务含义。请只根据 Business Memo 和老板原话重新检查 scenario class。不要判断 capability 是否支持。');
    if (reasons.includes('COMPARISON_BASIS_MISSING')) instructions.push('上一轮 Requirement 要求比较/差异结果，但没有保留形成比较所需的第二个正式目标或老板明确提出的场景变化。请重新检查老板原话中用于形成比较的变化条件或第二个对象。不要改变 frozen Grounded Target，不要判断 capability 是否支持，也不要发明正式对象。');
    if (reasons.includes('OVERRIDE_PROVENANCE_INVALID')) instructions.push('上一轮场景变化表达不是老板原话中的实际连续文字片段。请重新检查老板原话，并只使用老板实际说过的连续文字片段填写 SCENARIO_OVERRIDE。不要改写、补词、同义转述或扩大含义。不要改变 frozen Grounded Target；除非其它字段本身存在独立错误，否则保持 Goal Fact、Scenario Class、Selection Requirement 和 Write Requirement 的原语义。');
    return instructions.join('\n');
}

module.exports = { detectRequirementContradiction, detectComparisonBasisMissing, detectOverrideProvenanceInvalid, retryAddendum };
