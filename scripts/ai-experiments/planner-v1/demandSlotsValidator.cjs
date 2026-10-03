'use strict';

const { SHAPES, METRICS, CLASSES } = require('./demandSlotsMemo.cjs');

function mechanical(value) { return String(value || '').normalize('NFKC').replace(/\s+/gu, '').toLowerCase(); }
function ownerSpanExists(owner, span) { return Boolean(span && mechanical(owner).includes(mechanical(span))); }

function validateDemandSlots({ slots, context }) {
    const violations = [];
    if (!SHAPES.has(slots.resultShape)) violations.push('RESULT_SHAPE_INVALID');
    if (!METRICS.has(slots.metric)) violations.push('METRIC_INVALID');
    if (!['YES', 'NO'].includes(slots.writeRequired)) violations.push('WRITE_REQUIRED_INVALID');
    if (slots.relationRequest && !ownerSpanExists(context.rawOwnerInput, slots.relationRequest)) violations.push('RELATION_REQUEST_NOT_IN_OWNER_WORDING');
    for (const override of slots.scenarioOverrides) {
        if (override.malformed || !CLASSES.has(override.scenarioClass)) violations.push('SCENARIO_CLASS_INVALID');
        if (!ownerSpanExists(context.rawOwnerInput, override.expression)) violations.push('SCENARIO_OVERRIDE_NOT_IN_OWNER_WORDING');
    }
    const shape = slots.resultShape; const metric = slots.metric; const relation = Boolean(slots.relationRequest);
    const validCombo = shape === 'VALUE' && (metric === 'COST' || metric === 'NONE' && relation)
        || shape === 'LIST' && metric === 'NONE' && relation
        || shape === 'COUNT' && metric === 'NONE'
        || shape === 'DELTA' && metric === 'COST'
        || shape === 'NONE' && metric === 'NONE' && slots.writeRequired === 'YES'
        || shape === 'DETAIL' && metric === 'NONE';
    if (!validCombo) violations.push('SLOT_COMBINATION_INVALID');
    if (slots.forbiddenFields.length) violations.push('FORBIDDEN_LLM_FIELD');
    if (slots.malformedLines.length) violations.push('SLOT_MEMO_MALFORMED');
    return Object.freeze({ validationStatus: violations.length ? 'INVALID' : 'VALID', violations: Object.freeze([...new Set(violations)]) });
}

module.exports = { validateDemandSlots, ownerSpanExists };
