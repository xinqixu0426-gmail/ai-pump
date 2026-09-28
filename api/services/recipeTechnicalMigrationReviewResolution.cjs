// O4-F-D-B1 resolves only bounded, current migration-review evidence into an
// initially absent canonical aggregate. Existing canonical rows are D-B2 work.
const crypto = require('node:crypto');
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { issueBusinessConfirmation, consumeBusinessConfirmation } = require('./businessConfirmation.cjs');
const { CommandExecutionError, executePersistentCommand } = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const { parsePositiveId } = require('./validation.cjs');
const {
    getFunctionalProfile, getTechnicalKnowledge, persistFunctionalProfile,
    persistTechnicalKnowledge, writeRecipeTechnicalAudit,
} = require('./recipeTechnicalProfileStore.cjs');
const {
    FUNCTIONAL_FIELDS, computeCompleteness, createRecipeTechnicalProfileService,
} = require('./recipeTechnicalProfile.cjs');
const { createRecipeTechnicalMigrationDryRunService } = require('./recipeTechnicalMigrationDryRun.cjs');

const REVIEW_CAPABILITY_ID = requireBusinessCapability('recipes.technical_profile.migration_review_resolve').capabilityId;
const RESOLUTION_VERSION = 'recipe-technical-review-resolution-v1';
const SUPPORTED = new Set([
    'OPEN_OFFSET_OWNER_CONFIRMATION_REQUIRED', 'UPPER_BEARING_PART_AMBIGUOUS',
    'LOWER_BEARING_PART_AMBIGUOUS', 'IMPELLER_THICKNESS_CONFLICT',
    'TECHNICAL_KNOWLEDGE_DUPLICATE_CONFLICT',
]);
const PROFILE_COLUMN_BY_FIELD = Object.freeze({
    rotorDiameter: 'rotor_diameter', stackOffset: 'stack_offset', oilSealDiameter: 'oil_seal_diameter',
    impellerBoreDiameter: 'impeller_bore_diameter', impellerSpan: 'impeller_span',
    impellerThickness: 'impeller_thickness', threadLength: 'thread_length', threadDiameter: 'thread_diameter',
    barrelLength: 'barrel_length', openOffset: 'open_offset', bearingSpanExplicit: 'bearing_span_explicit',
    upperBearingPartId: 'upper_bearing_part_id', lowerBearingPartId: 'lower_bearing_part_id',
});

function error(code, message, statusCode = 409, details) {
    const value = new CommandExecutionError(code, message, statusCode);
    if (details !== undefined) value.details = details;
    return value;
}
function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (plainObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function hash(value) { return crypto.createHash('sha256').update(stableJson(value)).digest('hex'); }
function normalizeRecipeId(value) {
    const recipeId = parsePositiveId(value);
    if (!recipeId) throw error('recipe_id_invalid', '非法配方ID', 400);
    return recipeId;
}
function reviewReasons(assessment) { return assessment.reasons.filter(reason => reason.severity === 'REVIEW'); }

function assertInitialReview(assessment) {
    if (assessment.classification !== 'NEEDS_OWNER_REVIEW' || assessment.actionRequired !== true) {
        throw error('technical_profile_migration_review_not_eligible', '当前配方不是可由 Owner 解决的迁移 review', 409);
    }
    if (assessment.canonical.functionalPresent || assessment.canonical.technicalKnowledgePresent) {
        throw error('technical_profile_migration_review_canonical_exists', 'D-B1 仅能首次创建，已有 canonical 子资源不得合并、补齐或覆盖', 409);
    }
    const blocked = assessment.reasons.filter(reason => reason.severity === 'BLOCKED');
    if (blocked.length) throw error('technical_profile_migration_review_blocked', '当前存在 formal authority 或数据阻断，不能由 Owner review 绕过', 409, { reasons: blocked });
    const reviews = reviewReasons(assessment);
    const unsupported = reviews.filter(reason => !SUPPORTED.has(reason.code));
    if (unsupported.length) throw error('technical_profile_migration_review_unsupported', '当前 review 含不支持的源数据问题，必须先修复来源', 409, { reasons: unsupported });
    if (!reviews.length) throw error('technical_profile_migration_review_not_eligible', '当前没有可解决的 review issue', 409);
    return reviews;
}

function normalizeInput(input) {
    if (!plainObject(input) || Object.keys(input).some(key => key !== 'resolution') || !plainObject(input.resolution)) {
        throw error('technical_profile_migration_review_invalid', 'preview 只能包含 resolution 对象', 400);
    }
    const resolution = input.resolution;
    const allowed = new Set(['openOffset', 'upperBearingPartId', 'lowerBearingPartId', 'impellerThicknessSourcePath', 'technicalKnowledgeSelections']);
    if (Object.keys(resolution).some(key => !allowed.has(key))) throw error('technical_profile_migration_review_invalid', 'resolution 包含不支持字段', 400);
    const normalized = {};
    if (Object.hasOwn(resolution, 'openOffset')) {
        if (typeof resolution.openOffset !== 'number' || !Number.isFinite(resolution.openOffset) || resolution.openOffset < 0) throw error('technical_profile_migration_review_invalid', 'openOffset 必须为非负 JSON number', 422);
        normalized.openOffset = resolution.openOffset;
    }
    for (const field of ['upperBearingPartId', 'lowerBearingPartId']) if (Object.hasOwn(resolution, field)) {
        if (!Number.isInteger(resolution[field]) || resolution[field] <= 0) throw error('technical_profile_migration_review_invalid', `${field} 必须为正整数`, 400);
        normalized[field] = resolution[field];
    }
    if (Object.hasOwn(resolution, 'impellerThicknessSourcePath')) {
        if (typeof resolution.impellerThicknessSourcePath !== 'string' || !resolution.impellerThicknessSourcePath.trim()) throw error('technical_profile_migration_review_invalid', 'impellerThicknessSourcePath 必须为当前 sourcePath', 400);
        normalized.impellerThicknessSourcePath = resolution.impellerThicknessSourcePath;
    }
    if (Object.hasOwn(resolution, 'technicalKnowledgeSelections')) {
        if (!plainObject(resolution.technicalKnowledgeSelections)) throw error('technical_profile_migration_review_invalid', 'technicalKnowledgeSelections 必须为对象', 400);
        normalized.technicalKnowledgeSelections = {};
        for (const [key, selection] of Object.entries(resolution.technicalKnowledgeSelections)) {
            if (!key || !plainObject(selection) || Object.keys(selection).some(field => field !== 'sourcePath') || typeof selection.sourcePath !== 'string' || !selection.sourcePath.trim()) {
                throw error('technical_profile_migration_review_invalid', 'Technical Knowledge 冲突选择必须指定 sourcePath', 400);
            }
            normalized.technicalKnowledgeSelections[key] = { sourcePath: selection.sourcePath };
        }
    }
    return normalized;
}

function proposed(candidate) { return candidate && /^PROPOSED(?:_|$)/u.test(candidate.status) ? candidate.value : null; }
function initialFunctional(assessment) {
    const functional = Object.fromEntries(FUNCTIONAL_FIELDS.map(field => [field, proposed(assessment.candidate.functional[field]) ]));
    for (const [field, position] of [['upperBearingPartId', 'upper'], ['lowerBearingPartId', 'lower']]) {
        const bearing = assessment.candidate.bearings[position];
        functional[field] = bearing.resolutionMode === 'EXACT_UNIQUE' ? bearing.proposedPartId : null;
    }
    return functional;
}
function requiredReviewKeys(reviews) {
    return {
        open: reviews.some(reason => reason.code === 'OPEN_OFFSET_OWNER_CONFIRMATION_REQUIRED'),
        upper: reviews.some(reason => reason.code === 'UPPER_BEARING_PART_AMBIGUOUS'),
        lower: reviews.some(reason => reason.code === 'LOWER_BEARING_PART_AMBIGUOUS'),
        thickness: reviews.some(reason => reason.code === 'IMPELLER_THICKNESS_CONFLICT'),
        knowledge: new Set(reviews.filter(reason => reason.code === 'TECHNICAL_KNOWLEDGE_DUPLICATE_CONFLICT').map(reason => reason.key)),
    };
}
function assertExactKeys(resolution, required) {
    const suppliedKnowledge = new Set(Object.keys(resolution.technicalKnowledgeSelections || {}));
    const expected = new Set(required.knowledge);
    if (required.open !== Object.hasOwn(resolution, 'openOffset')
        || required.upper !== Object.hasOwn(resolution, 'upperBearingPartId')
        || required.lower !== Object.hasOwn(resolution, 'lowerBearingPartId')
        || required.thickness !== Object.hasOwn(resolution, 'impellerThicknessSourcePath')
        || suppliedKnowledge.size !== expected.size || [...suppliedKnowledge].some(key => !expected.has(key))) {
        throw error('technical_profile_migration_review_incomplete', '必须且只能解决当前 assessment 的全部 supported review issues', 409);
    }
}
function currentBearing(db, bearing, selected, position) {
    if (!bearing.candidates.some(candidate => candidate.partId === selected)) throw error('technical_profile_migration_review_invalid', `${position} bearing 必须选当前 ambiguous candidate`, 422);
    const part = db.prepare(`SELECT id, category, deleted_at FROM parts WHERE id = ?`).get(selected);
    if (!part || part.deleted_at || part.category !== '轴承') throw error('technical_profile_migration_review_stale', '已选轴承已失效或类别变化', 409);
}
function selectedThickness(assessment, sourcePath) {
    const candidate = assessment.candidate.functional.impellerThickness;
    const source = [candidate.json, candidate.column].find(item => item?.sourcePath === sourcePath && typeof item.value === 'number' && item.value > 0);
    if (!source) throw error('technical_profile_migration_review_invalid', 'impellerThicknessSourcePath 必须是当前有效冲突来源', 422);
    return source;
}
function selectedKnowledge(assessment, key, sourcePath) {
    const source = (assessment.candidate.technicalKnowledge.migrationEvidence[key] || []).find(item => item.sourcePath === sourcePath);
    if (!source) throw error('technical_profile_migration_review_invalid', `Technical Knowledge ${key} 必须选择当前 evidence sourcePath`, 422);
    return source;
}

function buildResolution(db, assessment, input) {
    const reviews = assertInitialReview(assessment);
    const resolution = normalizeInput(input);
    const required = requiredReviewKeys(reviews);
    assertExactKeys(resolution, required);
    const functional = initialFunctional(assessment);
    const decisions = {};
    if (required.open) {
        if (assessment.policy.stainlessMode !== 'STAINLESS') throw error('technical_profile_migration_review_stale', 'openOffset review 的 formal policy 已变化', 409);
        functional.openOffset = resolution.openOffset;
        if (functional.barrelLength !== null && functional.barrelLength - functional.openOffset <= 0) throw error('technical_profile_migration_review_invalid', 'barrelLength - openOffset 必须大于 0', 422);
        decisions.openOffset = { value: resolution.openOffset, issueCode: 'OPEN_OFFSET_OWNER_CONFIRMATION_REQUIRED' };
    }
    for (const [field, position, code] of [
        ['upperBearingPartId', 'upper', 'UPPER_BEARING_PART_AMBIGUOUS'],
        ['lowerBearingPartId', 'lower', 'LOWER_BEARING_PART_AMBIGUOUS'],
    ]) if (required[position]) {
        const bearing = assessment.candidate.bearings[position];
        currentBearing(db, bearing, resolution[field], position);
        functional[field] = resolution[field];
        decisions[field] = { selectedPartId: resolution[field], issueCode: code, bearing };
    }
    if (required.thickness) {
        const source = selectedThickness(assessment, resolution.impellerThicknessSourcePath);
        functional.impellerThickness = source.value;
        decisions.impellerThickness = { ...source, issueCode: 'IMPELLER_THICKNESS_CONFLICT', allConflictEvidence: [assessment.candidate.functional.impellerThickness.json, assessment.candidate.functional.impellerThickness.column] };
    }
    const items = assessment.candidate.technicalKnowledge.items.map(item => ({ ...item }));
    for (const key of [...required.knowledge].sort()) {
        const source = selectedKnowledge(assessment, key, resolution.technicalKnowledgeSelections[key].sourcePath);
        items.push({ key, label: key, value: source.rawValue });
        decisions[`knowledge:${key}`] = { key, ...source, issueCode: 'TECHNICAL_KNOWLEDGE_DUPLICATE_CONFLICT', allEvidence: assessment.candidate.technicalKnowledge.migrationEvidence[key] };
    }
    items.sort((left, right) => left.key.localeCompare(right.key));
    const completeness = computeCompleteness(db, functional, assessment.policy, true);
    const normalizedResolution = { ...resolution };
    const resolutionFingerprint = hash({ sourceMigrationFingerprint: assessment.migrationFingerprint, normalizedResolution, functional, items, resolutionVersion: RESOLUTION_VERSION });
    return { reviews, normalizedResolution, functional, items, completeness, decisions, resolutionFingerprint };
}

function sourceProvenance(assessment, field, now) {
    const candidate = assessment.candidate.functional[field];
    if (!candidate || candidate.value === null || candidate.value === undefined) return null;
    if (field === 'impellerThickness') {
        return { sourceKind: candidate.status === 'PROPOSED_WITH_COMPATIBILITY_EVIDENCE' ? 'MIGRATED_WITH_COMPATIBILITY_PROVENANCE' : candidate.source,
            sources: [candidate.json, candidate.column].filter(value => value?.value !== null && value?.value !== undefined).map(value => ({ sourceKind: value.source, sourcePath: value.sourcePath, rawValue: value.rawValue, normalizedValue: value.value })),
            migrationVersion: assessment.migrationVersion, migrationFingerprint: assessment.migrationFingerprint, migratedAt: now };
    }
    return { sourceKind: candidate.source, sourcePath: candidate.sourcePath, rawValue: candidate.rawValue, normalizedValue: candidate.value,
        migrationVersion: assessment.migrationVersion, migrationFingerprint: assessment.migrationFingerprint, migratedAt: now };
}
function functionalProvenance(assessment, resolved, auditContext, now) {
    const provenance = {};
    for (const field of FUNCTIONAL_FIELDS) {
        const value = resolved.functional[field];
        if (value === null || value === undefined) continue;
        if (field === 'openOffset' && resolved.decisions.openOffset) {
            provenance[field] = { sourceKind: 'OWNER_CONFIRMED', field, ...resolved.decisions.openOffset, operationId: auditContext.operationId, actorKey: auditContext.user, resolvedAt: now, sourceMigrationVersion: assessment.migrationVersion, sourceMigrationFingerprint: assessment.migrationFingerprint };
        } else if (field.endsWith('PartId') && resolved.decisions[field]) {
            const decision = resolved.decisions[field]; const bearing = decision.bearing;
            provenance[field] = { sourceKind: 'OWNER_SELECTED', position: bearing.position, rawLegacyValue: bearing.rawValue, normalizedLegacyCode: bearing.normalizedBearingCode, candidateCount: bearing.candidates.length, candidateIds: bearing.candidates.map(item => item.partId), selectedPartId: decision.selectedPartId, resolutionMode: 'OWNER_SELECTED_FROM_AMBIGUOUS_CANDIDATES', issueCode: decision.issueCode, operationId: auditContext.operationId, actorKey: auditContext.user, resolvedAt: now, sourceMigrationVersion: assessment.migrationVersion, sourceMigrationFingerprint: assessment.migrationFingerprint };
        } else if (field === 'impellerThickness' && resolved.decisions.impellerThickness) {
            const decision = resolved.decisions.impellerThickness;
            provenance[field] = { sourceKind: 'OWNER_SELECTED', issueCode: decision.issueCode, selectedSourcePath: decision.sourcePath, selectedRawValue: decision.rawValue, selectedNormalizedValue: decision.value, allConflictEvidence: decision.allConflictEvidence, operationId: auditContext.operationId, actorKey: auditContext.user, resolvedAt: now, sourceMigrationVersion: assessment.migrationVersion, sourceMigrationFingerprint: assessment.migrationFingerprint };
        } else if (field.endsWith('PartId')) {
            const bearing = assessment.candidate.bearings[field === 'upperBearingPartId' ? 'upper' : 'lower'];
            provenance[field] = { sourceKind: 'MIGRATED_LEGACY_BEARING_CODE', rawValue: bearing.rawValue, normalizedBearingCode: bearing.normalizedBearingCode, candidateCount: bearing.candidates.length, candidateIds: bearing.candidates.map(item => item.partId), selectedPartId: bearing.proposedPartId, resolutionMode: bearing.resolutionMode, migrationVersion: assessment.migrationVersion, migrationFingerprint: assessment.migrationFingerprint, migratedAt: now };
        } else {
            const source = sourceProvenance(assessment, field, now); if (source) provenance[field] = source;
        }
    }
    return provenance;
}
function baseLegacyEvidence(assessment) {
    const thickness = assessment.candidate.functional.impellerThickness;
    const raw = assessment.candidate.functional.openOffset?.rawValue;
    const shell = plainObject(raw) && (raw.openOffset !== null || raw.openFactor !== null) ? {
        openOffset: { sourcePath: 'parts.remark.openOffset', rawValue: raw.openOffset ?? null },
        openFactor: { sourcePath: 'parts.remark.openFactor', rawValue: raw.openFactor ?? null },
    } : null;
    return { schema: 'recipe-technical-migration-legacy-evidence-v1', migrationVersion: assessment.migrationVersion, migrationFingerprint: assessment.migrationFingerprint,
        bearingEvidence: Object.fromEntries(['upper', 'lower'].map(position => [position, (() => { const bearing = assessment.candidate.bearings[position]; return { rawValue: bearing.rawValue, normalizedBearingCode: bearing.normalizedBearingCode, resolutionMode: bearing.resolutionMode, candidateIds: bearing.candidates.map(item => item.partId), selectedPartId: bearing.proposedPartId, geometryAvailable: bearing.geometryAvailable }; })()])),
        thicknessEvidence: { json: thickness?.json ? { sourcePath: thickness.json.sourcePath, rawValue: thickness.json.rawValue, normalizedValue: thickness.json.value } : null, column: thickness?.column ? { sourcePath: thickness.column.sourcePath, rawValue: thickness.column.rawValue, normalizedValue: thickness.column.value } : null },
        spanAssessment: assessment.spanAssessment, pumpShellCompatibilityEvidence: shell, technicalKnowledgeMigrationEvidence: assessment.candidate.technicalKnowledge.migrationEvidence };
}
function buildRows(recipeId, assessment, resolved, auditContext, now) {
    const provenance = { schema: RESOLUTION_VERSION, resolutionVersion: RESOLUTION_VERSION, sourceMigrationVersion: assessment.migrationVersion, sourceMigrationFingerprint: assessment.migrationFingerprint, resolutionFingerprint: resolved.resolutionFingerprint, resolvedAt: now, functional: functionalProvenance(assessment, resolved, auditContext, now) };
    const legacyEvidence = { ...baseLegacyEvidence(assessment), reviewResolution: { resolutionVersion: RESOLUTION_VERSION, sourceMigrationVersion: assessment.migrationVersion, sourceMigrationFingerprint: assessment.migrationFingerprint, resolutionFingerprint: resolved.resolutionFingerprint, reviewIssues: resolved.reviews.map(reason => reason.code), decisions: resolved.decisions } };
    const profile = { recipe_id: recipeId, ...Object.fromEntries(FUNCTIONAL_FIELDS.map(field => [PROFILE_COLUMN_BY_FIELD[field], resolved.functional[field] ?? null])), schema_version: 1, completeness_state: resolved.completeness.state, migration_state: 'ALREADY_CANONICAL', migration_version: null, migration_fingerprint: null, provenance_json: JSON.stringify(provenance), legacy_evidence_json: JSON.stringify(legacyEvidence), created_at: now, updated_at: now };
    const knowledge = { recipe_id: recipeId, schema_version: 1, items_json: JSON.stringify(resolved.items.map(item => {
        const decision = resolved.decisions[`knowledge:${item.key}`];
        return { ...item, source: decision ? { sourceKind: 'OWNER_SELECTED', issueCode: decision.issueCode, selectedSourcePath: decision.sourcePath, allEvidence: decision.allEvidence, operationId: auditContext.operationId, actorKey: auditContext.user, resolvedAt: now, sourceMigrationVersion: assessment.migrationVersion, sourceMigrationFingerprint: assessment.migrationFingerprint } : { sourceKind: 'MIGRATED_TECHNICAL_KNOWLEDGE', sources: assessment.candidate.technicalKnowledge.migrationEvidence[item.key] || [], migrationVersion: assessment.migrationVersion, migrationFingerprint: assessment.migrationFingerprint, migratedAt: now } }; })), created_at: now, updated_at: now };
    return { profile, knowledge };
}
function decisionSnapshot(assessment, resolved) {
    return { recipeId: assessment.recipeId, sourceMigrationVersion: assessment.migrationVersion, sourceMigrationFingerprint: assessment.migrationFingerprint, reviewIssues: resolved.reviews.map(reason => reason.code), normalizedResolution: resolved.normalizedResolution, resolvedTarget: { migrationState: 'ALREADY_CANONICAL', completenessState: resolved.completeness.state, functional: resolved.functional, technicalKnowledge: resolved.items }, expectedUpdatedAt: null, resolutionVersion: RESOLUTION_VERSION, resolutionFingerprint: resolved.resolutionFingerprint };
}
function assertApplyInput(input) {
    if (!plainObject(input) || Object.keys(input).some(key => !['confirmationToken', 'idempotencyKey'].includes(key) || typeof input[key] !== 'string' || !input[key].trim())) throw error('technical_profile_migration_review_invalid', 'resolve 只能包含 confirmationToken 与 idempotencyKey', 400);
    return { confirmationToken: input.confirmationToken.trim(), idempotencyKey: input.idempotencyKey.trim() };
}

function createRecipeTechnicalMigrationReviewResolutionService(dependencies = {}) {
    const db = dependencies.db; if (!db) throw new Error('Recipe technical migration review resolution 缺少 db');
    const dryRun = dependencies.dryRunService || createRecipeTechnicalMigrationDryRunService({ db });
    const canonical = dependencies.canonicalProfileService || createRecipeTechnicalProfileService({ db });
    const persistProfile = dependencies.persistFunctionalProfile || persistFunctionalProfile;
    const persistKnowledge = dependencies.persistTechnicalKnowledge || persistTechnicalKnowledge;
    const auditWriter = dependencies.writeAuditLog || ((action, table, recipeId, before, after, context, now) => writeRecipeTechnicalAudit(db, action, table, recipeId, before, after, context, now));
    const persistentCommand = dependencies.executePersistentCommand || executePersistentCommand;
    const clock = dependencies.now || (() => new Date());
    function preview(recipeIdValue, input, context = {}) {
        const recipeId = normalizeRecipeId(recipeIdValue); const assessment = dryRun.assess(recipeId); const resolved = buildResolution(db, assessment, input); const decision = decisionSnapshot(assessment, resolved);
        const confirmation = issueBusinessConfirmation({ capabilityId: REVIEW_CAPABILITY_ID, input: decision, subject: context.subject || context.actorKey });
        return { preview: true, capabilityId: REVIEW_CAPABILITY_ID, ...confirmation, ...decision, suggestedIdempotencyKey: `recipe-technical-review:${confirmation.operationId}` };
    }
    function apply(recipeIdValue, input, context = {}) {
        const recipeId = normalizeRecipeId(recipeIdValue); const parsed = assertApplyInput(input); const subject = context.subject || context.actorKey;
        const confirmation = consumeBusinessConfirmation({ confirmationToken: parsed.confirmationToken, capabilityId: REVIEW_CAPABILITY_ID, subject, idempotencyKey: parsed.idempotencyKey });
        if (confirmation.input.recipeId !== recipeId || (context.idempotencyKey && context.idempotencyKey !== parsed.idempotencyKey)) throw error('confirmation_payload_mismatch', '确认凭证与当前 Recipe 或 idempotencyKey 不匹配', 409);
        const commandNow = new Date(clock());
        return persistentCommand({ db, ...context, actorKey: context.actorKey || subject, capabilityId: REVIEW_CAPABILITY_ID, operationId: confirmation.operationId, idempotencyKey: parsed.idempotencyKey, input: confirmation.input, now: commandNow, requestKnowledgeSync: () => {}, businessChange: standardBusinessChange({ domain: 'recipe', eventType: 'updated', reason: 'canonical technical migration owner review resolution', entityRefs: () => [{ entityType: 'recipe', entityId: recipeId, role: 'primary' }] }), execute: ({ auditContext }) => {
            if (getFunctionalProfile(db, recipeId) || getTechnicalKnowledge(db, recipeId)) throw error('technical_profile_migration_review_stale', 'canonical 子资源已在预览后出现，D-B1 不得覆盖', 409);
            const assessment = dryRun.assess(recipeId); const resolved = buildResolution(db, assessment, { resolution: confirmation.input.normalizedResolution }); const current = decisionSnapshot(assessment, resolved);
            if (stableJson(current) !== stableJson(confirmation.input)) throw error('technical_profile_migration_review_stale', '迁移来源、候选、policy 或 Owner 决策在预览后发生变化', 409);
            if (getFunctionalProfile(db, recipeId) || getTechnicalKnowledge(db, recipeId)) throw error('technical_profile_migration_review_stale', 'canonical 子资源已在预览后出现，D-B1 不得覆盖', 409);
            const now = commandNow.toISOString(); const rows = buildRows(recipeId, assessment, resolved, auditContext, now);
            const profileWrite = persistProfile(db, rows.profile); const knowledgeWrite = persistKnowledge(db, rows.knowledge);
            if (!profileWrite.changed || !knowledgeWrite.changed || profileWrite.action !== 'INSERT' || knowledgeWrite.action !== 'INSERT') throw error('technical_profile_migration_review_write_invalid', 'D-B1 必须原子首次创建两个 canonical 子资源', 500);
            const auditIds = [auditWriter('INSERT', 'recipe_functional_technical_profiles', recipeId, profileWrite.before, profileWrite.after, auditContext, now), auditWriter('INSERT', 'recipe_technical_knowledge', recipeId, knowledgeWrite.before, knowledgeWrite.after, auditContext, now)];
            const profile = getFunctionalProfile(db, recipeId); const knowledge = getTechnicalKnowledge(db, recipeId);
            if (!profile || !knowledge || profile.migration_state !== 'ALREADY_CANONICAL' || profile.migration_version !== null || profile.migration_fingerprint !== null || profile.completeness_state !== resolved.completeness.state || stableJson(JSON.parse(knowledge.items_json).map(item => { const copy = { ...item }; delete copy.source; return copy; })) !== stableJson(resolved.items)) throw error('technical_profile_migration_review_readback_failed', 'Owner review canonical 读回校验失败，已回滚', 500);
            for (const field of FUNCTIONAL_FIELDS) if ((profile[PROFILE_COLUMN_BY_FIELD[field]] ?? null) !== (resolved.functional[field] ?? null)) throw error('technical_profile_migration_review_readback_failed', `Functional ${field} 读回不一致`, 500);
            const dto = canonical.get(recipeId); const post = dryRun.assess(recipeId);
            if (post.classification !== 'ALREADY_CANONICAL' || post.target.writeEligible !== false || !post.reasons.some(reason => reason.code === 'CANONICAL_OWNER_AUTHORITY')) throw error('technical_profile_migration_review_post_verify_failed', 'Owner canonical post-write dry-run 校验失败，已回滚', 500);
            return { data: { recipeId, resolutionVersion: RESOLUTION_VERSION, sourceMigrationVersion: assessment.migrationVersion, sourceMigrationFingerprint: assessment.migrationFingerprint, resolvedIssueCodes: resolved.reviews.map(reason => reason.code), migrationStateAfter: 'ALREADY_CANONICAL', technicalProfile: dto, postWriteDryRun: { classification: post.classification, writeEligible: post.target.writeEligible } }, resource: { type: 'recipeTechnicalProfile', ids: [recipeId] }, changes: [{ resourceType: 'recipe', resourceId: recipeId, field: 'technicalProfile' }, { resourceType: 'recipe', resourceId: recipeId, field: 'technicalKnowledge' }], auditIds, requiredAuditCount: 2 };
        } });
    }
    return Object.freeze({ preview, apply });
}
module.exports = { REVIEW_CAPABILITY_ID, RESOLUTION_VERSION, SUPPORTED_REVIEW_ISSUES: Object.freeze([...SUPPORTED]), createRecipeTechnicalMigrationReviewResolutionService };
