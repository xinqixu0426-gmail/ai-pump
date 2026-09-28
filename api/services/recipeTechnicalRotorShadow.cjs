// O4-F-E compares isolated legacy compatibility output with isolated canonical
// authority.  It never selects a source for production Rotor reads.
const { parsePositiveId } = require('./validation.cjs');
const { buildLegacyRecipeRotorDraft } = require('./rotorQueries.cjs');
const { normalizeBearing } = require('./rotorParameters.cjs');
const { createRecipeTechnicalRotorAdapter } = require('./recipeTechnicalRotorAdapter.cjs');

const COMPARABLE_FIELDS = Object.freeze([
    'piece_count', 'rotor_dia', 'bearing_span', 'stack_offset', 'oil_seal_dia',
    'impeller_dia', 'impeller_span', 'impeller_depth', 'thread_length', 'thread_dia',
    'upper_bearing', 'lower_bearing',
]);

function comparable(value, key) {
    if (value === undefined || value === null || value === '') return null;
    if (['upper_bearing', 'lower_bearing'].includes(key)) return normalizeBearing(value) || null;
    const number = Number(value);
    return Number.isFinite(number) ? Number(number.toFixed(1)) : String(value).trim();
}

function legacyCompatibilityDraft(db, recipeId) {
    const draft = buildLegacyRecipeRotorDraft(db, recipeId);
    return { mode: 'LEGACY_COMPATIBILITY', recipeId, patch: draft.patch || {}, hints: draft.hints || [], draft };
}

function expectedLegacyFallback(legacy, field) {
    const hints = legacy.hints || [];
    const labels = {
        upper_bearing: '预设上轴承', lower_bearing: '预设下轴承', oil_seal_dia: '预设油封孔径',
        bearing_span: '预设开档', impeller_dia: '预设叶轮孔径', impeller_span: '预设叶轮开档',
        impeller_depth: '预设叶轮厚度', thread_length: '预设螺丝长度', thread_dia: '预设螺纹直径',
        stack_offset: '预设定位',
    };
    return hints.some(hint => hint.includes(labels[field] || '__never__') || hint.startsWith(`模板${field}`));
}

function compareField(legacy, canonical, key) {
    const legacyValue = comparable(legacy.patch[key], key);
    const canonicalValue = comparable(canonical.rotorPatch[key], key);
    if (legacyValue !== null && canonicalValue !== null) {
        if (legacyValue === canonicalValue) return { status: 'MATCH', legacyValue, canonicalValue };
        if (key === 'bearing_span' && canonical.policy?.stainlessMode === 'STAINLESS') {
            return { status: 'EXPECTED_SEMANTIC_CHANGE', legacyValue, canonicalValue, reason: 'CANONICAL_STAINLESS_SPAN_DERIVED_FROM_RECIPE_OPEN_OFFSET' };
        }
        return { status: 'CONFLICT', legacyValue, canonicalValue, reason: 'CONCRETE_CANONICAL_AND_LEGACY_VALUES_DIFFER' };
    }
    if (canonicalValue === null && legacyValue !== null && expectedLegacyFallback(legacy, key)) {
        return { status: 'EXPECTED_SEMANTIC_CHANGE', legacyValue, canonicalValue, reason: 'CANONICAL_DOES_NOT_USE_LEGACY_TEMPLATE_OR_PUMPSHELL_FALLBACK' };
    }
    return { status: 'UNRESOLVED', legacyValue, canonicalValue, reason: canonicalValue === null ? 'CANONICAL_VALUE_UNRESOLVED' : 'LEGACY_VALUE_UNRESOLVED' };
}

function createRecipeTechnicalRotorShadowService(dependencies = {}) {
    const db = dependencies.db;
    if (!db) throw new Error('canonical Rotor shadow 缺少 db');
    const canonicalAdapter = dependencies.canonicalAdapter || createRecipeTechnicalRotorAdapter({ db });
    function inspect(recipeIdValue) {
        const recipeId = parsePositiveId(recipeIdValue);
        if (!recipeId) {
            const error = new Error('非法配方ID'); error.code = 'recipe_id_invalid'; error.statusCode = 400; throw error;
        }
        const legacy = legacyCompatibilityDraft(db, recipeId);
        const canonical = canonicalAdapter.buildCanonicalRecipeRotorInput(recipeId);
        const fields = Object.fromEntries(COMPARABLE_FIELDS.map(key => [key, compareField(legacy, canonical, key)]));
        const counts = { match: 0, expectedSemanticChange: 0, conflict: 0, unresolved: 0 };
        for (const item of Object.values(fields)) {
            if (item.status === 'MATCH') counts.match += 1;
            else if (item.status === 'EXPECTED_SEMANTIC_CHANGE') counts.expectedSemanticChange += 1;
            else if (item.status === 'CONFLICT') counts.conflict += 1;
            else counts.unresolved += 1;
        }
        const canonicalIncomplete = canonical.mode !== 'CANONICAL' || canonical.unresolved.length > 0 || canonical.completenessState !== 'COMPLETE';
        const overall = counts.conflict > 0 ? 'ATTENTION_REQUIRED'
            : canonicalIncomplete ? 'INCOMPLETE'
                : counts.expectedSemanticChange > 0 ? 'EXPECTED_DIFFERENCE' : 'PARITY';
        return { recipeId, legacy, canonical, comparison: { overall, fields, counts } };
    }
    return Object.freeze({ inspect });
}

module.exports = {
    COMPARABLE_FIELDS,
    createRecipeTechnicalRotorShadowService,
    legacyCompatibilityDraft,
};
