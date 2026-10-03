'use strict';

const { runOwnerGoalSpecAgent } = require('./ownerGoalSpecAgent.cjs');
const { parseGoalSpecMemo } = require('./goalSpecMemo.cjs');
const { normalizeGoalSpec } = require('./goalSpecNormalizer.cjs');
const { validateGoalSpec } = require('./goalSpecValidator.cjs');
const { compileGoalSpecToRequirement } = require('./goalToFactCompiler.cjs');
const { compilePlan } = require('./planCompiler.cjs');
const { buildPlannerContext } = require('./plannerContext.cjs');
const { validatePlanContract } = require('./planContractValidator.cjs');

function elapsed(started) { return Number(process.hrtime.bigint() - started) / 1_000_000; }

async function runGoalSpecPipeline({ rawOwnerInput, upstream, capabilityCatalog }, dependencies = {}) {
    const context = buildPlannerContext({ rawOwnerInput, upstream, capabilityCatalog });
    const started = process.hrtime.bigint();
    const goalSpecMemo = await (dependencies.runOwnerGoalSpecAgent || runOwnerGoalSpecAgent)(context, dependencies);
    const goalSpecMs = elapsed(started);
    const parsedGoalSpec = parseGoalSpecMemo(goalSpecMemo);
    const normalized = normalizeGoalSpec({ goalSpec: parsedGoalSpec, context });
    const goalSpec = normalized.goalSpec;
    const goalSpecValidation = validateGoalSpec({ goalSpec, context });
    const compilerStarted = process.hrtime.bigint();
    const requirement = compileGoalSpecToRequirement({ goalSpec, context });
    const goalToFactMs = elapsed(compilerStarted);
    const planStarted = process.hrtime.bigint();
    const rawPlan = compilePlan({ requirement, context });
    const planCompilerMs = elapsed(planStarted);
    const validation = validatePlanContract({ plan: rawPlan, context });
    return Object.freeze({
        context, goalSpecMemo, parsedGoalSpec, goalSpec, goalSpecValidation, goalToFactRequirement: requirement,
        rawPlan, plan: rawPlan, validation, validatedPlan: validation.validatedPlan,
        modelCalls: Object.freeze({ goalSpec: 1, requirementPlanner: 0, planCompiler: 0, intent: 0, utteranceExtractor: 0 }),
        timings: Object.freeze({ goalSpecMs, goalToFactMs, planCompilerMs, totalPlannerMs: goalSpecMs + goalToFactMs + planCompilerMs }),
        execution: Object.freeze({ toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 }),
    });
}

module.exports = { runGoalSpecPipeline };
