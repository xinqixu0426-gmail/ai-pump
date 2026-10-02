'use strict';

const { runRequirementPlannerAgent } = require('./requirementPlannerAgent.cjs');
const { parseRequirementMemo } = require('./requirementMemo.cjs');
const { validateRequirementMemo } = require('./requirementValidator.cjs');
const { compilePlan } = require('./planCompiler.cjs');
const { buildPlannerContext } = require('./plannerContext.cjs');
const { validatePlanContract } = require('./planContractValidator.cjs');

function elapsed(started) { return Number(process.hrtime.bigint() - started) / 1_000_000; }

async function runPlannerPipeline({ rawOwnerInput, upstream, capabilityCatalog }, dependencies = {}) {
    const context = buildPlannerContext({ rawOwnerInput, upstream, capabilityCatalog });
    const started = process.hrtime.bigint();
    const requirementRunner = dependencies.runRequirementPlannerAgent || runRequirementPlannerAgent;
    const requirementMemo = await requirementRunner(context, dependencies);
    const requirementPlannerMs = elapsed(started);
    const requirement = parseRequirementMemo(requirementMemo);
    const requirementValidation = validateRequirementMemo({ requirement, context });
    const compilerStarted = process.hrtime.bigint();
    const rawPlan = compilePlan({ requirement, context });
    const compilerMs = elapsed(compilerStarted);
    const validation = validatePlanContract({ plan: rawPlan, context });
    return Object.freeze({ context, requirementMemo, requirement, requirementValidation, plannerMemo: requirementMemo, rawPlan, plan: rawPlan, validation, validatedPlan: validation.validatedPlan, modelCalls: Object.freeze({ requirementPlanner: 1, planner: 1, planCompiler: 0, intent: 0, utteranceExtractor: 0 }), timings: Object.freeze({ requirementPlannerMs, plannerMs: requirementPlannerMs, planCompilerMs: compilerMs }), execution: Object.freeze({ toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 }) });
}

module.exports = { runPlannerPipeline };
