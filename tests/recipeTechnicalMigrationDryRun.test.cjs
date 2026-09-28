const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    DRY_RUN_CAPABILITY_ID,
    MIGRATION_VERSION,
    REVIEW_QUEUE_CAPABILITY_ID,
    createRecipeTechnicalMigrationDryRunService,
} = require('../api/services/recipeTechnicalMigrationDryRun.cjs');
const { getBusinessCapability, listAiCapabilities, writeCapabilityNames } = require('../api/capabilities/registry.cjs');

const NOW = '2026-09-28T00:00:00.000Z';

function fixture(t, options = {}) {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, { now: NOW });
    t.after(() => db.close());
    const shellPartId = Number(db.prepare(`
        INSERT INTO parts (model, category, remark, created_at, updated_at)
        VALUES ('dry-shell', '泵壳', ?, ?, ?)
    `).run(options.remark ?? '{"isStainless":false}', NOW, NOW).lastInsertRowid);
    const bearing6202Id = Number(db.prepare(`
        INSERT INTO parts (model, category, supplier, created_at, updated_at)
        VALUES ('轴承-6202', '轴承', 'supplier-a', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    const bearing6303Id = Number(db.prepare(`
        INSERT INTO parts (model, category, supplier, created_at, updated_at)
        VALUES ('轴承-6303', '轴承', 'supplier-a', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    if (options.duplicate6202) {
        db.prepare(`INSERT INTO parts (model, category, supplier, created_at, updated_at) VALUES ('轴承-6202', '轴承', 'supplier-b', ?, ?)`)
            .run(NOW, NOW);
    }
    const templateId = Number(db.prepare(`
        INSERT INTO pump_shell_templates (shell_model, created_at, updated_at)
        VALUES ('dry-template', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    if (options.binding !== false) db.prepare(`
        INSERT INTO catalog_template_shell_bindings (template_id, shell_part_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
    `).run(templateId, shellPartId, NOW, NOW);
    const recipeId = Number(db.prepare(`
        INSERT INTO recipes (
            name, template_id, coil_sheets, custom_barrel_length,
            impeller_model, impeller_thickness, impeller_diameter, impeller_blade_count,
            technical_data_json, created_at, updated_at
        ) VALUES (?, ?, 160, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        options.name || 'dry-recipe', templateId, options.barrelLength ?? 120,
        options.impellerModel ?? '', options.impellerThickness ?? null,
        options.impellerDiameter ?? null, options.impellerBladeCount ?? null,
        options.technicalDataJson ?? JSON.stringify({
            rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20,
            impellerBoreDiameter: 12, impellerSpan: 24, threadLength: 14,
            threadDiameter: 8, impellerDepth: 3, upperBearing: '202', lowerBearing: '6303',
            bearingSpan: 80, rotorLength: 150, customerSpecialNote: 'keep as knowledge', pieceCount: 999,
        }), NOW, NOW,
    ).lastInsertRowid);
    return {
        db, recipeId, shellPartId, bearing6202Id, bearing6303Id,
        service: createRecipeTechnicalMigrationDryRunService({ db }),
    };
}

function writeSnapshot(db) {
    const tables = [
        'recipe_functional_technical_profiles', 'recipe_technical_knowledge', 'recipes', 'parts',
        'pump_shell_templates', 'catalog_template_shell_bindings', 'audit_log', 'business_change_events',
        'api_operations', 'knowledge_entries',
    ];
    return Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
}

function insertCanonicalPair(db, recipeId, options = {}) {
    db.prepare(`
        INSERT INTO recipe_functional_technical_profiles (
            recipe_id, schema_version, completeness_state, migration_state,
            migration_version, migration_fingerprint, rotor_diameter,
            provenance_json, legacy_evidence_json, created_at, updated_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, '{}', '{}', ?, ?)
    `).run(
        recipeId,
        options.completenessState || 'INCOMPLETE',
        options.migrationState || 'ALREADY_CANONICAL',
        options.migrationVersion ?? null,
        options.migrationFingerprint ?? null,
        options.rotorDiameter ?? null,
        NOW,
        NOW,
    );
    db.prepare(`
        INSERT INTO recipe_technical_knowledge (recipe_id, schema_version, items_json, created_at, updated_at)
        VALUES (?, 1, '[]', ?, ?)
    `).run(recipeId, NOW, NOW);
}

function materializeMigratedTarget(db, recipeId, assessment) {
    const functional = assessment.target.functional;
    assert.ok(functional, 'a migration target must be write-eligible before test materialization');
    const values = [
        recipeId,
        functional.rotorDiameter, functional.stackOffset, functional.oilSealDiameter,
        functional.impellerBoreDiameter, functional.impellerSpan, functional.impellerThickness,
        functional.threadLength, functional.threadDiameter, functional.barrelLength,
        functional.openOffset, functional.bearingSpanExplicit, functional.upperBearingPartId,
        functional.lowerBearingPartId, assessment.target.completenessState,
        assessment.target.migrationState, assessment.migrationVersion, assessment.migrationFingerprint,
        NOW, NOW,
    ];
    db.prepare(`
        INSERT INTO recipe_functional_technical_profiles (
            recipe_id, rotor_diameter, stack_offset, oil_seal_diameter,
            impeller_bore_diameter, impeller_span, impeller_thickness,
            thread_length, thread_diameter, barrel_length, open_offset,
            bearing_span_explicit, upper_bearing_part_id, lower_bearing_part_id,
            schema_version, completeness_state, migration_state, migration_version,
            migration_fingerprint, provenance_json, legacy_evidence_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, '{}', '{}', ?, ?)
    `).run(...values);
    db.prepare(`
        INSERT INTO recipe_technical_knowledge (recipe_id, schema_version, items_json, created_at, updated_at)
        VALUES (?, 1, ?, ?, ?)
    `).run(recipeId, JSON.stringify(assessment.candidate.technicalKnowledge.items), NOW, NOW);
}

function insertRecipe(db, values = {}) {
    return Number(db.prepare(`
        INSERT INTO recipes (name, template_id, coil_id, custom_barrel_length, impeller_thickness, technical_data_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        values.name || 'additional-recipe', values.templateId ?? null, values.coilId ?? null,
        values.barrelLength ?? null, values.impellerThickness ?? null,
        values.technicalDataJson ?? '{}', NOW, NOW,
    ).lastInsertRowid);
}

test('dry run proposes deterministic direct candidates, exact bearing IDs, knowledge items, and makes zero writes', t => {
    const { db, recipeId, bearing6202Id, bearing6303Id, service } = fixture(t, { impellerThickness: 3 });
    const before = writeSnapshot(db);
    const changesBefore = db.totalChanges;
    const assessment = service.assess(recipeId);
    assert.equal(assessment.classification, 'MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE');
    assert.equal(assessment.candidate.functional.rotorDiameter.value, 52);
    assert.equal(assessment.candidate.functional.upperBearingPartId.value, bearing6202Id);
    assert.equal(assessment.candidate.functional.lowerBearingPartId.value, bearing6303Id);
    assert.equal(assessment.candidate.bearings.upper.resolutionMode, 'EXACT_UNIQUE');
    assert.equal(assessment.candidate.functional.impellerThickness.value, 3);
    assert.equal(assessment.candidate.functional.impellerThickness.status, 'PROPOSED_WITH_COMPATIBILITY_EVIDENCE');
    assert.equal(assessment.candidate.functional.bearingSpanExplicit.value, 80);
    assert.equal(assessment.sourceSnapshot.pieceCount.value, 160);
    assert.equal(assessment.sourceSnapshot.pieceCount.storedMigrationCandidate, false);
    const knowledgeKeys = assessment.candidate.technicalKnowledge.items.map(item => item.key);
    assert.ok(knowledgeKeys.includes('rotorLength'));
    assert.ok(knowledgeKeys.includes('customerSpecialNote'));
    assert.equal(knowledgeKeys.includes('rotorDiameter'), false);
    assert.equal(knowledgeKeys.includes('pieceCount'), false);
    assert.deepEqual(Object.keys(assessment.candidate.technicalKnowledge.items[0]).sort(), ['key', 'label', 'value']);
    assert.ok(assessment.candidate.technicalKnowledge.migrationEvidence.rotorLength);
    assert.match(assessment.fingerprint, /^[0-9a-f]{64}$/u);
    assert.deepEqual(writeSnapshot(db), before);
    assert.equal(db.totalChanges, changesBefore, 'the read-only assessment must not increment SQLite changes');
});

test('target state separates safe incomplete migration from unresolved or review-only authority', t => {
    const complete = fixture(t, { impellerThickness: 3 });
    const completeAssessment = complete.service.assess(complete.recipeId);
    assert.equal(completeAssessment.target.writeEligible, true);
    assert.equal(completeAssessment.target.completenessState, 'COMPLETE');
    assert.deepEqual(completeAssessment.target.missingSet, []);

    const missingRotor = fixture(t, {
        impellerThickness: null,
        technicalDataJson: JSON.stringify({
            stackOffset: 1, oilSealDiameter: 20, impellerBoreDiameter: 12, impellerSpan: 24,
            impellerDepth: 3, threadLength: 14, threadDiameter: 8, upperBearing: '202', lowerBearing: '6303', bearingSpan: 80,
        }),
    });
    const missingRotorAssessment = missingRotor.service.assess(missingRotor.recipeId);
    assert.equal(missingRotorAssessment.classification, 'AUTO_MIGRATABLE');
    assert.equal(missingRotorAssessment.target.writeEligible, true);
    assert.equal(missingRotorAssessment.target.completenessState, 'INCOMPLETE');
    assert.ok(missingRotorAssessment.target.missingSet.includes('rotorDiameter'));

    const missingBearing = fixture(t, {
        impellerThickness: null,
        technicalDataJson: JSON.stringify({
            rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20, impellerBoreDiameter: 12, impellerSpan: 24,
            impellerDepth: 3, threadLength: 14, threadDiameter: 8, lowerBearing: '6303', bearingSpan: 80,
        }),
    });
    const missingBearingAssessment = missingBearing.service.assess(missingBearing.recipeId);
    assert.equal(missingBearingAssessment.target.writeEligible, true);
    assert.equal(missingBearingAssessment.target.completenessState, 'INCOMPLETE');
    assert.ok(missingBearingAssessment.target.missingSet.includes('upperBearingPartId'));

    const geometry = fixture(t, {
        impellerThickness: null,
        technicalDataJson: JSON.stringify({
            rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20, impellerBoreDiameter: 12, impellerSpan: 24,
            impellerDepth: 3, threadLength: 14, threadDiameter: 8, upperBearing: '9999', lowerBearing: '6303', bearingSpan: 80,
        }),
    });
    geometry.db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-9999', '轴承', ?, ?)`).run(NOW, NOW);
    const geometryAssessment = geometry.service.assess(geometry.recipeId);
    assert.equal(geometryAssessment.target.functional.upperBearingPartId !== null, true);
    assert.equal(geometryAssessment.target.completenessState, 'INCOMPLETE');
    assert.ok(geometryAssessment.target.unresolvedSet.some(value => value.includes('upperBearingPartId:GEOMETRY_UNRESOLVED')));
});

test('migration parser reuses the existing deterministic historical numeric grammar but preserves raw evidence', t => {
    const { recipeId, service } = fixture(t, {
        technicalDataJson: JSON.stringify({ rotorDiameter: '52', stackOffset: '1', impellerDepth: 3 }),
    });
    const assessment = service.assess(recipeId);
    assert.equal(assessment.candidate.functional.rotorDiameter.value, 52);
    assert.equal(assessment.candidate.functional.rotorDiameter.rawValue, '52');
    assert.equal(assessment.candidate.functional.stackOffset.value, 1);
});

test('stainless open offset remains compatibility evidence and requires owner review; numeric stainless metadata is blocked, never false', t => {
    const stainless = fixture(t, { remark: '{"isStainless":true,"openOffset":21,"openFactor":1.2}' });
    const stainlessAssessment = stainless.service.assess(stainless.recipeId);
    assert.equal(stainlessAssessment.policy.stainlessMode, 'STAINLESS');
    assert.equal(stainlessAssessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.equal(stainlessAssessment.candidate.functional.openOffset.status, 'NOT_PROPOSED_COMPATIBILITY_ONLY');
    assert.deepEqual(stainlessAssessment.candidate.functional.openOffset.rawValue, { openOffset: 21, openFactor: 1.2 });
    assert.ok(stainlessAssessment.reasons.some(reason => reason.code === 'OPEN_OFFSET_OWNER_CONFIRMATION_REQUIRED'));
    assert.equal(stainlessAssessment.candidate.functional.bearingSpanExplicit.status, 'NOT_PROPOSED_DERIVED_ONLY');
    assert.equal(stainlessAssessment.target.writeEligible, false);
    assert.ok(stainlessAssessment.target.missingSet.includes('openOffset'));
    assert.equal(stainlessAssessment.spanAssessment.mode, 'STAINLESS_DERIVED');

    const unknown = fixture(t, { remark: '{"isStainless":0}' });
    const unknownAssessment = unknown.service.assess(unknown.recipeId);
    assert.equal(unknownAssessment.policy.stainlessMode, 'UNKNOWN_OR_UNRESOLVED');
    assert.equal(unknownAssessment.policy.isStainless, null);
    assert.equal(unknownAssessment.classification, 'BLOCKED_UNRESOLVED');
    assert.equal(unknownAssessment.candidate.functional.bearingSpanExplicit.status, 'NOT_PROPOSED_POLICY_UNRESOLVED');
    assert.equal(unknownAssessment.target.writeEligible, false);
    assert.ok(unknownAssessment.target.unresolvedSet.some(value => value.startsWith('policy:')));
});

test('bearing migration is exact-only: ambiguity requires review and no candidates block without selecting a Part', t => {
    const ambiguous = fixture(t, { duplicate6202: true });
    const ambiguousAssessment = ambiguous.service.assess(ambiguous.recipeId);
    assert.equal(ambiguousAssessment.candidate.bearings.upper.resolutionMode, 'AMBIGUOUS');
    assert.equal(ambiguousAssessment.candidate.functional.upperBearingPartId.value, null);
    assert.equal(ambiguousAssessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.equal(ambiguousAssessment.target.writeEligible, false);

    const missing = fixture(t, { technicalDataJson: JSON.stringify({ upperBearing: '9999', lowerBearing: '6303' }) });
    const missingAssessment = missing.service.assess(missing.recipeId);
    assert.equal(missingAssessment.candidate.bearings.upper.resolutionMode, 'NOT_FOUND');
    assert.equal(missingAssessment.candidate.functional.upperBearingPartId.value, null);
    assert.equal(missingAssessment.classification, 'BLOCKED_UNRESOLVED');
    assert.equal(missingAssessment.target.writeEligible, false);
});

test('impeller thickness applies the frozen four-source matrix without JSON-first conflict selection', t => {
    const missing = fixture(t, { technicalDataJson: JSON.stringify({}), impellerThickness: null });
    assert.equal(missing.service.assess(missing.recipeId).candidate.functional.impellerThickness.status, 'MISSING');

    const jsonOnly = fixture(t, { technicalDataJson: JSON.stringify({ impellerDepth: 3 }), impellerThickness: null });
    assert.equal(jsonOnly.service.assess(jsonOnly.recipeId).candidate.functional.impellerThickness.source, 'MIGRATED_RECIPE_TECHNICAL_JSON');

    const columnOnly = fixture(t, { technicalDataJson: JSON.stringify({}), impellerThickness: 3 });
    assert.equal(columnOnly.service.assess(columnOnly.recipeId).candidate.functional.impellerThickness.source, 'MIGRATED_RECIPE_COLUMN');

    const conflict = fixture(t, { technicalDataJson: JSON.stringify({ impellerDepth: 3 }), impellerThickness: 4 });
    const assessment = conflict.service.assess(conflict.recipeId);
    assert.equal(assessment.candidate.functional.impellerThickness.status, 'CONFLICT');
    assert.equal(assessment.candidate.functional.impellerThickness.value, null);
    assert.equal(assessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.equal(assessment.target.writeEligible, false);
});

test('canonical pair is never overwritten by legacy candidates and partial canonical state is conservatively review-only', t => {
    const complete = fixture(t);
    insertCanonicalPair(complete.db, complete.recipeId);
    const assessment = complete.service.assess(complete.recipeId);
    assert.equal(assessment.classification, 'ALREADY_CANONICAL');
    assert.equal(assessment.canonical.functionalPresent, true);
    assert.equal(assessment.canonical.technicalKnowledgePresent, true);
    assert.equal(assessment.target.writeEligible, false);

    const partial = fixture(t);
    partial.db.prepare(`
        INSERT INTO recipe_technical_knowledge (recipe_id, schema_version, items_json, created_at, updated_at)
        VALUES (?, 1, '[]', ?, ?)
    `).run(partial.recipeId, NOW, NOW);
    const partialAssessment = partial.service.assess(partial.recipeId);
    assert.equal(partialAssessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.ok(partialAssessment.reasons.some(reason => reason.code === 'CANONICAL_STORAGE_PARTIAL'));
});

test('canonical disposition preserves stored review/block authority and surfaces current values separately from legacy candidates', t => {
    const owner = fixture(t);
    insertCanonicalPair(owner.db, owner.recipeId, { rotorDiameter: 55 });
    const ownerAssessment = owner.service.assess(owner.recipeId);
    assert.equal(ownerAssessment.classification, 'ALREADY_CANONICAL');
    assert.equal(ownerAssessment.canonical.currentFunctional.rotorDiameter, 55);
    assert.equal(ownerAssessment.candidate.functional.rotorDiameter.value, 52);
    assert.equal(ownerAssessment.target.writeEligible, false);
    assert.equal(ownerAssessment.target.functional, null);
    assert.equal(ownerAssessment.canonical.currentTechnicalKnowledge.items.length, 0);

    const storedReview = fixture(t);
    insertCanonicalPair(storedReview.db, storedReview.recipeId, { migrationState: 'NEEDS_OWNER_REVIEW' });
    const reviewAssessment = storedReview.service.assess(storedReview.recipeId);
    assert.equal(reviewAssessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.equal(reviewAssessment.actionRequired, true);
    assert.ok(reviewAssessment.reasons.some(reason => reason.code === 'CANONICAL_MIGRATION_REVIEW_REQUIRED'));
    assert.equal(reviewAssessment.target.writeEligible, false);

    const storedBlocked = fixture(t);
    insertCanonicalPair(storedBlocked.db, storedBlocked.recipeId, { migrationState: 'BLOCKED_UNRESOLVED' });
    const blockedAssessment = storedBlocked.service.assess(storedBlocked.recipeId);
    assert.equal(blockedAssessment.classification, 'BLOCKED_UNRESOLVED');
    assert.equal(blockedAssessment.actionRequired, true);
    assert.ok(blockedAssessment.reasons.some(reason => reason.code === 'CANONICAL_MIGRATION_BLOCKED'));

    const partial = fixture(t);
    partial.db.prepare(`
        INSERT INTO recipe_functional_technical_profiles (
            recipe_id, rotor_diameter, schema_version, completeness_state, migration_state,
            provenance_json, legacy_evidence_json, created_at, updated_at
        ) VALUES (?, 55, 1, 'INCOMPLETE', 'ALREADY_CANONICAL', '{}', '{}', ?, ?)
    `).run(partial.recipeId, NOW, NOW);
    const partialAssessment = partial.service.assess(partial.recipeId);
    assert.equal(partialAssessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.equal(partialAssessment.canonical.currentFunctional.rotorDiameter, 55);
    assert.equal(partialAssessment.candidate.functional.rotorDiameter.value, 52);
    assert.equal(partialAssessment.target.writeEligible, false);
    assert.equal(partialAssessment.target.functional, null);
});

test('stable migration fingerprint survives exact materialization and detects migrated source drift without using canonical row state', t => {
    const { db, recipeId, shellPartId, service } = fixture(t, { impellerThickness: null });
    const before = writeSnapshot(db);
    const preWrite = service.assess(recipeId);
    assert.equal(preWrite.classification, 'AUTO_MIGRATABLE');
    assert.match(preWrite.migrationFingerprint, /^[0-9a-f]{64}$/u);
    assert.equal(preWrite.fingerprint, preWrite.migrationFingerprint, 'R1 alias must be explicit and stable');
    materializeMigratedTarget(db, recipeId, preWrite);
    const matching = service.assess(recipeId);
    assert.equal(matching.migrationFingerprint, preWrite.migrationFingerprint);
    assert.equal(matching.classification, 'ALREADY_CANONICAL');
    assert.equal(matching.target.writeEligible, false);
    assert.ok(matching.reasons.some(reason => reason.code === 'MIGRATION_FINGERPRINT_MATCH'));
    assert.equal(matching.canonical.migrationVersion, MIGRATION_VERSION);

    db.prepare(`UPDATE recipes SET technical_data_json = ? WHERE id = ?`)
        .run(JSON.stringify({ rotorDiameter: 53, stackOffset: 1, oilSealDiameter: 20, impellerBoreDiameter: 12, impellerSpan: 24, impellerDepth: 3, threadLength: 14, threadDiameter: 8, upperBearing: '202', lowerBearing: '6303', bearingSpan: 80 }), recipeId);
    const drift = service.assess(recipeId);
    assert.notEqual(drift.migrationFingerprint, preWrite.migrationFingerprint);
    assert.equal(drift.classification, 'NEEDS_OWNER_REVIEW');
    assert.equal(drift.canonical.currentFunctional.rotorDiameter, 52);
    assert.equal(drift.target.writeEligible, false);
    assert.ok(drift.reasons.some(reason => reason.code === 'MIGRATION_SOURCE_CHANGED'));

    db.prepare(`UPDATE parts SET price = 123, stock = 456 WHERE id = ?`).run(shellPartId);
    assert.equal(service.assess(recipeId).migrationFingerprint, drift.migrationFingerprint);
    assert.notDeepEqual(writeSnapshot(db), before, 'test-only materialization is the sole intentional setup write');
});

test('migrated fingerprint/version and canonical completeness metadata fail closed into owner review', t => {
    const missingFingerprint = fixture(t, { impellerThickness: null });
    const candidate = missingFingerprint.service.assess(missingFingerprint.recipeId);
    materializeMigratedTarget(missingFingerprint.db, missingFingerprint.recipeId, candidate);
    missingFingerprint.db.prepare(`UPDATE recipe_functional_technical_profiles SET migration_fingerprint = NULL WHERE recipe_id = ?`).run(missingFingerprint.recipeId);
    const missing = missingFingerprint.service.assess(missingFingerprint.recipeId);
    assert.equal(missing.classification, 'NEEDS_OWNER_REVIEW');
    assert.ok(missing.reasons.some(reason => reason.code === 'MIGRATION_FINGERPRINT_MISSING'));

    const unsupported = fixture(t, { impellerThickness: null });
    const compatible = unsupported.service.assess(unsupported.recipeId);
    materializeMigratedTarget(unsupported.db, unsupported.recipeId, compatible);
    unsupported.db.prepare(`UPDATE recipe_functional_technical_profiles SET migration_version = 'unsupported-v99' WHERE recipe_id = ?`).run(unsupported.recipeId);
    const unsupportedAssessment = unsupported.service.assess(unsupported.recipeId);
    assert.equal(unsupportedAssessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.ok(unsupportedAssessment.reasons.some(reason => reason.code === 'MIGRATION_VERSION_UNSUPPORTED'));

    const needsReview = fixture(t);
    insertCanonicalPair(needsReview.db, needsReview.recipeId, { completenessState: 'NEEDS_REVIEW' });
    const reviewAssessment = needsReview.service.assess(needsReview.recipeId);
    assert.equal(reviewAssessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.ok(reviewAssessment.reasons.some(reason => reason.code === 'CANONICAL_COMPLETENESS_REVIEW_REQUIRED'));

    const compatibility = fixture(t, { impellerThickness: 3 });
    const compatibilityCandidate = compatibility.service.assess(compatibility.recipeId);
    assert.equal(compatibilityCandidate.classification, 'MIGRATABLE_WITH_COMPATIBILITY_PROVENANCE');
    materializeMigratedTarget(compatibility.db, compatibility.recipeId, compatibilityCandidate);
    const compatibilityAssessment = compatibility.service.assess(compatibility.recipeId);
    assert.equal(compatibilityAssessment.classification, 'ALREADY_CANONICAL');
    assert.ok(compatibilityAssessment.reasons.some(reason => reason.code === 'MIGRATION_FINGERPRINT_MATCH'));
});

test('review queue and cohort summary honor stored canonical review and blocked states', t => {
    const { db, recipeId, service } = fixture(t);
    insertCanonicalPair(db, recipeId, { migrationState: 'NEEDS_OWNER_REVIEW' });
    const blockedId = insertRecipe(db, { name: 'stored-blocked', technicalDataJson: '{}' });
    insertCanonicalPair(db, blockedId, { migrationState: 'BLOCKED_UNRESOLVED' });
    const templateId = Number(db.prepare('SELECT template_id AS id FROM recipes WHERE id = ?').get(recipeId).id);
    const safeIncompleteId = insertRecipe(db, { name: 'safe-incomplete', templateId, technicalDataJson: '{}' });
    const queue = service.reviewQueue({ limit: 10, offset: 0 });
    assert.deepEqual(queue.items.map(item => item.recipeId), [recipeId, blockedId]);
    assert.equal(queue.items.some(item => item.recipeId === safeIncompleteId), false);
    const report = service.list({ limit: 10, offset: 0 });
    assert.equal(report.cohortSummary.classifications.NEEDS_OWNER_REVIEW, 1);
    assert.equal(report.cohortSummary.classifications.BLOCKED_UNRESOLVED, 1);
    assert.equal(report.cohortSummary.classifications.AUTO_MIGRATABLE, 1);
});

test('unknown canonical schema versions are review-only and never treated as overwriteable canonical pairs', t => {
    const unknown = fixture(t);
    insertCanonicalPair(unknown.db, unknown.recipeId);
    unknown.db.prepare('UPDATE recipe_functional_technical_profiles SET schema_version = 2 WHERE recipe_id = ?').run(unknown.recipeId);
    const assessment = unknown.service.assess(unknown.recipeId);
    assert.equal(assessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.equal(assessment.canonical.supported, false);
    assert.equal(assessment.target.writeEligible, false);
    assert.ok(assessment.reasons.some(reason => reason.code === 'CANONICAL_SCHEMA_VERSION_UNSUPPORTED'));

    const mixed = fixture(t);
    insertCanonicalPair(mixed.db, mixed.recipeId);
    mixed.db.prepare('UPDATE recipe_technical_knowledge SET schema_version = 2 WHERE recipe_id = ?').run(mixed.recipeId);
    assert.equal(mixed.service.assess(mixed.recipeId).classification, 'NEEDS_OWNER_REVIEW');
});

test('collection report separates page and full-cohort counts while review queue excludes safe incomplete candidates', t => {
    const { db, recipeId, service } = fixture(t, { name: 'compatibility', impellerThickness: 3 });
    insertCanonicalPair(db, recipeId);
    const templateId = Number(db.prepare('SELECT template_id AS id FROM recipes WHERE id = ?').get(recipeId).id);
    const autoId = insertRecipe(db, {
        name: 'auto', templateId, impellerThickness: null,
        technicalDataJson: JSON.stringify({
            rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20, impellerBoreDiameter: 12, impellerSpan: 24,
            impellerDepth: 3, threadLength: 14, threadDiameter: 8, upperBearing: '202', lowerBearing: '6303', bearingSpan: 80,
        }),
    });
    const ambiguousPartId = Number(db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6304', '轴承', ?, ?)`).run(NOW, NOW).lastInsertRowid);
    assert.ok(ambiguousPartId > 0);
    db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6304', '轴承', ?, ?)`).run(NOW, NOW);
    const reviewId = insertRecipe(db, { name: 'review', templateId, technicalDataJson: JSON.stringify({ upperBearing: '6304', lowerBearing: '6303' }) });
    const blockedId = insertRecipe(db, { name: 'blocked', technicalDataJson: '{}' });
    const incompleteId = insertRecipe(db, { name: 'incomplete', templateId, technicalDataJson: JSON.stringify({ upperBearing: '202', lowerBearing: '6303' }) });
    const before = writeSnapshot(db);
    const first = service.list({ limit: 1, offset: 0 });
    const second = service.list({ limit: 1, offset: 1 });
    assert.equal(first.capabilityId, DRY_RUN_CAPABILITY_ID);
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].recipeId, recipeId);
    assert.equal(first.page.hasMore, true);
    assert.equal(first.pageSummary.total, 1);
    assert.equal(first.cohortSummary.total, 5);
    assert.equal(first.cohortSummary.classifications.ALREADY_CANONICAL, 1);
    assert.equal(first.cohortSummary.classifications.AUTO_MIGRATABLE, 2);
    assert.equal(first.cohortSummary.classifications.NEEDS_OWNER_REVIEW, 1);
    assert.equal(first.cohortSummary.classifications.BLOCKED_UNRESOLVED, 1);
    assert.equal(first.cohortSummary.completeAfterMigration, 1);
    assert.equal(first.cohortSummary.incompleteAfterMigration, 1);
    assert.deepEqual(first.cohortSummary, second.cohortSummary);
    assert.equal(second.items[0].recipeId, autoId);
    const queue = service.reviewQueue({ limit: 10, offset: 0 });
    assert.equal(queue.capabilityId, REVIEW_QUEUE_CAPABILITY_ID);
    assert.ok(queue.items.every(item => item.actionRequired));
    assert.deepEqual(queue.items.map(item => item.recipeId), [reviewId, blockedId]);
    assert.equal(queue.items.some(item => item.recipeId === incompleteId), false);
    assert.deepEqual(writeSnapshot(db), before);
});

test('fingerprint covers migration decision inputs but not irrelevant Part price or stock', t => {
    const { db, recipeId, shellPartId, service } = fixture(t, { impellerThickness: null });
    const first = service.assess(recipeId).fingerprint;
    assert.equal(service.assess(recipeId).fingerprint, first);
    db.prepare(`UPDATE recipes SET technical_data_json = ? WHERE id = ?`).run(JSON.stringify({ rotorDiameter: 53, upperBearing: '202', lowerBearing: '6303' }), recipeId);
    const functionalChanged = service.assess(recipeId).fingerprint;
    assert.notEqual(functionalChanged, first);
    db.prepare(`UPDATE recipes SET template_id = NULL WHERE id = ?`).run(recipeId);
    const templateChanged = service.assess(recipeId).fingerprint;
    assert.notEqual(templateChanged, functionalChanged);
    db.prepare(`UPDATE recipes SET template_id = (SELECT id FROM pump_shell_templates LIMIT 1) WHERE id = ?`).run(recipeId);
    db.prepare(`UPDATE parts SET remark = '{"isStainless":true}' WHERE id = ?`).run(shellPartId);
    const shellChanged = service.assess(recipeId).fingerprint;
    assert.notEqual(shellChanged, templateChanged);
    db.prepare(`INSERT INTO parts (model, category, created_at, updated_at) VALUES ('轴承-6202', '轴承', ?, ?)`).run(NOW, NOW);
    const bearingChanged = service.assess(recipeId).fingerprint;
    assert.notEqual(bearingChanged, shellChanged);
    db.prepare(`UPDATE recipes SET technical_data_json = ? WHERE id = ?`).run(JSON.stringify({ rotorDiameter: 53, customerSpecialNote: 'changed' }), recipeId);
    const knowledgeChanged = service.assess(recipeId).fingerprint;
    assert.notEqual(knowledgeChanged, bearingChanged);
    const beforeIrrelevant = knowledgeChanged;
    db.prepare(`UPDATE parts SET price = 123, stock = 456 WHERE id = ?`).run(shellPartId);
    assert.equal(service.assess(recipeId).fingerprint, beforeIrrelevant);
});

test('PumpShell fingerprint evidence is normalized and excludes unrelated remark defaults', t => {
    const baseRemark = {
        isStainless: false,
        openOffset: 20,
        openFactor: 1.2,
        defaultUpperBearing: '6202',
        defaultLowerBearing: '6303',
        defaultOilSealDia: 20,
        defaultBearingSpan: 80,
        defaultImpellerDiameter: 100,
        defaultThreadLength: 14,
        defaultStackOffset: 1,
        note: 'unchanged',
    };
    const { db, recipeId, shellPartId, service } = fixture(t, { remark: JSON.stringify(baseRemark), impellerThickness: null });
    const assess = () => service.assess(recipeId);
    const baseline = assess().migrationFingerprint;
    const setRemark = value => db.prepare('UPDATE parts SET remark = ? WHERE id = ?').run(value, shellPartId);

    db.prepare('UPDATE parts SET price = 123, stock = 456 WHERE id = ?').run(shellPartId);
    assert.equal(assess().migrationFingerprint, baseline);

    for (const [key, value] of Object.entries({
        defaultUpperBearing: '6304', defaultLowerBearing: '6201', defaultOilSealDia: 22,
        defaultBearingSpan: 81, defaultImpellerDiameter: 101, defaultThreadLength: 15,
        defaultStackOffset: 2, note: 'changed metadata only',
    })) {
        setRemark(JSON.stringify({ ...baseRemark, [key]: value }));
        assert.equal(assess().migrationFingerprint, baseline, `${key} must not affect migration evidence`);
    }
    setRemark('{\n  "openFactor": 1.2,\n  "note": "unchanged",\n  "isStainless": false,\n  "openOffset": 20,\n  "defaultUpperBearing": "6202"\n}');
    assert.equal(assess().migrationFingerprint, baseline, 'JSON key order and whitespace must not drift');

    setRemark(JSON.stringify({ ...baseRemark, isStainless: true }));
    assert.notEqual(assess().migrationFingerprint, baseline);
    setRemark(JSON.stringify(Object.fromEntries(Object.entries(baseRemark).filter(([key]) => key !== 'isStainless'))));
    assert.notEqual(assess().migrationFingerprint, baseline);
    setRemark(JSON.stringify({ ...baseRemark, isStainless: 0 }));
    const numericPolicy = assess();
    assert.notEqual(numericPolicy.migrationFingerprint, baseline);
    assert.equal(numericPolicy.policy.stainlessMode, 'UNKNOWN_OR_UNRESOLVED');
    setRemark('{broken');
    assert.notEqual(assess().migrationFingerprint, baseline, 'invalid JSON must not collide with valid empty evidence');

    setRemark(JSON.stringify({ ...baseRemark, openOffset: 21 }));
    assert.notEqual(assess().migrationFingerprint, baseline);
    setRemark(JSON.stringify({ ...baseRemark, openFactor: 1.3 }));
    assert.notEqual(assess().migrationFingerprint, baseline);

    setRemark(JSON.stringify(baseRemark));
    const alternateShellId = Number(db.prepare(`
        INSERT INTO parts (model, category, remark, created_at, updated_at)
        VALUES ('alternate-shell', '泵壳', ?, ?, ?)
    `).run(JSON.stringify(baseRemark), NOW, NOW).lastInsertRowid);
    db.prepare('UPDATE catalog_template_shell_bindings SET shell_part_id = ? WHERE template_id = (SELECT template_id FROM recipes WHERE id = ?)')
        .run(alternateShellId, recipeId);
    assert.notEqual(assess().migrationFingerprint, baseline, 'formal shell binding identity is relevant');
    db.prepare('UPDATE catalog_template_shell_bindings SET shell_part_id = ? WHERE template_id = (SELECT template_id FROM recipes WHERE id = ?)')
        .run(shellPartId, recipeId);
    db.prepare("UPDATE parts SET category = '轴承' WHERE id = ?").run(shellPartId);
    assert.notEqual(assess().migrationFingerprint, baseline, 'shell category is relevant');
    db.prepare("UPDATE parts SET category = '泵壳', deleted_at = ? WHERE id = ?").run(NOW, shellPartId);
    assert.notEqual(assess().migrationFingerprint, baseline, 'shell lifecycle is relevant');
});

test('irrelevant PumpShell defaults do not drift a matching migrated canonical pair', t => {
    const baseRemark = { isStainless: false, openOffset: 20, openFactor: 1.2, defaultUpperBearing: '6202' };
    const { db, recipeId, shellPartId, service } = fixture(t, { remark: JSON.stringify(baseRemark), impellerThickness: null });
    const preWrite = service.assess(recipeId);
    materializeMigratedTarget(db, recipeId, preWrite);
    const matching = service.assess(recipeId);
    assert.equal(matching.classification, 'ALREADY_CANONICAL');
    assert.equal(matching.migrationFingerprint, preWrite.migrationFingerprint);

    db.prepare('UPDATE parts SET remark = ? WHERE id = ?')
        .run(JSON.stringify({ ...baseRemark, defaultUpperBearing: '6304' }), shellPartId);
    const irrelevant = service.assess(recipeId);
    assert.equal(irrelevant.classification, 'ALREADY_CANONICAL');
    assert.equal(irrelevant.migrationFingerprint, preWrite.migrationFingerprint);
    assert.equal(irrelevant.reasons.some(reason => reason.code === 'MIGRATION_SOURCE_CHANGED'), false);

    db.prepare('UPDATE parts SET remark = ? WHERE id = ?')
        .run(JSON.stringify({ ...baseRemark, openOffset: 21 }), shellPartId);
    const relevant = service.assess(recipeId);
    assert.equal(relevant.classification, 'NEEDS_OWNER_REVIEW');
    assert.notEqual(relevant.migrationFingerprint, preWrite.migrationFingerprint);
    assert.ok(relevant.reasons.some(reason => reason.code === 'MIGRATION_SOURCE_CHANGED'));
});

test('dry-run read capabilities are query-only and remain outside AI and write admission surfaces', () => {
    assert.equal(getBusinessCapability(DRY_RUN_CAPABILITY_ID).access, 'query');
    assert.equal(getBusinessCapability(REVIEW_QUEUE_CAPABILITY_ID).access, 'query');
    assert.equal(JSON.stringify(listAiCapabilities()).includes(DRY_RUN_CAPABILITY_ID), false);
    assert.equal(JSON.stringify(listAiCapabilities()).includes(REVIEW_QUEUE_CAPABILITY_ID), false);
    assert.equal(writeCapabilityNames().includes(DRY_RUN_CAPABILITY_ID), false);
    assert.equal(writeCapabilityNames().includes(REVIEW_QUEUE_CAPABILITY_ID), false);
});
