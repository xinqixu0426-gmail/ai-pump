const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runMigrations } = require('../api/database/migrations.cjs');
const {
    GET_CAPABILITY_ID,
    UPDATE_CAPABILITY_ID,
    createRecipeTechnicalProfileService,
} = require('../api/services/recipeTechnicalProfile.cjs');
const {
    getBusinessCapability,
    listAiCapabilities,
    writeCapabilityNames,
} = require('../api/capabilities/registry.cjs');

const NOW = '2026-09-28T00:00:00.000Z';

function fixture(t, isStainless = true) {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db, { now: NOW });
    t.after(() => db.close());
    const shellPartId = Number(db.prepare(`
        INSERT INTO parts (model, category, remark, created_at, updated_at)
        VALUES ('fixture-shell', '泵壳', ?, ?, ?)
    `).run(JSON.stringify({ isStainless }), NOW, NOW).lastInsertRowid);
    const bearingPartId = Number(db.prepare(`
        INSERT INTO parts (model, category, supplier, created_at, updated_at)
        VALUES ('轴承-6202', '轴承', 'fixture supplier', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    const ordinaryPartId = Number(db.prepare(`
        INSERT INTO parts (model, category, created_at, updated_at)
        VALUES ('ordinary', '其他', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    const templateId = Number(db.prepare(`
        INSERT INTO pump_shell_templates (shell_model, created_at, updated_at)
        VALUES ('fixture-template', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);
    db.prepare(`
        INSERT INTO catalog_template_shell_bindings (template_id, shell_part_id, created_at, updated_at)
        VALUES (?, ?, ?, ?)
    `).run(templateId, shellPartId, NOW, NOW);
    const recipeId = Number(db.prepare(`
        INSERT INTO recipes (name, template_id, technical_data_json, custom_barrel_length, impeller_thickness, created_at, updated_at)
        VALUES ('fixture-recipe', ?, '{"rotorDiameter":999,"upperBearing":"6202"}', 88, 3.2, ?, ?)
    `).run(templateId, NOW, NOW).lastInsertRowid);
    return {
        db, recipeId, shellPartId, bearingPartId, ordinaryPartId, templateId,
        service: createRecipeTechnicalProfileService({ db, now: () => new Date(NOW) }),
    };
}

function context(key = 'technical-profile:test-001') {
    return {
        actorKey: 'test:owner', idempotencyKey: key, operationId: `op:${key}`,
        requestId: `req:${key}`, warnings: [],
    };
}

function functional(bearingPartId, overrides = {}) {
    return {
        rotorDiameter: 52, stackOffset: 1, oilSealDiameter: 20,
        impellerBoreDiameter: 12, impellerSpan: 24, impellerThickness: 3,
        threadLength: 14, threadDiameter: 8, barrelLength: 120,
        openOffset: 20, bearingSpanExplicit: null,
        upperBearingPartId: bearingPartId, lowerBearingPartId: bearingPartId,
        ...overrides,
    };
}

function input(bearingPartId, overrides = {}) {
    return {
        functional: functional(bearingPartId, overrides.functional),
        technicalKnowledge: { items: [{ key: 'power', label: '功率', value: '750W', unit: 'W' }] },
        expectedUpdatedAt: null,
        ...overrides,
    };
}

test('canonical query is read-only, absent-safe, and never reconstructs legacy Recipe technical data', t => {
    const { db, recipeId, service } = fixture(t);
    const before = db.prepare('SELECT technical_data_json, custom_barrel_length, impeller_thickness FROM recipes WHERE id = ?').get(recipeId);
    const result = service.get(recipeId);
    assert.equal(GET_CAPABILITY_ID, 'recipes.technical_profile.get');
    assert.equal(result.canonicalPresent, false);
    assert.equal(result.functional, null);
    assert.equal(result.technicalKnowledge, null);
    assert.equal(result.policy.stainlessMode, 'STAINLESS');
    assert.deepEqual(db.prepare('SELECT technical_data_json, custom_barrel_length, impeller_thickness FROM recipes WHERE id = ?').get(recipeId), before);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_functional_technical_profiles').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_technical_knowledge').get().count, 0);
});

test('canonical query reports future partial child state without legacy fallback or repair writes', t => {
    const { db, recipeId, service } = fixture(t);
    db.prepare(`
        INSERT INTO recipe_technical_knowledge (recipe_id, schema_version, items_json, created_at, updated_at)
        VALUES (?, 1, '[]', ?, ?)
    `).run(recipeId, NOW, NOW);
    const partial = service.get(recipeId);
    assert.equal(partial.canonicalPresent, true);
    assert.equal(partial.functional, null);
    assert.deepEqual(partial.technicalKnowledge.items, []);
    assert.ok(partial.completeness.reasons.includes('CANONICAL_FUNCTIONAL_PROFILE_ABSENT'));
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_functional_technical_profiles').get().count, 0);
});

test('first canonical aggregate PUT writes only new tables, audits each child, emits one Recipe business change, and supports idempotent replay', t => {
    const { db, recipeId, bearingPartId, service } = fixture(t);
    const legacy = db.prepare('SELECT technical_data_json, custom_barrel_length, impeller_thickness FROM recipes WHERE id = ?').get(recipeId);
    const first = service.update(recipeId, input(bearingPartId), context());
    const replay = service.update(recipeId, input(bearingPartId), context());
    assert.equal(UPDATE_CAPABILITY_ID, 'recipes.technical_profile.update');
    assert.equal(first.status, 'completed');
    assert.equal(first.technicalProfile.functional.bearingSpan, 100);
    assert.equal(first.technicalProfile.functional.bearingSpanSource, 'DERIVED');
    assert.equal(first.technicalProfile.completeness.state, 'COMPLETE');
    assert.equal(first.auditIds.length, 2);
    assert.equal(first.businessChangeEvent.primaryDomain, 'recipe');
    assert.equal(replay.idempotentReplay, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_functional_technical_profiles').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_technical_knowledge').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_log WHERE record_id = ?').get(recipeId).count, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_change_events').get().count, 1);
    assert.deepEqual(db.prepare('SELECT technical_data_json, custom_barrel_length, impeller_thickness FROM recipes WHERE id = ?').get(recipeId), legacy);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries').get().count, 0);
});

test('canonical update is strict about aggregate concurrency and no-op writes preserve the version and business audit state', t => {
    const { db, recipeId, bearingPartId, service } = fixture(t);
    const first = service.update(recipeId, input(bearingPartId), context('technical-profile:test-002'));
    const current = first.technicalProfile.updatedAt;
    assert.throws(() => service.update(recipeId, input(bearingPartId), context('technical-profile:test-003')), error => error.code === 'technical_profile_version_required');
    assert.throws(() => service.update(recipeId, input(bearingPartId, { expectedUpdatedAt: '2020-01-01T00:00:00.000Z' }), context('technical-profile:test-004')), error => error.code === 'technical_profile_version_conflict');
    const noOp = service.update(recipeId, input(bearingPartId, { expectedUpdatedAt: current }), context('technical-profile:test-005'));
    assert.equal(noOp.technicalProfile.updatedAt, current);
    assert.deepEqual(noOp.auditIds, []);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_change_events').get().count, 1);
    assert.throws(() => service.update(recipeId, input(bearingPartId, { expectedUpdatedAt: current, functional: { ...functional(bearingPartId), rotorDiameter: 60 } }), context('technical-profile:test-002')), error => error.code === 'idempotency_key_conflict');
});

test('formal stainless resolver is strict: false is non-stainless and missing metadata is unresolved, never coerced false', t => {
    const nonStainless = fixture(t, false);
    const nonInput = input(nonStainless.bearingPartId, { functional: functional(nonStainless.bearingPartId, { barrelLength: null, openOffset: null, bearingSpanExplicit: 81 }) });
    const nonResult = nonStainless.service.update(nonStainless.recipeId, nonInput, context('technical-profile:test-006'));
    assert.equal(nonResult.technicalProfile.policy.stainlessMode, 'NON_STAINLESS');
    assert.equal(nonResult.technicalProfile.functional.bearingSpan, 81);
    assert.equal(nonResult.technicalProfile.functional.bearingSpanSource, 'EXPLICIT');

    const unresolved = fixture(t, true);
    unresolved.db.prepare('UPDATE parts SET remark = ? WHERE id = ?').run('{}', unresolved.shellPartId);
    const absent = unresolved.service.get(unresolved.recipeId);
    assert.equal(absent.policy.stainlessMode, 'UNKNOWN_OR_UNRESOLVED');
    assert.equal(absent.policy.isStainless, null);
    assert.throws(() => unresolved.service.update(unresolved.recipeId, input(unresolved.bearingPartId), context('technical-profile:test-007')), error => error.code === 'technical_profile_policy_unresolved_field');
});

test('conditional mode and bearing binding are fail-closed while a selected bearing identity survives missing geometry as incomplete', t => {
    const { db, recipeId, bearingPartId, ordinaryPartId, service } = fixture(t);
    assert.throws(() => service.update(recipeId, input(bearingPartId, { functional: functional(bearingPartId, { bearingSpanExplicit: 1 }) }), context('technical-profile:test-008')), error => error.code === 'technical_profile_policy_unresolved_field');
    assert.throws(() => service.update(recipeId, input(ordinaryPartId), context('technical-profile:test-009')), error => error.code === 'technical_profile_bearing_invalid');
    db.prepare('UPDATE parts SET model = ? WHERE id = ?').run('轴承-unmapped', bearingPartId);
    const result = service.update(recipeId, input(bearingPartId), context('technical-profile:test-010'));
    assert.equal(result.technicalProfile.functional.upperBearingPartId, bearingPartId);
    assert.equal(result.technicalProfile.bearingReferences.upper.geometryAvailable, false);
    assert.equal(result.technicalProfile.completeness.state, 'INCOMPLETE');
    assert.ok(result.technicalProfile.completeness.reasons.includes('UPPER_BEARING_GEOMETRY_UNRESOLVED'));
});

test('technical knowledge keeps arbitrary keys generic and rejects duplicate, malformed, or functional-control metadata', t => {
    const { db, recipeId, bearingPartId, service } = fixture(t);
    const arbitrary = input(bearingPartId, { technicalKnowledge: { items: [
        { key: 'future_new_field', label: '未来字段', value: { nested: [1, true] } },
        { key: 'customerSpecialNote', label: '客户备注', value: 'ok' },
    ] } });
    const result = service.update(recipeId, arbitrary, context('technical-profile:test-011'));
    assert.equal(result.technicalProfile.technicalKnowledge.items[0].key, 'future_new_field');
    assert.throws(() => service.update(recipeId, input(bearingPartId, { expectedUpdatedAt: result.technicalProfile.updatedAt, technicalKnowledge: { items: [{ key: 'x', label: 'x', value: 1, policyInput: true }] } }), context('technical-profile:test-012')), error => error.code === 'technical_profile_knowledge_invalid');
    assert.throws(() => service.update(recipeId, input(bearingPartId, { expectedUpdatedAt: result.technicalProfile.updatedAt, technicalKnowledge: { items: [{ key: 'x', label: 'x', value: 1 }, { key: 'x', label: 'again', value: 2 }] } }), context('technical-profile:test-013')), error => error.code === 'technical_profile_knowledge_invalid');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM knowledge_entries').get().count, 0);
});

test('an audit failure rolls back both canonical rows, operation receipt, and event', t => {
    const { db, recipeId, bearingPartId } = fixture(t);
    const service = createRecipeTechnicalProfileService({
        db, now: () => new Date(NOW),
        writeAuditLog() { throw new Error('audit failure'); },
    });
    assert.throws(() => service.update(recipeId, input(bearingPartId), context('technical-profile:test-014')), /audit failure/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_functional_technical_profiles').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_technical_knowledge').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM business_change_events').get().count, 0);
});

test('a business-change failure rolls back both canonical rows, audits, and operation receipt', t => {
    const { db, recipeId, bearingPartId, service } = fixture(t);
    db.exec(`
        CREATE TRIGGER fail_recipe_technical_business_change
        BEFORE INSERT ON business_change_events
        BEGIN SELECT RAISE(ABORT, 'event failure'); END;
    `);
    assert.throws(() => service.update(recipeId, input(bearingPartId), context('technical-profile:test-015')), /event failure/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_functional_technical_profiles').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_technical_knowledge').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM api_operations').get().count, 0);
});

test('Business capabilities are registered without creating an AI or Native write exposure', () => {
    assert.equal(getBusinessCapability(GET_CAPABILITY_ID).access, 'query');
    assert.equal(getBusinessCapability(UPDATE_CAPABILITY_ID).access, 'write');
    assert.equal(JSON.stringify(listAiCapabilities()).includes(GET_CAPABILITY_ID), false);
    assert.equal(JSON.stringify(listAiCapabilities()).includes(UPDATE_CAPABILITY_ID), false);
    assert.equal(writeCapabilityNames().includes('recipes.technical_profile.update'), false);
});
