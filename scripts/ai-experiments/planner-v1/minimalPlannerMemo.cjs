'use strict';

const RESULTS = new Set(['VALUE', 'LIST', 'COUNT', 'DELTA', 'DETAIL', 'NONE']);
const CLASSES = new Set(['PACKAGING', 'CABLE', 'FLOAT', 'SURFACE_TREATMENT', 'ROTOR_PROCESS', 'COIL', 'BARREL', 'OTHER']);
function ownerSpan(owner, span) { return Boolean(span && String(owner).normalize('NFKC').replace(/\s+/gu, '').includes(String(span).normalize('NFKC').replace(/\s+/gu, ''))); }
function parseMinimalPlannerMemo(raw) {
    const memo = { raw: String(raw || ''), planningBrief: null, requestedResult: null, metric: null, referenceMentions: [], relationRequest: null, scenarioChanges: [], writeRequired: null, malformedLines: [] };
    for (const source of memo.raw.split(/\r?\n/u)) {
        const line = source.trim(); if (!line) continue;
        const match = /^([A-Z_]+)[:：]\s*(.*)$/u.exec(line);
        if (!match) { memo.malformedLines.push(line); continue; }
        const [, key, value] = match;
        if (key === 'PLANNING_BRIEF') memo.planningBrief = value;
        else if (key === 'REQUESTED_RESULT') memo.requestedResult = value;
        else if (key === 'METRIC') memo.metric = value;
        else if (key === 'REFERENCE_MENTION' && value !== 'NONE') memo.referenceMentions.push(value);
        else if (key === 'RELATION_REQUEST') memo.relationRequest = value === 'NONE' ? null : value;
        else if (key === 'SCENARIO_CHANGE' && value !== 'NONE') {
            const parts = value.split('|').map(part => part.trim());
            memo.scenarioChanges.push({ expression: parts[0], scenarioClass: parts[1], malformed: parts.length !== 2 });
        } else if (key === 'WRITE_REQUIRED') memo.writeRequired = value;
        else if (!['REFERENCE_MENTION', 'SCENARIO_CHANGE'].includes(key)) memo.malformedLines.push(line);
    }
    return Object.freeze({ ...memo, referenceMentions: Object.freeze(memo.referenceMentions), scenarioChanges: Object.freeze(memo.scenarioChanges), malformedLines: Object.freeze(memo.malformedLines) });
}
function validateMinimalPlannerMemo(memo, owner) {
    const violations = [];
    if (!memo.planningBrief || memo.planningBrief.length > 800) violations.push('PLANNING_BRIEF_INVALID');
    if (!RESULTS.has(memo.requestedResult)) violations.push('REQUESTED_RESULT_INVALID');
    if (!['COST', 'NONE'].includes(memo.metric)) violations.push('METRIC_INVALID');
    if (!['YES', 'NO'].includes(memo.writeRequired)) violations.push('WRITE_REQUIRED_INVALID');
    for (const mention of memo.referenceMentions) if (!ownerSpan(owner, mention)) violations.push('REFERENCE_MENTION_NOT_IN_OWNER_WORDING');
    if (memo.relationRequest && !ownerSpan(owner, memo.relationRequest)) violations.push('RELATION_REQUEST_NOT_IN_OWNER_WORDING');
    for (const change of memo.scenarioChanges) {
        if (change.malformed || !CLASSES.has(change.scenarioClass)) violations.push('SCENARIO_CLASS_INVALID');
        if (!ownerSpan(owner, change.expression)) violations.push('SCENARIO_CHANGE_NOT_IN_OWNER_WORDING');
    }
    if (memo.malformedLines.length) violations.push('UNEXPECTED_PLANNER_FIELD');
    if (memo.requestedResult === 'NONE' && memo.writeRequired === 'NO' && memo.metric === 'COST') violations.push('EMPTY_COST_REQUEST');
    if (memo.requestedResult === 'NONE' && memo.writeRequired === 'YES' && memo.metric === 'COST') violations.push('WRITE_ONLY_COST_INVENTED');
    return Object.freeze({ status: violations.length ? 'INVALID' : 'VALID', violations: Object.freeze([...new Set(violations)]) });
}
module.exports = { RESULTS, CLASSES, ownerSpan, parseMinimalPlannerMemo, validateMinimalPlannerMemo };
