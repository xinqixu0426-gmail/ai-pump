const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const { resetBusinessConfirmationsForTests } = require('../api/services/businessConfirmation.cjs');
const { createRecipeTechnicalMigrationDryRunService } = require('../api/services/recipeTechnicalMigrationDryRun.cjs');
const { createRecipeTechnicalMigrationReviewResolutionService, RESOLUTION_VERSION } = require('../api/services/recipeTechnicalMigrationReviewResolution.cjs');
const { getBusinessCapability, listAiCapabilities, writeCapabilityNames } = require('../api/capabilities/registry.cjs');

const NOW = '2026-09-28T00:00:00.000Z';
const ACTOR = 'test:review-resolution';
const technical = overrides => JSON.stringify({
    rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20, impellerBoreDiameter: 12,
    impellerSpan: 24, impellerDepth: 3, threadLength: 14, threadDiameter: 8,
    upperBearing: '202', lowerBearing: '6303', bearingSpan: 80, rotorLength: 150,
    ...overrides,
});

function fixture(t, options = {}) {
    resetBusinessConfirmationsForTests();
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, { now: NOW });
    t.after(() => db.close());
    const shellId = Number(db.prepare(`INSERT INTO parts (model, category, remark, created_at, updated_at) VALUES ('shell', '泵壳', ?, ?, ?)`)
        .run(options.remark ?? '{"isStainless":true,"openOffset":18}', NOW, NOW).lastInsertRowid);
    const upperId = Number(db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6202', '轴承', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    const lowerId = Number(db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6303', '轴承', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    const unrelatedBearingId = Number(db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6201', '轴承', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    let duplicateId = null;
    if (options.duplicateBearing) duplicateId = Number(db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6202', '轴承', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    const templateId = Number(db.prepare(`INSERT INTO pump_shell_templates (shell_model, created_at, updated_at) VALUES ('template', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO catalog_template_shell_bindings (template_id, shell_part_id, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run(templateId, shellId, NOW, NOW);
    const recipeId = Number(db.prepare(`INSERT INTO recipes (name, template_id, coil_sheets, custom_barrel_length, impeller_thickness, impeller_model, technical_data_json, created_at, updated_at) VALUES ('recipe', ?, 160, 120, ?, ?, ?, ?, ?)`)
        .run(templateId, options.impellerThickness ?? 3, options.impellerModel ?? null, options.technicalDataJson ?? technical(), NOW, NOW).lastInsertRowid);
    const dryRun = createRecipeTechnicalMigrationDryRunService({ db });
    const service = createRecipeTechnicalMigrationReviewResolutionService({ db, dryRunService: dryRun, now: () => new Date(NOW), ...options.dependencies });
    return { db, recipeId, shellId, upperId, lowerId, unrelatedBearingId, duplicateId, dryRun, service };
}
function counts(db) { return Object.fromEntries(['recipe_functional_technical_profiles', 'recipe_technical_knowledge', 'audit_log', 'business_change_events', 'api_operations', 'knowledge_entries'].map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)])); }
function preview(service, recipeId, resolution) { return service.preview(recipeId, { resolution }, { actorKey: ACTOR, subject: ACTOR }); }
function apply(service, recipeId, token, key = 'review-resolution-key-0001') { return service.apply(recipeId, { confirmationToken: token, idempotencyKey: key }, { actorKey: ACTOR, subject: ACTOR, idempotencyKey: key, requestId: 'review-resolution-request' }); }

test('Owner confirms stainless openOffset into first canonical aggregate without promoting PumpShell evidence', t => {
    const { db, recipeId, dryRun, service } = fixture(t);
    const before = dryRun.assess(recipeId);
    assert.equal(before.classification, 'NEEDS_OWNER_REVIEW');
    assert.deepEqual(before.reasons.filter(item => item.severity === 'REVIEW').map(item => item.code), ['OPEN_OFFSET_OWNER_CONFIRMATION_REQUIRED']);
    const plan = preview(service, recipeId, { openOffset: 20 });
    assert.equal(plan.resolutionVersion, RESOLUTION_VERSION);
    const result = apply(service, recipeId, plan.confirmationToken);
    assert.equal(result.status, 'completed');
    assert.equal(result.auditIds.length, 2);
    assert.equal(result.technicalProfile.functional.openOffset, 20);
    assert.equal(result.technicalProfile.functional.bearingSpan, 100);
    assert.equal(result.technicalProfile.functional.bearingSpanSource, 'DERIVED');
    assert.equal(result.technicalProfile.migration.state, 'ALREADY_CANONICAL');
    const profile = db.prepare(`SELECT * FROM recipe_functional_technical_profiles WHERE recipe_id = ?`).get(recipeId);
    assert.equal(profile.open_offset, 20);
    assert.equal(profile.migration_state, 'ALREADY_CANONICAL');
    assert.equal(profile.migration_version, null);
    assert.equal(profile.migration_fingerprint, null);
    assert.equal(JSON.parse(profile.provenance_json).functional.openOffset.sourceKind, 'OWNER_CONFIRMED');
    assert.equal(JSON.parse(profile.legacy_evidence_json).pumpShellCompatibilityEvidence.openOffset.rawValue, 18);
    assert.equal(dryRun.assess(recipeId).classification, 'ALREADY_CANONICAL');
    db.prepare(`UPDATE recipes SET technical_data_json = ? WHERE id = ?`).run(technical({ rotorDiameter: 99 }), recipeId);
    assert.equal(dryRun.assess(recipeId).classification, 'ALREADY_CANONICAL');
});

test('Owner can select only a current ambiguous bearing candidate, and all review issues are atomic', t => {
    const { db, recipeId, upperId, duplicateId, service } = fixture(t, { duplicateBearing: true, impellerThickness: 4 });
    // Keep this assertion explicit: D-B1 must bind precisely the present review set.
    const reviewCodes = service ? createRecipeTechnicalMigrationDryRunService({ db }).assess(recipeId).reasons.filter(item => item.severity === 'REVIEW').map(item => item.code) : [];
    assert.deepEqual(reviewCodes.sort(), ['IMPELLER_THICKNESS_CONFLICT', 'OPEN_OFFSET_OWNER_CONFIRMATION_REQUIRED', 'UPPER_BEARING_PART_AMBIGUOUS'].sort());
    assert.throws(() => preview(service, recipeId, { openOffset: 20, upperBearingPartId: upperId }), error => error.code === 'technical_profile_migration_review_incomplete');
    const beforeInvalid = counts(db);
    assert.throws(() => preview(service, recipeId, { openOffset: 20, upperBearingPartId: 999999, impellerThicknessSourcePath: 'recipes.impeller_thickness' }), error => error.code === 'technical_profile_migration_review_invalid');
    assert.deepEqual(counts(db), beforeInvalid);
    const plan = preview(service, recipeId, { openOffset: 20, upperBearingPartId: duplicateId, impellerThicknessSourcePath: 'recipes.impeller_thickness' });
    const result = apply(service, recipeId, plan.confirmationToken, 'review-resolution-bearing-0001');
    const profile = db.prepare(`SELECT upper_bearing_part_id, impeller_thickness, provenance_json FROM recipe_functional_technical_profiles WHERE recipe_id = ?`).get(recipeId);
    assert.equal(profile.upper_bearing_part_id, duplicateId);
    assert.equal(profile.impeller_thickness, 4);
    const provenance = JSON.parse(profile.provenance_json).functional;
    assert.equal(provenance.upperBearingPartId.sourceKind, 'OWNER_SELECTED');
    assert.equal(provenance.impellerThickness.selectedSourcePath, 'recipes.impeller_thickness');
    assert.equal(JSON.stringify(provenance.upperBearingPartId.candidateIds).includes(String(upperId)), true);
    assert.equal(result.technicalProfile.functional.upperBearingPartId, duplicateId);
    assert.equal(result.technicalProfile.functional.impellerThickness, 4);
    assert.equal(result.technicalProfile.bearingReferences.upper.partId, duplicateId);
});

test('Knowledge conflict requires one current evidence source and persists only the Owner-selected canonical item', t => {
    const { db, recipeId, dryRun, service } = fixture(t, {
        impellerModel: 'column-model',
        technicalDataJson: technical({ impellerModel: 'json-model' }),
    });
    const assessment = dryRun.assess(recipeId);
    assert.ok(assessment.reasons.some(reason => reason.code === 'TECHNICAL_KNOWLEDGE_DUPLICATE_CONFLICT' && reason.key === 'impellerModel'));
    assert.equal(assessment.candidate.technicalKnowledge.items.some(item => item.key === 'impellerModel'), false);
    const evidence = assessment.candidate.technicalKnowledge.migrationEvidence.impellerModel;
    assert.equal(evidence.length, 2);
    const before = counts(db);
    assert.throws(() => preview(service, recipeId, { openOffset: 20, technicalKnowledgeSelections: { impellerModel: { sourcePath: 'not-a-current-source' } } }), error => error.code === 'technical_profile_migration_review_invalid');
    assert.deepEqual(counts(db), before);
    const plan = preview(service, recipeId, { openOffset: 20, technicalKnowledgeSelections: { impellerModel: { sourcePath: 'recipes.impeller_model' } } });
    const result = apply(service, recipeId, plan.confirmationToken, 'review-resolution-knowledge-001');
    const item = result.technicalProfile.technicalKnowledge.items.find(value => value.key === 'impellerModel');
    assert.deepEqual(item.value, 'column-model');
    assert.equal(item.source.sourceKind, 'OWNER_SELECTED');
    assert.equal(item.source.issueCode, 'TECHNICAL_KNOWLEDGE_DUPLICATE_CONFLICT');
    assert.equal(item.source.selectedSourcePath, 'recipes.impeller_model');
    assert.deepEqual(item.source.allEvidence, evidence);
    assert.equal(Object.hasOwn(item.value, 'allEvidence'), false);
    assert.equal(counts(db).knowledge_entries, 0);
    assert.equal(dryRun.reviewQueue({ limit: 100, offset: 0 }).items.some(value => value.recipeId === recipeId), false);
    const post = dryRun.assess(recipeId);
    assert.equal(post.classification, 'ALREADY_CANONICAL');
    assert.equal(post.target.writeEligible, false);
    assert.ok(post.reasons.some(reason => reason.code === 'CANONICAL_OWNER_AUTHORITY'));
});

test('noncandidate bearing, extra decisions, and selected-bearing lifecycle drift all reject without D-B1 writes', t => {
    const noncandidate = fixture(t, { duplicateBearing: true, impellerThickness: 4 });
    const before = counts(noncandidate.db);
    assert.throws(() => preview(noncandidate.service, noncandidate.recipeId, { openOffset: 20, upperBearingPartId: noncandidate.unrelatedBearingId, impellerThicknessSourcePath: 'recipes.impeller_thickness' }), error => error.code === 'technical_profile_migration_review_invalid');
    assert.deepEqual(counts(noncandidate.db), before);
    const extra = fixture(t);
    assert.throws(() => preview(extra.service, extra.recipeId, { openOffset: 20, lowerBearingPartId: extra.lowerId }), error => error.code === 'technical_profile_migration_review_incomplete');
    const stale = fixture(t, { duplicateBearing: true });
    const plan = preview(stale.service, stale.recipeId, { openOffset: 20, upperBearingPartId: stale.duplicateId });
    const staleBefore = counts(stale.db);
    stale.db.prepare(`UPDATE parts SET deleted_at = ? WHERE id = ?`).run(NOW, stale.duplicateId);
    assert.throws(() => apply(stale.service, stale.recipeId, plan.confirmationToken, 'review-resolution-bearing-stale-001'), error => error.code === 'technical_profile_migration_review_stale');
    assert.deepEqual(counts(stale.db), staleBefore);
});

test('post-write knowledge, audit, business-event, canonical-readback, and dry-run verification failures roll back every D-B1 write', t => {
    const failureCases = [
        {
            label: 'knowledge',
            dependencies: { persistTechnicalKnowledge: () => { throw new Error('forced knowledge failure'); } },
            code: null,
        },
        {
            label: 'audit',
            dependencies: { writeAuditLog: () => { throw new Error('forced audit failure'); } },
            code: null,
        },
        {
            label: 'readback',
            dependencies: { canonicalProfileService: { get: () => ({ recipeId: -1 }) } },
            code: 'technical_profile_migration_review_readback_failed',
        },
    ];
    for (const failure of failureCases) {
        const current = fixture(t, { dependencies: failure.dependencies });
        const plan = preview(current.service, current.recipeId, { openOffset: 20 });
        const legacy = current.db.prepare(`SELECT technical_data_json, custom_barrel_length FROM recipes WHERE id = ?`).get(current.recipeId);
        const before = counts(current.db);
        assert.throws(() => apply(current.service, current.recipeId, plan.confirmationToken, `review-resolution-${failure.label}-fail-001`), thrown => !failure.code || thrown.code === failure.code);
        assert.deepEqual(counts(current.db), before);
        assert.deepEqual(current.db.prepare(`SELECT technical_data_json, custom_barrel_length FROM recipes WHERE id = ?`).get(current.recipeId), legacy);
    }
    const business = fixture(t);
    const businessPlan = preview(business.service, business.recipeId, { openOffset: 20 });
    business.db.exec(`CREATE TRIGGER fail_review_business_change BEFORE INSERT ON business_change_events BEGIN SELECT RAISE(ABORT, 'forced business event failure'); END;`);
    const businessBefore = counts(business.db);
    assert.throws(() => apply(business.service, business.recipeId, businessPlan.confirmationToken, 'review-resolution-business-fail-001'));
    assert.deepEqual(counts(business.db), businessBefore);
    // A fresh recipe is required because the failure trigger is deliberately local to the prior fixture.
    const post = fixture(t);
    const postActual = createRecipeTechnicalMigrationDryRunService({ db: post.db });
    let postAssessments = 0;
    const postService = createRecipeTechnicalMigrationReviewResolutionService({ db: post.db, dryRunService: { assess(recipeId) { postAssessments += 1; const value = postActual.assess(recipeId); return postAssessments >= 3 ? { ...value, classification: 'NEEDS_OWNER_REVIEW' } : value; } }, now: () => new Date(NOW) });
    const postPlan = preview(postService, post.recipeId, { openOffset: 20 });
    const postBefore = counts(post.db);
    assert.throws(() => apply(postService, post.recipeId, postPlan.confirmationToken, 'review-resolution-post-dryrun-fail-001'), error => error.code === 'technical_profile_migration_review_post_verify_failed');
    assert.deepEqual(counts(post.db), postBefore);
});

test('blocked and unsupported reviews fail closed and create no rows, audit, event, or receipt', t => {
    const blocked = fixture(t, { remark: '{"isStainless":0,"openOffset":18}', impellerThickness: 4 });
    const blockedBefore = counts(blocked.db);
    assert.throws(() => preview(blocked.service, blocked.recipeId, { impellerThicknessSourcePath: 'recipes.impeller_thickness' }), error => error.code === 'technical_profile_migration_review_blocked');
    assert.deepEqual(counts(blocked.db), blockedBefore);
    const unsupported = fixture(t, { technicalDataJson: technical({ rotorDiameter: 'bad' }) });
    assert.throws(() => preview(unsupported.service, unsupported.recipeId, { openOffset: 20 }), error => error.code === 'technical_profile_migration_review_unsupported');
    assert.equal(counts(unsupported.db).recipe_functional_technical_profiles, 0);
});

test('stale confirmation and canonical rows appearing after preview fail closed; replay has no duplicate side effects', t => {
    const stale = fixture(t);
    const plan = preview(stale.service, stale.recipeId, { openOffset: 20 });
    const before = counts(stale.db);
    stale.db.prepare(`UPDATE recipes SET custom_barrel_length = 130 WHERE id = ?`).run(stale.recipeId);
    assert.throws(() => apply(stale.service, stale.recipeId, plan.confirmationToken, 'review-resolution-stale-0001'), error => error.code === 'technical_profile_migration_review_stale');
    assert.deepEqual(counts(stale.db), before);
    const exists = fixture(t);
    const existsPlan = preview(exists.service, exists.recipeId, { openOffset: 20 });
    exists.db.prepare(`INSERT INTO recipe_functional_technical_profiles (recipe_id, schema_version, completeness_state, migration_state, provenance_json, legacy_evidence_json, created_at, updated_at) VALUES (?, 1, 'INCOMPLETE', 'ALREADY_CANONICAL', '{}', '{}', ?, ?)`).run(exists.recipeId, NOW, NOW);
    assert.throws(() => apply(exists.service, exists.recipeId, existsPlan.confirmationToken, 'review-resolution-exists-0001'), error => error.code === 'technical_profile_migration_review_stale');
    const replay = fixture(t);
    const replayPlan = preview(replay.service, replay.recipeId, { openOffset: 20 });
    const first = apply(replay.service, replay.recipeId, replayPlan.confirmationToken, 'review-resolution-replay-001');
    const after = counts(replay.db);
    const second = apply(replay.service, replay.recipeId, replayPlan.confirmationToken, 'review-resolution-replay-001');
    assert.equal(first.idempotentReplay, false);
    assert.equal(second.idempotentReplay, true);
    assert.deepEqual(counts(replay.db), after);
});

test('review capability is high-risk business infrastructure but absent from AI write exposure', () => {
    const capability = getBusinessCapability('recipes.technical_profile.migration_review_resolve');
    assert.deepEqual(capability.callers, ['web', 'internal']);
    assert.equal(listAiCapabilities().some(item => item.formalCapabilityIds?.includes(capability.capabilityId)), false);
    assert.equal(writeCapabilityNames().includes(capability.capabilityId), false);
});
