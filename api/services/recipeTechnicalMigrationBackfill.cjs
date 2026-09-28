// O4-F-D-A deliberately performs only a single, confirmation-bound initial
// backfill.  It never repairs, merges, or overwrites canonical storage.
const { requireBusinessCapability } = require('../capabilities/registry.cjs');
const { issueBusinessConfirmation, consumeBusinessConfirmation } = require('./businessConfirmation.cjs');
const { CommandExecutionError, executePersistentCommand } = require('./commandExecution.cjs');
const { standardBusinessChange } = require('./businessChanges.cjs');
const { parsePositiveId } = require('./validation.cjs');
const {
    getFunctionalProfile,
    getTechnicalKnowledge,
    persistFunctionalProfile,
    persistTechnicalKnowledge,
    writeRecipeTechnicalAudit,
} = require('./recipeTechnicalProfileStore.cjs');
const { createRecipeTechnicalProfileService, FUNCTIONAL_FIELDS } = require('./recipeTechnicalProfile.cjs');
const { MIGRATION_VERSION, createRecipeTechnicalMigrationDryRunService } = require('./recipeTechnicalMigrationDryRun.cjs');

const BACKFILL_CAPABILITY_ID = requireBusinessCapability('recipes.technical_profile.migration_backfill').capabilityId;
const ELIGIBLE_CLASSIFICATIONS = new Set(['AUTO_MIGRATABLE', 'MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE']);
const PROFILE_COLUMN_BY_FIELD = Object.freeze({
    rotorDiameter: 'rotor_diameter', stackOffset: 'stack_offset',
    oilSealDiameter: 'oil_seal_diameter', impellerBoreDiameter: 'impeller_bore_diameter',
    impellerSpan: 'impeller_span', impellerThickness: 'impeller_thickness',
    threadLength: 'thread_length', threadDiameter: 'thread_diameter',
    barrelLength: 'barrel_length', openOffset: 'open_offset',
    bearingSpanExplicit: 'bearing_span_explicit',
    upperBearingPartId: 'upper_bearing_part_id', lowerBearingPartId: 'lower_bearing_part_id',
});

function error(code, message, statusCode = 409, details) {
    const result = new CommandExecutionError(code, message, statusCode);
    if (details !== undefined) result.details = details;
    return result;
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

function normalizeRecipeId(value) {
    const recipeId = parsePositiveId(value);
    if (!recipeId) throw error('recipe_id_invalid', '非法配方ID', 400);
    return recipeId;
}

function assertApplyInput(input) {
    if (!plainObject(input) || Object.keys(input).some(key => !['confirmationToken', 'idempotencyKey'].includes(key))) {
        throw error('technical_profile_migration_backfill_invalid', '回填请求只能包含 confirmationToken 与 idempotencyKey', 400);
    }
    if (typeof input.confirmationToken !== 'string' || !input.confirmationToken.trim()) {
        throw error('confirmation_token_invalid', '回填必须提供 confirmationToken', 400);
    }
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) {
        throw error('idempotency_key_required', '回填必须显式提供 idempotencyKey', 400);
    }
    return { confirmationToken: input.confirmationToken.trim(), idempotencyKey: input.idempotencyKey.trim() };
}

function candidateContent(assessment) {
    return assessment.candidate.technicalKnowledge.items.map(item => ({ ...item }));
}

function boundDecision(assessment) {
    return {
        recipeId: assessment.recipeId,
        migrationVersion: assessment.migrationVersion,
        migrationFingerprint: assessment.migrationFingerprint,
        classification: assessment.classification,
        expectedUpdatedAt: null,
        target: {
            migrationState: assessment.target.migrationState,
            completenessState: assessment.target.completenessState,
            missingSet: assessment.target.missingSet,
            unresolvedSet: assessment.target.unresolvedSet,
            functional: assessment.target.functional,
            technicalKnowledge: candidateContent(assessment),
        },
    };
}

function assertEligibleInitialAssessment(assessment) {
    if (!ELIGIBLE_CLASSIFICATIONS.has(assessment.classification) || assessment.target.writeEligible !== true) {
        throw error('technical_profile_migration_not_write_eligible', '当前配方不满足自动 canonical 回填条件，必须进入 Owner Review 或保留未解析状态', 409, {
            classification: assessment.classification,
            writeEligible: assessment.target.writeEligible,
        });
    }
    if (assessment.canonical.functionalPresent || assessment.canonical.technicalKnowledgePresent || assessment.canonical.aggregateUpdatedAt !== null) {
        throw error('technical_profile_migration_canonical_exists', 'canonical 技术档案已存在或不完整，自动回填不得覆盖、合并或补齐', 409);
    }
    if (assessment.target.migrationState === null || !['COMPLETE', 'INCOMPLETE'].includes(assessment.target.completenessState)) {
        throw error('technical_profile_migration_target_invalid', '自动回填目标状态不完整', 409);
    }
}

function assertSameDecision(bound, assessment) {
    assertEligibleInitialAssessment(assessment);
    const current = boundDecision(assessment);
    if (stableJson(bound) !== stableJson(current)) {
        throw error('technical_profile_migration_preview_stale', '迁移来源、关系、候选或目标在预览后发生变化，请重新预览并确认', 409, {
            expectedFingerprint: bound.migrationFingerprint,
            currentFingerprint: assessment.migrationFingerprint,
        });
    }
}

function migrationSource(candidate, field, migrationVersion, migrationFingerprint, migratedAt) {
    if (!candidate || candidate.value === null || candidate.value === undefined) return null;
    if (field === 'impellerThickness') {
        const sources = [candidate.json, candidate.column].filter(item => item?.value !== null && item?.value !== undefined)
            .map(item => ({ sourceKind: item.source, sourcePath: item.sourcePath, rawValue: item.rawValue, normalizedValue: item.value }));
        return {
            sourceKind: candidate.status === 'PROPOSED_WITH_COMPATIBILITY_EVIDENCE'
                ? 'MIGRATED_WITH_COMPATIBILITY_PROVENANCE' : candidate.source,
            sources,
            migrationVersion, migrationFingerprint, migratedAt,
        };
    }
    return {
        sourceKind: candidate.source,
        sourcePath: candidate.sourcePath,
        rawValue: candidate.rawValue,
        normalizedValue: candidate.value,
        migrationVersion,
        migrationFingerprint,
        migratedAt,
    };
}

function bearingProvenance(bearing, migrationVersion, migrationFingerprint, migratedAt) {
    return {
        sourceKind: 'MIGRATED_LEGACY_BEARING_CODE',
        rawValue: bearing.rawValue,
        normalizedBearingCode: bearing.normalizedBearingCode,
        candidateCount: bearing.candidates.length,
        candidateIds: bearing.candidates.map(candidate => candidate.partId),
        selectedPartId: bearing.proposedPartId,
        resolutionMode: bearing.resolutionMode,
        migrationVersion,
        migrationFingerprint,
        migratedAt,
    };
}

function buildFunctionalProvenance(assessment, migratedAt) {
    const result = {};
    for (const field of FUNCTIONAL_FIELDS) {
        const value = assessment.target.functional[field];
        if (value === null || value === undefined) continue;
        if (field === 'upperBearingPartId' || field === 'lowerBearingPartId') {
            const bearing = assessment.candidate.bearings[field === 'upperBearingPartId' ? 'upper' : 'lower'];
            result[field] = bearingProvenance(bearing, assessment.migrationVersion, assessment.migrationFingerprint, migratedAt);
        } else {
            const provenance = migrationSource(assessment.candidate.functional[field], field, assessment.migrationVersion, assessment.migrationFingerprint, migratedAt);
            if (provenance) result[field] = provenance;
        }
    }
    return result;
}

function buildKnowledgeItems(assessment, migratedAt) {
    return candidateContent(assessment).map(item => ({
        ...item,
        source: {
            sourceKind: 'MIGRATED_TECHNICAL_KNOWLEDGE',
            sources: assessment.candidate.technicalKnowledge.migrationEvidence[item.key] || [],
            migrationVersion: assessment.migrationVersion,
            migrationFingerprint: assessment.migrationFingerprint,
            migratedAt,
        },
    }));
}

function compactBearingEvidence(bearing) {
    return {
        rawValue: bearing.rawValue,
        normalizedBearingCode: bearing.normalizedBearingCode,
        resolutionMode: bearing.resolutionMode,
        candidateIds: bearing.candidates.map(candidate => candidate.partId),
        selectedPartId: bearing.proposedPartId,
        geometryAvailable: bearing.geometryAvailable,
    };
}

function pumpShellCompatibilityEvidence(rawEvidence) {
    if (!plainObject(rawEvidence)) return null;
    const openOffset = rawEvidence.openOffset ?? null;
    const openFactor = rawEvidence.openFactor ?? null;
    if (openOffset === null && openFactor === null) return null;
    return {
        openOffset: {
            sourcePath: 'parts.remark.openOffset',
            rawValue: openOffset,
        },
        openFactor: {
            sourcePath: 'parts.remark.openFactor',
            rawValue: openFactor,
        },
    };
}

function buildLegacyEvidence(assessment) {
    const thickness = assessment.candidate.functional.impellerThickness;
    const shellEvidence = assessment.candidate.functional.openOffset?.rawValue ?? null;
    return {
        schema: 'recipe-technical-migration-legacy-evidence-v1',
        migrationVersion: assessment.migrationVersion,
        migrationFingerprint: assessment.migrationFingerprint,
        bearingEvidence: {
            upper: compactBearingEvidence(assessment.candidate.bearings.upper),
            lower: compactBearingEvidence(assessment.candidate.bearings.lower),
        },
        thicknessEvidence: {
            json: thickness?.json ? { sourcePath: thickness.json.sourcePath, rawValue: thickness.json.rawValue, normalizedValue: thickness.json.value } : null,
            column: thickness?.column ? { sourcePath: thickness.column.sourcePath, rawValue: thickness.column.rawValue, normalizedValue: thickness.column.value } : null,
        },
        spanAssessment: assessment.spanAssessment,
        pumpShellCompatibilityEvidence: pumpShellCompatibilityEvidence(shellEvidence),
        technicalKnowledgeMigrationEvidence: assessment.candidate.technicalKnowledge.migrationEvidence,
    };
}

function buildProfileInput(recipeId, assessment, now) {
    const functional = assessment.target.functional;
    const provenance = {
        schema: 'recipe-technical-migration-provenance-v1',
        migrationVersion: assessment.migrationVersion,
        migrationFingerprint: assessment.migrationFingerprint,
        migratedAt: now,
        functional: buildFunctionalProvenance(assessment, now),
        technicalKnowledge: Object.fromEntries(Object.entries(assessment.candidate.technicalKnowledge.migrationEvidence).map(([key, sources]) => [key, {
            sourceKind: 'MIGRATED_TECHNICAL_KNOWLEDGE', sources,
            migrationVersion: assessment.migrationVersion, migrationFingerprint: assessment.migrationFingerprint, migratedAt: now,
        }])),
    };
    return {
        recipe_id: recipeId,
        ...Object.fromEntries(FUNCTIONAL_FIELDS.map(field => [PROFILE_COLUMN_BY_FIELD[field], functional[field] ?? null])),
        schema_version: 1,
        completeness_state: assessment.target.completenessState,
        migration_state: assessment.target.migrationState,
        migration_version: MIGRATION_VERSION,
        migration_fingerprint: assessment.migrationFingerprint,
        provenance_json: JSON.stringify(provenance),
        legacy_evidence_json: JSON.stringify(buildLegacyEvidence(assessment)),
        created_at: now,
        updated_at: now,
    };
}

function buildKnowledgeInput(recipeId, assessment, now) {
    return {
        recipe_id: recipeId,
        schema_version: 1,
        items_json: JSON.stringify(buildKnowledgeItems(assessment, now)),
        created_at: now,
        updated_at: now,
    };
}

function assertStoredTarget(profile, knowledge, assessment) {
    if (!profile || !knowledge || profile.schema_version !== 1 || knowledge.schema_version !== 1
        || profile.migration_version !== MIGRATION_VERSION
        || profile.migration_fingerprint !== assessment.migrationFingerprint
        || profile.migration_state !== assessment.target.migrationState
        || profile.completeness_state !== assessment.target.completenessState) {
        throw error('technical_profile_migration_readback_failed', 'canonical 回填读回校验失败，已回滚', 500);
    }
    for (const field of FUNCTIONAL_FIELDS) {
        if ((profile[PROFILE_COLUMN_BY_FIELD[field]] ?? null) !== (assessment.target.functional[field] ?? null)) {
            throw error('technical_profile_migration_readback_failed', `canonical Functional ${field} 读回不一致，已回滚`, 500);
        }
    }
    const content = JSON.parse(knowledge.items_json || '[]').map(item => {
        const clone = { ...item };
        delete clone.source;
        return clone;
    });
    if (stableJson(content) !== stableJson(candidateContent(assessment))) {
        throw error('technical_profile_migration_readback_failed', 'canonical Technical Knowledge 读回不一致，已回滚', 500);
    }
}

function createRecipeTechnicalMigrationBackfillService(dependencies = {}) {
    const db = dependencies.db;
    if (!db) throw new Error('Recipe technical migration backfill 缺少 db');
    const dryRun = dependencies.dryRunService || createRecipeTechnicalMigrationDryRunService({ db });
    const canonicalProfile = dependencies.canonicalProfileService || createRecipeTechnicalProfileService({ db });
    const auditWriter = dependencies.writeAuditLog || ((action, table, recipeId, before, after, context, now) => writeRecipeTechnicalAudit(db, action, table, recipeId, before, after, context, now));
    const persistProfile = dependencies.persistFunctionalProfile || persistFunctionalProfile;
    const persistKnowledge = dependencies.persistTechnicalKnowledge || persistTechnicalKnowledge;
    const persistentCommand = dependencies.executePersistentCommand || executePersistentCommand;
    const clock = dependencies.now || (() => new Date());
    const postWriteVerify = dependencies.postWriteVerify || (() => {});
    const postDryRunVerify = dependencies.postDryRunVerify || (() => {});

    function preview(recipeIdValue, context = {}) {
        const recipeId = normalizeRecipeId(recipeIdValue);
        const assessment = dryRun.assess(recipeId);
        assertEligibleInitialAssessment(assessment);
        const decision = boundDecision(assessment);
        const confirmation = issueBusinessConfirmation({
            capabilityId: BACKFILL_CAPABILITY_ID,
            input: decision,
            subject: context.subject || context.actorKey,
        });
        return {
            preview: true,
            capabilityId: BACKFILL_CAPABILITY_ID,
            ...confirmation,
            recipeId,
            migrationVersion: decision.migrationVersion,
            migrationFingerprint: decision.migrationFingerprint,
            classification: decision.classification,
            expectedUpdatedAt: null,
            target: decision.target,
            warnings: assessment.reasons,
            suggestedIdempotencyKey: `recipe-technical-backfill:${confirmation.operationId}`,
        };
    }

    function apply(recipeIdValue, input = {}, context = {}) {
        const recipeId = normalizeRecipeId(recipeIdValue);
        const parsed = assertApplyInput(input);
        const subject = context.subject || context.actorKey;
        const confirmation = consumeBusinessConfirmation({
            confirmationToken: parsed.confirmationToken,
            capabilityId: BACKFILL_CAPABILITY_ID,
            subject,
            idempotencyKey: parsed.idempotencyKey,
        });
        if (context.idempotencyKey && context.idempotencyKey !== parsed.idempotencyKey) {
            throw error('idempotency_key_mismatch', '请求上下文与显式 idempotencyKey 不一致', 400);
        }
        if (confirmation.input.recipeId !== recipeId) {
            throw error('confirmation_payload_mismatch', '确认凭证不属于当前配方', 409);
        }
        const commandNow = new Date(clock());
        return persistentCommand({
            db,
            ...context,
            actorKey: context.actorKey || subject,
            capabilityId: BACKFILL_CAPABILITY_ID,
            operationId: confirmation.operationId,
            idempotencyKey: parsed.idempotencyKey,
            input: confirmation.input,
            now: commandNow,
            requestKnowledgeSync: () => {},
            businessChange: standardBusinessChange({
                domain: 'recipe', eventType: 'updated', reason: 'canonical technical migration backfill',
                entityRefs: () => [{ entityType: 'recipe', entityId: recipeId, role: 'primary' }],
            }),
            execute: ({ auditContext }) => {
                const assessment = dryRun.assess(recipeId);
                assertSameDecision(confirmation.input, assessment);
                if (getFunctionalProfile(db, recipeId) || getTechnicalKnowledge(db, recipeId)) {
                    throw error('technical_profile_migration_preview_stale', 'canonical 技术档案已在预览后出现，自动回填已拒绝', 409);
                }
                const now = commandNow.toISOString();
                const profileWrite = persistProfile(db, buildProfileInput(recipeId, assessment, now));
                const knowledgeWrite = persistKnowledge(db, buildKnowledgeInput(recipeId, assessment, now));
                if (!profileWrite.changed || !knowledgeWrite.changed) {
                    throw error('technical_profile_migration_write_invalid', '自动回填必须原子创建两个 canonical 子资源', 500);
                }
                const auditIds = [
                    auditWriter(profileWrite.action, 'recipe_functional_technical_profiles', recipeId, profileWrite.before, profileWrite.after, auditContext, now),
                    auditWriter(knowledgeWrite.action, 'recipe_technical_knowledge', recipeId, knowledgeWrite.before, knowledgeWrite.after, auditContext, now),
                ];
                const afterProfile = getFunctionalProfile(db, recipeId);
                const afterKnowledge = getTechnicalKnowledge(db, recipeId);
                assertStoredTarget(afterProfile, afterKnowledge, assessment);
                const dto = canonicalProfile.get(recipeId);
                postWriteVerify({ assessment, profile: afterProfile, knowledge: afterKnowledge, dto });
                const postWriteAssessment = dryRun.assess(recipeId);
                if (postWriteAssessment.classification !== 'ALREADY_CANONICAL'
                    || postWriteAssessment.migrationFingerprint !== assessment.migrationFingerprint
                    || postWriteAssessment.target.writeEligible !== false
                    || !postWriteAssessment.reasons.some(reason => reason.code === 'MIGRATION_FINGERPRINT_MATCH')) {
                    throw error('technical_profile_migration_post_verify_failed', '回填后 deterministic dry-run 校验失败，已回滚', 500);
                }
                postDryRunVerify({ assessment, postWriteAssessment, dto });
                return {
                    data: {
                        recipeId,
                        migrationVersion: assessment.migrationVersion,
                        migrationFingerprint: assessment.migrationFingerprint,
                        classificationBefore: assessment.classification,
                        migrationStateAfter: assessment.target.migrationState,
                        technicalProfile: dto,
                        postWriteDryRun: {
                            classification: postWriteAssessment.classification,
                            migrationFingerprint: postWriteAssessment.migrationFingerprint,
                            writeEligible: postWriteAssessment.target.writeEligible,
                        },
                    },
                    resource: { type: 'recipeTechnicalProfile', ids: [recipeId] },
                    changes: [
                        { resourceType: 'recipe', resourceId: recipeId, field: 'technicalProfile' },
                        { resourceType: 'recipe', resourceId: recipeId, field: 'technicalKnowledge' },
                    ],
                    auditIds,
                    requiredAuditCount: 2,
                };
            },
        });
    }

    return Object.freeze({ preview, apply });
}

module.exports = {
    BACKFILL_CAPABILITY_ID,
    ELIGIBLE_CLASSIFICATIONS: Object.freeze([...ELIGIBLE_CLASSIFICATIONS]),
    createRecipeTechnicalMigrationBackfillService,
};
