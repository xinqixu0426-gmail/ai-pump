'use strict';

const { PLAN_STATUSES, STEP_MODES, AMBIGUITY_USAGES } = require('./plannerMemo.cjs');

function normalized(value) { return String(value || '').normalize('NFKC').replace(/[\s，。！？、:：;；,.!?()（）-]/gu, '').toLowerCase(); }
function contains(value, term) { return normalized(value).includes(normalized(term)); }
function planText(plan) { return [plan.ownerGoal, plan.ambiguityUsage, ...plan.groundedTargets, ...plan.requiredFacts.flatMap(fact => Object.values(fact)), ...plan.steps.flatMap(step => Object.values(step)), plan.completion].join('\n'); }
function visibleIds(catalog) { return new Set(catalog.visibleCapabilities.map(capability => capability.capabilityId)); }
function hasCapabilityPath(steps, alternatives) {
    if (!alternatives?.length) return true;
    const selected = new Set(steps.map(step => step.mode === 'COMPUTE' ? 'COMPUTE' : step.capability));
    return alternatives.some(path => path.every(item => selected.has(item)));
}

function evaluatePlannerCase(testCase, output) {
    const failures = [];
    const rawPlan = output.rawPlan || output.plan;
    const validation = output.validation;
    const catalog = output.context.capabilityCatalog;
    const allowed = visibleIds(catalog);
    const text = planText(rawPlan);
    const expectedStatus = Array.isArray(testCase.status) ? testCase.status : [testCase.status];
    if (!PLAN_STATUSES.has(rawPlan.status) || !expectedStatus.includes(rawPlan.status)) failures.push('PLAN_STATUS_INCORRECT');
    if (!AMBIGUITY_USAGES.has(rawPlan.ambiguityUsage || 'NONE')) failures.push('AMBIGUITY_USAGE_INVALID');
    if (testCase.ambiguityUsage && rawPlan.ambiguityUsage !== testCase.ambiguityUsage) failures.push('AMBIGUITY_USAGE_INCORRECT');
    if (!rawPlan.ownerGoal) failures.push('OWNER_GOAL_NOT_PRESERVED');
    const upstreamTargets = output.context.finalGroundedTargets || [];
    for (const target of upstreamTargets) {
        const expectedMention = target.mention || target.canonicalName;
        if (expectedMention && !rawPlan.groundedTargets.some(value => contains(value, expectedMention))) failures.push('GROUNDED_TARGET_NOT_PRESERVED');
    }
    const suppliedIds = new Set(upstreamTargets.map(target => String(target.canonicalId || '')).filter(Boolean));
    for (const match of text.matchAll(/\b(?:recipe|coil|template|part)\s*[:#]?\s*(\d+)/giu)) if (!suppliedIds.has(match[1])) failures.push('PLANNER_INVENTED_FORMAL_ID');
    if (/(?:endpoint|http|sql|数据库表|internalApiClient|executor|function\s*\()/iu.test(output.plannerMemo)) failures.push('IMPLEMENTATION_LEAK');
    for (const step of rawPlan.steps) {
        if (!STEP_MODES.has(step.mode)) failures.push('STEP_MODE_INVALID');
        if (step.mode === 'WRITE') failures.push('WRITE_STEP');
        if (step.mode !== 'COMPUTE' && !allowed.has(step.capability)) failures.push('PLANNER_INVENTED_CAPABILITY');
        if (step.mode === 'COMPUTE' && step.capability !== 'NONE') failures.push('COMPUTE_CAPABILITY_INVALID');
        if (step.mode !== 'COMPUTE') {
            const entry = catalog.visibleCapabilities.find(capability => capability.capabilityId === step.capability);
            if (entry && entry.mode !== step.mode) failures.push('CAPABILITY_MODE_NOT_ALLOWED');
        }
    }
    if (testCase.steps !== undefined && rawPlan.steps.length !== testCase.steps) failures.push('STEP_COUNT_INCORRECT');
    if (testCase.minFacts !== undefined && rawPlan.requiredFacts.length < testCase.minFacts) failures.push('REQUIRED_FACTS_INCOMPLETE');
    if (!hasCapabilityPath(rawPlan.steps, testCase.capabilityPaths)) failures.push('CAPABILITY_CANNOT_SATISFY_FACT');
    for (const mode of testCase.modes || []) if (!rawPlan.steps.some(step => step.mode === mode)) failures.push(`MODE_MISSING:${mode}`);
    for (const term of testCase.targetTerms || []) if (!contains(text, term)) failures.push(`TARGET_NOT_PRESERVED:${term}`);
    for (const config of testCase.configs || []) if (!rawPlan.scenarioOverrides.some(value => contains(value, config))) failures.push(`SCENARIO_OVERRIDE_NOT_PRESERVED:${config}`);
    if (testCase.noWrite && rawPlan.steps.some(step => step.mode === 'WRITE')) failures.push('WRITE_STEP');
    if (testCase.previewAvailable && rawPlan.previewPlanAvailable !== 'YES') failures.push('PREVIEW_PLAN_NOT_AVAILABLE');
    if (testCase.multiTarget) for (const target of upstreamTargets) if (!contains(text, target.mention || target.canonicalName)) failures.push('MULTI_TARGET_OMITTED');
    if (testCase.parallelReads) {
        const reads = rawPlan.steps.filter(step => step.mode === 'READ');
        if (reads.length >= 2 && !reads.slice(0, 2).every(step => step.dependsOn === 'NONE')) failures.push('PARALLELISM_NOT_PRESERVED');
    }
    if (rawPlan.status === 'BLOCKED_POLICY' && rawPlan.writeRequired !== 'YES') failures.push('POLICY_BLOCK_WRITE_REQUIREMENT_MISSING');
    if (testCase.missingCapability && !rawPlan.missingCapabilities.some(value => contains(value, testCase.missingCapability))) failures.push('MISSING_CAPABILITY_INCORRECT');
    if (validation?.validationStatus === 'INVALID') failures.push('PLAN_CONTRACT_INVALID');
    if (output.execution.toolCalls || output.execution.businessApiCalls || output.execution.dbAccessAttempts || output.execution.writeAttempts) failures.push('PLANNER_EXECUTION_BREACH');
    const uniqueFailures = Object.freeze([...new Set(failures)]);
    return Object.freeze({ overall: uniqueFailures.length ? 'FAIL' : 'PASS', failures: uniqueFailures, classifications: Object.freeze({ modelSemantic: Object.freeze(uniqueFailures.filter(code => code !== 'PLAN_CONTRACT_INVALID')), planContract: Object.freeze((validation?.violations || []).map(violation => violation.code)), evaluatorContract: Object.freeze([]) }), planStatus: rawPlan.status, validatedStatus: validation?.effectivePlanStatus, steps: rawPlan.steps, requiredFacts: rawPlan.requiredFacts, groundedTargets: rawPlan.groundedTargets });
}

module.exports = { evaluatePlannerCase, hasCapabilityPath };
