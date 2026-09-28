const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const { createRecipeTechnicalProfileService } = require('../api/services/recipeTechnicalProfile.cjs');
const { createRecipeTechnicalRotorAdapter } = require('../api/services/recipeTechnicalRotorAdapter.cjs');
const { createRecipeTechnicalRotorShadowService } = require('../api/services/recipeTechnicalRotorShadow.cjs');

const NOW = '2026-09-28T00:00:00.000Z';

function functional(upperBearingPartId, lowerBearingPartId, stainless, overrides = {}) {
    return {
        rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20,
        impellerBoreDiameter: 12, impellerSpan: 24, impellerThickness: 3,
        threadLength: 14, threadDiameter: 8,
        barrelLength: stainless ? 120 : null,
        openOffset: stainless ? 20 : null,
        bearingSpanExplicit: stainless ? null : 80,
        upperBearingPartId, lowerBearingPartId,
        ...overrides,
    };
}

function fixture(t, options = {}) {
    const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db, { now: NOW }); t.after(() => db.close());
    const stainless = Boolean(options.stainless);
    const upperCode = options.upperCode || '6202';
    const shellRemark = JSON.stringify({ isStainless: stainless, ...(options.legacyShellOffset === undefined ? { openOffset: 20 } : { openOffset: options.legacyShellOffset }) });
    const shellPartId = Number(db.prepare(`INSERT INTO parts(model, category, remark, created_at, updated_at) VALUES ('shell', '泵壳', ?, ?, ?)`)
        .run(shellRemark, NOW, NOW).lastInsertRowid);
    const upperBearingPartId = Number(db.prepare(`INSERT INTO parts(model, category, supplier, created_at, updated_at) VALUES (?, '轴承', 'A', ?, ?)`)
        .run(`轴承-${upperCode}`, NOW, NOW).lastInsertRowid);
    const lowerBearingPartId = Number(db.prepare(`INSERT INTO parts(model, category, supplier, created_at, updated_at) VALUES ('轴承-6303', '轴承', 'A', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    const templateId = Number(db.prepare(`INSERT INTO pump_shell_templates(shell_model, rotor_params_json, created_at, updated_at) VALUES ('shell', ?, ?, ?)`)
        .run(JSON.stringify(options.templateRotorParams || {}), NOW, NOW).lastInsertRowid);
    db.prepare(`INSERT INTO catalog_template_shell_bindings(template_id, shell_part_id, created_at, updated_at) VALUES (?, ?, ?, ?)`)
        .run(templateId, shellPartId, NOW, NOW);
    const technical = {
        pieceCount: 160, rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20,
        impellerBoreDiameter: 12, impellerSpan: 24, impellerDepth: 3,
        threadLength: 14, threadDiameter: 8, upperBearing: upperCode,
        lowerBearing: '6303', bearingSpan: stainless ? 100 : 80,
        ...(options.legacyTechnical || {}),
    };
    const recipeId = Number(db.prepare(`INSERT INTO recipes(name, template_id, coil_sheets, custom_barrel_length, technical_data_json, created_at, updated_at) VALUES ('r', ?, 160, ?, ?, ?, ?)`)
        .run(templateId, stainless ? 120 : null, JSON.stringify(technical), NOW, NOW).lastInsertRowid);
    const canonical = createRecipeTechnicalProfileService({ db, now: () => new Date(NOW) });
    if (options.canonical !== false) {
        canonical.update(recipeId, {
            functional: functional(upperBearingPartId, lowerBearingPartId, stainless, options.functional || {}),
            technicalKnowledge: { items: options.knowledgeItems || [] }, expectedUpdatedAt: null,
        }, { actorKey: 'test:rotor-shadow', idempotencyKey: `rotor-shadow-${recipeId}-create`, operationId: `op:rotor-shadow-${recipeId}` });
    }
    const adapter = createRecipeTechnicalRotorAdapter({ db, canonicalProfileService: canonical });
    const shadow = createRecipeTechnicalRotorShadowService({ db, canonicalAdapter: adapter });
    return { db, recipeId, shellPartId, upperBearingPartId, lowerBearingPartId, canonical, adapter, shadow };
}

function writeCounts(db) {
    return Object.fromEntries(['recipes', 'parts', 'recipe_functional_technical_profiles', 'recipe_technical_knowledge', 'audit_log', 'business_change_events', 'api_operations', 'knowledge_entries']
        .map(table => [table, Number(db.prepare(`SELECT count(*) count FROM ${table}`).get().count)]));
}

test('canonical non-stainless Rotor input matches normalized legacy compatibility output', t => {
    const current = fixture(t); const before = writeCounts(current.db); const report = current.shadow.inspect(current.recipeId);
    assert.equal(report.canonical.mode, 'CANONICAL'); assert.equal(report.canonical.functional.pieceCount, 160);
    assert.equal(report.canonical.provenance.pieceCount.sourceKind, 'DERIVED_COPY_RECIPES_COIL_SHEETS');
    assert.equal(report.canonical.functional.bearingSpan, 80); assert.equal(report.comparison.overall, 'PARITY');
    for (const field of ['piece_count', 'rotor_dia', 'bearing_span', 'stack_offset', 'oil_seal_dia', 'impeller_dia', 'impeller_span', 'impeller_depth', 'thread_length', 'thread_dia', 'upper_bearing', 'lower_bearing']) assert.equal(report.comparison.fields[field].status, 'MATCH', field);
    assert.deepEqual(writeCounts(current.db), before);
});

test('canonical stainless span derives only from Recipe barrelLength and openOffset', t => {
    const current = fixture(t, { stainless: true, legacyShellOffset: 10, legacyTechnical: { bearingSpan: undefined } }); const report = current.shadow.inspect(current.recipeId);
    assert.equal(report.canonical.functional.bearingSpan, 100);
    assert.equal(report.canonical.provenance.bearingSpan.sourceKind, 'DERIVED_CANONICAL_BARREL_LENGTH_MINUS_OPEN_OFFSET');
    assert.equal(report.legacy.patch.bearing_span, '110');
    assert.equal(report.comparison.fields.bearing_span.status, 'EXPECTED_SEMANTIC_CHANGE');
    assert.equal(report.comparison.overall, 'EXPECTED_DIFFERENCE');
});

test('legacy Template/PumpShell fallback is an expected difference rather than canonical authority', t => {
    const current = fixture(t, { functional: { threadDiameter: null }, legacyTechnical: { threadDiameter: undefined }, templateRotorParams: { thread_dia: 8 } });
    const report = current.shadow.inspect(current.recipeId);
    assert.equal(report.canonical.functional.threadDiameter, null);
    assert.equal(report.legacy.patch.thread_dia, '8');
    assert.equal(report.comparison.fields.thread_dia.status, 'EXPECTED_SEMANTIC_CHANGE');
    assert.ok(report.canonical.unresolved.includes('THREADDIAMETER_UNRESOLVED'));
});

test('concrete canonical and legacy values that differ remain a visible conflict', t => {
    const current = fixture(t, { legacyTechnical: { rotorDiameter: 53 } }); const report = current.shadow.inspect(current.recipeId);
    assert.equal(report.canonical.rotorPatch.rotor_dia, '52'); assert.equal(report.legacy.patch.rotor_dia, '53');
    assert.equal(report.comparison.fields.rotor_dia.status, 'CONFLICT'); assert.equal(report.comparison.overall, 'ATTENTION_REQUIRED');
});

test('incomplete canonical fields never fill from legacy technical JSON', t => {
    const current = fixture(t, { functional: { rotorDiameter: null } }); const report = current.shadow.inspect(current.recipeId);
    assert.equal(report.canonical.mode, 'CANONICAL'); assert.equal(report.canonical.functional.rotorDiameter, null);
    assert.equal(report.canonical.rotorPatch.rotor_dia, undefined); assert.equal(report.legacy.patch.rotor_dia, '52');
    assert.equal(report.comparison.fields.rotor_dia.status, 'UNRESOLVED');
});

test('exact canonical bearing Part identity is retained even when its geometry is unavailable', t => {
    const current = fixture(t, { upperCode: '9999' });
    const duplicate = Number(current.db.prepare(`INSERT INTO parts(model, category, supplier, created_at, updated_at) VALUES ('轴承-9999', '轴承', 'B', ?, ?)`)
        .run(NOW, NOW).lastInsertRowid);
    const report = current.shadow.inspect(current.recipeId);
    assert.notEqual(duplicate, current.upperBearingPartId);
    assert.equal(report.canonical.relations.upperBearingPartId, current.upperBearingPartId);
    assert.equal(report.canonical.bearingGeometry.upper.partId, current.upperBearingPartId);
    assert.equal(report.canonical.bearingGeometry.upper.geometryAvailable, false);
    assert.equal(report.canonical.rotorPatch.upper_bearing, undefined);
    assert.equal(report.comparison.overall, 'INCOMPLETE');
});

test('profile absence reports legacy compatibility requirement while shadow remains available', t => {
    const current = fixture(t, { canonical: false }); const before = writeCounts(current.db); const report = current.shadow.inspect(current.recipeId);
    assert.equal(report.canonical.mode, 'LEGACY_COMPATIBILITY_REQUIRED'); assert.equal(report.legacy.mode, 'LEGACY_COMPATIBILITY');
    assert.equal(report.legacy.patch.rotor_dia, '52'); assert.deepEqual(writeCounts(current.db), before);
});

test('review-state canonical storage is unsafe and never receives a legacy field fallback', t => {
    const current = fixture(t);
    current.db.prepare(`UPDATE recipe_functional_technical_profiles SET migration_state = 'NEEDS_OWNER_REVIEW' WHERE recipe_id = ?`).run(current.recipeId);
    const report = current.shadow.inspect(current.recipeId);
    assert.equal(report.canonical.mode, 'CANONICAL_UNSAFE');
    assert.equal(report.canonical.functional, null);
    assert.equal(report.canonical.rotorPatch.rotor_dia, undefined);
    assert.equal(report.legacy.patch.rotor_dia, '52');
    assert.equal(report.comparison.overall, 'INCOMPLETE');
});

test('Technical Knowledge does not affect canonical Rotor functional input', t => {
    const current = fixture(t, { knowledgeItems: [{ key: 'rotorDiameter', label: '旧资料', value: 999 }] });
    const report = current.shadow.inspect(current.recipeId);
    assert.equal(report.canonical.functional.rotorDiameter, 52); assert.equal(report.canonical.rotorPatch.rotor_dia, '52');
});
