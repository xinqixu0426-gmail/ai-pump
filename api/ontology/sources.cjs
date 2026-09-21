'use strict';

function deepFreeze(value) {
    if (value && typeof value === 'object') {
        Object.values(value).forEach(deepFreeze);
        Object.freeze(value);
    }
    return value;
}

const RelationAuthority = deepFreeze({
    CANONICAL_DIRECT: 'CANONICAL_DIRECT',
    DETERMINISTIC_DERIVED: 'DETERMINISTIC_DERIVED',
    LEGACY_EXACT: 'LEGACY_EXACT',
    SEMANTIC: 'SEMANTIC',
    INFERRED: 'INFERRED',
});

// Static evidence addresses, never SQL, runtime readers, or business records.
const EntitySources = deepFreeze({
    customer: { table: 'customers', display: 'customers.name', businessKey: 'customers.name' },
    order: { table: 'orders', display: 'orders.contract_no', businessKey: 'orders.contract_no' },
    recipe: { table: 'recipes', display: 'recipes.name', businessKey: 'recipes.name' },
    part: { table: 'parts', display: 'parts.model', businessKey: 'parts.model + parts.supplier (not canonical identity)' },
    coil: { table: 'coils', display: 'coils.scheme_name', businessKey: 'coils.scheme_code' },
    template: { table: 'pump_shell_templates', display: 'pump_shell_templates.shell_model', businessKey: 'pump_shell_templates.shell_model' },
    quotation: { table: 'quotations', display: 'quotationQueries.get: customerName/status', businessKey: 'NOT_AVAILABLE' },
});

const RelationSources = deepFreeze({
    recipe_template: {
        fromType: 'recipe', toType: 'template', authority: RelationAuthority.CANONICAL_DIRECT,
        sourceOfTruth: 'SQLite:recipes.template_id -> pump_shell_templates.id',
        physicalSource: 'recipes.template_id', sourceKind: 'DB_FK',
        evidence: ['api/database/schema.cjs'],
        readStrategy: 'FORMAL_FK_QUERY_REQUIRED', temporal: 'CURRENT_REFERENCE',
        completeness: 'ACTIVE_ENDPOINTS_ONLY_NULL_FK_IS_NO_EDGE_DANGLING_FK_IS_UNAVAILABLE',
    },
    recipe_coil: {
        fromType: 'recipe', toType: 'coil', authority: RelationAuthority.CANONICAL_DIRECT,
        sourceOfTruth: 'SQLite:recipes.coil_id -> coils.id', physicalSource: 'recipes.coil_id',
        sourceKind: 'DB_FK', evidence: ['api/database/schema.cjs'],
        readStrategy: 'FORMAL_FK_QUERY_REQUIRED', temporal: 'CURRENT_REFERENCE',
        completeness: 'ACTIVE_ENDPOINTS_ONLY_NULL_FK_IS_NO_EDGE_DANGLING_FK_IS_UNAVAILABLE',
    },
    order_customer: {
        fromType: 'order', toType: 'customer', authority: RelationAuthority.CANONICAL_DIRECT,
        sourceOfTruth: 'SQLite:orders.customer_id -> customers.id', physicalSource: 'orders.customer_id',
        sourceKind: 'DB_FK', evidence: ['api/database/schema.cjs', 'api/services/relationReadService.cjs'],
        readStrategy: 'EXISTING_RELATION_READ_REQUIRES_CANONICAL_ONLY_ADAPTER', temporal: 'CURRENT_REFERENCE',
        completeness: 'ACTIVE_ID_ENDPOINTS_ONLY_LEGACY_NAME_ROWS_UNRESOLVED_NOT_NEGATIVE',
    },
    quotation_customer: {
        fromType: 'quotation', toType: 'customer', authority: RelationAuthority.CANONICAL_DIRECT,
        sourceOfTruth: 'SQLite:quotations.customer_id -> customers.id', physicalSource: 'quotations.customer_id',
        sourceKind: 'DB_FK', evidence: ['api/database/schema.cjs', 'api/services/quotationQueries.cjs'],
        readStrategy: 'FORMAL_FK_QUERY_REQUIRED', temporal: 'CURRENT_REFERENCE',
        completeness: 'ACTIVE_ENDPOINTS_ONLY_DANGLING_FK_IS_UNAVAILABLE',
    },
    order_recipe: {
        fromType: 'order', toType: 'recipe', authority: RelationAuthority.DETERMINISTIC_DERIVED,
        sourceOfTruth: 'SQLite:orders.items_json[].recipeId -> recipes.id', physicalSource: 'orders.items_json[].recipeId',
        sourceKind: 'SAVED_CANONICAL_ID', evidence: ['api/database/schema.cjs', 'api/services/orderCommands.cjs'],
        readStrategy: 'FORMAL_SAVED_ID_QUERY_REQUIRED', temporal: 'SAVED_MEMBERSHIP_CURRENT_TARGET_IDENTITY_NOT_CURRENT_CONFIGURATION',
        completeness: 'DISTINCT_EXPLICIT_IDS_ONLY_MISSING_ID_OR_TARGET_IS_UNRESOLVED_NOT_NEGATIVE',
    },
    recipe_part: {
        fromType: 'recipe', toType: 'part', authority: RelationAuthority.DETERMINISTIC_DERIVED,
        sourceOfTruth: 'SQLite:recipes.parts_json[].partId -> parts.id', physicalSource: 'recipes.parts_json[].partId',
        sourceKind: 'SAVED_CANONICAL_ID', evidence: ['api/database/schema.cjs', 'api/services/bomPartIdentity.cjs', 'api/services/relationReadService.cjs'],
        readStrategy: 'EXISTING_RELATION_READ_REQUIRES_CANONICAL_ONLY_ADAPTER', temporal: 'SAVED_MEMBERSHIP_CURRENT_TARGET_IDENTITY_NOT_CURRENT_PRICE_OR_CONFIGURATION',
        completeness: 'PARTS_JSON_ONLY_DISTINCT_EXPLICIT_IDS_NON_PART_ROLES_EXCLUDED_MISSING_IDS_UNRESOLVED',
    },
});

const RelationShapes = deepFreeze({
    recipe_template: ['recipe.uses_template', 'template.used_by_recipe', 'ZERO_OR_ONE', 'MANY'],
    recipe_coil: ['recipe.uses_coil', 'coil.used_by_recipe', 'ZERO_OR_ONE', 'MANY'],
    order_customer: ['order.belongs_to_customer', 'customer.has_order', 'ZERO_OR_ONE', 'MANY'],
    quotation_customer: ['quotation.belongs_to_customer', 'customer.has_quotation', 'ONE', 'MANY'],
    order_recipe: ['order.contains_recipe', 'recipe.contained_in_order', 'MANY', 'MANY'],
    recipe_part: ['recipe.contains_part', 'part.contained_in_recipe', 'MANY', 'MANY'],
});

module.exports = { deepFreeze, RelationAuthority, EntitySources, RelationSources, RelationShapes };
