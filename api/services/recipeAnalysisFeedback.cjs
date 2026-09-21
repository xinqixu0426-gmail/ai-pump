const { parsePositiveId, stringifyJsonObject } = require('./validation.cjs');

const DECISIONS = new Set(['confirmed', 'ignored', 'special_case', 'review']);

function inputError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function conflictError(message) {
    const error = new Error(message);
    error.statusCode = 409;
    return error;
}

function requiredText(value, field, maxLength) {
    const text = String(value || '').trim();
    if (!text) throw inputError(`${field} 不能为空`);
    if (text.length > maxLength) throw inputError(`${field} 不能超过 ${maxLength} 个字符`);
    return text;
}

function loadDbAccessors() {
    return require('../db.cjs');
}

function feedbackRow(row) {
    if (!row) return row;
    return {
        id: row.id,
        recipeId: row.recipe_id,
        findingKey: row.finding_key,
        findingType: row.finding_type,
        decision: row.decision,
        note: row.note || '',
        findingSnapshotJson: row.finding_snapshot_json || '{}',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function parseObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try {
        const parsed = JSON.parse(value || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function analysisContainsFinding(analysis, findingKey) {
    return [
        ...(analysis?.factoryRuleAlerts || []),
        ...(analysis?.missingItems || []),
        ...(analysis?.priceAlerts || []),
        ...(analysis?.suppressedFindings || []),
    ].some(finding => finding?.key === findingKey);
}

function saveRecipeAnalysisFeedback(recipeIdValue, input = {}, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const insert = options.safeInsert || accessors.safeInsert;
    const update = options.safeUpdate || accessors.safeUpdate;
    const remove = options.hardDelete || accessors.hardDelete;
    const recipeId = parsePositiveId(recipeIdValue);
    if (!recipeId) throw inputError('recipeId 必须是正整数');

    const recipe = database.prepare(`
        SELECT recipes.id, recipes.name, recipes.template_id, recipes.updated_at,
               templates.shell_model AS template_name
        FROM recipes
        LEFT JOIN pump_shell_templates templates ON templates.id = recipes.template_id
        WHERE recipes.id = ? AND recipes.deleted_at IS NULL
    `).get(recipeId);
    if (!recipe) {
        const error = new Error('配方不存在');
        error.statusCode = 404;
        throw error;
    }

    const findingKey = requiredText(input.findingKey, 'findingKey', 200);
    const findingType = requiredText(input.findingType, 'findingType', 80);
    const decision = String(input.decision || '').trim();
    if (!DECISIONS.has(decision)) throw inputError('decision 必须是 confirmed、ignored、special_case 或 review');
    const note = String(input.note || '').trim();
    if (note.length > 500) throw inputError('note 不能超过 500 个字符');

    let findingSnapshot;
    try {
        findingSnapshot = JSON.parse(stringifyJsonObject(input.findingSnapshot, 'findingSnapshot'));
    } catch (error) {
        throw inputError(error.message);
    }
    const recordedAt = new Date().toISOString();
    findingSnapshot.evidenceContext = {
        recipeId,
        recipeName: recipe.name || `配方 #${recipeId}`,
        templateId: Number(recipe.template_id || 0) || null,
        templateName: recipe.template_name || '',
        recipeUpdatedAt: recipe.updated_at || null,
        recordedAt,
    };
    const findingSnapshotJson = JSON.stringify(findingSnapshot);

    const persistFeedback = database.transaction(() => {
        const current = database.prepare(`
            SELECT * FROM recipe_analysis_feedback
            WHERE recipe_id = ? AND finding_key = ?
        `).get(recipeId, findingKey);
        const now = recordedAt;
        if (current) {
            const write = update(
                'recipe_analysis_feedback',
                current.id,
                {
                    finding_type: findingType,
                    decision,
                    note,
                    finding_snapshot_json: findingSnapshotJson,
                },
                options.auditContext || {}
            );
            options.onWrite?.(write);
        } else {
            const write = insert('recipe_analysis_feedback', {
                recipe_id: recipeId,
                finding_key: findingKey,
                finding_type: findingType,
                decision,
                note,
                finding_snapshot_json: findingSnapshotJson,
                created_at: now,
                updated_at: now,
            }, options.auditContext || {});
            options.onWrite?.(write);
        }

        const saved = feedbackRow(database.prepare(`
            SELECT * FROM recipe_analysis_feedback
            WHERE recipe_id = ? AND finding_key = ?
        `).get(recipeId, findingKey));
        if (findingType !== 'peer_pattern') return saved;

        const refreshCandidates = options.refreshFactoryRuleCandidates
            || require('./factoryRuleCandidates.cjs').refreshFactoryRuleCandidates;
        const learning = refreshCandidates({
            db: database,
            safeInsert: insert,
            safeUpdate: update,
            hardDelete: remove,
            actor: options.actor,
            auditContext: options.auditContext,
            onWrite: options.onWrite,
        });
        return {
            ...saved,
            ruleLearning: {
                refreshed: true,
                minimumEvidence: learning.minimumEvidence,
                minimumConfidence: learning.minimumConfidence,
                stats: learning.stats,
                candidateCount: learning.candidates.length,
            },
        };
    });

    return persistFeedback();
}

function resolveRecipeAnalysisFeedback(feedbackIdValue, input = {}, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const update = options.safeUpdate || accessors.safeUpdate;
    const remove = options.hardDelete || accessors.hardDelete;
    const feedbackId = parsePositiveId(feedbackIdValue);
    if (!feedbackId) throw inputError('feedbackId 必须是正整数');

    const current = database.prepare(`
        SELECT feedback.*, recipes.id AS current_recipe_id,
               recipes.template_id AS current_template_id,
               recipes.updated_at AS current_recipe_updated_at,
               recipes.deleted_at AS recipe_deleted_at
        FROM recipe_analysis_feedback feedback
        LEFT JOIN recipes ON recipes.id = feedback.recipe_id
        WHERE feedback.id = ?
    `).get(feedbackId);
    if (!current) {
        const error = new Error('配方检查反馈不存在');
        error.statusCode = 404;
        throw error;
    }
    if (current.finding_type !== 'peer_pattern') {
        throw conflictError('只有同类高频项学习反馈可以通过待复核队列确认解决');
    }
    if (!['confirmed', 'ignored', 'special_case'].includes(current.decision)) {
        throw conflictError('这条反馈已经不在学习证据待复核队列中');
    }
    if (current.recipe_deleted_at || !current.current_recipe_id) {
        throw conflictError('归档配方反馈只保留历史追溯，不能确认解决');
    }

    const snapshot = parseObject(current.finding_snapshot_json);
    const evidenceContext = parseObject(snapshot.evidenceContext);
    const templateIdAtDecision = Number(evidenceContext.templateId || 0) || null;
    const currentTemplateId = Number(current.current_template_id || 0) || null;
    const recipeUpdatedAtAtDecision = String(evidenceContext.recipeUpdatedAt || '').trim();
    const currentRecipeUpdatedAt = String(current.current_recipe_updated_at || '').trim();
    const scopeDrift = Boolean(
        templateIdAtDecision
        && templateIdAtDecision !== currentTemplateId
    );
    const contentOutdated = Boolean(
        !scopeDrift
        && recipeUpdatedAtAtDecision
        && currentRecipeUpdatedAt
        && recipeUpdatedAtAtDecision !== currentRecipeUpdatedAt
    );
    if (!scopeDrift && !contentOutdated) {
        throw conflictError('这条反馈仍对应当前配方版本，请在智能检查中重新判断');
    }

    const analyze = options.analyzeRecipeConfiguration
        || require('./recipeIntelligence.cjs').analyzeRecipeConfiguration;
    const analysis = analyze(
        { recipeId: current.current_recipe_id },
        { dbAccessors: accessors }
    );
    if (analysisContainsFinding(analysis, current.finding_key)) {
        throw conflictError('原提醒在当前配方智能检查中仍然存在，请重新判断，不能直接确认已解决');
    }

    const inputNote = String(input.note || '').trim();
    if (inputNote.length > 500) throw inputError('note 不能超过 500 个字符');
    const resolutionNote = inputNote || '重新智能检查后原提醒未再次出现，确认已解决';
    const note = [String(current.note || '').trim(), resolutionNote]
        .filter(Boolean)
        .join('；')
        .slice(0, 500);

    const resolveFeedback = database.transaction(() => {
        const write = update(
            'recipe_analysis_feedback',
            feedbackId,
            {
                decision: 'review',
                note,
            },
            options.auditContext || {}
        );
        options.onWrite?.(write);

        const refreshCandidates = options.refreshFactoryRuleCandidates
            || require('./factoryRuleCandidates.cjs').refreshFactoryRuleCandidates;
        const learning = refreshCandidates({
            db: database,
            safeInsert: options.safeInsert || accessors.safeInsert,
            safeUpdate: update,
            hardDelete: remove,
            actor: options.actor,
            auditContext: options.auditContext,
            onWrite: options.onWrite,
        });
        return {
            ...feedbackRow(database.prepare(`
                SELECT * FROM recipe_analysis_feedback
                WHERE id = ?
            `).get(feedbackId)),
            resolved: true,
            previousDecision: current.decision,
            resolutionReason: scopeDrift ? 'template_drift' : 'content_outdated',
            ruleLearning: {
                refreshed: true,
                minimumEvidence: learning.minimumEvidence,
                minimumConfidence: learning.minimumConfidence,
                stats: learning.stats,
                candidateCount: learning.candidates.length,
            },
        };
    });

    return resolveFeedback();
}

module.exports = {
    DECISIONS,
    analysisContainsFinding,
    resolveRecipeAnalysisFeedback,
    saveRecipeAnalysisFeedback,
};
