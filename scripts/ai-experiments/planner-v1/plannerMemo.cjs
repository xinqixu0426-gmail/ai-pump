'use strict';

const PLAN_STATUSES = new Set(['READY', 'NO_TOOL_REQUIRED', 'BLOCKED_GROUNDING', 'BLOCKED_AMBIGUITY', 'BLOCKED_CAPABILITY', 'BLOCKED_POLICY']);
const STEP_MODES = new Set(['READ', 'ANALYSIS', 'PREVIEW', 'COMPUTE']);
const AMBIGUITY_USAGES = new Set(['NONE', 'SELECTION_REQUIRED', 'SET_CONSUMABLE']);

function valueAfter(prefix, line) {
    return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null;
}

function parseKeyValueParts(line, prefix, count) {
    const rest = valueAfter(prefix, line);
    if (rest === null) return null;
    const parts = rest.split('|').map(value => value.trim());
    return parts.length >= count ? parts : null;
}

function parsePlannerMemo(memo) {
    const result = {
        raw: String(memo || ''), status: null, ownerGoal: null, groundedTargets: [], requiredFacts: [], steps: [], completion: null,
        ambiguityUsage: 'NONE', blockReason: null, resumeRequirement: null, scenarioOverrides: [], writeRequired: null, previewPlanAvailable: null, missingCapabilities: [], upstreamContractGaps: [], malformedLines: [],
    };
    for (const originalLine of result.raw.split(/\r?\n/u)) {
        const line = originalLine.trim();
        if (!line) continue;
        const status = valueAfter('PLAN_STATUS:', line);
        if (status !== null) { result.status = PLAN_STATUSES.has(status) ? status : status; continue; }
        const goal = valueAfter('OWNER_GOAL:', line);
        if (goal !== null) { result.ownerGoal = goal; continue; }
        const target = valueAfter('GROUNDED_TARGET:', line);
        if (target !== null) { result.groundedTargets.push(target); continue; }
        const ambiguityUsage = valueAfter('AMBIGUITY_USAGE:', line);
        if (ambiguityUsage !== null) { result.ambiguityUsage = ambiguityUsage; continue; }
        const requiredFactSentinel = valueAfter('REQUIRED_FACT:', line);
        if (requiredFactSentinel === 'NONE') continue;
        const fact = parseKeyValueParts(line, 'REQUIRED_FACT:', 5);
        if (fact) {
            const v3 = fact.length >= 6;
            result.requiredFacts.push(Object.freeze(v3
                ? { factId: fact[0], factClass: fact[1], description: fact[2], target: fact[3], sourceRequirement: fact[4], dependencies: fact[5] }
                : { factId: fact[0], factClass: 'OTHER', description: fact[1], target: fact[2], sourceRequirement: fact[3], dependencies: fact[4] }));
            continue;
        }
        const step = parseKeyValueParts(line, 'STEP:', 6);
        if (step) {
            const inputs = /^inputs=(.*)$/iu.exec(step[3]);
            result.steps.push(Object.freeze({ stepId: step[0], mode: step[1], capability: step[2], target: step[3], produces: step[4], dependsOn: step[5], computeInputs: Object.freeze(inputs ? inputs[1].split(',').map(value => value.trim()).filter(Boolean) : []) }));
            continue;
        }
        const completion = valueAfter('COMPLETION:', line);
        if (completion !== null) { result.completion = completion; continue; }
        const blockReason = valueAfter('BLOCK_REASON:', line);
        if (blockReason !== null) { result.blockReason = blockReason === 'NONE' ? null : blockReason; continue; }
        const resume = valueAfter('RESUME_REQUIREMENT:', line);
        if (resume !== null) { result.resumeRequirement = resume === 'NONE' ? null : resume; continue; }
        const override = valueAfter('SCENARIO_OVERRIDE:', line);
        if (override !== null) { if (override !== 'NONE') result.scenarioOverrides.push(override); continue; }
        const write = valueAfter('WRITE_REQUIRED:', line);
        if (write !== null) { result.writeRequired = write; continue; }
        const preview = valueAfter('PREVIEW_PLAN_AVAILABLE:', line);
        if (preview !== null) { result.previewPlanAvailable = preview; continue; }
        const missing = valueAfter('MISSING_CAPABILITY:', line);
        if (missing !== null) { if (missing !== 'NONE') result.missingCapabilities.push(missing); continue; }
        const gap = valueAfter('UPSTREAM_CONTRACT_GAP:', line);
        if (gap !== null) { if (gap !== 'NONE') result.upstreamContractGaps.push(gap); continue; }
        result.malformedLines.push(line);
    }
    return Object.freeze({ ...result, groundedTargets: Object.freeze(result.groundedTargets), requiredFacts: Object.freeze(result.requiredFacts), steps: Object.freeze(result.steps), scenarioOverrides: Object.freeze(result.scenarioOverrides), missingCapabilities: Object.freeze(result.missingCapabilities), upstreamContractGaps: Object.freeze(result.upstreamContractGaps), malformedLines: Object.freeze(result.malformedLines) });
}

module.exports = { PLAN_STATUSES, STEP_MODES, AMBIGUITY_USAGES, parsePlannerMemo };
