'use strict';

const SCENARIO_GOAL_FACTS = new Set(['SCENARIO_COST', 'SCENARIO_COMPARISON', 'COST_DIFFERENCE']);
const COST_GOAL_FACTS = new Set(['CURRENT_COST', 'SCENARIO_COST', 'SCENARIO_COMPARISON', 'COST_DIFFERENCE']);

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

function detectRequirementContradiction({ requirement, context }) {
    const reasons = [];
    const hasScenario = requirement.scenarioOverrides.length > 0;
    const hasScenarioGoal = requirement.goalFacts.some(fact => SCENARIO_GOAL_FACTS.has(fact));
    const hasCostGoal = requirement.goalFacts.some(fact => COST_GOAL_FACTS.has(fact));
    if (hasScenario && hasCostGoal && !hasScenarioGoal) reasons.push('SCENARIO_GOAL_MISSING');
    if (hasScenario && requirement.scenarioOverrides.some(override => override.scenarioClass === 'OTHER' && businessMemoHasClassificationEvidence(override, context.businessMemo))) reasons.push('SCENARIO_CLASS_UNDERCLASSIFIED');
    return Object.freeze({ detected: reasons.length > 0, reasons: Object.freeze(reasons) });
}

function retryAddendum(reasons) {
    const instructions = [];
    if (reasons.includes('SCENARIO_GOAL_MISSING')) instructions.push('上一轮 Requirement 中存在明确 scenario override，但 Goal Fact 仍是当前状态事实。请重新检查老板要的是当前值、场景值，还是场景前后的差异。不要改变 frozen Grounded Target。');
    if (reasons.includes('SCENARIO_CLASS_UNDERCLASSIFIED')) instructions.push('上一轮 scenario class 使用 OTHER，但 Business Memo 对该配置提供了可归类的业务含义。请只根据 Business Memo 和老板原话重新检查 scenario class。不要判断 capability 是否支持。');
    return instructions.join('\n');
}

module.exports = { detectRequirementContradiction, retryAddendum };
