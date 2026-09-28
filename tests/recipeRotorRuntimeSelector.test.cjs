const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const { createRecipeTechnicalProfileService } = require('../api/services/recipeTechnicalProfile.cjs');
const { createRecipeRotorRuntimeSelector } = require('../api/services/recipeRotorRuntimeSelector.cjs');
const { buildLegacyRecipeRotorDraft } = require('../api/services/rotorQueries.cjs');
const {
    CANONICAL_READ_FLAG,
    LEGACY_PROJECTION_FLAG,
    recipeTechnicalRuntimeFlags,
} = require('../api/services/recipeTechnicalRuntimeFlags.cjs');

const NOW = '2026-09-28T00:00:00.000Z';

function fixture(t, options = {}) {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
    runMigrations(db, { now: NOW }); t.after(() => db.close());
    const shellPartId = Number(db.prepare(`INSERT INTO parts(model, category, remark, created_at, updated_at) VALUES ('shell', '泵壳', ?, ?, ?)`)
        .run(JSON.stringify({ isStainless: false }), NOW, NOW).lastInsertRowid);
    const upperBearingPartId = Number(db.prepare(`INSERT INTO parts(model, category, supplier, created_at, updated_at) VALUES ('轴承-6202', '轴承', 'A', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    const lowerBearingPartId = Number(db.prepare(`INSERT INTO parts(model, category, supplier, created_at, updated_at) VALUES ('轴承-6303', '轴承', 'B', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    const templateId = Number(db.prepare(`INSERT INTO pump_shell_templates(shell_model, rotor_params_json, created_at, updated_at) VALUES ('shell', '{}', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO catalog_template_shell_bindings(template_id, shell_part_id, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run(templateId, shellPartId, NOW, NOW);
    const recipeId = Number(db.prepare(`INSERT INTO recipes(name, template_id, coil_sheets, technical_data_json, created_at, updated_at) VALUES ('selector', ?, 160, ?, ?, ?)`)
        .run(templateId, JSON.stringify({ pieceCount: 160, rotorDiameter: 99, stackOffset: 8, oilSealDiameter: 88, impellerBoreDiameter: 77, impellerSpan: 66, impellerDepth: 55, threadLength: 44, threadDiameter: 33, bearingSpan: 80, upperBearing: '6202', lowerBearing: '6303' }), NOW, NOW).lastInsertRowid);
    const canonical = createRecipeTechnicalProfileService({ db, now: () => new Date(NOW) });
    if (options.canonical !== false) canonical.update(recipeId, {
        functional: {
            rotorDiameter: options.incomplete ? null : 52, stackOffset: 1, oilSealDiameter: 20,
            impellerBoreDiameter: 12, impellerSpan: 24, impellerThickness: 3,
            threadLength: 14, threadDiameter: 8, barrelLength: null, openOffset: null,
            bearingSpanExplicit: 80, upperBearingPartId, lowerBearingPartId,
        }, technicalKnowledge: { items: [] }, expectedUpdatedAt: null,
    }, { actorKey: 'test:selector', idempotencyKey: `selector-create-${recipeId}`, operationId: `op-selector-${recipeId}` });
    const selector = enabled => createRecipeRotorRuntimeSelector({
        db, flags: () => ({ canonicalReadEnabled: enabled, legacyProjectionEnabled: false }),
    });
    return { db, recipeId, upperBearingPartId, lowerBearingPartId, selector };
}

test('Recipe technical runtime flags are explicitly disabled unless strict true is configured', () => {
    assert.deepEqual(recipeTechnicalRuntimeFlags({}), { canonicalReadEnabled: false, legacyProjectionEnabled: false });
    assert.deepEqual(recipeTechnicalRuntimeFlags({ [CANONICAL_READ_FLAG]: 'true', [LEGACY_PROJECTION_FLAG]: 'TRUE' }), { canonicalReadEnabled: true, legacyProjectionEnabled: true });
    assert.deepEqual(recipeTechnicalRuntimeFlags({ [CANONICAL_READ_FLAG]: '1', [LEGACY_PROJECTION_FLAG]: 'yes' }), { canonicalReadEnabled: false, legacyProjectionEnabled: false });
});

test('Rotor selector keeps byte-compatible legacy draft while canonical read flag is off', t => {
    const current = fixture(t);
    assert.deepEqual(current.selector(false).buildRecipeRotorDraft(current.recipeId), buildLegacyRecipeRotorDraft(current.db, current.recipeId));
});

test('eligible complete canonical profile drives Rotor whole-record output and legacy conflicts cannot override it', t => {
    const current = fixture(t);
    const draft = current.selector(true).buildRecipeRotorDraft(current.recipeId);
    assert.equal(draft.technicalRuntime.source, 'CANONICAL');
    assert.equal(draft.patch.rotor_dia, '52');
    assert.equal(draft.patch.stack_offset, '1');
    assert.equal(draft.technicalRuntime.upperBearingPartId, current.upperBearingPartId);
    current.db.prepare(`UPDATE recipes SET technical_data_json = ? WHERE id = ?`)
        .run('{"rotorDiameter":999,"threadLength":999}', current.recipeId);
    const afterLegacyConflict = current.selector(true).buildRecipeRotorDraft(current.recipeId);
    assert.equal(afterLegacyConflict.technicalRuntime.source, 'CANONICAL');
    assert.equal(afterLegacyConflict.patch.rotor_dia, '52');
    assert.equal(afterLegacyConflict.patch.thread_length, '14');
});

test('flag-on profile absence uses whole-record legacy compatibility, while incomplete canonical never hybrid-fills', t => {
    const absent = fixture(t, { canonical: false });
    const legacy = absent.selector(true).buildRecipeRotorDraft(absent.recipeId);
    assert.equal(legacy.technicalRuntime.source, 'LEGACY_COMPATIBILITY');
    assert.equal(legacy.patch.rotor_dia, '99');
    const incomplete = fixture(t, { incomplete: true });
    const blocked = incomplete.selector(true).buildRecipeRotorDraft(incomplete.recipeId);
    assert.equal(blocked.technicalRuntime.source, 'CANONICAL_NOT_READY');
    assert.deepEqual(blocked.patch, {});
});

test('migrated canonical source drift is never selected for Rotor runtime', t => {
    const current = fixture(t);
    current.db.prepare(`UPDATE recipe_functional_technical_profiles SET migration_state = 'AUTO_MIGRATED', migration_version = 'recipe-technical-migration-v1', migration_fingerprint = ? WHERE recipe_id = ?`)
        .run('a'.repeat(64), current.recipeId);
    const draft = current.selector(true).buildRecipeRotorDraft(current.recipeId);
    assert.equal(draft.technicalRuntime.source, 'CANONICAL_NOT_READY');
    assert.match(draft.technicalRuntime.reason, /MIGRATION_SOURCE_CHANGED|MIGRATION_/);
});
