const crypto = require('node:crypto');
const { parsePositiveId } = require('./validation.cjs');
const { partRole } = require('./recipeIntelligence.cjs');

const REVIEW_STATUSES = new Set(['candidate', 'approved', 'rejected']);
const MINIMUM_APPROVAL_SUPPORT = 2;
const MINIMUM_APPROVAL_CONFIDENCE = 0.65;

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

function factoryRuleApprovalGate(supportCountValue, confidenceScoreValue) {
    const supportCount = Number(supportCountValue || 0);
    const confidenceScore = Number(confidenceScoreValue || 0);
    const blockers = [];
    if (supportCount < MINIMUM_APPROVAL_SUPPORT) {
        blockers.push(`至少需要 ${MINIMUM_APPROVAL_SUPPORT} 个不同配方确认`);
    }
    if (confidenceScore < MINIMUM_APPROVAL_CONFIDENCE) {
        blockers.push(`当前置信度 ${Math.round(confidenceScore * 100)}%，低于 ${Math.round(MINIMUM_APPROVAL_CONFIDENCE * 100)}%`);
    }
    return {
        eligible: blockers.length === 0,
        blockers,
        minimumSupport: MINIMUM_APPROVAL_SUPPORT,
        minimumConfidence: MINIMUM_APPROVAL_CONFIDENCE,
    };
}

function learningEvidenceHash(learningEvidence) {
    const signatures = ['supporting', 'specialCases', 'ignored', 'drifted', 'outdated']
        .flatMap(bucket => parseArray(learningEvidence?.[bucket]).map(item => ({
            bucket,
            recipeId: Number(item.recipeId || 0),
            feedbackId: Number(item.feedbackId || 0),
            decision: item.decision || '',
            note: item.note || '',
            templateIdAtDecision: Number(item.templateIdAtDecision || 0),
            currentTemplateId: Number(item.currentTemplateId || 0),
            scopeDrift: Boolean(item.scopeDrift),
            recipeUpdatedAtAtDecision: item.recipeUpdatedAtAtDecision || null,
            currentRecipeUpdatedAt: item.currentRecipeUpdatedAt || null,
            contentOutdated: Boolean(item.contentOutdated),
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
    const driftedCount = parseArray(learningEvidence.drifted).length;
    const outdatedCount = parseArray(learningEvidence.outdated).length;
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
    const approvalGate = factoryRuleApprovalGate(supportCount, confidenceScore);
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
        driftedCount,
        outdatedCount,
        confidenceScore,
        confidenceLevel: confidenceForEvidence(
            supportCount,
            specialCaseCount,
            ignoredCount
        ).level,
        approvalEligible: approvalGate.eligible,
        approvalBlockers: approvalGate.blockers,
        approvalRequirements: {
            minimumSupport: approvalGate.minimumSupport,
            minimumConfidence: approvalGate.minimumConfidence,
        },
        learningEvidence: {
            supporting: parseArray(learningEvidence.supporting).length
                ? parseArray(learningEvidence.supporting)
                : evidence,
            specialCases: parseArray(learningEvidence.specialCases),
            ignored: parseArray(learningEvidence.ignored),
            drifted: parseArray(learningEvidence.drifted),
            outdated: parseArray(learningEvidence.outdated),
        },
        status: row.status,
        needsReview: row.status === 'approved'
            && (ignoredCount > 0 || driftedCount > 0 || outdatedCount > 0)
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

function eventRow(row) {
    if (!row) return row;
    return {
        id: Number(row.id),
        candidateId: Number(row.candidate_id),
        ruleKey: row.rule_key,
        ruleTitle: row.rule_title || '',
        eventType: row.event_type,
        previousStatus: row.previous_status || null,
        newStatus: row.new_status || null,
        actor: row.actor || 'system',
        note: row.note || '',
        snapshot: parseObject(row.snapshot_json),
        createdAt: row.created_at,
    };
}

function recordFactoryRuleEvent(candidate, eventType, details = {}, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const insert = options.safeInsert || accessors.safeInsert;
    if (typeof insert !== 'function') throw new Error('规则事件写入器不可用');
    const now = details.createdAt || new Date().toISOString();
    const write = insert('factory_rule_events', {
        candidate_id: Number(candidate.id),
        rule_key: candidate.ruleKey,
        event_type: eventType,
        previous_status: details.previousStatus || null,
        new_status: details.newStatus || candidate.status || null,
        actor: String(details.actor || options.actor || 'system').slice(0, 100),
        note: String(details.note || '').slice(0, 500),
        snapshot_json: JSON.stringify(details.snapshot || candidate),
        created_at: now,
    }, options.auditContext || {});
    options.onWrite?.(write);
}

function listFactoryRuleEvents(options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const candidateId = options.candidateId === undefined || options.candidateId === ''
        ? null
        : parsePositiveId(options.candidateId);
    if (options.candidateId !== undefined && options.candidateId !== '' && !candidateId) {
        throw inputError('候选规则 ID 必须是正整数');
    }
    let limit = 30;
    if (options.limit !== undefined && options.limit !== '') {
        const parsedLimit = Number(options.limit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
            throw inputError('limit 必须是 1 到 100 的整数');
        }
        limit = parsedLimit;
    }
    const rows = candidateId
        ? database.prepare(`
            SELECT event.*, candidate.title AS rule_title
            FROM factory_rule_events event
            LEFT JOIN factory_rule_candidates candidate ON candidate.id = event.candidate_id
            WHERE event.candidate_id = ?
            ORDER BY event.created_at DESC, event.id DESC
            LIMIT ?
        `).all(candidateId, limit)
        : database.prepare(`
            SELECT event.*, candidate.title AS rule_title
            FROM factory_rule_events event
            LEFT JOIN factory_rule_candidates candidate ON candidate.id = event.candidate_id
            ORDER BY event.created_at DESC, event.id DESC
            LIMIT ?
        `).all(limit);
    return rows.map(eventRow);
}

function buildRuleCandidateGroups(rows, minimumEvidence = 2) {
    const groups = new Map();
    for (const row of rows || []) {
        if (!['confirmed', 'special_case', 'ignored'].includes(row.decision)
            || row.finding_type !== 'peer_pattern') continue;
        const snapshot = parseObject(row.finding_snapshot_json);
        const evidenceContext = parseObject(snapshot.evidenceContext);
        const currentTemplateId = Number(row.template_id || 0);
        const templateIdAtDecision = Number(evidenceContext.templateId || 0);
        const templateId = templateIdAtDecision || currentTemplateId;
        if (!templateId || !row.finding_key) continue;
        const key = `template:${templateId}:${row.finding_key}`;
        if (!groups.has(key)) {
            groups.set(key, {
                ruleKey: key,
                templateId,
                templateName: evidenceContext.templateName || row.template_name || `模板 #${templateId}`,
                findingKey: row.finding_key,
                findingType: row.finding_type,
                supporting: new Map(),
                specialCases: new Map(),
                ignored: new Map(),
                drifted: new Map(),
                outdated: new Map(),
            });
        }
        const scopeDrift = Boolean(templateIdAtDecision && templateIdAtDecision !== currentTemplateId);
        const recipeUpdatedAtAtDecision = String(evidenceContext.recipeUpdatedAt || '').trim();
        const currentRecipeUpdatedAt = String(row.recipe_updated_at || '').trim();
        const contentOutdated = Boolean(
            !scopeDrift
            && recipeUpdatedAtAtDecision
            && currentRecipeUpdatedAt
            && recipeUpdatedAtAtDecision !== currentRecipeUpdatedAt
        );
        const bucket = scopeDrift
            ? 'drifted'
            : contentOutdated
                ? 'outdated'
            : row.decision === 'confirmed'
            ? 'supporting'
            : row.decision === 'special_case'
                ? 'specialCases'
                : 'ignored';
        groups.get(key)[bucket].set(Number(row.recipe_id), {
            recipeId: Number(row.recipe_id),
            recipeName: evidenceContext.recipeName || row.recipe_name || `配方 #${row.recipe_id}`,
            feedbackId: Number(row.id),
            decision: row.decision,
            note: row.note || '',
            findingTitle: snapshot.title || '',
            templateIdAtDecision: templateIdAtDecision || currentTemplateId,
            templateNameAtDecision: evidenceContext.templateName || row.template_name || '',
            currentTemplateId,
            currentTemplateName: row.template_name || '',
            scopeDrift,
            recipeUpdatedAtAtDecision: recipeUpdatedAtAtDecision || null,
            currentRecipeUpdatedAt: currentRecipeUpdatedAt || null,
            contentOutdated,
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
            const drifted = [...group.drifted.values()];
            const outdated = [...group.outdated.values()];
            const findingTitle = [...evidence, ...specialCases, ...ignored, ...drifted, ...outdated]
                .find(item => item.findingTitle)?.findingTitle
                || group.findingKey.replace(/^peer_pattern:/, '');
            const confidence = confidenceForEvidence(evidence.length, specialCases.length, ignored.length);
            const learningEvidence = { supporting: evidence, specialCases, ignored, drifted, outdated };
            const driftSummary = drifted.length > 0
                ? `另有 ${drifted.length} 条历史证据因配方已更换泵壳模板而不计入当前规则。`
                : '';
            const outdatedSummary = outdated.length > 0
                ? `另有 ${outdated.length} 条历史证据因配方内容已修改而过期，需重新智能检查。`
                : '';
            return {
                ruleKey: group.ruleKey,
                title: `${group.templateName}：${findingTitle}`,
                content: `在泵壳模板「${group.templateName}」下，已有 ${evidence.length} 个不同配方确认“${findingTitle}”，${specialCases.length} 个标记为特殊情况，${ignored.length} 个选择忽略。${driftSummary}${outdatedSummary}当前置信度 ${Math.round(confidence.score * 100)}%；创建或编辑同类配方时只作为有证据的复核建议。`,
                scopeType: 'pump_shell_template',
                scopeRef: String(group.templateId),
                findingKey: group.findingKey,
                findingType: group.findingType,
                evidenceCount: evidence.length,
                evidence,
                supportCount: evidence.length,
                specialCaseCount: specialCases.length,
                ignoredCount: ignored.length,
                driftedCount: drifted.length,
                outdatedCount: outdated.length,
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
               recipes.updated_at AS recipe_updated_at,
               templates.shell_model AS template_name
        FROM recipe_analysis_feedback feedback
        JOIN recipes ON recipes.id = feedback.recipe_id AND recipes.deleted_at IS NULL
        LEFT JOIN pump_shell_templates templates ON templates.id = recipes.template_id
        WHERE feedback.decision IN ('confirmed', 'special_case', 'ignored')
          AND feedback.finding_type = 'peer_pattern'
        ORDER BY feedback.updated_at DESC, feedback.id DESC
    `).all();
}

function buildFactoryLearningHealth(options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    let limit = 100;
    if (options.limit !== undefined && options.limit !== '') {
        const parsedLimit = Number(options.limit);
        if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
            throw inputError('limit 必须是 1 到 200 的整数');
        }
        limit = parsedLimit;
    }
    const rows = database.prepare(`
        SELECT feedback.*,
               recipes.id AS current_recipe_id,
               recipes.name AS recipe_name,
               recipes.template_id AS current_template_id,
               recipes.updated_at AS current_recipe_updated_at,
               recipes.deleted_at AS recipe_deleted_at,
               templates.shell_model AS current_template_name
        FROM recipe_analysis_feedback feedback
        LEFT JOIN recipes ON recipes.id = feedback.recipe_id
        LEFT JOIN pump_shell_templates templates ON templates.id = recipes.template_id
        WHERE feedback.decision IN ('confirmed', 'special_case', 'ignored')
          AND feedback.finding_type = 'peer_pattern'
        ORDER BY feedback.updated_at DESC, feedback.id DESC
    `).all();

    const items = rows.map(row => {
        const snapshot = parseObject(row.finding_snapshot_json);
        const evidenceContext = parseObject(snapshot.evidenceContext);
        const templateIdAtDecision = Number(evidenceContext.templateId || 0) || null;
        const currentTemplateId = Number(row.current_template_id || 0) || null;
        const recipeUpdatedAtAtDecision = String(evidenceContext.recipeUpdatedAt || '').trim() || null;
        const currentRecipeUpdatedAt = String(row.current_recipe_updated_at || '').trim() || null;
        const archived = Boolean(row.recipe_deleted_at || !row.current_recipe_id);
        const scopeDrift = Boolean(
            !archived
            && templateIdAtDecision
            && templateIdAtDecision !== currentTemplateId
        );
        const contentOutdated = Boolean(
            !archived
            && !scopeDrift
            && recipeUpdatedAtAtDecision
            && currentRecipeUpdatedAt
            && recipeUpdatedAtAtDecision !== currentRecipeUpdatedAt
        );
        const status = archived
            ? 'archived'
            : scopeDrift
                ? 'drifted'
                : contentOutdated
                    ? 'outdated'
                    : 'active';
        const reason = status === 'archived'
            ? '配方已归档，这条历史反馈不再参与当前规则学习'
            : status === 'drifted'
                ? '配方已更换泵壳模板，需要按当前模板重新智能检查'
                : status === 'outdated'
                    ? '配方内容在反馈后被修改，需要按当前配置重新智能检查'
                    : '反馈仍对应当前配方版本';
        return {
            feedbackId: Number(row.id),
            recipeId: Number(row.recipe_id),
            recipeName: row.recipe_name || evidenceContext.recipeName || `配方 #${row.recipe_id}`,
            findingKey: row.finding_key,
            findingType: row.finding_type,
            findingTitle: snapshot.title || row.finding_key.replace(/^peer_pattern:/, ''),
            decision: row.decision,
            note: row.note || '',
            status,
            reason,
            needsRecheck: status === 'drifted' || status === 'outdated',
            templateIdAtDecision,
            templateNameAtDecision: evidenceContext.templateName || '',
            currentTemplateId,
            currentTemplateName: row.current_template_name || '',
            recipeUpdatedAtAtDecision,
            currentRecipeUpdatedAt,
            legacyContext: !templateIdAtDecision || !recipeUpdatedAtAtDecision,
            decidedAt: row.updated_at || row.created_at || null,
        };
    });
    const statusRank = { outdated: 0, drifted: 1, archived: 2, active: 3 };
    items.sort((left, right) => {
        const rankDifference = statusRank[left.status] - statusRank[right.status];
        if (rankDifference !== 0) return rankDifference;
        return String(right.decidedAt || '').localeCompare(String(left.decidedAt || ''));
    });
    const needsRecheck = items.filter(item => item.needsRecheck);
    const statusCount = status => items.filter(item => item.status === status).length;
    const affectedRecipeIds = new Set(needsRecheck.map(item => item.recipeId));

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            totalEvidenceCount: items.length,
            activeEvidenceCount: statusCount('active'),
            recheckEvidenceCount: needsRecheck.length,
            outdatedEvidenceCount: statusCount('outdated'),
            driftedEvidenceCount: statusCount('drifted'),
            archivedEvidenceCount: statusCount('archived'),
            affectedRecipeCount: affectedRecipeIds.size,
            confirmedCount: items.filter(item => item.decision === 'confirmed').length,
            specialCaseCount: items.filter(item => item.decision === 'special_case').length,
            ignoredCount: items.filter(item => item.decision === 'ignored').length,
        },
        items: items.slice(0, limit),
        guidance: needsRecheck.length > 0
            ? `有 ${affectedRecipeIds.size} 个配方的 ${needsRecheck.length} 条学习反馈需要重新检查；旧反馈已停止影响规则，不会自动修改配方。`
            : '当前学习反馈均对应有效配方版本，没有需要重新检查的证据。',
    };
}

function currentRuleLearningGroup(database, ruleKey) {
    return buildRuleCandidateGroups(feedbackEvidenceRows(database), 0)
        .find(group => group.ruleKey === ruleKey) || null;
}

function ruleLearningValues(group, now) {
    if (!group) {
        return {
            evidence_count: 0,
            evidence_json: '[]',
            support_count: 0,
            special_case_count: 0,
            ignored_count: 0,
            confidence_score: 0,
            learning_evidence_json: '{}',
            learning_hash: '',
            learning_updated_at: now,
        };
    }
    return {
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

function buildFactoryRuleImpact(idValue, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const id = parsePositiveId(idValue);
    if (!id) throw inputError('候选规则 ID 必须是正整数');

    const row = database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(id);
    if (!row) {
        const error = new Error('候选规则不存在');
        error.statusCode = 404;
        throw error;
    }

    const candidate = candidateRow(row);
    const templateId = Number(candidate.scopeRef || 0);
    const role = candidate.findingKey.startsWith('peer_pattern:')
        ? candidate.findingKey.slice('peer_pattern:'.length)
        : '';
    if (candidate.scopeType !== 'pump_shell_template' || !templateId || !role) {
        throw inputError('当前规则不支持配方影响分析');
    }

    const recipes = database.prepare(`
        SELECT id, name, spec, parts_json, updated_at
        FROM recipes
        WHERE template_id = ? AND deleted_at IS NULL
        ORDER BY name, id
    `).all(templateId);
    const feedbackRows = database.prepare(`
        SELECT feedback.recipe_id, feedback.decision, feedback.note, feedback.updated_at,
               feedback.finding_snapshot_json, recipes.updated_at AS recipe_updated_at
        FROM recipe_analysis_feedback feedback
        JOIN recipes ON recipes.id = feedback.recipe_id
        WHERE recipes.template_id = ?
          AND recipes.deleted_at IS NULL
          AND feedback.finding_key = ?
        ORDER BY feedback.updated_at DESC, feedback.id DESC
    `).all(templateId, candidate.findingKey);
    const feedbackByRecipe = new Map();
    for (const feedback of feedbackRows) {
        const recipeId = Number(feedback.recipe_id);
        if (!feedbackByRecipe.has(recipeId)) feedbackByRecipe.set(recipeId, feedback);
    }

    const groups = {
        compliant: [],
        needsReview: [],
        specialCases: [],
        ignored: [],
    };
    for (const recipe of recipes) {
        const recipeRoles = new Set(parseArray(recipe.parts_json).map(partRole).filter(Boolean));
        const hasRequiredRole = recipeRoles.has(role);
        const feedback = feedbackByRecipe.get(Number(recipe.id));
        const feedbackSnapshot = parseObject(feedback?.finding_snapshot_json);
        const feedbackContext = parseObject(feedbackSnapshot.evidenceContext);
        const feedbackRecipeUpdatedAt = String(feedbackContext.recipeUpdatedAt || '').trim();
        const currentRecipeUpdatedAt = String(recipe.updated_at || '').trim();
        const feedbackOutdated = Boolean(
            feedbackRecipeUpdatedAt
            && currentRecipeUpdatedAt
            && feedbackRecipeUpdatedAt !== currentRecipeUpdatedAt
        );
        const effectiveDecision = feedbackOutdated ? 'review' : feedback?.decision || 'review';
        const item = {
            recipeId: Number(recipe.id),
            recipeName: recipe.name || `配方 #${recipe.id}`,
            spec: recipe.spec || '',
            hasRequiredRole,
            decision: effectiveDecision,
            originalDecision: feedback?.decision || 'review',
            note: feedback?.note || '',
            feedbackUpdatedAt: feedback?.updated_at || null,
            recipeUpdatedAt: recipe.updated_at || null,
            feedbackOutdated,
        };
        if (hasRequiredRole) {
            groups.compliant.push(item);
        } else if (effectiveDecision === 'special_case') {
            groups.specialCases.push(item);
        } else if (effectiveDecision === 'ignored') {
            groups.ignored.push(item);
        } else {
            groups.needsReview.push(item);
        }
    }

    const totalRecipes = recipes.length;
    const needsReviewCount = groups.needsReview.length;
    return {
        generatedAt: new Date().toISOString(),
        candidate,
        scope: {
            templateId,
            templateName: candidate.title.split('：')[0] || `模板 #${templateId}`,
            requiredRole: role,
        },
        summary: {
            totalRecipes,
            compliantCount: groups.compliant.length,
            needsReviewCount,
            specialCaseCount: groups.specialCases.length,
            ignoredCount: groups.ignored.length,
            outdatedFeedbackCount: groups.needsReview.filter(item => item.feedbackOutdated).length,
            attentionRate: totalRecipes > 0
                ? Math.round(needsReviewCount / totalRecipes * 1000) / 1000
                : 0,
        },
        groups,
        guidance: needsReviewCount > 0
            ? `批准后将有 ${needsReviewCount} 个现有配方需要复核“${role.replace(/^包装:/, '')}”，系统不会自动修改这些配方。`
            : `当前同模板配方均已符合或已有明确例外，批准后不会产生新的待复核配方。`,
    };
}

function buildFactoryRuleCompliance(options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const approvedCandidates = listFactoryRuleCandidates({ db: database, status: 'approved' });
    const rules = approvedCandidates.map(candidate => {
        const impact = buildFactoryRuleImpact(candidate.id, { db: database });
        return {
            candidate,
            scope: impact.scope,
            summary: impact.summary,
            groups: impact.groups,
            status: impact.summary.needsReviewCount > 0 ? 'attention' : 'compliant',
            guidance: impact.guidance,
        };
    });
    const affectedRecipes = new Map();
    for (const rule of rules) {
        for (const recipe of rule.groups.needsReview) {
            const current = affectedRecipes.get(recipe.recipeId) || {
                recipeId: recipe.recipeId,
                recipeName: recipe.recipeName,
                spec: recipe.spec,
                ruleIds: [],
                ruleTitles: [],
            };
            current.ruleIds.push(rule.candidate.id);
            current.ruleTitles.push(rule.candidate.title);
            affectedRecipes.set(recipe.recipeId, current);
        }
    }

    const ruleViolationCount = rules.reduce(
        (total, rule) => total + rule.summary.needsReviewCount,
        0
    );
    const exceptionCount = rules.reduce(
        (total, rule) => total + rule.summary.specialCaseCount + rule.summary.ignoredCount,
        0
    );
    return {
        generatedAt: new Date().toISOString(),
        summary: {
            approvedRuleCount: rules.length,
            rulesWithViolations: rules.filter(rule => rule.summary.needsReviewCount > 0).length,
            rulesNeedingEvidenceReview: rules.filter(rule => rule.candidate.needsReview).length,
            affectedRecipeCount: affectedRecipes.size,
            ruleViolationCount,
            exceptionCount,
            checkedRecipeRulePairs: rules.reduce(
                (total, rule) => total + rule.summary.totalRecipes,
                0
            ),
        },
        affectedRecipes: [...affectedRecipes.values()]
            .sort((left, right) => right.ruleIds.length - left.ruleIds.length
                || left.recipeName.localeCompare(right.recipeName, 'zh-CN')),
        rules: rules.sort((left, right) => right.summary.needsReviewCount - left.summary.needsReviewCount
            || left.candidate.title.localeCompare(right.candidate.title, 'zh-CN')),
        guidance: ruleViolationCount > 0
            ? `发现 ${affectedRecipes.size} 个配方涉及 ${ruleViolationCount} 条已批准规则待复核；请逐条确认遗漏或记录客户特殊情况。`
            : '当前已批准规则没有发现未处理的配方缺项。',
    };
}

function refreshFactoryRuleCandidatesCore(options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const insert = options.safeInsert || accessors.safeInsert;
    const update = options.safeUpdate || accessors.safeUpdate;
    const remove = options.hardDelete || accessors.hardDelete;
    const syncRuleKnowledge = options.syncFactoryRuleKnowledgeEntry
        || require('./knowledge.cjs').syncFactoryRuleKnowledgeEntry;
    const minimumEvidence = options.minimumEvidence || MINIMUM_APPROVAL_SUPPORT;
    const allGroups = buildRuleCandidateGroups(feedbackEvidenceRows(database), 0);
    const groups = allGroups.filter(group => group.evidenceCount >= minimumEvidence);
    const allGroupsByKey = new Map(allGroups.map(group => [group.ruleKey, group]));
    const activeKeys = new Set(groups.map(group => group.ruleKey));
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    let stale = 0;
    let suspended = 0;
    const driftedEvidence = allGroups.reduce((total, group) => total + group.driftedCount, 0);
    const outdatedEvidence = allGroups.reduce((total, group) => total + group.outdatedCount, 0);

    for (const group of groups) {
        const current = database.prepare('SELECT * FROM factory_rule_candidates WHERE rule_key = ?').get(group.ruleKey);
        const values = ruleLearningValues(group, now);
        if (current) {
            const previousStatus = current.status;
            const evidenceChanged = current.learning_hash !== group.learningHash
                || Number(current.support_count || 0) !== group.supportCount
                || Number(current.special_case_count || 0) !== group.specialCaseCount
                || Number(current.ignored_count || 0) !== group.ignoredCount;
            const approvalGate = factoryRuleApprovalGate(group.supportCount, group.confidenceScore);
            const approvalSuspended = previousStatus === 'approved' && !approvalGate.eligible;
            if (previousStatus === 'stale') values.status = 'candidate';
            if (approvalSuspended) {
                values.status = 'candidate';
                values.approved_at = null;
                values.reviewed_learning_hash = '';
            }
            const write = update(
                'factory_rule_candidates',
                current.id,
                values,
                options.auditContext || {}
            );
            options.onWrite?.(write);
            const updatedCandidate = candidateRow(
                database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(current.id)
            );
            if (evidenceChanged || previousStatus === 'stale' || approvalSuspended) {
                const eventType = previousStatus === 'stale'
                    ? 'reactivated'
                    : approvalSuspended
                        ? 'approval_suspended'
                        : 'evidence_changed';
                const note = previousStatus === 'stale'
                    ? '支持证据恢复到最低要求，规则重新进入候选状态'
                    : approvalSuspended
                        ? `置信度降至 ${Math.round(group.confidenceScore * 100)}%，低于批准门槛，系统自动撤回批准`
                        : '人工反馈改变了规则证据或置信度';
                recordFactoryRuleEvent(updatedCandidate, eventType, {
                    previousStatus,
                    newStatus: updatedCandidate.status,
                    actor: options.actor,
                    note,
                }, { ...options, db: database, safeInsert: insert });
            }
            if (updatedCandidate.status === 'approved' || approvalSuspended) {
                syncRuleKnowledge(updatedCandidate.id, {
                    dbAccessors: {
                        db: database,
                        safeInsert: insert,
                        safeUpdate: update,
                        hardDelete: remove,
                    },
                    auditContext: options.auditContext,
                    onWrite: options.onWrite,
                });
            }
            if (approvalSuspended) suspended += 1;
            updated += 1;
        } else {
            const info = insert('factory_rule_candidates', {
                rule_key: group.ruleKey,
                ...values,
                status: 'candidate',
                review_note: '',
                created_at: now,
                updated_at: now,
            }, options.auditContext || {});
            options.onWrite?.(info);
            const createdCandidate = candidateRow(
                database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(Number(info.lastInsertRowid))
            );
            recordFactoryRuleEvent(createdCandidate, 'created', {
                newStatus: 'candidate',
                actor: options.actor,
                note: `达到 ${minimumEvidence} 个配方确认，生成候选规则`,
            }, { ...options, db: database, safeInsert: insert });
            created += 1;
        }
    }

    const unmatched = database.prepare(`
        SELECT * FROM factory_rule_candidates WHERE status IN ('candidate', 'approved', 'stale')
    `).all();
    for (const row of unmatched) {
        if (activeKeys.has(row.rule_key)) continue;
        const historicalGroup = allGroupsByKey.get(row.rule_key);
        const preservedGroup = historicalGroup?.driftedCount || historicalGroup?.outdatedCount
            ? historicalGroup
            : null;
        const learningValues = ruleLearningValues(preservedGroup, now);
        const evidenceChanged = row.learning_hash !== learningValues.learning_hash
            || Number(row.support_count || 0) !== Number(learningValues.support_count || 0);
        if (row.status === 'stale' && !evidenceChanged) continue;
        const write = update(
            'factory_rule_candidates',
            row.id,
            {
                ...learningValues,
                status: 'stale',
                reviewed_learning_hash: '',
            },
            options.auditContext || {}
        );
        options.onWrite?.(write);
        const staleCandidate = candidateRow(
            database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(row.id)
        );
        recordFactoryRuleEvent(staleCandidate, 'stale', {
            previousStatus: row.status,
            newStatus: 'stale',
            actor: options.actor,
            note: preservedGroup
                ? `支持证据不足，规则自动转为失效；${preservedGroup.driftedCount} 条范围漂移证据、${preservedGroup.outdatedCount} 条内容过期证据未计入`
                : '支持证据不足，规则自动转为失效',
        }, { ...options, db: database, safeInsert: insert });
        syncRuleKnowledge(staleCandidate.id, {
            dbAccessors: {
                db: database,
                safeInsert: insert,
                safeUpdate: update,
                hardDelete: remove,
            },
            auditContext: options.auditContext,
            onWrite: options.onWrite,
        });
        stale += 1;
    }

    return {
        generatedAt: now,
        minimumEvidence,
        minimumConfidence: MINIMUM_APPROVAL_CONFIDENCE,
        stats: {
            created,
            updated,
            stale,
            suspended,
            active: groups.length,
            driftedEvidence,
            outdatedEvidence,
        },
        candidates: listFactoryRuleCandidates({ db: database }),
    };
}

function refreshFactoryRuleCandidates(options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const transaction = database.transaction(() => refreshFactoryRuleCandidatesCore({
        ...options,
        db: database,
        safeInsert: options.safeInsert || accessors.safeInsert,
        safeUpdate: options.safeUpdate || accessors.safeUpdate,
        hardDelete: options.hardDelete || accessors.hardDelete,
        syncFactoryRuleKnowledgeEntry: options.syncFactoryRuleKnowledgeEntry,
    }));
    return transaction();
}

function reviewFactoryRuleCandidateCore(idValue, input = {}, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const insert = options.safeInsert || accessors.safeInsert;
    const update = options.safeUpdate || accessors.safeUpdate;
    const remove = options.hardDelete || accessors.hardDelete;
    const syncRuleKnowledge = options.syncFactoryRuleKnowledgeEntry
        || require('./knowledge.cjs').syncFactoryRuleKnowledgeEntry;
    const id = parsePositiveId(idValue);
    if (!id) throw inputError('候选规则 ID 必须是正整数');
    const status = String(input.status || '').trim();
    if (!REVIEW_STATUSES.has(status)) throw inputError('status 必须是 candidate、approved 或 rejected');
    const reviewNote = String(input.reviewNote || '').trim();
    if (reviewNote.length > 500) throw inputError('reviewNote 不能超过 500 个字符');
    const currentRecord = database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(id);
    if (!currentRecord) {
        const error = new Error('候选规则不存在');
        error.statusCode = 404;
        throw error;
    }
    const current = candidateRow(currentRecord);
    const currentGroup = status === 'approved'
        ? currentRuleLearningGroup(database, current.ruleKey)
        : null;
    const approvalGate = status === 'approved'
        ? factoryRuleApprovalGate(currentGroup?.supportCount, currentGroup?.confidenceScore)
        : null;
    if (approvalGate && !approvalGate.eligible) {
        throw inputError(`规则不满足批准门槛：${approvalGate.blockers.join('；')}`);
    }
    const now = new Date().toISOString();
    const write = update(
        'factory_rule_candidates',
        id,
        {
            ...(status === 'approved' ? ruleLearningValues(currentGroup, now) : {}),
            status,
            review_note: reviewNote,
            approved_at: status === 'approved' ? now : null,
            reviewed_learning_hash: status === 'approved' ? currentGroup.learningHash : '',
        },
        options.auditContext || {}
    );
    options.onWrite?.(write);
    const reviewed = candidateRow(database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(id));
    recordFactoryRuleEvent(reviewed, status === 'candidate' ? 'reopened' : status, {
        previousStatus: current.status,
        newStatus: status,
        actor: options.actor,
        note: reviewNote,
    }, { ...options, db: database, safeInsert: insert });
    const knowledgeSync = syncRuleKnowledge(reviewed.id, {
        dbAccessors: {
            db: database,
            safeInsert: insert,
            safeUpdate: update,
            hardDelete: remove,
        },
        auditContext: options.auditContext,
        onWrite: options.onWrite,
    });
    return { ...reviewed, knowledgeSync };
}

function reviewFactoryRuleCandidate(idValue, input = {}, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const transaction = database.transaction(() => reviewFactoryRuleCandidateCore(idValue, input, {
        ...options,
        db: database,
        safeInsert: options.safeInsert || accessors.safeInsert,
        safeUpdate: options.safeUpdate || accessors.safeUpdate,
        hardDelete: options.hardDelete || accessors.hardDelete,
        syncFactoryRuleKnowledgeEntry: options.syncFactoryRuleKnowledgeEntry,
    }));
    return transaction();
}

function restoreFactoryRuleEventCore(eventIdValue, input = {}, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const insert = options.safeInsert || accessors.safeInsert;
    const update = options.safeUpdate || accessors.safeUpdate;
    const remove = options.hardDelete || accessors.hardDelete;
    const syncRuleKnowledge = options.syncFactoryRuleKnowledgeEntry
        || require('./knowledge.cjs').syncFactoryRuleKnowledgeEntry;
    const eventId = parsePositiveId(eventIdValue);
    if (!eventId) throw inputError('规则事件 ID 必须是正整数');

    const eventRecord = database.prepare('SELECT * FROM factory_rule_events WHERE id = ?').get(eventId);
    if (!eventRecord) {
        const error = new Error('规则事件不存在');
        error.statusCode = 404;
        throw error;
    }
    const sourceEvent = eventRow(eventRecord);
    const targetStatus = String(sourceEvent.snapshot?.status || '');
    if (!REVIEW_STATUSES.has(targetStatus) || sourceEvent.newStatus !== targetStatus) {
        throw inputError('该历史事件不包含可恢复的审核状态');
    }

    const currentRecord = database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?')
        .get(sourceEvent.candidateId);
    if (!currentRecord || currentRecord.rule_key !== sourceEvent.ruleKey) {
        const error = new Error('历史事件对应的候选规则不存在');
        error.statusCode = 404;
        throw error;
    }
    const current = candidateRow(currentRecord);
    if (current.status === targetStatus) {
        const error = new Error(`规则当前已经是 ${targetStatus} 状态`);
        error.statusCode = 409;
        throw error;
    }
    const currentGroup = currentRuleLearningGroup(database, current.ruleKey);
    const approvalGate = targetStatus === 'approved'
        ? factoryRuleApprovalGate(currentGroup?.supportCount, currentGroup?.confidenceScore)
        : null;
    if (approvalGate && !approvalGate.eligible) {
        throw inputError(`当前规则不满足批准门槛：${approvalGate.blockers.join('；')}`);
    }

    const restoreNote = String(input.restoreNote || '').trim();
    if (restoreNote.length > 500) throw inputError('restoreNote 不能超过 500 个字符');
    const sourceReviewNote = String(sourceEvent.snapshot?.reviewNote || '').trim();
    const reviewNote = restoreNote || sourceReviewNote || `恢复自规则事件 #${sourceEvent.id}`;
    const now = new Date().toISOString();
    const learningUpdates = ruleLearningValues(currentGroup, now);
    const write = update(
        'factory_rule_candidates',
        current.id,
        {
            ...learningUpdates,
            status: targetStatus,
            review_note: reviewNote,
            approved_at: targetStatus === 'approved' ? now : null,
            reviewed_learning_hash: targetStatus === 'approved' ? currentGroup.learningHash : '',
        },
        options.auditContext || {}
    );
    options.onWrite?.(write);
    const restored = candidateRow(
        database.prepare('SELECT * FROM factory_rule_candidates WHERE id = ?').get(current.id)
    );
    recordFactoryRuleEvent(restored, 'restored', {
        previousStatus: current.status,
        newStatus: targetStatus,
        actor: options.actor,
        note: `从事件 #${sourceEvent.id} 恢复审核状态；保留当前规则内容和学习证据。${restoreNote ? ` ${restoreNote}` : ''}`,
    }, { ...options, db: database, safeInsert: insert });
    const knowledgeSync = syncRuleKnowledge(restored.id, {
        dbAccessors: {
            db: database,
            safeInsert: insert,
            safeUpdate: update,
            hardDelete: remove,
        },
        auditContext: options.auditContext,
        onWrite: options.onWrite,
    });
    return {
        candidate: restored,
        restoredFromEvent: sourceEvent,
        knowledgeSync,
    };
}

function restoreFactoryRuleEvent(eventIdValue, input = {}, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const transaction = database.transaction(() => restoreFactoryRuleEventCore(eventIdValue, input, {
        ...options,
        db: database,
        safeInsert: options.safeInsert || accessors.safeInsert,
        safeUpdate: options.safeUpdate || accessors.safeUpdate,
        hardDelete: options.hardDelete || accessors.hardDelete,
        syncFactoryRuleKnowledgeEntry: options.syncFactoryRuleKnowledgeEntry,
    }));
    return transaction();
}

module.exports = {
    buildFactoryLearningHealth,
    buildRuleCandidateGroups,
    buildFactoryRuleCompliance,
    buildFactoryRuleImpact,
    confidenceForEvidence,
    factoryRuleApprovalGate,
    learningEvidenceHash,
    listFactoryRuleEvents,
    listFactoryRuleCandidates,
    recordFactoryRuleEvent,
    refreshFactoryRuleCandidates,
    restoreFactoryRuleEvent,
    reviewFactoryRuleCandidate,
};
