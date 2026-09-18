'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ontology } = require('../api/ontology/contract.cjs');
const { compareShadow, statuses } = require('../api/ontology/shadowContract.cjs');
const { selectShadowContext } = require('../api/ontology/shadowEligibility.cjs');
const { observeShadow, resolveInWorker, MAX_HOP, MAX_SHADOW_RELATIONS_PER_REQUEST } = require('../api/ontology/runtimeShadow.cjs');
const { createOntologyRelationResolver } = require('../api/ontology/resolver.cjs');
const { fixture, canonicalRoots, formal, recipeDetail, deterministicCorpus } = require('./helpers/ontologyShadowFixture.cjs');
const context = (relationId = 'recipe.contains_part', type = 'recipe', root = 301, targets = ['601']) => ({
    relationId, root: { entityType: type, canonicalId: String(root) }, canonicalTargetIds: targets,
    canonical: true, complete: true, sourceCapabilities: ['get_recipe_detail'] });
const resolved = (c = context(), targets = c.canonicalTargetIds) => ({ success: true, status: 'RESOLVED',
    root: c.root, relationId: c.relationId, resultEntityType: ontology.relations.find(r => r.relationId === c.relationId).toType,
    items: targets.map(canonicalId => ({ canonicalId, entityType: ontology.relations.find(r => r.relationId === c.relationId).toType })),
    complete: true, hasMore: false });

test('P3 21-case runtime observation corpus records actual eligibility and never writes', async () => {
    const db = fixture(), records = [], corpus = deterministicCorpus();
    const before = db.serialize(), changes = db.prepare('SELECT total_changes() n').get().n;
    let reads = 0;
    try {
        const resolver = createOntologyRelationResolver({ db });
        for (const [caseId, userText, toolResults, expected] of corpus) {
            const r = await observeShadow({ userText, toolResults, requestId: `deterministic-${caseId}` }, {
                resolve: async c => { reads++; return resolver.resolveRelation({ ontologyVersion: 1, relationId: c.relationId, root: c.root, pageSize: 50 }); },
                record: r => records.push(r),
            });
            assert.equal(r.comparison.status, expected, caseId);
        }
        assert.equal(reads, 13);
        assert.equal(records.length, 21);
        assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
        assert.deepEqual(db.serialize(), before);
    } finally { db.close(); }
});

test('P3 ON not eligible performs no resolver read; omitted/default/OFF flag never touches shadow dependencies', async () => {
    let reads = 0;
    const record = await observeShadow({ toolResults: [] }, { resolve: () => { reads++; } });
    assert.equal(record.comparison.status, 'NOT_ELIGIBLE'); assert.equal(reads, 0);
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    for (const flag of [undefined, 'false', '0', 'off']) {
        let touched = false;
        const deps = { loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
            fetchAiProvider: async () => ({ json: async () => ({ choices: [{ message: { content: '你好' } }] }) }),
            get ontologyShadow() { touched = true; throw Error('Shadow should be unloaded'); },
        };
        await runAiAssistant({ messages: [{ role: 'user', content: '你好' }], env: { AI_ONTOLOGY_RELATION_SHADOW_ENABLED: flag } }, deps);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(touched, false);
    }
});

test('P3 existing privacy-filtered tracing captures metadata and survives a failing exporter', async () => {
    const o = require('../api/services/observability.cjs');
    const captured = [];
    const tracer = { startActiveSpan: async (name, options, operation) => {
        captured.push({ name, attributes: options.attributes });
        return operation({ setStatus() {}, end() { throw Error('exporter down'); } });
    } };
    try {
        o.initializeObservability({ env: { AI_OBSERVABILITY_ENABLED: 'true' }, logger: { warn() {} },
            phoenixModule: { register: () => ({ getTracer: () => tracer, shutdown: async () => {} }) } });
        const r = await observeShadow({ toolResults: [recipeDetail()], requestId: 'shadow-trace-id' }, { resolve: async () => resolved() });
        assert.equal(r.comparison.status, 'MATCH');
        assert.equal(captured[0].name, 'ontology_relation_shadow');
        assert.equal(captured[0].attributes['pump.ai.ontology.shadow.eligible'], true);
        assert.equal(captured[0].attributes['pump.ai.ontology.shadow.status'], 'MATCH');
        assert.equal(captured[0].attributes['pump.ai.ontology.shadow.exact_match'], true);
        assert.doesNotMatch(JSON.stringify(captured), /601|301|Shadow配方|canonicalTargetIds|canonicalId/);
    } finally { await o.resetObservabilityForTesting(); }
});

for (const definition of ontology.relations) {
    test(`P3 canonical comparison corpus populated ${definition.relationId}`, () => {
        const db = fixture();
        // Reverse part scanning correctly refuses unrelated legacy rows; use a clean canonical population here.
        db.prepare('DELETE FROM recipes WHERE id IN (303,304)').run();
        try {
            const c = context(definition.relationId, definition.fromType, canonicalRoots[definition.fromType],
                [String(canonicalRoots[definition.toType])]);
            if (definition.relationId === 'customer.has_order') c.canonicalTargetIds.push('102');
            const before = db.serialize(), changes = db.prepare('SELECT total_changes() n').get().n;
            const r = createOntologyRelationResolver({ db }).resolveRelation({ ontologyVersion: 1,
                relationId: c.relationId, root: c.root, pageSize: 50 });
            assert.equal(compareShadow(c, r).comparison.status, 'MATCH');
            assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
            assert.deepEqual(db.serialize(), before);
        } finally { db.close(); }
    });
}
for (const [label, c, mutate, expected] of [
    ['empty', context('recipe.contains_part', 'recipe', 302, []), () => {}, 'MATCH'],
    ['stale display', context(), () => {}, 'MATCH'],
    ['missing root', context('recipe.contains_part', 'recipe', 999), () => {}, 'ONTOLOGY_UNAVAILABLE'],
    ['legacy', context('recipe.contains_part', 'recipe', 303), () => {}, 'ONTOLOGY_INCOMPLETE'],
    ['ambiguity', context('recipe.contains_part', 'recipe', 304), () => {}, 'ONTOLOGY_INCOMPLETE'],
]) test(`P3 comparison corpus ${label}`, () => {
    const db = fixture();
    try {
        mutate(db);
        const r = createOntologyRelationResolver({ db }).resolveRelation({ ontologyVersion: 1, relationId: c.relationId, root: c.root });
        assert.equal(compareShadow(c, r).comparison.status, expected);
    } finally { db.close(); }
});

test('P3 every comparison status and mismatch classification is explicit', () => {
    const c = context(), r = resolved();
    const cases = [
        [c, r, 'MATCH'], [c, resolved(c, ['602']), 'MISMATCH'],
        [{ ...c, complete: false }, r, 'CURRENT_PATH_INCOMPLETE'],
        [{ ...c, canonical: false }, r, 'CURRENT_PATH_NOT_CANONICAL'],
        [c, { success: false, status: 'REFERENCE_INCOMPLETE' }, 'ONTOLOGY_INCOMPLETE'],
        [c, { success: false, status: 'RELATION_UNAVAILABLE' }, 'ONTOLOGY_UNAVAILABLE'],
        [{ ...c, root: { entityType: 'recipe', canonicalId: null } }, r, 'ROOT_IDENTITY_UNAVAILABLE'],
        [null, r, 'NOT_ELIGIBLE'], [c, undefined, 'TECHNICAL_FAILURE'],
    ];
    assert.deepEqual(new Set(cases.map(([a, b, expected]) => {
        const s = compareShadow(a, b).comparison.status; assert.equal(s, expected); return s;
    })), new Set(statuses));
    assert.deepEqual(compareShadow(c, resolved(c, ['602'])).comparison.classifications,
        ['TARGET_MISSING_IN_ONTOLOGY', 'TARGET_EXTRA_IN_ONTOLOGY']);
    assert.deepEqual(compareShadow(c, { ...r, complete: false }).comparison.classifications, ['COMPLETENESS_MISMATCH']);
    assert.deepEqual(compareShadow(c, { ...r, root: { ...r.root, canonicalId: '302' } }).comparison.classifications, ['ROOT_IDENTITY_MISMATCH']);
    assert.deepEqual(compareShadow(c, { ...r, relationId: 'recipe.uses_coil' }).comparison.classifications, ['RELATION_MAPPING_MISMATCH']);
    assert.equal(compareShadow(c, { ...r, hasMore: true }).comparison.status, 'ONTOLOGY_INCOMPLETE');
});
test('P3 canonical-only set comparison deduplicates and ignores display data; logs redact payload', () => {
    const c = { ...context(), canonicalTargetIds: ['601', '601'], rawReasoning: 'SECRET', password: 'SECRET' };
    const r = { ...resolved(), secret: 'SECRET', items: [{ entityType: 'part', canonicalId: '601', display: { name: 'SECRET' } }] };
    const record = compareShadow(c, r, { requestId: '客户手机号SECRET' });
    assert.equal(record.comparison.status, 'MATCH');
    assert.doesNotMatch(JSON.stringify(record), /SECRET|password|Reasoning|display/);
    assert.ok(Object.isFrozen(record.current));
    assert.equal(compareShadow({ ...c, canonicalTargetIds: ['0601'] }, r).comparison.status, 'CURRENT_PATH_NOT_CANONICAL');
});
test('P3 formal provenance is required; missing root and legacy targets fail closed', async () => {
    let reads = 0;
    assert.equal(selectShadowContext('', [{ ...recipeDetail(), result: { ...recipeDetail().result, executionEvidence: { verified: true, kind: 'formal_api_query' } } }]), null);
    const result = await observeShadow({ userText: '', toolResults: [recipeDetail(undefined, [{ model: 'legacy' }])] }, {
        resolve: async () => { reads++; return resolved(); }, record: () => { throw Error('trace down'); },
    });
    assert.equal(result.comparison.status, 'CURRENT_PATH_NOT_CANONICAL');
    assert.equal(reads, 1);
    const absent = recipeDetail(); absent.result.recipe.id = null;
    absent.result.executionEvidence.calls[0].path = '/api/recipes/null';
    assert.equal((await observeShadow({ toolResults: [absent] }, { resolve: () => { reads++; } })).comparison.status, 'ROOT_IDENTITY_UNAVAILABLE');
    assert.equal(reads, 1);
});
test('P3 budget is one stable formal relation; resolver exception and telemetry sink fail open', async () => {
    let reads = 0;
    const tools = [recipeDetail(), { name: 'get_quotation_detail', result: formal('/api/quotations/701', { quotation: { id: 701, customerId: 1 } }) }];
    const before = JSON.stringify(tools);
    const record = await observeShadow({ toolResults: tools }, { resolve: () => { reads++; throw Error('SECRET'); },
        observeSpan: () => { throw Error('Phoenix down'); }, record: () => { throw Error('sink down'); } });
    assert.equal(reads, 1); assert.equal(record.relationId, 'recipe.contains_part');
    assert.equal(record.comparison.status, 'TECHNICAL_FAILURE');
    assert.equal(JSON.stringify(tools), before);
    assert.equal(MAX_HOP, 1); assert.equal(MAX_SHADOW_RELATIONS_PER_REQUEST, 1);
});
test('P3 real worker reads physically readonly DB and independently terminates on timeout', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-shadow-'));
    const filename = path.join(directory, 'fixture.db'), db = fixture(filename);
    try {
        const before = db.serialize(), changes = db.prepare('SELECT total_changes() n').get().n;
        const r = await resolveInWorker(context(), filename);
        assert.equal(compareShadow(context(), r).comparison.status, 'MATCH');
        assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
        assert.deepEqual(db.serialize(), before);
        assert.equal((await resolveInWorker(context(), filename, 1)).code, 'SHADOW_TIMEOUT');
        assert.equal((await resolveInWorker(context(), path.join(directory, 'missing.db'))).status, 'TECHNICAL_FAILURE');
    } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('P3 real assistant OFF/ON has identical answer, provider messages/tools, calls, arguments and evidence', async () => {
    const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
    async function run(flag, failShadow = false, bindingFlag = 'false') {
        const messages = [], options = [], executions = [], records = [];
        let modelCalls = 0, reads = 0;
        const result = await runAiAssistant({ messages: [{ role: 'user', content: 'Shadow配方甲的配件明细有哪些？' }],
            requestId: 'shadow-equivalence', env: { AI_ONTOLOGY_RELATION_SHADOW_ENABLED: flag, AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED: bindingFlag } }, {
            loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
            fetchAiProvider: async (m, o) => {
                messages.push(structuredClone(m)); options.push(structuredClone(o.tools));
                modelCalls++;
                return { json: async () => ({ choices: [{ message: modelCalls === 1 ? { tool_calls: [{ id: 'detail', type: 'function',
                    function: { name: 'get_recipe_detail', arguments: '{"recipeName":"Shadow配方甲"}' } }] } : { content: '配方使用Shadow零件甲。' } }] }) };
            },
            executeToolCall: async (name, args, executionOptions) => {
                assert.equal(executionOptions.allowWrite, false);
                executions.push({ name, args }); return recipeDetail().result;
            },
            ontologyShadow: { resolve: async () => { reads++; if (failShadow) throw Error('Shadow unavailable'); return resolved(); }, record: r => records.push(r) },
        });
        await new Promise(resolve => setImmediate(resolve));
        await new Promise(resolve => setImmediate(resolve));
        return { result, messages, options, executions, modelCalls, reads, records };
    }
    const off = await run('false'), on = await run('true');
    assert.equal(off.reads, 0); assert.equal(off.records.length, 0);
    assert.equal(on.reads, 1); assert.equal(on.records[0].comparison.status, 'MATCH');
    assert.equal(off.result.finalContent, on.result.finalContent);
    assert.deepEqual(off.result.toolResults, on.result.toolResults);
    assert.deepEqual(off.messages, on.messages); assert.deepEqual(off.options, on.options);
    assert.deepEqual(off.executions, on.executions); assert.equal(off.modelCalls, on.modelCalls);
    assert.doesNotMatch(JSON.stringify(on.messages), /ontologyVersion|canonicalTargetIds|exactCanonicalMatch|ontology_relation_shadow/);
    const failed = await run('true', true);
    assert.equal(failed.records[0].comparison.status, 'TECHNICAL_FAILURE');
    assert.equal(failed.result.finalContent, off.result.finalContent);
    assert.deepEqual(failed.result.toolResults, off.result.toolResults);
    assert.deepEqual(failed.messages, off.messages); assert.deepEqual(failed.executions, off.executions);
    assert.equal(failed.modelCalls, off.modelCalls);
    const bindingOn = await run('true', false, 'true');
    assert.equal(bindingOn.result.finalContent, on.result.finalContent);
    assert.deepEqual(bindingOn.messages, on.messages); assert.deepEqual(bindingOn.options, on.options);
    assert.deepEqual(bindingOn.executions, on.executions); assert.deepEqual(bindingOn.result.toolResults, on.result.toolResults);
    assert.equal(bindingOn.modelCalls, on.modelCalls);
});
