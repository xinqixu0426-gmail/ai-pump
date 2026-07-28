const { parsePositiveId, stringifyJsonObject } = require('./validation.cjs');

const DECISIONS = new Set(['confirmed', 'ignored', 'special_case', 'review']);

function inputError(message) {
    const error = new Error(message);
    error.statusCode = 400;
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

function saveRecipeAnalysisFeedback(recipeIdValue, input = {}, options = {}) {
    const accessors = options.db ? options : loadDbAccessors();
    const database = options.db || accessors.db;
    const insert = options.safeInsert || accessors.safeInsert;
    const update = options.safeUpdate || accessors.safeUpdate;
    const recipeId = parsePositiveId(recipeIdValue);
    if (!recipeId) throw inputError('recipeId 必须是正整数');

    const recipe = database.prepare('SELECT id FROM recipes WHERE id = ? AND deleted_at IS NULL').get(recipeId);
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

    let findingSnapshotJson;
    try {
        findingSnapshotJson = stringifyJsonObject(input.findingSnapshot, 'findingSnapshot');
    } catch (error) {
        throw inputError(error.message);
    }

    const persistFeedback = database.transaction(() => {
        const current = database.prepare(`
            SELECT * FROM recipe_analysis_feedback
            WHERE recipe_id = ? AND finding_key = ?
        `).get(recipeId, findingKey);
        const now = new Date().toISOString();
        if (current) {
            update('recipe_analysis_feedback', current.id, {
                finding_type: findingType,
                decision,
                note,
                finding_snapshot_json: findingSnapshotJson,
            });
        } else {
            insert('recipe_analysis_feedback', {
                recipe_id: recipeId,
                finding_key: findingKey,
                finding_type: findingType,
                decision,
                note,
                finding_snapshot_json: findingSnapshotJson,
                created_at: now,
                updated_at: now,
            });
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
        });
        return {
            ...saved,
            ruleLearning: {
                refreshed: true,
                minimumEvidence: learning.minimumEvidence,
                stats: learning.stats,
                candidateCount: learning.candidates.length,
            },
        };
    });

    return persistFeedback();
}

module.exports = {
    DECISIONS,
    saveRecipeAnalysisFeedback,
};
