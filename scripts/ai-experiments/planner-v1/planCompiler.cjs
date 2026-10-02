'use strict';

const { canCapabilitySatisfyStep } = require('./capabilityCatalogSnapshot.cjs');

const WRITE_ENABLED = false;

function freezePlan(plan) {
    return Object.freeze({ ...plan, groundedTargets: Object.freeze(plan.groundedTargets), requiredFacts: Object.freeze(plan.requiredFacts), steps: Object.freeze(plan.steps), scenarioOverrides: Object.freeze(plan.scenarioOverrides), missingRequirements: Object.freeze(plan.missingRequirements) });
}
function targetLabel(target) { return target.mention || target.canonicalName || 'UNKNOWN'; }
function targetText(targets) { return targets.map(targetLabel).join('、') || 'NONE'; }
function hasMultiple(targets) { return targets.some(target => target.status === 'MULTIPLE' || target.status === 'MULTIPLE_TYPE'); }
function isCompleteSet(context) { return context.candidateSetComplete === 'YES'; }
function missingRequirement(factClass, targets, scenarioClass, requiredSemantics) {
    return Object.freeze({ factClass, targetType: targets.length === 2 && targets.every(target => target.entityType === 'recipe') ? 'recipe_pair' : [...new Set(targets.map(target => target.entityType))].join(',') || 'NONE', scenarioClass: scenarioClass || 'NONE', requiredSemantics });
}
function basePlan(requirement, context) {
    return { status: null, ownerGoal: requirement.ownerGoal || context.rawOwnerInput, ambiguityUsage: requirement.selectionRequirement === 'SINGLE_TARGET_REQUIRED' ? 'SELECTION_REQUIRED' : requirement.selectionRequirement === 'WHOLE_SET' ? 'SET_CONSUMABLE' : 'NONE', groundedTargets: (context.finalGroundedTargets || []).map(targetLabel), requiredFacts: [], steps: [], completion: null, blockReason: null, resumeRequirement: null, scenarioOverrides: requirement.scenarioOverrides.map(item => item.expression), writeRequired: requirement.writeRequired || 'NO', previewPlanAvailable: 'NO', missingCapabilities: [], missingRequirements: [] };
}
function blocked(plan, status, blockReason, resumeRequirement = null, requirement = null) {
    plan.status = status;
    plan.blockReason = blockReason;
    plan.resumeRequirement = resumeRequirement;
    if (requirement) {
        plan.missingRequirements.push(requirement);
        plan.missingCapabilities.push(`${requirement.factClass} | ${requirement.targetType} | ${requirement.scenarioClass} | ${requirement.requiredSemantics}`);
    }
    plan.completion = status === 'BLOCKED_CAPABILITY' ? '需要满足结构化缺能力后才能完成目标。' : '需要上游条件后才能继续。';
    return freezePlan(plan);
}
function visible(context) { return context.capabilityCatalog.visibleCapabilities || []; }
function factRecords(requirement, targets) {
    return requirement.goalFacts.map((factClass, index) => Object.freeze({ factId: `F${index + 1}`, factClass, description: factClass, target: targetText(targets), sourceRequirement: 'AUTHORITATIVE_BUSINESS_SOURCE', dependencies: 'NONE' }));
}
function scenarioSupport(capability, overrides) {
    const contract = capability.scenarioClasses || {};
    const unsupported = overrides.find(override => contract[override.scenarioClass] !== 'SUPPORTED');
    return unsupported ? Object.freeze({ supported: false, override: unsupported, support: contract[unsupported.scenarioClass] || 'UNKNOWN' }) : Object.freeze({ supported: true });
}
function chooseCapability({ requirement, targets, context, facts }) {
    const scenarioRequired = requirement.scenarioOverrides.length > 0;
    const candidates = [];
    for (const capability of visible(context)) {
        if (scenarioRequired) {
            if (capability.capabilityId !== 'recipes.scenario_compare_preview') continue;
            const support = scenarioSupport(capability, requirement.scenarioOverrides);
            if (!support.supported) continue;
        }
        if (canCapabilitySatisfyStep({ capability, facts, targets }) !== 'YES') continue;
        candidates.push(capability);
    }
    return candidates.sort((left, right) => {
        const directLeft = left.produces.length === facts.length ? 0 : 1;
        const directRight = right.produces.length === facts.length ? 0 : 1;
        return directLeft - directRight || left.capabilityId.localeCompare(right.capabilityId);
    })[0] || null;
}
function compilePreviewPlan({ plan, requirement, targets, facts, capability }) {
    const step = Object.freeze({ stepId: 'P1', mode: capability.mode, capability: capability.capabilityId, target: targetText(targets), produces: facts.map(fact => fact.factId).join(','), dependsOn: 'NONE', computeInputs: Object.freeze([]) });
    plan.status = 'READY';
    plan.requiredFacts = facts;
    plan.steps = [step];
    plan.completion = '取得所需正式事实。';
    if (requirement.writeRequired === 'YES' && !WRITE_ENABLED) {
        plan.status = 'BLOCKED_POLICY';
        plan.previewPlanAvailable = 'YES';
        plan.blockReason = '当前阶段禁止正式写入。';
        plan.resumeRequirement = '在允许写入的阶段重新提交。';
    }
    return freezePlan(plan);
}

function compilePlan({ requirement, context }) {
    const plan = basePlan(requirement, context);
    const targets = context.finalGroundedTargets || [];
    if (requirement.status === 'UNRESOLVED_GROUNDING' || context.groundingResult === 'UNRESOLVED') return blocked(plan, 'BLOCKED_GROUNDING', 'Frozen Grounding 未解析正式对象。', '先完成正式对象解析。');
    if (requirement.status === 'NO_FORMAL_FACT_REQUIRED') {
        plan.status = 'NO_TOOL_REQUIRED';
        plan.completion = 'Frozen Business evidence 已足以回答。';
        return freezePlan(plan);
    }
    if (requirement.selectionRequirement === 'SINGLE_TARGET_REQUIRED' && hasMultiple(targets)) return blocked(plan, 'BLOCKED_AMBIGUITY', '当前目标有多个正式候选，所需事实属于单候选专属事实。', '明确唯一正式目标。');
    if (requirement.selectionRequirement === 'WHOLE_SET' && hasMultiple(targets) && isCompleteSet(context)) {
        plan.status = 'NO_TOOL_REQUIRED';
        plan.completion = 'Frozen Grounding 已提供完整候选集合。';
        return freezePlan(plan);
    }
    const facts = factRecords(requirement, targets);
    if (!facts.length) return blocked(plan, 'BLOCKED_CAPABILITY', 'Requirement 未提供可编译的正式事实。', '提供合法 GOAL_FACT。', missingRequirement('OTHER', targets, 'NONE', 'goal fact required'));
    const scenarioCapability = visible(context).find(capability => capability.capabilityId === 'recipes.scenario_compare_preview');
    if (requirement.scenarioOverrides.length && scenarioCapability) {
        const support = scenarioSupport(scenarioCapability, requirement.scenarioOverrides);
        if (!support.supported) {
            const semantics = support.support === 'FORMAL_BINDING_REQUIRED' ? 'formal binding required before scenario preview' : support.support === 'UNSUPPORTED' ? 'scenario override unsupported' : 'scenario override semantic support unresolved';
            const absent = missingRequirement(requirement.goalFacts[0], targets, support.override.scenarioClass, semantics);
            if (requirement.writeRequired === 'YES' && !WRITE_ENABLED) return blocked(plan, 'BLOCKED_POLICY', '当前阶段禁止正式写入；安全预览也缺少所需场景能力。', '需要允许写入的阶段，并满足场景缺能力。', absent);
            return blocked(plan, 'BLOCKED_CAPABILITY', '当前可见正式能力无法完整支持所要求场景变化。', '满足结构化缺能力。', absent);
        }
    }
    const capability = chooseCapability({ requirement, targets, context, facts });
    if (!capability) {
        const scenarioClass = requirement.scenarioOverrides[0]?.scenarioClass || 'NONE';
        const absent = missingRequirement(requirement.goalFacts[0], targets, scenarioClass, 'no compatible visible authoritative capability');
        if (requirement.writeRequired === 'YES' && !WRITE_ENABLED) return blocked(plan, 'BLOCKED_POLICY', '当前阶段禁止正式写入。', '在允许写入的阶段重新提交。', absent);
        return blocked(plan, 'BLOCKED_CAPABILITY', '当前可见正式能力不能满足所需事实。', '提供兼容的正式能力。', absent);
    }
    return compilePreviewPlan({ plan, requirement, context, targets, facts, capability });
}

module.exports = { WRITE_ENABLED, compilePlan, missingRequirement };
