const ALLOWED_RATINGS = new Set(['helpful', 'incorrect', 'outdated', 'missing_source']);
const ALLOWED_STATUSES = new Set(['open', 'resolved']);

function loadDbAccessors() {
    return require('../db.cjs');
}

function normalizeOwnerKey(value) {
    return String(value || 'admin').trim().slice(0, 80) || 'admin';
}

function parsePositiveId(value, label) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${label}不合法`);
    return id;
}

function normalizeRating(value) {
    const rating = String(value || '').trim();
    if (!ALLOWED_RATINGS.has(rating)) throw new Error('反馈类型不合法');
    return rating;
}

function normalizeText(value, maxLength, label) {
    const text = String(value || '').trim();
    if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
    return text;
}

function parseObject(value) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function collectSources(metadataJson) {
    const metadata = parseObject(metadataJson);
    const sources = [];
    const seen = new Set();
    for (const tool of Array.isArray(metadata.toolResults) ? metadata.toolResults : []) {
        const result = parseObject(tool?.result);
        const candidates = Array.isArray(result.sources) ? result.sources : [];
        for (const source of candidates) {
            if (!source || typeof source !== 'object') continue;
            const key = `${source.knowledgeEntryId || ''}\u0000${source.sourceTable || ''}\u0000${source.sourceId || ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            sources.push({
                kind: String(source.kind || 'knowledge_snapshot').slice(0, 40),
                knowledgeEntryId: Number(source.knowledgeEntryId) || null,
                entryType: String(source.entryType || '').slice(0, 60),
                title: String(source.title || '').slice(0, 200),
                sourceTable: String(source.sourceTable || '').slice(0, 80),
                sourceId: String(source.sourceId || '').slice(0, 120),
                syncedAt: source.syncedAt || null,
                freshness: String(source.freshness || '').slice(0, 40),
                knowledgePath: String(source.knowledgePath || '').slice(0, 300),
                sourcePath: String(source.sourcePath || '').slice(0, 300),
            });
        }
    }
    return sources.slice(0, 30);
}

function feedbackRow(row, rowAdapter, db = null, evaluationCaseAdapter = null) {
    if (!row) return null;
    const adapted = rowAdapter(row);
    const conversationDeleted = Object.hasOwn(row, 'conversation_deleted_at')
        ? Boolean(row.conversation_deleted_at)
        : Boolean(db?.prepare(`
            SELECT deleted_at FROM ai_conversations WHERE id = ?
        `).get(adapted.conversationId)?.deleted_at);
    let sources = [];
    try {
        const parsed = JSON.parse(adapted.sourcesJson || '[]');
        sources = Array.isArray(parsed) ? parsed : [];
    } catch {
        sources = [];
    }
    let diagnosis = null;
    let retestSources = [];
    try {
        const parsed = JSON.parse(adapted.diagnosisJson || '{}');
        diagnosis = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length
            ? parsed
            : null;
    } catch {
        diagnosis = null;
    }
    try {
        const parsed = JSON.parse(adapted.retestSourcesJson || '[]');
        retestSources = Array.isArray(parsed) ? parsed : [];
    } catch {
        retestSources = [];
    }
    const learningRule = db
        ? require('./factoryAiRules.cjs').factoryAiRuleRow(
            db.prepare('SELECT * FROM factory_ai_rules WHERE source_feedback_id = ?').get(adapted.id)
        )
        : null;
    const regressionCase = db && evaluationCaseAdapter
        ? require('./aiRegressionCases.cjs').evaluationCaseView(
            db.prepare('SELECT * FROM ai_evaluation_cases WHERE source_feedback_id = ?').get(adapted.id),
            evaluationCaseAdapter
        )
        : null;
    return {
        ...adapted,
        conversationDeleted,
        sources,
        diagnosis,
        retestSources,
        learningRule,
        regressionCase,
    };
}

function assistantMessageForOwner(db, ownerKey, messageId) {
    return db.prepare(`
        SELECT message.*, conversation.owner_key, conversation.deleted_at
        FROM ai_conversation_messages AS message
        JOIN ai_conversations AS conversation ON conversation.id = message.conversation_id
        WHERE message.id = ?
          AND message.role = 'assistant'
          AND conversation.owner_key = ?
          AND conversation.deleted_at IS NULL
    `).get(messageId, normalizeOwnerKey(ownerKey));
}

function submitAiAnswerFeedback(ownerKey, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, safeUpdate, aiAnswerFeedbackRow, aiEvaluationCaseRow } = accessors;
    const messageId = parsePositiveId(input.messageId, '消息ID');
    const rating = normalizeRating(input.rating);
    const note = normalizeText(input.note, 500, '补充说明');
    if (input.learnFromCorrection === true && rating !== 'incorrect') {
        throw new Error('只有“内容错误”反馈可以保存为长期纠正规则');
    }
    if (input.learnFromCorrection === true && !note) {
        throw new Error('让 AI 长期记住时必须填写正确做法');
    }
    const message = assistantMessageForOwner(db, ownerKey, messageId);
    if (!message) return null;

    const question = db.prepare(`
        SELECT content FROM ai_conversation_messages
        WHERE conversation_id = ? AND role = 'user' AND id < ?
        ORDER BY id DESC LIMIT 1
    `).get(message.conversation_id, message.id);
    const now = new Date().toISOString();
    const status = rating === 'helpful' ? 'resolved' : 'open';
    const values = {
        conversation_id: message.conversation_id,
        message_id: message.id,
        rating,
        note,
        question_text: String(question?.content || '').slice(0, 100000),
        answer_text: String(message.content || '').slice(0, 100000),
        sources_json: JSON.stringify(collectSources(message.metadata_json)),
        diagnosis_json: '{}',
        diagnosed_at: null,
        retest_answer_text: '',
        retest_sources_json: '[]',
        retested_at: null,
        status,
        resolution_note: '',
        resolved_at: status === 'resolved' ? now : null,
    };
    const persistFeedback = db.transaction(() => {
        const existing = db.prepare('SELECT id FROM ai_answer_feedback WHERE message_id = ?').get(message.id);
        let id;
        if (existing) {
            id = existing.id;
            const write = safeUpdate(
                'ai_answer_feedback',
                id,
                values,
                options.auditContext || {}
            );
            options.onWrite?.(write);
        } else {
            const info = safeInsert('ai_answer_feedback', {
                ...values,
                created_at: now,
                updated_at: now,
            }, options.auditContext || {});
            options.onWrite?.(info);
            id = Number(info.lastInsertRowid);
        }
        const saved = db.prepare('SELECT * FROM ai_answer_feedback WHERE id = ?').get(id);
        require('./factoryAiRules.cjs').synchronizeFactoryAiRuleFromFeedback({
            feedback: saved,
            learnFromCorrection: input.learnFromCorrection,
        }, {
            dbAccessors: accessors,
            auditContext: options.auditContext,
            onWrite: options.onWrite,
        });
        require('./aiRegressionCases.cjs').synchronizeAiEvaluationCaseFromFeedback({
            feedback: saved,
            learnFromCorrection: input.learnFromCorrection,
        }, {
            dbAccessors: accessors,
            auditContext: options.auditContext,
            onWrite: options.onWrite,
        });
        return feedbackRow(
            db.prepare('SELECT * FROM ai_answer_feedback WHERE id = ?').get(id),
            aiAnswerFeedbackRow,
            db,
            aiEvaluationCaseRow
        );
    });
    return persistFeedback();
}

function listAiAnswerFeedback(ownerKey, filters = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, aiAnswerFeedbackRow, aiEvaluationCaseRow } = accessors;
    const owner = normalizeOwnerKey(ownerKey);
    const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100);
    const clauses = ['conversation.owner_key = ?'];
    const params = [owner];
    if (filters.conversationId !== undefined && filters.conversationId !== '') {
        clauses.push('feedback.conversation_id = ?');
        params.push(parsePositiveId(filters.conversationId, '会话ID'));
    }
    if (filters.status) {
        const status = String(filters.status);
        if (!ALLOWED_STATUSES.has(status)) throw new Error('处理状态不合法');
        clauses.push('feedback.status = ?');
        params.push(status);
    }
    if (filters.rating) {
        clauses.push('feedback.rating = ?');
        params.push(normalizeRating(filters.rating));
    }
    const items = db.prepare(`
        SELECT feedback.*, conversation.deleted_at AS conversation_deleted_at
        FROM ai_answer_feedback AS feedback
        JOIN ai_conversations AS conversation ON conversation.id = feedback.conversation_id
        WHERE ${clauses.join(' AND ')}
        ORDER BY feedback.updated_at DESC, feedback.id DESC
        LIMIT ?
    `).all(...params, limit).map(row => feedbackRow(row, aiAnswerFeedbackRow, db, aiEvaluationCaseRow));
    const stats = db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN feedback.status = 'open' THEN 1 ELSE 0 END) AS open,
            SUM(CASE WHEN feedback.rating = 'helpful' THEN 1 ELSE 0 END) AS helpful,
            SUM(CASE WHEN feedback.status = 'open' AND feedback.rating = 'incorrect' THEN 1 ELSE 0 END) AS incorrect,
            SUM(CASE WHEN feedback.status = 'open' AND feedback.rating = 'outdated' THEN 1 ELSE 0 END) AS outdated,
            SUM(CASE WHEN feedback.status = 'open' AND feedback.rating = 'missing_source' THEN 1 ELSE 0 END) AS missing_source
        FROM ai_answer_feedback AS feedback
        JOIN ai_conversations AS conversation ON conversation.id = feedback.conversation_id
        WHERE conversation.owner_key = ?
    `).get(owner);
    return {
        items,
        stats: {
            total: Number(stats.total || 0),
            open: Number(stats.open || 0),
            helpful: Number(stats.helpful || 0),
            incorrect: Number(stats.incorrect || 0),
            outdated: Number(stats.outdated || 0),
            missingSource: Number(stats.missing_source || 0),
        },
    };
}

function reviewAiAnswerFeedback(ownerKey, idValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate, aiAnswerFeedbackRow, aiEvaluationCaseRow } = accessors;
    const id = parsePositiveId(idValue, '反馈ID');
    const status = String(input.status || '').trim();
    if (!ALLOWED_STATUSES.has(status)) throw new Error('处理状态不合法');
    const resolutionNote = normalizeText(input.resolutionNote, 500, '处理说明');
    const owned = db.prepare(`
        SELECT feedback.id
        FROM ai_answer_feedback AS feedback
        JOIN ai_conversations AS conversation ON conversation.id = feedback.conversation_id
        WHERE feedback.id = ? AND conversation.owner_key = ?
    `).get(id, normalizeOwnerKey(ownerKey));
    if (!owned) return null;
    const write = safeUpdate('ai_answer_feedback', id, {
        status,
        resolution_note: resolutionNote,
        resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    }, options.auditContext || {});
    options.onWrite?.(write);
    return feedbackRow(
        db.prepare('SELECT * FROM ai_answer_feedback WHERE id = ?').get(id),
        aiAnswerFeedbackRow,
        db,
        aiEvaluationCaseRow
    );
}

function feedbackForOwner(db, ownerKey, id) {
    return db.prepare(`
        SELECT feedback.*
        FROM ai_answer_feedback AS feedback
        JOIN ai_conversations AS conversation ON conversation.id = feedback.conversation_id
        WHERE feedback.id = ? AND conversation.owner_key = ?
    `).get(id, normalizeOwnerKey(ownerKey));
}

function sourceKey(source) {
    return `${String(source?.sourceTable || '')}\u0000${String(source?.sourceId || '')}`;
}

function questionSearchTerms(question) {
    const value = String(question || '').trim();
    const terms = [];
    const seen = new Set();
    const add = term => {
        const normalized = String(term || '').trim();
        if (normalized.length < 2 || seen.has(normalized)) return;
        seen.add(normalized);
        terms.push(normalized);
    };
    for (const match of value.matchAll(/[“"'`](.{2,40}?)[”"'`]/g)) add(match[1]);
    for (const match of value.matchAll(/[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)+|[A-Za-z]+\d+[A-Za-z0-9-]*/g)) add(match[0]);
    return terms.slice(0, 5);
}

function diagnoseAiAnswerFeedback(ownerKey, idValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate, aiAnswerFeedbackRow, aiEvaluationCaseRow } = accessors;
    const id = parsePositiveId(idValue, '反馈ID');
    const row = feedbackForOwner(db, ownerKey, id);
    if (!row) return null;
    const feedback = feedbackRow(row, aiAnswerFeedbackRow, db, aiEvaluationCaseRow);
    const knowledgeService = options.knowledgeService || require('./knowledge.cjs');
    const overview = knowledgeService.inspectKnowledgeOverview(
        options.knowledgeOptions || { dbAccessors: accessors }
    );
    const changesBySource = new Map((overview.changes || []).map(change => [sourceKey(change), change]));
    const checkedSources = feedback.sources.map(source => {
        const change = changesBySource.get(sourceKey(source));
        return {
            ...source,
            currentStatus: change?.status || 'fresh',
            currentTitle: change?.title || source.title,
            currentSummary: change?.summary || '',
        };
    });
    const pendingSources = checkedSources.filter(source => source.currentStatus !== 'fresh');
    const candidateMap = new Map();
    if (checkedSources.length === 0) {
        for (const term of questionSearchTerms(feedback.questionText)) {
            const matches = knowledgeService.searchKnowledgeEntries(
                { query: term, limit: 5 },
                options.knowledgeOptions || { dbAccessors: accessors }
            );
            for (const match of matches) candidateMap.set(match.id, match);
        }
    }
    const candidateSources = [...candidateMap.values()].slice(0, 8);
    let diagnosisType;
    let summary;
    const actions = [];
    if (pendingSources.length > 0) {
        diagnosisType = 'knowledge_outdated';
        summary = `${pendingSources.length} 个回答来源与当前业务数据不一致，需要先同步知识库。`;
        actions.push({ type: 'sync_knowledge', label: '同步知识库' });
    } else if (checkedSources.length === 0 && candidateSources.length > 0) {
        diagnosisType = 'missing_citation';
        summary = `回答没有保存知识来源，但检索到 ${candidateSources.length} 条可能相关的知识，需要核对是否遗漏引用。`;
        actions.push({ type: 'review_candidates', label: '核对候选知识' });
    } else if (checkedSources.length === 0) {
        diagnosisType = 'knowledge_gap';
        summary = '回答没有保存知识来源，也未检索到明确候选条目，可能需要补充业务资料或知识。';
        actions.push({ type: 'add_knowledge', label: '补充业务资料' });
    } else {
        diagnosisType = 'business_review';
        summary = '回答引用的知识目前均为最新，需人工核对源业务数据、回答理解或提示词规则。';
        actions.push({ type: 'review_business_source', label: '核对业务来源' });
    }
    actions.push({ type: 'retest', label: '重新验证' });
    const diagnosis = {
        type: diagnosisType,
        summary,
        checkedAt: new Date().toISOString(),
        knowledgePendingTotal: Number(overview.stats?.pendingTotal || 0),
        checkedSources,
        candidateSources,
        actions,
    };
    const write = safeUpdate('ai_answer_feedback', id, {
        diagnosis_json: JSON.stringify(diagnosis),
        diagnosed_at: diagnosis.checkedAt,
    }, options.auditContext || {});
    options.onWrite?.(write);
    return feedbackRow(
        db.prepare('SELECT * FROM ai_answer_feedback WHERE id = ?').get(id),
        aiAnswerFeedbackRow,
        db,
        aiEvaluationCaseRow
    );
}

function recordAiAnswerFeedbackRetest(ownerKey, idValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate, aiAnswerFeedbackRow, aiEvaluationCaseRow } = accessors;
    const id = parsePositiveId(idValue, '反馈ID');
    if (!feedbackForOwner(db, ownerKey, id)) return null;
    const answerText = normalizeText(input.answerText, 100000, '复测回答');
    if (!answerText) throw new Error('复测回答不能为空');
    const toolResults = Array.isArray(input.toolResults) ? input.toolResults : [];
    const toolResultsJson = JSON.stringify(toolResults);
    if (toolResultsJson.length > 200000) throw new Error('复测工具结果过大');
    const retestSources = collectSources(JSON.stringify({ toolResults }));
    const write = safeUpdate('ai_answer_feedback', id, {
        retest_answer_text: answerText,
        retest_sources_json: JSON.stringify(retestSources),
        retested_at: new Date().toISOString(),
    }, options.auditContext || {});
    options.onWrite?.(write);
    return feedbackRow(
        db.prepare('SELECT * FROM ai_answer_feedback WHERE id = ?').get(id),
        aiAnswerFeedbackRow,
        db,
        aiEvaluationCaseRow
    );
}

module.exports = {
    submitAiAnswerFeedback,
    listAiAnswerFeedback,
    reviewAiAnswerFeedback,
    diagnoseAiAnswerFeedback,
    recordAiAnswerFeedbackRetest,
};
