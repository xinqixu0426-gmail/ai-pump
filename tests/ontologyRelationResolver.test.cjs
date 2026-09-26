'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { ontology } = require('../api/ontology/contract.cjs');
const { createOntologyRelationResolver } = require('../api/ontology/resolver.cjs');
const R = require('../api/ontology/resolverContract.cjs');

const ids = { customer: 1, order: 101, recipe: 301, part: 601, coil: 501, template: 401, quotation: 701 };
function fixture() {
    const db = new Database(':memory:');
    require('../api/database/migrations.cjs').runMigrations(db);
    db.exec(`
        INSERT INTO customers(id,name) VALUES(1,'客户甲'),(2,'客户乙');
        INSERT INTO pump_shell_templates(id,shell_model) VALUES(401,'模板甲'),(402,'空模板');
        INSERT INTO coils(id,scheme_name,scheme_code,spec,material,sheets) VALUES(501,'线圈甲','C-501','规格甲','钢带',20),(502,'空线圈','C-502','规格乙','钢带',20);
        INSERT INTO parts(id,model,supplier) VALUES(601,'零件甲','供应甲'),(602,'空零件','供应乙');
        INSERT INTO recipes(id,name,template_id,coil_id,parts_json) VALUES(301,'配方甲',401,501,'[{"partId":601,"model":"零件甲","supplier":"供应甲"}]'),(302,'空配方',NULL,NULL,'[]');
        INSERT INTO orders(id,contract_no,customer_id,customer_name,items_json) VALUES(101,'ORD-101',1,'客户甲','[{"recipeId":301,"recipeName":"配方甲","qty":1,"unitPrice":3}]'),(102,'ORD-102',1,'客户甲','[]');
        INSERT INTO quotations(id,customer_id,status) VALUES(701,1,'报价中');
    `);
    return { db, resolve: createOntologyRelationResolver({ db }).resolveRelation };
}
function request(relation, id = ids[relation.fromType], extra = {}) {
    return { ontologyVersion: 1, relationId: relation.relationId,
        root: { entityType: relation.fromType, canonicalId: String(id) }, ...extra };
}
function relation(id) { return ontology.relations.find(r => r.relationId === id); }
function changes(db) { return db.prepare('SELECT total_changes() n').get().n; }

for (const definition of ontology.relations) {
    test(`ONT-P2 canonical populated result and provenance: ${definition.relationId}`, () => {
        const { db, resolve } = fixture();
        try {
            const before = db.serialize(), count = changes(db), q = request(definition);
            const result = resolve(q);
            assert.equal(result.success, true, JSON.stringify(result));
            assert.equal(result.status, 'RESOLVED');
            assert.ok(result.items.some(i => i.canonicalId === String(ids[definition.toType])));
            assert.ok(result.items.every(i => i.entityType === definition.toType && R.canonicalId(i.canonicalId)));
            assert.equal(result.authority, definition.authority);
            assert.equal(result.provenance.physicalSource, definition.physicalSource);
            assert.equal(result.provenance.sourceId, definition.sourceId);
            assert.equal(result.provenance.currentVsSnapshotSemantics, definition.currentVsSnapshotSemantics);
            assert.deepEqual(result.provenance.root, q.root);
            assert.ok(Number.isFinite(Date.parse(result.asOf)));
            assert.equal(result.complete, true);
            assert.equal(result.hasMore, false);
            assert.equal(result.provenance.canonicalOnly, true);
            assert.ok(Object.isFrozen(R.validateResolveResult(q, structuredClone(result))));
            assert.equal(changes(db), count);
            assert.deepEqual(db.serialize(), before);
        } finally { db.close(); }
    });
    test(`ONT-P2 missing and soft-deleted root: ${definition.relationId}`, () => {
        const { db, resolve } = fixture();
        try {
            const absent = resolve(request(definition, 999999));
            assert.equal(absent.status, 'ROOT_NOT_FOUND');
            assert.equal(absent.success, false);
            assert.equal(absent.complete, false);
            const table = require('../api/ontology/sources.cjs').EntitySources[definition.fromType].table;
            // Trusted fixture-only SQL, never resolver input.
            if (definition.fromType === 'coil') {
                db.pragma('foreign_keys=OFF');
                db.prepare('DELETE FROM coils WHERE id=?').run(ids.coil);
            } else db.prepare(`UPDATE ${table} SET deleted_at='2026-09-18' WHERE id=?`).run(ids[definition.fromType]);
            assert.equal(resolve(request(definition)).status, 'ROOT_NOT_FOUND');
        } finally { db.close(); }
    });
}

for (const definition of ontology.relations.filter(r => r.direction === 'FORWARD')) {
    test(`ONT-P2 inverse membership pair: ${definition.sourceId}`, () => {
        const { db, resolve } = fixture();
        try {
            const forward = resolve(request(definition));
            const inverse = relation(definition.inverseRelationId);
            for (const target of forward.items) {
                const result = resolve(request(inverse, target.canonicalId, { pageSize: 1 }));
                assert.equal(result.success, true);
                let found = result.items.some(i => i.canonicalId === String(ids[definition.fromType])), page = result;
                while (!found && page.hasMore) {
                    page = resolve(request(inverse, target.canonicalId, { pageSize: 1, afterId: page.pageBoundary.nextAfterId }));
                    assert.equal(page.success, true);
                    found = page.items.some(i => i.canonicalId === String(ids[definition.fromType]));
                }
                assert.equal(found, true);
            }
        } finally { db.close(); }
    });
}

const emptyRoots = {
    'recipe.uses_template': 302, 'template.used_by_recipe': 402,
    'recipe.uses_coil': 302, 'coil.used_by_recipe': 502,
    'customer.has_order': 2, 'customer.has_quotation': 2,
    'order.contains_recipe': 102, 'recipe.contained_in_order': 302,
    'recipe.contains_part': 302, 'part.contained_in_recipe': 602,
};
for (const [id, rootId] of Object.entries(emptyRoots)) {
    test(`ONT-P2 verified empty requires existing root and complete source: ${id}`, () => {
        const { db, resolve } = fixture();
        try {
            const result = resolve(request(relation(id), rootId));
            assert.equal(result.success, true, JSON.stringify(result));
            assert.equal(result.status, 'VERIFIED_EMPTY');
            assert.equal(result.totalCount, 0);
            assert.equal(result.complete, true);
            assert.deepEqual(result.items, []);
            assert.ok(result.provenance.queryId);
        } finally { db.close(); }
    });
}

test('ONT-P2 nullable legacy customer ID and non-null quotation FK do not fabricate empty', () => {
    const { db, resolve } = fixture();
    try {
        db.exec('UPDATE orders SET customer_id=NULL WHERE id=101');
        assert.equal(resolve(request(relation('order.belongs_to_customer'))).status, 'REFERENCE_INCOMPLETE');
        assert.equal(resolve(request(relation('customer.has_order'))).status, 'REFERENCE_INCOMPLETE');
        db.exec("UPDATE customers SET deleted_at='2026-09-18' WHERE id=1");
        assert.equal(resolve(request(relation('quotation.belongs_to_customer'))).status, 'RELATION_UNAVAILABLE');
    } finally { db.close(); }
});

const malformed = [
    ['version', q => { q.ontologyVersion = 2; }],
    ['unknown relation', q => { q.relationId = 'made.up'; }],
    ['C candidate', q => { q.relationId = 'legacy.bom_part_model'; }],
    ['D relation', q => { q.relationId = 'knowledge.semantic_recipe'; }],
    ['E relation', q => { q.relationId = 'recipe.inferred_part'; }],
    ['wrong type', q => { q.root.entityType = 'supplier'; }],
    ['display name', q => { q.root.canonicalId = '配方甲'; }],
    ['numeric ID coercion', q => { q.root.canonicalId = 301; }],
    ['leading zero', q => { q.root.canonicalId = '0301'; }],
    ['negative ID', q => { q.root.canonicalId = '-1'; }],
    ['unsafe ID', q => { q.root.canonicalId = '9007199254740992'; }],
    ['memory', q => { q.memory = '配方甲'; }],
    ['SQL', q => { q.sql = 'DELETE FROM recipes'; }],
    ['custom authority', q => { q.authority = 'SEMANTIC'; }],
    ['two-hop', q => { q.hops = 2; }],
    ['caller policy override', q => { q.canonicalOnly = false; }],
    ['invalid bound', q => { q.pageSize = 51; }],
    ['NaN bound', q => { q.pageSize = NaN; }],
    ['zero bound', q => { q.pageSize = 0; }],
    ['invalid cursor', q => { q.afterId = 'next'; }],
];
for (const [name, mutate] of malformed) {
    test(`ONT-P2 rejects ${name} before DB access`, () => {
        const db = { prepare() { throw Error('DB accessed'); }, transaction() { throw Error('DB accessed'); } };
        const resolve = createOntologyRelationResolver({ db }).resolveRelation;
        const q = request(relation('recipe.contains_part'));
        mutate(q);
        assert.equal(resolve(q).status, 'INVALID_REQUEST');
        assert.equal(resolve(q).success, false);
    });
}

test('ONT-P2 canonical BOM ID survives display rename; default relationRead behavior remains unchanged', () => {
    const { db, resolve } = fixture();
    const legacy = require('../api/services/relationReadService.cjs').createRelationReadService({ db });
    try {
        db.exec("UPDATE parts SET model='零件新名' WHERE id=601");
        const result = resolve(request(relation('recipe.contains_part')));
        assert.equal(result.success, true);
        assert.deepEqual(result.items[0], { entityType: 'part', canonicalId: '601', display: { name: '零件新名' } });
        assert.throws(() => legacy.read({ version: 1, relation: 'recipe.parts', rootId: 301 }), { code: 'RELATION_REFERENCE_CONFLICT' });
        assert.equal(resolve(request(relation('part.contained_in_recipe'))).success, true);
        db.prepare('UPDATE recipes SET parts_json=? WHERE id=301').run(JSON.stringify([{ model: '零件新名', supplier: '供应甲' }]));
        assert.equal(legacy.read({ version: 1, relation: 'recipe.parts', rootId: 301 }).items[0].canonicalId, '601');
        assert.equal(resolve(request(relation('recipe.contains_part'))).status, 'REFERENCE_INCOMPLETE');
        assert.equal(resolve(request(relation('part.contained_in_recipe'))).status, 'REFERENCE_INCOMPLETE');
    } finally { db.close(); }
});

for (const [name, line, expected] of [
    ['missing target', { partId: 999999, model: '零件甲' }, 'REFERENCE_INCOMPLETE'],
    ['ambiguous marker', { model: '零件甲', identityStatus: 'ambiguous' }, 'AMBIGUOUS_LEGACY_REFERENCE'],
    ['wrong supplier', { partId: 601, model: '旧名', supplier: '错误供应商' }, 'REFERENCE_INCOMPLETE'],
    ['malformed ID', { partId: true, model: '零件甲' }, 'REFERENCE_INCOMPLETE'],
]) {
    test(`ONT-P2 distinguishes ${name} without guessing`, () => {
        const { db, resolve } = fixture();
        try {
            db.prepare('UPDATE recipes SET parts_json=? WHERE id=301').run(JSON.stringify([line]));
            const before = changes(db), result = resolve(request(relation('recipe.contains_part')));
            assert.equal(result.status, expected);
            assert.equal(result.complete, false);
            assert.equal(result.success, false);
            assert.equal(changes(db), before);
        } finally { db.close(); }
    });
}

test('ONT-P2 snapshot memberships deduplicate IDs, exclude non-part roles, and never adopt current configuration', () => {
    const { db, resolve } = fixture();
    try {
        db.prepare('UPDATE recipes SET parts_json=? WHERE id=301').run(JSON.stringify([{ partId: 601 }, { partId: 601 }, { name: '线圈转子', coilId: 501 }, { costSource: 'manual', name: '加工费' }]));
        const result = resolve(request(relation('recipe.contains_part')));
        assert.equal(result.success, true, JSON.stringify(result));
        assert.equal(result.totalCount, 1);
        assert.equal(result.items[0].canonicalId, '601');
        assert.match(result.provenance.currentVsSnapshotSemantics, /SAVED_MEMBERSHIP/);
        db.prepare('UPDATE orders SET items_json=? WHERE id=101').run(JSON.stringify([{ recipeId: 301, recipeName: '旧配方名' }, { recipeId: 301 }]));
        assert.equal(resolve(request(relation('order.contains_recipe'))).totalCount, 1);
        db.prepare('UPDATE orders SET items_json=? WHERE id=101').run(JSON.stringify([{ recipeName: '配方甲' }]));
        assert.equal(resolve(request(relation('order.contains_recipe'))).status, 'REFERENCE_INCOMPLETE');
        assert.equal(resolve(request(relation('recipe.contained_in_order'))).status, 'REFERENCE_INCOMPLETE');
    } finally { db.close(); }
});

test('ONT-P2 bounded pages preserve totals, cursors, and page exhaustion is not verified absence', () => {
    const { db, resolve } = fixture();
    try {
        for (let id = 800; id < 863; id++) db.prepare('INSERT INTO quotations(id,customer_id,status) VALUES(?,1,?)').run(id, '报价中');
        const definition = relation('customer.has_quotation'), q = request(definition, 1, { pageSize: 50 });
        const first = resolve(q), second = resolve({ ...q, afterId: first.pageBoundary.nextAfterId });
        assert.equal(first.returnedCount, 50);
        assert.equal(first.totalCount, 64);
        assert.equal(first.hasMore, true);
        assert.equal(second.returnedCount, 14);
        assert.equal(second.hasMore, false);
        assert.equal(new Set([...first.items, ...second.items].map(i => i.canonicalId)).size, 64);
        const exhausted = resolve({ ...q, afterId: '1' });
        assert.equal(exhausted.status, 'RESOLVED');
        assert.equal(exhausted.totalCount, 64);
        assert.equal(exhausted.items.length, 0);
        assert.equal(resolve(request(relation('recipe.uses_coil'), 301, { afterId: '1' })).status, 'INVALID_REQUEST');
        const native = resolve(request(relation('customer.has_order'), 1, { pageSize: 1 }));
        assert.equal(native.hasMore, true);
        assert.equal(resolve(request(relation('customer.has_order'), 1, { pageSize: 1, afterId: native.pageBoundary.nextAfterId })).items[0].canonicalId, '101');
    } finally { db.close(); }
});

test('ONT-P2 malformed snapshot, nested overflow, and scan overflow are unavailable, never empty', () => {
    const { db, resolve } = fixture();
    try {
        db.exec("UPDATE orders SET items_json='{broken' WHERE id=101");
        assert.equal(resolve(request(relation('order.contains_recipe'))).status, 'RELATION_UNAVAILABLE');
        db.prepare('UPDATE orders SET items_json=? WHERE id=101').run(JSON.stringify(Array.from({ length: R.NESTED_LIMIT + 1 }, () => ({ recipeId: 301 }))));
        assert.equal(resolve(request(relation('order.contains_recipe'))).status, 'RELATION_UNAVAILABLE');
        db.exec("UPDATE orders SET items_json='[]' WHERE id=101");
        for (let id = 1000; id < 1512; id++) db.prepare('INSERT INTO orders(id,contract_no,customer_id,customer_name,items_json) VALUES(?,?,1,?,?)').run(id, `ORD-${id}`, '客户甲', '[]');
        assert.equal(resolve(request(relation('recipe.contained_in_order'))).status, 'RELATION_UNAVAILABLE');
    } finally { db.close(); }
});

test('ONT-P2 saved-membership and native BOM pages use canonical IDs and shared page boundaries', () => {
    const { db, resolve } = fixture();
    try {
        const lines = [], parts = [];
        for (let id = 1000; id < 1050; id++) {
            db.prepare('INSERT INTO recipes(id,name,parts_json) VALUES(?,?,?)').run(id, `配方-${id}`, '[]');
            db.prepare('INSERT INTO parts(id,model,supplier) VALUES(?,?,?)').run(id, `零件-${id}`, '供应甲');
            lines.push({ recipeId: id }); parts.push({ partId: id });
        }
        db.prepare('UPDATE orders SET items_json=? WHERE id=101').run(JSON.stringify(lines));
        db.prepare('UPDATE recipes SET parts_json=? WHERE id=301').run(JSON.stringify(parts));
        for (const id of ['order.contains_recipe', 'recipe.contains_part']) {
            const q = request(relation(id)), collected = [];
            let page = resolve(q);
            assert.equal(page.returnedCount, 20);
            for (;;) {
                assert.equal(page.success, true, JSON.stringify(page));
                assert.equal(page.totalCount, 50);
                collected.push(...page.items.map(item => item.canonicalId));
                if (!page.hasMore) break;
                page = resolve({ ...q, afterId: page.pageBoundary.nextAfterId });
            }
            assert.equal(new Set(collected).size, 50);
            assert.equal(collected[0], '1049');
            assert.equal(collected.at(-1), '1000');
        }
    } finally { db.close(); }
});

test('ONT-P2 all directional readers run on a physically read-only database', () => {
    const { db } = fixture();
    const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ont-p2-readonly-'));
    const file = path.join(dir, 'fixture.db');
    fs.writeFileSync(file, db.serialize());
    db.close();
    const readonly = new Database(file, { readonly: true, fileMustExist: true });
    try {
        const before = readonly.serialize(), count = changes(readonly);
        const resolve = createOntologyRelationResolver({ db: readonly }).resolveRelation;
        for (const definition of ontology.relations) {
            assert.equal(resolve(request(definition)).success, true, definition.relationId);
        }
        assert.equal(changes(readonly), count);
        assert.deepEqual(readonly.serialize(), before);
    } finally {
        readonly.close();
        for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name));
        fs.rmdirSync(dir);
    }
});

test('ONT-P2 technical error is redacted and cannot become an empty observation', () => {
    const { db, resolve } = fixture();
    db.close();
    const result = resolve(request(relation('recipe.uses_coil')));
    assert.equal(result.status, 'TECHNICAL_FAILURE');
    assert.equal(result.code, 'RELATION_TECHNICAL_FAILURE');
    assert.equal(result.complete, false);
    assert.doesNotMatch(JSON.stringify(result), /database connection|SELECT|stack/);
});

test('ONT-P2 result validator rejects forged provenance, types, identities and byte overflow', () => {
    const { db, resolve } = fixture();
    try {
        const q = request(relation('recipe.uses_coil')), result = resolve(q);
        for (const mutate of [
            r => { r.provenance.physicalSource = 'assistant memory'; },
            r => { r.provenance.canonicalOnly = false; },
            r => { r.provenance.sourceService = 'unregistered-reader'; },
            r => { r.authority = 'LEGACY_EXACT'; },
            r => { r.items[0].entityType = 'part'; },
            r => { r.items[0].canonicalId = '线圈甲'; },
            r => { r.asOf = 'not a date'; },
            r => { r.complete = false; },
            r => { r.provenance.queryId = 'x'.repeat(R.MAX_RESULT_BYTES); },
        ]) {
            const altered = structuredClone(result);
            mutate(altered);
            assert.throws(() => R.validateResolveResult(q, altered));
        }
    } finally { db.close(); }
});

test('ONT-P2 no production chat, tool, MCP, HTTP, schema or dependency exposure', () => {
    const root = path.resolve(__dirname, '..');
    for (const file of ['api.cjs', 'api/routes/ai/chat.cjs', 'api/services/aiTaskControllerV2.cjs', 'api/routes/ai/executor.cjs', 'api/routes/ai/tools.cjs', 'api/capabilities/registry.cjs']) {
        assert.doesNotMatch(fs.readFileSync(path.join(root, file), 'utf8'), /ontology\/(?:resolver|resolverContract)|canonicalRelationQueries/);
    }
    assert.equal(ontology.runtimeEnabled, false);
    assert.ok(ontology.relations.every(r => r.runtimeEnabled === false));
    assert.equal(R.DEFAULT_PAGE_SIZE, 20);
    assert.equal(R.MAX_PAGE_SIZE, 50);
    assert.equal(R.MAX_RESULT_BYTES, 256 * 1024);
});
