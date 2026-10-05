const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
    APPLICATION_TABLES,
    CANONICAL_TABLES_SQL,
    RECIPE_TECHNICAL_PROFILE_SCHEMA_SQL,
} = require('../api/database/schema.cjs');
const {
    MIGRATIONS,
    MIGRATION_TABLE_SQL,
    migrationChecksum,
    runMigrations,
} = require('../api/database/migrations.cjs');

const NOW = '2026-09-28T00:00:00.000Z';
const PROFILE_COLUMNS = [
    'recipe_id', 'rotor_diameter', 'stack_offset', 'oil_seal_diameter',
    'impeller_bore_diameter', 'impeller_span', 'impeller_thickness',
    'thread_length', 'thread_diameter', 'barrel_length', 'open_offset',
    'bearing_span_explicit', 'upper_bearing_part_id', 'lower_bearing_part_id',
    'schema_version', 'completeness_state', 'migration_state', 'migration_version',
    'migration_fingerprint', 'provenance_json', 'legacy_evidence_json',
    'created_at', 'updated_at',
];
const KNOWLEDGE_COLUMNS = ['recipe_id', 'schema_version', 'items_json', 'created_at', 'updated_at'];

function openMemoryDatabase() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    return db;
}

function createPre89Fixture(t) {
    const db = openMemoryDatabase();
    t.after(() => db.close());
    db.exec(CANONICAL_TABLES_SQL);
    db.exec(MIGRATION_TABLE_SQL);
    const insertMigration = db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
    `);
    for (const migration of MIGRATIONS.filter(item => item.version <= 88)) {
        insertMigration.run(migration.version, migration.name, migrationChecksum(migration), NOW);
    }
    db.pragma('user_version = 88');
    db.prepare(`
        INSERT INTO parts (model, category, supplier, price, stock, created_at, updated_at)
        VALUES ('legacy-part', '其他', 'fixture', 12.5, 3, ?, ?)
    `).run(NOW, NOW);
    db.prepare(`
        INSERT INTO recipes (name, spec, technical_data_json, created_at, updated_at)
        VALUES ('legacy-recipe', 'legacy-spec', '{"rotorDiameter":52}', ?, ?)
    `).run(NOW, NOW);
    return db;
}

function createRecipe(db, name = 'recipe') {
    return Number(db.prepare(`
        INSERT INTO recipes (name, created_at, updated_at) VALUES (?, ?, ?)
    `).run(name, NOW, NOW).lastInsertRowid);
}

function profileValues(recipeId, overrides = {}) {
    return {
        recipe_id: recipeId,
        rotor_diameter: null,
        stack_offset: null,
        oil_seal_diameter: null,
        impeller_bore_diameter: null,
        impeller_span: null,
        impeller_thickness: null,
        thread_length: null,
        thread_diameter: null,
        barrel_length: null,
        open_offset: null,
        bearing_span_explicit: null,
        upper_bearing_part_id: null,
        lower_bearing_part_id: null,
        schema_version: 1,
        completeness_state: 'INCOMPLETE',
        migration_state: 'ALREADY_CANONICAL',
        migration_version: null,
        migration_fingerprint: null,
        provenance_json: '{}',
        legacy_evidence_json: '{}',
        created_at: NOW,
        updated_at: NOW,
        ...overrides,
    };
}

const PROFILE_INSERT_SQL = `
    INSERT INTO recipe_functional_technical_profiles (${PROFILE_COLUMNS.join(', ')})
    VALUES (${PROFILE_COLUMNS.map(column => `@${column}`).join(', ')})
`;

function insertProfile(db, recipeId, overrides = {}) {
    return db.prepare(PROFILE_INSERT_SQL).run(profileValues(recipeId, overrides));
}

function insertKnowledge(db, recipeId, overrides = {}) {
    return db.prepare(`
        INSERT INTO recipe_technical_knowledge (
            recipe_id, schema_version, items_json, created_at, updated_at
        ) VALUES (@recipe_id, @schema_version, @items_json, @created_at, @updated_at)
    `).run({
        recipe_id: recipeId,
        schema_version: 1,
        items_json: '[]',
        created_at: NOW,
        updated_at: NOW,
        ...overrides,
    });
}

test('schema preserves migrations 89 and 90 and appends the independent V2 findings table at migration 91', () => {
    const migration = MIGRATIONS.at(-1);
    assert.equal(migration.version, 91);
    assert.equal(migration.name, 'ai_v2_findings_snapshots');
    assert.equal(MIGRATIONS.at(-2).version, 90);
    assert.ok(APPLICATION_TABLES.includes('recipe_functional_technical_profiles'));
    assert.ok(APPLICATION_TABLES.includes('recipe_technical_knowledge'));
    assert.doesNotMatch(RECIPE_TECHNICAL_PROFILE_SCHEMA_SQL, /\b(?:ALTER|INSERT|UPDATE|DELETE)\b/i);
});

test('migrations 89 through 91 preserve existing Recipe rows and are idempotent', t => {
    const db = createPre89Fixture(t);
    const recipesBefore = db.prepare('SELECT * FROM recipes ORDER BY id').all();
    const first = runMigrations(db, { now: NOW });

    assert.deepEqual(first.appliedVersions, [89, 90, 91]);
    assert.equal(first.currentVersion, 91);
    assert.equal(db.pragma('user_version', { simple: true }), 91);
    assert.deepEqual(db.prepare('SELECT * FROM recipes ORDER BY id').all(), recipesBefore);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_functional_technical_profiles').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_technical_knowledge').get().count, 0);
    assert.deepEqual(runMigrations(db, { now: NOW }).appliedVersions, []);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_functional_technical_profiles').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM recipe_technical_knowledge').get().count, 0);
});

test('a fresh database reaches version 91 while retaining the canonical technical table shape', t => {
    const db = openMemoryDatabase();
    t.after(() => db.close());
    const result = runMigrations(db, { now: NOW });

    assert.equal(result.currentVersion, 91);
    assert.equal(db.pragma('user_version', { simple: true }), 91);
    assert.deepEqual(
        db.pragma('table_info(recipe_functional_technical_profiles)').map(column => column.name),
        PROFILE_COLUMNS
    );
    assert.deepEqual(
        db.pragma('table_info(recipe_technical_knowledge)').map(column => column.name),
        KNOWLEDGE_COLUMNS
    );
    assert.equal(
        db.pragma('table_info(recipe_functional_technical_profiles)')
            .find(column => column.name === 'recipe_id').pk,
        1
    );
    assert.equal(
        db.pragma('table_info(recipe_technical_knowledge)')
            .find(column => column.name === 'recipe_id').pk,
        1
    );

    const profileFks = db.pragma('foreign_key_list(recipe_functional_technical_profiles)');
    assert.deepEqual(
        profileFks.map(fk => [fk.from, fk.table, fk.to, fk.on_delete]).sort(),
        [
            ['lower_bearing_part_id', 'parts', 'id', 'NO ACTION'],
            ['recipe_id', 'recipes', 'id', 'NO ACTION'],
            ['upper_bearing_part_id', 'parts', 'id', 'NO ACTION'],
        ]
    );
    assert.deepEqual(
        db.pragma('foreign_key_list(recipe_technical_knowledge)').map(fk => [fk.from, fk.table, fk.to, fk.on_delete]),
        [['recipe_id', 'recipes', 'id', 'NO ACTION']]
    );
    const indexNames = db.pragma('index_list(recipe_functional_technical_profiles)').map(index => index.name);
    assert.ok(indexNames.includes('idx_recipe_functional_profile_migration'));
    assert.ok(indexNames.includes('idx_recipe_functional_profile_upper_bearing'));
    assert.ok(indexNames.includes('idx_recipe_functional_profile_lower_bearing'));
    assert.equal(
        db.prepare(`
            SELECT COUNT(*) AS count FROM sqlite_schema
            WHERE type = 'trigger'
              AND tbl_name IN ('recipe_functional_technical_profiles', 'recipe_technical_knowledge')
        `).get().count,
        0
    );
    assert.ok(!PROFILE_COLUMNS.includes('bearing_span'));
    assert.ok(!PROFILE_COLUMNS.includes('stainless_bearing_span'));
    assert.ok(!PROFILE_COLUMNS.includes('derived_bearing_span'));
});

test('profile and knowledge constraints reject invalid identity, state, JSON, and dimension data while allowing nullable technical inputs', t => {
    const db = openMemoryDatabase();
    t.after(() => db.close());
    runMigrations(db, { now: NOW });
    const partId = Number(db.prepare(`
        INSERT INTO parts (model, category, created_at, updated_at) VALUES ('ordinary-part', '其他', ?, ?)
    `).run(NOW, NOW).lastInsertRowid);

    assert.throws(() => insertProfile(db, 999), /FOREIGN KEY/);
    assert.throws(() => insertKnowledge(db, 999), /FOREIGN KEY/);
    const recipeId = createRecipe(db, 'valid-nullable');
    insertProfile(db, recipeId);
    insertKnowledge(db, recipeId);
    assert.equal(db.prepare(`
        SELECT rotor_diameter FROM recipe_functional_technical_profiles WHERE recipe_id = ?
    `).get(recipeId).rotor_diameter, null);
    assert.throws(() => insertProfile(db, recipeId), /UNIQUE/);
    assert.throws(() => insertKnowledge(db, recipeId), /UNIQUE/);

    const invalidProfile = (overrides) => insertProfile(db, createRecipe(db), overrides);
    assert.throws(() => invalidProfile({ schema_version: 0 }), /CHECK/);
    assert.throws(() => invalidProfile({ completeness_state: 'DONE' }), /CHECK/);
    assert.throws(() => invalidProfile({ migration_state: 'DONE' }), /CHECK/);
    assert.throws(() => invalidProfile({ rotor_diameter: -1 }), /CHECK/);
    assert.throws(() => invalidProfile({ stack_offset: -1 }), /CHECK/);
    assert.throws(() => invalidProfile({ provenance_json: 'not-json' }), /CHECK/);
    assert.throws(() => invalidProfile({ provenance_json: '[]' }), /CHECK/);
    assert.throws(() => invalidProfile({ legacy_evidence_json: 'not-json' }), /CHECK/);
    assert.throws(() => invalidProfile({ legacy_evidence_json: '[]' }), /CHECK/);

    const invalidKnowledge = (overrides) => insertKnowledge(db, createRecipe(db), overrides);
    assert.throws(() => invalidKnowledge({ schema_version: 0 }), /CHECK/);
    assert.throws(() => invalidKnowledge({ items_json: 'not-json' }), /CHECK/);
    assert.throws(() => invalidKnowledge({ items_json: '{}' }), /CHECK/);

    const bearingRecipeId = createRecipe(db, 'bearing-fk');
    assert.throws(() => insertProfile(db, bearingRecipeId, { upper_bearing_part_id: 999 }), /FOREIGN KEY/);
    assert.throws(() => insertProfile(db, bearingRecipeId, { lower_bearing_part_id: 999 }), /FOREIGN KEY/);
    insertProfile(db, bearingRecipeId, { upper_bearing_part_id: partId });
    assert.equal(
        db.prepare(`
            SELECT upper_bearing_part_id FROM recipe_functional_technical_profiles WHERE recipe_id = ?
        `).get(bearingRecipeId).upper_bearing_part_id,
        partId
    );
    assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('current Recipe command and read modules do not use the additive technical tables', () => {
    for (const relativePath of [
        'api/services/recipeCommands.cjs',
        'api/services/recipeQueries.cjs',
        'api/db.cjs',
        'api/routes/recipes.cjs',
    ]) {
        const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
        assert.doesNotMatch(source, /recipe_functional_technical_profiles|recipe_technical_knowledge/);
    }
});
