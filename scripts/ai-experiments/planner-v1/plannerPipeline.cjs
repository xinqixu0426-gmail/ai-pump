'use strict';

const { runPlannerAgent } = require('./plannerAgent.cjs');
const { parsePlannerMemo } = require('./plannerMemo.cjs');
const { buildPlannerContext } = require('./plannerContext.cjs');
const { validatePlanContract } = require('./planContractValidator.cjs');

function elapsed(started) { return Number(process.hrtime.bigint() - started) / 1_000_000; }

async function runPlannerPipeline({ rawOwnerInput, upstream, capabilityCatalog }, dependencies = {}) {
    const context = buildPlannerContext({ rawOwnerInput, upstream, capabilityCatalog });
    const started = process.hrtime.bigint();
    const plannerRunner = dependencies.runPlannerAgent || runPlannerAgent;
    const memo = await plannerRunner(context, dependencies);
    const parsed = parsePlannerMemo(memo);
    const validation = validatePlanContract({ plan: parsed, context });
    return Object.freeze({ context, plannerMemo: memo, rawPlan: parsed, plan: parsed, validation, validatedPlan: validation.validatedPlan, modelCalls: Object.freeze({ planner: 1, intent: 0, utteranceExtractor: 0 }), timings: Object.freeze({ plannerMs: elapsed(started) }), execution: Object.freeze({ toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 }) });
}

module.exports = { runPlannerPipeline };
