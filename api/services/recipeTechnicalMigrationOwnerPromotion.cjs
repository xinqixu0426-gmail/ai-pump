// O4-F-D-B2 only promotes a full, source-drifted migrated aggregate to Owner
// authority. It never imports or writes the newer legacy values.
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { issueBusinessConfirmation, consumeBusinessConfirmation } = require('./businessConfirmation.cjs');
const { CommandExecutionError, executePersistentCommand } = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const { parsePositiveId } = require('./validation.cjs');
const { getFunctionalProfile, getTechnicalKnowledge, persistFunctionalProfile, writeRecipeTechnicalAudit } = require('./recipeTechnicalProfileStore.cjs');
const { FUNCTIONAL_FIELDS, assertModeInput, computeCompleteness, createRecipeTechnicalProfileService, validateBearingPart } = require('./recipeTechnicalProfile.cjs');
const { createRecipeTechnicalMigrationDryRunService } = require('./recipeTechnicalMigrationDryRun.cjs');

const PROMOTION_CAPABILITY_ID = requireBusinessCapability('recipes.technical_profile.migration_owner_promote').capabilityId;
const PROMOTION_VERSION = 'recipe-technical-owner-promotion-v1';
const DECISION = 'ADOPT_CURRENT_CANONICAL';
const MIGRATED_STATES = new Set(['AUTO_MIGRATED', 'MIGRATED_WITH_COMPATIBILITY_PROVENANCE']);

function fail(code, message, statusCode = 409) { return new CommandExecutionError(code, message, statusCode); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}
function parseObject(value) { try { const parsed = JSON.parse(value || '{}'); return object(parsed) ? parsed : {}; } catch { return {}; } }
function cleanItems(items) { return (items || []).map(item => { const copy = { ...item }; delete copy.source; return copy; }); }
function recipeIdOf(value) { const id = parsePositiveId(value); if (!id) throw fail('recipe_id_invalid', '非法配方ID', 400); return id; }
function assertPreviewInput(input) {
    if (!object(input) || Object.keys(input).length !== 1 || input.decision !== DECISION) throw fail('technical_profile_migration_owner_promotion_invalid', 'D-B2 只接受 ADOPT_CURRENT_CANONICAL 决策', 400);
}
function assertApplyInput(input) {
    if (!object(input) || Object.keys(input).some(key => !['confirmationToken', 'idempotencyKey'].includes(key)) || typeof input.confirmationToken !== 'string' || !input.confirmationToken.trim() || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) throw fail('technical_profile_migration_owner_promotion_invalid', 'apply 只接受 confirmationToken 与 idempotencyKey', 400);
    return { confirmationToken: input.confirmationToken.trim(), idempotencyKey: input.idempotencyKey.trim() };
}

function buildSnapshot(db, recipeId, canonical, dryRun) {
    const profile = getFunctionalProfile(db, recipeId); const knowledge = getTechnicalKnowledge(db, recipeId);
    if (!profile || !knowledge) throw fail('technical_profile_migration_owner_promotion_not_eligible', 'D-B2 要求完整 canonical pair');
    if (profile.schema_version !== 1 || knowledge.schema_version !== 1 || !MIGRATED_STATES.has(profile.migration_state)) throw fail('technical_profile_migration_owner_promotion_not_eligible', '当前 canonical 不是支持的已迁移 aggregate');
    const dto = canonical.get(recipeId);
    if (!dto.functional || !dto.technicalKnowledge || dto.policy.stainlessMode === 'UNKNOWN_OR_UNRESOLVED') throw fail('technical_profile_migration_owner_promotion_not_eligible', '当前 canonical policy 或 DTO 不可采用');
    assertModeInput(dto.functional, dto.policy);
    for (const field of ['upperBearingPartId', 'lowerBearingPartId']) validateBearingPart(db, field, dto.functional[field]);
    const completeness = computeCompleteness(db, dto.functional, dto.policy, true);
    const assessment = dryRun.assess(recipeId);
    const reasons = assessment.reasons || [];
    // An incomplete canonical aggregate is still a legitimate owner-adoption
    // target.  Source drift is the only review concern D-B2 may settle; any
    // other REVIEW or BLOCKED concern remains outside this narrow command.
    const migrationSourceChanged = reasons.some(reason => (
        reason.code === 'MIGRATION_SOURCE_CHANGED' && reason.severity === 'REVIEW'
    ));
    const disallowedReason = reasons.some(reason => (
        reason.severity === 'BLOCKED'
        || (reason.severity === 'REVIEW' && reason.code !== 'MIGRATION_SOURCE_CHANGED')
    ));
    if (assessment.classification !== 'NEEDS_OWNER_REVIEW' || !migrationSourceChanged || disallowedReason) {
        throw fail('technical_profile_migration_owner_promotion_not_eligible', 'D-B2 仅支持 MIGRATION_SOURCE_CHANGED review');
    }
    return {
        recipeId, decision: DECISION, aggregateUpdatedAt: dto.updatedAt,
        functional: Object.fromEntries(FUNCTIONAL_FIELDS.map(field => [field, dto.functional[field] ?? null])),
        technicalKnowledge: cleanItems(dto.technicalKnowledge.items), completenessState: completeness.state,
        policy: { stainlessMode: dto.policy.stainlessMode, isStainless: dto.policy.isStainless, reasonCode: dto.policy.reasonCode, templateId: dto.policy.templateId, shellPartId: dto.policy.shellPartId },
        storedMigration: { state: profile.migration_state, version: profile.migration_version, fingerprint: profile.migration_fingerprint },
        sourceDrift: { migrationVersion: assessment.migrationVersion, migrationFingerprint: assessment.migrationFingerprint, reason: 'MIGRATION_SOURCE_CHANGED' },
    };
}
function assertReadback(dto, snapshot) {
    if (!dto || dto.recipeId !== snapshot.recipeId || dto.migration?.state !== 'ALREADY_CANONICAL' || dto.migration?.version !== null || dto.migration?.fingerprint !== null || dto.completeness?.state !== snapshot.completenessState || stable(Object.fromEntries(FUNCTIONAL_FIELDS.map(field => [field, dto.functional?.[field] ?? null]))) !== stable(snapshot.functional) || stable(cleanItems(dto.technicalKnowledge?.items)) !== stable(snapshot.technicalKnowledge)) throw fail('technical_profile_migration_owner_promotion_readback_failed', 'canonical promotion 读回不一致', 500);
}
function promotionRow(profile, snapshot, auditContext, now) {
    const provenance = parseObject(profile.provenance_json); const evidence = parseObject(profile.legacy_evidence_json);
    const ownerPromotion = { sourceKind: 'OWNER_CONFIRMED_CURRENT_CANONICAL', promotionVersion: PROMOTION_VERSION, decision: DECISION, previousMigrationState: snapshot.storedMigration.state, previousMigrationVersion: snapshot.storedMigration.version, previousMigrationFingerprint: snapshot.storedMigration.fingerprint, driftMigrationFingerprint: snapshot.sourceDrift.migrationFingerprint, operationId: auditContext.operationId, actorKey: auditContext.user, confirmedAt: now };
    return { ...profile, completeness_state: snapshot.completenessState, migration_state: 'ALREADY_CANONICAL', migration_version: null, migration_fingerprint: null, provenance_json: JSON.stringify({ ...provenance, ownerPromotion }), legacy_evidence_json: JSON.stringify({ ...evidence, ownerPromotion: { promotionVersion: PROMOTION_VERSION, decision: DECISION, sourceDriftReason: 'MIGRATION_SOURCE_CHANGED', previousStoredMigrationFingerprint: snapshot.storedMigration.fingerprint, currentLegacyMigrationFingerprint: snapshot.sourceDrift.migrationFingerprint, confirmedAt: now } }), updated_at: now };
}

function createRecipeTechnicalMigrationOwnerPromotionService(dependencies = {}) {
    const db = dependencies.db; if (!db) throw new Error('Owner promotion 缺少 db');
    const canonical = dependencies.canonicalProfileService || createRecipeTechnicalProfileService({ db });
    const dryRun = dependencies.dryRunService || createRecipeTechnicalMigrationDryRunService({ db });
    const persist = dependencies.persistFunctionalProfile || persistFunctionalProfile;
    const audit = dependencies.writeAuditLog || ((action, table, id, before, after, context, now) => writeRecipeTechnicalAudit(db, action, table, id, before, after, context, now));
    const command = dependencies.executePersistentCommand || executePersistentCommand; const clock = dependencies.now || (() => new Date());
    function preview(recipeIdValue, input, context = {}) {
        const recipeId = recipeIdOf(recipeIdValue); assertPreviewInput(input); const snapshot = buildSnapshot(db, recipeId, canonical, dryRun);
        const confirmation = issueBusinessConfirmation({ capabilityId: PROMOTION_CAPABILITY_ID, input: { ...snapshot, promotionVersion: PROMOTION_VERSION }, subject: context.subject || context.actorKey });
        return { preview: true, capabilityId: PROMOTION_CAPABILITY_ID, ...confirmation, ...snapshot, promotionVersion: PROMOTION_VERSION, target: { migrationState: 'ALREADY_CANONICAL', migrationVersion: null, migrationFingerprint: null, completenessState: snapshot.completenessState }, suggestedIdempotencyKey: `recipe-technical-owner-promotion:${confirmation.operationId}` };
    }
    function apply(recipeIdValue, input, context = {}) {
        const recipeId = recipeIdOf(recipeIdValue); const parsed = assertApplyInput(input); const subject = context.subject || context.actorKey;
        const confirmation = consumeBusinessConfirmation({ confirmationToken: parsed.confirmationToken, capabilityId: PROMOTION_CAPABILITY_ID, subject, idempotencyKey: parsed.idempotencyKey });
        if (confirmation.input.recipeId !== recipeId || (context.idempotencyKey && context.idempotencyKey !== parsed.idempotencyKey)) throw fail('confirmation_payload_mismatch', '确认凭证不匹配');
        const commandNow = new Date(clock());
        return command({ db, ...context, actorKey: context.actorKey || subject, capabilityId: PROMOTION_CAPABILITY_ID, operationId: confirmation.operationId, idempotencyKey: parsed.idempotencyKey, input: confirmation.input, now: commandNow, requestKnowledgeSync: () => {}, businessChange: standardBusinessChange({ domain: 'recipe', eventType: 'updated', reason: 'canonical technical migration owner promotion', entityRefs: () => [{ entityType: 'recipe', entityId: recipeId, role: 'primary' }] }), execute: ({ auditContext }) => {
            let snapshot;
            try { snapshot = buildSnapshot(db, recipeId, canonical, dryRun); }
            catch (caught) {
                if (caught?.code === 'technical_profile_bearing_invalid' || caught?.code === 'technical_profile_policy_unresolved_field') throw fail('technical_profile_migration_owner_promotion_stale', 'canonical policy 或 bearing relation 在 preview 后变化');
                throw caught;
            }
            if (stable({ ...snapshot, promotionVersion: PROMOTION_VERSION }) !== stable(confirmation.input)) throw fail('technical_profile_migration_owner_promotion_stale', 'canonical aggregate、policy 或 migration source 在 preview 后变化');
            const before = getFunctionalProfile(db, recipeId); const now = commandNow.toISOString(); const write = persist(db, promotionRow(before, snapshot, auditContext, now));
            if (!write.changed || write.action !== 'UPDATE') throw fail('technical_profile_migration_owner_promotion_write_invalid', 'D-B2 必须仅更新现有 profile metadata', 500);
            const auditIds = [audit('UPDATE', 'recipe_functional_technical_profiles', recipeId, write.before, write.after, auditContext, now)];
            const dto = canonical.get(recipeId); assertReadback(dto, snapshot); const post = dryRun.assess(recipeId);
            if (post.classification !== 'ALREADY_CANONICAL' || post.target.writeEligible !== false || !post.reasons.some(reason => reason.code === 'CANONICAL_OWNER_AUTHORITY')) throw fail('technical_profile_migration_owner_promotion_post_verify_failed', 'promotion post-write dry-run 校验失败', 500);
            return { data: { recipeId, promotionVersion: PROMOTION_VERSION, decision: DECISION, previousMigrationState: snapshot.storedMigration.state, previousMigrationFingerprint: snapshot.storedMigration.fingerprint, sourceDriftFingerprint: snapshot.sourceDrift.migrationFingerprint, migrationStateAfter: 'ALREADY_CANONICAL', technicalProfile: dto, postWriteDryRun: { classification: post.classification, writeEligible: post.target.writeEligible } }, resource: { type: 'recipeTechnicalProfile', ids: [recipeId] }, changes: [{ resourceType: 'recipe', resourceId: recipeId, field: 'technicalProfile.migrationAuthority' }], auditIds, requiredAuditCount: 1 };
        } });
    }
    return Object.freeze({ preview, apply });
}
module.exports = { DECISION, MIGRATED_STATES: Object.freeze([...MIGRATED_STATES]), PROMOTION_CAPABILITY_ID, PROMOTION_VERSION, createRecipeTechnicalMigrationOwnerPromotionService };
