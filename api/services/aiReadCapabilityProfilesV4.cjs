const { getAiCapability } = require('../capabilities/registry.cjs');

const READ_INVESTIGATION_PROFILES = Object.freeze({
    search_parts: Object.freeze({
        entityTypes: Object.freeze(['part']),
        predicates: Object.freeze(['entityIdentity', 'currentScalar', 'unit', 'currentStatus', 'singleResourceDetail', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current']),
        scenarios: Object.freeze(['catalog_current']),
    }),
    search_coils: Object.freeze({
        entityTypes: Object.freeze(['coil']),
        predicates: Object.freeze(['entityIdentity', 'currentScalar', 'unit', 'currentStatus', 'singleResourceDetail', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current']),
        scenarios: Object.freeze(['coil_current']),
    }),
    search_templates: Object.freeze({
        entityTypes: Object.freeze(['template']),
        predicates: Object.freeze(['entityIdentity', 'currentStatus', 'singleResourceDetail', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current']),
        scenarios: Object.freeze(['template_current']),
    }),
    get_template_detail: Object.freeze({
        entityTypes: Object.freeze(['template']),
        predicates: Object.freeze(['entityIdentity', 'currentStatus', 'singleResourceDetail', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current']),
        scenarios: Object.freeze(['template_current']),
    }),
    get_all_recipes: Object.freeze({
        entityTypes: Object.freeze(['recipe']),
        predicates: Object.freeze(['entityIdentity', 'currentStatus', 'singleResourceDetail', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current']),
        scenarios: Object.freeze(['recipe_current']),
    }),
    get_recipe_detail: Object.freeze({
        entityTypes: Object.freeze(['recipe']),
        predicates: Object.freeze(['entityIdentity', 'currentStatus', 'singleResourceDetail', 'savedRecipeCostSnapshot', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current', 'saved_snapshot']),
        scenarios: Object.freeze(['recipe_current', 'saved_recipe_snapshot']),
    }),
    preview_recipe_cost: Object.freeze({
        entityTypes: Object.freeze(['recipe']),
        predicates: Object.freeze(['currentRecipeCost', 'unit', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current']),
        scenarios: Object.freeze(['current_recipe_cost']),
    }),
    preview_pump_shell_cost: Object.freeze({
        entityTypes: Object.freeze(['template']),
        predicates: Object.freeze(['currentScalar', 'unit', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current']),
        scenarios: Object.freeze(['current_template_cost']),
    }),
    calculate_coil_cost: Object.freeze({
        entityTypes: Object.freeze(['coil']),
        predicates: Object.freeze(['currentScalar', 'unit', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current']),
        scenarios: Object.freeze(['current_coil_cost']),
    }),
    full_calculate: Object.freeze({
        entityTypes: Object.freeze(['recipe']),
        predicates: Object.freeze(['currentScalar', 'unit', 'singleResourceDetail', 'verifiedNotFound', 'ambiguity']),
        temporalScopes: Object.freeze(['current']),
        scenarios: Object.freeze(['current_full_cost']),
    }),
});

function readInvestigationProfile(capabilityName) {
    const profile = READ_INVESTIGATION_PROFILES[String(capabilityName || '')];
    if (!profile) return null;
    const capability = getAiCapability(capabilityName);
    if (!capability || capability.access !== 'read') return null;
    if (capability.operation !== 'query' && capability.operation !== 'preview') return null;
    return Object.freeze({
        capabilityName,
        ...profile,
        domains: capability.domains,
        entityScopes: capability.entityScopes,
        sourceOfTruth: capability.sourceOfTruth,
        dataMode: capability.dataMode,
        operation: capability.operation,
        supportsPreview: capability.supportsPreview,
    });
}

function listReadInvestigationProfiles() {
    return Object.keys(READ_INVESTIGATION_PROFILES)
        .map(readInvestigationProfile)
        .filter(Boolean);
}

function primaryFactForCapability(capabilityName) {
    const profile = readInvestigationProfile(capabilityName);
    if (!profile) return null;
    const preferred = {
        search_parts: ['currentScalar', 'catalog_current'],
        search_coils: ['singleResourceDetail', 'coil_current'],
        search_templates: ['entityIdentity', 'template_current'],
        get_template_detail: ['singleResourceDetail', 'template_current'],
        get_all_recipes: ['entityIdentity', 'recipe_current'],
        get_recipe_detail: ['savedRecipeCostSnapshot', 'saved_recipe_snapshot'],
        preview_recipe_cost: ['currentRecipeCost', 'current_recipe_cost'],
        preview_pump_shell_cost: ['currentScalar', 'current_template_cost'],
        calculate_coil_cost: ['currentScalar', 'current_coil_cost'],
        full_calculate: ['currentScalar', 'current_full_cost'],
    }[capabilityName];
    return Object.freeze({
        entityType: profile.entityTypes[0],
        predicate: preferred[0],
        temporalScope: preferred[0] === 'savedRecipeCostSnapshot' ? 'saved_snapshot' : 'current',
        scenario: preferred[1],
        qualifiers: {},
    });
}

module.exports = {
    READ_INVESTIGATION_PROFILES,
    listReadInvestigationProfiles,
    primaryFactForCapability,
    readInvestigationProfile,
};
