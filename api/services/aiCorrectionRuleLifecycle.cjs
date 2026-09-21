const crypto = require('node:crypto');
const {
    DOMAIN_CAPABILITY_NAMES,
    getAiCapability,
} = require('../capabilities/registry.cjs');
const {
    normalizeRuleStatement,
} = require('./aiRuleGovernance.cjs');

const RULE_SCOPE_TYPES = new Set(['global', 'domain', 'object']);
const RULE_TYPES = new Set([
    'answer_correction',
    'terminology',
    'fact_authority',
    'classification',
    'calculation',
    'workflow',
    'tool_selection',
    'answer_style',
]);
const RULE_DOMAINS = new Set(Object.keys(DOMAIN_CAPABILITY_NAMES));

function parseJson(value, fallback) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value || '') : value;
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function normalizeDomains(value) {
    const values = Array.isArray(value) ? value : parseJson(value, []);
    return [...new Set(values.map(item => String(item || '').trim()))]
        .filter(domain => RULE_DOMAINS.has(domain))
        .slice(0, 6)
        .sort();
}

function normalizeOptionalText(value, maxLength, label) {
    const text = String(value || '').trim();
    if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
    return text;
}

function normalizePriority(value, fallback = 100) {
    if (value === undefined || value === null || value === '') return Number(fallback || 100);
    const priority = Number(value);
    if (!Number.isInteger(priority) || priority < 1 || priority > 1000) {
        throw new Error('规则优先级必须是 1 到 1000 的整数');
    }
    return priority;
}

function normalizeIsoDate(value, label, fallback = null) {
    if (value === undefined) return fallback;
    if (value === null || value === '') return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${label}不合法`);
    return date.toISOString();
}

function normalizeRuleConfiguration(input = {}, current = {}) {
    const scopeType = String(input.scopeType ?? current.scope_type ?? 'global').trim();
    if (!RULE_SCOPE_TYPES.has(scopeType)) throw new Error('规则范围类型不合法');
    const ruleType = String(input.ruleType ?? current.rule_type ?? 'answer_correction').trim();
    if (!RULE_TYPES.has(ruleType)) throw new Error('规则类型不合法');
    let domains = normalizeDomains(input.domains ?? current.domains_json ?? []);
    let objectType = normalizeOptionalText(
        input.objectType ?? current.object_type ?? '',
        80,
        '对象类型'
    );
    let objectRef = normalizeOptionalText(
        input.objectRef ?? current.object_ref ?? '',
        160,
        '对象标识'
    );
    const conflictGroup = normalizeOptionalText(
        input.conflictGroup ?? current.conflict_group ?? '',
        160,
        '规则主题'
    );
    if (!conflictGroup) throw new Error('规则主题不能为空');
    if (scopeType === 'global') {
        domains = [];
        objectType = '';
        objectRef = '';
    } else if (scopeType === 'domain') {
        if (domains.length === 0) throw new Error('领域规则至少需要一个业务域');
        objectType = '';
        objectRef = '';
    } else {
        if (domains.length === 0) throw new Error('对象规则至少需要一个业务域');
        if (!objectType || !objectRef) throw new Error('对象规则必须填写对象类型和对象标识');
    }
    const effectiveFrom = normalizeIsoDate(
        input.effectiveFrom,
        '规则生效时间',
        current.effective_from || current.created_at || new Date().toISOString()
    );
    const expiresAt = normalizeIsoDate(
        input.expiresAt,
        '规则失效时间',
        current.expires_at || null
    );
    if (effectiveFrom && expiresAt && Date.parse(expiresAt) <= Date.parse(effectiveFrom)) {
        throw new Error('规则失效时间必须晚于生效时间');
    }
    return {
        scopeType,
        domains,
        objectType,
        objectRef,
        ruleType,
        conflictGroup,
        priority: normalizePriority(input.priority, current.priority),
        effectiveFrom,
        expiresAt,
    };
}

function buildCorrectionRuleConflictKey(rule = {}) {
    const payload = {
        scopeType: String(rule.scopeType ?? rule.scope_type ?? 'global'),
        domains: normalizeDomains(rule.domains ?? rule.domainsJson ?? rule.domains_json ?? []),
        objectType: normalizeRuleStatement(rule.objectType ?? rule.object_type ?? ''),
        objectRef: normalizeRuleStatement(rule.objectRef ?? rule.object_ref ?? ''),
        ruleType: String(rule.ruleType ?? rule.rule_type ?? 'answer_correction'),
        conflictGroup: normalizeRuleStatement(rule.conflictGroup ?? rule.conflict_group ?? ''),
    };
    return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 24);
}

function inferCorrectionRuleScope(metadataJson) {
    const metadata = parseJson(metadataJson, {});
    const capabilityNames = new Set();
    const plannedCapabilityNames = new Set();
    for (const step of metadata?.toolPlan?.steps || []) {
        if (step?.name) {
            capabilityNames.add(String(step.name));
            plannedCapabilityNames.add(String(step.name));
        }
    }
    for (const item of metadata?.toolResults || []) {
        if (item?.name) capabilityNames.add(String(item.name));
    }
    const domains = [...capabilityNames]
        .map(name => getAiCapability(name)?.domain)
        .filter(domain => RULE_DOMAINS.has(domain));
    const uniqueDomains = [...new Set(domains)].sort();
    const uniqueCapabilities = [
        ...(plannedCapabilityNames.size > 0 ? plannedCapabilityNames : capabilityNames),
    ].sort();
    return {
        scopeType: uniqueDomains.length > 0 ? 'domain' : 'global',
        domains: uniqueDomains,
        objectType: '',
        objectRef: '',
        ruleType: 'answer_correction',
        conflictGroup: uniqueCapabilities.length > 0
            ? `capability:${uniqueCapabilities.join('+')}`.slice(0, 160)
            : '',
    };
}

function ruleTimingStatus(rule, nowValue = new Date()) {
    if (String(rule.status || 'active') !== 'active') return 'disabled';
    const now = nowValue instanceof Date ? nowValue.getTime() : Date.parse(nowValue);
    const effectiveFrom = Date.parse(rule.effectiveFrom || rule.effective_from || '');
    const expiresAt = Date.parse(rule.expiresAt || rule.expires_at || '');
    if (Number.isFinite(effectiveFrom) && now < effectiveFrom) return 'scheduled';
    if (Number.isFinite(expiresAt) && now >= expiresAt) return 'expired';
    if (
        String(rule.evaluationReviewStatus || rule.evaluation_review_status || '') !== 'approved'
        || !(rule.evaluationEnabled ?? rule.evaluation_enabled)
    ) return 'pending_review';
    return 'eligible';
}

function ruleScopeMatches(rule, options = {}) {
    const scopeType = rule.scopeType || rule.scope_type || 'global';
    if (scopeType === 'global') return true;
    const ruleDomains = normalizeDomains(rule.domains || rule.domainsJson || rule.domains_json || []);
    const targetDomains = new Set(normalizeDomains(options.domains || []));
    if (targetDomains.size === 0 && !(options.objectRefs || []).length && !String(options.query || '').trim()) {
        return true;
    }
    if (!ruleDomains.some(domain => targetDomains.has(domain))) return false;
    if (scopeType !== 'object') return true;
    const objectType = normalizeRuleStatement(rule.objectType || rule.object_type || '');
    const objectRef = normalizeRuleStatement(rule.objectRef || rule.object_ref || '');
    if (!objectType || !objectRef) return false;
    const objectTypes = new Set((options.objectTypes || []).map(normalizeRuleStatement));
    if (!objectTypes.has(objectType)) return false;
    const objectRefs = (options.objectRefs || []).map(normalizeRuleStatement);
    if (objectRefs.includes(objectRef)) return true;
    return normalizeRuleStatement(options.query).includes(objectRef);
}

function compareRuleWinner(left, right) {
    return Number(right.priority || 0) - Number(left.priority || 0)
        || Number(right.ruleVersion || right.rule_version || 1) - Number(left.ruleVersion || left.rule_version || 1)
        || String(right.updatedAt || right.updated_at || '').localeCompare(String(left.updatedAt || left.updated_at || ''))
        || Number(right.id || 0) - Number(left.id || 0);
}

function resolveCorrectionRuleStates(rules, options = {}) {
    const states = new Map();
    const eligible = [];
    for (const rule of rules || []) {
        const timingStatus = ruleTimingStatus(rule, options.now);
        if (timingStatus !== 'eligible') {
            states.set(rule.id, { effectiveStatus: timingStatus, conflictWith: [] });
            continue;
        }
        if (!ruleScopeMatches(rule, options)) {
            states.set(rule.id, { effectiveStatus: 'out_of_scope', conflictWith: [] });
            continue;
        }
        eligible.push(rule);
    }
    const groups = new Map();
    for (const rule of eligible) {
        const key = rule.conflictKey || rule.conflict_key || buildCorrectionRuleConflictKey(rule);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(rule);
    }
    const effective = [];
    for (const group of groups.values()) {
        const byInstruction = new Map();
        for (const rule of group) {
            const key = normalizeRuleStatement(rule.instruction);
            if (!byInstruction.has(key)) byInstruction.set(key, []);
            byInstruction.get(key).push(rule);
        }
        const representatives = [];
        for (const duplicates of byInstruction.values()) {
            duplicates.sort(compareRuleWinner);
            representatives.push(duplicates[0]);
            for (const duplicate of duplicates.slice(1)) {
                states.set(duplicate.id, {
                    effectiveStatus: 'duplicate',
                    conflictWith: [duplicates[0].id],
                });
            }
        }
        representatives.sort(compareRuleWinner);
        const topPriority = Number(representatives[0]?.priority || 0);
        const top = representatives.filter(rule => Number(rule.priority || 0) === topPriority);
        if (top.length > 1) {
            const ids = top.map(rule => rule.id);
            for (const rule of representatives) {
                states.set(rule.id, {
                    effectiveStatus: top.includes(rule) ? 'conflicted' : 'shadowed',
                    conflictWith: ids.filter(id => id !== rule.id),
                });
            }
            continue;
        }
        const winner = representatives[0];
        states.set(winner.id, { effectiveStatus: 'effective', conflictWith: [] });
        effective.push(winner);
        for (const rule of representatives.slice(1)) {
            states.set(rule.id, {
                effectiveStatus: 'shadowed',
                conflictWith: [winner.id],
            });
        }
    }
    return { states, effective };
}

module.exports = {
    RULE_DOMAINS,
    RULE_SCOPE_TYPES,
    RULE_TYPES,
    buildCorrectionRuleConflictKey,
    inferCorrectionRuleScope,
    normalizeDomains,
    normalizeRuleConfiguration,
    resolveCorrectionRuleStates,
    ruleScopeMatches,
    ruleTimingStatus,
};
