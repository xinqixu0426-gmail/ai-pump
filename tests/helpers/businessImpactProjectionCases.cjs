'use strict';

function source(...evidence) { return { authority: 'CANONICAL_DIRECT_IMPACT', evidence }; }
function trigger(mode, entityType, canonicalId, changeType, before, after, evidence = ['fixture canonical fact']) {
    return { version: 1, mode, entityType, canonicalId: canonicalId == null ? null : String(canonicalId),
        changeType, before, after, source: source(...evidence) };
}
function buildProjectionCases(ids) {
    const recipe = ids['activeRecipe.v550'];
    return {
        'IMP-01': trigger('PROPOSED_CHANGE', 'recipe', recipe, 'RECIPE_CONFIGURATION_CHANGE',
            ids['officialCoil.12-120-kit'], ids['officialCoil.12-140-calculated'], ['canonical recipe', 'verified override']),
        'IMP-02': trigger('PROPOSED_CHANGE', 'recipe', recipe, 'TEST_REPORT_VALIDITY', null, null),
        'IMP-03': trigger('VERIFIED_FACT_CHANGE', 'recipe', recipe, 'RECIPE_CONFIGURATION_CHANGE', 'saved', 'current'),
        'IMP-04': trigger('VERIFIED_FACT_CHANGE', 'part', ids['part.bearing'], 'PART_PRICE_CHANGE', 5, 6),
        'IMP-05': trigger('VERIFIED_FACT_CHANGE', 'part', ids['part.bearing'], 'QUOTATION_FRESHNESS', 5, 6),
        'IMP-06': trigger('VERIFIED_FACT_CHANGE', 'part', ids['part.bearing'], 'PART_INVENTORY_CHANGE', 40, 0),
        'IMP-07': trigger('VERIFIED_FACT_CHANGE', 'part', ids['part.capacitor18'], 'PART_INVENTORY_CHANGE', 22, 0),
        'IMP-08': trigger('VERIFIED_RECORDED_CHANGE', 'template', ids['template.v550'], 'TEMPLATE_CHANGE', 'a', 'b'),
        'IMP-09': trigger('PROPOSED_CHANGE', 'coil', null, 'RECIPE_CONFIGURATION_CHANGE', '12-220', null),
        'IMP-10': trigger('PROPOSED_CHANGE', 'coil', ids['officialCoil.12-140-calculated'], 'ENGINEERING_PREDICTION', null, null),
        'IMP-11': trigger('VERIFIED_FACT_CHANGE', 'order', ids['order.impact'], 'ORDER_CONFIGURATION_COMPARE', 'saved', 'current'),
        'IMP-12': trigger('VERIFIED_FACT_CHANGE', 'part', ids['part.bearing'], 'PART_PRICE_CHANGE', 5, 6),
    };
}

module.exports = { buildProjectionCases, trigger };
