'use strict';

const { runMinimalPlannerAgent } = require('./minimalPlannerAgent.cjs');
const { messagesForMinimalPlanner } = require('./minimalPlannerAgent.cjs');
const { parseMinimalPlannerMemo, validateMinimalPlannerMemo } = require('./minimalPlannerMemo.cjs');
const { resolveCatalogMentions } = require('./catalogMentionResolver.cjs');
const { compileMinimalPlanner } = require('./minimalPlannerAdapter.cjs');
const { validatePlanContract } = require('./planContractValidator.cjs');
function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
async function runMinimalPlannerPipeline(input, dependencies = {}) {
    const start = process.hrtime.bigint();
    const rawPlannerMemo = await (dependencies.runPlannerAgent || runMinimalPlannerAgent)(input, dependencies);
    const plannerMs = elapsed(start);
    const memo = parseMinimalPlannerMemo(rawPlannerMemo);
    const memoValidation = validateMinimalPlannerMemo(memo, input.rawOwnerInput);
    const resolverStart = process.hrtime.bigint();
    const resolutions = resolveCatalogMentions(memo.referenceMentions, input.catalogSnapshot);
    const resolverMs = elapsed(resolverStart);
    const compileStart = process.hrtime.bigint();
    let adapted = null; let compileError = null;
    if (memoValidation.status === 'VALID') {
        try { adapted = compileMinimalPlanner({ memo, resolutions, input, capabilityCatalog: input.capabilityCatalog }); }
        catch (error) { compileError = { code: error.code || 'MINIMAL_COMPILATION_ERROR', message: error.message }; }
    }
    const semanticCompilerMs = elapsed(compileStart);
    const validation = adapted ? validatePlanContract({ plan: adapted.rawPlan, context: adapted.context }) : null;
    return Object.freeze({ input, rawPlannerMemo, memo, memoValidation, resolutions, adapted, compileError, validation, contextChars: { rawOwnerInput: input.rawOwnerInput.length, businessMemo: input.businessMemo.length, policyMemo: input.policyMemo.length, catalog: JSON.stringify(input.catalogSnapshot).length, total: messagesForMinimalPlanner(input)[0].content.length }, timings: { plannerMs, resolverMs, semanticCompilerMs }, modelCalls: { planner: 1, resolver: 0, semanticCompiler: 0, planCompiler: 0 }, execution: { toolExecutions: 0, businessApiWrites: 0, dbWrites: 0, writeExecutions: 0 } });
}
module.exports = { runMinimalPlannerPipeline };
