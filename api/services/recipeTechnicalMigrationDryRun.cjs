const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { parsePositiveId } = require('./validation.cjs');
const { bearingCodeOf } = require('./catalogSpec.cjs');
const { BEARING_DB, normalizeBearing, validateFcParam } = require('./rotorParameters.cjs');
const { getFunctionalProfile, getTechnicalKnowledge } = require('./recipeTechnicalProfileStore.cjs');
const { resolveStainlessMode } = require('./recipeTechnicalProfile.cjs');

const DRY_RUN_CAPABILITY_ID = requireBusinessCapability('recipes.technical_profile.migration_dry_run').capabilityId;
const REVIEW_QUEUE_CAPABILITY_ID = requireBusinessCapability('recipes.technical_profile.migration_review_queue').capabilityId;
const MIGRATION_ALGORITHM_VERSION = 'recipe-technical-migration-dry-run-v1';
const MAX_PAGE_SIZE = 100;
const FUNCTIONAL_JSON_FIELDS = Object.freeze([
    ['rotorDiameter', 'rotor_dia'],
    ['stackOffset', 'stack_offset'],
    ['oilSealDiameter', 'oil_seal_dia'],
    ['impellerBoreDiameter', 'impeller_dia'],
    ['impellerSpan', 'impeller_span'],
    ['threadLength', 'thread_length'],
    ['threadDiameter', 'thread_dia'],
]);
const FUNCTIONAL_CONTROL_KEYS = new Set([
    ...FUNCTIONAL_JSON_FIELDS.map(([key]) => key),
    'bearingSpan', 'impellerDepth', 'upperBearing', 'lowerBearing', 'pieceCount',
    'openOffset', 'openFactor', 'barrelLength', 'isStainless',
]);
class MigrationDryRunError extends Error {
    constructor(code, message, statusCode = 400, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        if (details !== undefined) this.details = details;
    }
}

function error(code, message, statusCode = 400, details) {
    return new MigrationDryRunError(code, message, statusCode, details);
}

function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function jsonSafe(value, depth = 0) {
    if (depth > 8) return false;
    if (value === null || ['string', 'boolean'].includes(typeof value)) return typeof value !== 'string' || value.length <= 4000;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length <= 100 && value.every(item => jsonSafe(item, depth + 1));
    if (!plainObject(value)) return false;
    const keys = Object.keys(value);
    return keys.length <= 50 && keys.every(key => key.length <= 100 && jsonSafe(value[key], depth + 1));
}

function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (plainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function fingerprint(snapshot) {
    return crypto.createHash('sha256').update(canonicalJson(snapshot)).digest('hex');
}

function parseLegacyTechnicalJson(raw) {
    if (raw === null || raw === undefined || raw === '') return { value: {}, valid: true, raw: raw || '{}' };
    try {
        const value = JSON.parse(raw);
        return plainObject(value)
            ? { value, valid: true, raw }
            : { value: {}, valid: false, raw };
    } catch {
        return { value: {}, valid: false, raw };
    }
}

function parseJsonObject(raw) {
    try {
        const value = JSON.parse(raw || '{}');
        return plainObject(value) ? value : {};
    } catch {
        return {};
    }
}

function isJsonObject(raw) {
    try { return plainObject(JSON.parse(raw || '{}')); } catch { return false; }
}

function isJsonArray(raw) {
    try { return Array.isArray(JSON.parse(raw || '[]')); } catch { return false; }
}

function normalizeRecipeId(value) {
    const recipeId = parsePositiveId(value);
    if (!recipeId) throw error('recipe_id_invalid', '非法配方ID');
    return recipeId;
}

function normalizePageValue(value, fallback, max, name) {
    if (value === undefined || value === null || value === '') return fallback;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(String(value))) throw error('technical_profile_migration_query_invalid', `${name} 必须是非负整数`);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number > max) throw error('technical_profile_migration_query_invalid', `${name} 超出允许范围`);
    return number;
}

function normalizeCollectionQuery(input = {}) {
    if (!plainObject(input)) throw error('technical_profile_migration_query_invalid', '查询参数必须是对象');
    if (Object.keys(input).some(key => !['limit', 'offset'].includes(key))) throw error('technical_profile_migration_query_invalid', '查询参数包含不支持字段');
    return {
        limit: Math.max(1, normalizePageValue(input.limit, 50, MAX_PAGE_SIZE, 'limit')),
        offset: normalizePageValue(input.offset, 0, Number.MAX_SAFE_INTEGER, 'offset'),
    };
}

function candidate(value, source, sourcePath, rawValue, status = 'PROPOSED', extra = {}) {
    return { value, source, sourcePath, rawValue: rawValue ?? null, status, ...extra };
}

function parseMigrationNumeric(rawValue, rotorKey) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return candidate(null, null, null, rawValue, 'MISSING');
    const value = validateFcParam(rotorKey, rawValue);
    if (value === null) return candidate(null, 'MIGRATED_RECIPE_TECHNICAL_JSON', null, rawValue, 'INVALID');
    return candidate(value, 'MIGRATED_RECIPE_TECHNICAL_JSON', null, rawValue);
}

function parseColumnNumeric(rawValue, field) {
    if (rawValue === undefined || rawValue === null || rawValue === '') return candidate(null, null, null, rawValue, 'MISSING');
    if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue <= 0) {
        return candidate(null, 'MIGRATED_RECIPE_COLUMN', null, rawValue, 'INVALID');
    }
    return candidate(rawValue, 'MIGRATED_RECIPE_COLUMN', null, rawValue, 'PROPOSED', { field });
}

function addReason(reasons, code, severity, details = {}) {
    reasons.push({ code, severity, ...details });
}

function buildDirectFunctionalCandidates(technical, recipe, reasons) {
    const functional = {};
    for (const [field, rotorKey] of FUNCTIONAL_JSON_FIELDS) {
        const result = parseMigrationNumeric(technical[field], rotorKey);
        functional[field] = { ...result, sourcePath: result.sourcePath || `recipes.technical_data_json.${field}` };
        if (result.status === 'INVALID') addReason(reasons, `${field.toUpperCase()}_INVALID`, 'REVIEW', { field });
    }
    const barrelLength = parseColumnNumeric(recipe.custom_barrel_length, 'barrelLength');
    functional.barrelLength = { ...barrelLength, sourcePath: 'recipes.custom_barrel_length' };
    if (barrelLength.status === 'INVALID') addReason(reasons, 'BARREL_LENGTH_INVALID', 'REVIEW');
    return functional;
}

function bearingCandidates(db, rawValue, position) {
    const normalizedBearingCode = normalizeBearing(rawValue);
    if (rawValue === undefined || rawValue === null || rawValue === '') {
        return { position, rawValue: rawValue ?? null, normalizedBearingCode: null, resolutionMode: 'MISSING', candidates: [], proposedPartId: null, geometryAvailable: false };
    }
    if (!normalizedBearingCode) {
        return { position, rawValue, normalizedBearingCode: null, resolutionMode: 'INVALID', candidates: [], proposedPartId: null, geometryAvailable: false };
    }
    const candidates = db.prepare(`
        SELECT id, model, supplier, naming_json
        FROM parts
        WHERE category = '轴承' AND deleted_at IS NULL
        ORDER BY id ASC
    `).all().map(part => ({
        partId: Number(part.id), model: part.model, supplier: part.supplier,
        normalizedBearingCode: normalizeBearing(bearingCodeOf(part)),
    })).filter(part => part.normalizedBearingCode === normalizedBearingCode);
    if (candidates.length === 1) {
        return {
            position, rawValue, normalizedBearingCode, resolutionMode: 'EXACT_UNIQUE',
            candidates, proposedPartId: candidates[0].partId,
            geometryAvailable: Boolean(BEARING_DB[normalizedBearingCode]),
        };
    }
    return {
        position, rawValue, normalizedBearingCode,
        resolutionMode: candidates.length === 0 ? 'NOT_FOUND' : 'AMBIGUOUS',
        candidates, proposedPartId: null, geometryAvailable: false,
    };
}

function buildBearingCandidates(db, technical, reasons) {
    const upper = bearingCandidates(db, technical.upperBearing, 'upper');
    const lower = bearingCandidates(db, technical.lowerBearing, 'lower');
    for (const item of [upper, lower]) {
        if (item.resolutionMode === 'NOT_FOUND' || item.resolutionMode === 'INVALID') addReason(reasons, `${item.position.toUpperCase()}_BEARING_PART_NOT_FOUND`, 'BLOCKED', { bearing: item });
        if (item.resolutionMode === 'AMBIGUOUS') addReason(reasons, `${item.position.toUpperCase()}_BEARING_PART_AMBIGUOUS`, 'REVIEW', { bearing: item });
        if (item.resolutionMode === 'EXACT_UNIQUE' && !item.geometryAvailable) addReason(reasons, `${item.position.toUpperCase()}_BEARING_GEOMETRY_UNRESOLVED`, 'INCOMPLETE', { bearing: item });
    }
    return { upper, lower };
}

function buildThicknessCandidate(technical, recipe, reasons) {
    const jsonCandidate = parseMigrationNumeric(technical.impellerDepth, 'impeller_depth');
    const columnCandidate = parseColumnNumeric(recipe.impeller_thickness, 'impellerThickness');
    const jsonPresent = jsonCandidate.status === 'PROPOSED';
    const columnPresent = columnCandidate.status === 'PROPOSED';
    const base = {
        json: { ...jsonCandidate, sourcePath: 'recipes.technical_data_json.impellerDepth' },
        column: { ...columnCandidate, sourcePath: 'recipes.impeller_thickness' },
    };
    if (!jsonPresent && !columnPresent) {
        if (jsonCandidate.status === 'INVALID' || columnCandidate.status === 'INVALID') addReason(reasons, 'IMPELLER_THICKNESS_INVALID', 'REVIEW', base);
        return { ...base, value: null, source: null, status: jsonCandidate.status === 'INVALID' || columnCandidate.status === 'INVALID' ? 'INVALID' : 'MISSING' };
    }
    if (jsonPresent && !columnPresent) return { ...base, value: jsonCandidate.value, source: 'MIGRATED_RECIPE_TECHNICAL_JSON', status: 'PROPOSED' };
    if (!jsonPresent && columnPresent) return { ...base, value: columnCandidate.value, source: 'MIGRATED_RECIPE_COLUMN', status: 'PROPOSED' };
    if (jsonCandidate.value === columnCandidate.value) {
        return { ...base, value: jsonCandidate.value, source: 'MIGRATED_RECIPE_TECHNICAL_JSON', status: 'PROPOSED_WITH_COMPATIBILITY_EVIDENCE' };
    }
    addReason(reasons, 'IMPELLER_THICKNESS_CONFLICT', 'REVIEW', base);
    return { ...base, value: null, source: null, status: 'CONFLICT' };
}

function buildConditionalCandidates(technical, policy, barrelLength, shellCompatibility, reasons) {
    const bearingSpan = parseMigrationNumeric(technical.bearingSpan, 'bearing_span');
    const result = {
        barrelLength,
        openOffset: candidate(null, 'COMPATIBILITY_MIGRATION_CANDIDATE', 'parts.remark.openOffset', shellCompatibility, 'NOT_PROPOSED_COMPATIBILITY_ONLY'),
        bearingSpanExplicit: { ...bearingSpan, sourcePath: 'recipes.technical_data_json.bearingSpan' },
        stainlessBearingSpanEvidence: { rawValue: technical.bearingSpan ?? null, status: 'NOT_APPLICABLE' },
    };
    if (policy.stainlessMode === 'STAINLESS') {
        result.bearingSpanExplicit = candidate(null, null, 'recipes.technical_data_json.bearingSpan', technical.bearingSpan, 'NOT_PROPOSED_DERIVED_ONLY');
        result.stainlessBearingSpanEvidence = { rawValue: technical.bearingSpan ?? null, status: 'COMPARISON_EVIDENCE_ONLY' };
        addReason(reasons, 'OPEN_OFFSET_OWNER_CONFIRMATION_REQUIRED', 'REVIEW', { sourcePath: 'parts.remark.openOffset' });
    } else if (policy.stainlessMode === 'NON_STAINLESS') {
        result.barrelLength = candidate(null, null, 'recipes.custom_barrel_length', barrelLength.rawValue, 'NOT_APPLICABLE');
        if (bearingSpan.status === 'INVALID') addReason(reasons, 'BEARING_SPAN_EXPLICIT_INVALID', 'REVIEW');
    } else {
        result.barrelLength = candidate(null, null, 'recipes.custom_barrel_length', barrelLength.rawValue, 'NOT_PROPOSED_POLICY_UNRESOLVED');
        result.bearingSpanExplicit = candidate(null, null, 'recipes.technical_data_json.bearingSpan', technical.bearingSpan, 'NOT_PROPOSED_POLICY_UNRESOLVED');
        addReason(reasons, 'STAINLESS_POLICY_UNRESOLVED', 'BLOCKED', { policyReason: policy.reasonCode });
    }
    return result;
}

function addKnowledgeItem(items, key, value, source, sourcePath) {
    if (value === undefined || value === null || value === '' || !jsonSafe(value)) return;
    const existing = items.get(key);
    const evidence = { source, sourcePath, rawValue: value };
    if (!existing) {
        items.set(key, { key, label: key, value, provenance: [evidence] });
    } else if (canonicalJson(existing.value) === canonicalJson(value)) {
        existing.provenance.push(evidence);
    } else {
        existing.provenance.push({ ...evidence, conflict: true });
        existing.conflict = true;
    }
}

function buildKnowledgeCandidates(technical, recipe, reasons) {
    const items = new Map();
    for (const [key, value] of Object.entries(technical)) {
        if (FUNCTIONAL_CONTROL_KEYS.has(key)) continue;
        addKnowledgeItem(items, key, value, 'MIGRATED_RECIPE_TECHNICAL_JSON', `recipes.technical_data_json.${key}`);
    }
    for (const [column, key] of [
        ['impeller_model', 'impellerModel'], ['impeller_diameter', 'impellerDiameter'], ['impeller_blade_count', 'impellerBladeCount'],
    ]) addKnowledgeItem(items, key, recipe[column], 'MIGRATED_RECIPE_COLUMN', `recipes.${column}`);
    const ordered = [...items.values()].sort((left, right) => left.key.localeCompare(right.key));
    for (const item of ordered.filter(item => item.conflict)) addReason(reasons, 'TECHNICAL_KNOWLEDGE_DUPLICATE_CONFLICT', 'REVIEW', { key: item.key, provenance: item.provenance });
    return ordered;
}

function canonicalState(profile, knowledge) {
    const both = Boolean(profile && knowledge);
    const partial = Boolean(profile || knowledge) && !both;
    return {
        functionalPresent: Boolean(profile), technicalKnowledgePresent: Boolean(knowledge),
        aggregateUpdatedAt: [profile?.updated_at, knowledge?.updated_at].filter(Boolean).sort().at(-1) || null,
        functionalSchemaVersion: profile?.schema_version ?? null,
        knowledgeSchemaVersion: knowledge?.schema_version ?? null,
        completenessState: profile?.completeness_state ?? null,
        migrationState: profile?.migration_state ?? null,
        supported: both && profile.schema_version >= 1 && knowledge.schema_version >= 1
            && isJsonObject(profile.provenance_json) && isJsonArray(knowledge.items_json),
        partial,
    };
}

function classify(canonical, reasons, compatibilityEvidence) {
    if (canonical.supported) return 'ALREADY_CANONICAL';
    if (canonical.partial) return 'NEEDS_OWNER_REVIEW';
    if (reasons.some(reason => reason.severity === 'REVIEW')) return 'NEEDS_OWNER_REVIEW';
    if (reasons.some(reason => reason.severity === 'BLOCKED')) return 'BLOCKED_UNRESOLVED';
    if (compatibilityEvidence) return 'MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE';
    return 'AUTO_MIGRATABLE';
}

function loadRecipe(db, recipeId) {
    const recipe = db.prepare(`
        SELECT id, name, template_id, coil_sheets, custom_barrel_length,
               impeller_model, impeller_thickness, impeller_diameter, impeller_blade_count,
               technical_data_json, deleted_at
        FROM recipes WHERE id = ? AND deleted_at IS NULL
    `).get(recipeId);
    if (!recipe) throw error('recipe_not_found', '配方不存在', 404);
    return recipe;
}

function snapshotShell(db, policy) {
    if (!policy.shellPartId) return null;
    return db.prepare('SELECT id, category, remark, deleted_at FROM parts WHERE id = ?').get(policy.shellPartId) || null;
}

function buildAssessment(db, recipe) {
    const profile = getFunctionalProfile(db, recipe.id);
    const knowledge = getTechnicalKnowledge(db, recipe.id);
    const canonical = canonicalState(profile, knowledge);
    const parsed = parseLegacyTechnicalJson(recipe.technical_data_json);
    const policy = resolveStainlessMode(db, recipe.id, recipe);
    const reasons = [];
    if (!parsed.valid) addReason(reasons, 'TECHNICAL_DATA_JSON_INVALID', 'REVIEW');
    if (canonical.partial) addReason(reasons, 'CANONICAL_STORAGE_PARTIAL', 'REVIEW', canonical);
    const functional = buildDirectFunctionalCandidates(parsed.value, recipe, reasons);
    const bearings = buildBearingCandidates(db, parsed.value, reasons);
    const impellerThickness = buildThicknessCandidate(parsed.value, recipe, reasons);
    const shell = snapshotShell(db, policy);
    const shellMetadata = parseJsonObject(shell?.remark);
    const conditional = buildConditionalCandidates(
        parsed.value,
        policy,
        functional.barrelLength,
        { openOffset: shellMetadata.openOffset ?? null, openFactor: shellMetadata.openFactor ?? null },
        reasons,
    );
    const technicalKnowledge = buildKnowledgeCandidates(parsed.value, recipe, reasons);
    functional.impellerThickness = impellerThickness;
    functional.barrelLength = conditional.barrelLength;
    functional.openOffset = conditional.openOffset;
    functional.bearingSpanExplicit = conditional.bearingSpanExplicit;
    functional.upperBearingPartId = candidate(bearings.upper.proposedPartId, bearings.upper.resolutionMode === 'EXACT_UNIQUE' ? 'MIGRATED_LEGACY_BEARING_CODE' : null, 'recipes.technical_data_json.upperBearing', bearings.upper.rawValue, bearings.upper.resolutionMode);
    functional.lowerBearingPartId = candidate(bearings.lower.proposedPartId, bearings.lower.resolutionMode === 'EXACT_UNIQUE' ? 'MIGRATED_LEGACY_BEARING_CODE' : null, 'recipes.technical_data_json.lowerBearing', bearings.lower.rawValue, bearings.lower.resolutionMode);
    const compatibilityEvidence = impellerThickness.status === 'PROPOSED_WITH_COMPATIBILITY_EVIDENCE'
        || technicalKnowledge.some(item => item.provenance.length > 1);
    const classification = classify(canonical, reasons, compatibilityEvidence);
    const migrationSnapshot = {
        algorithmVersion: MIGRATION_ALGORITHM_VERSION,
        recipe: {
            id: Number(recipe.id), templateId: recipe.template_id ?? null, coilSheets: recipe.coil_sheets ?? null,
            customBarrelLength: recipe.custom_barrel_length ?? null, impellerModel: recipe.impeller_model ?? null,
            impellerThickness: recipe.impeller_thickness ?? null, impellerDiameter: recipe.impeller_diameter ?? null,
            impellerBladeCount: recipe.impeller_blade_count ?? null, technicalDataJson: recipe.technical_data_json ?? null,
        },
        canonical,
        policy: { ...policy, shellRemark: shell?.remark ?? null, shellCategory: shell?.category ?? null, shellDeletedAt: shell?.deleted_at ?? null },
        bearingCandidates: { upper: bearings.upper, lower: bearings.lower },
        thickness: impellerThickness,
    };
    return {
        recipeId: Number(recipe.id), recipeName: recipe.name,
        algorithmVersion: MIGRATION_ALGORITHM_VERSION,
        classification,
        actionRequired: ['NEEDS_OWNER_REVIEW', 'BLOCKED_UNRESOLVED'].includes(classification),
        canonical,
        policy,
        sourceSnapshot: {
            technicalDataJson: { raw: parsed.raw, validObject: parsed.valid },
            customBarrelLength: recipe.custom_barrel_length ?? null,
            coilSheets: recipe.coil_sheets ?? null,
            pieceCount: { value: recipe.coil_sheets ?? null, source: 'DERIVED_COPY_RECIPES_COIL_SHEETS', storedMigrationCandidate: false },
        },
        candidate: {
            functional,
            bearings,
            technicalKnowledge: { items: technicalKnowledge },
            stainlessBearingSpanEvidence: conditional.stainlessBearingSpanEvidence,
        },
        reasons: reasons.sort((left, right) => left.code.localeCompare(right.code)),
        fingerprint: fingerprint(migrationSnapshot),
    };
}

function summarize(items) {
    const classifications = Object.fromEntries(['ALREADY_CANONICAL', 'AUTO_MIGRATABLE', 'MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE', 'NEEDS_OWNER_REVIEW', 'BLOCKED_UNRESOLVED'].map(key => [key, 0]));
    for (const item of items) classifications[item.classification] += 1;
    return { total: items.length, classifications, actionRequired: items.filter(item => item.actionRequired).length };
}

function createRecipeTechnicalMigrationDryRunService(dependencies) {
    const db = dependencies?.db;
    if (!db) throw new Error('Recipe technical migration dry run 缺少 db');

    function assess(recipeIdValue) {
        const recipeId = normalizeRecipeId(recipeIdValue);
        return buildAssessment(db, loadRecipe(db, recipeId));
    }

    function list(input = {}) {
        const { limit, offset } = normalizeCollectionQuery(input);
        const rows = db.prepare(`
            SELECT id, name, template_id, coil_sheets, custom_barrel_length,
                   impeller_model, impeller_thickness, impeller_diameter, impeller_blade_count,
                   technical_data_json, deleted_at
            FROM recipes WHERE deleted_at IS NULL
            ORDER BY id ASC LIMIT ? OFFSET ?
        `).all(limit + 1, offset);
        const hasMore = rows.length > limit;
        const items = rows.slice(0, limit).map(recipe => buildAssessment(db, recipe));
        const activeRecipeCount = Number(db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE deleted_at IS NULL').get().count);
        return {
            capabilityId: DRY_RUN_CAPABILITY_ID,
            items,
            summary: summarize(items),
            cohort: { activeRecipeCount },
            page: { limit, offset, hasMore, nextOffset: hasMore ? offset + limit : null },
        };
    }

    function reviewQueue(input = {}) {
        const { limit, offset } = normalizeCollectionQuery(input);
        const selectRows = db.prepare(`
            SELECT id, name, template_id, coil_sheets, custom_barrel_length,
                   impeller_model, impeller_thickness, impeller_diameter, impeller_blade_count,
                   technical_data_json, deleted_at
            FROM recipes WHERE deleted_at IS NULL
            ORDER BY id ASC LIMIT ? OFFSET ?
        `);
        const items = [];
        let skipped = 0;
        let scanned = 0;
        let hasMore = false;
        while (!hasMore) {
            const rows = selectRows.all(MAX_PAGE_SIZE, scanned);
            if (rows.length === 0) break;
            scanned += rows.length;
            for (const recipe of rows) {
                const assessment = buildAssessment(db, recipe);
                if (!assessment.actionRequired) continue;
                if (skipped < offset) {
                    skipped += 1;
                    continue;
                }
                if (items.length < limit) items.push(assessment);
                else {
                    hasMore = true;
                    break;
                }
            }
            if (rows.length < MAX_PAGE_SIZE) break;
        }
        const activeRecipeCount = Number(db.prepare('SELECT COUNT(*) AS count FROM recipes WHERE deleted_at IS NULL').get().count);
        return {
            capabilityId: REVIEW_QUEUE_CAPABILITY_ID,
            items,
            summary: summarize(items),
            cohort: { activeRecipeCount },
            page: { limit, offset, hasMore, nextOffset: hasMore ? offset + limit : null, returned: items.length },
        };
    }

    return Object.freeze({ assess, list, reviewQueue });
}

module.exports = {
    DRY_RUN_CAPABILITY_ID,
    REVIEW_QUEUE_CAPABILITY_ID,
    MIGRATION_ALGORITHM_VERSION,
    MigrationDryRunError,
    createRecipeTechnicalMigrationDryRunService,
};
