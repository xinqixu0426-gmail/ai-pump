// Temporary cutover compatibility projection.  This module has exactly one
// direction: canonical Recipe technical authority -> legacy Recipe fields.
const { bearingCodeOf } = require('./catalogSpec.cjs');
const { normalizeBearing } = require('./rotorParameters.cjs');
const { derivedBearingSpan } = require('./recipeTechnicalProfile.cjs');

const LEGACY_PROJECTION_VERSION = 'recipe-technical-legacy-projection-v1';
const JSON_FIELD_MAP = Object.freeze({
    rotorDiameter: 'rotorDiameter', stackOffset: 'stackOffset',
    oilSealDiameter: 'oilSealDiameter', impellerBoreDiameter: 'impellerBoreDiameter',
    impellerSpan: 'impellerSpan', impellerThickness: 'impellerDepth',
    threadLength: 'threadLength', threadDiameter: 'threadDiameter',
});

function parseLegacyObject(raw) {
    try {
        const parsed = JSON.parse(raw || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function activeBearingCode(db, partId) {
    if (!Number.isInteger(partId) || partId <= 0) return null;
    const part = db.prepare(`
        SELECT id, model, category, deleted_at, naming_json FROM parts WHERE id = ?
    `).get(partId);
    if (!part || part.deleted_at || part.category !== '轴承') return null;
    return normalizeBearing(bearingCodeOf(part)) || null;
}

function projectionExpectation(db, recipe, functional, policy) {
    const json = parseLegacyObject(recipe.technical_data_json);
    if (!json) {
        const error = new Error('legacy technical_data_json 不是可安全保留的对象');
        error.code = 'technical_profile_legacy_projection_invalid';
        error.statusCode = 409;
        throw error;
    }
    const projectedKeys = [];
    for (const [field, key] of Object.entries(JSON_FIELD_MAP)) {
        if (functional[field] !== null) {
            json[key] = functional[field];
            projectedKeys.push(key);
        }
    }
    const span = derivedBearingSpan(functional, policy);
    if (span.valid) {
        json.bearingSpan = span.value;
        projectedKeys.push('bearingSpan');
    }
    const upper = activeBearingCode(db, functional.upperBearingPartId);
    const lower = activeBearingCode(db, functional.lowerBearingPartId);
    if (upper) { json.upperBearing = upper; projectedKeys.push('upperBearing'); }
    if (lower) { json.lowerBearing = lower; projectedKeys.push('lowerBearing'); }
    const coilSheets = recipe.coil_sheets;
    if (typeof coilSheets === 'number' && Number.isFinite(coilSheets) && coilSheets > 0) {
        json.pieceCount = coilSheets;
        projectedKeys.push('pieceCount');
    }
    return {
        technical_data_json: JSON.stringify(json),
        impeller_thickness: functional.impellerThickness !== null
            ? functional.impellerThickness : recipe.impeller_thickness,
        custom_barrel_length: functional.barrelLength !== null
            ? functional.barrelLength : recipe.custom_barrel_length,
        projectedKeys: [...new Set(projectedKeys)].sort(),
        derivedBearingSpan: span.valid ? span.value : null,
    };
}

function legacyProjectionMatches(db, recipeId, functional, policy) {
    const recipe = db.prepare(`
        SELECT id, technical_data_json, impeller_thickness, custom_barrel_length, coil_sheets, updated_at
        FROM recipes WHERE id = ? AND deleted_at IS NULL
    `).get(recipeId);
    if (!recipe) return { matches: false, reason: 'RECIPE_NOT_FOUND' };
    const expected = projectionExpectation(db, recipe, functional, policy);
    return {
        matches: recipe.technical_data_json === expected.technical_data_json
            && (recipe.impeller_thickness ?? null) === (expected.impeller_thickness ?? null)
            && (recipe.custom_barrel_length ?? null) === (expected.custom_barrel_length ?? null),
        expected,
    };
}

function applyLegacyProjection(db, { recipeId, functional, policy, now }) {
    const before = db.prepare(`
        SELECT id, technical_data_json, impeller_thickness, custom_barrel_length, coil_sheets, updated_at
        FROM recipes WHERE id = ? AND deleted_at IS NULL
    `).get(recipeId);
    if (!before) {
        const error = new Error('配方不存在'); error.code = 'recipe_not_found'; error.statusCode = 404; throw error;
    }
    const expected = projectionExpectation(db, before, functional, policy);
    const changed = before.technical_data_json !== expected.technical_data_json
        || (before.impeller_thickness ?? null) !== (expected.impeller_thickness ?? null)
        || (before.custom_barrel_length ?? null) !== (expected.custom_barrel_length ?? null);
    if (!changed) return { before, after: before, changed: false, action: null, projection: expected };
    // This fixed statement is deliberately not a user-controlled dynamic SQL update.
    db.prepare(`
        UPDATE recipes
        SET technical_data_json = ?, impeller_thickness = ?, custom_barrel_length = ?, updated_at = ?
        WHERE id = ?
    `).run(expected.technical_data_json, expected.impeller_thickness, expected.custom_barrel_length, now, recipeId);
    const after = db.prepare(`
        SELECT id, technical_data_json, impeller_thickness, custom_barrel_length, coil_sheets, updated_at
        FROM recipes WHERE id = ?
    `).get(recipeId);
    return { before, after, changed: true, action: 'UPDATE', projection: expected };
}

module.exports = {
    JSON_FIELD_MAP,
    LEGACY_PROJECTION_VERSION,
    activeBearingCode,
    applyLegacyProjection,
    legacyProjectionMatches,
    projectionExpectation,
};
