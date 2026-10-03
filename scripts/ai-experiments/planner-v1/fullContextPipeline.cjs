'use strict';

const { runFullContextPlannerAgent } = require('./fullContextPlannerAgent.cjs');
const { parseFullContextPlannerMemo, validateFullContextMemo } = require('./fullContextPlannerMemo.cjs');
const { validatePlannerReference } = require('./fullContextIdentityValidator.cjs');
const { compileFullContextPlan } = require('./fullContextPlanAdapter.cjs');
const { validatePlanContract } = require('./planContractValidator.cjs');
function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
async function runFullContextPipeline({ rawOwnerInput, recentConversation = '', businessMemo, policyMemo, catalogSnapshot, capabilityCatalog }, dependencies = {}) {
    const input = Object.freeze({ rawOwnerInput, recentConversation, businessMemo, policyMemo, catalogSnapshot });
    const start = process.hrtime.bigint();
    const plannerMemo = await (dependencies.runPlannerAgent || runFullContextPlannerAgent)(input, dependencies);
    const plannerMs = elapsed(start);
    const memo = parseFullContextPlannerMemo(plannerMemo);
    const memoValidation = validateFullContextMemo(memo, rawOwnerInput);
    const identity = validatePlannerReference({ selectedReferences: memo.selectedReferences, referenceQuery: memo.referenceQuery, requestedResult: memo.requestedResult, rawOwnerInput, catalog: catalogSnapshot });
    const compileStart = process.hrtime.bigint();
    const adapted = memoValidation.validationStatus === 'VALID' ? compileFullContextPlan({ memo, identity, rawOwnerInput, businessMemo, policyMemo, catalogSnapshot, capabilityCatalog }) : null;
    const planCompilerMs = elapsed(compileStart);
    const validation = adapted ? validatePlanContract({ plan: adapted.rawPlan, context: adapted.context }) : null;
    const contextChars = Object.freeze({ rawOwnerInput: rawOwnerInput.length, businessMemo: businessMemo.length, policyMemo: policyMemo.length, catalog: JSON.stringify(catalogSnapshot).length, recentConversation: recentConversation.length, total: JSON.stringify(input).length });
    return Object.freeze({ input, plannerMemo, memo, memoValidation, identity, adapted, validation, contextChars, modelCalls: Object.freeze({ planner: 1, compiler: 0, grounding: 0 }), timings: Object.freeze({ plannerMs, planCompilerMs }), execution: Object.freeze({ toolExecutions: 0, businessApiWrites: 0, dbWrites: 0, writeExecutions: 0 }) });
}
module.exports = { runFullContextPipeline };
