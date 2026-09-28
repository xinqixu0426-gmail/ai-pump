const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const { resetBusinessConfirmationsForTests } = require('../api/services/businessConfirmation.cjs');
const { createRecipeTechnicalMigrationDryRunService } = require('../api/services/recipeTechnicalMigrationDryRun.cjs');
const { createRecipeTechnicalMigrationBackfillService } = require('../api/services/recipeTechnicalMigrationBackfill.cjs');
const { getBusinessCapability, listAiCapabilities, writeCapabilityNames } = require('../api/capabilities/registry.cjs');

const NOW = '2026-09-28T00:00:00.000Z';
const ACTOR = 'test:recipe-technical-backfill';

function fixture(t, options = {}) {
    resetBusinessConfirmationsForTests();
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, { now: NOW });
    t.after(() => db.close());
    const shellId = Number(db.prepare(`INSERT INTO parts (model, category, remark, created_at, updated_at) VALUES ('shell', '泵壳', ?, ?, ?)`)
        .run(options.remark ?? '{"isStainless":false}', NOW, NOW).lastInsertRowid);
    const upperId = Number(db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6202', '轴承', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    const lowerId = Number(db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6303', '轴承', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    if (options.duplicateBearing) db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6202', '轴承', ?, ?)`).run(NOW, NOW);
    const templateId = Number(db.prepare(`INSERT INTO pump_shell_templates (shell_model, created_at, updated_at) VALUES ('template', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    if (options.binding !== false) db.prepare(`INSERT INTO catalog_template_shell_bindings (template_id, shell_part_id, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(templateId, shellId, NOW, NOW);
    const technical = options.technicalDataJson ?? JSON.stringify({
        rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20, impellerBoreDiameter: 12,
        impellerSpan: 24, impellerDepth: 3, threadLength: 14, threadDiameter: 8,
        upperBearing: '202', lowerBearing: '6303', bearingSpan: 80, rotorLength: 150,
    });
    const recipeId = Number(db.prepare(`
        INSERT INTO recipes (name, template_id, coil_sheets, custom_barrel_length, impeller_thickness, technical_data_json, created_at, updated_at)
        VALUES ('recipe', ?, 160, ?, ?, ?, ?, ?)
    `).run(templateId, options.barrelLength ?? 120, options.impellerThickness ?? null, technical, NOW, NOW).lastInsertRowid);
    const dryRun = createRecipeTechnicalMigrationDryRunService({ db });
    const service = createRecipeTechnicalMigrationBackfillService({ db, dryRunService: dryRun, now: () => new Date(NOW), ...options.dependencies });
    return { db, recipeId, shellId, upperId, lowerId, dryRun, service };
}

function counts(db) {
    return Object.fromEntries([
        'recipe_functional_technical_profiles', 'recipe_technical_knowledge', 'audit_log',
        'business_change_events', 'api_operations', 'knowledge_entries',
    ].map(table => [table, Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count)]));
}

function preview(service, recipeId) {
    return service.preview(recipeId, { actorKey: ACTOR, subject: ACTOR });
}

function apply(service, recipeId, confirmationToken, key = 'recipe-backfill-test-0001') {
    return service.apply(recipeId, { confirmationToken, idempotencyKey: key }, {
        actorKey: ACTOR, subject: ACTOR, idempotencyKey: key, requestId: 'backfill-test-request',
    });
}

test('eligible compatibility-provenance dry run backfills both canonical rows atomically with truthful provenance', t => {
    const { db, recipeId, upperId, lowerId, dryRun, service } = fixture(t, { impellerThickness: 3 });
    const assessment = dryRun.assess(recipeId);
    assert.equal(assessment.classification, 'MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE');
    const beforeLegacy = db.prepare(`SELECT technical_data_json, custom_barrel_length, impeller_thickness FROM recipes WHERE id = ?`).get(recipeId);
    const plan = preview(service, recipeId);
    assert.equal(plan.preview, true);
    assert.equal(plan.expectedUpdatedAt, null);
    const result = apply(service, recipeId, plan.confirmationToken);
    assert.equal(result.status, 'completed');
    assert.equal(result.auditIds.length, 2);
    assert.equal(result.businessChangeEvent.primaryDomain, 'recipe');
    assert.equal(result.classificationBefore, 'MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE');
    assert.equal(result.migrationStateAfter, 'MIGRATED_WITH_COMPATIBILITY_PROVENANCE');
    assert.equal(result.postWriteDryRun.classification, 'ALREADY_CANONICAL');
    assert.equal(result.postWriteDryRun.migrationFingerprint, assessment.migrationFingerprint);
    const profile = db.prepare(`SELECT * FROM recipe_functional_technical_profiles WHERE recipe_id = ?`).get(recipeId);
    const knowledge = db.prepare(`SELECT * FROM recipe_technical_knowledge WHERE recipe_id = ?`).get(recipeId);
    assert.equal(profile.upper_bearing_part_id, upperId);
    assert.equal(profile.lower_bearing_part_id, lowerId);
    assert.equal(profile.migration_fingerprint, assessment.migrationFingerprint);
    const provenance = JSON.parse(profile.provenance_json);
    assert.equal(provenance.functional.rotorDiameter.sourceKind, 'MIGRATED_RECIPE_TECHNICAL_JSON');
    assert.equal(provenance.functional.impellerThickness.sources.length, 2);
    assert.equal(provenance.functional.upperBearingPartId.selectedPartId, upperId);
    assert.equal(provenance.functional.upperBearingPartId.candidateCount, 1);
    assert.equal(JSON.stringify(provenance).includes('OWNER_SELECTED'), false);
    const evidence = JSON.parse(profile.legacy_evidence_json);
    assert.equal(evidence.migrationFingerprint, assessment.migrationFingerprint);
    assert.equal(Object.prototype.hasOwnProperty.call(evidence, 'pumpShellCompatibilityEvidence'), true);
    assert.deepEqual(JSON.parse(knowledge.items_json).map(item => item.key), ['rotorLength']);
    assert.equal(JSON.parse(knowledge.items_json)[0].source.sourceKind, 'MIGRATED_TECHNICAL_KNOWLEDGE');
    assert.deepEqual(db.prepare(`SELECT technical_data_json, custom_barrel_length, impeller_thickness FROM recipes WHERE id = ?`).get(recipeId), beforeLegacy);
    assert.equal(counts(db).knowledge_entries, 0);
    assert.equal(dryRun.assess(recipeId).classification, 'ALREADY_CANONICAL');
});

test('safe incomplete target remains incomplete without fabricating missing fields', t => {
    const { db, recipeId, service } = fixture(t, {
        technicalDataJson: JSON.stringify({ stackOffset: 1, oilSealDiameter: 20, impellerBoreDiameter: 12, impellerSpan: 24, impellerDepth: 3, threadLength: 14, threadDiameter: 8, upperBearing: '202', lowerBearing: '6303', bearingSpan: 80 }),
    });
    const plan = preview(service, recipeId);
    assert.equal(plan.classification, 'AUTO_MIGRATABLE');
    assert.equal(plan.target.completenessState, 'INCOMPLETE');
    apply(service, recipeId, plan.confirmationToken, 'recipe-backfill-test-0002');
    const profile = db.prepare(`SELECT rotor_diameter, completeness_state, migration_state FROM recipe_functional_technical_profiles WHERE recipe_id = ?`).get(recipeId);
    assert.equal(profile.rotor_diameter, null);
    assert.equal(profile.completeness_state, 'INCOMPLETE');
    assert.equal(profile.migration_state, 'AUTO_MIGRATED');
});

test('review, blocked, and existing canonical assessments cannot issue or execute automatic backfill', t => {
    const review = fixture(t, { duplicateBearing: true });
    assert.throws(() => preview(review.service, review.recipeId), error => error.code === 'technical_profile_migration_not_write_eligible');
    const blocked = fixture(t, { remark: '{"isStainless":0}' });
    assert.throws(() => preview(blocked.service, blocked.recipeId), error => error.code === 'technical_profile_migration_not_write_eligible');
    const existing = fixture(t);
    existing.db.prepare(`INSERT INTO recipe_functional_technical_profiles (recipe_id, schema_version, completeness_state, migration_state, provenance_json, legacy_evidence_json, created_at, updated_at) VALUES (?, 1, 'INCOMPLETE', 'ALREADY_CANONICAL', '{}', '{}', ?, ?)`)
        .run(existing.recipeId, NOW, NOW);
    assert.throws(() => preview(existing.service, existing.recipeId), error => error.code === 'technical_profile_migration_not_write_eligible');
});

test('stale preview rolls back before canonical rows, audit, business event, and receipt are committed', t => {
    const { db, recipeId, service } = fixture(t);
    const plan = preview(service, recipeId);
    const before = counts(db);
    db.prepare(`UPDATE recipes SET technical_data_json = ? WHERE id = ?`).run(JSON.stringify({ rotorDiameter: 99 }), recipeId);
    assert.throws(() => apply(service, recipeId, plan.confirmationToken, 'recipe-backfill-test-0003'), error => error.code === 'technical_profile_migration_preview_stale');
    assert.deepEqual(counts(db), before);
});

test('same confirmation and idempotency key replays receipt without duplicate audits or events', t => {
    const { db, recipeId, service } = fixture(t);
    const plan = preview(service, recipeId);
    const first = apply(service, recipeId, plan.confirmationToken, 'recipe-backfill-test-0004');
    const afterFirst = counts(db);
    const replay = apply(service, recipeId, plan.confirmationToken, 'recipe-backfill-test-0004');
    assert.equal(first.idempotentReplay, false);
    assert.equal(replay.idempotentReplay, true);
    assert.deepEqual(counts(db), afterFirst);
});

test('fingerprint ignores unrelated PumpShell defaults and part commercial values, while backfill remains outside AI write admission', t => {
    const { db, recipeId, shellId, service } = fixture(t);
    const plan = preview(service, recipeId);
    db.prepare(`UPDATE parts SET remark = ?, price = 999, stock = 123 WHERE id = ?`)
        .run('{"isStainless":false,"defaultUpperBearing":"legacy-only","defaultThreadLength":88}', shellId);
    const result = apply(service, recipeId, plan.confirmationToken, 'recipe-backfill-test-irrelevant');
    assert.equal(result.status, 'completed');
    const capability = getBusinessCapability('recipes.technical_profile.migration_backfill');
    assert.deepEqual(capability.callers, ['web', 'internal']);
    assert.equal(listAiCapabilities().some(item => item.formalCapabilityIds?.includes(capability.capabilityId)), false);
    assert.equal(writeCapabilityNames().includes(capability.capabilityId), false);
});

test('write, audit, business-change, readback, and post-verification failures roll back all D-A writes', t => {
    const knowledgeFail = fixture(t, {
        dependencies: {
            persistTechnicalKnowledge: () => { throw new Error('forced knowledge write failure'); },
        },
    });
    const knowledgePlan = preview(knowledgeFail.service, knowledgeFail.recipeId);
    const knowledgeBefore = counts(knowledgeFail.db);
    assert.throws(() => apply(knowledgeFail.service, knowledgeFail.recipeId, knowledgePlan.confirmationToken, 'recipe-backfill-test-0005'));
    assert.deepEqual(counts(knowledgeFail.db), knowledgeBefore);

    const auditFail = fixture(t, {
        dependencies: {
            writeAuditLog: () => { throw new Error('forced audit failure'); },
        },
    });
    const auditPlan = preview(auditFail.service, auditFail.recipeId);
    const auditBefore = counts(auditFail.db);
    assert.throws(() => apply(auditFail.service, auditFail.recipeId, auditPlan.confirmationToken, 'recipe-backfill-test-0006'));
    assert.deepEqual(counts(auditFail.db), auditBefore);

    const eventFail = fixture(t);
    eventFail.db.exec(`CREATE TRIGGER fail_backfill_event BEFORE INSERT ON business_change_events BEGIN SELECT RAISE(ABORT, 'forced business-change failure'); END`);
    const eventPlan = preview(eventFail.service, eventFail.recipeId);
    const eventBefore = counts(eventFail.db);
    assert.throws(() => apply(eventFail.service, eventFail.recipeId, eventPlan.confirmationToken, 'recipe-backfill-test-0007'));
    assert.deepEqual(counts(eventFail.db), eventBefore);

    const verifyFail = fixture(t, {
        dependencies: {
            postWriteVerify: () => { throw new Error('forced readback failure'); },
        },
    });
    const verifyPlan = preview(verifyFail.service, verifyFail.recipeId);
    const verifyBefore = counts(verifyFail.db);
    assert.throws(() => apply(verifyFail.service, verifyFail.recipeId, verifyPlan.confirmationToken, 'recipe-backfill-test-0008'));
    assert.deepEqual(counts(verifyFail.db), verifyBefore);

    const postVerifyFail = fixture(t, {
        dependencies: {
            postDryRunVerify: () => { throw new Error('forced post dry-run verification failure'); },
        },
    });
    const postPlan = preview(postVerifyFail.service, postVerifyFail.recipeId);
    const postBefore = counts(postVerifyFail.db);
    assert.throws(() => apply(postVerifyFail.service, postVerifyFail.recipeId, postPlan.confirmationToken, 'recipe-backfill-test-0009'));
    assert.deepEqual(counts(postVerifyFail.db), postBefore);
});
