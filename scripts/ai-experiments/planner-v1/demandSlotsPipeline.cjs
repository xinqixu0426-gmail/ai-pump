'use strict';

const { buildPlannerContext } = require('./plannerContext.cjs');
const { runOwnerDemandSlotsAgent } = require('./ownerDemandSlotsAgent.cjs');
const { parseDemandSlotsMemo } = require('./demandSlotsMemo.cjs');
const { validateDemandSlots } = require('./demandSlotsValidator.cjs');
const { compileDemandSlots } = require('./demandSemanticCompiler.cjs');
const { compilePlan } = require('./planCompiler.cjs');
const { validatePlanContract } = require('./planContractValidator.cjs');

function elapsed(start) { return Number(process.hrtime.bigint() - start) / 1_000_000; }
function writeOnlyBlockedPlan(requirement, context) {
    const groundingBlocked = requirement.status === 'UNRESOLVED_GROUNDING';
    return Object.freeze({ status: groundingBlocked ? 'BLOCKED_GROUNDING' : 'BLOCKED_POLICY', ownerGoal: context.rawOwnerInput, ambiguityUsage: 'NONE', groundedTargets: Object.freeze(context.finalGroundedTargets.map(target => target.mention || target.canonicalName)), requiredFacts: Object.freeze([]), steps: Object.freeze([]), completion: groundingBlocked ? 'Frozen Grounding 未解析正式对象。' : '当前阶段禁止正式写入。', blockReason: groundingBlocked ? 'Frozen Grounding 未解析正式对象。' : '当前阶段禁止正式写入。', resumeRequirement: groundingBlocked ? '先完成正式对象解析。' : '在允许写入的阶段重新提交。', scenarioOverrides: Object.freeze(requirement.scenarioOverrides.map(item => item.expression)), writeRequired: 'YES', previewPlanAvailable: 'NO', missingCapabilities: Object.freeze([]), missingRequirements: Object.freeze([]) });
}
async function runDemandSlotsPipeline({ rawOwnerInput, upstream, capabilityCatalog }, dependencies = {}) {
    const context = buildPlannerContext({ rawOwnerInput, upstream, capabilityCatalog });
    const modelStart = process.hrtime.bigint();
    const slotsMemo = await (dependencies.runOwnerDemandSlotsAgent || runOwnerDemandSlotsAgent)(context, dependencies);
    const demandSlotsMs = elapsed(modelStart);
    const slots = parseDemandSlotsMemo(slotsMemo);
    const slotValidation = validateDemandSlots({ slots, context });
    const semanticStart = process.hrtime.bigint();
    const semantic = compileDemandSlots({ slots, context });
    const semanticCompilerMs = elapsed(semanticStart);
    const planStart = process.hrtime.bigint();
    const compilable = slotValidation.validationStatus === 'VALID' && semantic.semanticStatus === 'COMPILABLE';
    const rawPlan = compilable ? semantic.requirement.writeOnly ? writeOnlyBlockedPlan(semantic.requirement, context) : compilePlan({ requirement: semantic.requirement, context }) : null;
    const planCompilerMs = elapsed(planStart);
    const validation = rawPlan ? validatePlanContract({ plan: rawPlan, context }) : null;
    return Object.freeze({ context, slotsMemo, slots, slotValidation, semantic, requirement: semantic.requirement, rawPlan, validation, validatedPlan: validation?.validatedPlan || null, modelCalls: Object.freeze({ demandSlots: 1, semanticCompiler: 0, planCompiler: 0, intent: 0 }), timings: Object.freeze({ demandSlotsMs, semanticCompilerMs, planCompilerMs }), execution: Object.freeze({ toolCalls: 0, businessApiCalls: 0, dbAccessAttempts: 0, writeAttempts: 0 }) });
}
module.exports = { runDemandSlotsPipeline, writeOnlyBlockedPlan };
