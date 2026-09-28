// O4-F-E canonical Rotor read boundary.  This adapter deliberately reads only
// Recipe-owned canonical technical storage and formal relations; it never
// repairs missing canonical values from the legacy Rotor path.
const { parsePositiveId } = require('./validation.cjs');
const { bearingCodeOf } = require('./catalogSpec.cjs');
const { normalizeBearing, BEARING_DB } = require('./rotorParameters.cjs');
const { getFunctionalProfile, getTechnicalKnowledge } = require('./recipeTechnicalProfileStore.cjs');
const {
    createRecipeTechnicalProfileService,
    functionalFromRow,
    derivedBearingSpan,
    resolveStainlessMode,
} = require('./recipeTechnicalProfile.cjs');

const PROFILE_SCHEMA_VERSION = 1;
const SUPPORTED_MIGRATION_STATES = new Set([
    'ALREADY_CANONICAL',
    'AUTO_MIGRATED',
    'MIGRATED_WITH_COMPATIBILITY_PROVENANCE',
]);
const ROTOR_FIELDS = Object.freeze([
    ['pieceCount', 'piece_count'],
    ['rotorDiameter', 'rotor_dia'],
    ['bearingSpan', 'bearing_span'],
    ['stackOffset', 'stack_offset'],
    ['oilSealDiameter', 'oil_seal_dia'],
    ['impellerBoreDiameter', 'impeller_dia'],
    ['impellerSpan', 'impeller_span'],
    ['impellerThickness', 'impeller_depth'],
    ['threadLength', 'thread_length'],
    ['threadDiameter', 'thread_dia'],
]);

class RecipeTechnicalRotorAdapterError extends Error {
    constructor(code, message, statusCode = 400) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
    }
}

function error(code, message, statusCode = 400) {
    return new RecipeTechnicalRotorAdapterError(code, message, statusCode);
}

function recipeIdOf(value) {
    const recipeId = parsePositiveId(value);
    if (!recipeId) throw error('recipe_id_invalid', '非法配方ID');
    return recipeId;
}

function parseObject(raw) {
    try {
        const parsed = JSON.parse(raw || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseArray(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function presentNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bearingGeometry(db, partId, position) {
    if (!Number.isInteger(partId) || partId <= 0) {
        return { partId: partId ?? null, position, active: false, category: null, engineeringCode: null, geometryAvailable: false, unresolved: 'BEARING_PART_MISSING' };
    }
    const part = db.prepare(`
        SELECT id, model, supplier, category, deleted_at, naming_json
        FROM parts WHERE id = ?
    `).get(partId);
    if (!part) return { partId, position, active: false, category: null, engineeringCode: null, geometryAvailable: false, unresolved: 'BEARING_PART_NOT_FOUND' };
    if (part.deleted_at) return { partId: Number(part.id), position, model: part.model, supplier: part.supplier, active: false, category: part.category, engineeringCode: null, geometryAvailable: false, unresolved: 'BEARING_PART_INACTIVE' };
    if (part.category !== '轴承') return { partId: Number(part.id), position, model: part.model, supplier: part.supplier, active: true, category: part.category, engineeringCode: null, geometryAvailable: false, unresolved: 'BEARING_PART_CATEGORY_INVALID' };
    const engineeringCode = normalizeBearing(bearingCodeOf(part)) || null;
    return {
        partId: Number(part.id), position, model: part.model, supplier: part.supplier,
        active: true, category: part.category, engineeringCode,
        geometryAvailable: Boolean(engineeringCode && BEARING_DB[engineeringCode]),
        ...(engineeringCode && !BEARING_DB[engineeringCode] ? { unresolved: 'BEARING_GEOMETRY_UNRESOLVED' } : {}),
        ...(!engineeringCode ? { unresolved: 'BEARING_ENGINEERING_CODE_UNRESOLVED' } : {}),
    };
}

function unsafeResult(recipeId, recipe, profile, reason, unresolved) {
    return {
        recipeId, mode: 'CANONICAL_UNSAFE', profileSchemaVersion: profile?.schema_version ?? null,
        migrationState: profile?.migration_state ?? null,
        completenessState: profile?.completeness_state ?? 'INCOMPLETE',
        policy: { stainlessMode: 'UNKNOWN_OR_UNRESOLVED', isStainless: null, templateId: recipe.template_id ?? null, shellPartId: null },
        relations: { templateId: recipe.template_id ?? null, coilId: recipe.coil_id ?? null, upperBearingPartId: null, lowerBearingPartId: null },
        functional: null, bearingGeometry: { upper: null, lower: null }, rotorPatch: {},
        provenance: {}, unresolved: [reason, ...unresolved],
    };
}

function createRecipeTechnicalRotorAdapter(dependencies = {}) {
    const db = dependencies.db;
    if (!db) throw new Error('canonical Rotor adapter 缺少 db');
    const canonicalProfile = dependencies.canonicalProfileService || createRecipeTechnicalProfileService({ db });

    function buildCanonicalRecipeRotorInput(recipeIdValue) {
        const recipeId = recipeIdOf(recipeIdValue);
        const recipe = db.prepare(`
            SELECT id, template_id, coil_id, coil_sheets, deleted_at
            FROM recipes WHERE id = ? AND deleted_at IS NULL
        `).get(recipeId);
        if (!recipe) throw error('recipe_not_found', '配方不存在', 404);
        const profile = getFunctionalProfile(db, recipeId);
        const knowledge = getTechnicalKnowledge(db, recipeId);
        if (!profile && !knowledge) {
            return {
                recipeId, mode: 'LEGACY_COMPATIBILITY_REQUIRED', profileSchemaVersion: null,
                migrationState: null, completenessState: 'INCOMPLETE',
                policy: { stainlessMode: 'UNKNOWN_OR_UNRESOLVED', isStainless: null, templateId: recipe.template_id ?? null, shellPartId: null },
                relations: { templateId: recipe.template_id ?? null, coilId: recipe.coil_id ?? null, upperBearingPartId: null, lowerBearingPartId: null },
                functional: null, bearingGeometry: { upper: null, lower: null }, rotorPatch: {}, provenance: {},
                unresolved: ['CANONICAL_PROFILE_ABSENT'],
            };
        }
        if (!profile || !knowledge) return unsafeResult(recipeId, recipe, profile, 'CANONICAL_STORAGE_PARTIAL', []);
        if (profile.schema_version !== PROFILE_SCHEMA_VERSION || knowledge.schema_version !== PROFILE_SCHEMA_VERSION) {
            return unsafeResult(recipeId, recipe, profile, 'CANONICAL_SCHEMA_VERSION_UNSUPPORTED', []);
        }
        if (!parseObject(profile.provenance_json) || !parseArray(knowledge.items_json)) {
            return unsafeResult(recipeId, recipe, profile, 'CANONICAL_STORAGE_PAYLOAD_INVALID', []);
        }
        if (!SUPPORTED_MIGRATION_STATES.has(profile.migration_state)) {
            return unsafeResult(recipeId, recipe, profile, 'CANONICAL_MIGRATION_STATE_NOT_ELIGIBLE', []);
        }

        const dto = canonicalProfile.get(recipeId);
        const policy = dto.policy || resolveStainlessMode(db, recipeId, recipe);
        const functional = functionalFromRow(profile);
        const unresolved = [];
        if (policy.stainlessMode === 'UNKNOWN_OR_UNRESOLVED') unresolved.push(`POLICY_${policy.reasonCode || 'UNRESOLVED'}`);
        const pieceCount = presentNumber(recipe.coil_sheets);
        if (pieceCount === null || pieceCount <= 0) unresolved.push('PIECE_COUNT_UNRESOLVED');
        const span = derivedBearingSpan(functional, policy);
        if (!span.valid) unresolved.push(policy.stainlessMode === 'UNKNOWN_OR_UNRESOLVED' ? 'BEARING_SPAN_POLICY_UNRESOLVED' : 'BEARING_SPAN_UNRESOLVED');
        const upper = bearingGeometry(db, functional.upperBearingPartId, 'upper');
        const lower = bearingGeometry(db, functional.lowerBearingPartId, 'lower');
        if (upper.unresolved) unresolved.push(`UPPER_${upper.unresolved}`);
        if (lower.unresolved) unresolved.push(`LOWER_${lower.unresolved}`);
        for (const field of ['rotorDiameter', 'stackOffset', 'oilSealDiameter', 'impellerBoreDiameter', 'impellerSpan', 'impellerThickness', 'threadLength', 'threadDiameter']) {
            if (presentNumber(functional[field]) === null) unresolved.push(`${field.toUpperCase()}_UNRESOLVED`);
        }
        const canonicalFunctional = {
            pieceCount, rotorDiameter: functional.rotorDiameter, stackOffset: functional.stackOffset,
            oilSealDiameter: functional.oilSealDiameter, impellerBoreDiameter: functional.impellerBoreDiameter,
            impellerSpan: functional.impellerSpan, impellerThickness: functional.impellerThickness,
            threadLength: functional.threadLength, threadDiameter: functional.threadDiameter,
            barrelLength: functional.barrelLength, openOffset: functional.openOffset,
            bearingSpanExplicit: functional.bearingSpanExplicit, bearingSpan: span.value,
        };
        const rotorPatch = {};
        for (const [field, key] of ROTOR_FIELDS) {
            const value = canonicalFunctional[field];
            if (presentNumber(value) !== null) rotorPatch[key] = String(value);
        }
        if (upper.geometryAvailable) rotorPatch.upper_bearing = upper.engineeringCode;
        if (lower.geometryAvailable) rotorPatch.lower_bearing = lower.engineeringCode;
        return {
            recipeId, mode: 'CANONICAL', profileSchemaVersion: profile.schema_version,
            migrationState: profile.migration_state, completenessState: dto.completeness.state,
            policy: { stainlessMode: policy.stainlessMode, isStainless: policy.isStainless, templateId: policy.templateId, shellPartId: policy.shellPartId },
            relations: { templateId: recipe.template_id ?? null, coilId: recipe.coil_id ?? null, upperBearingPartId: functional.upperBearingPartId, lowerBearingPartId: functional.lowerBearingPartId },
            functional: canonicalFunctional, bearingGeometry: { upper, lower }, rotorPatch,
            provenance: {
                functional: parseObject(profile.provenance_json)?.functional || {},
                pieceCount: { sourceKind: 'DERIVED_COPY_RECIPES_COIL_SHEETS', sourcePath: 'recipes.coil_sheets' },
                bearingSpan: policy.stainlessMode === 'STAINLESS'
                    ? { sourceKind: 'DERIVED_CANONICAL_BARREL_LENGTH_MINUS_OPEN_OFFSET', sourcePaths: ['recipe_functional_technical_profiles.barrel_length', 'recipe_functional_technical_profiles.open_offset'] }
                    : { sourceKind: 'CANONICAL_BEARING_SPAN_EXPLICIT', sourcePath: 'recipe_functional_technical_profiles.bearing_span_explicit' },
                bearingGeometry: { sourceKind: 'DERIVED_FROM_CANONICAL_PART_ID' },
            },
            unresolved: [...new Set(unresolved)],
        };
    }
    return Object.freeze({ buildCanonicalRecipeRotorInput });
}

module.exports = {
    PROFILE_SCHEMA_VERSION,
    ROTOR_FIELDS,
    RecipeTechnicalRotorAdapterError,
    createRecipeTechnicalRotorAdapter,
};
