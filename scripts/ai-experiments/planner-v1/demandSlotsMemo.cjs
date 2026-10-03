'use strict';

const SHAPES = new Set(['VALUE', 'LIST', 'COUNT', 'DELTA', 'DETAIL', 'NONE']);
const METRICS = new Set(['COST', 'NONE']);
const CLASSES = new Set(['PACKAGING', 'CABLE', 'FLOAT', 'SURFACE_TREATMENT', 'ROTOR_PROCESS', 'COIL', 'BARREL', 'OTHER']);
const FORBIDDEN = new Set(['GOAL_KIND', 'GOAL_FACT', 'TARGET', 'SELECTION_REQUIREMENT', 'REQUIREMENT_STATUS', 'PLAN_STATUS', 'CAPABILITY', 'TOOL', 'API', 'STEP']);

function parseDemandSlotsMemo(memo) {
    const parsed = { raw: String(memo || ''), resultShape: null, metric: null, relationRequest: null, scenarioOverrides: [], writeRequired: null, warnings: [], malformedLines: [], forbiddenFields: [] };
    for (const source of parsed.raw.split(/\r?\n/u)) {
        const line = source.trim();
        if (!line) continue;
        const match = /^([A-Z_]+):\s*(.*)$/u.exec(line);
        if (!match) { parsed.malformedLines.push(line); continue; }
        const [, key, value] = match;
        if (FORBIDDEN.has(key)) { parsed.forbiddenFields.push(key); continue; }
        if (key === 'RESULT_SHAPE') parsed.resultShape = value;
        else if (key === 'METRIC') parsed.metric = value;
        else if (key === 'RELATION_REQUEST') parsed.relationRequest = value === 'NONE' ? null : value;
        else if (key === 'SCENARIO_OVERRIDE') {
            if (value !== 'NONE') {
                const pieces = value.split('|').map(part => part.trim());
                parsed.scenarioOverrides.push(Object.freeze({ expression: pieces[0] || '', scenarioClass: pieces[1] || '', malformed: pieces.length !== 2 }));
            }
        } else if (key === 'WRITE_REQUIRED') parsed.writeRequired = value;
        else if (key === 'RAW_OWNER_INPUT') parsed.warnings.push('RAW_OWNER_INPUT_ECHO');
        else parsed.malformedLines.push(line);
    }
    return Object.freeze({ ...parsed, scenarioOverrides: Object.freeze(parsed.scenarioOverrides), warnings: Object.freeze(parsed.warnings), malformedLines: Object.freeze(parsed.malformedLines), forbiddenFields: Object.freeze(parsed.forbiddenFields) });
}

module.exports = { SHAPES, METRICS, CLASSES, parseDemandSlotsMemo };
