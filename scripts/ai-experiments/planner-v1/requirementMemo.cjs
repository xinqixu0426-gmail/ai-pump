'use strict';

const REQUIREMENT_STATUSES = new Set(['READY', 'NO_FORMAL_FACT_REQUIRED', 'UNRESOLVED_GROUNDING']);
const GOAL_FACT_CLASSES = new Set(['FORMAL_DETAIL', 'CURRENT_COST', 'RELATION', 'CANDIDATE_SET', 'SCENARIO_COST', 'SCENARIO_COMPARISON', 'COST_DIFFERENCE', 'OTHER']);
const SELECTION_REQUIREMENTS = new Set(['NONE', 'SINGLE_TARGET_REQUIRED', 'WHOLE_SET']);
const SCENARIO_CLASSES = new Set(['PACKAGING', 'CABLE', 'FLOAT', 'SURFACE_TREATMENT', 'ROTOR_PROCESS', 'COIL', 'BARREL', 'OTHER']);

function valueAfter(prefix, line) { return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null; }
function isNone(value) { return ['NONE', '无', '没有', '无需求'].includes(String(value || '').trim().toUpperCase()) || ['无', '没有', '无需求'].includes(String(value || '').trim()); }

function parseRequirementMemo(memo) {
    const result = {
        raw: String(memo || ''), status: null, ownerGoal: null, targets: [], goalFacts: [], scenarioOverrides: [],
        writeRequired: null, selectionRequirement: 'NONE', malformedLines: [], ignoredWarnings: [],
    };
    let ignoredEchoSection = false;
    for (const original of result.raw.split(/\r?\n/u)) {
        const line = original.trim();
        if (!line) continue;
        if (line.startsWith('RAW_OWNER_INPUT:')) { result.ignoredWarnings.push('RAW_OWNER_INPUT_ECHO'); ignoredEchoSection = true; continue; }
        const status = valueAfter('REQUIREMENT_STATUS:', line);
        if (status !== null) { result.status = status; ignoredEchoSection = false; continue; }
        const goal = valueAfter('OWNER_GOAL:', line);
        if (goal !== null) { result.ownerGoal = goal; ignoredEchoSection = false; continue; }
        const target = valueAfter('TARGET:', line);
        if (target !== null) { if (!isNone(target)) result.targets.push(target); ignoredEchoSection = false; continue; }
        const goalFact = valueAfter('GOAL_FACT:', line);
        if (goalFact !== null) { if (!isNone(goalFact)) result.goalFacts.push(goalFact); ignoredEchoSection = false; continue; }
        const selection = valueAfter('SELECTION_REQUIREMENT:', line);
        if (selection !== null) { result.selectionRequirement = selection; ignoredEchoSection = false; continue; }
        const override = valueAfter('SCENARIO_OVERRIDE:', line);
        if (override !== null) {
            if (!isNone(override)) {
                const [expression, scenarioClass] = override.split('|').map(value => value.trim());
                result.scenarioOverrides.push(Object.freeze({ expression, scenarioClass: scenarioClass || 'OTHER' }));
            }
            ignoredEchoSection = false; continue;
        }
        const write = valueAfter('WRITE_REQUIRED:', line);
        if (write !== null) { result.writeRequired = write; ignoredEchoSection = false; continue; }
        if (ignoredEchoSection) { result.ignoredWarnings.push('RAW_OWNER_INPUT_ECHO'); continue; }
        result.malformedLines.push(line);
    }
    // OTHER in an explicitly no-formal-fact or unresolved status is a common
    // line-protocol sentinel, not a future formal fact. Preserve OTHER for a
    // READY requirement, where it remains a real (and deliberately weak)
    // semantic class for later review.
    if (['NO_FORMAL_FACT_REQUIRED', 'UNRESOLVED_GROUNDING'].includes(result.status) && result.goalFacts.every(value => value === 'OTHER')) result.goalFacts = [];
    return Object.freeze({ ...result, targets: Object.freeze(result.targets), goalFacts: Object.freeze(result.goalFacts), scenarioOverrides: Object.freeze(result.scenarioOverrides), malformedLines: Object.freeze(result.malformedLines), ignoredWarnings: Object.freeze([...new Set(result.ignoredWarnings)]) });
}

module.exports = { REQUIREMENT_STATUSES, GOAL_FACT_CLASSES, SELECTION_REQUIREMENTS, SCENARIO_CLASSES, parseRequirementMemo };
