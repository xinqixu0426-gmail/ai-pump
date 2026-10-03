'use strict';

const GOAL_KINDS = new Set(['EXPLAIN', 'READ_VALUE', 'READ_RELATION', 'LIST', 'COUNT', 'PREVIEW_SCENARIO', 'COMPARE_TARGETS', 'COMPARE_SCENARIO']);
const RESULT_SHAPES = new Set(['VALUE', 'DETAIL', 'LIST', 'COUNT', 'DELTA', 'NONE']);
const METRICS = new Set(['COST', 'NONE']);
const SCENARIO_CLASSES = new Set(['PACKAGING', 'CABLE', 'FLOAT', 'SURFACE_TREATMENT', 'ROTOR_PROCESS', 'COIL', 'BARREL', 'OTHER']);

function valueAfter(prefix, line) { return line.startsWith(prefix) ? line.slice(prefix.length).trim() : null; }
function isNone(value) { return ['NONE', '无', '没有', '无需求'].includes(String(value || '').trim().toUpperCase()) || ['无', '没有', '无需求'].includes(String(value || '').trim()); }

function parseGoalSpecMemo(memo) {
    const result = { raw: String(memo || ''), goalKind: null, resultShape: null, metric: null, targets: [], relationRequest: null, scenarioOverrides: [], writeRequired: null, malformedLines: [], ignoredWarnings: [] };
    let ignoredEchoSection = false;
    for (const original of result.raw.split(/\r?\n/u)) {
        const line = original.trim();
        if (!line) continue;
        if (line.startsWith('RAW_OWNER_INPUT:')) { result.ignoredWarnings.push('RAW_OWNER_INPUT_ECHO'); ignoredEchoSection = true; continue; }
        const goalKind = valueAfter('GOAL_KIND:', line);
        if (goalKind !== null) { result.goalKind = goalKind; ignoredEchoSection = false; continue; }
        const shape = valueAfter('RESULT_SHAPE:', line);
        if (shape !== null) { result.resultShape = shape; ignoredEchoSection = false; continue; }
        const metric = valueAfter('METRIC:', line);
        if (metric !== null) { result.metric = metric; ignoredEchoSection = false; continue; }
        const target = valueAfter('TARGET:', line);
        if (target !== null) { if (!isNone(target)) result.targets.push(target); ignoredEchoSection = false; continue; }
        const relation = valueAfter('RELATION_REQUEST:', line);
        if (relation !== null) { result.relationRequest = isNone(relation) ? null : relation; ignoredEchoSection = false; continue; }
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
        if (line.startsWith('GOAL_FACT:')) { result.ignoredWarnings.push('GOAL_FACT_LEAK_WARNING'); ignoredEchoSection = false; continue; }
        if (ignoredEchoSection) { result.ignoredWarnings.push('RAW_OWNER_INPUT_ECHO'); continue; }
        result.malformedLines.push(line);
    }
    return Object.freeze({ ...result, targets: Object.freeze(result.targets), scenarioOverrides: Object.freeze(result.scenarioOverrides), malformedLines: Object.freeze(result.malformedLines), ignoredWarnings: Object.freeze([...new Set(result.ignoredWarnings)]) });
}

module.exports = { GOAL_KINDS, RESULT_SHAPES, METRICS, SCENARIO_CLASSES, parseGoalSpecMemo };
