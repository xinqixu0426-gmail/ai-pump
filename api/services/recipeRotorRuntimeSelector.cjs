// Production Rotor source selector.  It deliberately selects one complete
// authority record; it never merges legacy fields into canonical storage.
const { parsePositiveId } = require('./validation.cjs');
const { createRecipeTechnicalRotorAdapter } = require('./recipeTechnicalRotorAdapter.cjs');
const { createRecipeTechnicalMigrationDryRunService } = require('./recipeTechnicalMigrationDryRun.cjs');
const { recipeTechnicalRuntimeFlags } = require('./recipeTechnicalRuntimeFlags.cjs');

function runtimeNotReady(recipeId, recipe, canonical, reason) {
    return {
        recipeId,
        templateId: recipe.template_id || null,
        variantId: recipe.model_variant_id || null,
        drawingName: String(recipe.name || '').trim(),
        patch: {},
        hints: ['canonical 技术档案当前不可用于转子出图'],
        meta: null,
        openOffset: null,
        barrelLength: null,
        drawingText: '',
        technicalRuntime: {
            source: 'CANONICAL_NOT_READY',
            canonicalReadEnabled: true,
            eligible: false,
            reason,
            canonicalMode: canonical.mode,
            completenessState: canonical.completenessState,
            unresolved: canonical.unresolved || [],
        },
    };
}

function createRecipeRotorRuntimeSelector(dependencies = {}) {
    const db = dependencies.db;
    if (!db) throw new Error('Recipe Rotor runtime selector 缺少 db');
    const readLegacy = dependencies.buildLegacyRecipeRotorDraft
        || require('./rotorQueries.cjs').buildLegacyRecipeRotorDraft;
    const canonicalAdapter = dependencies.canonicalAdapter
        || createRecipeTechnicalRotorAdapter({ db });
    const dryRun = dependencies.dryRun
        || createRecipeTechnicalMigrationDryRunService({ db });
    const flags = dependencies.flags || (() => recipeTechnicalRuntimeFlags(dependencies.env));

    function identity(recipeId) {
        const recipe = db.prepare(`
            SELECT id, name, template_id, model_variant_id
            FROM recipes WHERE id = ? AND deleted_at IS NULL
        `).get(recipeId);
        if (!recipe) {
            const error = new Error('配方不存在');
            error.code = 'recipe_not_found'; error.statusCode = 404;
            throw error;
        }
        return recipe;
    }

    function legacyCompatibility(recipeId, enabled) {
        const draft = readLegacy(db, recipeId);
        if (!enabled) return draft;
        return {
            ...draft,
            technicalRuntime: {
                source: 'LEGACY_COMPATIBILITY', canonicalReadEnabled: true,
                eligible: false, reason: 'CANONICAL_PROFILE_ABSENT',
            },
        };
    }

    function buildRecipeRotorDraft(recipeIdValue) {
        const recipeId = parsePositiveId(recipeIdValue);
        if (!recipeId) {
            const error = new Error('recipeId 为必填');
            error.code = 'recipe_id_invalid'; error.statusCode = 400;
            throw error;
        }
        const currentFlags = flags();
        // This branch intentionally executes the historical function directly,
        // including its error behaviour and response shape.
        if (!currentFlags.canonicalReadEnabled) return readLegacy(db, recipeId);

        const recipe = identity(recipeId);
        const canonical = canonicalAdapter.buildCanonicalRecipeRotorInput(recipeId);
        if (canonical.mode === 'LEGACY_COMPATIBILITY_REQUIRED') {
            return legacyCompatibility(recipeId, true);
        }
        if (canonical.mode !== 'CANONICAL') {
            return runtimeNotReady(recipeId, recipe, canonical, canonical.unresolved?.[0] || 'CANONICAL_STORAGE_UNSAFE');
        }
        if (canonical.completenessState !== 'COMPLETE' || canonical.unresolved?.length) {
            return runtimeNotReady(recipeId, recipe, canonical, 'CANONICAL_PROFILE_INCOMPLETE');
        }
        const assessment = dryRun.assess(recipeId);
        if (assessment.classification !== 'ALREADY_CANONICAL') {
            return runtimeNotReady(recipeId, recipe, canonical, assessment.reasons?.[0]?.code || 'MIGRATION_AUTHORITY_NOT_CURRENT');
        }
        return {
            recipeId,
            templateId: recipe.template_id || null,
            variantId: recipe.model_variant_id || null,
            drawingName: String(recipe.name || '').trim(),
            patch: canonical.rotorPatch,
            hints: [],
            meta: null,
            openOffset: canonical.functional.openOffset,
            barrelLength: canonical.functional.barrelLength,
            drawingText: '',
            technicalRuntime: {
                source: 'CANONICAL', canonicalReadEnabled: true, eligible: true,
                reason: assessment.reasons?.[0]?.code || 'CANONICAL_AUTHORITY_CURRENT',
                migrationClassification: assessment.classification,
                migrationReason: assessment.disposition?.reason || null,
                upperBearingPartId: canonical.relations.upperBearingPartId,
                lowerBearingPartId: canonical.relations.lowerBearingPartId,
            },
        };
    }

    return Object.freeze({ buildRecipeRotorDraft });
}

module.exports = { createRecipeRotorRuntimeSelector };
