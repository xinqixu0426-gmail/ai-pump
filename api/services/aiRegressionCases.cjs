const crypto = require('node:crypto');

const REVIEW_STATUSES = new Set(['pending', 'approved', 'rejected']);
const CATEGORY_KEYWORDS = Object.freeze([
    ['线圈', ['线圈', '定子', '转子', '片数', '槽眼']],
    ['报价', ['报价', '客户', '利润']],
    ['订单', ['订单', '采购', '交付', '生产']],
    ['成本', ['成本', '价格', '单价', '金额']],
    ['技术档案', ['文件', '附件', '图纸', '报告', 'excel', 'pdf']],
    ['配方', ['配方', '模板', '泵壳', 'bom']],
    ['库存', ['库存', '入库', '出库', '零件', '配件']],
]);

function loadDbAccessors() {
    return require('../db.cjs');
}

function normalizeText(value, maxLength = 2000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function parseJson(value, fallback) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value || '') : value;
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function normalizeTerm(value) {
    return normalizeText(value, 60)
        .replace(/^[“”"'`：:，,、\s]+|[“”"'`：:，,、\s]+$/g, '');
}

function addUniqueTerm(target, seen, value) {
    const term = normalizeTerm(value);
    if (term.length < 2 || term.length > 30) return false;
    const key = term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    target.push(term);
    return true;
}

function negativeContext(text, index) {
    return /(?:不是|并非|不要|不能|不得|不应|禁止)(?:把|将|再|标注为|称为|当作|作为|显示)?[^，。；\n]{0,18}$/
        .test(text.slice(Math.max(0, index - 28), index));
}

function extractCorrectionTerms(noteValue) {
    const note = normalizeText(noteValue, 1000);
    const required = [];
    const forbidden = [];
    const requiredSeen = new Set();
    const forbiddenSeen = new Set();
    let explicitRelation = false;

    for (const match of note.matchAll(/[“"'`]([^“”"'`]{2,30})[”"'`]/g)) {
        const target = negativeContext(note, match.index || 0) ? forbidden : required;
        const seen = target === forbidden ? forbiddenSeen : requiredSeen;
        addUniqueTerm(target, seen, match[1]);
    }

    const structuredPattern = /#[0-9]+|[A-Za-z]*\d+(?:[-_.×xX寸]+[A-Za-z0-9\u4e00-\u9fff]+)+|\d+(?:\.\d+)?\s*(?:元|片|米|毫米|mm|套|根|份|条|个)/gi;
    for (const match of note.matchAll(structuredPattern)) {
        const target = negativeContext(note, match.index || 0) ? forbidden : required;
        const seen = target === forbidden ? forbiddenSeen : requiredSeen;
        const term = match[0].split(/(?:代表|表示|指的是|不是|并非|应该|应当)/)[0];
        addUniqueTerm(target, seen, term);
    }

    const forbiddenPatterns = [
        /(?:不是|并非)\s*([^，。；\n]{2,24})/g,
        /(?:不要|不能|不得|不应|禁止)(?:把|将|再)?(?:标注为|称为|当作|作为|显示)?\s*([^，。；\n]{2,24})/g,
    ];
    for (const pattern of forbiddenPatterns) {
        for (const match of note.matchAll(pattern)) {
            explicitRelation = true;
            for (const segment of match[1].split(/[、,，或和]/)) {
                addUniqueTerm(forbidden, forbiddenSeen, segment);
            }
        }
    }

    const requiredPatterns = [
        /(?:正确(?:分类|名称|做法)?|实际(?:上)?|应该|应当)(?:是|为|按|使用|叫|称为)?\s*([^，。；\n]{2,32})/g,
        /(?:表示|代表|指的是|归类为|标注为|称为|统一按)\s*([^，。；\n]{2,32})/g,
    ];
    for (const pattern of requiredPatterns) {
        for (const match of note.matchAll(pattern)) {
            explicitRelation = true;
            for (const segment of match[1].split(/[、,，]/)) {
                addUniqueTerm(required, requiredSeen, segment);
            }
        }
    }

    const forbiddenKeys = new Set(forbidden.map(term => term.toLowerCase()));
    return {
        required: required.filter(term => !forbiddenKeys.has(term.toLowerCase())).slice(0, 8),
        forbidden: forbidden.slice(0, 8),
        explicitRelation,
    };
}

function inferCategory(question, correction) {
    const haystack = `${question} ${correction}`.toLowerCase();
    return CATEGORY_KEYWORDS.find(([, keywords]) => keywords.some(keyword => haystack.includes(keyword)))?.[0]
        || '业务规则';
}

function proposalHash(question, correction, config) {
    return crypto.createHash('sha256')
        .update(JSON.stringify({ question, correction, config }))
        .digest('hex');
}

function buildFeedbackEvaluationProposal(feedback = {}, rule = null) {
    const feedbackId = Number(feedback.id);
    if (!Number.isInteger(feedbackId) || feedbackId <= 0) throw new Error('反馈ID不合法');
    const question = normalizeText(feedback.question_text ?? feedback.questionText, 2000);
    const correction = normalizeText(feedback.note, 1000);
    if (!question || !correction) throw new Error('反馈缺少原问题或正确做法');
    const terms = extractCorrectionTerms(correction);
    const config = {
        requiredTerms: terms.required.map(term => {
            const compact = term.replace(/的/g, '');
            return compact !== term ? [term, compact] : [term];
        }),
        forbiddenTerms: terms.forbidden,
        correctionGuidance: correction,
        sourceFeedbackId: feedbackId,
        ruleSnapshot: rule ? {
            ruleId: Number(rule.id) || null,
            ruleVersion: Number(rule.ruleVersion || rule.rule_version || 1),
            scopeType: rule.scopeType || rule.scope_type || 'global',
            domains: Array.isArray(rule.domains) ? rule.domains : [],
            objectType: rule.objectType || rule.object_type || '',
            objectRef: rule.objectRef || rule.object_ref || '',
            ruleType: rule.ruleType || rule.rule_type || 'answer_correction',
        } : null,
    };
    let confidenceScore = 10;
    confidenceScore += Math.min(terms.required.length * 20, 40);
    confidenceScore += Math.min(terms.forbidden.length * 15, 30);
    if (terms.explicitRelation) confidenceScore += 20;
    confidenceScore = Math.min(confidenceScore, 100);
    const hasChecks = terms.required.length > 0 || terms.forbidden.length > 0;
    const reasons = [
        terms.required.length ? `提取 ${terms.required.length} 个正确答案锚点` : '未提取到稳定的正确答案锚点',
        terms.forbidden.length ? `提取 ${terms.forbidden.length} 个错误结论` : '没有明确禁用结论',
        '已生成候选，等待人工审核后才纳入回归并允许规则生效',
    ];
    return {
        caseKey: `feedback-${feedbackId}`,
        title: `纠错回归：${question.slice(0, 70)}`,
        category: inferCategory(question, correction),
        question,
        config,
        confidenceScore,
        reviewStatus: 'pending',
        enabled: false,
        generationNote: reasons.join('；'),
        proposalHash: proposalHash(question, correction, config),
        hasChecks,
    };
}

function evaluationCaseView(row, adapter) {
    if (!row) return null;
    const item = adapter(row);
    return {
        ...item,
        config: parseJson(item.configJson, {}),
        learningRuleStatus: row.learning_rule_status || null,
    };
}

function synchronizeAiEvaluationCaseFromFeedback(input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, safeUpdate, aiEvaluationCaseRow } = accessors;
    const feedback = input.feedback;
    const feedbackId = Number(feedback?.id);
    if (!Number.isInteger(feedbackId) || feedbackId <= 0) throw new Error('反馈ID不合法');
    const existing = db.prepare(
        'SELECT * FROM ai_evaluation_cases WHERE source_feedback_id = ?'
    ).get(feedbackId);
    const shouldLearn = input.learnFromCorrection === true
        && String(feedback?.rating || '') === 'incorrect';
    if (!shouldLearn) {
        if (existing) {
            const write = safeUpdate(
                'ai_evaluation_cases',
                existing.id,
                { enabled: 0 },
                options.auditContext || {}
            );
            options.onWrite?.(write);
        }
        return evaluationCaseView(
            existing ? db.prepare('SELECT * FROM ai_evaluation_cases WHERE id = ?').get(existing.id) : null,
            aiEvaluationCaseRow
        );
    }

    const proposal = buildFeedbackEvaluationProposal(feedback, input.rule);
    const now = new Date().toISOString();
    let reviewStatus = proposal.reviewStatus;
    if (existing?.proposal_hash === proposal.proposalHash
        && REVIEW_STATUSES.has(existing.review_status)) {
        reviewStatus = existing.review_status;
    }
    const enabled = reviewStatus === 'approved';
    const values = {
        case_key: proposal.caseKey,
        title: proposal.title,
        category: proposal.category,
        question: proposal.question,
        evaluator_type: 'rules',
        config_json: JSON.stringify(proposal.config),
        enabled: enabled ? 1 : 0,
        sort_order: 1000 + feedbackId,
        source_type: 'feedback',
        source_feedback_id: feedbackId,
        review_status: reviewStatus,
        confidence_score: proposal.confidenceScore,
        generation_note: proposal.generationNote,
        proposal_hash: proposal.proposalHash,
        reviewed_at: existing?.proposal_hash === proposal.proposalHash
            && reviewStatus !== 'pending'
            ? (existing.reviewed_at || now)
            : null,
    };
    let id;
    if (existing) {
        id = existing.id;
        const write = safeUpdate(
            'ai_evaluation_cases',
            id,
            values,
            options.auditContext || {}
        );
        options.onWrite?.(write);
    } else {
        const info = safeInsert('ai_evaluation_cases', {
            ...values,
            review_note: '',
            created_at: now,
            updated_at: now,
        }, options.auditContext || {});
        options.onWrite?.(info);
        id = Number(info.lastInsertRowid);
    }
    return evaluationCaseView(
        db.prepare('SELECT * FROM ai_evaluation_cases WHERE id = ?').get(id),
        aiEvaluationCaseRow
    );
}

function listFeedbackEvaluationCases(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const rows = accessors.db.prepare(`
        SELECT evaluation_case.*, learning_rule.status AS learning_rule_status
        FROM ai_evaluation_cases AS evaluation_case
        LEFT JOIN factory_ai_rules AS learning_rule
          ON learning_rule.source_feedback_id = evaluation_case.source_feedback_id
        WHERE evaluation_case.source_type = 'feedback'
        ORDER BY
          CASE evaluation_case.review_status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
          evaluation_case.updated_at DESC,
          evaluation_case.id DESC
    `).all();
    return rows.map(row => evaluationCaseView(row, accessors.aiEvaluationCaseRow));
}

function reviewFeedbackEvaluationCase(idValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate, aiEvaluationCaseRow } = accessors;
    const id = Number(idValue);
    if (!Number.isInteger(id) || id <= 0) throw new Error('回归用例ID不合法');
    const current = db.prepare(`
        SELECT evaluation_case.*, learning_rule.status AS learning_rule_status
        FROM ai_evaluation_cases AS evaluation_case
        LEFT JOIN factory_ai_rules AS learning_rule
          ON learning_rule.source_feedback_id = evaluation_case.source_feedback_id
        WHERE evaluation_case.id = ? AND evaluation_case.source_type = 'feedback'
    `).get(id);
    if (!current) return null;
    const reviewStatus = normalizeText(input.reviewStatus, 20);
    if (!REVIEW_STATUSES.has(reviewStatus)) throw new Error('回归审核状态不合法');
    const reviewNote = normalizeText(input.reviewNote, 500);
    const config = parseJson(current.config_json, {});
    const hasChecks = (Array.isArray(config.requiredTerms) && config.requiredTerms.length > 0)
        || (Array.isArray(config.forbiddenTerms) && config.forbiddenTerms.length > 0)
        || (Array.isArray(config.requiredTools) && config.requiredTools.length > 0)
        || Boolean(config.fact);
    if (reviewStatus === 'approved' && !hasChecks) {
        throw new Error('该纠错没有可自动判定的检查项，不能纳入发布回归');
    }
    const learningRuleActive = current.learning_rule_status === 'active';
    const write = safeUpdate('ai_evaluation_cases', id, {
        review_status: reviewStatus,
        review_note: reviewNote,
        reviewed_at: new Date().toISOString(),
        enabled: reviewStatus === 'approved' && learningRuleActive ? 1 : 0,
    }, options.auditContext || {});
    options.onWrite?.(write);
    const row = db.prepare(`
        SELECT evaluation_case.*, learning_rule.status AS learning_rule_status
        FROM ai_evaluation_cases AS evaluation_case
        LEFT JOIN factory_ai_rules AS learning_rule
          ON learning_rule.source_feedback_id = evaluation_case.source_feedback_id
        WHERE evaluation_case.id = ?
    `).get(id);
    return evaluationCaseView(row, aiEvaluationCaseRow);
}

function synchronizeEvaluationCaseForRuleStatus(sourceFeedbackId, ruleStatus, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate } = accessors;
    const row = db.prepare(
        'SELECT id, review_status FROM ai_evaluation_cases WHERE source_feedback_id = ?'
    ).get(Number(sourceFeedbackId));
    if (!row) return null;
    const write = safeUpdate('ai_evaluation_cases', row.id, {
        enabled: ruleStatus === 'active' && row.review_status === 'approved' ? 1 : 0,
    }, options.auditContext || {});
    options.onWrite?.(write);
    return row.id;
}

module.exports = {
    buildFeedbackEvaluationProposal,
    evaluationCaseView,
    extractCorrectionTerms,
    listFeedbackEvaluationCases,
    reviewFeedbackEvaluationCase,
    synchronizeAiEvaluationCaseFromFeedback,
    synchronizeEvaluationCaseForRuleStatus,
};
