'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const Database = require('better-sqlite3');
const {
    ENTITY_LOOKUP_API_VERSION,
    MAX_CANDIDATES_PER_TYPE,
    MAX_ENTITY_TYPES_PER_REQUEST,
    MAX_MENTION_LENGTH,
    MAX_TOTAL_CANDIDATES,
    createEntityLookupService,
} = require('../api/services/entityLookupService.cjs');
const { createEntityLookupRouter } = require('../api/routes/entityLookup.cjs');
const { shouldRecheckManagementActions } = require('../api/services/managementActionLifecycle.cjs');

function createDb() {
    const db = new Database(':memory:');
    db.exec(`
        CREATE TABLE coils (id INTEGER PRIMARY KEY, spec TEXT, sheets INTEGER, scheme_code TEXT, scheme_name TEXT);
        CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, deleted_at TEXT);
        CREATE TABLE orders (id INTEGER PRIMARY KEY, contract_no TEXT, customer_name TEXT, deleted_at TEXT);
        CREATE TABLE parts (id INTEGER PRIMARY KEY, model TEXT, deleted_at TEXT);
        CREATE TABLE recipes (id INTEGER PRIMARY KEY, name TEXT, spec TEXT, deleted_at TEXT);
        CREATE TABLE pump_shell_templates (id INTEGER PRIMARY KEY, shell_model TEXT, deleted_at TEXT);
        CREATE TABLE catalog_identity_profiles (
            id INTEGER PRIMARY KEY,
            part_id INTEGER,
            coil_id INTEGER,
            template_id INTEGER,
            recipe_id INTEGER,
            model_variant_id INTEGER
        );
        CREATE TABLE catalog_name_aliases (
            id INTEGER PRIMARY KEY,
            profile_id INTEGER NOT NULL,
            alias TEXT NOT NULL,
            spec_revision INTEGER NOT NULL DEFAULT 1,
            deleted_at TEXT
        );
    `);
    return db;
}

function validRequest(overrides = {}) {
    return {
        version: ENTITY_LOOKUP_API_VERSION,
        mention: 'ENTITY-001',
        entityTypes: ['coil', 'customer', 'order', 'part', 'recipe', 'template'],
        matchPolicy: 'EXACT_OR_APPROVED_ALIAS',
        ...overrides,
    };
}

async function withServer(router, operation) {
    const app = express();
    app.use(express.json());
    app.use('/api/entity-lookup', router);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        return await operation(`http://127.0.0.1:${server.address().port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test('entity lookup constants enforce bounded six-type query', () => {
    assert.equal(MAX_ENTITY_TYPES_PER_REQUEST, 6);
    assert.equal(MAX_CANDIDATES_PER_TYPE, 10);
    assert.equal(MAX_TOTAL_CANDIDATES, 30);
    assert.equal(MAX_MENTION_LENGTH, 160);
});

test('valid batch and subset requests return exact minimal candidates', () => {
    const db = createDb();
    db.prepare('INSERT INTO parts (id, model) VALUES (?, ?)').run(1, 'ENTITY-001');
    db.prepare('INSERT INTO coils (id, spec, sheets, scheme_code, scheme_name) VALUES (?, ?, ?, ?, ?)')
        .run(2, 'A', 10, 'ENTITY-001', 'Coil A');
    const service = createEntityLookupService({ db });
    const batch = service.lookupEntities(validRequest());
    assert.equal(batch.complete, true);
    assert.equal(batch.candidateCount, 2);
    assert.deepEqual(batch.candidates, [
        { entityType: 'coil', canonicalId: '2', matchKind: 'EXACT', bindingRefs: [{ kind: 'schemeCode', value: 'ENTITY-001' }] },
        { entityType: 'part', canonicalId: '1', matchKind: 'EXACT' },
    ]);
    const subset = service.lookupEntities(validRequest({ entityTypes: ['part'] }));
    assert.equal(subset.attemptedEntityTypes, 1);
    assert.equal(subset.candidateCount, 1);
    db.close();
});

test('lookup query performs no SQLite write and does not enter mutation lifecycle', () => {
    const db = createDb();
    db.prepare('INSERT INTO parts (id, model) VALUES (?, ?)').run(1, 'ENTITY-001');
    const before = db.totalChanges;
    createEntityLookupService({ db }).lookupEntities(validRequest());
    assert.equal(db.totalChanges, before);
    assert.equal(shouldRecheckManagementActions({
        method: 'POST', path: '/api/entity-lookup', statusCode: 200,
    }), false);
    db.close();
});

test('request contract rejects invalid or unsafe shapes without coercion', () => {
    const db = createDb();
    const lookup = createEntityLookupService({ db }).lookupEntities;
    const invalidRequests = [
        validRequest({ version: 2 }),
        validRequest({ mention: '' }),
        validRequest({ mention: 800 }),
        validRequest({ mention: 'x'.repeat(MAX_MENTION_LENGTH + 1) }),
        validRequest({ entityTypes: [] }),
        validRequest({ entityTypes: ['part', 'part'] }),
        validRequest({ entityTypes: ['quotation'] }),
        validRequest({ matchPolicy: 'FUZZY' }),
        { ...validRequest(), table: 'parts' },
    ];
    for (const input of invalidRequests) assert.throws(() => lookup(input));
    db.close();
});

test('zero, same-type, cross-type, and duplicate-field matches preserve multiplicity safely', () => {
    const db = createDb();
    const service = createEntityLookupService({ db });
    assert.equal(service.lookupEntities(validRequest({ mention: 'missing' })).candidateCount, 0);
    db.prepare('INSERT INTO parts (id, model) VALUES (?, ?), (?, ?)').run(1, 'DUP', 2, 'DUP');
    assert.equal(service.lookupEntities(validRequest({ mention: 'DUP', entityTypes: ['part'] })).candidateCount, 2);
    db.prepare('INSERT INTO customers (id, name) VALUES (?, ?)').run(3, 'DUP');
    assert.equal(service.lookupEntities(validRequest({ mention: 'DUP', entityTypes: ['part', 'customer'] })).candidateCount, 3);
    db.prepare('INSERT INTO recipes (id, name, spec) VALUES (?, ?, ?)').run(4, 'SAME', 'SAME');
    assert.equal(service.lookupEntities(validRequest({ mention: 'SAME', entityTypes: ['recipe'] })).candidateCount, 1);
    db.close();
});

test('candidate cap is explicit and never reported complete', () => {
    const db = createDb();
    const insert = db.prepare('INSERT INTO parts (id, model) VALUES (?, ?)');
    for (let id = 1; id <= MAX_CANDIDATES_PER_TYPE + 1; id += 1) insert.run(id, 'CAPPED');
    const result = createEntityLookupService({ db }).lookupEntities(validRequest({
        mention: 'CAPPED',
        entityTypes: ['part'],
    }));
    assert.equal(result.status, 'INCOMPLETE');
    assert.equal(result.complete, false);
    assert.equal(result.candidateCount, MAX_CANDIDATES_PER_TYPE);
    db.close();
});

test('contains, prefix, and punctuation-different mentions are not accepted', () => {
    const db = createDb();
    db.prepare('INSERT INTO parts (id, model) VALUES (?, ?)').run(1, 'v750-tokoy-');
    const lookup = createEntityLookupService({ db }).lookupEntities;
    for (const mention of ['v750', 'v750-tokoy', 'tokoy']) {
        assert.equal(lookup(validRequest({ mention, entityTypes: ['part'], matchPolicy: 'EXACT' })).candidateCount, 0);
    }
    assert.equal(lookup(validRequest({ mention: 'V750-TOKOY-', entityTypes: ['part'], matchPolicy: 'EXACT' })).candidateCount, 1);
    assert.equal(lookup(validRequest({ mention: 'v750-tokoy-', entityTypes: ['part'], matchPolicy: 'APPROVED_ALIAS' })).candidateCount, 0);
    db.close();
});

test('formal recipe alias resolution is exact, unique, typed, active, and current-name-first', () => {
    const db = createDb();
    db.prepare('INSERT INTO recipes (id, name, spec) VALUES (?, ?, ?), (?, ?, ?)')
        .run(1, '配方-V550-当前', 'V550', 2, '老V550经典款', 'OTHER');
    db.prepare('INSERT INTO catalog_identity_profiles (id, recipe_id) VALUES (?, ?), (?, ?)').run(11, 1, 12, 2);
    db.prepare('INSERT INTO catalog_name_aliases (id, profile_id, alias) VALUES (?, ?, ?), (?, ?, ?)')
        .run(21, 11, '老V550经典款', 22, 12, '另一个旧名');
    const lookup = createEntityLookupService({ db }).lookupEntities;

    const alias = lookup(validRequest({ mention: '老V550经典款', entityTypes: ['recipe'], matchPolicy: 'APPROVED_ALIAS' }));
    assert.equal(alias.complete, true);
    assert.deepEqual(alias.candidates, [{ entityType: 'recipe', canonicalId: '1', matchKind: 'APPROVED_ALIAS' }]);
    assert.deepEqual(alias.resolutions[0], {
        entityType: 'recipe', state: 'FORMAL_ALIAS_MATCH', candidateCount: 1,
        canonicalType: 'recipe', canonicalId: '1', canonicalCurrentName: '配方-V550-当前', matchedAlias: '老V550经典款',
        provenance: { kind: 'formal_persisted_alias', sourceOfTruth: 'catalog_name_aliases+catalog_identity_profiles+recipes', targetActive: true },
    });

    const currentWins = lookup(validRequest({ mention: '老V550经典款', entityTypes: ['recipe'], matchPolicy: 'EXACT_OR_APPROVED_ALIAS' }));
    assert.deepEqual(currentWins.candidates, [{ entityType: 'recipe', canonicalId: '2', matchKind: 'EXACT' }]);
    assert.equal(currentWins.resolutions[0].state, 'CANONICAL_NAME_MATCH');
    assert.equal(lookup(validRequest({ mention: 'V550经典', entityTypes: ['recipe'], matchPolicy: 'APPROVED_ALIAS' })).candidateCount, 0);
    assert.equal(lookup(validRequest({ mention: '不存在的旧名', entityTypes: ['recipe'], matchPolicy: 'APPROVED_ALIAS' })).resolutions[0].state, 'ALIAS_NOT_FOUND');
    db.prepare('INSERT INTO catalog_name_aliases (id, profile_id, alias) VALUES (?, ?, ?)').run(23, 11, 'OLD-V550');
    assert.equal(lookup(validRequest({ mention: 'ＯＬＤ－Ｖ５５０', entityTypes: ['recipe'], matchPolicy: 'APPROVED_ALIAS' })).resolutions[0].state, 'FORMAL_ALIAS_MATCH');
    db.close();
});

test('formal recipe alias resolution fails closed for ambiguity and unavailable targets', () => {
    const db = createDb();
    db.prepare('INSERT INTO recipes (id, name, spec, deleted_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)')
        .run(1, '配方一', 'A', null, 2, '配方二', 'B', null, 3, '已删除配方', 'C', '2026-09-20T00:00:00.000Z');
    db.prepare('INSERT INTO catalog_identity_profiles (id, recipe_id) VALUES (?, ?), (?, ?), (?, ?)').run(11, 1, 12, 2, 13, 3);
    db.prepare('INSERT INTO catalog_name_aliases (id, profile_id, alias) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)')
        .run(21, 11, '重复旧名', 22, 12, '重复旧名', 23, 13, '失效旧名');
    const lookup = createEntityLookupService({ db }).lookupEntities;

    const ambiguous = lookup(validRequest({ mention: '重复旧名', entityTypes: ['recipe'], matchPolicy: 'APPROVED_ALIAS' }));
    assert.equal(ambiguous.resolutions[0].state, 'ALIAS_AMBIGUOUS');
    assert.deepEqual(ambiguous.candidates.map(item => item.canonicalId), ['1', '2']);
    const unavailable = lookup(validRequest({ mention: '失效旧名', entityTypes: ['recipe'], matchPolicy: 'APPROVED_ALIAS' }));
    assert.equal(unavailable.resolutions[0].state, 'ALIAS_TARGET_UNAVAILABLE');
    assert.equal(unavailable.candidateCount, 0);
    db.close();
});

test('identity strings reach exact lookup character-for-character', () => {
    const db = createDb();
    const insert = db.prepare('INSERT INTO parts (id, model) VALUES (?, ?)');
    const identities = ['v750-tokoy-', 'V750-A', '800平刀', 'abc-', '-a-', 'a/b', 'a.b', 'a_b', 'a+b', '800'];
    identities.forEach((identity, index) => insert.run(index + 1, identity));
    const lookup = createEntityLookupService({ db }).lookupEntities;
    identities.forEach(identity => {
        const result = lookup(validRequest({ mention: identity, entityTypes: ['part'], matchPolicy: 'EXACT' }));
        assert.equal(result.candidateCount, 1, identity);
    });
    db.close();
});

test('route returns standard success, validation, and internal error envelopes', async () => {
    const db = createDb();
    db.prepare('INSERT INTO parts (id, model) VALUES (?, ?)').run(1, 'ENTITY-001');
    await withServer(createEntityLookupRouter({ db }), async origin => {
        const success = await fetch(`${origin}/api/entity-lookup`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validRequest({ entityTypes: ['part'] })),
        });
        assert.equal(success.status, 200);
        assert.equal((await success.json()).data.candidateCount, 1);
        const invalid = await fetch(`${origin}/api/entity-lookup`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validRequest({ entityTypes: ['unknown'] })),
        });
        const invalidBody = await invalid.json();
        assert.equal(invalid.status, 400);
        assert.equal(invalidBody.data.status, 'UNSUPPORTED_TYPE');
    });
    await withServer(createEntityLookupRouter({ lookupEntities: () => { throw new Error('boom'); } }), async origin => {
        const response = await fetch(`${origin}/api/entity-lookup`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(validRequest()),
        });
        const body = await response.json();
        assert.equal(response.status, 500);
        assert.equal(body.data.status, 'INTERNAL_ERROR');
        assert.equal(body.data.complete, false);
    });
    db.close();
});
