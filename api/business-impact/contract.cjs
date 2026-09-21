'use strict';

const VERSION = 1;
const TRIGGER_MODES = Object.freeze(['PROPOSED_CHANGE', 'VERIFIED_RECORDED_CHANGE', 'VERIFIED_FACT_CHANGE']);
const EFFECT_TYPES = Object.freeze(['CHANGED', 'AFFECTED', 'RECALCULATION_REQUIRED',
    'READINESS_RECOMPUTE_REQUIRED', 'REVIEW_REQUIRED', 'DIFFERENCE_VERIFIED']);
const AUTHORITIES = Object.freeze(['CANONICAL_DIRECT_IMPACT', 'DETERMINISTIC_DERIVED_IMPACT']);
const TEMPORAL_STATES = Object.freeze(['CURRENT', 'SAVED_SNAPSHOT', 'CURRENT_VS_SAVED']);
const IMPACT_STATUSES = Object.freeze(['VERIFIED', 'PARTIAL', 'UNRESOLVED']);
const COMPLETENESS_STATES = Object.freeze(['COMPLETE', 'PARTIAL', 'UNSUPPORTED',
    'NEEDS_TRIGGER_EVIDENCE', 'NEEDS_CANONICAL_IDENTITY']);
const CHANGE_TYPES = Object.freeze(['RECIPE_CONFIGURATION_CHANGE', 'PART_PRICE_CHANGE',
    'PART_INVENTORY_CHANGE', 'TEMPLATE_CHANGE', 'ORDER_CONFIGURATION_COMPARE',
    'QUOTATION_FRESHNESS', 'TEST_REPORT_VALIDITY', 'ENGINEERING_PREDICTION']);

// Chosen from the existing relation scan cap (512), 32 KiB relation-result bound, and the
// production-shaped L5-P0 maximum tool result (14,893 bytes). The projection keeps a smaller,
// explicit target page and a 24 KiB result ceiling so it cannot become a catalogue transport.
const MAX_IMPACT_TARGETS = 50;
const MAX_IMPACT_READ_CALLS = 8;
const MAX_IMPACT_RESULT_BYTES = 24 * 1024;

function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        for (const child of Object.values(value)) deepFreeze(child);
    }
    return value;
}

module.exports = { VERSION, TRIGGER_MODES, EFFECT_TYPES, AUTHORITIES, TEMPORAL_STATES,
    IMPACT_STATUSES, COMPLETENESS_STATES, CHANGE_TYPES, MAX_IMPACT_TARGETS,
    MAX_IMPACT_READ_CALLS, MAX_IMPACT_RESULT_BYTES, deepFreeze };
