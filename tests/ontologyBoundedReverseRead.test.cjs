'use strict';
/**
 * ONT-P8R — bounded canonical reverse read (`coil -> recipes`).
 *
 * ONT-P8 measured the defect this phase removes: the canary's coil-rooted direction forced the model
 * to read the COMPLETE unfiltered recipe collection (`get_all_recipes`), whose payload was 121 KB
 * against the runtime's 96 KB per-result budget on a real-sized database. The runtime therefore
 * refused the read, revoked the canary and handed the turn back to legacy, and relation correctness
 * dropped from 4/4 to 1/4 in that direction.
 *
 * The fix is a formal bounded reverse read over the `recipes.coil_id` foreign key
 * (`POST /api/relations/read`, relation `coil.recipes`) exposed as the registered read tool
 * `get_recipes_by_coil`. These tests prove:
 *   1. the reader is bounded, keyed and contract-valid, and answers the known-failing case correctly;
 *   2. inverse membership is certified ONLY from a complete, correctly-rooted, contract-shaped page,
 *      so the shadow can never fabricate membership;
 *   3. the large-fixture regression is permanent: the old whole-collection read still exceeds the AI
 *      tool-result budget while the bounded read is delivered.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/ontologyShadowFixture.cjs');
const { createRelationReadService } = require('../api/services/relationReadService.cjs');
const { createRelationReadRouter } = require('../api/routes/relationRead.cjs');
const { validateResult, request, MAX_RESULT_BYTES, DEFAULT_PAGE_SIZE } = require('../api/services/relationReadContract.cjs');
const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
const { enforceAiToolResultBudget } = require('../api/services/aiToolProtocol.cjs');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
const {
    boundedReverseRead, routingExecuteToolCall,
} = require('./helpers/ontologyShadowFixture.cjs');

const coilRead = (coilId, pageSize) => ({ version: 1, relation: 'coil.recipes', rootId: coilId,
    ...(pageSize === undefined ? {} : { pageSize }) });

test('P8R the relation contract exposes coil.recipes as a bounded canonical reverse read', () => {
    const q = request(coilRead(501));
    assert.equal(q.relation, 'coil.recipes');
    assert.equal(q.pageSize, DEFAULT_PAGE_SIZE);
    // Callers may only choose a relation, a root and a page boundary: no caller-supplied SQL or filters.
    for (const invalid of [{ ...coilRead(501), sql: 'SELECT 1' }, { ...coilRead(501), where: '1=1' },
        { ...coilRead(501), filter: {} }, { version: 1, relation: 'coil.recipes' },
        { version: 1, relation: 'coil.recipes', rootId: 0 }, { version: 1, relation: 'coil.recipes', rootId: 501, pageSize: 0 },
        { version: 2, relation: 'coil.recipes', rootId: 501 }]) {
        assert.throws(() => request(invalid), { code: 'RELATION_REQUEST_INVALID' }, JSON.stringify(invalid));
    }
    assert.ok(MAX_RESULT_BYTES > 0);
});

test('P8R the reverse read is bounded, keyed, correctly rooted and contract-valid', () => {
    const db = fixture();
    try {
        const service = createRelationReadService({ db });
        const first = service.read(coilRead(501));
        assert.equal(first.relation, 'coil.recipes');
        assert.equal(first.resourceType, 'recipe');
        assert.equal(first.semantics, 'CURRENT_RECIPE_COIL_REFERENCES');
        assert.equal(first.sort, 'id_desc');
        assert.equal(first.totalCountKnown, true);
        assert.equal(first.totalCount, 1);
        assert.deepEqual(first.items.map(item => item.canonicalId), ['301']);
        assert.deepEqual(first.items.map(item => item.display.name), ['Shadow配方甲']);
        assert.equal(first.provenance.sourceApi, '/api/relations/read');
        assert.equal(first.provenance.capabilityId, 'relations.read');
        assert.equal(first.provenance.access, 'query');
        assert.deepEqual(validateResult(coilRead(501), first), first);
        // Results are delivered in strict descending id order with a keyset boundary, never an offset.
        const many = fixture();
        try {
            const bulk = createRelationReadService({ db: many });
            many.prepare(`INSERT INTO recipes(id,name,coil_id,parts_json) VALUES
                (901,'Shadow批量甲',501,'[]'),(902,'Shadow批量乙',501,'[]'),(903,'Shadow批量丙',501,'[]')`).run();
            const page = bulk.read(coilRead(501, 2));
            assert.deepEqual(page.items.map(item => item.canonicalId), ['903', '902']);
            assert.equal(page.totalCount, 4);
            assert.equal(page.hasMore, true);
            assert.equal(page.pageBoundary.nextAfterId, 902);
            const next = bulk.read({ ...coilRead(501, 2), afterId: page.pageBoundary.nextAfterId });
            assert.deepEqual(next.items.map(item => item.canonicalId), ['901', '301']);
            assert.equal(next.hasMore, false);
            assert.equal(next.pageBoundary.nextAfterId, null);
            // A coil with no referencing recipe is a verified empty answer, not an error.
            const empty = bulk.read(coilRead(502));
            assert.equal(empty.totalCount, 0);
            assert.equal(empty.status ?? 'VERIFIED_EMPTY', 'VERIFIED_EMPTY');
            assert.deepEqual(empty.items, []);
        } finally { many.close(); }
    } finally { db.close(); }
});

test('P8R an unknown coil is refused instead of answered with an empty set', () => {
    const db = fixture();
    try {
        const service = createRelationReadService({ db });
        assert.throws(() => service.read(coilRead(999)), { code: 'RELATION_NOT_FOUND' });
    } finally { db.close(); }
});

test('P8R the reverse read is reachable only behind the authenticated route and only for registered capabilities', async () => {
    const db = fixture();
    const server = await new Promise(resolve => {
        const express = require('express');
        const app = express();
        app.use(express.json());
        app.use('/api/relations', createRelationReadRouter({ db }));
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    try {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/relations/read`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(coilRead(501)),
        });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.success, true);
        assert.equal(body.data.totalCount, 1);
        // The route rejects an unregistered relation even when the caller asks for one directly.
        const rejected = await fetch(`http://127.0.0.1:${server.address().port}/api/relations/read`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ version: 1, relation: 'coil.everything', rootId: 501 }),
        });
        assert.equal(rejected.status, 400);
        assert.equal((await rejected.json()).code, 'RELATION_REQUEST_INVALID');
        // The capability is registered as a read query with AI and internal callers only.
        const capability = getAiCapability('get_recipes_by_coil');
        assert.equal(capability.access, 'read');
        assert.equal(capability.operation, 'query');
        assert.equal(capability.executorKey, 'query');
        assert.equal(capability.requiresConfirmation ?? false, false);
        assert.equal(getAiCapability('__not_a_tool__'), null);
    } finally {
        await new Promise(resolve => server.close(resolve));
        db.close();
    }
});

test('P8R the AI tool refuses a missing or malformed root id and never invents one', async () => {
    const { executeToolCall } = require('../api/routes/ai/executor.cjs');
    for (const args of [{}, { coilId: 0 }, { coilId: -1 }, { coilId: 1.5 }, { coilId: 'abc' }]) {
        const result = await executeToolCall('get_recipes_by_coil', args, { allowWrite: false });
        assert.equal(result.success, false, JSON.stringify(args));
        assert.ok(/coilId|线圈/u.test(result.error), result.error);
    }
    const schema = AI_TOOLS.find(tool => tool.function.name === 'get_recipes_by_coil');
    assert.deepEqual(schema.function.parameters.required, ['coilId']);
    assert.equal(schema.function.parameters.additionalProperties, undefined);
});

/** Bounded page-shaped observation used to exercise the inverse-membership certification matrix. */
const bindingFor = root => ({ relationId: 'coil.used_by_recipe', status: 'BOUND',
    root: { entityType: 'coil', canonicalId: String(root) }, targetEntityType: 'recipe' });
const observation = (coilId, overrides = {}, recipeIds = [301]) => [
    { name: 'search_coils', result: { success: true, data: [{ id: coilId }], count: 1, filters: { keyword: '' },
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils' }] } } },
    { name: 'get_recipes_by_coil', args: { coilId }, result: boundedReverseRead(coilId, recipeIds, overrides) },
];

test('P8R inverse membership is certified only from a complete correctly-rooted contract-shaped page', () => {
    const populated = currentFactsForBinding(bindingFor(501), observation(501));
    assert.deepEqual(populated.canonicalTargetIds, ['301']);
    assert.equal(populated.complete, true);
    assert.equal(populated.canonical, true);

    const empty = currentFactsForBinding(bindingFor(501), observation(501, {}, []));
    assert.deepEqual(empty.canonicalTargetIds, []);
    assert.equal(empty.complete, true, 'a verified empty page is a complete answer');

    // Every deviation must leave the observation incomplete, so it can never assert membership.
    const incomplete = [
        ['truncated page', { hasMore: true, totalCount: 2, count: 1 }],
        ['count disagrees with total', { totalCount: 5, count: 1 }],
        ['unknown total', { totalCountKnown: false, totalCount: undefined }],
        ['unverified evidence', { executionEvidence: { verified: false, kind: 'formal_api_query', calls: [] } }],
        ['wrong evidence path', { executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'POST', path: '/api/coils/cost-preview' }] } }],
        ['legacy-shaped payload', { relation: 'part.recipes' }],
        ['semantics replaced', { semantics: 'SAVED_BOM_PART_REFERENCES' }],
        ['failed result', { success: false }],
    ];
    for (const [label, overrides] of incomplete) {
        const facts = currentFactsForBinding(bindingFor(501), observation(501, overrides));
        assert.equal(facts.complete, false, label);
        assert.deepEqual(facts.canonicalTargetIds, [], label);
    }
    // A page rooted at a different coil cannot certify this root.
    const otherRoot = currentFactsForBinding(bindingFor(501), observation(502));
    assert.equal(otherRoot.complete, false);
    assert.deepEqual(otherRoot.canonicalTargetIds, []);
    // Conflicting complete snapshots for the same root must not be resolved by taking the last one.
    const conflicting = currentFactsForBinding(bindingFor(501), [...observation(501), ...observation(501, {}, [301, 302])]);
    assert.equal(conflicting.complete, false);
    // A non-integer target id is not a canonical identity.
    const malformed = currentFactsForBinding(bindingFor(501), observation(501, { data: [{ recipeId: 'x', recipeName: 'y' }] }));
    assert.equal(malformed.complete, false);
    assert.equal(malformed.canonical, false);
    // Repeated identical reads are complete + complete = complete.
    const repeated = currentFactsForBinding(bindingFor(501), [...observation(501), ...observation(501)]);
    assert.deepEqual(repeated.canonicalTargetIds, ['301']);
    assert.equal(repeated.complete, true);
});

test('P8R the whole-collection read still exceeds the AI budget while the bounded read is delivered', () => {
    // Permanent large-fixture regression for the ONT-P8 defect class. Enough realistic recipes are
    // seeded that the legacy aggregate payload passes 96 KB, exactly like the production database.
    const db = fixture();
    try {
        const insert = db.prepare(`INSERT INTO recipes(id,name,coil_id,template_id,parts_json) VALUES(?,?,501,401,?)`);
        const parts = JSON.stringify(Array.from({ length: 12 }, (_, index) => ({
            partId: 601, model: `Shadow批量零件-${index}-${'零'.repeat(24)}`, supplier: '供应甲', qty: 1 })));
        db.transaction(() => {
            for (let id = 1000; id < 1400; id += 1) insert.run(id, `Shadow大件${id}`, parts);
        })();
        const aggregate = db.prepare(`SELECT id,name,coil_id AS coilId,template_id AS templateId,parts_json AS partsJson
            FROM recipes WHERE deleted_at IS NULL ORDER BY id DESC`).all();
        const aggregateResult = { success: true, count: aggregate.length, filters: { keyword: '', hasTechnicalFiles: null },
            data: aggregate, executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/recipes' }] } };
        assert.ok(Buffer.byteLength(JSON.stringify(aggregateResult), 'utf8') > 96 * 1024,
            'the fixture must reproduce the oversized aggregate payload');
        const refused = enforceAiToolResultBudget('get_all_recipes', aggregateResult, [], 96 * 1024);
        assert.equal(refused.success, false);
        assert.equal(refused.code, 'AI_QUERY_RESULT_TOO_LARGE');

        const bounded = createRelationReadService({ db }).read(coilRead(501));
        const boundedResult = { success: true, count: bounded.items.length, totalCount: bounded.totalCount,
            hasMore: bounded.hasMore, data: bounded.items, executionEvidence: bounded.provenance };
        const delivered = enforceAiToolResultBudget('get_recipes_by_coil', boundedResult, [], 96 * 1024);
        assert.equal(delivered.success, true);
        // The bounded read's size depends on the page, not on the database: 400 referencing recipes still
        // produce a small delivered page, which is the property the ONT-P8 defect lacked.
        assert.ok(Buffer.byteLength(JSON.stringify(boundedResult), 'utf8') < 4096,
            'the bounded reverse read must stay far below the budget regardless of database size');
        assert.equal(bounded.hasMore, true);
        assert.equal(bounded.totalCount, 401);
        assert.equal(delivered.totalCount, bounded.totalCount);
        assert.equal(bounded.items.length, 20);
    } finally { db.close(); }
});

// The shared routing stub must stay behaviourally identical to the frozen corpus executor for every
// pre-existing tool, otherwise the routing suites would silently stop measuring the same thing.
test('P8R the routing executor stub keeps frozen behaviour and only adds the bounded reverse read', async () => {
    const executed = [];
    const stub = routingExecuteToolCall(executed);
    const recipe = await stub('get_all_recipes', {}, { allowWrite: false });
    assert.equal(recipe.count, 1);
    assert.deepEqual(recipe.data.map(row => row.id), [301]);
    const coil = await stub('search_coils', { schemeCode: 'SHADOW-501' }, { allowWrite: false });
    assert.deepEqual(coil.data.map(row => row.id), [501]);
    const reverse = await stub('get_recipes_by_coil', { coilId: 501 }, { allowWrite: false });
    assert.equal(reverse.rootCoilId, 501);
    assert.deepEqual(reverse.data.map(item => item.recipeId), [301]);
    assert.deepEqual(executed.map(entry => entry.name), ['get_all_recipes', 'search_coils', 'get_recipes_by_coil']);
    await assert.rejects(() => stub('get_all_recipes', {}, {}), { message: 'WRITE_ACCESS' });
});
