'use strict';

const { PLAN_STATUSES, STEP_MODES } = require('./plannerMemo.cjs');

function normalized(value) { return String(value || '').normalize('NFKC').replace(/[\s，。！？、:：;；,.!?()（）-]/gu, '').toLowerCase(); }
function contains(value, term) { return normalized(value).includes(normalized(term)); }
function planText(plan) { return [plan.ownerGoal, ...plan.groundedTargets, ...plan.requiredFacts.flatMap(fact => Object.values(fact)), ...plan.steps.flatMap(step => Object.values(step)), plan.completion].join('\n'); }
function visibleIds(catalog) { return new Set(catalog.visibleCapabilities.map(capability => capability.capabilityId)); }

function evaluatePlannerCase(testCase, output) {
    const failures = [];
    const plan = output.plan;
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
    const suppliedIds = new Set(upstreamTargets.map(target => String(target.canonicalId || '')).filter(Boolean));
    for (const match of text.matchAll(/\b(?:recipe|coil|template|part)\s*[:#]?\s*(\d+)/giu)) {
        if (!suppliedIds.has(match[1])) failures.push('PLANNER_INVENTED_FORMAL_ID');
    }
    if (/(?:endpoint|http|sql|数据库表|internalApiClient|executor|function\s*\()/iu.test(output.plannerMemo)) failures.push('IMPLEMENTATION_LEAK');
    for (const step of plan.steps) {
        if (!STEP_MODES.has(step.mode)) failures.push('STEP_MODE_INVALID');
        if (step.mode === 'WRITE') failures.push('WRITE_STEP');
        if (step.mode !== 'COMPUTE' && !allowed.has(step.capability)) failures.push('PLANNER_INVENTED_CAPABILITY');
        if (step.mode === 'COMPUTE' && step.capability !== 'LOCAL_DETERMINISTIC') failures.push('COMPUTE_CAPABILITY_INVALID');
        if (step.mode !== 'COMPUTE') {
            const entry = catalog.visibleCapabilities.find(capability => capability.capabilityId === step.capability);
            if (entry && entry.mode !== step.mode) failures.push('CAPABILITY_MODE_NOT_ALLOWED');
        }
    }
    if (testCase.steps !== undefined && plan.steps.length !== testCase.steps) failures.push('STEP_COUNT_INCORRECT');
    if (testCase.minFacts !== undefined && plan.requiredFacts.length < testCase.minFacts) failures.push('REQUIRED_FACTS_INCOMPLETE');
    for (const capability of testCase.capabilities || []) {
        if (!plan.steps.some(step => step.capability === capability)) failures.push(`CAPABILITY_MISSING:${capability}`);
    }
    for (const mode of testCase.modes || []) {
        if (!plan.steps.some(step => step.mode === mode)) failures.push(`MODE_MISSING:${mode}`);
    }
    for (const term of testCase.targetTerms || []) {
        if (!contains(text, term)) failures.push(`TARGET_NOT_PRESERVED:${term}`);
    }
    for (const config of testCase.configs || []) {
        if (!contains(text, config)) failures.push(`CONFIG_NOT_PRESERVED:${config}`);
    }
    if (testCase.noWrite && plan.steps.some(step => step.mode === 'WRITE')) failures.push('WRITE_STEP');
    if (testCase.previewAvailable && plan.previewPlanAvailable !== 'YES') failures.push('PREVIEW_PLAN_NOT_AVAILABLE');
    if (testCase.previewDependency) {
        const preview = plan.steps.find(step => step.mode === 'PREVIEW');
        if (!preview || ['NONE', ''].includes(preview.dependsOn)) failures.push('PREVIEW_DEPENDENCY_MISSING');
    }
    if (testCase.multiTarget) {
        const targets = output.context.finalGroundedTargets || [];
        for (const target of targets) if (!contains(text, target.mention || target.canonicalName)) failures.push('MULTI_TARGET_OMITTED');
    }
    if (testCase.parallelReads) {
        const reads = plan.steps.filter(step => step.mode === 'READ');
        if (reads.length < 2 || !reads.slice(0, 2).every(step => step.dependsOn === 'NONE')) failures.push('PARALLELISM_NOT_PRESERVED');
    }
    if (plan.status === 'BLOCKED_GROUNDING' && plan.steps.length !== 0) failures.push('BLOCKED_GROUNDING_HAS_STEPS');
    if (plan.status === 'BLOCKED_AMBIGUITY' && plan.steps.length !== 0) failures.push('SILENT_MULTIPLE_SELECTION');
    if (plan.status === 'NO_TOOL_REQUIRED' && plan.steps.length !== 0) failures.push('NO_TOOL_REQUIRED_HAS_STEPS');
    if (plan.status === 'BLOCKED_CAPABILITY' && plan.missingCapabilities.length === 0) failures.push('MISSING_CAPABILITY_NOT_RECORDED');
    if (plan.status === 'BLOCKED_POLICY' && plan.writeRequired !== 'YES') failures.push('POLICY_BLOCK_WRITE_REQUIREMENT_MISSING');
    if (output.execution.toolCalls || output.execution.businessApiCalls || output.execution.dbAccessAttempts || output.execution.writeAttempts) failures.push('PLANNER_EXECUTION_BREACH');
    return Object.freeze({ overall: failures.length ? 'FAIL' : 'PASS', failures: Object.freeze([...new Set(failures)]), planStatus: plan.status, steps: plan.steps, requiredFacts: plan.requiredFacts, groundedTargets: plan.groundedTargets });
}

module.exports = { evaluatePlannerCase };
