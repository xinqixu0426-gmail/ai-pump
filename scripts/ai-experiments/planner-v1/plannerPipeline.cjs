'use strict';

const { runRequirementPlannerAgent } = require('./requirementPlannerAgent.cjs');
const { parseRequirementMemo } = require('./requirementMemo.cjs');
const { validateRequirementMemo } = require('./requirementValidator.cjs');
const { normalizeRequirementStatus } = require('./requirementStatusNormalizer.cjs');
const { detectRequirementContradiction, retryAddendum } = require('./requirementContradictionDetector.cjs');
const { compilePlan } = require('./planCompiler.cjs');
const { buildPlannerContext } = require('./plannerContext.cjs');
const { validatePlanContract } = require('./planContractValidator.cjs');

function elapsed(started) { return Number(process.hrtime.bigint() - started) / 1_000_000; }

async function runPlannerPipeline({ rawOwnerInput, upstream, capabilityCatalog }, dependencies = {}) {
    const context = buildPlannerContext({ rawOwnerInput, upstream, capabilityCatalog });
    const requirementRunner = dependencies.runRequirementPlannerAgent || runRequirementPlannerAgent;
    const runAttempt = async (retryContext = null) => {
        const started = process.hrtime.bigint();
        const memo = await requirementRunner(context, retryContext ? { ...dependencies, retryAddendum: retryContext } : dependencies);
        const plannerMs = elapsed(started);
        const parsed = parseRequirementMemo(memo);
        const normalized = normalizeRequirementStatus({ requirement: parsed, context });
        const validation = validateRequirementMemo({ requirement: normalized.requirement, context });
        return Object.freeze({ memo, parsed, normalized, validation, plannerMs });
    };
    const firstAttempt = await runAttempt();
    const contradiction = detectRequirementContradiction({ requirement: firstAttempt.normalized.requirement, context, validation: firstAttempt.validation });
    const secondAttempt = contradiction.detected ? await runAttempt(retryAddendum(contradiction.reasons)) : null;
    const finalAttempt = secondAttempt || firstAttempt;
    const finalContradiction = detectRequirementContradiction({ requirement: finalAttempt.normalized.requirement, context, validation: finalAttempt.validation });
    const requirementMemo = finalAttempt.memo;
    const requirement = finalAttempt.normalized.requirement;
    const requirementValidation = finalAttempt.validation;
    const compilerStarted = process.hrtime.bigint();
    const rawPlan = compilePlan({ requirement, context });
    const compilerMs = elapsed(compilerStarted);
    const validation = validatePlanContract({ plan: rawPlan, context });
    const attempts = Object.freeze([firstAttempt, ...(secondAttempt ? [secondAttempt] : [])].map((attempt, index) => Object.freeze({
        attempt: index + 1,
        rawRequirementMemo: attempt.memo,
        parsedRequirement: attempt.parsed,
        normalizedRequirement: attempt.normalized.requirement,
        rawStatus: attempt.normalized.rawStatus,
        effectiveStatus: attempt.normalized.effectiveStatus,
        statusSource: attempt.normalized.statusSource,
        statusNormalized: attempt.normalized.statusNormalized,
        rawSelectionRequirement: attempt.normalized.rawSelectionRequirement,
        effectiveSelectionRequirement: attempt.normalized.effectiveSelectionRequirement,
        selectionNormalized: attempt.normalized.selectionNormalized,
        rawTargetCount: attempt.normalized.requirement.rawTargets?.length || 0,
        effectiveTargetCount: attempt.normalized.requirement.targets.length,
        targetDeduplications: attempt.normalized.targetDeduplications,
        validation: attempt.validation,
        plannerMs: attempt.plannerMs,
    })));
    const requirementPlannerMs = firstAttempt.plannerMs + (secondAttempt ? secondAttempt.plannerMs : 0);
    return Object.freeze({ context, rawRequirementMemo: firstAttempt.memo, parsedRequirement: firstAttempt.parsed, normalizedRequirement: requirement, requirementMemo, requirement, requirementValidation, requirementAttempts: attempts, requirementRetry: Object.freeze({ triggered: contradiction.detected, reasons: contradiction.reasons, addendum: contradiction.detected ? retryAddendum(contradiction.reasons) : null, finalSource: secondAttempt ? 'RETRY' : 'FIRST', exhaustedReasons: Object.freeze(secondAttempt ? finalContradiction.reasons : []) }), plannerMemo: requirementMemo, rawPlan, plan: rawPlan, validation, validatedPlan: validation.validatedPlan, modelCalls: Object.freeze({ requirementPlanner: attempts.length, planner: attempts.length, planCompiler: 0, intent: 0, utteranceExtractor: 0 }), timings: Object.freeze({ requirementPlannerMs, requirementFirstMs: firstAttempt.plannerMs, requirementRetryMs: secondAttempt ? secondAttempt.plannerMs : 0, plannerMs: requirementPlannerMs, planCompilerMs: compilerMs }), execution: Object.freeze({ toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 }) });
}

module.exports = { runPlannerPipeline };
