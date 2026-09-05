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
        CREATE TABLE pump_shell_templates (id INTEGER PRIMARY KEY, shell_model TEXT);
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
