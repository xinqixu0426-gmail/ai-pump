'use strict';

const { listV5Capabilities } = require('./capabilityRegistry.cjs');
const { listV5EntityTypes } = require('./businessOntology.cjs');

const V5_TASK_INTERPRETER_SEMANTICS_VERSION = 1;

const DOMAIN_SEMANTICS = Object.freeze({
    business_history: 'Historical business change and audit records.',
    catalog: 'Part catalog facts, including a part model, current catalog price, or current stock.',
    coil: 'Coil and winding-scheme specifications, inventory, and coil-material cost.',
    cost: 'Generic cost calculation not bound to a named recipe or other specific business document.',
    drawing: 'Rotor drawing records and drawing generation or printing.',
    file: 'Factory file archive discovery and archiving.',
    knowledge: 'Factory knowledge entries and knowledge-index maintenance.',
    management: 'Factory-wide management summaries, alerts, and workflow control.',
    order: 'Orders, purchasing, order readiness, and order-scoped work.',
    quality: 'Factory data quality and recipe-configuration quality analysis.',
    quotation: 'Quotations, quotation customers, quotation files, and quotation drafts.',
    recipe: 'Named pump recipes, formulas, BOM composition, recipe files, templates, and recipe-level cost preview.',
});

const OPERATION_SEMANTICS = Object.freeze({
    adjust_inventory: 'Change stored inventory; this is a write operation.',
    analyze_recipe: 'Analyze whether a named recipe configuration is coherent.',
    archive: 'Archive an existing file record.',
    build_draft: 'Build a non-executing draft for an order or quotation.',
    calculate: 'Calculate a generic unbound cost context.',
    cost: 'Calculate coil or winding material cost.',
    execute_readiness: 'Execute an order-readiness action.',
    execute_workflow: 'Execute a factory workflow step.',
    explain_cost: 'Explain a quotation cost change.',
    generate: 'Generate a drawing artifact.',
    generate_purchase: 'Generate an order purchase list.',
    inspect_file: 'Inspect a quotation file without archiving it.',
    maintain: 'Create, update, or delete the domain object.',
    plan_readiness: 'Plan order-readiness actions without executing them.',
    plan_workflow: 'Plan a factory workflow without executing it.',
    preview_cost: 'Preview or compare the complete cost of a named recipe.',
    print: 'Print an existing drawing.',
    read: 'Read a specific domain object or list; not free-text search and not a specialized inventory operation.',
    read_customer: 'Read quotation-customer records or customer history.',
    read_files: 'Read technical files attached to a named recipe.',
    read_inventory: 'Read current part-catalog facts, including stock and current catalog price.',
    read_knowledge: 'Read the knowledge package attached to an order.',
    read_purchase: 'Read purchasing status or overview for an order.',
    read_readiness: 'Read order-readiness status.',
    read_template: 'Read pump-shell template records used by recipes.',
    save_file_draft: 'Save an order-scoped file draft.',
    search: 'Search the factory file archive for matching file targets.',
    sync: 'Synchronize the factory knowledge index.',
});

const ENTITY_TYPE_SEMANTICS = Object.freeze({
    business_record: 'A business change or audit record.',
    coil: 'A specialized coil or winding scheme; do not infer this subtype from identifier shape alone.',
    cost_context: 'A generic calculation context that is not a named recipe or business document.',
    customer: 'A customer account or customer history subject.',
    drawing: 'A rotor drawing record.',
    factory: 'The factory-wide singleton scope.',
    file: 'A general factory file or archive target.',
    global: 'A global management scope with no narrower business entity.',
    knowledge: 'A factory knowledge entry or knowledge index.',
    order: 'A customer order.',
    part: 'A generic component or part catalog item; not a coil unless the referenced object is explicitly a coil scheme.',
    pump_variant: 'A configured pump-model variant.',
    purchase: 'An order-scoped purchasing aggregate.',
    quotation: 'A customer quotation.',
    recipe: 'A named pump recipe or formula with BOM and recipe-level cost.',
    stator_variant: 'A stator variant definition, not an individual coil scheme.',
    technical_file: 'A technical file attached to a recipe.',
    template: 'A pump-shell template used by recipes.',
    workflow: 'A factory workflow run or workflow plan.',
});

const CONTRAST_RULES = Object.freeze([
    'Choose the domain from the business object and its authoritative owner, not from generic action words.',
    'Choose an entity type from the object the user identifies; do not infer a specialized subtype from operation or identifier format.',
    'A named recipe and its complete current or preview cost belong to recipe/preview_cost/recipe; an unbound cross-component calculation belongs to cost/calculate/cost_context.',
    'Current facts about a generic part catalog item, including stock or catalog price, belong to catalog/read_inventory/part; coil-specific facts belong to the coil domain.',
    'Domain describes the owning business area, operation describes the requested action, and entity type describes the referenced object; never substitute one dimension for another.',
]);

function sortedUnique(values) {
    return [...new Set(values)].sort();
}

function validateExactIds(label, actual, expected) {
    const actualKeys = Object.keys(actual).sort();
    const expectedKeys = sortedUnique(expected);
    if (actualKeys.length !== expectedKeys.length
        || actualKeys.some((value, index) => value !== expectedKeys[index])) {
        throw new TypeError(`V5 interpreter ${label} semantics contain missing, stale, or duplicate IDs`);
    }
}

function validateTaskInterpreterSemantics() {
    const capabilities = listV5Capabilities();
    validateExactIds('domain', DOMAIN_SEMANTICS, capabilities.map(item => item.domain));
    validateExactIds('operation', OPERATION_SEMANTICS, capabilities.map(item => item.operation));
    validateExactIds('entity type', ENTITY_TYPE_SEMANTICS, listV5EntityTypes().map(item => item.entityType));
    for (const definitions of [DOMAIN_SEMANTICS, OPERATION_SEMANTICS, ENTITY_TYPE_SEMANTICS]) {
        if (Object.values(definitions).some(value => typeof value !== 'string' || value.length === 0)) {
            throw new TypeError('V5 interpreter semantic definitions must be non-empty strings');
        }
    }
    return true;
}

function semanticInstructionLines() {
    validateTaskInterpreterSemantics();
    const format = entries => Object.entries(entries).map(([id, meaning]) => `${id}: ${meaning}`);
    return Object.freeze([
        'Domain semantics:', ...format(DOMAIN_SEMANTICS),
        'Operation semantics:', ...format(OPERATION_SEMANTICS),
        'Entity-type semantics:', ...format(ENTITY_TYPE_SEMANTICS),
        'Contrast rules:', ...CONTRAST_RULES.map((rule, index) => `${index + 1}. ${rule}`),
    ]);
}

validateTaskInterpreterSemantics();

module.exports = {
    CONTRAST_RULES,
    DOMAIN_SEMANTICS,
    ENTITY_TYPE_SEMANTICS,
    OPERATION_SEMANTICS,
    V5_TASK_INTERPRETER_SEMANTICS_VERSION,
    semanticInstructionLines,
    validateTaskInterpreterSemantics,
};
