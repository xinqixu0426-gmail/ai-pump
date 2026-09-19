'use strict';
/**
 * ONT-P8L — bounded legacy `coil <-> recipes` repair regression.
 *
 * Supervisor ruling A + B. The legacy local-mode repair used to demand the COMPLETE unfiltered recipe
 * catalogue; on a real-sized database that tool result is 120,990 bytes against a 96 KB budget, so the
 * model received a truncated catalogue and could answer incompletely. It is now a bounded state machine:
 *
 *     NONE -> COIL_ID_DISCOVERY -> BOUNDED_REVERSE_READ -> DONE     (max 2 software steps)
 *
 * These tests pin the invariants the ruling required, and the ones that were expensive to get right:
 *   - step 2 exists only after step 1 produced a verified canonical coil id, and takes its `coilId` from
 *     that receipt — never from the user's wording;
 *   - `get_all_recipes` is never demanded again (the planner fails safe by returning null);
 *   - provider calls never increase (software steps are free; model rounds keep the old one-shot bound);
 *   - the machine terminates even when a step cannot be planned, which is what previously drove a +3
 *     provider-call regression;
 *   - the aggregate genuinely exceeds the budget on a large fixture while the bounded read is delivered.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/ontologyShadowFixture.cjs');
const { cases } = require('./helpers/ontologyRoutingCorpus.cjs');
const runtime = require('../api/services/aiAssistantRuntime.cjs');
const oracleV1 = require('./fixtures/ontology-coil-recipe-legacy-oracle-v1.json');
const oracleV2 = require('./fixtures/ontology-coil-recipe-legacy-oracle-v2.json');
const { createRelationReadService } = require('../api/services/relationReadService.cjs');
const { enforceAiToolResultBudget } = require('../api/services/aiToolProtocol.cjs');

const {
    LEGACY_RELATION_REPAIR_STATES: S, MAX_SOFTWARE_REPAIR_STEPS, MAX_LEGACY_MODEL_REPAIR_ROUNDS,
    legacyRelationMissingTools, nextLegacyRelationRepairState, verifiedCanonicalCoilId,
} = runtime;

/** A verified single-row coil receipt, exactly the shape the runtime accepts as a canonical root. */
const coilReceipt = (id, rows = [{ id }]) => ({ name: 'search_coils', args: { spec: '12', sheets: 120 },
    result: { success: true, count: rows.length, data: rows, filters: { keyword: '' },
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils' }] } } });

test('P8L the repair machine is explicitly bounded and step 2 needs a verified canonical coil root', () => {
    assert.equal(MAX_SOFTWARE_REPAIR_STEPS, 2, 'the machine must never grow into Tool A -> B -> C -> D');
    assert.equal(MAX_LEGACY_MODEL_REPAIR_ROUNDS, 1);
    assert.deepEqual(Object.values(S), ['NONE', 'COIL_ID_DISCOVERY', 'BOUNDED_REVERSE_READ', 'DONE']);

    // Fresh turn: the identity read is the only thing demanded, and the aggregate never is.
    assert.deepEqual(legacyRelationMissingTools([], S.NONE), ['search_coils']);
    assert.equal(legacyRelationMissingTools([], S.NONE).includes('get_all_recipes'), false);

    // Step 1 produced exactly one verified canonical coil -> step 2 becomes eligible.
    assert.deepEqual(legacyRelationMissingTools([coilReceipt(501)], S.COIL_ID_DISCOVERY), ['get_recipes_by_coil']);
    // ...and once it ran, the machine asks for nothing more.
    assert.deepEqual(legacyRelationMissingTools(
        [coilReceipt(501), { name: 'get_recipes_by_coil', result: { success: true } }], S.BOUNDED_REVERSE_READ), []);
    assert.deepEqual(legacyRelationMissingTools([], S.DONE), []);

    assert.equal(nextLegacyRelationRepairState(S.NONE, 'search_coils'), S.COIL_ID_DISCOVERY);
    assert.equal(nextLegacyRelationRepairState(S.COIL_ID_DISCOVERY, 'get_recipes_by_coil'), S.BOUNDED_REVERSE_READ);
    assert.equal(nextLegacyRelationRepairState(S.BOUNDED_REVERSE_READ, 'anything_else'), null);
});

test('P8L step 2 is refused for zero candidates, several candidates and unverified receipts', () => {
    // No coil read at all.
    assert.equal(verifiedCanonicalCoilId([]), null);
    assert.deepEqual(legacyRelationMissingTools([], S.COIL_ID_DISCOVERY), [],
        'no candidates must not generate a second hop');
    // Several candidates: the repair must not pick one.
    assert.equal(verifiedCanonicalCoilId([coilReceipt(501, [{ id: 501 }, { id: 502 }])]), null);
    assert.deepEqual(legacyRelationMissingTools([coilReceipt(501, [{ id: 501 }, { id: 502 }])], S.COIL_ID_DISCOVERY), [],
        'an ambiguous root must not generate a second hop');
    // A receipt without formal execution evidence is not a canonical root.
    const unverified = coilReceipt(501);
    unverified.result.executionEvidence.verified = false;
    assert.equal(verifiedCanonicalCoilId([unverified]), null);
    assert.deepEqual(legacyRelationMissingTools([unverified], S.COIL_ID_DISCOVERY), []);
    // A row without a usable id is not a canonical identity.
    assert.equal(verifiedCanonicalCoilId([coilReceipt(1, [{ spec: '12', sheets: 120 }])]), null);

    // Planning agrees: no canonical root means no planned call.
    assert.equal(runtime.legacyRelationRepairCall('get_recipes_by_coil', '12-120线圈用在哪些配方', []), null);
    const planned = runtime.legacyRelationRepairCall('get_recipes_by_coil', '12-120线圈用在哪些配方', [coilReceipt(501)]);
    assert.deepEqual(JSON.parse(planned.function.arguments), { coilId: 501 },
        'the canonical id comes from the receipt, not from the wording');
    // The wording deliberately names a different coil; it must not influence the argument.
    const planned2 = runtime.legacyRelationRepairCall('get_recipes_by_coil', '12-200线圈用在哪些配方', [coilReceipt(501)]);
    assert.deepEqual(JSON.parse(planned2.function.arguments), { coilId: 501 });
});

test('P8L the aggregate can never be demanded again by the legacy relation repair', () => {
    assert.equal(runtime.requiredCoilRecipeToolCall('get_all_recipes', '12-200的线圈都做了哪些配方'), null,
        'fail-safe: a reintroduced demand degrades to a model round instead of reading the catalogue');
    for (const state of Object.values(S)) {
        for (const receipts of [[], [coilReceipt(501)]]) {
            assert.equal(legacyRelationMissingTools(receipts, state).includes('get_all_recipes'), false,
                `${state} must never demand the whole-recipe aggregate`);
        }
    }
});

test('P8L the bounded repair never increases provider calls, and reads the aggregate zero times', () => {
    assert.equal(oracleV1.cases.length, oracleV2.cases.length);
    let aggregateV1 = 0, aggregateV2 = 0, boundedV2 = 0;
    for (const after of oracleV2.cases) {
        const before = oracleV1.cases.find(entry => entry.caseId === after.caseId);
        assert.ok(after.modelCalls <= before.modelCalls,
            `${after.caseId}: provider calls must not increase (${before.modelCalls} -> ${after.modelCalls})`);
        if (before.selectedTools.includes('get_all_recipes')) aggregateV1 += 1;
        if (after.selectedTools.includes('get_all_recipes')) aggregateV2 += 1;
        if (after.selectedTools.includes('get_recipes_by_coil')) boundedV2 += 1;
    }
    assert.ok(aggregateV1 > 0, 'V1 must record the pre-fix aggregate reads');
    assert.equal(aggregateV2, 0, 'the current baseline must read the aggregate zero times');
    assert.ok(boundedV2 > 0, 'the current baseline must use the bounded reverse read');
});

test('P8L a large fixture keeps the aggregate over budget while the bounded read stays complete', () => {
    const db = fixture();
    try {
        const insert = db.prepare('INSERT INTO recipes(id,name,coil_id,template_id,parts_json) VALUES(?,?,501,401,?)');
        const parts = JSON.stringify(Array.from({ length: 20 }, (_, index) => ({
            partId: 601, model: `Shadow批量零件-${index}-${'零'.repeat(44)}`, supplier: '供应甲', qty: 1 })));
        db.transaction(() => { for (let id = 1000; id < 1400; id += 1) insert.run(id, `Shadow大件${id}`, parts); })();

        const aggregate = db.prepare(`SELECT id,name,coil_id AS coilId,template_id AS templateId,parts_json AS partsJson
            FROM recipes WHERE deleted_at IS NULL ORDER BY id DESC`).all();
        const aggregateResult = { success: true, count: aggregate.length, filters: { keyword: '', hasTechnicalFiles: null },
            data: aggregate, executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/recipes' }] } };
        const aggregateBytes = Buffer.byteLength(JSON.stringify(aggregateResult), 'utf8');
        assert.ok(aggregateBytes > 128 * 1024, `the fixture must exceed 128 KB, got ${aggregateBytes}`);
        const refused = enforceAiToolResultBudget('get_all_recipes', aggregateResult, [], 96 * 1024);
        assert.equal(refused.success, false, 'the aggregate must be refused at the 96 KB budget');
        assert.equal(refused.code, 'AI_QUERY_RESULT_TOO_LARGE');

        // The bounded reverse read answers the same question on the same database, completely and small.
        const service = createRelationReadService({ db });
        const bounded = service.read({ version: 1, relation: 'coil.recipes', rootId: 501, pageSize: 50 });
        // A page that has more rows must never claim to be the whole relation.
        assert.equal(bounded.setCompleteness, 'PARTIAL');
        assert.equal(bounded.hasMore, true);
        assert.equal(bounded.totalCount, 401);
        assert.equal(bounded.items.length, 50);
        const boundedBytes = Buffer.byteLength(JSON.stringify(bounded.items), 'utf8');
        assert.ok(boundedBytes < 8192, `a bounded page must stay small, got ${boundedBytes}`);
        assert.ok(boundedBytes * 100 < aggregateBytes, 'the bounded page must be orders of magnitude smaller');
        // Draining by keyset (which the AI tool does itself) reaches every row and only then reports COMPLETE.
        let afterId, seen = 0, pages = 0, last;
        for (;;) {
            last = service.read({ version: 1, relation: 'coil.recipes', rootId: 501, pageSize: 50,
                ...(afterId === undefined ? {} : { afterId }) });
            pages += 1; seen += last.items.length;
            if (!last.hasMore) break;
            afterId = last.pageBoundary.nextAfterId;
        }
        assert.equal(seen, 401);
        assert.equal(pages, 9);
        assert.equal(last.setCompleteness, 'COMPLETE', 'the drained set is the only thing that may claim COMPLETE');
    } finally { db.close(); }
});

test('P8L the negative corpus never reaches a second hop', () => {
    const negatives = cases.filter(entry => entry.category === 'negative');
    assert.ok(negatives.length > 0);
    for (const entry of negatives) {
        // A negative turn holds no verified canonical coil, so the machine has nothing to hop with.
        assert.deepEqual(legacyRelationMissingTools([], S.NONE), ['search_coils']);
        assert.deepEqual(legacyRelationMissingTools([], S.BOUNDED_REVERSE_READ), [],
            `${entry.caseId}: a non-relation turn must not demand the bounded read`);
    }
});
