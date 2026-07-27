const { parsePositiveId } = require('./validation.cjs');

const REVIEW_STATUSES = new Set(['candidate', 'approved', 'rejected']);

function inputError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function loadDbAccessors() {
    return require('../db.cjs');
}

function parseObject(value) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function candidateRow(row) {
    if (!row) return row;
    return {
        id: row.id,
        ruleKey: row.rule_key,
        title: row.title,
        content: row.content,
        scopeType: row.scope_type,
        scopeRef: row.scope_ref,
        findingKey: row.finding_key,
        findingType: row.finding_type,
        evidenceCount: Number(row.evidence_count || 0),
        evidence: (() => {
            try {
                const parsed = JSON.parse(row.evidence_json || '[]');
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        })(),
        status: row.status,
        reviewNote: row.review_note || '',
        approvedAt: row.approved_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function buildRuleCandidateGroups(rows, minimumEvidence = 2) {
    const groups = new Map();
    for (const row of rows || []) {
        if (row.decision !== 'confirmed' || row.finding_type !== 'peer_pattern') continue;
        const templateId = Number(row.template_id || 0);
        if (!templateId || !row.finding_key) continue;
        const key = `template:${templateId}:${row.finding_key}`;
        if (!groups.has(key)) {
            groups.set(key, {
                ruleKey: key,
                templateId,
                templateName: row.template_name || `模板 #${templateId}`,
                findingKey: row.finding_key,
                findingType: row.finding_type,
                evidence: new Map(),
            });
        }
        const snapshot = parseObject(row.finding_snapshot_json);
        groups.get(key).evidence.set(Number(row.recipe_id), {
            recipeId: Number(row.recipe_id),
            recipeName: row.recipe_name || `配方 #${row.recipe_id}`,
            feedbackId: Number(row.id),
            note: row.note || '',
            findingTitle: snapshot.title || '',
            confirmedAt: row.updated_at || row.created_at || null,
        });
    }

    return [...groups.values()]
        .map(group => {
            const evidence = [...group.evidence.values()];
            const findingTitle = evidence.find(item => item.findingTitle)?.findingTitle
                || group.findingKey.replace(/^peer_pattern:/, '');
            return {
                ruleKey: group.ruleKey,
                title: `${group.templateName}：${findingTitle}`,
                content: `在泵壳模板「${group.templateName}」下，已有 ${evidence.length} 个不同配方确认“${findingTitle}”。创建或编辑同类配方时应重点复核该项；客户定制差异仍可标记为特殊情况。`,
                scopeType: 'pump_shell_template',
                scopeRef: String(group.templateId),
                findingKey: group.findingKey,
                findingType: group.findingType,
                evidenceCount: evidence.length,
                evidence,
            };
        })
        .filter(group => group.evidenceCount >= minimumEvidence)
        .sort((left, right) => right.evidenceCount - left.evidenceCount || left.title.localeCompare(right.title, 'zh-CN'));
}

function feedbackEvidenceRows(database) {
    return database.prepare(`
        SELECT feedback.*, recipes.name AS recipe_name, recipes.template_id,
               templates.shell_model AS template_name
        FROM recipe_analysis_feedback feedback
        JOIN recipes ON recipes.id = feedback.recipe_id AND recipes.deleted_at IS NULL
        LEFT JOIN pump_shell_templates templates ON templates.id = recipes.template_id
        WHERE feedback.decision = 'confirmed'
          AND feedback.finding_type = 'peer_pattern'
        ORDER BY feedback.updated_at DESC, feedback.id DESC
    `).all();
}

function listFactoryRuleCandidates(options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const status = options.status ? String(options.status) : '';
    if (status && !new Set(['candidate', 'approved', 'rejected', 'stale']).has(status)) {
        throw inputError('status 无效');
    }
    const rows = status
        ? database.prepare('SELECT * FROM factory_rule_candidates WHERE status = ? ORDER BY updated_at DESC, id DESC').all(status)
        : database.prepare('SELECT * FROM factory_rule_candidates ORDER BY updated_at DESC, id DESC').all();
    return rows.map(candidateRow);
}

function refreshFactoryRuleCandidates(options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const insert = options.safeInsert || accessors.safeInsert;
    const update = options.safeUpdate || accessors.safeUpdate;
    const groups = buildRuleCandidateGroups(feedbackEvidenceRows(database), options.minimumEvidence || 2);
    const activeKeys = new Set(groups.map(group => group.ruleKey));
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    let stale = 0;

    for (const group of groups) {
        const current = database.prepare('SELECT * FROM factory_rule_candidates WHERE rule_key = ?').get(group.ruleKey);
        const values = {
            title: group.title,
            content: group.content,
            scope_type: group.scopeType,
            scope_ref: group.scopeRef,
            finding_key: group.findingKey,
            finding_type: group.findingType,
            evidence_count: group.evidenceCount,
            evidence_json: JSON.stringify(group.evidence),
        };
        if (current) {
            if (current.status === 'stale') values.status = 'candidate';
            update('factory_rule_candidates', current.id, values);
            updated += 1;
        } else {
            insert('factory_rule_candidates', {
                rule_key: group.ruleKey,
                ...values,
                status: 'candidate',
                review_note: '',
                created_at: now,
                updated_at: now,
            });
            created += 1;
        }
    }

    const unmatched = database.prepare(`
        SELECT * FROM factory_rule_candidates WHERE status IN ('candidate', 'stale')
    `).all();
    for (const row of unmatched) {
        if (activeKeys.has(row.rule_key) || row.status === 'stale') continue;
        update('factory_rule_candidates', row.id, { status: 'stale', evidence_count: 0 });
        stale += 1;
    }

    return {
        generatedAt: now,
        minimumEvidence: options.minimumEvidence || 2,
        stats: { created, updated, stale, active: groups.length },
        candidates: listFactoryRuleCandidates({ db: database }),
    };
}

function reviewFactoryRuleCandidate(idValue, input = {}, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const update = options.safeUpdate || accessors.safeUpdate;
    const id = parsePositiveId(idValue);
    if (!id) throw inputError('候选规则 ID 必须是正整数');
    const status = String(input.status || '').trim();
    if (!REVIEW_STATUSES.has(status)) throw inputError('status 必须是 candidate、approved 或 rejected');
    const reviewNote = String(input.reviewNote || '').trim();
    if (reviewNote.length > 500) throw inputError('reviewNote 不能超过 500 个字符');
    const current = database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(id);
    if (!current) {
        const error = new Error('候选规则不存在');
        error.statusCode = 404;
        throw error;
    }
    if (status === 'approved' && Number(current.evidence_count || 0) < 2) {
        throw inputError('证据不足，至少需要 2 个不同配方的确认');
    }
    update('factory_rule_candidates', id, {
        status,
        review_note: reviewNote,
        approved_at: status === 'approved' ? new Date().toISOString() : null,
    });
    return candidateRow(database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(id));
}

module.exports = {
    buildRuleCandidateGroups,
    listFactoryRuleCandidates,
    refreshFactoryRuleCandidates,
    reviewFactoryRuleCandidate,
};
