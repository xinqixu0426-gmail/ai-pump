'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const router = require('../api/ontology/relationRoutingCanary.cjs');
const { cases, negativeClasses, seedResults, runCase } = require('./helpers/ontologyRoutingCorpus.cjs');
const oracle = require('./fixtures/ontology-coil-recipe-legacy-oracle-v1.json');
const { runAiAssistant, assistantReadTools } = require('../api/services/aiAssistantRuntime.cjs');
const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
const { prepareRouting } = router;
const inputFor = c => ({ userText: c.userText, env: { AI_PROVIDER: 'local' }, shortlistEnabled: true, tools: assistantReadTools(),
    trustedToolResults: seedResults(c), subject: 'test-owner', conversationId: 'test',
    trustedSession: { subject: 'test-owner', conversationId: 'test', observedAt: Date.now(), toolResults: seedResults(c) } });
/**
 * ON no longer mirrors OFF's model-driven sequencing: for an eligible positive request the canary
 * plans its required formal reads in software before the first model call, so the ordered call list
 * legitimately differs. The invariants that must still hold are that ontology adds no provider call,
 * executes only reads legacy also executes, and yields the same answer. Non-eligible requests keep
 * the unchanged legacy path and must still match exactly.
 */
function assertOntologyEquivalence(on, off, c) {
    if (c.category === 'negative') { assert.deepEqual(on.signature, off.signature); return; }
    assert.ok(on.signature.modelCalls <= off.signature.modelCalls,
        `ontology must not add provider calls (on=${on.signature.modelCalls} off=${off.signature.modelCalls})`);
    const offNames = off.signature.executed.map(entry => entry.name);
    for (const entry of on.signature.executed) assert.ok(offNames.includes(entry.name), `unexpected ontology tool ${entry.name}`);
    assert.deepEqual(on.signature.finalContent, off.signature.finalContent);
}
for (const c of cases) {
    test(`P6R semantic boundary and frozen OFF/ON ${c.caseId}`, async () => {
        const state = prepareRouting(inputFor(c));
        assert.equal(state.record.semanticClass, c.category === 'positive' ? 'PURE_RELATION_QUERY' : negativeClasses[c.caseId]);
        assert.equal(state.record.eligible, c.category === 'positive');
        const off = await runCase(c, 'false', runAiAssistant);
        assert.deepEqual(off.signature, oracle.cases.find(r => r.caseId === c.caseId && r).signature ||
            Object.fromEntries(Object.entries(oracle.cases.find(r => r.caseId === c.caseId)).filter(([key]) => key !== 'caseId')));
        const on = await runCase(c, 'true', runAiAssistant, { forbidLegacy: c.category === 'positive' });
        assertOntologyEquivalence(on, off, c);
        assert.equal(on.records.length, 1);
        assert.equal(on.records[0].fallback, false);
        if (c.category === 'positive') {
            assert.equal(on.records[0].routingSource, 'ONTOLOGY_RELATION_BINDING');
            assert.equal(on.legacyDetectorCalls, 0); assert.equal(on.legacyRepairCalls, 0);
            assert.deepEqual(state.binding.root, c.root); assert.equal(state.binding.relationId, c.relationId);
            const facts = currentFactsForBinding(state.binding, on.result.toolResults);
            assert.deepEqual(facts.canonicalTargetIds, c.root.entityType === 'coil' ? ['301'] : ['501']);
        } else assert.notEqual(on.records[0].routingSource, 'ONTOLOGY_RELATION_BINDING');
    });
}
test('P6R default/OFF retains legacy sequence and repair with explicit legacy marker', async () => {
    const c = cases[0];
    for (const flag of [undefined, 'false', '0', 'off']) {
        const r = await runCase(c, flag, runAiAssistant);
        assert.equal(r.records.length, 1); assert.equal(r.records[0].canaryEnabled, false);
        assert.equal(r.records[0].routingSource, 'LEGACY_RELATION_SPECIAL_CASE');
        assert.ok(r.legacyDetectorCalls > 0); assert.ok(r.legacyRepairCalls > 0);
        assert.deepEqual(r.signature.executed.map(t => t.name), ['get_all_recipes', 'search_coils']);
    }
});
test('P6R provider/shortlist envelope, missing root, client context and expired owner context cannot route', async () => {
    const c = cases[0];
    for (const mode of ['deepseek', 'kimi', 'auto']) assert.equal(prepareRouting({ ...inputFor(c), env: { AI_PROVIDER: mode } }).record.eligible, false);
    assert.equal(prepareRouting({ ...inputFor(c), env: { AI_PROVIDER: 'local-first' } }).record.eligible, true);
    assert.equal(prepareRouting({ ...inputFor(c), shortlistEnabled: false }).record.eligible, false);
    const fresh = await runCase(c, 'true', runAiAssistant, { seed: false });
    assert.equal(fresh.records[0].routingSource, 'CANARY_NOT_ELIGIBLE');
    const client = await runCase(c, 'true', runAiAssistant, { seed: false,
        // Public payloads cannot supply binding receipts to this private seam.
        input: { persistedConversationContext: { toolResults: seedResults(c) } } });
    assert.equal(client.records[0].eligible, false);
    const pronoun = cases.find(c => c.caseId === 'coil-pronoun');
    for (const trustedSession of [{ ...inputFor(pronoun).trustedSession, subject: 'other' },
        { ...inputFor(pronoun).trustedSession, observedAt: Date.now() - 16 * 60000 }])
        assert.equal(prepareRouting({ ...inputFor(pronoun), trustedSession }).record.eligible, false);
});
test('P6R internal profile failure falls back explicitly and telemetry exporter failure is fail-open', async () => {
    const c = cases[0], off = await runCase(c, 'false', runAiAssistant);
    const fallback = await runCase(c, 'true', runAiAssistant, { routing: { validateProfile: () => { throw Error('technical failure'); } } });
    assert.deepEqual(fallback.signature, off.signature);
    assert.equal(fallback.records[0].eligible, true); assert.equal(fallback.records[0].fallback, true);
    assert.equal(fallback.records[0].routingSource, 'ONTOLOGY_CANARY_FALLBACK');
    // A failing observation sink must not change the canary's own behaviour.
    const onOk = await runCase(c, 'true', runAiAssistant, { forbidLegacy: true });
    const r = await runCase(c, 'true', runAiAssistant, { forbidLegacy: true, record: () => { throw Error('sink down'); } });
    assert.deepEqual(r.signature, onOk.signature);
});
test('P6R routing telemetry is low-sensitive and survives a failing exporter', async () => {
    const o = require('../api/services/observability.cjs'), captured = [];
    try {
        o.initializeObservability({ env: { AI_OBSERVABILITY_ENABLED: 'true' }, logger: { warn() {} }, phoenixModule: { register: () => ({
            getTracer: () => ({ startActiveSpan: async (name, spec, operation) => { captured.push({ name, attributes: spec.attributes });
                return operation({ setStatus() {}, end() { throw Error('export down'); } }); } }), shutdown: async () => {} }) } });
        const state = prepareRouting(inputFor(cases[0])); await o.withOntologyRoutingSpan(state.record);
        assert.equal(captured[0].attributes['pump.ai.ontology.routing.source'], 'ONTOLOGY_RELATION_BINDING');
        assert.doesNotMatch(JSON.stringify(captured), /501|301|12-120|Shadow|canonicalId|userText|payload/);
    } finally { await o.resetObservabilityForTesting(); }
});
test('P6R no prompt, answer composer, binder, graph, tool catalog, schema or dependency changes', () => {
    const { execFileSync } = require('node:child_process');
    for (const file of ['api/ontology/relationBinder.cjs', 'api/ontology/bindingMetadata.cjs', 'api/services/aiCapabilityGraphV3.cjs',
        'api/services/aiAssistantAnswer.cjs', 'api/services/aiEvidenceBundle.cjs', 'api/services/aiResponsePresenter.cjs',
        'api/routes/ai/tools.cjs', 'package.json', 'package-lock.json']) {
        assert.equal(fs.readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n'), execFileSync('git', ['show', `${oracle.sourceCommit}:${file}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n'));
    }
    const runtime = fs.readFileSync(path.resolve('api/services/aiAssistantRuntime.cjs'), 'utf8');
    const previous = execFileSync('git', ['show', `${oracle.sourceCommit}:api/services/aiAssistantRuntime.cjs`], { encoding: 'utf8' });
    for (const pattern of [/const SYSTEM_PROMPT = `[\s\S]+?`;/u, /const LOCAL_RESPONSE_PROMPT = '[^\n]+/u])
        assert.equal(runtime.match(pattern)[0].replace(/\r/g, ''), previous.match(pattern)[0].replace(/\r/g, ''));
    assert.doesNotMatch(runtime, /ontology\/(?:resolver|traversal|bindingCurrentFacts)\.cjs/u);
});
test('P6R eligible requests never invoke either legacy shortlist or detector (isolated dependency trap)', () => {
    require('node:child_process').execFileSync(process.execPath, ['-e', `
        const s=require('./api/services/aiToolShortlist.cjs');
        s.selectLocalAssistantTools=()=>{throw Error('LEGACY_SHORTLIST_USED')};
        s.isCoilRecipeRelationQuery=()=>{throw Error('LEGACY_DETECTOR_USED')};
        const {runAiAssistant}=require('./api/services/aiAssistantRuntime.cjs');
        const {cases,runCase}=require('./tests/helpers/ontologyRoutingCorpus.cjs');
        (async()=>{for(const c of cases.filter(c=>c.category==='positive')){
            const r=await runCase(c,'true',runAiAssistant,{forbidLegacy:true});
            if(r.records[0].routingSource!=='ONTOLOGY_RELATION_BINDING')throw Error('FALSE_SOURCE');
        }})().catch(e=>{console.error(e);process.exitCode=1});
    `], { stdio: 'pipe' });
});
test('P6R default and local-first envelope preserve deterministic required read behavior', async () => {
    for (const c of cases) {
        const off = await runCase(c, 'false', runAiAssistant, { mode: 'local-first' });
        const on = await runCase(c, 'true', runAiAssistant, { mode: 'local-first', forbidLegacy: c.category === 'positive' });
        assertOntologyEquivalence(on, off, c);
        assert.equal(on.records[0].eligible, c.category === 'positive');
    }
});
test('P6R canary and P3/P4/P5 observers coexist without extra business calls, recursion or writes', async () => {
    const { fixture } = require('./helpers/ontologyShadowFixture.cjs');
    const { createOntologyRelationResolver } = require('../api/ontology/resolver.cjs');
    const db = fixture(); db.prepare('DELETE FROM recipes WHERE id IN (303,304)').run();
    const before = db.serialize(), changes = db.prepare('SELECT total_changes() n').get().n;
    try {
        let oneHop, traversal, binding, finish;
        const done = new Promise(resolve => { finish = resolve; });
        const resolver = createOntologyRelationResolver({ db });
        const deps = { ontologyShadow: { resolve: async c => resolver.resolveRelation({ ontologyVersion: 1, relationId: c.relationId, root: c.root, pageSize: 50 }),
            record: r => { oneHop = r; }, recordBinding: r => { binding = r; },
            traversal: { record: r => { traversal = r; finish(); } } } };
        const off = await runCase(cases[0], 'false', runAiAssistant);
        const onBaseline = await runCase(cases[0], 'true', runAiAssistant, { forbidLegacy: true });
        const on = await runCase(cases[0], 'true', runAiAssistant, { forbidLegacy: true,
            env: { AI_ONTOLOGY_RELATION_SHADOW_ENABLED: 'true', AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED: 'true', AI_ONTOLOGY_2HOP_SHADOW_ENABLED: 'true' }, dependencies: deps });
        await Promise.race([done, new Promise((_, reject) => { const timer = setTimeout(() => reject(Error('SHADOW_TIMEOUT')), 3000); timer.unref(); })]);
        assert.equal(oneHop.comparison.status, 'MATCH'); assert.equal(binding.status, 'BOUND');
        assert.equal(traversal.executed, false);
        // Enabling the P3/P4/P5 observers must not change the canary's own business calls.
        assert.deepEqual(on.signature, onBaseline.signature);
        assert.ok(onBaseline.signature.modelCalls <= off.signature.modelCalls);
        assert.deepEqual(db.serialize(), before); assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
    } finally { db.close(); }
});
test('P6R all eight pure positives preserve actual executor/API facts and evidence with zero DB writes', () => {
    require('node:child_process').execFileSync(process.execPath, [path.resolve('tests/helpers/runOntologyRoutingApiFixture.cjs')], { stdio: 'pipe', timeout: 30000 });
});
test('P6R feature flags use the single project parser and only a strict true enables the canary', async () => {
    const { isEnvFlagEnabled } = require('../api/services/environment.cjs');
    // The shared parser is the project convention and is shared with the existing MCP flags.
    assert.equal(require('../api/services/environment.cjs').isEnvFlagEnabled({ X: 'true' }, 'X'), true);
    for (const value of ['1', 'yes', 'on', 'TRUE ', 'true']) {
        assert.equal(isEnvFlagEnabled({ X: value }, 'X'), value.trim().toLowerCase() === 'true', `parser mismatch for ${JSON.stringify(value)}`);
    }
    // A canary flag value that only the old private list accepted must not enable routing.
    for (const flag of ['1', 'yes', 'on']) {
        const r = await runCase(cases[0], flag, runAiAssistant);
        assert.equal(r.records[0].canaryEnabled, false, `canary must stay OFF for ${flag}`);
        assert.equal(r.records[0].routingSource, 'LEGACY_RELATION_SPECIAL_CASE');
    }
    // The runtime must not reintroduce a private accepted-value list.
    const runtime = fs.readFileSync(path.resolve('api/services/aiAssistantRuntime.cjs'), 'utf8');
    assert.match(runtime, /isEnvFlagEnabled\(/u);
    assert.doesNotMatch(runtime, /\['1',\s*'true',\s*'yes',\s*'on'\]/u);
    assert.doesNotMatch(runtime, /AI_ONTOLOGY_[A-Z0-9_]+[^\n]*\)\s*\.trim\(\)\s*\.toLowerCase\(\)\s*===\s*'true'/u);
});
