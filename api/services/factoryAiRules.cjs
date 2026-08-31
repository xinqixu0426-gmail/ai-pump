const ALLOWED_STATUSES = new Set(['active', 'disabled']);
const {
    buildCorrectionRuleConflictKey,
    inferCorrectionRuleScope,
    normalizeRuleConfiguration,
    resolveCorrectionRuleStates,
} = require('./aiCorrectionRuleLifecycle.cjs');

function loadDbAccessors() {
    return require('../db.cjs');
}

function parsePositiveId(value, label = '规则ID') {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${label}不合法`);
    return id;
}

function normalizeText(value, maxLength, label, required = false) {
    const text = String(value || '').trim();
    if (required && !text) throw new Error(`${label}不能为空`);
    if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
    return text;
}

function parseJson(value, fallback) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value || '') : value;
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function factoryAiRuleRow(row, state = {}) {
    if (!row) return null;
    return {
        id: row.id,
        sourceFeedbackId: row.source_feedback_id || null,
        title: row.title || '',
        triggerText: row.trigger_text || '',
        instruction: row.instruction || '',
        scopeType: row.scope_type || 'global',
        domains: parseJson(row.domains_json, []),
        objectType: row.object_type || '',
        objectRef: row.object_ref || '',
        ruleType: row.rule_type || 'answer_correction',
        conflictGroup: row.conflict_group || '',
        priority: Number(row.priority || 100),
        effectiveFrom: row.effective_from || null,
        expiresAt: row.expires_at || null,
        conflictKey: row.conflict_key || '',
        ruleVersion: Number(row.rule_version || 1),
        evaluationCaseId: row.evaluation_case_id || row.evaluation_case_join_id || null,
        evaluationReviewStatus: row.evaluation_review_status || null,
        evaluationEnabled: Boolean(row.evaluation_enabled),
        evaluationProposalHash: row.evaluation_proposal_hash || '',
        effectiveStatus: state.effectiveStatus || null,
        conflictWith: state.conflictWith || [],
        status: row.status || 'active',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function buildRuleTitle(question) {
    const compact = String(question || '').replace(/\s+/g, ' ').trim();
    return `纠正规则：${compact.slice(0, 80) || '用户确认的正确做法'}`;
}

function selectRulesWithEvaluation(db, clause = '', params = []) {
    return db.prepare(`
        SELECT rule.*,
               evaluation_case.id AS evaluation_case_join_id,
               evaluation_case.review_status AS evaluation_review_status,
               evaluation_case.enabled AS evaluation_enabled,
               evaluation_case.proposal_hash AS evaluation_proposal_hash
        FROM factory_ai_rules AS rule
        LEFT JOIN ai_evaluation_cases AS evaluation_case
          ON evaluation_case.id = rule.evaluation_case_id
          OR (rule.evaluation_case_id IS NULL
              AND evaluation_case.source_feedback_id = rule.source_feedback_id)
        ${clause}
    `).all(...params);
}

function synchronizeFactoryAiRuleFromFeedback(input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, safeUpdate } = accessors;
    const feedback = input.feedback;
    const feedbackId = parsePositiveId(feedback?.id, '反馈ID');
    const existing = db.prepare(
        'SELECT * FROM factory_ai_rules WHERE source_feedback_id = ?'
    ).get(feedbackId);
    const rating = String(feedback?.rating || '').trim();
    const shouldLearn = input.learnFromCorrection === true && rating === 'incorrect';

    if (!shouldLearn) {
        if (existing && (input.learnFromCorrection === false || rating !== 'incorrect')) {
            const write = safeUpdate('factory_ai_rules', existing.id, { status: 'disabled' }, options.auditContext || {});
            options.onWrite?.(write);
            return factoryAiRuleRow(db.prepare('SELECT * FROM factory_ai_rules WHERE id = ?').get(existing.id));
        }
        return factoryAiRuleRow(existing);
    }

    const instruction = normalizeText(feedback.note, 1000, '正确做法', true);
    const triggerText = normalizeText(feedback.question_text, 2000, '原问题');
    const now = new Date().toISOString();
    const inferredScope = inferCorrectionRuleScope(input.metadataJson);
    const requestedScope = input.ruleScope || {};
    const configuration = normalizeRuleConfiguration(
        {
            ...inferredScope,
            ...requestedScope,
            conflictGroup: requestedScope.conflictGroup
                || inferredScope.conflictGroup
                || existing?.conflict_group
                || `feedback:${feedbackId}`,
        },
        existing || { created_at: now, priority: 100 }
    );
    const nextDomainsJson = JSON.stringify(configuration.domains);
    const versionChanged = existing && (
        existing.trigger_text !== triggerText
        || existing.instruction !== instruction
        || existing.scope_type !== configuration.scopeType
        || existing.domains_json !== nextDomainsJson
        || existing.object_type !== configuration.objectType
        || existing.object_ref !== configuration.objectRef
        || existing.rule_type !== configuration.ruleType
        || existing.conflict_group !== configuration.conflictGroup
    );
    const values = {
        title: buildRuleTitle(triggerText),
        trigger_text: triggerText,
        instruction,
        scope_type: configuration.scopeType,
        domains_json: nextDomainsJson,
        object_type: configuration.objectType,
        object_ref: configuration.objectRef,
        rule_type: configuration.ruleType,
        conflict_group: configuration.conflictGroup,
        priority: configuration.priority,
        effective_from: configuration.effectiveFrom,
        expires_at: configuration.expiresAt,
        conflict_key: buildCorrectionRuleConflictKey(configuration),
        rule_version: versionChanged ? Number(existing.rule_version || 1) + 1 : Number(existing?.rule_version || 1),
        status: 'active',
    };
    let id;
    if (existing) {
        id = existing.id;
        const write = safeUpdate('factory_ai_rules', id, values, options.auditContext || {});
        options.onWrite?.(write);
    } else {
        const info = safeInsert('factory_ai_rules', {
            source_feedback_id: feedbackId,
            ...values,
            created_at: now,
            updated_at: now,
        }, options.auditContext || {});
        options.onWrite?.(info);
        id = Number(info.lastInsertRowid);
    }
    return factoryAiRuleRow(db.prepare('SELECT * FROM factory_ai_rules WHERE id = ?').get(id));
}

function resolveRows(rows, options) {
    const bare = rows.map(row => factoryAiRuleRow(row));
    const resolution = resolveCorrectionRuleStates(bare, options);
    return rows.map((row, index) => factoryAiRuleRow(row, resolution.states.get(bare[index].id)));
}

function listFactoryAiRules(filters = {}, options = {}) {
    const { db } = options.dbAccessors || loadDbAccessors();
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 200);
    const status = String(filters.status || '').trim();
    if (status && !ALLOWED_STATUSES.has(status)) throw new Error('规则状态不合法');
    const rows = selectRulesWithEvaluation(db, `
        ${status ? 'WHERE rule.status = ?' : ''}
        ORDER BY CASE rule.status WHEN 'active' THEN 0 ELSE 1 END,
                 rule.priority DESC, rule.updated_at DESC, rule.id DESC
        LIMIT 200
    `, status ? [status] : []);
    const resolutionOptions = {
        domains: filters.domains || [],
        objectTypes: filters.objectTypes || [],
        objectRefs: filters.objectRefs || [],
        query: filters.query || '',
        now: filters.now,
    };
    let items = resolveRows(rows, resolutionOptions);
    const effectiveStatus = String(filters.effectiveStatus || '').trim();
    if (effectiveStatus) items = items.filter(item => item.effectiveStatus === effectiveStatus);
    const domain = String(filters.domain || '').trim();
    if (domain) items = items.filter(item => item.domains.includes(domain));

    const allItems = resolveRows(selectRulesWithEvaluation(db, 'ORDER BY rule.id'), { now: filters.now });
    const count = statusName => allItems.filter(item => item.effectiveStatus === statusName).length;
    return {
        items: items.slice(0, limit),
        stats: {
            total: allItems.length,
            active: allItems.filter(item => item.status === 'active').length,
            disabled: allItems.filter(item => item.status === 'disabled').length,
            effective: count('effective'),
            pendingReview: count('pending_review'),
            scheduled: count('scheduled'),
            expired: count('expired'),
            conflicted: count('conflicted'),
            shadowed: count('shadowed') + count('duplicate'),
        },
    };
}

function updateFactoryAiRule(idValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate } = accessors;
    const id = parsePositiveId(idValue);
    const current = db.prepare('SELECT * FROM factory_ai_rules WHERE id = ?').get(id);
    if (!current) return null;
    const updates = {};
    if (input.status !== undefined) {
        const status = String(input.status || '').trim();
        if (!ALLOWED_STATUSES.has(status)) throw new Error('规则状态不合法');
        updates.status = status;
    }
    if (input.title !== undefined) updates.title = normalizeText(input.title, 200, '规则标题', true);
    if (input.triggerText !== undefined) updates.trigger_text = normalizeText(input.triggerText, 2000, '触发示例');
    if (input.instruction !== undefined) updates.instruction = normalizeText(input.instruction, 1000, '正确做法', true);
    const configurationFields = [
        'scopeType', 'domains', 'objectType', 'objectRef', 'ruleType', 'conflictGroup',
        'priority', 'effectiveFrom', 'expiresAt',
    ];
    if (configurationFields.some(field => input[field] !== undefined)) {
        const configuration = normalizeRuleConfiguration(input, current);
        Object.assign(updates, {
            scope_type: configuration.scopeType,
            domains_json: JSON.stringify(configuration.domains),
            object_type: configuration.objectType,
            object_ref: configuration.objectRef,
            rule_type: configuration.ruleType,
            conflict_group: configuration.conflictGroup,
            priority: configuration.priority,
            effective_from: configuration.effectiveFrom,
            expires_at: configuration.expiresAt,
        });
    }
    if (Object.keys(updates).length === 0) throw new Error('没有需要更新的规则字段');
    const nextSnapshot = { ...current, ...updates };
    updates.conflict_key = buildCorrectionRuleConflictKey(nextSnapshot);
    const proposalFields = new Set([
        'trigger_text', 'instruction', 'scope_type', 'domains_json',
        'object_type', 'object_ref', 'rule_type',
        'conflict_group',
    ]);
    const proposalChanged = Object.keys(updates).some(key => (
        proposalFields.has(key) && String(updates[key] ?? '') !== String(current[key] ?? '')
    ));
    if (proposalChanged) updates.rule_version = Number(current.rule_version || 1) + 1;
    const write = safeUpdate('factory_ai_rules', id, updates, options.auditContext || {});
    options.onWrite?.(write);
    let updated = db.prepare('SELECT * FROM factory_ai_rules WHERE id = ?').get(id);
    if (updated.source_feedback_id) {
        const regressionCases = require('./aiRegressionCases.cjs');
        if (proposalChanged) {
            const evaluationCase = regressionCases.synchronizeAiEvaluationCaseFromFeedback({
                feedback: {
                    id: updated.source_feedback_id,
                    rating: 'incorrect',
                    question_text: updated.trigger_text,
                    note: updated.instruction,
                },
                learnFromCorrection: true,
                rule: factoryAiRuleRow(updated),
            }, {
                dbAccessors: accessors,
                auditContext: options.auditContext,
                onWrite: options.onWrite,
            });
            if (evaluationCase?.id && updated.evaluation_case_id !== evaluationCase.id) {
                const linkWrite = safeUpdate('factory_ai_rules', id, {
                    evaluation_case_id: evaluationCase.id,
                }, options.auditContext || {});
                options.onWrite?.(linkWrite);
                updated = db.prepare('SELECT * FROM factory_ai_rules WHERE id = ?').get(id);
            }
        }
        regressionCases.synchronizeEvaluationCaseForRuleStatus(
            updated.source_feedback_id,
            updated.status,
            { dbAccessors: accessors, auditContext: options.auditContext, onWrite: options.onWrite }
        );
    }
    return factoryAiRuleRow(updated);
}

function normalizeSearchText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function buildQueryTokens(value) {
    const normalized = normalizeSearchText(value);
    const tokens = new Set(normalized.match(/[a-z0-9]+(?:[-_.][a-z0-9]+)*/g) || []);
    for (const segment of normalized.match(/[\u4e00-\u9fff]{2,}/g) || []) {
        if (segment.length <= 6) tokens.add(segment);
        for (let index = 0; index < segment.length - 1; index += 1) tokens.add(segment.slice(index, index + 2));
    }
    return [...tokens].filter(token => token.length >= 2);
}

function scoreFactoryAiRule(rule, options = {}) {
    const query = normalizeSearchText(options.query);
    const haystack = normalizeSearchText(`${rule.title} ${rule.triggerText} ${rule.instruction}`);
    let score = query && haystack.includes(query) ? 20 : 0;
    for (const token of buildQueryTokens(query)) {
        if (haystack.includes(token)) score += token.length >= 4 ? 4 : 2;
    }
    const targetDomains = new Set(options.domains || []);
    score += (rule.domains || []).filter(domain => targetDomains.has(domain)).length * 8;
    return score;
}

function selectRelevantFactoryAiRules(rules, options = {}) {
    const effective = resolveCorrectionRuleStates(rules, options).effective;
    const hasTarget = Boolean(String(options.query || '').trim())
        || (Array.isArray(options.domains) && options.domains.length > 0);
    if (!hasTarget) return effective;
    return effective
        .map(rule => ({ rule, score: scoreFactoryAiRule(rule, options) }))
        .filter(item => item.score > 0)
        .sort((left, right) => right.score - left.score
            || right.rule.priority - left.rule.priority
            || right.rule.id - left.rule.id)
        .map(item => item.rule);
}

function buildFactoryAiRulesPrompt(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const maxChars = Math.min(Math.max(Number(options.maxChars) || 6000, 1000), 30000);
    const maxRules = Math.min(Math.max(Number(options.maxRules) || 8, 1), 50);
    const activeRules = listFactoryAiRules({ status: 'active', limit: 200 }, { dbAccessors: accessors }).items;
    const rules = selectRelevantFactoryAiRules(activeRules, options).slice(0, maxRules);
    if (rules.length === 0) return '';
    const lines = [
        '',
        '【用户确认的长期操作习惯与纠正规则】',
        '以下规则是从用户对历史错误回答的纠正中提炼出的长期业务约束。原问题只作为适用示例和来源追溯，不限制规则范围，也不依赖原对话继续存在；后续相似场景同样必须遵守。',
        '仅使用已经人工批准、处于有效期内且不存在冲突的规则；相关场景下优先遵守。',
    ];
    let length = lines.join('\n').length;
    for (const [index, rule] of rules.entries()) {
        const scope = rule.scopeType === 'global'
            ? '全局'
            : `${rule.domains.join('、')}${rule.scopeType === 'object' ? ` / ${rule.objectType}:${rule.objectRef}` : ''}`;
        const block = [
            `${index + 1}. ${rule.title}`,
            `适用范围：${scope}；规则类型：${rule.ruleType}；规则主题：${rule.conflictGroup}；版本：v${rule.ruleVersion}`,
            rule.triggerText ? `适用示例：${rule.triggerText}` : '',
            `正确做法：${rule.instruction}`,
        ].filter(Boolean).join('\n');
        if (length + block.length > maxChars) break;
        lines.push(block);
        length += block.length;
    }
    return `\n${lines.join('\n')}`;
}

module.exports = {
    buildFactoryAiRulesPrompt,
    buildQueryTokens,
    factoryAiRuleRow,
    listFactoryAiRules,
    scoreFactoryAiRule,
    selectRelevantFactoryAiRules,
    synchronizeFactoryAiRuleFromFeedback,
    updateFactoryAiRule,
};
