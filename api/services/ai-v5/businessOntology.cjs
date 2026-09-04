'use strict';

const { listV5Capabilities } = require('./capabilityRegistry.cjs');

const V5_BUSINESS_ONTOLOGY_VERSION = 1;
const CANONICAL_ID_KINDS = Object.freeze([
    'DATABASE_PRIMARY_KEY',
    'STABLE_BUSINESS_CODE',
    'PARENT_SCOPED_REFERENCE',
    'SINGLETON_SCOPE',
    'NOT_AVAILABLE',
]);
const RESOLVER_ADAPTERS = Object.freeze(['V3_FORMAL_RESULT', 'NOT_AVAILABLE']);

function entity(entityType, canonicalIdKind, identitySource, displayNameSource, normalizationPolicyId, resolverAdapter, options = {}) {
    return {
        version: V5_BUSINESS_ONTOLOGY_VERSION,
        entityType,
        canonicalIdKind,
        identitySource,
        displayNameSource,
        aliasSupport: options.aliasSupport === true,
        normalizationPolicyId,
        resolverAdapter,
        canonicalBusinessKeySource: options.canonicalBusinessKeySource || 'NOT_AVAILABLE',
        entityKind: options.entityKind || 'BUSINESS_ENTITY',
    };
}

const DECLARED_ENTITY_TYPES = [
    entity('customer', 'DATABASE_PRIMARY_KEY', 'database:customers.id', 'database:customers.name', 'V3_EXACT_AND_FUZZY_LOOKUP', 'V3_FORMAL_RESULT', { canonicalBusinessKeySource: 'database:customers.name' }),
    entity('order', 'DATABASE_PRIMARY_KEY', 'database:orders.id', 'database:orders.contract_no/customer_name', 'V3_EXACT_AND_FUZZY_LOOKUP', 'V3_FORMAL_RESULT', { canonicalBusinessKeySource: 'database:orders.contract_no' }),
    entity('recipe', 'DATABASE_PRIMARY_KEY', 'database:recipes.id', 'database:recipes.name', 'V3_EXACT_AND_FUZZY_LOOKUP', 'V3_FORMAL_RESULT', { canonicalBusinessKeySource: 'database:recipes.name' }),
    entity('part', 'DATABASE_PRIMARY_KEY', 'database:parts.id', 'formal_api:parts.model', 'V3_EXACT_AND_FUZZY_LOOKUP', 'V3_FORMAL_RESULT', { canonicalBusinessKeySource: 'database:parts.model' }),
    entity('coil', 'DATABASE_PRIMARY_KEY', 'database:coils.id', 'database:coils.scheme_name/spec', 'V3_EXACT_AND_FUZZY_LOOKUP', 'V3_FORMAL_RESULT', { canonicalBusinessKeySource: 'database:coils.scheme_code' }),
    entity('template', 'DATABASE_PRIMARY_KEY', 'database:pump_shell_templates.id', 'database:pump_shell_templates.shell_model', 'V3_EXACT_AND_FUZZY_LOOKUP', 'V3_FORMAL_RESULT', { canonicalBusinessKeySource: 'database:pump_shell_templates.shell_model' }),
    entity('quotation', 'DATABASE_PRIMARY_KEY', 'database:quotations.id', 'formal_api:quotation.customer/status', 'NONE', 'NOT_AVAILABLE'),
    entity('purchase', 'PARENT_SCOPED_REFERENCE', 'database:orders.id+orders.purchase_list_json', 'formal_api:purchase_overview', 'NONE', 'NOT_AVAILABLE', { entityKind: 'BUSINESS_AGGREGATE' }),
    entity('factory', 'SINGLETON_SCOPE', 'runtime:factory_scope', 'runtime:factory_scope', 'NONE', 'NOT_AVAILABLE', { entityKind: 'SCOPE' }),
    entity('global', 'NOT_AVAILABLE', 'NOT_AVAILABLE', 'runtime:global_scope', 'NONE', 'NOT_AVAILABLE', { entityKind: 'SCOPE' }),
    entity('workflow', 'DATABASE_PRIMARY_KEY', 'database:factory_workflow_runs.id', 'database:factory_workflow_runs.workflow_type', 'NONE', 'NOT_AVAILABLE'),
    entity('file', 'DATABASE_PRIMARY_KEY', 'database:factory_files.id', 'database:factory_files.original_name', 'NONE', 'NOT_AVAILABLE', { canonicalBusinessKeySource: 'database:factory_files.file_sha256' }),
    entity('business_record', 'DATABASE_PRIMARY_KEY', 'database:business_change_events.id', 'database:business_change_events.summary', 'NONE', 'NOT_AVAILABLE', { canonicalBusinessKeySource: 'database:business_change_events.operation_id' }),
    entity('knowledge', 'DATABASE_PRIMARY_KEY', 'database:knowledge_entries.id', 'database:knowledge_entries.title', 'NONE', 'NOT_AVAILABLE', { canonicalBusinessKeySource: 'database:knowledge_entries.source_table+source_id' }),
    entity('drawing', 'DATABASE_PRIMARY_KEY', 'database:rotor_drawings.id', 'database:rotor_drawings.drawing_name', 'NONE', 'NOT_AVAILABLE', { canonicalBusinessKeySource: 'database:rotor_drawings.job_id' }),
    entity('cost_context', 'NOT_AVAILABLE', 'NOT_AVAILABLE', 'formal_api:cost_request_context', 'NONE', 'NOT_AVAILABLE', { entityKind: 'CALCULATION_CONTEXT' }),
    entity('stator_variant', 'DATABASE_PRIMARY_KEY', 'database:stator_variants.id', 'database:stator_variants.common_name/diameter_mm', 'NONE', 'NOT_AVAILABLE', { canonicalBusinessKeySource: 'database:stator_variants.diameter_mm+material+slot_type' }),
    entity('pump_variant', 'DATABASE_PRIMARY_KEY', 'database:pump_model_variants.id', 'database:pump_model_variants.model_name', 'NONE', 'NOT_AVAILABLE', { canonicalBusinessKeySource: 'database:pump_model_variants.model_name' }),
    entity('technical_file', 'DATABASE_PRIMARY_KEY', 'database:recipe_technical_files.id', 'database:recipe_technical_files.original_name', 'NONE', 'NOT_AVAILABLE', { canonicalBusinessKeySource: 'database:recipe_technical_files.recipe_id+file_sha256' }),
];

const V5_ONTOLOGY_RELATIONS = Object.freeze([
    Object.freeze({ from: 'quotation', relation: 'BELONGS_TO', to: 'customer', source: 'database:quotations.customer_id' }),
    Object.freeze({ from: 'order', relation: 'BELONGS_TO', to: 'customer', source: 'database:orders.customer_id' }),
    Object.freeze({ from: 'recipe', relation: 'USES', to: 'template', source: 'database:recipes.template_id' }),
    Object.freeze({ from: 'recipe', relation: 'USES', to: 'coil', source: 'database:recipes.coil_id' }),
    Object.freeze({ from: 'coil', relation: 'BELONGS_TO', to: 'stator_variant', source: 'database:coils.stator_variant_id' }),
    Object.freeze({ from: 'pump_variant', relation: 'USES', to: 'template', source: 'database:pump_model_variants.template_id' }),
    Object.freeze({ from: 'pump_variant', relation: 'USES', to: 'coil', source: 'database:pump_model_variants.coil_id' }),
    Object.freeze({ from: 'technical_file', relation: 'BELONGS_TO', to: 'recipe', source: 'database:recipe_technical_files.recipe_id' }),
]);

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function validateEntityTypeDefinition(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Entity type definition must be an object');
    if (value.version !== V5_BUSINESS_ONTOLOGY_VERSION) throw new TypeError(`Unsupported ontology version: ${value.version}`);
    for (const key of ['entityType', 'identitySource', 'displayNameSource', 'normalizationPolicyId']) {
        if (typeof value[key] !== 'string' || value[key].length === 0) throw new TypeError(`Missing ${key} for ontology entity`);
    }
    if (!CANONICAL_ID_KINDS.includes(value.canonicalIdKind)) throw new TypeError(`Invalid canonicalIdKind for ${value.entityType}`);
    if (typeof value.aliasSupport !== 'boolean') throw new TypeError(`Invalid aliasSupport for ${value.entityType}`);
    if (!RESOLVER_ADAPTERS.includes(value.resolverAdapter)) throw new TypeError(`Invalid resolverAdapter for ${value.entityType}`);
    return true;
}

function validateBusinessOntology(definitions = DECLARED_ENTITY_TYPES) {
    const seen = new Set();
    for (const value of definitions) {
        validateEntityTypeDefinition(value);
        if (seen.has(value.entityType)) throw new TypeError(`Duplicate entity type: ${value.entityType}`);
        seen.add(value.entityType);
    }
    for (const relation of V5_ONTOLOGY_RELATIONS) {
        if (!seen.has(relation.from) || !seen.has(relation.to)) throw new TypeError(`Ontology relation references unknown entity: ${relation.from}->${relation.to}`);
    }
    return true;
}

validateBusinessOntology();

const V5_ENTITY_TYPE_REGISTRY = deepFreeze(Object.fromEntries(
    DECLARED_ENTITY_TYPES.map(value => [value.entityType, value])
));

function listV5EntityTypes() {
    return Object.values(V5_ENTITY_TYPE_REGISTRY);
}

function getV5EntityType(entityType) {
    return V5_ENTITY_TYPE_REGISTRY[String(entityType || '')] || null;
}

function validateCapabilityOntologyReferences(capabilities = listV5Capabilities(), ontology = listV5EntityTypes()) {
    const known = new Set(ontology.map(item => item.entityType));
    const references = [...new Set(capabilities.flatMap(item => item.requiredEntityTypes))].sort();
    const unknown = references.filter(entityType => !known.has(entityType));
    return deepFreeze({ valid: unknown.length === 0, references, unknown });
}

function auditOntologyConsistency(capabilities = listV5Capabilities()) {
    const capabilityCheck = validateCapabilityOntologyReferences(capabilities);
    const resolverSupported = listV5EntityTypes()
        .filter(item => item.resolverAdapter !== 'NOT_AVAILABLE')
        .map(item => item.entityType)
        .sort();
    const capabilityTypes = capabilityCheck.references;
    const unsupported = capabilityTypes.filter(entityType => !resolverSupported.includes(entityType));
    const legacyOnly = resolverSupported.filter(entityType => !capabilityTypes.includes(entityType));
    const consistent = capabilityTypes.filter(entityType => resolverSupported.includes(entityType));
    const ontologyTypes = listV5EntityTypes().map(item => item.entityType).sort();
    return deepFreeze({
        ontologyTypes,
        contractEntityTypes: ontologyTypes,
        capabilityTypes,
        resolverSupported,
        consistent,
        missing: capabilityCheck.unknown,
        unsupported,
        legacyOnly,
    });
}

module.exports = {
    CANONICAL_ID_KINDS,
    RESOLVER_ADAPTERS,
    V5_BUSINESS_ONTOLOGY_VERSION,
    V5_ENTITY_TYPE_REGISTRY,
    V5_ONTOLOGY_RELATIONS,
    auditOntologyConsistency,
    getV5EntityType,
    listV5EntityTypes,
    validateBusinessOntology,
    validateCapabilityOntologyReferences,
    validateEntityTypeDefinition,
};
