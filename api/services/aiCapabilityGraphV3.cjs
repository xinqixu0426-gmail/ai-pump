const { getAiCapability } = require('../capabilities/registry.cjs');

const ENTITY_DESCRIPTORS = Object.freeze({
    customer: Object.freeze({
        label: '客户',
        discoveryCapability: 'search_customers',
        discoveryArgs: ['name'],
        candidateNameKeys: ['name'],
        candidateIdKeys: ['id'],
    }),
    order: Object.freeze({
        label: '订单',
        discoveryCapability: 'get_recent_orders',
        discoveryArgs: ['customerName', 'contractNo'],
        candidateNameKeys: ['customer', 'contract'],
        candidateIdKeys: ['id'],
    }),
    recipe: Object.freeze({
        label: '配方',
        discoveryCapability: 'get_all_recipes',
        discoveryArgs: ['keyword'],
        candidateNameKeys: ['name', 'spec'],
        candidateIdKeys: ['id'],
    }),
    part: Object.freeze({
        label: '零件',
        discoveryCapability: 'search_parts',
        discoveryArgs: ['keyword'],
        candidateNameKeys: ['model', 'name'],
        candidateIdKeys: ['id'],
    }),
    coil: Object.freeze({
        label: '线圈方案',
        discoveryCapability: 'search_coils',
        discoveryArgs: [null],
        candidateNameKeys: ['schemeName', 'model', 'spec'],
        candidateCompositeKeys: [['spec', 'sheets']],
        candidateIdKeys: ['id'],
    }),
    template: Object.freeze({
        label: '泵壳模板',
        discoveryCapability: 'search_templates',
        discoveryArgs: ['shellModel'],
        candidateNameKeys: ['shellModel', 'description'],
        candidateIdKeys: ['id'],
    }),
});

const TOOL_TARGETS = Object.freeze({
    get_recent_orders: { entityType: 'customer', inputField: 'customerName', outputField: 'customerName' },
    search_quotations: { entityType: 'customer', inputField: 'customerName', outputField: 'customerName' },
    search_customer_history: { entityType: 'customer', inputField: 'customerName', outputField: 'customerName' },
    build_quotation_draft: { entityType: 'customer', inputField: 'customerName', outputField: 'customerName' },
    build_order_draft: { entityType: 'customer', inputField: 'customerName', outputField: 'customerName' },
    get_order_detail: { entityType: 'order', inputField: 'orderQuery', outputIdField: 'orderId' },
    get_order_knowledge_package: { entityType: 'order', inputField: 'orderQuery', outputIdField: 'orderId' },
    check_order_readiness: { entityType: 'order', inputField: 'orderQuery', outputIdField: 'orderId' },
    plan_order_readiness_actions: { entityType: 'order', inputField: 'orderQuery', outputIdField: 'orderId' },
    get_recipe_detail: { entityType: 'recipe', inputField: 'recipeName', outputIdField: 'recipeId' },
    get_recipe_technical_files: { entityType: 'recipe', inputField: 'recipeName', outputIdField: 'recipeId' },
    preview_recipe_cost: { entityType: 'recipe', inputField: 'recipeName', outputIdField: 'recipeId' },
    analyze_recipe_configuration: { entityType: 'recipe', inputField: 'recipeName', outputIdField: 'recipeId' },
    delete_recipe: { entityType: 'recipe', inputField: 'recipeName', outputField: 'recipeName' },
    update_recipe: { entityType: 'recipe', inputField: 'recipeName', outputField: 'recipeName' },
    preview_pump_shell_cost: { entityType: 'template', inputField: 'shellModel', outputIdField: 'templateId' },
    calculate_coil_cost: {
        entityType: 'coil',
        inputField: 'spec',
        candidateFilters: { sheets: 'sheets', material: 'material', slotType: 'slotType' },
        outputFields: { spec: 'spec', sheets: 'sheets', material: 'material', slotType: 'slotType' },
    },
    update_part: { entityType: 'part', inputField: 'model', outputField: 'model' },
    delete_part: { entityType: 'part', inputField: 'model', outputField: 'model' },
});

function capabilityGraphNode(toolName) {
    const capability = getAiCapability(toolName);
    if (!capability) return null;
    return {
        toolName,
        access: capability.access,
        domains: capability.domains,
        entityScopes: capability.entityScopes,
        target: TOOL_TARGETS[toolName] || null,
    };
}

function discoveryCapabilitiesForIntent(intent = {}) {
    const selectedDomains = new Set(intent.domains || []);
    const names = new Set();
    for (const target of Object.values(TOOL_TARGETS)) {
        const descriptor = ENTITY_DESCRIPTORS[target.entityType];
        const capability = descriptor && getAiCapability(descriptor.discoveryCapability);
        if (!capability || capability.access !== 'read') continue;
        if (capability.domains.some(domain => selectedDomains.has(domain))) {
            names.add(descriptor.discoveryCapability);
        }
    }
    // 客户是订单、报价和客户历史的公共定位入口；配方也是成本和报价的公共定位入口。
    if (selectedDomains.has('order') || selectedDomains.has('quotation')) names.add('search_customers');
    if (selectedDomains.has('recipe') || selectedDomains.has('cost') || selectedDomains.has('quotation')) {
        names.add('get_all_recipes');
    }
    return [...names];
}

module.exports = {
    ENTITY_DESCRIPTORS,
    TOOL_TARGETS,
    capabilityGraphNode,
    discoveryCapabilitiesForIntent,
};
