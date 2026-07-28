const crypto = require('node:crypto');
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

function parseArray(value) {
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function confidenceForEvidence(supportCount, specialCaseCount, ignoredCount) {
    const support = Number(supportCount || 0);
    const specialCases = Number(specialCaseCount || 0);
    const ignored = Number(ignoredCount || 0);
    const weightedTotal = support + ignored + specialCases * 0.5;
    const score = weightedTotal > 0 ? support / weightedTotal : 0;
    const roundedScore = Math.round(score * 1000) / 1000;
    const level = support >= 3 && roundedScore >= 0.8
        ? 'high'
        : support >= 2 && roundedScore >= 0.65
            ? 'medium'
            : 'low';
    return { score: roundedScore, level };
}

function learningEvidenceHash(learningEvidence) {
    const signatures = ['supporting', 'specialCases', 'ignored']
        .flatMap(bucket => parseArray(learningEvidence?.[bucket]).map(item => ({
            bucket,
            recipeId: Number(item.recipeId || 0),
            feedbackId: Number(item.feedbackId || 0),
            decision: item.decision || '',
            note: item.note || '',
            decidedAt: item.decidedAt || item.confirmedAt || null,
        })))
        .sort((left, right) => left.bucket.localeCompare(right.bucket)
            || left.recipeId - right.recipeId
            || left.feedbackId - right.feedbackId);
    return crypto.createHash('sha256').update(JSON.stringify(signatures)).digest('hex');
}

function candidateRow(row) {
    if (!row) return row;
    const evidence = parseArray(row.evidence_json);
    const learningEvidence = parseObject(row.learning_evidence_json);
    const supportCount = Number(row.support_count ?? row.evidence_count ?? evidence.length);
    const specialCaseCount = Number(row.special_case_count || 0);
    const ignoredCount = Number(row.ignored_count || 0);
    const storedScore = Number(row.confidence_score);
    const confidence = confidenceForEvidence(supportCount, specialCaseCount, ignoredCount);
    const confidenceScore = Number.isFinite(storedScore) && storedScore > 0
        ? storedScore
        : confidence.score;
    const approvedAt = row.approved_at || null;
    const learningUpdatedAt = row.learning_updated_at || null;
    const learningHash = row.learning_hash || '';
    const reviewedLearningHash = row.reviewed_learning_hash || '';
    const reviewedLatestEvidence = learningHash && reviewedLearningHash === learningHash;
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
        evidence,
        supportCount,
        specialCaseCount,
        ignoredCount,
        confidenceScore,
        confidenceLevel: confidenceForEvidence(
            supportCount,
            specialCaseCount,
            ignoredCount
        ).level,
        learningEvidence: {
            supporting: parseArray(learningEvidence.supporting).length
                ? parseArray(learningEvidence.supporting)
                : evidence,
            specialCases: parseArray(learningEvidence.specialCases),
            ignored: parseArray(learningEvidence.ignored),
        },
        status: row.status,
        needsReview: row.status === 'approved'
            && (ignoredCount > 0 || confidenceScore < 0.65)
            && !reviewedLatestEvidence,
        reviewNote: row.review_note || '',
        approvedAt,
        learningUpdatedAt,
        learningHash,
        reviewedLearningHash,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function buildRuleCandidateGroups(rows, minimumEvidence = 2) {
    const groups = new Map();
    for (const row of rows || []) {
        if (!['confirmed', 'special_case', 'ignored'].includes(row.decision)
            || row.finding_type !== 'peer_pattern') continue;
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
                supporting: new Map(),
                specialCases: new Map(),
                ignored: new Map(),
            });
        }
        const snapshot = parseObject(row.finding_snapshot_json);
        const bucket = row.decision === 'confirmed'
            ? 'supporting'
            : row.decision === 'special_case'
                ? 'specialCases'
                : 'ignored';
        groups.get(key)[bucket].set(Number(row.recipe_id), {
            recipeId: Number(row.recipe_id),
            recipeName: row.recipe_name || `配方 #${row.recipe_id}`,
            feedbackId: Number(row.id),
            decision: row.decision,
            note: row.note || '',
            findingTitle: snapshot.title || '',
            decidedAt: row.updated_at || row.created_at || null,
            confirmedAt: row.decision === 'confirmed'
                ? row.updated_at || row.created_at || null
                : null,
        });
    }

    return [...groups.values()]
        .map(group => {
            const evidence = [...group.supporting.values()];
            const specialCases = [...group.specialCases.values()];
            const ignored = [...group.ignored.values()];
            const findingTitle = [...evidence, ...specialCases, ...ignored]
                .find(item => item.findingTitle)?.findingTitle
                || group.findingKey.replace(/^peer_pattern:/, '');
            const confidence = confidenceForEvidence(evidence.length, specialCases.length, ignored.length);
            const learningEvidence = { supporting: evidence, specialCases, ignored };
            return {
                ruleKey: group.ruleKey,
                title: `${group.templateName}：${findingTitle}`,
                content: `在泵壳模板「${group.templateName}」下，已有 ${evidence.length} 个不同配方确认“${findingTitle}”，${specialCases.length} 个标记为特殊情况，${ignored.length} 个选择忽略。当前置信度 ${Math.round(confidence.score * 100)}%；创建或编辑同类配方时只作为有证据的复核建议。`,
                scopeType: 'pump_shell_template',
                scopeRef: String(group.templateId),
                findingKey: group.findingKey,
                findingType: group.findingType,
                evidenceCount: evidence.length,
                evidence,
                supportCount: evidence.length,
                specialCaseCount: specialCases.length,
                ignoredCount: ignored.length,
                confidenceScore: confidence.score,
                confidenceLevel: confidence.level,
                learningEvidence,
                learningHash: learningEvidenceHash(learningEvidence),
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
        WHERE feedback.decision IN ('confirmed', 'special_case', 'ignored')
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
            support_count: group.supportCount,
            special_case_count: group.specialCaseCount,
            ignored_count: group.ignoredCount,
            confidence_score: group.confidenceScore,
            learning_evidence_json: JSON.stringify(group.learningEvidence),
            learning_hash: group.learningHash,
            learning_updated_at: now,
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
        SELECT * FROM factory_rule_candidates WHERE status IN ('candidate', 'approved', 'stale')
    `).all();
    for (const row of unmatched) {
        if (activeKeys.has(row.rule_key) || row.status === 'stale') continue;
        update('factory_rule_candidates', row.id, {
            status: 'stale',
            evidence_count: 0,
            support_count: 0,
            special_case_count: 0,
            ignored_count: 0,
            confidence_score: 0,
            evidence_json: '[]',
            learning_evidence_json: '{}',
            learning_hash: '',
            reviewed_learning_hash: '',
            learning_updated_at: now,
        });
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
    if (status === 'approved' && Number(current.support_count ?? current.evidence_count ?? 0) < 2) {
        throw inputError('证据不足，至少需要 2 个不同配方的确认');
    }
    update('factory_rule_candidates', id, {
        status,
        review_note: reviewNote,
        approved_at: status === 'approved' ? new Date().toISOString() : null,
        reviewed_learning_hash: status === 'approved' ? current.learning_hash || '' : '',
    });
    return candidateRow(database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(id));
}

module.exports = {
    buildRuleCandidateGroups,
    confidenceForEvidence,
    learningEvidenceHash,
    listFactoryRuleCandidates,
    refreshFactoryRuleCandidates,
    reviewFactoryRuleCandidate,
};
