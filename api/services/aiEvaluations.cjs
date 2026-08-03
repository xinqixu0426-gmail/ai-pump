function loadDbAccessors() {
    return require('../db.cjs');
}

function normalizeOwnerKey(value) {
    return String(value || 'admin').trim().slice(0, 80) || 'admin';
}

function positiveId(value, label) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) throw new Error(`${label}不合法`);
    return id;
}

function parseJson(value, fallback) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed ?? fallback;
    } catch {
        return fallback;
    }
}

function normalizeText(value, maxLength, label) {
    const text = String(value || '').trim();
    if (text.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符`);
    return text;
}

function caseView(row, adapter) {
    const item = adapter(row);
    return { ...item, config: parseJson(item.configJson, {}) };
}

function resultView(row, adapter) {
    const item = adapter(row);
    return {
        ...item,
        toolResults: parseJson(item.toolResultsJson, []),
        sources: parseJson(item.sourcesJson, []),
        checks: parseJson(item.checksJson, []),
    };
}

function collectEvidence(toolResults) {
    const sources = [];
    const provenance = [];
    const seenSources = new Set();
    for (const tool of toolResults) {
        const result = tool?.result && typeof tool.result === 'object' ? tool.result : {};
        if (result.provenance?.kind) provenance.push(result.provenance);
        for (const source of Array.isArray(result.sources) ? result.sources : []) {
            const key = `${source.knowledgeEntryId || ''}\u0000${source.sourceTable || ''}\u0000${source.sourceId || ''}`;
            if (seenSources.has(key)) continue;
            seenSources.add(key);
            sources.push({
                knowledgeEntryId: Number(source.knowledgeEntryId) || null,
                title: String(source.title || '').slice(0, 200),
                entryType: String(source.entryType || '').slice(0, 60),
                sourceTable: String(source.sourceTable || '').slice(0, 80),
                sourceId: String(source.sourceId || '').slice(0, 120),
                freshness: String(source.freshness || '').slice(0, 40),
                knowledgePath: String(source.knowledgePath || '').slice(0, 300),
                sourcePath: String(source.sourcePath || '').slice(0, 300),
            });
        }
    }
    return { sources: sources.slice(0, 30), provenance };
}

function addCheck(checks, key, label, passed, detail) {
    checks.push({ key, label, passed: Boolean(passed), detail: String(detail || '') });
}

function containsAny(answer, terms) {
    const normalized = normalizeAnswerForChecks(answer);
    return terms.some(term => normalized.includes(normalizeAnswerForChecks(term)));
}

function normalizeAnswerForChecks(value) {
    return String(value || '')
        .replace(/[*_`~]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/\s+/g, '');
}

function containsForbiddenAssertion(answer, termValue) {
    answer = normalizeAnswerForChecks(answer);
    const term = String(termValue);
    let index = answer.indexOf(term);
    while (index >= 0) {
        const sentenceStart = Math.max(
            answer.lastIndexOf('。', index - 1),
            answer.lastIndexOf('！', index - 1),
            answer.lastIndexOf('？', index - 1),
            answer.lastIndexOf('\n', index - 1)
        ) + 1;
        const prefix = answer.slice(sentenceStart, index);
        const negation = /(?:不是|并非|不属于|不应(?:该)?|不能|不会|不可|不得|不宜)([^。！？\n]{0,24})$/.exec(prefix);
        const reversedByPivot = negation
            && /(?:而是|却是|实际(?:上)?是|反而是|应是|属于)/.test(negation[1]);
        if (!negation || reversedByPivot) return true;
        index = answer.indexOf(term, index + term.length);
    }
    return false;
}

function numberPattern(value) {
    const escaped = String(Number(value)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\d.])${escaped}(?:\\.0+)?([^\\d.]|$)`);
}

function evaluateRuleCase(caseItem, answerText, toolResults, db) {
    const answer = String(answerText || '');
    const config = caseItem.config || {};
    const checks = [];
    const evidence = collectEvidence(toolResults);
    const toolNames = new Set(toolResults.map(item => item?.name).filter(Boolean));

    for (const terms of Array.isArray(config.requiredTerms) ? config.requiredTerms : []) {
        const group = Array.isArray(terms) ? terms : [terms];
        addCheck(checks, `required:${group.join('|')}`, `包含 ${group.join(' 或 ')}`, containsAny(answer, group), '回答必须包含至少一个指定词');
    }
    for (const term of Array.isArray(config.forbiddenTerms) ? config.forbiddenTerms : []) {
        const forbiddenAssertion = containsForbiddenAssertion(answer, term);
        addCheck(
            checks,
            `forbidden:${term}`,
            `不得把 ${term} 作为肯定结论`,
            !forbiddenAssertion,
            forbiddenAssertion ? `发现禁用结论：${term}` : '未发现肯定性禁用结论'
        );
    }
    for (const toolName of Array.isArray(config.requiredTools) ? config.requiredTools : []) {
        addCheck(checks, `tool:${toolName}`, `调用 ${toolName}`, toolNames.has(toolName), toolNames.has(toolName) ? '已调用' : '未调用要求的工具');
    }
    for (const sourceTable of Array.isArray(config.requiredSourceTables) ? config.requiredSourceTables : []) {
        const matched = evidence.sources.some(source => source.sourceTable === sourceTable);
        addCheck(checks, `source:${sourceTable}`, `引用 ${sourceTable}`, matched, matched ? '已保存可追溯来源' : '没有保存要求的知识来源');
    }
    if (config.expectedMode) {
        const matched = evidence.provenance.some(item => item.kind === config.expectedMode);
        addCheck(checks, `mode:${config.expectedMode}`, config.expectedMode === 'live_business' ? '使用实时业务数据' : '使用知识库快照', matched, matched ? '数据模式正确' : '数据模式不符合要求');
    }

    if (config.fact?.type === 'part_price') {
        const row = db.prepare(`
            SELECT price FROM parts
            WHERE deleted_at IS NULL AND model = ?
            ORDER BY id DESC LIMIT 1
        `).get(config.fact.model);
        if (!row) {
            addCheck(checks, 'fact:part_price', '核对当前零件价格', false, `零件库没有 ${config.fact.model}`);
        } else {
            const matched = numberPattern(row.price).test(answer);
            addCheck(checks, 'fact:part_price', `回答当前价格 ${Number(row.price)} 元`, matched, matched ? '与零件库当前价格一致' : `回答未包含当前价格 ${Number(row.price)} 元`);
        }
    }

    if (config.fact?.type === 'customer_quotation_count') {
        const customer = db.prepare('SELECT id FROM customers WHERE deleted_at IS NULL AND name = ?').get(config.fact.customerName);
        const quotations = customer
            ? db.prepare('SELECT id FROM quotations WHERE deleted_at IS NULL AND customer_id = ? ORDER BY id').all(customer.id)
            : [];
        const countMatched = new RegExp(`(?:共|现有|找到)?\\s*${quotations.length}\\s*(?:条|份|个)`).test(answer);
        addCheck(checks, 'fact:quotation_count', `回答报价数量 ${quotations.length} 份`, countMatched, countMatched ? '数量正确' : `回答未明确当前共有 ${quotations.length} 份报价`);
        if (config.fact.forbidInternalIds) {
            const exposedIds = quotations
                .map(item => item.id)
                .filter(id => new RegExp(`#\\s*${id}(?!\\d)`).test(answer));
            addCheck(checks, 'fact:no_internal_ids', '不把数据库 ID 当作报价顺序', exposedIds.length === 0, exposedIds.length ? `发现内部编号：${exposedIds.map(id => `#${id}`).join('、')}` : '未暴露内部报价编号');
        }
    }

    return {
        status: checks.length > 0 && checks.every(check => check.passed) ? 'passed' : 'failed',
        checks,
        sources: evidence.sources,
    };
}

function runForOwner(db, ownerKey, runId) {
    return db.prepare(`
        SELECT * FROM ai_evaluation_runs
        WHERE id = ? AND owner_key = ?
    `).get(runId, normalizeOwnerKey(ownerKey));
}

function listAiEvaluationCases(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    return accessors.db.prepare(`
        SELECT * FROM ai_evaluation_cases
        WHERE enabled = 1 AND review_status = 'approved'
        ORDER BY sort_order, id
    `).all().map(row => caseView(row, accessors.aiEvaluationCaseRow));
}

function createAiEvaluationRun(ownerKey, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, safeUpdate, aiEvaluationRunRow } = accessors;
    const execute = () => {
        const cases = listAiEvaluationCases({ dbAccessors: accessors });
        if (cases.length === 0) throw new Error('没有启用的知识库检查用例');
        const now = new Date().toISOString();
        const owner = normalizeOwnerKey(ownerKey);
        const unfinished = db.prepare(`
            SELECT id, total_count FROM ai_evaluation_runs
            WHERE owner_key = ? AND status = 'running'
        `).all(owner);
        unfinished.forEach(run => {
            const write = safeUpdate('ai_evaluation_runs', run.id, {
                status: 'failed',
                review_count: Number(run.total_count || 0),
                completed_at: now,
            }, options.auditContext || {});
            options.onWrite?.(write);
        });
        const info = safeInsert('ai_evaluation_runs', {
            owner_key: owner,
            status: 'running',
            total_count: cases.length,
            passed_count: 0,
            failed_count: 0,
            review_count: 0,
            started_at: now,
            created_at: now,
            updated_at: now,
        }, options.auditContext || {});
        options.onWrite?.(info);
        const run = aiEvaluationRunRow(db.prepare('SELECT * FROM ai_evaluation_runs WHERE id = ?').get(Number(info.lastInsertRowid)));
        return {
            run,
            cases,
            supersededRunIds: unfinished.map(item => Number(item.id)),
        };
    };
    return db.transaction(execute).immediate();
}

function recordAiEvaluationResult(ownerKey, runIdValue, input = {}, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeInsert, aiEvaluationCaseRow, aiEvaluationResultRow } = accessors;
    const runId = positiveId(runIdValue, '运行ID');
    const run = runForOwner(db, ownerKey, runId);
    if (!run) return null;
    if (run.status !== 'running') throw new Error('本次知识库检查已经结束');
    const caseId = positiveId(input.caseId, '用例ID');
    const caseRow = db.prepare('SELECT * FROM ai_evaluation_cases WHERE id = ? AND enabled = 1').get(caseId);
    if (!caseRow) throw new Error('检查用例不存在');
    if (db.prepare('SELECT 1 FROM ai_evaluation_results WHERE run_id = ? AND case_id = ?').get(runId, caseId)) {
        throw new Error('该检查用例已经记录结果');
    }
    const answerText = normalizeText(input.answerText, 100000, 'AI 回答');
    const errorText = normalizeText(input.errorText, 1000, '错误信息');
    const toolResults = Array.isArray(input.toolResults) ? input.toolResults : [];
    const toolResultsJson = JSON.stringify(toolResults);
    if (toolResultsJson.length > 200000) throw new Error('工具结果过大');
    const caseItem = caseView(caseRow, aiEvaluationCaseRow);
    const evaluated = errorText || !answerText
        ? {
            status: 'review',
            checks: [{ key: 'execution', label: 'AI 查询执行成功', passed: false, detail: errorText || '没有返回回答' }],
            sources: [],
        }
        : evaluateRuleCase(caseItem, answerText, toolResults, db);
    const now = new Date().toISOString();
    const info = safeInsert('ai_evaluation_results', {
        run_id: runId,
        case_id: caseId,
        status: evaluated.status,
        answer_text: answerText,
        tool_results_json: toolResultsJson,
        sources_json: JSON.stringify(evaluated.sources),
        checks_json: JSON.stringify(evaluated.checks),
        error_text: errorText,
        created_at: now,
        updated_at: now,
    }, options.auditContext || {});
    options.onWrite?.(info);
    return resultView(db.prepare('SELECT * FROM ai_evaluation_results WHERE id = ?').get(Number(info.lastInsertRowid)), aiEvaluationResultRow);
}

function completeAiEvaluationRun(ownerKey, runIdValue, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, safeUpdate, aiEvaluationRunRow } = accessors;
    const runId = positiveId(runIdValue, '运行ID');
    const run = runForOwner(db, ownerKey, runId);
    if (!run) return null;
    const counts = db.prepare(`
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'passed' THEN 1 ELSE 0 END) AS passed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) AS review
        FROM ai_evaluation_results WHERE run_id = ?
    `).get(runId);
    const expected = Number(run.total_count || 0);
    const missing = Math.max(expected - Number(counts.total || 0), 0);
    const write = safeUpdate('ai_evaluation_runs', runId, {
        status: missing > 0 ? 'failed' : 'completed',
        passed_count: Number(counts.passed || 0),
        failed_count: Number(counts.failed || 0),
        review_count: Number(counts.review || 0) + missing,
        completed_at: new Date().toISOString(),
    }, options.auditContext || {});
    options.onWrite?.(write);
    return aiEvaluationRunRow(db.prepare('SELECT * FROM ai_evaluation_runs WHERE id = ?').get(runId));
}

function getAiEvaluationOverview(ownerKey, options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, aiEvaluationRunRow, aiEvaluationResultRow } = accessors;
    const cases = listAiEvaluationCases({ dbAccessors: accessors });
    const feedbackCases = require('./aiRegressionCases.cjs').listFeedbackEvaluationCases({
        dbAccessors: accessors,
    });
    const caseStats = {
        enabled: cases.length,
        feedbackTotal: feedbackCases.length,
        feedbackApproved: feedbackCases.filter(item => item.reviewStatus === 'approved').length,
        feedbackPending: feedbackCases.filter(item => item.reviewStatus === 'pending').length,
        feedbackRejected: feedbackCases.filter(item => item.reviewStatus === 'rejected').length,
    };
    const latestRunRow = db.prepare(`
        SELECT * FROM ai_evaluation_runs
        WHERE owner_key = ?
        ORDER BY id DESC LIMIT 1
    `).get(normalizeOwnerKey(ownerKey));
    if (!latestRunRow) return { cases, feedbackCases, caseStats, latestRun: null, results: [] };
    const latestRun = aiEvaluationRunRow(latestRunRow);
    const results = db.prepare(`
        SELECT result.*, evaluation_case.title AS case_title, evaluation_case.category AS case_category
        FROM ai_evaluation_results AS result
        JOIN ai_evaluation_cases AS evaluation_case ON evaluation_case.id = result.case_id
        WHERE result.run_id = ?
        ORDER BY evaluation_case.sort_order, evaluation_case.id
    `).all(latestRun.id).map(row => ({
        ...resultView(row, aiEvaluationResultRow),
        caseTitle: row.case_title,
        caseCategory: row.case_category,
    }));
    return { cases, feedbackCases, caseStats, latestRun, results };
}

function getLatestAiEvaluationHealth(options = {}) {
    const accessors = options.dbAccessors || loadDbAccessors();
    const { db, aiEvaluationRunRow, aiEvaluationResultRow } = accessors;
    const latestRunRow = db.prepare(`
        SELECT * FROM ai_evaluation_runs
        ORDER BY id DESC LIMIT 1
    `).get();
    if (!latestRunRow) {
        return {
            status: 'not_run',
            healthy: true,
            latestRun: null,
            issues: [],
        };
    }
    const latestRun = aiEvaluationRunRow(latestRunRow);
    if (latestRun.status === 'running') {
        return {
            status: 'running',
            healthy: true,
            latestRun,
            issues: [],
        };
    }
    const issueRows = db.prepare(`
        SELECT result.*, evaluation_case.title AS case_title, evaluation_case.category AS case_category
        FROM ai_evaluation_results AS result
        JOIN ai_evaluation_cases AS evaluation_case ON evaluation_case.id = result.case_id
        WHERE result.run_id = ? AND result.status IN ('failed', 'review')
        ORDER BY CASE result.status WHEN 'failed' THEN 0 ELSE 1 END,
                 evaluation_case.sort_order,
                 evaluation_case.id
    `).all(latestRun.id);
    const issues = issueRows.map(row => ({
        ...resultView(row, aiEvaluationResultRow),
        caseTitle: row.case_title,
        caseCategory: row.case_category,
    }));
    const healthy = latestRun.status === 'completed'
        && Number(latestRun.failedCount || 0) === 0
        && Number(latestRun.reviewCount || 0) === 0;
    return {
        status: healthy ? 'healthy' : 'attention',
        healthy,
        latestRun,
        issues,
    };
}

module.exports = {
    listAiEvaluationCases,
    createAiEvaluationRun,
    recordAiEvaluationResult,
    completeAiEvaluationRun,
    getAiEvaluationOverview,
    getLatestAiEvaluationHealth,
    evaluateRuleCase,
    reviewFeedbackEvaluationCase: require('./aiRegressionCases.cjs').reviewFeedbackEvaluationCase,
};
