const crypto = require('node:crypto');

const RULE_DEFINITIONS = Object.freeze({
    core_policy: Object.freeze({
        label: '系统核心规则',
        precedence: 500,
        authority: 'system_core',
        executionChannel: 'system_prompt',
        knowledgeRole: 'not_indexed',
        runtimeEnforced: true,
    }),
    domain_policy: Object.freeze({
        label: '领域执行规则',
        precedence: 400,
        authority: 'domain_prompt',
        executionChannel: 'domain_prompt',
        knowledgeRole: 'not_indexed',
        runtimeEnforced: true,
    }),
    approved_recipe_rule: Object.freeze({
        label: '已批准配方检查规则',
        precedence: 350,
        authority: 'recipe_intelligence',
        executionChannel: 'analyze_recipe_configuration',
        knowledgeRole: 'reference_copy',
        runtimeEnforced: true,
    }),
    factory_fact: Object.freeze({
        label: '正式工厂事实',
        precedence: 300,
        authority: 'factory_knowledge',
        executionChannel: 'knowledge_retrieval',
        knowledgeRole: 'authoritative_fact',
        runtimeEnforced: false,
    }),
    answer_correction: Object.freeze({
        label: '用户回答纠错',
        precedence: 200,
        authority: 'user_feedback',
        executionChannel: 'relevant_correction_prompt',
        knowledgeRole: 'reference_copy',
        runtimeEnforced: true,
    }),
    factory_profile: Object.freeze({
        label: '工厂个性化配置',
        precedence: 100,
        authority: 'factory_profile',
        executionChannel: 'factory_profile_prompt',
        knowledgeRole: 'not_indexed',
        runtimeEnforced: true,
    }),
});

function normalizeRuleStatement(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLocaleLowerCase('zh-CN')
        .replace(/[^\p{L}\p{N}]+/gu, '');
}

function canonicalRuleKey(value) {
    const normalized = normalizeRuleStatement(value);
    if (!normalized) return '';
    return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 20);
}

function buildRuleGovernanceMetadata(ruleKind, options = {}) {
    const definition = RULE_DEFINITIONS[ruleKind];
    if (!definition) throw new Error(`未知规则类型：${ruleKind}`);
    const scopeType = String(options.scopeType || 'global').trim() || 'global';
    const scopeRef = String(options.scopeRef || '').trim();
    return {
        ruleKind,
        ruleLabel: definition.label,
        authority: definition.authority,
        precedence: definition.precedence,
        executionChannel: definition.executionChannel,
        knowledgeRole: definition.knowledgeRole,
        runtimeEnforced: definition.runtimeEnforced,
        canonicalRuleKey: canonicalRuleKey(options.statement),
        scopeType,
        ...(scopeRef ? { scopeRef } : {}),
    };
}

function compareRuntimeRules(left, right) {
    return Number(left?.priority || 0) - Number(right?.priority || 0)
        || String(left?.updatedAt || '').localeCompare(String(right?.updatedAt || ''))
        || Number(left?.id || 0) - Number(right?.id || 0);
}

function dedupeRuntimeCorrectionRules(rules) {
    const winners = new Map();
    for (const rule of rules || []) {
        const key = normalizeRuleStatement(rule?.instruction);
        if (!key) continue;
        const current = winners.get(key);
        if (!current || compareRuntimeRules(rule, current) > 0) winners.set(key, rule);
    }
    return (rules || []).filter(rule => (
        winners.get(normalizeRuleStatement(rule?.instruction)) === rule
    ));
}

function summarizeRuleGovernance(entries) {
    const governed = (entries || []).filter(entry => (
        entry?.entryType === 'business_rule' && entry?.metadata?.ruleKind
    ));
    const byKind = {};
    const statementGroups = new Map();

    for (const entry of governed) {
        const kind = entry.metadata.ruleKind;
        if (!byKind[kind]) {
            byKind[kind] = {
                label: entry.metadata.ruleLabel || RULE_DEFINITIONS[kind]?.label || kind,
                count: 0,
                precedence: Number(entry.metadata.precedence || 0),
                executionChannel: entry.metadata.executionChannel || '',
                knowledgeRole: entry.metadata.knowledgeRole || '',
            };
        }
        byKind[kind].count += 1;
        const statementKey = entry.metadata.canonicalRuleKey;
        if (!statementKey) continue;
        if (!statementGroups.has(statementKey)) statementGroups.set(statementKey, []);
        statementGroups.get(statementKey).push(entry);
    }

    const overlaps = [...statementGroups.entries()]
        .filter(([, items]) => items.length > 1)
        .map(([canonicalKey, items]) => ({
            canonicalKey,
            count: items.length,
            sources: items.map(item => ({
                sourceTable: item.sourceTable,
                sourceId: item.sourceId,
                title: item.title,
                ruleKind: item.metadata.ruleKind,
                scopeType: item.metadata.scopeType || 'global',
                scopeRef: item.metadata.scopeRef || '',
            })),
        }))
        .slice(0, 20);

    return {
        precedence: Object.entries(RULE_DEFINITIONS)
            .map(([ruleKind, definition]) => ({ ruleKind, ...definition }))
            .sort((left, right) => right.precedence - left.precedence),
        stats: {
            total: governed.length,
            authoritativeFacts: governed.filter(entry => (
                entry.metadata.knowledgeRole === 'authoritative_fact'
            )).length,
            referenceCopies: governed.filter(entry => (
                entry.metadata.knowledgeRole === 'reference_copy'
            )).length,
            runtimeEnforced: governed.filter(entry => entry.metadata.runtimeEnforced).length,
            overlapGroups: overlaps.length,
        },
        byKind,
        overlaps,
    };
}

module.exports = {
    RULE_DEFINITIONS,
    buildRuleGovernanceMetadata,
    canonicalRuleKey,
    dedupeRuntimeCorrectionRules,
    normalizeRuleStatement,
    summarizeRuleGovernance,
};
