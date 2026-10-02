'use strict';

const { PLAN_STATUSES, STEP_MODES } = require('./plannerMemo.cjs');

function normalized(value) { return String(value || '').normalize('NFKC').replace(/[\s，。！？、:：;；,.!?()（）-]/gu, '').toLowerCase(); }
function contains(value, term) { return normalized(value).includes(normalized(term)); }
function planText(plan) { return [plan.ownerGoal, ...plan.groundedTargets, ...plan.requiredFacts.flatMap(fact => Object.values(fact)), ...plan.steps.flatMap(step => Object.values(step)), plan.completion, plan.blockReason, plan.resumeRequirement].join('\n'); }
function visibleIds(catalog) { return new Set(catalog.visibleCapabilities.map(capability => capability.capabilityId)); }
function hasCapabilityPath(steps, alternatives) {
    if (!alternatives?.length) return true;
    const selected = new Set(steps.map(step => step.mode === 'COMPUTE' ? 'COMPUTE' : step.capability));
    return alternatives.some(path => path.every(item => selected.has(item)));
}
function unique(items) { return [...new Set(items)]; }

function evaluateRequirement(testCase, output) {
    const requirement = output.requirement;
    const expected = testCase.requirement || {};
    const failures = [];
    if (output.requirementValidation.validationStatus !== 'VALID') failures.push(...output.requirementValidation.violations.map(item => item.code));
    if (expected.status && requirement.status !== expected.status) failures.push('REQUIREMENT_STATUS_INCORRECT');
    if (!requirement.ownerGoal) failures.push('REQUIREMENT_OWNER_GOAL_MISSING');
    for (const fact of expected.facts || []) if (!requirement.goalFacts.includes(fact)) failures.push(`REQUIREMENT_GOAL_FACT_MISSING:${fact}`);
    if (expected.factsAny?.length && !expected.factsAny.some(fact => requirement.goalFacts.includes(fact))) failures.push(`REQUIREMENT_GOAL_FACT_MISSING_ANY:${expected.factsAny.join(',')}`);
    if (expected.selection && requirement.selectionRequirement !== expected.selection) failures.push('REQUIREMENT_SELECTION_INCORRECT');
    for (const [index, expression] of (expected.overrides || []).entries()) {
        const actual = requirement.scenarioOverrides.find(override => contains(override.expression, expression));
        if (!actual) failures.push(`REQUIREMENT_OVERRIDE_LOSS:${expression}`);
        else if (expected.classes?.[index] && actual.scenarioClass !== expected.classes[index]) failures.push(`REQUIREMENT_SCENARIO_CLASS_INCORRECT:${expression}`);
    }
    if (expected.write && requirement.writeRequired !== expected.write) failures.push('REQUIREMENT_WRITE_INCORRECT');
    for (const target of output.context.finalGroundedTargets || []) {
        const term = target.mention || target.canonicalName;
        if (term && !requirement.targets.some(value => contains(value, term) || target.canonicalName && contains(value, target.canonicalName))) failures.push(`REQUIREMENT_TARGET_NOT_PRESERVED:${term}`);
    }
    if (/(?:capabilityId|endpoint|http|sql|数据库表|executor|tool|function\s*\()/iu.test(output.requirementMemo)) failures.push('REQUIREMENT_IMPLEMENTATION_LEAK');
    return Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures: Object.freeze(unique(failures)) });
}

function evaluateCompiledPlan(testCase, output) {
    const failures = [];
    const plan = output.rawPlan;
    const validation = output.validation;
    const catalog = output.context.capabilityCatalog;
    const allowed = visibleIds(catalog);
    const text = planText(plan);
    const expectedStatus = Array.isArray(testCase.status) ? testCase.status : [testCase.status];
    if (!PLAN_STATUSES.has(plan.status) || !expectedStatus.includes(plan.status)) failures.push('PLAN_STATUS_INCORRECT');
    if (!plan.ownerGoal) failures.push('OWNER_GOAL_NOT_PRESERVED');
    const upstreamTargets = output.context.finalGroundedTargets || [];
    for (const target of upstreamTargets) {
        const expectedMention = target.mention || target.canonicalName;
        if (expectedMention && !plan.groundedTargets.some(value => contains(value, expectedMention))) failures.push('GROUNDED_TARGET_NOT_PRESERVED');
    }
    for (const step of plan.steps) {
        if (!STEP_MODES.has(step.mode)) failures.push('STEP_MODE_INVALID');
        if (step.mode === 'WRITE') failures.push('WRITE_STEP');
        if (step.mode !== 'COMPUTE' && !allowed.has(step.capability)) failures.push('COMPILER_INVENTED_CAPABILITY');
    }
    if (testCase.steps !== undefined && plan.steps.length !== testCase.steps) failures.push('STEP_COUNT_INCORRECT');
    if (testCase.minFacts !== undefined && plan.requiredFacts.length < testCase.minFacts) failures.push('REQUIRED_FACTS_INCOMPLETE');
    if (!hasCapabilityPath(plan.steps, testCase.capabilityPaths)) failures.push('CAPABILITY_CANNOT_SATISFY_FACT');
    for (const mode of testCase.modes || []) if (!plan.steps.some(step => step.mode === mode)) failures.push(`MODE_MISSING:${mode}`);
    for (const term of testCase.targetTerms || []) if (!contains(text, term)) failures.push(`TARGET_NOT_PRESERVED:${term}`);
    for (const config of testCase.configs || []) if (!plan.scenarioOverrides.some(value => contains(value, config))) failures.push(`SCENARIO_OVERRIDE_NOT_PRESERVED:${config}`);
    if (testCase.noWrite && plan.steps.some(step => step.mode === 'WRITE')) failures.push('WRITE_STEP');
    if (testCase.previewAvailable !== undefined && (plan.previewPlanAvailable === 'YES') !== testCase.previewAvailable) failures.push('PREVIEW_PLAN_AVAILABILITY_INCORRECT');
    if (testCase.multiTarget) for (const target of upstreamTargets) if (!contains(text, target.mention || target.canonicalName)) failures.push('MULTI_TARGET_OMITTED');
    if (validation?.validationStatus === 'INVALID') failures.push('PLAN_CONTRACT_INVALID');
    if (output.execution.toolCalls || output.execution.businessApiCalls || output.execution.dbAccessAttempts || output.execution.writeAttempts) failures.push('PLANNER_EXECUTION_BREACH');
    return Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures: Object.freeze(unique(failures)) });
}

function evaluateCompilerSafety(output) {
    const failures = [];
    if (output.validation?.validationStatus === 'INVALID') failures.push('PLAN_CONTRACT_INVALID');
    if (output.rawPlan.steps.some(step => step.mode === 'WRITE')) failures.push('WRITE_STEP');
    if (output.execution.toolCalls || output.execution.businessApiCalls || output.execution.dbAccessAttempts || output.execution.writeAttempts) failures.push('PLANNER_EXECUTION_BREACH');
    return Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures: Object.freeze(unique(failures)), notEvaluableAgainstExpected: true });
}

function evaluatePlannerCase(testCase, output) {
    const requirement = evaluateRequirement(testCase, output);
    const compiler = requirement.overall === 'PASS' ? evaluateCompiledPlan(testCase, output) : evaluateCompilerSafety(output);
    const failures = Object.freeze(unique([...requirement.failures, ...compiler.failures]));
    return Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures, requirement, compiler, classifications: Object.freeze({ requirement: requirement.failures, compiler: compiler.failures, planContract: Object.freeze((output.validation?.violations || []).map(violation => violation.code)), evaluatorContract: Object.freeze([]) }), planStatus: output.rawPlan.status, validatedStatus: output.validation?.effectivePlanStatus, steps: output.rawPlan.steps, requiredFacts: output.rawPlan.requiredFacts, groundedTargets: output.rawPlan.groundedTargets });
}

module.exports = { evaluatePlannerCase, evaluateRequirement, evaluateCompiledPlan, evaluateCompilerSafety, hasCapabilityPath };
