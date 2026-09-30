'use strict';

// The broker is a bounded policy layer over the formally registered AI
// capability catalogue.  It selects a small, read-only projection for the
// current Judge goal; it never derives business facts or grants write access.
const { AI_TOOLS } = require('../../routes/ai/tools.cjs');
const { AI_FORMAL_TOOLS } = require('../../services/aiFormalToolDefinitions.cjs');
const { getAiCapability, listAiCapabilities } = require('../../capabilities/registry.cjs');

const MAX_DYNAMIC_TOOLS = 10;
const MAX_EXPOSED_TOOLS = MAX_DYNAMIC_TOOLS + 2; // + identity tools

function tool(name, description, properties, required = []) {
    return Object.freeze({ type: 'function', function: Object.freeze({ name, description,
        parameters: Object.freeze({ type: 'object', additionalProperties: false, properties, required }),
    }) });
}

const RESOLVE_ENTITY_TOOL = tool('resolve_entity', '通过正式 Ontology 解析一个业务实体。只在返回 RESOLVED 后，才可把 canonicalId 用于需要该实体身份的正式能力；AMBIGUOUS 和 NOT_FOUND 不能自行选择。', {
    entityType: { type: 'string', enum: ['recipe', 'coil', 'part', 'order', 'customer', 'template'] },
    mention: { type: 'string', minLength: 1, maxLength: 160 },
}, ['entityType', 'mention']);
const RESOLVE_PAGE_CONTEXT_ENTITY_TOOL = tool('resolve_page_context_entity', '将当前页面对象作为候选，并通过正式业务读取验证其 canonical identity。页面显示的数据不是业务事实；验证失败时不得继续使用页面 ID。', {
    entityType: { type: 'string', enum: ['recipe', 'coil', 'part', 'order', 'customer', 'template'] },
}, ['entityType']);

// Stable goal-domain profiles.  Judge produces domain tags; no user sentence
// is regex-routed here.  Each item must independently be a current registry
// read/preview capability and have an existing Executor tool adapter.
const DOMAIN_TOOL_NAMES = Object.freeze({
    recipe: Object.freeze(['get_recipe_detail', 'get_recipe_parts', 'get_recipe_technical_profile', 'get_recipes_by_coil', 'preview_profitability', 'preview_virtual_readiness', 'preview_recipe_cost', 'compare_recipe_scenarios', 'get_recipe_technical_files']),
    coil: Object.freeze(['search_coils', 'calculate_coil_cost', 'get_recipes_by_coil']),
    part: Object.freeze(['search_parts', 'get_recipes_by_part']),
    catalog: Object.freeze(['search_parts', 'get_recipes_by_part']),
    cost: Object.freeze(['get_recipe_detail', 'preview_recipe_cost', 'compare_recipe_scenarios', 'preview_profitability', 'calculate_coil_cost']),
    inventory: Object.freeze(['search_parts', 'search_coils', 'preview_virtual_readiness', 'get_order_readiness_overview', 'check_order_readiness']),
    order: Object.freeze(['get_recent_orders', 'get_order_detail', 'check_order_readiness', 'get_order_readiness_overview', 'get_purchase_overview']),
    quotation: Object.freeze(['search_quotations']),
    customer: Object.freeze(['search_customers', 'search_customer_history', 'search_quotations']),
    procurement: Object.freeze(['get_purchase_overview', 'get_recent_orders', 'check_order_readiness']),
    technical_profile: Object.freeze(['get_recipe_technical_profile', 'get_recipe_technical_files']),
    business_history: Object.freeze(['search_business_changes']),
    knowledge: Object.freeze(['search_factory_knowledge']),
    file: Object.freeze(['get_recipe_technical_files', 'search_factory_file_archive_targets']),
    template: Object.freeze(['search_templates', 'get_template_detail']),
    general: Object.freeze(['get_dashboard_summary']),
});

const ENTITY_ARGUMENTS = Object.freeze({
    get_recipe_detail: Object.freeze({ entityType: 'recipe', field: 'recipeId', rejectedFields: ['recipeName'] }),
    get_recipe_parts: Object.freeze({ entityType: 'recipe', field: 'recipeId' }),
    get_recipe_technical_profile: Object.freeze({ entityType: 'recipe', field: 'recipeId' }),
    get_recipe_technical_files: Object.freeze({ entityType: 'recipe', field: 'recipeId', rejectedFields: ['recipeName'] }),
    preview_recipe_cost: Object.freeze({ entityType: 'recipe', field: 'recipeId', rejectedFields: ['recipeName', 'baseRecipeId'] }),
    compare_recipe_scenarios: Object.freeze({ entityType: 'recipe', field: 'recipeId', rejectedFields: ['recipeName', 'baseRecipeId'] }),
    preview_profitability: Object.freeze({ entityType: 'recipe', field: 'recipeId', rejectedFields: ['recipeName', 'baseRecipeId'] }),
    preview_virtual_readiness: Object.freeze({ entityType: 'recipe', field: 'recipeId', rejectedFields: ['recipeName', 'baseRecipeId'] }),
    get_recipes_by_coil: Object.freeze({ entityType: 'coil', field: 'coilId' }),
    calculate_coil_cost: Object.freeze({ entityType: 'coil', field: 'coilId' }),
    get_recipes_by_part: Object.freeze({ entityType: 'part', field: 'partId' }),
    get_order_detail: Object.freeze({ entityType: 'order', field: 'orderId', rejectedFields: ['orderQuery'] }),
    check_order_readiness: Object.freeze({ entityType: 'order', field: 'orderId', rejectedFields: ['orderQuery'] }),
    search_customer_history: Object.freeze({ entityType: 'customer', field: 'customerId', rejectedFields: ['customerName'] }),
    get_template_detail: Object.freeze({ entityType: 'template', field: 'templateId', rejectedFields: ['shellModel'] }),
});

function definitionByName(name) {
    return AI_TOOLS.find(item => item?.function?.name === name)
        || AI_FORMAL_TOOLS.find(item => item?.function?.name === name)
        || null;
}

function brokerableTool(name) {
    const capability = getAiCapability(name);
    const definition = definitionByName(name);
    return Boolean(capability && definition && capability.access !== 'write'
        && ['query', 'preview'].includes(capability.operation));
}

function boundToolDefinition(name) {
    const original = definitionByName(name);
    if (!original) return null;
    const binding = ENTITY_ARGUMENTS[name];
    if (!binding) return original;
    const parameters = JSON.parse(JSON.stringify(original.function.parameters || { type: 'object', properties: {} }));
    parameters.properties ||= {};
    parameters.properties[binding.field] ||= { type: 'integer', minimum: 1 };
    for (const field of binding.rejectedFields || []) delete parameters.properties[field];
    delete parameters.anyOf;
    delete parameters.oneOf;
    parameters.required = [...new Set([...(parameters.required || []), binding.field])]
        .filter(field => !new Set(binding.rejectedFields || []).has(field));
    return Object.freeze({ type: 'function', function: Object.freeze({
        name: original.function.name,
        description: `${original.function.description}\n身份要求：${binding.field} 必须来自本轮 resolve_entity 的唯一正式结果。`,
        parameters: Object.freeze(parameters),
    }) });
}

function normalizedDomains(judge = {}, resolvedEntities = []) {
    const allowed = new Set(Object.keys(DOMAIN_TOOL_NAMES));
    const domains = Array.isArray(judge.domains) ? judge.domains : [];
    for (const entity of Array.isArray(resolvedEntities) ? resolvedEntities : []) {
        const entityType = String(entity?.entityType || '');
        if (entityType === 'part') domains.push('part');
        if (entityType === 'coil') domains.push('coil');
        if (entityType === 'recipe') domains.push('recipe');
        if (entityType === 'order') domains.push('order');
        if (entityType === 'customer') domains.push('customer');
        if (entityType === 'template') domains.push('template');
    }
    const selected = [...new Set(domains.filter(domain => allowed.has(domain)))];
    return selected.length ? selected : ['general'];
}

function selectCapabilities(input = {}) {
    const domains = normalizedDomains(input.judge, input.resolvedEntities);
    const names = [];
    const cursors = new Map(domains.map(domain => [domain, 0]));
    // Round-robin preserves a bounded slot for every Judge-selected domain
    // before richer profiles consume the remaining budget.  This lets one
    // multi-goal turn investigate, for example, both recipe cost and coil
    // inventory without a user-text routing special case.
    while (names.length < MAX_DYNAMIC_TOOLS) {
        let advanced = false;
        for (const domain of domains) {
            const profile = DOMAIN_TOOL_NAMES[domain] || [];
            let cursor = cursors.get(domain) || 0;
            while (cursor < profile.length) {
                const name = profile[cursor];
                cursor += 1;
                cursors.set(domain, cursor);
                if (!brokerableTool(name) || names.includes(name)) continue;
                names.push(name);
                advanced = true;
                break;
            }
            if (names.length >= MAX_DYNAMIC_TOOLS) break;
        }
        if (!advanced) break;
    }
    const capabilities = names.map(name => {
        const capability = getAiCapability(name);
        return Object.freeze({
            toolName: name,
            capabilityId: capability.capabilityId,
            formalCapabilityIds: capability.formalCapabilityIds,
            domain: capability.domain,
            operation: capability.operation,
            reason: domains.includes(capability.domain) ? 'judge_domain' : 'related_domain',
        });
    });
    return Object.freeze({
        domains: Object.freeze(domains),
        capabilities: Object.freeze(capabilities),
        availableCapabilityCount: listAiCapabilities().filter(capability => capability.access !== 'write'
            && ['query', 'preview'].includes(capability.operation)).length,
        selectedCapabilityCount: capabilities.length,
        exposedToolCount: capabilities.length + 2,
        tools: Object.freeze([RESOLVE_ENTITY_TOOL, RESOLVE_PAGE_CONTEXT_ENTITY_TOOL, ...names.map(boundToolDefinition).filter(Boolean)]),
    });
}

function boundEntity(context, entityType, id) {
    const numeric = Number(id);
    const bindings = context.entityBindings instanceof Map ? context.entityBindings : new Map();
    const entity = bindings.get(`${entityType}:${numeric}`);
    if (!Number.isSafeInteger(numeric) || numeric < 1 || !entity?.verified) {
        const error = new Error('正式身份尚未唯一确认。');
        error.code = 'AGENT_TOOL_IDENTITY_UNVERIFIED';
        throw error;
    }
    return entity;
}

function redactFormalResult(value) {
    if (Array.isArray(value)) return value.map(redactFormalResult);
    if (!value || typeof value !== 'object') return value;
    const blocked = new Set(['confirmationToken', 'idempotencyKey', 'argsHash', 'proposalHash', 'operationId', 'executionEvidence', 'apiTrace']);
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !blocked.has(key))
        .map(([key, child]) => [key, redactFormalResult(child)]));
}

async function executeBrokeredCapability(name, args = {}, context = {}, dependencies = {}) {
    const selected = context.selectedToolNames instanceof Set ? context.selectedToolNames : new Set();
    if (!selected.has(name) || !brokerableTool(name)) {
        const error = new Error('当前目标没有开放该正式能力。');
        error.code = 'AGENT_CAPABILITY_NOT_SELECTED';
        throw error;
    }
    const binding = ENTITY_ARGUMENTS[name];
    const nextArgs = { ...(args || {}) };
    if (binding) {
        for (const field of binding.rejectedFields || []) {
            if (Object.hasOwn(nextArgs, field)) {
                const error = new Error('实体必须使用本轮已验证 canonicalId。');
                error.code = 'AGENT_TOOL_IDENTITY_UNVERIFIED';
                throw error;
            }
        }
        const entity = boundEntity(context, binding.entityType, nextArgs[binding.field]);
        if (binding.entityType === 'coil' && name === 'calculate_coil_cost') {
            const attributes = entity.identityAttributes || {};
            nextArgs.spec = attributes.spec;
            nextArgs.sheets = attributes.sheets;
            if (attributes.schemeCode) nextArgs.schemeCode = attributes.schemeCode;
        }
    }
    const runFormalTool = dependencies.executeToolCall;
    if (typeof runFormalTool !== 'function') throw new Error('正式能力执行器不可用。');
    const result = await runFormalTool(name, nextArgs, { allowWrite: false, signal: context.signal });
    if (result?.success === false) return Object.freeze({ success: false, agentToolName: name, verified: false,
        data: null, code: result.code || 'FORMAL_TOOL_FAILED', message: '正式业务能力暂不可用，无法完成本次查询。' });
    return Object.freeze({ success: true, agentToolName: name, verified: result?.executionEvidence?.verified === true,
        capabilityId: getAiCapability(name).capabilityId, data: redactFormalResult(result?.data ?? result) });
}

module.exports = {
    DOMAIN_TOOL_NAMES,
    ENTITY_ARGUMENTS,
    MAX_DYNAMIC_TOOLS,
    MAX_EXPOSED_TOOLS,
    RESOLVE_ENTITY_TOOL,
    RESOLVE_PAGE_CONTEXT_ENTITY_TOOL,
    boundToolDefinition,
    executeBrokeredCapability,
    selectCapabilities,
};
