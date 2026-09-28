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
    return { db, recipeId, shellId, upperId, lowerId, duplicateId, dryRun, service };
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
    assert.throws(() => preview(service, recipeId, { openOffset: 20, upperBearingPartId: 999999 }), error => error.code === 'technical_profile_migration_review_incomplete');
    const plan = preview(service, recipeId, { openOffset: 20, upperBearingPartId: duplicateId, impellerThicknessSourcePath: 'recipes.impeller_thickness' });
    apply(service, recipeId, plan.confirmationToken, 'review-resolution-bearing-0001');
    const profile = db.prepare(`SELECT upper_bearing_part_id, impeller_thickness, provenance_json FROM recipe_functional_technical_profiles WHERE recipe_id = ?`).get(recipeId);
    assert.equal(profile.upper_bearing_part_id, duplicateId);
    assert.equal(profile.impeller_thickness, 4);
    const provenance = JSON.parse(profile.provenance_json).functional;
    assert.equal(provenance.upperBearingPartId.sourceKind, 'OWNER_SELECTED');
    assert.equal(provenance.impellerThickness.selectedSourcePath, 'recipes.impeller_thickness');
    assert.equal(JSON.stringify(provenance.upperBearingPartId.candidateIds).includes(String(upperId)), true);
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
