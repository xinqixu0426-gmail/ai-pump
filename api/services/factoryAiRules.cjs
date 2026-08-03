const ALLOWED_STATUSES = new Set(['active', 'disabled']);
const { dedupeRuntimeCorrectionRules } = require('./aiRuleGovernance.cjs');
const DOMAIN_KEYWORDS = Object.freeze({
    management: ['管理', '待办', '优先', '执行计划', '工作流'],
    knowledge: ['知识', '资料', '术语', '俗称', '用途', '同步'],
    quality: ['质量', '检查', '异常', '漏项', '规则', '学习'],
    order: ['订单', '生产', '齐料', '缺料', '采购', '交付'],
    quotation: ['报价', '客户', '利润'],
    file: ['文件', '附件', '图片', 'pdf', 'excel', 'ocr', '归档'],
    recipe: ['配方', '模板', '泵壳', 'bom', '机筒'],
    cost: ['成本', '价格', '单价', '金额', '铜价'],
    coil: ['线圈', '定子', '转子', '片数', '槽眼', '漆包线'],
    catalog: ['零件', '配件', '供应商', '库存'],
    drawing: ['出图', '图纸', '打印', '轴承', '油封'],
});

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

function factoryAiRuleRow(row) {
    if (!row) return null;
    return {
        id: row.id,
        sourceFeedbackId: row.source_feedback_id || null,
        title: row.title || '',
        triggerText: row.trigger_text || '',
        instruction: row.instruction || '',
        scopeType: row.scope_type || 'global',
        priority: Number(row.priority || 100),
        status: row.status || 'active',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function buildRuleTitle(question) {
    const compact = String(question || '').replace(/\s+/g, ' ').trim();
    return `纠正规则：${compact.slice(0, 80) || '用户确认的正确做法'}`;
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
    const explicitlyDisabled = input.learnFromCorrection === false;
    const shouldLearn = input.learnFromCorrection === true && rating === 'incorrect';

    if (!shouldLearn) {
        if (existing && (explicitlyDisabled || rating !== 'incorrect')) {
            const write = safeUpdate(
                'factory_ai_rules',
                existing.id,
                { status: 'disabled' },
                options.auditContext || {}
            );
            options.onWrite?.(write);
            return factoryAiRuleRow(db.prepare('SELECT * FROM factory_ai_rules WHERE id = ?').get(existing.id));
        }
        return factoryAiRuleRow(existing);
    }

    const instruction = normalizeText(feedback.note, 1000, '正确做法', true);
    const triggerText = normalizeText(feedback.question_text, 2000, '原问题');
    const now = new Date().toISOString();
    const values = {
        title: buildRuleTitle(triggerText),
        trigger_text: triggerText,
        instruction,
        scope_type: 'global',
        priority: 100,
        status: 'active',
    };
    let id;
    if (existing) {
        id = existing.id;
        const write = safeUpdate(
            'factory_ai_rules',
            id,
            values,
            options.auditContext || {}
        );
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

function listFactoryAiRules(filters = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db } = accessors;
    const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 200);
    const status = String(filters.status || '').trim();
    if (status && !ALLOWED_STATUSES.has(status)) throw new Error('规则状态不合法');
    const rows = status
        ? db.prepare(`
            SELECT * FROM factory_ai_rules
            WHERE status = ?
            ORDER BY priority DESC, updated_at DESC, id DESC
            LIMIT ?
        `).all(status, limit)
        : db.prepare(`
            SELECT * FROM factory_ai_rules
            ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                     priority DESC, updated_at DESC, id DESC
            LIMIT ?
        `).all(limit);
    return {
        items: rows.map(factoryAiRuleRow),
        stats: {
            total: Number(db.prepare('SELECT COUNT(*) AS count FROM factory_ai_rules').get().count || 0),
            active: Number(db.prepare("SELECT COUNT(*) AS count FROM factory_ai_rules WHERE status = 'active'").get().count || 0),
            disabled: Number(db.prepare("SELECT COUNT(*) AS count FROM factory_ai_rules WHERE status = 'disabled'").get().count || 0),
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
    if (Object.keys(updates).length === 0) throw new Error('没有需要更新的规则字段');
    const write = safeUpdate(
        'factory_ai_rules',
        id,
        updates,
        options.auditContext || {}
    );
    options.onWrite?.(write);
    const updated = db.prepare('SELECT * FROM factory_ai_rules WHERE id = ?').get(id);
    if (updated.source_feedback_id) {
        const regressionCases = require('./aiRegressionCases.cjs');
        if (updates.trigger_text !== undefined || updates.instruction !== undefined) {
            regressionCases.synchronizeAiEvaluationCaseFromFeedback({
                feedback: {
                    id: updated.source_feedback_id,
                    rating: 'incorrect',
                    question_text: updated.trigger_text,
                    note: updated.instruction,
                },
                learnFromCorrection: true,
            }, {
                dbAccessors: accessors,
                auditContext: options.auditContext,
                onWrite: options.onWrite,
            });
        }
        regressionCases.synchronizeEvaluationCaseForRuleStatus(
            updated.source_feedback_id,
            updated.status,
            {
                dbAccessors: accessors,
                auditContext: options.auditContext,
                onWrite: options.onWrite,
            }
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
        for (let index = 0; index < segment.length - 1; index += 1) {
            tokens.add(segment.slice(index, index + 2));
        }
    }
    return [...tokens].filter(token => token.length >= 2);
}

function scoreFactoryAiRule(rule, options = {}) {
    const query = normalizeSearchText(options.query);
    const haystack = normalizeSearchText(`${rule.title} ${rule.triggerText} ${rule.instruction}`);
    let score = 0;
    if (query && haystack.includes(query)) score += 20;
    for (const token of buildQueryTokens(query)) {
        if (haystack.includes(token)) score += token.length >= 4 ? 4 : 2;
    }
    for (const domain of options.domains || []) {
        const keywords = DOMAIN_KEYWORDS[domain] || [];
        const matches = keywords.filter(keyword => haystack.includes(keyword.toLowerCase())).length;
        if (matches > 0) score += 3 + matches;
    }
    return score;
}

function selectRelevantFactoryAiRules(rules, options = {}) {
    const hasTarget = Boolean(String(options.query || '').trim())
        || (Array.isArray(options.domains) && options.domains.length > 0);
    const uniqueRules = dedupeRuntimeCorrectionRules(rules);
    if (!hasTarget) return uniqueRules;
    return uniqueRules
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
    const activeRules = listFactoryAiRules({ status: 'active', limit: 100 }, { dbAccessors: accessors }).items;
    const rules = selectRelevantFactoryAiRules(activeRules, options).slice(0, maxRules);
    if (rules.length === 0) return '';
    const lines = [
        '',
        '【用户确认的长期操作习惯与纠正规则】',
        '以下规则来自用户对历史错误回答的明确纠正。相关场景下优先遵守；不得因为模型惯例、相似知识或旧会话回答而忽略。',
    ];
    let length = lines.join('\n').length;
    for (const [index, rule] of rules.entries()) {
        const block = [
            `${index + 1}. ${rule.title}`,
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
