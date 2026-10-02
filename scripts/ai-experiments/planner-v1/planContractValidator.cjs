'use strict';

const { PLAN_STATUSES, STEP_MODES, AMBIGUITY_USAGES } = require('./plannerMemo.cjs');

const WRITE_ENABLED = false;
const ZERO_STEP_STATUSES = new Set(['NO_TOOL_REQUIRED', 'BLOCKED_GROUNDING', 'BLOCKED_AMBIGUITY', 'BLOCKED_CAPABILITY']);

function splitIds(value) {
    if (!value || value === 'NONE') return [];
    return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function catalogById(catalog) {
    return new Map((catalog?.visibleCapabilities || []).map(capability => [capability.capabilityId, capability]));
}

function addViolation(violations, code, detail = null) {
    violations.push(Object.freeze(detail ? { code, detail } : { code }));
}

function validatePlanContract({ plan, context }) {
    const violations = [];
    const catalog = catalogById(context?.capabilityCatalog);
    const steps = [...(plan?.steps || [])];
    const facts = [...(plan?.requiredFacts || [])];
    const status = plan?.status;
    const factIds = new Set(facts.map(fact => fact.factId));
    const stepIds = new Set();
    const producers = new Map();
    let writeStageViolation = false;

    if (!PLAN_STATUSES.has(status)) addViolation(violations, 'PLAN_STATUS_INVALID', status || 'NONE');
    if (!AMBIGUITY_USAGES.has(plan?.ambiguityUsage || 'NONE')) addViolation(violations, 'AMBIGUITY_USAGE_INVALID', plan?.ambiguityUsage);
    if (ZERO_STEP_STATUSES.has(status) && steps.length) addViolation(violations, 'BLOCKED_PLAN_STEP_VIOLATION', status);
    if (status === 'BLOCKED_CAPABILITY' && !(plan?.missingCapabilities || []).length) addViolation(violations, 'MISSING_CAPABILITY_REQUIRED');
    if (status === 'BLOCKED_POLICY' && steps.length && plan?.previewPlanAvailable !== 'YES') addViolation(violations, 'BLOCKED_POLICY_SUBPLAN_UNAVAILABLE');
    if (!WRITE_ENABLED && plan?.writeRequired === 'YES' && status === 'READY') {
        writeStageViolation = true;
        addViolation(violations, 'WRITE_STAGE_POLICY_VIOLATION');
    }

    for (const step of steps) {
        if (stepIds.has(step.stepId)) addViolation(violations, 'STEP_ID_DUPLICATE', step.stepId);
        stepIds.add(step.stepId);
        if (!STEP_MODES.has(step.mode)) addViolation(violations, 'STEP_MODE_INVALID', step.mode);
        if (step.mode === 'WRITE') addViolation(violations, 'WRITE_STEP_FORBIDDEN', step.stepId);
        if (step.mode === 'COMPUTE') {
            if (step.capability !== 'NONE') addViolation(violations, 'COMPUTE_CAPABILITY_INVALID', step.capability);
            if (!step.computeInputs.length) addViolation(violations, 'COMPUTE_INPUT_MISSING', step.stepId);
        } else {
            const capability = catalog.get(step.capability);
            if (!capability) addViolation(violations, 'PLANNER_INVENTED_CAPABILITY', step.capability);
            else if (capability.mode !== step.mode) addViolation(violations, 'CAPABILITY_MODE_NOT_ALLOWED', step.capability);
        }
        const produced = splitIds(step.produces);
        if (!produced.length) addViolation(violations, 'STEP_PRODUCES_REQUIRED', step.stepId);
        for (const factId of produced) {
            if (!factIds.has(factId)) addViolation(violations, 'STEP_PRODUCES_UNKNOWN_FACT', factId);
            if (producers.has(factId)) addViolation(violations, 'FACT_MULTIPLE_PRODUCERS', factId);
            producers.set(factId, step.stepId);
        }
    }

    for (const step of steps) {
        const dependencies = splitIds(step.dependsOn);
        for (const dependency of dependencies) {
            if (!stepIds.has(dependency)) addViolation(violations, 'STEP_DEPENDENCY_MISSING', dependency);
            if (dependency === step.stepId) addViolation(violations, 'STEP_SELF_DEPENDENCY', step.stepId);
        }
        if (step.mode === 'COMPUTE') {
            for (const input of step.computeInputs) {
                const source = producers.get(input);
                const upstreamFact = facts.find(fact => fact.factId === input && fact.sourceRequirement === 'FROZEN_UPSTREAM_EVIDENCE');
                if (!source && !upstreamFact) addViolation(violations, 'COMPUTE_INPUT_MISSING', input);
                if (source && !dependencies.includes(source)) addViolation(violations, 'COMPUTE_SOURCE_INVALID', input);
            }
            for (const factId of splitIds(step.produces)) {
                const fact = facts.find(item => item.factId === factId);
                if (fact && fact.sourceRequirement !== 'LOCAL_DETERMINISTIC') addViolation(violations, 'COMPUTE_SOURCE_INVALID', factId);
            }
        }
    }

    const graph = new Map(steps.map(step => [step.stepId, splitIds(step.dependsOn)]));
    const visiting = new Set();
    const visited = new Set();
    function visit(id) {
        if (visiting.has(id)) { addViolation(violations, 'STEP_DEPENDENCY_CYCLE', id); return; }
        if (visited.has(id)) return;
        visiting.add(id);
        for (const next of graph.get(id) || []) if (graph.has(next)) visit(next);
        visiting.delete(id);
        visited.add(id);
    }
    for (const id of graph.keys()) visit(id);

    for (const fact of facts) {
        const dependencies = splitIds(fact.dependencies);
        for (const dependency of dependencies) if (!factIds.has(dependency)) addViolation(violations, 'FACT_DEPENDENCY_MISSING', dependency);
        if (fact.sourceRequirement === 'FROZEN_UPSTREAM_EVIDENCE') continue;
        if (!producers.has(fact.factId)) addViolation(violations, 'REQUIRED_FACT_UNSATISFIED', fact.factId);
    }

    const uniqueViolations = Object.freeze(violations.filter((value, index, values) => values.findIndex(other => other.code === value.code && other.detail === value.detail) === index));
    const hasNonStageViolation = uniqueViolations.some(violation => violation.code !== 'WRITE_STAGE_POLICY_VIOLATION');
    const validationStatus = writeStageViolation && !hasNonStageViolation ? 'SAFE_BLOCKED' : uniqueViolations.length ? 'INVALID' : 'VALID';
    const effectivePlanStatus = writeStageViolation ? 'BLOCKED_POLICY' : status;
    const validatedSteps = validationStatus === 'INVALID' ? Object.freeze([]) : Object.freeze(steps.filter(step => step.mode !== 'WRITE'));
    return Object.freeze({
        validationStatus,
        effectivePlanStatus,
        violations: uniqueViolations,
        validatedPlan: Object.freeze({ ...plan, status: effectivePlanStatus, steps: validatedSteps }),
        metrics: Object.freeze({ computeCapabilityLookupAttempts: 0, blockedPlanStepViolations: uniqueViolations.filter(item => item.code === 'BLOCKED_PLAN_STEP_VIOLATION').length, writeStagePolicyViolations: uniqueViolations.filter(item => item.code === 'WRITE_STAGE_POLICY_VIOLATION').length }),
    });
}

module.exports = { WRITE_ENABLED, validatePlanContract };
