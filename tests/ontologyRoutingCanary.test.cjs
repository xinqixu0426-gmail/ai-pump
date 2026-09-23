'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { artifactHash, loadFrozenHistoryManifest, sha256Normalized } = require('./helpers/frozenHistoryManifest.cjs');
const router = require('../api/ontology/relationRoutingCanary.cjs');
const { cases, negativeClasses, seedResults, runCase } = require('./helpers/ontologyRoutingCorpus.cjs');
// ONT-P8L: V1 stays as the historical P6/P7 frozen baseline and is never overwritten; V2 is the current
// official legacy baseline after the sanctioned Legacy relation-repair bugfix.
const oracle = require('./fixtures/ontology-coil-recipe-legacy-oracle-v4.json');
const historicalOracle = require('./fixtures/ontology-coil-recipe-legacy-oracle-v1.json');
const historicalOracleV2 = require('./fixtures/ontology-coil-recipe-legacy-oracle-v2.json');
const historicalOracleV3 = require('./fixtures/ontology-coil-recipe-legacy-oracle-v3.json');
const { runAiAssistant, assistantReadTools } = require('../api/services/aiAssistantRuntime.cjs');
const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
const { verifiedRows } = require('../api/ontology/relationBinder.cjs');
const { prepareRouting } = router;
const inputFor = c => ({ userText: c.userText, env: { AI_PROVIDER: 'local' }, shortlistEnabled: true, tools: assistantReadTools(),
    trustedToolResults: seedResults(c), subject: 'test-owner', conversationId: 'test',
    trustedSession: { subject: 'test-owner', conversationId: 'test', observedAt: Date.now(), toolResults: seedResults(c) } });
/**
 * ON no longer mirrors OFF's model-driven sequencing: for an eligible positive request the canary
 * plans its required formal reads in software before the first model call, so the ordered call list
 * legitimately differs, and it may legitimately perform extra formal reads that legacy did not make
 * (guaranteeing evidence is the point). The invariants that must still hold are that ontology adds no
 * provider call, executes only capabilities the profile itself sanctions, and yields the same answer.
 * Non-eligible requests keep the unchanged legacy path and must still match exactly.
 */
const sanctionedCapabilities = new Set(router.requiredReads.map(read => read.capability)
    .concat(router.profiles.flatMap(profile => profile.shortlist)));
/**
 * ONT-P8R: both the canary's inverse direction and the fixed legacy path now plan the bounded canonical
 * reverse read (`get_recipes_by_coil`). The frozen routing corpus stubs `executeToolCall` by tool name and
 * cannot know that tool, so every run here goes through `runRecordedCase`, which injects the shared
 * equivalent stub AND restores `executed`/`selectedTools` from its recorder. Without that restoration the
 * frozen signature would degrade to "nothing executed" and stop measuring anything. The frozen corpus
 * file itself is unchanged.
 */
const { runRecordedCase } = require('./helpers/ontologyShadowFixture.cjs');
const runBoth = (c, flag, options) => runRecordedCase(c, flag, runAiAssistant, runCase, options);
// 隐私断言只看非数值内容：时长等毫秒数字的片段可能与实体 ID 相同，不构成隐私泄露。
const privacySurface = captured => JSON.stringify(captured, (key, value) => (
    typeof value === 'number' ? '<number>' : value
));
function assertOntologyEquivalence(on, off, c) {
    if (c.category === 'negative') {
        // Non-eligible requests must take the unchanged legacy path on both sides.
        assert.deepEqual(on.signature, off.signature);
        return;
    }
    assert.ok(on.signature.modelCalls <= off.signature.modelCalls,
        `ontology must not add provider calls (on=${on.signature.modelCalls} off=${off.signature.modelCalls})`);
    assert.ok(on.signature.executed.length > 0, 'the canary must execute its planned reads in software');
    for (const entry of [...on.signature.executed, ...off.signature.executed]) {
        assert.ok(sanctionedCapabilities.has(entry.name), `unexpected relation tool ${entry.name}`);
    }
    assert.deepEqual(on.signature.finalContent, off.signature.finalContent);
}
for (const c of cases) {
    test(`P6R semantic boundary and frozen OFF/ON ${c.caseId}`, async () => {
        const state = prepareRouting(inputFor(c));
        assert.equal(state.record.semanticClass, c.category === 'positive' ? 'PURE_RELATION_QUERY' : negativeClasses[c.caseId]);
        assert.equal(state.record.eligible, c.category === 'positive');
        const off = await runBoth(c, 'false');
        assert.deepEqual(off.signature, oracle.cases.find(r => r.caseId === c.caseId && r).signature ||
            Object.fromEntries(Object.entries(oracle.cases.find(r => r.caseId === c.caseId)).filter(([key]) => key !== 'caseId')));
        const on = await runBoth(c, 'true', { forbidLegacy: c.category === 'positive' });
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
test('P6R default/OFF retains the repaired legacy relation sequence with explicit legacy marker', async () => {
    const c = cases[0];
    for (const flag of [undefined, 'false', '0', 'off']) {
        const r = await runBoth(c, flag);
        assert.equal(r.records.length, 1); assert.equal(r.records[0].canaryEnabled, false);
        assert.equal(r.records[0].routingSource, 'LEGACY_RELATION_SPECIAL_CASE');
        assert.ok(r.legacyDetectorCalls > 0);
        // ONT-P8L: the legacy REPAIR no longer demands the whole-recipe aggregate — it plans the bounded
        // two-step read instead, which is asserted here by its presence in the executed sequence. Whether
        // `get_all_recipes` also appears is the MODEL's own choice: the legacy relation shortlist was left
        // untouched (see the ONT-P8L finding recorded in the migration doc), so it must not be asserted
        // away here or this test would be claiming a change that was deliberately reverted.
        assert.ok(r.signature.selectedTools.includes('get_recipes_by_coil'),
            'the legacy relation path must use the bounded reverse read');
        assert.ok(r.signature.selectedTools.includes('search_coils'));
    }
});
/**
 * ONT-P8L evidence chain: the historical baseline must remain readable next to the new one, so a later
 * reader can tell "why the old legacy was wrong" apart from "what changed". V1 is therefore asserted to
 * still exist with its recorded aggregate-reading sequence, and V2 must differ from it ONLY by the
 * sanctioned bounded read replacing that aggregate.
 */
test('P8L the historical legacy oracle V1 is preserved and differs from the current oracle only by sanctioned bugfixes', () => {
    assert.equal(historicalOracle.version ?? 1, 1);
    // 当前 oracle 是 v4（Part 2 展示层规范化：金额表对象列用业务对象名）。
    // v1/v2/v3 都是历史证据，不再原地改写；版本链必须始终可追。
    assert.equal(oracle.version, 4);
    assert.equal(oracle.supersedes, 'ontology-coil-recipe-legacy-oracle-v3.json');
    assert.equal(historicalOracleV3.version, 3);
    assert.equal(historicalOracleV3.supersedes, 'ontology-coil-recipe-legacy-oracle-v2.json');
    assert.equal(historicalOracleV2.version, 2);
    assert.equal(historicalOracleV2.supersedes, 'ontology-coil-recipe-legacy-oracle-v1.json');
    assert.equal(historicalOracle.cases.length, oracle.cases.length);
    const aggregateCases = ['coil-short', 'coil-explicit'];
    for (const caseId of aggregateCases) {
        const before = historicalOracle.cases.find(entry => entry.caseId === caseId);
        const after = oracle.cases.find(entry => entry.caseId === caseId);
        assert.ok(before.selectedTools.includes('get_all_recipes'), `${caseId}: V1 must record the old aggregate read`);
        assert.equal(before.selectedTools.includes('get_recipes_by_coil'), false,
            `${caseId}: V1 must not know the bounded read (it predates ONT-P8R)`);
        // The sanctioned bugfix ADDS the bounded reverse read. The aggregate can still appear, because the
        // model may choose it from the untouched legacy shortlist — that residual is recorded, not hidden.
        assert.ok(after.selectedTools.includes('get_recipes_by_coil'), `${caseId}: V2 must use the bounded read`);
        // The bugfix must not have bought correctness with extra model rounds.
        assert.ok(after.modelCalls <= before.modelCalls, `${caseId}: provider calls must not increase (${before.modelCalls} -> ${after.modelCalls})`);
    }
});
test('P8L the historical V2/V3 oracles stay immutable and V4 differs from V3 only by the approved vocabulary delta', () => {
    // Supervisor Part 1-R1 / Part 2: 冻结语料的旧版本只增不改。
    // v2 必须仍然是「只有一张内部金额表」的历史事实 —— 否则以后无法证明
    // LEGACY-AI-ANSWER-001 曾经真实存在。
    for (const caseId of ['coil-cost', 'recipe-cost', 'cost-compare', 'mixed-cost-compare-relation']) {
        const v2 = historicalOracleV2.cases.find(entry => entry.caseId === caseId);
        const v3 = historicalOracleV3.cases.find(entry => entry.caseId === caseId);
        assert.ok(v2.finalContent.startsWith('本轮正式查询金额如下'),
            `${caseId}: V2 必须保留「只有金额表」的历史事实`);
        assert.equal(v2.finalContent.includes('已核实：'), false, `${caseId}: V2 不得含修复后的关系结论`);
        // V3 = 已验证的关系结论 + V2 原有的正式金额表，逐字节成立。
        assert.equal(v3.finalContent, `已核实：Shadow配方甲使用Shadow线圈甲（12-120）。\n\n${v2.finalContent}`,
            `${caseId}: V3 必须等于「关系结论 + V2 原金额表」`);
    }
    // V4 = V3 把工具显示名换成业务对象名（语料里两处），其余逐字节相同。
    // 这是 Part 2（LEGACY-AI-ANSWER-002）唯一允许的展示差异。
    const vocabularyDelta = [['| 计算线圈成本 |', '| 线圈成本 |'], ['| 配方成本试算 |', '| 配方成本 |']];
    for (const before of historicalOracleV3.cases) {
        const expected = vocabularyDelta.reduce(
            (text, [from, to]) => text.replaceAll(from, to),
            String(before.finalContent || ''),
        );
        const after = oracle.cases.find(entry => entry.caseId === before.caseId);
        assert.equal(after.finalContent, expected,
            `${before.caseId}: V4 只能有「工具显示名 → 业务对象名」这一处展示差异`);
        assert.equal(after.selectedTools.join(','), before.selectedTools.join(','), `${before.caseId}: 工具选择不得改变`);
        assert.equal(after.modelCalls, before.modelCalls, `${before.caseId}: provider 调用数不得改变`);
    }
    // 历史版本必须仍然保留「计算线圈成本」这个工具显示名 —— 证明规范化确实是新增的一层。
    assert.ok(historicalOracleV3.cases.find(entry => entry.caseId === 'coil-cost')
        .finalContent.includes('| 计算线圈成本 |'), 'V3 必须保留工具显示名（历史事实）');
    assert.equal(oracle.changeClass, 'APPROVED_INTENTIONAL_PRESENTATION_DELTA');
    assert.equal(oracle.changeReason, 'LEGACY-AI-ANSWER-002');
    assert.equal(historicalOracleV3.changeReason, 'LEGACY-AI-ANSWER-001');
    assert.deepEqual(oracle.historicalOraclesImmutable, [
        'ontology-coil-recipe-legacy-oracle-v1.json',
        'ontology-coil-recipe-legacy-oracle-v2.json',
        'ontology-coil-recipe-legacy-oracle-v3.json',
    ]);
    assert.deepEqual(oracle.versionHistory.map(entry => entry.version), [2, 3, 4]);
});
test('P8L-FINAL the recipe-rooted direction offers only bounded reads, never the whole catalogue', () => {    // Supervisor ruling ONT-P8L-FINAL: `recipe -> coil` must resolve through a bounded formal read. The
    // deterministic required read for that direction already returns the recipe's bound coil identity, so
    // the whole-catalogue read must not be offered on this direction at all.
    const profile = router.profiles[0];
    const offered = profile.shortlistByRelation['recipe.uses_coil'];
    assert.deepEqual(offered, ['get_recipe_detail', 'search_coils']);
    assert.equal(offered.includes('get_all_recipes'), false,
        'the recipe-rooted direction must not offer the whole-catalogue read');
    // The offered surface can never drift from the declared bounded reads of that direction. The
    // pre-binding identity read is deliberately NOT part of it: it runs in software before binding and
    // is never a tool the model can choose (ONT-P8L-FINAL Gate B).
    assert.deepEqual(offered, profile.requiredReadsByRelation['recipe.uses_coil']
        .filter(read => read.argumentPolicy !== 'pre_binding')
        .map(read => read.capability));
    assert.deepEqual(offered, router.requiredReadsFor({
        profile, binding: { relationId: 'recipe.uses_coil' },
    }).map(read => read.capability));
    assert.ok(profile.requiredReadsByRelation['recipe.uses_coil']
        .some(read => read.capability === 'resolve_recipe_identity' && read.argumentPolicy === 'pre_binding'),
    'the direction must declare its pre-binding root resolution read');
    assert.equal(offered.includes('resolve_recipe_identity'), false,
        'the pre-binding read must never be offered to the model');
    // The inverse direction is unchanged and still features its bounded reverse read first.
    assert.equal(profile.shortlistByRelation['coil.used_by_recipe'][0], 'get_recipes_by_coil');
    // Requesting the relation must therefore produce a tool list without the aggregate.
    const state = prepareRouting(inputFor(cases.find(c => c.root.entityType === 'recipe')));
    assert.equal(state.record.eligible, true);
    const names = state.tools.map(tool => tool.function.name);
    assert.equal(names.includes('get_all_recipes'), false, JSON.stringify(names));
    assert.ok(names.includes('get_recipe_detail'), JSON.stringify(names));
    // A capability that is still legitimately offered elsewhere must remain a registered read, so the
    // change narrowed the offered surface instead of disabling a capability.
    assert.ok(assistantReadTools().some(tool => tool.function.name === 'get_all_recipes'));
});
test('P8L-FINAL a detail receipt owns its single record even when the evidence also contains the list call', () => {
    // The `recipe -> coil` direction binds against verified recipe rows. The detail executor performs BOTH
    // calls (the list to resolve the name, then the single resource), so a receipt whose evidence contains
    // both must still own its record — keying ownership on the shape of the result discarded exactly those
    // rows and left the direction with nothing to bind, which is the ONT-P8L-FINAL binding-recall gap.
    const recipe = { id: 301, name: 'Shadow配方甲', coilId: 501 };
    const withBoth = (calls) => ({ success: true, recipe,
        executionEvidence: { verified: true, kind: 'formal_api_query', calls } });
    const bound = (calls) => verifiedRows([{ name: 'get_recipe_detail', result: withBoth(calls) }])
        .some(row => row.entityType === 'recipe' && row.canonicalId === '301');

    assert.equal(bound([{ method: 'GET', path: '/api/recipes' }, { method: 'GET', path: '/api/recipes/301' }]), true,
        'list + detail evidence must own the detailed record');
    assert.equal(bound([{ method: 'GET', path: '/api/recipes/301' }]), true, 'a plain detail read still owns its record');
    assert.equal(bound([{ method: 'GET', path: '/api/recipes?keyword=X' }]), false,
        'a collection read alone cannot own a single record read');
    assert.equal(bound([{ method: 'GET', path: '/api/recipes/999' }]), false,
        'a detail read of another record must never own this one');
    assert.equal(bound([{ method: 'GET', path: '/api/recipes' }, { method: 'POST', path: '/api/recipes/301' }]), false,
        'a non-GET call is not read provenance');
});
test('P6R/P7 provider/shortlist envelope, missing root, client context and expired owner context cannot route', async () => {
    const c = cases[0];
    // ONT-P7 promoted `deepseek` for this family; unvalidated providers stay outside.
    assert.equal(prepareRouting({ ...inputFor(c), env: { AI_PROVIDER: 'deepseek' } }).record.eligible, true);
    assert.equal(prepareRouting({ ...inputFor(c), env: { AI_PROVIDER: 'kimi' } }).record.eligible, false);
    assert.equal(prepareRouting({ ...inputFor(c), env: { AI_PROVIDER: 'local-first' } }).record.eligible, true);
    // The local shortlist is required only for the local providers; the promoted cloud provider is
    // eligible without it, which is exactly what production DeepSeek configures.
    assert.equal(prepareRouting({ ...inputFor(c), shortlistEnabled: false }).record.eligible, false);
    assert.equal(prepareRouting({ ...inputFor(c), env: { AI_PROVIDER: 'deepseek' }, shortlistEnabled: false }).record.eligible, true);
    // `auto` is resolved to the provider that will actually serve the request, so a promoted provider
    // configured as `auto` can still become eligible.
    assert.equal(prepareRouting({ ...inputFor(c), env: { AI_PROVIDER: 'auto', DEEPSEEK_API_KEY: 'probe' } }).record.eligible, true);
    assert.equal(prepareRouting({ ...inputFor(c), env: { AI_PROVIDER: 'auto', DEEPSEEK_API_KEY: 'probe' } }).record.providerMode, 'deepseek');
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
        assert.doesNotMatch(privacySurface(captured), /501|301|12-120|Shadow|canonicalId|userText|payload/);
    } finally { await o.resetObservabilityForTesting(); }
});
test('P6R no prompt, answer composer, binder, graph, tool catalog, schema or dependency changes', () => {
    const frozen = loadFrozenHistoryManifest(path.join(__dirname, 'fixtures', 'frozen-history', 'manifest-v1.json'));
    // ONT-P8R sanctions exactly one tool-catalog change: the bounded reverse read. It is verified below
    // as a pure single insertion so no other catalog edit, prompt edit or schema edit can hide in it.
    // ONT-P8L-FINAL sanctions exactly one binder change: per-record ownership (see the dedicated test
    // below), so `relationBinder.cjs` is no longer byte-frozen against the P6 baseline and is instead
    // covered by its own assertions plus the whole ontology suite.
    //
    // `bindingMetadata.cjs` carries the binding contract's provenance whitelist. ONT-P8L-FINAL also
    // sanctions exactly one addition there — the bounded identity read that resolves a relation root
    // BEFORE binding — so it is asserted as an exact single-entry addition instead of byte equality.
    const metadataNow = fs.readFileSync(path.resolve('api/ontology/bindingMetadata.cjs'), 'utf8').replace(/\r\n/g, '\n');
    const resourceNames = text => [...text.matchAll(/tool:\s*'([a-z0-9_]+)'/gu)].map(match => match[1]);
    const resourcesBefore = frozen.bindingResources;
    const resourcesNow = resourceNames(metadataNow);
    const addedIdentityReads = ['resolve_recipe_identity', 'resolve_part_identity'];
    assert.deepEqual(resourcesNow.filter(name => !resourcesBefore.includes(name)), addedIdentityReads,
        'only reviewed bounded identity reads may be added');
    assert.deepEqual(resourcesBefore.filter(name => !resourcesNow.includes(name)), [],
        'no existing provenance source may be removed');
    assert.deepEqual(resourcesNow.filter(name => !addedIdentityReads.includes(name)), resourcesBefore,
        'the existing provenance sources and their order must be unchanged');
    for (const file of ['api/services/aiCapabilityGraphV3.cjs',
        'api/services/aiAssistantAnswer.cjs', 'api/services/aiEvidenceBundle.cjs', 'api/services/aiResponsePresenter.cjs',
        'package-lock.json']) {
        assert.equal(sha256Normalized(fs.readFileSync(path.resolve(file), 'utf8')), artifactHash(frozen, file), `frozen content changed: ${file}`);
    }
    // The historical fixture protects dependencies, not the scripts catalogue.
    // N7.1 adds a release-gate script without changing any dependency or lock.
    const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
    const ordered = value => Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right)));
    const dependencySurface = JSON.stringify({ dependencies: ordered(pkg.dependencies), devDependencies: ordered(pkg.devDependencies),
        optionalDependencies: ordered(pkg.optionalDependencies), engines: ordered(pkg.engines), packageManager: pkg.packageManager || null });
    assert.equal(sha256Normalized(dependencySurface), frozen.packageDependencySurfaceSha256, 'frozen dependency surface changed');
    // ONT-P8R/P8L sanction exactly one tool-catalog change: the bounded reverse read (added, then narrowed
    // to a `coilId`-only schema). The name set is asserted exactly and in order, because catalog order
    // feeds the locally scored shortlist. Per-tool text equality for the pre-existing tools is covered by
    // the API-contract, capability-registry and MCP catalog suites, which all cross-check every tool.
    const normalize = value => value.replace(/\r\n/g, '\n');
    const namesOf = text => [...text.matchAll(/name:\s*'([a-z0-9_]+)'\s*,/gu)].map(match => match[1]);
    const namesBefore = frozen.toolNames;
    const namesNow = namesOf(normalize(fs.readFileSync(path.resolve('api/routes/ai/tools.cjs'), 'utf8')));
    const ADDED_TOOL = 'get_recipes_by_coil';
    const ADDED_TOOLS = [ADDED_TOOL, 'get_recipe_parts', 'get_recipes_by_part'];
    assert.deepEqual(namesNow.filter(name => !namesBefore.includes(name)), ADDED_TOOLS,
        'only reviewed bounded relation tools may be added');
    assert.deepEqual(namesBefore.filter(name => !namesNow.includes(name)), [], 'no existing tool may be removed');
    assert.deepEqual(namesNow.filter(name => !ADDED_TOOLS.includes(name)), namesBefore, 'the existing tool order must be unchanged');
    const bounded = require('../api/routes/ai/tools.cjs').AI_TOOLS.find(tool => tool.function.name === ADDED_TOOL);
    assert.deepEqual(Object.keys(bounded.function.parameters.properties), ['coilId'],
        'the bounded reverse read must expose no pagination control to the model');
    assert.deepEqual(bounded.function.parameters.required, ['coilId']);
    const runtime = fs.readFileSync(path.resolve('api/services/aiAssistantRuntime.cjs'), 'utf8');
    const promptPatterns = [[/const SYSTEM_PROMPT = `[\s\S]+?`;/u, 'systemPrompt'], [/const LOCAL_RESPONSE_PROMPT = '[^\n]+/u, 'localResponsePrompt']];
    for (const [pattern, name] of promptPatterns)
        assert.equal(sha256Normalized(runtime.match(pattern)[0].replace(/\r/g, '')), frozen.runtimePromptHashes[name], `frozen prompt changed: ${name}`);
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
        const off = await runBoth(cases[0], 'false');
        // ONT-P8R: all three runs go through the same extended executor stub so the comparison stays
        // apples-to-apples; the frozen corpus executor cannot know the bounded reverse read.
        const onBaseline = await runBoth(cases[0], 'true', { forbidLegacy: true });
        const on = await runBoth(cases[0], 'true', { forbidLegacy: true,
            env: { AI_ONTOLOGY_RELATION_SHADOW_ENABLED: 'true', AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED: 'true', AI_ONTOLOGY_2HOP_SHADOW_ENABLED: 'true' },
            dependencies: deps });
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
