'use strict';

const Database = require('better-sqlite3');
const { createEntityLookupService } = require('../../../api/services/entityLookupService.cjs');

function createGroundingFixture() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE coils (id INTEGER PRIMARY KEY, spec TEXT, sheets INTEGER, scheme_code TEXT, scheme_name TEXT, material TEXT, slot_type TEXT, scheme_status TEXT, is_default INTEGER, scheme_family_code TEXT);
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
        CREATE TABLE orders (id INTEGER PRIMARY KEY, contract_no TEXT, customer_name TEXT, deleted_at TEXT);
        CREATE TABLE parts (id INTEGER PRIMARY KEY, model TEXT, deleted_at TEXT);
        CREATE TABLE recipes (id INTEGER PRIMARY KEY, name TEXT, spec TEXT, deleted_at TEXT);
        CREATE TABLE pump_shell_templates (id INTEGER PRIMARY KEY, shell_model TEXT, deleted_at TEXT);
        CREATE TABLE catalog_identity_profiles (id INTEGER PRIMARY KEY, part_id INTEGER, coil_id INTEGER, template_id INTEGER, recipe_id INTEGER, model_variant_id INTEGER);
        CREATE TABLE catalog_name_aliases (id INTEGER PRIMARY KEY, profile_id INTEGER NOT NULL, alias TEXT NOT NULL, spec_revision INTEGER NOT NULL DEFAULT 1, deleted_at TEXT);
    `);
    db.prepare('INSERT INTO coils VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(1, '12', 120, '12-120-A', '12-120 普通小眼', 'steel', 'small', 'ACTIVE', 1, 'F-12-120-A');
    db.prepare('INSERT INTO coils VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(2, '12', 120, '12-120-B', '12-120 加强大眼', 'copper', 'large', 'ACTIVE', 0, 'F-12-120-B');
    db.prepare('INSERT INTO coils VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(3, '12', 130, '12-130-A', '12-130 普通小眼', 'steel', 'small', 'ACTIVE', 1, 'F-12-130-A');
    db.prepare('INSERT INTO recipes VALUES (?, ?, ?, ?)').run(11, 'V750-通用款', 'V750', null);
    db.prepare('INSERT INTO recipes VALUES (?, ?, ?, ?)').run(12, 'V750-豪贝款', 'V750', null);
    db.prepare('INSERT INTO recipes VALUES (?, ?, ?, ?)').run(13, 'V550-通用款', 'V550', null);
    db.prepare('INSERT INTO recipes VALUES (?, ?, ?, ?)').run(14, 'V110-通用款', 'V110', null);
    db.prepare('INSERT INTO pump_shell_templates VALUES (?, ?, ?)').run(21, '通用款模板', null);
    db.prepare('INSERT INTO pump_shell_templates VALUES (?, ?, ?)').run(22, '豪贝款模板', null);
    db.prepare('INSERT INTO catalog_identity_profiles (id, recipe_id) VALUES (?, ?), (?, ?)').run(101, 11, 102, 12);
    db.prepare('INSERT INTO catalog_name_aliases (id, profile_id, alias) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)')
        .run(201, 101, 'V750通用款', 202, 102, 'V750豪贝款', 203, 101, '通用款V750', 204, 102, '豪贝款V750');
    return Object.freeze({
        db,
        lookupEntities: createEntityLookupService({ db }).lookupEntities,
        source: 'isolated_formal_entity_lookup_fixture',
        close: () => db.close(),
    });
}

module.exports = { createGroundingFixture };
