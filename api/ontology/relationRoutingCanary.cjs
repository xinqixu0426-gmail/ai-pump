'use strict';
// P6R migration adapter. Profiles describe existing reads, never business edges.
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { ontology } = require('./contract.cjs');
const { relationMetadata, policy } = require('./bindingMetadata.cjs');
const { bindRelation } = require('./relationBinder.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { deepFreeze } = require('./sources.cjs');
const profiles = deepFreeze([{ version: 1, sourceId: 'recipe_coil', providerModes: ['local', 'local-first'],
    discoveryRequirements: { mode: 'existing_verified_context', capabilitiesByEntityType: { coil: 'search_coils', recipe: 'get_all_recipes' } },
    completionRequirements: 'OBSERVED_CAPABILITY_COMPATIBILITY',
    shortlist: ['get_all_recipes', 'search_coils'],
    requirements: [{ capability: 'search_coils', argumentPolicy: 'explicit_numeric_pair' },
        { capability: 'get_all_recipes', argumentPolicy: 'empty', omitArguments: ['keyword'] }],
    // These are existing compatibility messages, not new instructions to the model.
    completionMessage: '正在补齐线圈与配方关联查询...',
    repairPrompt: '上一响应没有发送给用户。这个问题要求核对线圈与配方的关联，尚未调用：{missing}。请立即调用缺少的正式工具；查询配方时读取完整配方列表，根据 coilSpec、coilSheets、coilId 等正式字段筛选，不要把线圈简写当作配方名称关键词。',
    failureMessage: '线圈与配方的关联查询未完成，缺少正式查询：{missing}。本轮没有足够依据给出关联结论，请重试。',
}]);
const semanticRules = deepFreeze([
    ['WRITE_OR_COMMAND', '(?:修改|删除|新增|创建|保存|绑定|取消|更新|设置)', 'command'],
    ['BOM_CONFIGURATION_QUERY', '(?:BOM|物料清单|构建|试算)', 'configuration'],
    ['RECIPE_CONFIGURATION_QUERY', '(?:配置|更换|换成|改用|换用|替换|浮球|电缆|出水口|包装)', 'configuration'],
    ['COIL_COMPARISON', '(?:比较|对比|差额|差多少|哪个便宜)', 'coil'],
    ['COIL_INVENTORY_QUERY', '(?:库存|存货|剩余|还有多少)', 'coil'],
    ['COIL_COST_QUERY', '(?:成本|价格|多少钱|单价|费用)', 'coil'],
    ['RECIPE_COST_QUERY', '(?:成本|价格|多少钱|单价|费用)', 'recipe'],
]);
function classifyCoilRecipeLegacyIntentV1(userText, binding) {
    const text = String(userText || '').trim();
    if (!text || text.length > 2048) return 'OTHER';
    const hasCoil = /线圈|绕组/u.test(text), hasRecipe = /配方|产品/u.test(text);
    for (const [semanticClass, expression, domain] of semanticRules) {
        if ((domain === 'coil' ? hasCoil : domain === 'recipe' ? hasRecipe : true)
            && new RegExp(expression, 'iu').test(text)) return semanticClass;
    }
    if (binding?.status === 'AMBIGUOUS_ROOT' || binding?.status === 'AMBIGUOUS_RELATION') return 'AMBIGUOUS';
    if (new RegExp(policy.excluded, 'u').test(text)) return 'OTHER';
    const definitions = ontology.relations.filter(r => profiles.some(p => p.sourceId === r.sourceId));
    const matches = relationMetadata.filter(r => definitions.some(d => d.relationId === r.relationId))
        .flatMap(r => r.expressions.map(expression => new RegExp(policy.prefix + expression + policy.suffix, 'u').exec(text))).filter(Boolean);
    if (matches.some(m => /和|与|、|[;；]/u.test(m.groups.root))) return 'AMBIGUOUS';
    if (matches.length && (hasCoil || hasRecipe || binding?.status === 'BOUND')) return 'PURE_RELATION_QUERY';
    return 'OTHER';
}
function prepareRouting(input = {}, dependencies = {}) {
    const started = performance.now();
    const mode = String(input.env?.AI_PROVIDER || '').trim().toLowerCase();
    const binding = bindRelation({ ontologyVersion: 1, userText: input.userText,
        verifiedToolResults: input.trustedToolResults || [], trustedSession: input.trustedSession,
        subject: input.subject, conversationId: input.conversationId });
    const semanticClass = classifyCoilRecipeLegacyIntentV1(input.userText, binding);
    const definition = ontology.relations.find(r => r.relationId === binding.relationId);
    const profile = profiles.find(p => p.sourceId === definition?.sourceId);
    const eligible = semanticClass === 'PURE_RELATION_QUERY' && binding.status === 'BOUND'
        && profile?.providerModes.includes(mode) && input.shortlistEnabled === true
        && ['CANONICAL_DIRECT', 'DETERMINISTIC_DERIVED'].includes(definition.authority)
        && definition.fromType === binding.root.entityType && definition.toType === binding.targetEntityType;
    const record = { version: 1, canaryEnabled: true, semanticClass, eligible: Boolean(eligible),
        relationId: definition?.relationId || null, direction: definition?.direction || null,
        providerMode: ['local', 'local-first', 'auto', 'deepseek', 'kimi'].includes(mode) ? mode : 'other',
        routingSource: eligible ? 'ONTOLOGY_RELATION_BINDING' : semanticClass === 'PURE_RELATION_QUERY' || semanticClass === 'AMBIGUOUS' || semanticClass === 'OTHER'
            ? 'CANARY_NOT_ELIGIBLE' : 'NON_RELATION_SPECIALIZED_PATH',
        fallback: false, legacyDetectorUsed: !eligible, legacyRepairUsed: false,
        durationMs: 0 };
    if (!eligible) { record.durationMs = performance.now() - started; return { record, binding, profile: null }; }
    try {
        const catalog = input.tools || [];
        const names = new Set(catalog.map(t => t.function.name));
        if (profile.requirements.some(r => !names.has(r.capability) || getAiCapability(r.capability)?.access !== 'read'
            || getAiCapability(r.capability)?.operation !== 'query')) throw Error('READ_PROFILE_UNAVAILABLE');
        dependencies.validateProfile?.(profile);
        record.durationMs = performance.now() - started;
        return { record, binding, profile, tools: profile.shortlist.map(name => catalog.find(t => t.function.name === name)),
            sourceEntityType: definition.fromType, targetEntityType: definition.toType };
    } catch {
        record.routingSource = 'ONTOLOGY_CANARY_FALLBACK'; record.fallback = true; record.legacyDetectorUsed = true;
        record.durationMs = performance.now() - started;
        return { record, binding, profile: null };
    }
}
function missingCapabilities(state, toolResults) {
    // Preserve the legacy completion rule (attempted tools). Evidence still independently verifies results.
    const completed = new Set(toolResults.map(t => t.name));
    return state.profile.requirements.filter(r => !completed.has(r.capability)).map(r => r.capability);
}
function completionCalls(state, missing, userText) {
    return missing.map(name => {
        const rule = state.profile.requirements.find(r => r.capability === name);
        let args;
        if (rule.argumentPolicy === 'empty') args = {};
        else if (rule.argumentPolicy === 'explicit_numeric_pair') {
            const pair = String(userText || '').match(/(\d+)\s*[-—~]\s*(\d+)/u);
            if (pair) args = { spec: pair[1], sheets: Number(pair[2]) };
        }
        return args ? { id: `required-${name}-${crypto.randomUUID()}`, type: 'function',
            function: { name, arguments: JSON.stringify(args) } } : null;
    }).filter(Boolean);
}
function normalizeArguments(state, name, args) {
    for (const key of state.profile.requirements.find(r => r.capability === name)?.omitArguments || []) delete args[key];
    return args;
}
module.exports = { profiles, classifyCoilRecipeLegacyIntentV1, prepareRouting, missingCapabilities, completionCalls, normalizeArguments };
