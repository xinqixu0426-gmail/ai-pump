'use strict';

const { AI_TOOLS } = require('../../routes/ai/tools.cjs');
const { getAiCapability } = require('../../capabilities/registry.cjs');
const { V5_RISK_CLASSES } = require('./contracts.cjs');

const V5_CAPABILITY_REGISTRY_VERSION = 1;
const READ_WRITE_CLASSES = Object.freeze(['READ', 'WRITE']);
const UNASSIGNED_REASONS = Object.freeze([
    'legacy',
    'write-only future phase',
    'unsafe',
    'out-of-scope',
    'ambiguous',
]);

function definition(capabilityId, domain, operation, readWriteClass, riskClass, requiredEntityTypes, allowedTools) {
    return {
        version: V5_CAPABILITY_REGISTRY_VERSION,
        capabilityId,
        domain,
        operation,
        descriptionCode: `V5_CAPABILITY_${capabilityId.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}`,
        readWriteClass,
        riskClass,
        requiredEntityTypes,
        allowedTools,
        futureRequiredEvidenceTypes: [],
        exposableInV5B: readWriteClass === 'READ',
    };
}

const DECLARED_CAPABILITIES = [
    // Collection tasks have their own bounded catalog; never renumber frozen entity Task Classes.
    { ...definition('collection.read', 'catalog', 'read', 'READ', 'L1', [], ['read_collection']), exposableInV5B: false },
    definition('cost.calculate', 'cost', 'calculate', 'READ', 'L1', ['cost_context'], ['full_calculate', 'dynamic_config_cost']),
    definition('coil.cost', 'coil', 'cost', 'READ', 'L1', ['coil'], ['get_copper_price', 'calculate_coil_cost']),
    definition('coil.read', 'coil', 'read', 'READ', 'L1', ['coil'], ['get_coil_specs', 'search_coils']),
    definition('coil.inventory.write', 'coil', 'adjust_inventory', 'WRITE', 'L4', ['coil'], ['adjust_coil_stock']),
    definition('inventory.read', 'catalog', 'read_inventory', 'READ', 'L1', ['part'], ['search_parts']),
    definition('inventory.write', 'catalog', 'adjust_inventory', 'WRITE', 'L4', ['part'], ['adjust_part_stock']),
    definition('catalog.maintain', 'catalog', 'maintain', 'WRITE', 'L3', ['part'], ['create_part', 'batch_create_parts', 'update_part', 'delete_part', 'batch_update_prices']),
    definition('recipe.read', 'recipe', 'read', 'READ', 'L1', ['recipe'], ['get_all_recipes', 'get_recipe_detail']),
    definition('recipe.files.read', 'recipe', 'read_files', 'READ', 'L1', ['recipe'], ['get_recipe_technical_files']),
    definition('recipe.template.read', 'recipe', 'read_template', 'READ', 'L1', ['template'], ['search_templates', 'get_template_detail']),
    definition('recipe.cost.preview', 'recipe', 'preview_cost', 'READ', 'L1', ['recipe'], ['build_recipe_bom_draft', 'preview_recipe_cost', 'preview_pump_shell_cost', 'compare_recipes']),
    definition('recipe.maintain', 'recipe', 'maintain', 'WRITE', 'L3', ['recipe'], ['create_recipe', 'update_recipe', 'delete_recipe']),
    definition('quotation.read', 'quotation', 'read', 'READ', 'L1', ['quotation'], ['search_quotations', 'get_quotation_detail']),
    definition('quotation.customer.read', 'quotation', 'read_customer', 'READ', 'L1', ['customer'], ['search_customers', 'search_customer_history']),
    definition('quotation.file.inspect', 'quotation', 'inspect_file', 'READ', 'L1', ['file'], ['inspect_quotation_file']),
    definition('quotation.draft', 'quotation', 'build_draft', 'READ', 'L1', ['quotation'], ['build_quotation_draft']),
    definition('quotation.cost.explain', 'quotation', 'explain_cost', 'READ', 'L1', ['quotation'], ['explain_cost_change']),
    definition('order.read', 'order', 'read', 'READ', 'L1', ['order'], ['get_recent_orders', 'get_order_detail']),
    definition('order.draft', 'order', 'build_draft', 'READ', 'L1', ['order'], ['build_order_draft']),
    definition('order.knowledge.read', 'order', 'read_knowledge', 'READ', 'L1', ['order'], ['get_order_knowledge_package']),
    definition('order.maintain', 'order', 'maintain', 'WRITE', 'L3', ['order'], ['create_order', 'add_recipe_to_order', 'update_order_status', 'remove_recipe_from_order', 'update_order_item', 'delete_order']),
    definition('purchase.read', 'order', 'read_purchase', 'READ', 'L1', ['purchase'], ['get_purchase_overview']),
    definition('purchase.generate', 'order', 'generate_purchase', 'WRITE', 'L3', ['purchase'], ['generate_purchase_list']),
    definition('quality.read', 'quality', 'read', 'READ', 'L1', ['factory'], ['get_data_quality_summary', 'get_factory_learning_health', 'get_factory_rule_candidates', 'get_factory_rule_impact', 'get_factory_rule_compliance', 'get_factory_rule_history']),
    definition('quality.recipe.analyze', 'quality', 'analyze_recipe', 'READ', 'L1', ['recipe'], ['analyze_recipe_configuration']),
    definition('quality.maintain', 'quality', 'maintain', 'WRITE', 'L3', ['factory'], ['set_recipe_analysis_feedback', 'restore_factory_rule_event', 'refresh_factory_rule_candidates', 'review_factory_rule_candidate']),
    definition('management.read', 'management', 'read', 'READ', 'L1', ['global'], ['get_management_action_center', 'get_business_alerts', 'get_dashboard_summary']),
    definition('management.workflow.plan', 'management', 'plan_workflow', 'READ', 'L1', ['workflow'], ['plan_factory_workflow']),
    definition('management.workflow.execute', 'management', 'execute_workflow', 'WRITE', 'L4', ['workflow'], ['execute_factory_workflow_step']),
    definition('order.readiness.read', 'order', 'read_readiness', 'READ', 'L1', ['order'], ['get_order_readiness_overview', 'check_order_readiness']),
    definition('order.readiness.plan', 'order', 'plan_readiness', 'READ', 'L1', ['order'], ['plan_order_readiness_actions']),
    definition('order.readiness.execute', 'order', 'execute_readiness', 'WRITE', 'L3', ['order'], ['execute_order_readiness_action']),
    definition('order.file.draft', 'order', 'save_file_draft', 'WRITE', 'L3', ['order'], ['save_order_requirement_draft', 'save_order_execution_draft']),
    definition('file.search', 'file', 'search', 'READ', 'L1', ['file'], ['search_factory_file_archive_targets']),
    definition('file.archive', 'file', 'archive', 'WRITE', 'L3', ['file'], ['archive_factory_file']),
    definition('business_history.read', 'business_history', 'read', 'READ', 'L1', ['business_record'], ['search_business_changes']),
    definition('knowledge.read', 'knowledge', 'read', 'READ', 'L1', ['knowledge'], ['search_factory_knowledge', 'get_factory_knowledge_detail', 'get_factory_knowledge_health']),
    definition('knowledge.sync', 'knowledge', 'sync', 'WRITE', 'L3', ['knowledge'], ['sync_factory_knowledge']),
    definition('drawing.read', 'drawing', 'read', 'READ', 'L1', ['drawing'], ['get_rotor_drawing_history']),
    definition('drawing.generate', 'drawing', 'generate', 'WRITE', 'L3', ['drawing'], ['generate_rotor_drawing']),
    definition('drawing.print', 'drawing', 'print', 'WRITE', 'L4', ['drawing'], ['print_rotor_drawing']),
];

const INTENTIONALLY_UNASSIGNED_TOOLS = Object.freeze({});

function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
}

function validateCapability(capability) {
    if (!capability || typeof capability !== 'object' || Array.isArray(capability)) throw new TypeError('V5 capability must be an object');
    if (capability.version !== V5_CAPABILITY_REGISTRY_VERSION) throw new TypeError(`Unsupported V5 capability version: ${capability.version}`);
    for (const key of ['capabilityId', 'domain', 'operation', 'descriptionCode']) {
        if (typeof capability[key] !== 'string' || capability[key].length === 0) throw new TypeError(`Invalid capability ${key}`);
    }
    if (!READ_WRITE_CLASSES.includes(capability.readWriteClass)) throw new TypeError(`Invalid readWriteClass for ${capability.capabilityId}`);
    if (!V5_RISK_CLASSES.includes(capability.riskClass)) throw new TypeError(`Invalid riskClass for ${capability.capabilityId}`);
    if (!Array.isArray(capability.requiredEntityTypes) || capability.requiredEntityTypes.some(value => typeof value !== 'string' || value.length === 0)) {
        throw new TypeError(`Invalid requiredEntityTypes for ${capability.capabilityId}`);
    }
    if (!Array.isArray(capability.allowedTools) || capability.allowedTools.length === 0) throw new TypeError(`Empty allowedTools for ${capability.capabilityId}`);
    if (capability.allowedTools.some(value => typeof value !== 'string' || value.length === 0)) throw new TypeError(`Invalid allowedTools for ${capability.capabilityId}`);
    if (new Set(capability.allowedTools).size !== capability.allowedTools.length) throw new TypeError(`Duplicate allowed tool for ${capability.capabilityId}`);
    if (capability.readWriteClass === 'WRITE' && capability.exposableInV5B !== false) throw new TypeError(`Write capability cannot be exposable in V5-B: ${capability.capabilityId}`);
    return true;
}

function toolMap(existingToolRegistry = AI_TOOLS) {
    if (!Array.isArray(existingToolRegistry)) throw new TypeError('Existing tool registry must be an array');
    const entries = existingToolRegistry.map(tool => [tool?.function?.name, tool]);
    if (entries.some(([name]) => typeof name !== 'string' || name.length === 0)) throw new TypeError('Existing tool registry contains an unnamed tool');
    if (new Set(entries.map(([name]) => name)).size !== entries.length) throw new TypeError('Existing tool registry contains duplicate tool names');
    return new Map(entries);
}

function validateCapabilityRegistry(existingToolRegistry = AI_TOOLS, capabilities = DECLARED_CAPABILITIES) {
    const existing = toolMap(existingToolRegistry);
    const ids = new Set();
    for (const capability of capabilities) {
        validateCapability(capability);
        if (ids.has(capability.capabilityId)) throw new TypeError(`Duplicate capability id: ${capability.capabilityId}`);
        ids.add(capability.capabilityId);
        for (const name of capability.allowedTools) {
            if (!existing.has(name)) throw new TypeError(`Stale tool reference: ${name}`);
            const canonical = getAiCapability(name);
            if (canonical) {
                const expected = canonical.access === 'write' ? 'WRITE' : 'READ';
                if (capability.readWriteClass !== expected) throw new TypeError(`Read/write mismatch: ${capability.capabilityId} -> ${name}`);
            }
        }
    }
    for (const [name, reason] of Object.entries(INTENTIONALLY_UNASSIGNED_TOOLS)) {
        if (!existing.has(name)) throw new TypeError(`Unknown intentionally unassigned tool: ${name}`);
        if (!UNASSIGNED_REASONS.includes(reason)) throw new TypeError(`Invalid unassigned reason for ${name}`);
    }
    return true;
}

validateCapabilityRegistry();

const V5_CAPABILITY_REGISTRY = deepFreeze(Object.fromEntries(
    DECLARED_CAPABILITIES.map(item => [item.capabilityId, item])
));

function listV5Capabilities() {
    return Object.values(V5_CAPABILITY_REGISTRY);
}

function getV5Capability(capabilityId) {
    return V5_CAPABILITY_REGISTRY[String(capabilityId || '')] || null;
}

function buildToolCapabilityReverseIndex(capabilities = listV5Capabilities()) {
    const result = {};
    for (const capability of capabilities) {
        for (const name of capability.allowedTools) {
            if (!result[name]) result[name] = [];
            result[name].push(capability.capabilityId);
        }
    }
    for (const names of Object.values(result)) names.sort();
    return deepFreeze(result);
}

function auditToolInventory(existingToolRegistry = AI_TOOLS, capabilities = listV5Capabilities()) {
    const existing = toolMap(existingToolRegistry);
    const reverse = buildToolCapabilityReverseIndex(capabilities);
    const stale = Object.keys(reverse).filter(name => !existing.has(name)).sort();
    const unknown = [...existing.keys()].filter(name => !getAiCapability(name)).sort();
    const assigned = [...existing.keys()].filter(name => reverse[name]?.length > 0).sort();
    const shared = assigned.filter(name => reverse[name].length > 1);
    const unassigned = [...existing.keys()].filter(name => !reverse[name]).map(name => ({
        toolName: name,
        reason: INTENTIONALLY_UNASSIGNED_TOOLS[name] || null,
    }));
    return deepFreeze({
        total: existing.size,
        assigned,
        shared,
        unassigned,
        stale,
        unknown,
    });
}

module.exports = {
    INTENTIONALLY_UNASSIGNED_TOOLS,
    READ_WRITE_CLASSES,
    UNASSIGNED_REASONS,
    V5_CAPABILITY_REGISTRY,
    V5_CAPABILITY_REGISTRY_VERSION,
    auditToolInventory,
    buildToolCapabilityReverseIndex,
    getV5Capability,
    listV5Capabilities,
    validateCapability,
    validateCapabilityRegistry,
};
