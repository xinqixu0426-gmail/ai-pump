const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
    inspectLegacyTechnicalMutation,
    sameLegacyValue,
} = require('../api/services/recipeTechnicalLegacyWriteGuard.cjs');

function fixture(t) {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE recipe_functional_technical_profiles (recipe_id INTEGER PRIMARY KEY);
        CREATE TABLE recipe_technical_knowledge (recipe_id INTEGER PRIMARY KEY);
    `);
    t.after(() => db.close());
    return db;
}

function payload(overrides = {}) {
    return {
        technical_data_json: '{"rotorDiameter":52,"nested":{"a":1,"b":2}}',
        custom_barrel_length: 120,
        impeller_thickness: 3,
        impeller_model: 'IM-1',
        impeller_diameter: 80,
        impeller_blade_count: 6,
        ...overrides,
    };
}

test('legacy technical guard permits freeze-off and canonical-absent compatibility writes', t => {
    const db = fixture(t);
    const current = payload();
    assert.equal(inspectLegacyTechnicalMutation({
        db, recipeId: 7, currentRecipe: current,
        normalizedRecipePayload: payload({ technical_data_json: '{"rotorDiameter":61}' }),
        freezeEnabled: false,
    }).allowed, true);
    assert.equal(inspectLegacyTechnicalMutation({
        db, recipeId: 7, currentRecipe: current,
        normalizedRecipePayload: payload({ technical_data_json: '{"rotorDiameter":61}' }),
        freezeEnabled: true,
    }).allowed, true);
});

test('legacy technical guard freezes either partial canonical child and compares technical JSON semantically', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipe_technical_knowledge (recipe_id) VALUES (7)').run();
    const current = payload();
    const reordered = payload({
        technical_data_json: '{  "nested" : { "b":2, "a":1 }, "rotorDiameter" : 52 }',
    });
    const unchanged = inspectLegacyTechnicalMutation({
        db, recipeId: 7, currentRecipe: current, normalizedRecipePayload: reordered, freezeEnabled: true,
    });
    assert.equal(unchanged.canonicalOwned, true);
    assert.equal(unchanged.technicalKnowledgePresent, true);
    assert.deepEqual(unchanged.changedProtectedFields, []);
    assert.equal(unchanged.allowed, true);

    const changed = inspectLegacyTechnicalMutation({
        db, recipeId: 7, currentRecipe: current,
        normalizedRecipePayload: payload({ impeller_model: 'IM-2' }), freezeEnabled: true,
    });
    assert.equal(changed.allowed, false);
    assert.deepEqual(changed.changedProtectedFields, ['impeller_model']);
});

test('legacy technical guard fails closed when canonical-owned malformed JSON would be replaced', t => {
    const db = fixture(t);
    db.prepare('INSERT INTO recipe_functional_technical_profiles (recipe_id) VALUES (7)').run();
    const current = payload({ technical_data_json: '{malformed' });
    assert.equal(sameLegacyValue('technical_data_json', current.technical_data_json, payload().technical_data_json), false);
    const result = inspectLegacyTechnicalMutation({
        db, recipeId: 7, currentRecipe: current, normalizedRecipePayload: payload(), freezeEnabled: true,
    });
    assert.equal(result.allowed, false);
    assert.deepEqual(result.changedProtectedFields, ['technical_data_json']);
});
