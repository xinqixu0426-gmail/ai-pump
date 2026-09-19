'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { fixture, positives, negatives, verifiedTools } = require('./helpers/ontologyTraversalCorpus.cjs');
const { createOntologyRelationResolver } = require('../api/ontology/resolver.cjs');
const { createOntologyTraversal } = require('../api/ontology/traversal.cjs');
const { bindTraversal } = require('../api/ontology/traversalBinder.cjs');
const { validateTraversalRequest, validateTraversalResult, LIMITS } = require('../api/ontology/traversalContract.cjs');
const { observeTraversalShadow, resolveTraversalInWorker, currentTraversalFacts, compareTraversal } = require('../api/ontology/traversalShadow.cjs');
const { observeShadow } = require('../api/ontology/runtimeShadow.cjs');
const request = c => ({ ontologyVersion: 1, root: c.root, relationPath: c.relationPath });
const bind = (q, extra = {}) => bindTraversal({ ontologyVersion: 1, userText: q, verifiedToolResults: verifiedTools(), ...extra });
for (const c of positives) test(`P5 independent fixture oracle ${c.caseId}`, () => {
    const db = fixture();
    try {
        const bytes = db.serialize(), changes = db.prepare('SELECT total_changes() n').get().n;
        const binding = bind(c.question); assert.equal(binding.status, 'BOUND_2HOP', JSON.stringify(binding));
        assert.deepEqual(binding.root, c.root); assert.deepEqual(binding.relationPath, c.relationPath);
        const result = createOntologyTraversal({ resolver: createOntologyRelationResolver({ db }) }).traverse(request(c));
        assert.equal(result.status, 'COMPLETE', JSON.stringify(result)); assert.equal(result.complete, true);
        assert.deepEqual(result.targets.map(t => t.canonicalId).sort((a, b) => Number(a) - Number(b)), c.expected);
        assert.ok(Object.isFrozen(result)); validateTraversalResult(structuredClone(result));
        const current = currentTraversalFacts(binding, verifiedTools()); assert.equal(current.complete, true);
        assert.equal(compareTraversal(binding, current, result), 'MATCH');
        assert.deepEqual(db.serialize(), bytes); assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
    } finally { db.close(); }
});
for (const q of negatives) test(`P5 negative path binding: ${q}`, () => assert.notEqual(bind(q).status, 'BOUND_2HOP'));
const q = request(positives[6]);
for (const [label, changes] of [
    ['noncanonical root', { root: { entityType: 'customer', canonicalId: '客户甲' } }],
    ['wrong root type', { root: { entityType: 'part', canonicalId: '601' } }],
    ['unknown R1', { relationPath: ['unknown.edge', 'order.contains_recipe'] }],
    ['unknown R2', { relationPath: ['customer.has_order', 'unknown.edge'] }],
    ['C relation', { relationPath: ['legacy.bom_part_model', 'recipe.contained_in_order'] }],
    ['D relation', { relationPath: ['semantic.knowledge', 'order.contains_recipe'] }],
    ['E relation', { relationPath: ['inferred.similar', 'order.contains_recipe'] }],
    ['nonadjacent', { relationPath: ['customer.has_order', 'recipe.contains_part'] }],
    ['inverse loop', { relationPath: ['customer.has_order', 'order.belongs_to_customer'] }],
    ['one hop', { relationPath: ['customer.has_order'] }],
    ['three hop', { relationPath: ['customer.has_order', 'order.contains_recipe', 'recipe.contains_part'] }],
    ['multiple paths', { relationPath: [['customer.has_order', 'order.contains_recipe'], ['customer.has_quotation', 'quotation.belongs_to_customer']] }],
    ['unknown field', { maxHop: 100 }],
]) test(`P5 validates before reads: ${label}`, () => {
    let calls = 0; const result = createOntologyTraversal({ resolver: { resolveRelation: () => { calls++; } } }).traverse({ ...q, ...changes });
    assert.equal(result.status, 'PATH_INVALID'); assert.equal(calls, 0); assert.throws(() => validateTraversalRequest({ ...q, ...changes }));
});
test('P5 missing root and valid empty first hop remain distinct', () => {
    const db = fixture(); try {
        const t = createOntologyTraversal({ resolver: createOntologyRelationResolver({ db }) });
        assert.equal(t.traverse({ ...q, root: { entityType: 'customer', canonicalId: '999' } }).status, 'ROOT_NOT_FOUND');
        const c = positives[0], empty = t.traverse({ ...request(c), root: { entityType: 'part', canonicalId: '602' } });
        assert.equal(empty.status, 'COMPLETE'); assert.equal(empty.targetCount, 0); assert.equal(empty.budget.secondHopCalls, 0);
    } finally { db.close(); }
});
test('P5 dedupe preserves multiple canonical paths and excludes display fields', () => {
    const db = fixture(); try {
        const r = createOntologyTraversal({ resolver: createOntologyRelationResolver({ db }) }).traverse(request(positives[0]));
        assert.equal(r.targets.filter(t => t.canonicalId === '103').length, 1);
        assert.deepEqual(r.provenance.find(p => p.target.canonicalId === '103').paths.map(p => p.intermediate.canonicalId).sort(), ['301', '305']);
        assert.doesNotMatch(JSON.stringify(r), /Shadow|supplier|display|schemeName/);
        const forged = structuredClone(r); forged.targets[0].canonicalId = 'wrong'; assert.throws(() => validateTraversalResult(forged));
    } finally { db.close(); }
});
test('P5 intermediate failures are partial, never silently complete, including legacy ambiguity', () => {
    const db = fixture(); try {
        const actual = createOntologyRelationResolver({ db });
        for (const status of ['REFERENCE_INCOMPLETE', 'AMBIGUOUS_LEGACY_REFERENCE', 'RELATION_UNAVAILABLE', 'TECHNICAL_FAILURE']) {
            const resolver = { resolveRelation: input => input.relationId === 'recipe.contains_part' && input.root.canonicalId === '305'
                ? { success: false, status } : actual.resolveRelation(input) };
            const r = createOntologyTraversal({ resolver }).traverse(request(positives[8]));
            assert.equal(r.status, 'PARTIAL'); assert.equal(r.complete, false); assert.deepEqual(r.failedIntermediateIds, ['305']);
        }
        const all = createOntologyTraversal({ resolver: { resolveRelation: input => input.relationId === 'recipe.contains_part'
            ? { success: false, status: 'TECHNICAL_FAILURE' } : actual.resolveRelation(input) } }).traverse(request(positives[8]));
        assert.equal(all.status, 'UNAVAILABLE'); assert.equal(all.failedIntermediateIds.length, 2);
        db.prepare('UPDATE recipes SET parts_json=? WHERE id=305').run('[{"model":"旧零件"}]');
        const legacy = createOntologyTraversal({ resolver: actual }).traverse(request(positives[8]));
        assert.equal(legacy.status, 'PARTIAL'); assert.deepEqual(legacy.failedIntermediateIds, ['305']);
    } finally { db.close(); }
});
test('P5 first-hop pagination never means complete; resolver call fan-out stays bounded', () => {
    const db = fixture(); try {
        const insert = db.prepare('INSERT INTO orders(id,contract_no,customer_id,customer_name,items_json) VALUES(?,?,1,?,?)');
        for (let i = 200; i < 225; i++) insert.run(i, `BOUND-${i}`, 'Shadow客户甲', '[]');
        let secondCalls = 0; const actual = createOntologyRelationResolver({ db });
        const r = createOntologyTraversal({ resolver: { resolveRelation: input => { if (input.relationId === q.relationPath[1]) secondCalls++; return actual.resolveRelation(input); } } }).traverse(q);
        assert.equal(r.status, 'BUDGET_EXHAUSTED'); assert.equal(r.complete, false); assert.ok(r.warnings.includes('FIRST_HOP_TRUNCATED'));
        assert.equal(r.intermediateCount, 20); assert.equal(secondCalls, 20);
    } finally { db.close(); }
});
test('P5 second-hop pagination and aggregate final target cap remain incomplete', () => {
    const db = fixture(); try {
        const insert = db.prepare('INSERT INTO orders(id,contract_no,customer_id,customer_name,items_json) VALUES(?,?,1,?,?)');
        for (let i = 200; i < 255; i++) insert.run(i, `BOUND-${i}`, 'Shadow客户甲', '[{"recipeId":301}]');
        const r = createOntologyTraversal({ resolver: createOntologyRelationResolver({ db }) }).traverse(request(positives[0]));
        assert.equal(r.status, 'BUDGET_EXHAUSTED'); assert.ok(r.warnings.includes('SECOND_HOP_TRUNCATED'));
        assert.equal(r.targetCount, 50); assert.ok(r.failedIntermediateIds.length); assert.ok(r.budget.resultBytes <= LIMITS.maxResultBytes);
    } finally { db.close(); }
});
test('P5 pronoun context remains same owner/session and rejects ambiguous roots', () => {
    const tool = verifiedTools().find(t => t.name === 'search_customers');
    const trustedSession = { subject: 'owner', conversationId: 'chat', observedAt: Date.now(), toolResults: [tool] };
    const extra = { subject: 'owner', conversationId: 'chat', trustedSession };
    assert.equal(bind('这个客户都订了哪些产品？', extra).status, 'BOUND_2HOP');
    assert.notEqual(bind('这个客户都订了哪些产品？', { ...extra, subject: 'other' }).status, 'BOUND_2HOP');
    assert.notEqual(bind('这个客户都订了哪些产品？', { ...extra, trustedSession: { ...trustedSession, observedAt: 0 } }).status, 'BOUND_2HOP');
    const two = structuredClone(tool); two.result.data.push({ id: 2, name: '乙' }); two.result.count = 2;
    assert.equal(bind('这个客户都订了哪些产品？', { ...extra, trustedSession: { ...trustedSession, toolResults: [two] } }).status, 'AMBIGUOUS_PATH');
});
test('P5 multiple requested paths reject even if current tools only resolved one root', () => {
    const question = '用着Shadow零件甲的配方都在哪些订单里；SHADOW-103订的产品都用了哪些配件？';
    const onlyPart = verifiedTools().filter(t => t.name === 'search_parts');
    assert.equal(bind(question, { verifiedToolResults: onlyPart }).status, 'AMBIGUOUS_PATH');
    assert.equal(bind(question, { verifiedToolResults: [] }).status, 'AMBIGUOUS_PATH');
    assert.equal(bind('订单ID 103里的配方使用哪些零件；不存在的订单订的产品都配了哪些线圈？').status, 'AMBIGUOUS_PATH');
});
test('P5 current facts need all verified canonical hops, never prose or incomplete lists', () => {
    const b = bind(positives[0].question), tools = verifiedTools();
    assert.equal(currentTraversalFacts(b, tools).complete, true);
    assert.equal(currentTraversalFacts(b, tools.filter(t => t.name !== 'get_recent_orders')).complete, false);
    const filtered = structuredClone(tools); filtered.find(t => t.name === 'get_all_recipes').result.filters.keyword = '甲';
    assert.equal(currentTraversalFacts(b, filtered).complete, false);
});
test('P5 independent real readonly worker, timeout and fail-open sinks', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ont-p5-test-')), file = path.join(directory, 'test.db');
    try {
        fixture(file).close(); const before = fs.readFileSync(file);
        const r = await resolveTraversalInWorker(request(positives[0]), file); assert.equal(r.status, 'COMPLETE');
        assert.deepEqual(fs.readFileSync(file), before);
        const timed = await resolveTraversalInWorker(request(positives[0]), file, 1); assert.equal(timed, null);
        const observed = await observeTraversalShadow({ userText: positives[0].question, toolResults: verifiedTools() }, {
            databasePath: file, record: () => { throw Error('sink'); }, observeSpan: () => { throw Error('telemetry'); } });
        assert.equal(observed.comparison, 'MATCH');
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('P5 flags OFF or missing binding gate execute zero traversals and preserve one-hop result', async () => {
    let calls = 0; const deps = { traversal: { resolve: () => { calls++; }, record: () => { calls++; } } };
    for (const flags of [{}, { traversalEnabled: true }, { bindingEnabled: true }]) {
        const r = await observeShadow({ userText: positives[0].question, toolResults: verifiedTools(), ...flags }, deps);
        assert.equal(r.comparison.status, 'NOT_ELIGIBLE');
    }
    assert.equal(calls, 0);
});
test('P5 provenance expansion also obeys byte budget, even with only 50 deduped targets', () => {
    const db = fixture(); try {
        const actual = createOntologyRelationResolver({ db });
        const first = actual.resolveRelation({ ontologyVersion: 1, relationId: q.relationPath[0], root: q.root, pageSize: 20 });
        const second = actual.resolveRelation({ ontologyVersion: 1, relationId: q.relationPath[1], root: { entityType: 'order', canonicalId: '101' }, pageSize: 50 });
        const r = createOntologyTraversal({ resolver: { resolveRelation: input => {
            const out = structuredClone(input.relationId === q.relationPath[0] ? first : second);
            const n = input.relationId === q.relationPath[0] ? 20 : 50;
            out.root = input.root; out.provenance.root = input.root; out.totalCount = n; out.returnedCount = n;
            out.items = Array.from({ length: n }, (_, i) => ({ entityType: out.resultEntityType, canonicalId: String(1000 - i), display: { name: '相同显示名' } }));
            return out;
        } } }).traverse(q);
        assert.equal(r.status, 'BUDGET_EXHAUSTED'); assert.ok(r.warnings.includes('RESULT_BYTE_BUDGET'));
        assert.ok(r.budget.resultBytes <= LIMITS.maxResultBytes); assert.equal(r.budget.resultBytes, Buffer.byteLength(JSON.stringify(r)));
        assert.equal(r.targetCount, 50); assert.ok(r.failedIntermediateIds.length);
    } finally { db.close(); }
});
test('P5 rejects noncanonical resolver output instead of projecting its IDs', () => {
    const db = fixture(); try {
        const actual = createOntologyRelationResolver({ db });
        const r = createOntologyTraversal({ resolver: { resolveRelation: input => {
            const result = structuredClone(actual.resolveRelation(input)); result.items[0].canonicalId = 'model-generated-name'; return result;
        } } }).traverse(q);
        assert.equal(r.status, 'UNAVAILABLE'); assert.equal(r.targetCount, 0);
    } finally { db.close(); }
});
test('P5 real assistant OFF/ON equivalence with a bound, complete traversal and fail-open failures', async () => {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    const db = fixture();
    async function run(parent, binding, flag, failing = false) {
        const messages = [], exposure = [], executions = [], records = []; let modelCalls = 0, traversals = 0;
        const tools = verifiedTools();
        const result = await runAiAssistant({ messages: [{ role: 'user', content: positives[8].question }], requestId: 'p5-equivalence',
            env: { AI_ONTOLOGY_RELATION_SHADOW_ENABLED: parent, AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED: binding, AI_ONTOLOGY_2HOP_SHADOW_ENABLED: flag } }, {
            loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
            fetchAiProvider: async (m, o) => {
                messages.push(structuredClone(m)); exposure.push(structuredClone(o.tools)); modelCalls++;
                return { json: async () => ({ choices: [{ message: modelCalls === 1 ? { tool_calls: ['get_recent_orders', 'get_all_recipes'].map((name, i) => ({
                    id: `read-${i}`, type: 'function', function: { name, arguments: '{}' },
                })) } : { content: '已核实订单中的配方零件。' } }] }) };
            },
            executeToolCall: async (name, args, options) => { assert.equal(options.allowWrite, false); executions.push({ name, args }); return tools.find(t => t.name === name).result; },
            ontologyShadow: { traversal: { resolve: input => { traversals++; if (failing) throw Error('unavailable'); return createOntologyTraversal({ resolver: createOntologyRelationResolver({ db }) }).traverse(input); },
                observeSpan: () => { throw Error('exporter failed'); }, record: r => records.push(r) } },
        });
        await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
        return { result, messages, exposure, executions, records, modelCalls, traversals };
    }
    try {
        const off = await run('true', 'true', 'false'), on = await run('true', 'true', 'true');
        assert.equal(off.traversals, 0); assert.equal(on.traversals, 1); assert.equal(on.records[0].comparison, 'MATCH');
        for (const variant of [on, await run('true', 'true', 'true', true), await run('false', 'true', 'true'), await run('true', 'false', 'true')]) {
            assert.equal(variant.result.finalContent, off.result.finalContent); assert.deepEqual(variant.result.toolResults, off.result.toolResults);
            assert.deepEqual(variant.messages, off.messages); assert.deepEqual(variant.exposure, off.exposure);
            assert.deepEqual(variant.executions, off.executions); assert.equal(variant.modelCalls, off.modelCalls);
            assert.doesNotMatch(JSON.stringify(variant.messages), /relationPath|BOUND_2HOP|ontology_traversal|failedIntermediateIds/);
        }
    } finally { db.close(); }
});
test('P5 actual tracing exports only low-sensitive metadata and reports failed dispatch truthfully', async () => {
    const observability = require('../api/services/observability.cjs'), spans = [];
    const tracer = { startActiveSpan(name, options, work) {
        const span = { attributes: { ...options.attributes }, setAttribute(k, v) { this.attributes[k] = v; },
            setAttributes(values) { Object.assign(this.attributes, values); }, setStatus() {}, end() {} };
        spans.push({ name, span }); return work(span);
    } };
    observability.initializeObservability({ env: { AI_OBSERVABILITY_ENABLED: 'true' }, logger: { warn() {} },
        phoenixModule: { register: () => ({ getTracer: () => tracer, async shutdown() {} }) } });
    const db = fixture();
    try {
        const r = await observeTraversalShadow({ userText: positives[0].question, toolResults: verifiedTools() }, {
            resolve: input => createOntologyTraversal({ resolver: createOntologyRelationResolver({ db }) }).traverse(input) });
        assert.equal(r.comparison, 'MATCH'); assert.equal(spans[0].name, 'ontology_traversal_shadow');
        assert.equal(spans[0].span.attributes['pump.ai.ontology.traversal.hops'], 2);
        assert.equal(spans[0].span.attributes['pump.ai.ontology.traversal.status'], 'COMPLETE');
        assert.doesNotMatch(JSON.stringify(spans), /Shadow|canonicalId|targetIds|userText|601|103|supplier/);
        await observability.withOntologyTraversalSpan({ executed: true, binding: { status: 'BOUND_2HOP', pathId: 'part_recipe_order', root: { entityType: 'part' } }, traversal: null });
        assert.equal(spans[1].span.attributes['pump.ai.ontology.traversal.status'], 'TECHNICAL_FAILURE');
    } finally { db.close(); await observability.resetObservabilityForTesting(); }
});
