const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    DRY_RUN_CAPABILITY_ID,
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

function insertCanonicalPair(db, recipeId) {
    db.prepare(`
        INSERT INTO recipe_functional_technical_profiles (
            recipe_id, schema_version, completeness_state, migration_state,
            provenance_json, legacy_evidence_json, created_at, updated_at
        ) VALUES (?, 1, 'INCOMPLETE', 'ALREADY_CANONICAL', '{}', '{}', ?, ?)
    `).run(recipeId, NOW, NOW);
    db.prepare(`
        INSERT INTO recipe_technical_knowledge (recipe_id, schema_version, items_json, created_at, updated_at)
        VALUES (?, 1, '[]', ?, ?)
    `).run(recipeId, NOW, NOW);
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
    assert.match(assessment.fingerprint, /^[0-9a-f]{64}$/u);
    assert.deepEqual(writeSnapshot(db), before);
    assert.equal(db.totalChanges, changesBefore, 'the read-only assessment must not increment SQLite changes');
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

    const unknown = fixture(t, { remark: '{"isStainless":0}' });
    const unknownAssessment = unknown.service.assess(unknown.recipeId);
    assert.equal(unknownAssessment.policy.stainlessMode, 'UNKNOWN_OR_UNRESOLVED');
    assert.equal(unknownAssessment.policy.isStainless, null);
    assert.equal(unknownAssessment.classification, 'BLOCKED_UNRESOLVED');
    assert.equal(unknownAssessment.candidate.functional.bearingSpanExplicit.status, 'NOT_PROPOSED_POLICY_UNRESOLVED');
});

test('bearing migration is exact-only: ambiguity requires review and no candidates block without selecting a Part', t => {
    const ambiguous = fixture(t, { duplicate6202: true });
    const ambiguousAssessment = ambiguous.service.assess(ambiguous.recipeId);
    assert.equal(ambiguousAssessment.candidate.bearings.upper.resolutionMode, 'AMBIGUOUS');
    assert.equal(ambiguousAssessment.candidate.functional.upperBearingPartId.value, null);
    assert.equal(ambiguousAssessment.classification, 'NEEDS_OWNER_REVIEW');

    const missing = fixture(t, { technicalDataJson: JSON.stringify({ upperBearing: '9999', lowerBearing: '6303' }) });
    const missingAssessment = missing.service.assess(missing.recipeId);
    assert.equal(missingAssessment.candidate.bearings.upper.resolutionMode, 'NOT_FOUND');
    assert.equal(missingAssessment.candidate.functional.upperBearingPartId.value, null);
    assert.equal(missingAssessment.classification, 'BLOCKED_UNRESOLVED');
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
});

test('canonical pair is never overwritten by legacy candidates and partial canonical state is conservatively review-only', t => {
    const complete = fixture(t);
    insertCanonicalPair(complete.db, complete.recipeId);
    const assessment = complete.service.assess(complete.recipeId);
    assert.equal(assessment.classification, 'ALREADY_CANONICAL');
    assert.equal(assessment.canonical.functionalPresent, true);
    assert.equal(assessment.canonical.technicalKnowledgePresent, true);

    const partial = fixture(t);
    partial.db.prepare(`
        INSERT INTO recipe_technical_knowledge (recipe_id, schema_version, items_json, created_at, updated_at)
        VALUES (?, 1, '[]', ?, ?)
    `).run(partial.recipeId, NOW, NOW);
    const partialAssessment = partial.service.assess(partial.recipeId);
    assert.equal(partialAssessment.classification, 'NEEDS_OWNER_REVIEW');
    assert.ok(partialAssessment.reasons.some(reason => reason.code === 'CANONICAL_STORAGE_PARTIAL'));
});

test('collection report and derived owner review queue are bounded, ordered, deterministic, and read-only', t => {
    const { db, recipeId, service } = fixture(t, { name: 'one' });
    const secondId = Number(db.prepare(`
        INSERT INTO recipes (name, technical_data_json, created_at, updated_at)
        VALUES ('two', '{}', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    const before = writeSnapshot(db);
    const first = service.list({ limit: 1, offset: 0 });
    const repeated = service.list({ limit: 1, offset: 0 });
    assert.equal(first.capabilityId, DRY_RUN_CAPABILITY_ID);
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].recipeId, recipeId);
    assert.equal(first.page.hasMore, true);
    assert.deepEqual(first, repeated);
    const queue = service.reviewQueue({ limit: 10, offset: 0 });
    assert.equal(queue.capabilityId, REVIEW_QUEUE_CAPABILITY_ID);
    assert.ok(queue.items.every(item => item.actionRequired));
    assert.ok(queue.items.some(item => item.recipeId === secondId));
    assert.deepEqual(writeSnapshot(db), before);
});

test('dry-run read capabilities are query-only and remain outside AI and write admission surfaces', () => {
    assert.equal(getBusinessCapability(DRY_RUN_CAPABILITY_ID).access, 'query');
    assert.equal(getBusinessCapability(REVIEW_QUEUE_CAPABILITY_ID).access, 'query');
    assert.equal(JSON.stringify(listAiCapabilities()).includes(DRY_RUN_CAPABILITY_ID), false);
    assert.equal(JSON.stringify(listAiCapabilities()).includes(REVIEW_QUEUE_CAPABILITY_ID), false);
    assert.equal(writeCapabilityNames().includes(DRY_RUN_CAPABILITY_ID), false);
    assert.equal(writeCapabilityNames().includes(REVIEW_QUEUE_CAPABILITY_ID), false);
});
