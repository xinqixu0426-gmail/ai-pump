'use strict';
// P6R migration adapter. Profiles describe existing reads, never business edges.
const crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { ontology } = require('./contract.cjs');
const { relationMetadata, policy } = require('./bindingMetadata.cjs');
const { bindRelation, verifiedRows } = require('./relationBinder.cjs');
const { getAiCapability } = require('../capabilities/registry.cjs');
const { deepFreeze } = require('./sources.cjs');
// Deterministic formal reads that certify the relation AND keep answer/observation parity with the
// legacy pair. Planning them is software work and must never cost a model round.
//
// ONT-P8: reads are declared PER DIRECTION because the deliverable payload differs enormously.
//  - `recipe -> coil`: the root recipe is already canonically known, so ONE bounded detail read
//    (`get_recipe_detail{recipeId}`) certifies the forward projection, plus the small coil catalogue.
//  - `coil -> recipes`: ONT-P8R replaced the COMPLETE unfiltered recipe collection
//    (`get_all_recipes`, whose `projections.recipe_coil` payload is 121 KB on this database against a
//    96 KB per-result budget) with the bounded canonical reverse read `get_recipes_by_coil`, which
//    walks the `recipes.coil_id` foreign key with keyset pagination and returns ~700-900 bytes
//    (measured: coil 5 -> 1 row, 714 bytes; coil 2 -> 3 rows, 865 bytes). Its `rootId` comes from the
//    already-bound canonical coil root, so it needs no extra discovery round.
//    History: at ONT-P8 the required collection read always exceeded the budget, so the runtime
//    refused it and revoked the canary for the turn (ONTOLOGY_CANARY_FALLBACK), and both dropping the
//    requirement and adding a repair round measured worse than legacy because the model then answered
//    from the coil read alone.
//  - arguments for the root read come from already-verified server context (`root_identity` /
//    `root_detail` / `root_id`), never from the user's wording.
const byCoilRecipeRead = deepFreeze({ capability: 'get_recipes_by_coil', argumentPolicy: 'root_id' });
const rootIdentityRead = deepFreeze({ capability: 'search_coils', argumentPolicy: 'root_identity' });
// The coil catalogue is small and deliverable; it supplies the coil identities the answer composer's
// winding suffix and the P3 observer rely on.
const coilCatalogueRead = deepFreeze({ capability: 'search_coils', argumentPolicy: 'empty' });
// Bounded root read for a recipe-rooted question: one recipe, not the whole catalogue.
const recipeDetailRead = deepFreeze({ capability: 'get_recipe_detail', argumentPolicy: 'root_detail' });
const requiredReadsByRelation = deepFreeze({
    'coil.used_by_recipe': [byCoilRecipeRead, rootIdentityRead],
    'recipe.uses_coil': [recipeDetailRead, coilCatalogueRead],
});
// Union of every declared read, used for catalogue validation and capability auditing.
const requiredReads = deepFreeze([byCoilRecipeRead, rootIdentityRead, coilCatalogueRead, recipeDetailRead]);
const optionalCapabilities = deepFreeze([]);
const profiles = deepFreeze([{ version: 1, sourceId: 'recipe_coil',
    // ONT-P7: `deepseek` is promoted to production eligibility for this family after the P6D real-AI
    // gate passed 16/16 positive correct with 0 wrong bindings, 0 writes and 0 ontology-induced
    // provider calls. Unvalidated providers (kimi) stay excluded.
    providerModes: ['local', 'local-first', 'deepseek'],
    // The local tool shortlist is a local-model optimisation. Only those providers require it; the
    // promoted cloud provider is eligible without it, which is what production DeepSeek configures.
    shortlistRequiredProviderModes: ['local', 'local-first'],
    discoveryRequirements: { mode: 'existing_verified_context', capabilitiesByEntityType: { coil: 'search_coils', recipe: 'get_all_recipes' } },
    completionRequirements: 'DETERMINISTIC_REQUIRED_READS',
    shortlist: ['get_all_recipes', 'search_coils', 'get_recipe_detail', 'get_recipes_by_coil'],
    // ONT-P8R: the offered surface is per direction, for the same reason the required reads are. A
    // coil-rooted question is now answered by the bounded reverse read, so it is offered first and the
    // 121 KB whole-collection read is no longer the model's default first move. The recipe-rooted
    // direction keeps the order P6D/P7 measured, so its promotion evidence still describes this code.
    shortlistByRelation: deepFreeze({
        'coil.used_by_recipe': ['get_recipes_by_coil', 'search_coils', 'get_all_recipes', 'get_recipe_detail'],
        'recipe.uses_coil': ['get_all_recipes', 'search_coils', 'get_recipe_detail'],
    }),
    requiredReads,
    requiredReadsByRelation,
    optionalCapabilities,
    // Retained as the declared completion-enforcement list; identical to requiredReads by construction.
    requirements: requiredReads,
    // These are existing compatibility messages, not new instructions to the model.
    completionMessage: '正在补齐线圈与配方关联查询...',
    repairPrompt: '上一响应没有发送给用户。这个问题要求核对线圈与配方的关联，尚未调用：{missing}。请立即调用缺少的正式工具；已知线圈方案ID时用 get_recipes_by_coil 反查使用它的配方，需要完整配方列表时才用 get_all_recipes，不要把线圈简写当作配方名称关键词。',
    failureMessage: '线圈与配方的关联查询未完成，缺少正式查询：{missing}。本轮没有足够依据给出关联结论，请重试。',
}]);

/** The deterministic reads that apply to this request's bound direction (none when unknown). */
function requiredReadsFor(state) {
    return state?.profile?.requiredReadsByRelation?.[state.binding?.relationId] || [];
}

/**
 * Arguments for the root reads, derived from the bound canonical root and already-verified server
 * context — never from the user's wording. A recipe root only needs its own id (bounded detail read);
 * a coil root needs its own id for the bounded reverse read plus its own catalogue identity.
 */
function rootReadArguments(binding, trustedToolResults = []) {
    const out = {};
    const root = binding?.root;
    if (!root) return out;
    if (root.entityType === 'recipe') {
        const recipeId = Number(root.canonicalId);
        if (Number.isSafeInteger(recipeId) && recipeId > 0) out.get_recipe_detail = { recipeId };
        return out;
    }
    if (root.entityType !== 'coil') return out;
    const coilId = Number(root.canonicalId);
    if (Number.isSafeInteger(coilId) && coilId > 0) out.get_recipes_by_coil = { coilId };
    const rows = verifiedRows(trustedToolResults);
    const row = rows.find(r => r.entityType === 'coil' && r.canonicalId === root.canonicalId)?.row;
    if (!row || typeof row !== 'object') return out;
    if (typeof row.schemeCode === 'string' && row.schemeCode.trim()) out.search_coils = { schemeCode: row.schemeCode.trim() };
    else if (String(row.spec || '').trim() && Number.isSafeInteger(row.sheets) && row.sheets > 0)
        out.search_coils = { spec: String(row.spec).trim(), sheets: row.sheets };
    return out;
}
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
/**
 * The provider mode the canary reasons about. `local`/`local-first` are kept verbatim because they
 * gate the local shortlist; anything else (including the deployment's `auto`) is resolved to the
 * provider that will actually serve the request, otherwise a promoted provider configured as `auto`
 * could never become eligible.
 */
function effectiveProviderMode(env) {
    const declared = String(env?.AI_PROVIDER || '').trim().toLowerCase();
    if (declared === 'local' || declared === 'local-first') return declared;
    try {
        const resolved = require('../services/aiProviderRegistry.cjs').resolveAiProviderConfig(env).provider;
        return String(resolved || declared).trim().toLowerCase();
    } catch { return declared; }
}
function prepareRouting(input = {}, dependencies = {}) {
    const started = performance.now();
    const mode = effectiveProviderMode(input.env);
    const binding = bindRelation({ ontologyVersion: 1, userText: input.userText,
        verifiedToolResults: input.trustedToolResults || [], trustedSession: input.trustedSession,
        subject: input.subject, conversationId: input.conversationId });
    const semanticClass = classifyCoilRecipeLegacyIntentV1(input.userText, binding);
    const definition = ontology.relations.find(r => r.relationId === binding.relationId);
    const profile = profiles.find(p => p.sourceId === definition?.sourceId);
    const eligible = semanticClass === 'PURE_RELATION_QUERY' && binding.status === 'BOUND'
        && profile?.providerModes.includes(mode)
        && (profile?.shortlistRequiredProviderModes.includes(mode) ? input.shortlistEnabled === true : true)
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
        // Every capability the canary may plan or offer must be a registered read query, so a missing
        // or non-read capability degrades to legacy instead of producing an unusable tool list.
        const declared = [...profile.requiredReads, ...profile.optionalCapabilities,
            ...profile.shortlist.map(name => ({ capability: name }))];
        if (declared.some(r => !names.has(r.capability) || getAiCapability(r.capability)?.access !== 'read'
            || getAiCapability(r.capability)?.operation !== 'query')) throw Error('READ_PROFILE_UNAVAILABLE');
        dependencies.validateProfile?.(profile);
        record.durationMs = performance.now() - started;
        const offered = profile.shortlistByRelation?.[binding.relationId] || profile.shortlist;
        const tools = offered.map(name => catalog.find(t => t.function.name === name)).filter(Boolean);
        if (!tools.length) throw Error('READ_PROFILE_UNAVAILABLE');
        return { record, binding, profile, tools,
            rootReadArguments: rootReadArguments(binding, input.trustedToolResults || []),
            sourceEntityType: definition.fromType, targetEntityType: definition.toType };
    } catch {
        record.routingSource = 'ONTOLOGY_CANARY_FALLBACK'; record.fallback = true; record.legacyDetectorUsed = true;
        record.durationMs = performance.now() - started;
        return { record, binding, profile: null };
    }
}
/** Required reads the canary must guarantee before the model is asked to answer. */
function requiredReadCalls(state, toolResults = [], userText = '') {
    return completionCalls(state, missingCapabilities(state, toolResults), userText);
}
function missingCapabilities(state, toolResults) {
    // Only the deterministic required reads are enforced. Optional capabilities are offered to the
    // model but never trigger completion repair, so they cannot add a provider call.
    const completed = new Set(toolResults.map(t => t.name));
    return requiredReadsFor(state).filter(r => !completed.has(r.capability)).map(r => r.capability);
}
function completionCalls(state, missing, userText) {
    return missing.map(name => {
        const rule = requiredReadsFor(state).find(r => r.capability === name);
        let args;
        if (rule?.argumentPolicy === 'empty') args = {};
        else if (rule?.argumentPolicy === 'root_identity' || rule?.argumentPolicy === 'root_detail'
            || rule?.argumentPolicy === 'root_id') args = state.rootReadArguments?.[name];
        else if (rule?.argumentPolicy === 'explicit_numeric_pair') {
            const pair = String(userText || '').match(/(\d+)\s*[-—~]\s*(\d+)/u);
            if (pair) args = { spec: pair[1], sheets: Number(pair[2]) };
        }
        return args ? { id: `required-${name}-${crypto.randomUUID()}`, type: 'function',
            function: { name, arguments: JSON.stringify(args) } } : null;
    }).filter(Boolean);
}
function normalizeArguments(state, name, args) {
    const declared = [...requiredReadsFor(state), ...state.profile.optionalCapabilities];
    for (const key of declared.find(r => r.capability === name)?.omitArguments || []) delete args[key];
    return args;
}
module.exports = { profiles, requiredReads, optionalCapabilities, classifyCoilRecipeLegacyIntentV1, prepareRouting,
    rootReadArguments, requiredReadsFor, missingCapabilities, requiredReadCalls, completionCalls, normalizeArguments };
