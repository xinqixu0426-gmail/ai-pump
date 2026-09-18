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
        candidateNameKeys: ['customerName', 'contractNo'],
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
    full_calculate: {
        entityType: 'recipe',
        inputField: 'recipeName',
        inputFields: ['recipeName', 'pumphousing_model'],
        outputIdField: 'recipeId',
    },
    analyze_recipe_configuration: { entityType: 'recipe', inputField: 'recipeName', outputIdField: 'recipeId' },
    delete_recipe: { entityType: 'recipe', inputField: 'recipeName', outputField: 'recipeName' },
    update_recipe: { entityType: 'recipe', inputField: 'recipeName', outputField: 'recipeName' },
    preview_pump_shell_cost: { entityType: 'template', inputField: 'shellModel', outputIdField: 'templateId' },
    get_template_detail: { entityType: 'template', inputField: 'shellModel', outputIdField: 'templateId' },
    build_recipe_bom_draft: { entityType: 'template', inputField: 'shellModel', outputIdField: 'templateId' },
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
        const entityScopeCompatible = !intent.entityScope
            || intent.entityScope === 'none'
            || capability.entityScopes.includes(intent.entityScope);
        const domainCompatible = intent.mode !== 'command'
            || capability.domains.some(domain => selectedDomains.has(domain));
        if (entityScopeCompatible && domainCompatible) {
            names.add(descriptor.discoveryCapability);
        }
    }
    // Read-only investigation may cross domain boundaries because the same business
    // phrase can name a part, template, recipe or coil. Command mode keeps the
    // stage-1 domain envelope and runtime never exposes write capabilities here.
    return [...names];
}

function resultRows(result = {}) {
    for (const value of [result.data, result.parts, result.templates, result.recipes, result.coils]) {
        if (Array.isArray(value)) return value;
    }
    return [];
}

function identityFragments(value) {
    const text = String(value || '').toLocaleLowerCase('zh-CN');
    const fragments = new Set();
    for (const match of text.matchAll(/[a-z]+\d[\w.-]*|\d+[a-z][\w.-]*|\d{3,}/giu)) {
        if (match[0].length >= 2) fragments.add(match[0]);
    }
    for (const match of text.matchAll(/[\p{Script=Han}]{2,}/gu)) {
        const word = match[0];
        for (let index = 0; index < word.length - 1; index += 1) {
            fragments.add(word.slice(index, index + 2));
        }
    }
    return [...fragments];
}

function semanticFragments(value, options = {}) {
    let text = String(value || '').toLocaleLowerCase('zh-CN');
    if (options.removeQueryWords) {
        text = text.replace(
            /(帮我|请问|查一下|查询|查找|看看|当前|现在|目前|相关|资料|信息|价格|价钱|多少钱|多少|是多少|有没有|是什么|哪个|哪些|一下)/gu,
            ' '
        );
    }
    const fragments = new Set();
    for (const match of text.matchAll(/[\p{Script=Han}]{2,}/gu)) {
        const word = match[0];
        fragments.add(word);
        for (let index = 0; index < word.length - 1; index += 1) {
            fragments.add(word.slice(index, index + 2));
        }
    }
    return [...fragments];
}

function entityTypeForDiscoveryCapability(toolName) {
    return Object.entries(ENTITY_DESCRIPTORS).find(([, descriptor]) => (
        descriptor.discoveryCapability === toolName
    ))?.[0] || null;
}

function recoveryTargetCompatible(plannedCapabilityNames = [], recoveryEntityType, row, userText) {
    const plannedEntityTypes = new Set(plannedCapabilityNames.map(name => (
        TOOL_TARGETS[name]?.entityType || entityTypeForDiscoveryCapability(name)
    )).filter(Boolean));
    if (plannedEntityTypes.has(recoveryEntityType)) return true;

    // A pump-shell template and a pump-shell catalog part are two formal views of
    // the same business object. The bridge is deliberately category-based: model
    // text such as "V1600 泵壳密封圈" must not masquerade as the shell itself.
    if (plannedEntityTypes.has('template') && recoveryEntityType === 'part') {
        return String(row?.category || '').trim().toLocaleLowerCase('zh-CN') === '泵壳';
    }
    if (plannedEntityTypes.has('part') && recoveryEntityType === 'template') {
        return semanticFragments(userText, { removeQueryWords: true }).includes('泵壳');
    }
    return false;
}

function recoveryEvidenceSupportsUserGoal(toolName, result, userText, options = {}) {
    const descriptorEntry = Object.entries(ENTITY_DESCRIPTORS).find(([, item]) => (
        item.discoveryCapability === toolName
    ));
    const descriptor = descriptorEntry?.[1];
    if (!descriptor) return false;
    const recoveryEntityType = descriptorEntry[0];
    const userIdentity = identityFragments(userText).filter(fragment => /[a-z0-9]/iu.test(fragment));
    const userSemantics = semanticFragments(userText, { removeQueryWords: true });
    if (userIdentity.length === 0 && userSemantics.length === 0) return false;
    const keys = [...new Set([
        ...descriptor.candidateNameKeys,
        'name', 'model', 'shellModel', 'recipeName', 'spec', 'category', 'subcategory',
        'type', 'customerName', 'contractNo',
    ])];
    return resultRows(result).some(row => {
        if (!recoveryTargetCompatible(
            options.plannedCapabilityNames,
            recoveryEntityType,
            row,
            userText
        )) return false;
        const values = keys.map(key => row?.[key]).filter(value => value != null);
        const candidateIdentity = values
            .flatMap(identityFragments)
            .filter(fragment => /[a-z0-9]/iu.test(fragment));
        const candidateSemantics = values.flatMap(value => semanticFragments(value));
        const identityMatches = userIdentity.length === 0 || userIdentity.some(userFragment => (
            candidateIdentity.some(candidateFragment => (
                candidateFragment.includes(userFragment) || userFragment.includes(candidateFragment)
            ))
        ));
        const semanticsMatch = userSemantics.length === 0 || userSemantics.some(userFragment => (
            candidateSemantics.some(candidateFragment => (
                candidateFragment.includes(userFragment) || userFragment.includes(candidateFragment)
            ))
        ));
        return identityMatches && semanticsMatch;
    });
}

module.exports = {
    ENTITY_DESCRIPTORS,
    TOOL_TARGETS,
    capabilityGraphNode,
    discoveryCapabilitiesForIntent,
    identityFragments,
    semanticFragments,
    recoveryTargetCompatible,
    recoveryEvidenceSupportsUserGoal,
};
