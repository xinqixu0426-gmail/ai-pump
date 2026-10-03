'use strict';

const TYPES = new Set(['recipe', 'coil', 'template', 'part']);
const MODES = new Set(['READ', 'PREVIEW', 'WRITE', 'EXPLAIN']);
const RESULTS = new Set(['VALUE', 'LIST', 'COUNT', 'DELTA', 'DETAIL', 'NONE']);
const CLASSES = new Set(['PACKAGING', 'CABLE', 'FLOAT', 'SURFACE_TREATMENT', 'ROTOR_PROCESS', 'COIL', 'BARREL', 'OTHER']);
function parseFullContextPlannerMemo(memo) {
    const out = { raw: String(memo || ''), planningBrief: null, requestMode: null, requestedResult: null, metric: null, referenceQuery: null, selectedReferences: [], relationRequest: null, scenarioChanges: [], writeRequired: null, malformedLines: [] };
    for (const source of out.raw.split(/\r?\n/u)) {
        const line = source.trim(); if (!line) continue;
        const match = /^([A-Z_]+):\s*(.*)$/u.exec(line);
        if (!match) { out.malformedLines.push(line); continue; }
        const [, key, value] = match;
        if (key === 'PLANNING_BRIEF') out.planningBrief = value;
        else if (key === 'REQUEST_MODE') out.requestMode = value;
        else if (key === 'REQUESTED_RESULT') out.requestedResult = value;
        else if (key === 'METRIC') out.metric = value;
        else if (key === 'REFERENCE_QUERY') out.referenceQuery = value === 'NONE' ? null : value;
        else if (key === 'SELECTED_REFERENCE') {
            if (value !== 'NONE') {
                const parts = value.split('|').map(part => part.trim());
                out.selectedReferences.push(Object.freeze({ entityType: parts[0], id: parts[1], canonicalName: parts[2], malformed: parts.length !== 3 }));
            }
        } else if (key === 'RELATION_REQUEST') out.relationRequest = value === 'NONE' ? null : value;
        else if (key === 'SCENARIO_CHANGE') {
            if (value !== 'NONE') {
                const parts = value.split('|').map(part => part.trim());
                out.scenarioChanges.push(Object.freeze({ expression: parts[0], scenarioClass: parts[1], malformed: parts.length !== 2 }));
            }
        } else if (key === 'WRITE_REQUIRED') out.writeRequired = value;
        else out.malformedLines.push(line);
    }
    return Object.freeze({ ...out, selectedReferences: Object.freeze(out.selectedReferences), scenarioChanges: Object.freeze(out.scenarioChanges), malformedLines: Object.freeze(out.malformedLines) });
}
function ownerSpan(owner, span) { return Boolean(span && String(owner).normalize('NFKC').replace(/\s+/gu, '').includes(String(span).normalize('NFKC').replace(/\s+/gu, ''))); }
function validateFullContextMemo(memo, rawOwnerInput) {
    const violations = [];
    if (!memo.planningBrief || memo.planningBrief.length > 800) violations.push('PLANNING_BRIEF_INVALID');
    if (!MODES.has(memo.requestMode)) violations.push('REQUEST_MODE_INVALID');
    if (!RESULTS.has(memo.requestedResult)) violations.push('REQUESTED_RESULT_INVALID');
    if (!['COST', 'NONE'].includes(memo.metric)) violations.push('METRIC_INVALID');
    if (!['YES', 'NO'].includes(memo.writeRequired)) violations.push('WRITE_REQUIRED_INVALID');
    if (memo.requestMode === 'EXPLAIN' && memo.metric === 'COST') violations.push('EXPLAIN_COST_CONTRADICTION');
    if (memo.requestMode === 'WRITE' && memo.writeRequired !== 'YES') violations.push('WRITE_MODE_CONTRADICTION');
    if (memo.requestMode !== 'WRITE' && memo.writeRequired === 'YES') violations.push('WRITE_INTENT_MODE_CONTRADICTION');
    if (memo.referenceQuery && !ownerSpan(rawOwnerInput, memo.referenceQuery)) violations.push('REFERENCE_QUERY_PROVENANCE_INVALID');
    if (memo.relationRequest && !ownerSpan(rawOwnerInput, memo.relationRequest)) violations.push('RELATION_PROVENANCE_INVALID');
    for (const change of memo.scenarioChanges) {
        if (change.malformed || !CLASSES.has(change.scenarioClass)) violations.push('SCENARIO_CLASS_INVALID');
        if (!ownerSpan(rawOwnerInput, change.expression)) violations.push('SCENARIO_PROVENANCE_INVALID');
    }
    for (const reference of memo.selectedReferences) if (reference.malformed || !TYPES.has(reference.entityType) || !/^\d+$/u.test(reference.id)) violations.push('SELECTED_REFERENCE_FORMAT_INVALID');
    if (memo.malformedLines.length) violations.push('PLANNER_MEMO_MALFORMED');
    return Object.freeze({ validationStatus: violations.length ? 'INVALID' : 'VALID', violations: Object.freeze([...new Set(violations)]) });
}
module.exports = { TYPES, MODES, RESULTS, CLASSES, parseFullContextPlannerMemo, validateFullContextMemo };
