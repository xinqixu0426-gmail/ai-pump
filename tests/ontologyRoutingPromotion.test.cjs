'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { cases, runCase, seedResults } = require('./helpers/ontologyRoutingCorpus.cjs');
const router = require('../api/ontology/relationRoutingCanary.cjs');
const { prepareRouting, requiredReadCalls } = router;
const { runAiAssistant, assistantReadTools } = require('../api/services/aiAssistantRuntime.cjs');
const { isEnvFlagEnabled } = require('../api/services/environment.cjs');

/**
 * ONT-P7 — DeepSeek authoritative routing promotion.
 *
 * The promotion makes `deepseek` a production-eligible provider for the recipe↔coil family while the
 * flag stays default OFF, legacy code stays in place, and every fallback path still resolves to legacy.
 */
const positives = cases.filter(c => c.category === 'positive');
const routingInput = c => ({ userText: c.userText, env: { AI_PROVIDER: 'local' }, shortlistEnabled: true,
    tools: assistantReadTools(), trustedToolResults: seedResults(c), subject: 'p7-owner', conversationId: 'p7',
    trustedSession: { subject: 'p7-owner', conversationId: 'p7', observedAt: Date.now(), toolResults: seedResults(c) } });
const withProvider = (c, provider, extra = {}) => prepareRouting({ ...routingInput(c), env: { ...extra, AI_PROVIDER: provider } });

test('P7 promoted provider eligibility is exactly the validated set, and unvalidated providers stay out', () => {
    for (const profile of router.profiles) {
        assert.deepEqual(profile.providerModes, ['local', 'local-first', 'deepseek']);
        assert.equal(profile.providerModes.includes('kimi'), false);
        assert.equal(profile.providerModes.includes('auto'), false);
    }
});

test('P7 the canary flag is still default OFF in shipped configuration', () => {
    const example = fs.readFileSync(path.resolve('.env.example'), 'utf8');
    assert.match(example, /^AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=false$/mu);
    // An unset flag must read as disabled through the shared parser.
    assert.equal(isEnvFlagEnabled({}, 'AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED'), false);
});

test('P7 deepseek is eligible without the local shortlist; local providers still require it', () => {
    const c = positives[0];
    assert.equal(withProvider(c, 'deepseek').record.eligible, true);
    assert.equal(prepareRouting({ ...routingInput(c), env: { AI_PROVIDER: 'deepseek' }, shortlistEnabled: false }).record.eligible, true);
    for (const local of ['local', 'local-first']) {
        assert.equal(withProvider(c, local).record.eligible, true);
        assert.equal(prepareRouting({ ...routingInput(c), env: { AI_PROVIDER: local }, shortlistEnabled: false }).record.eligible, false,
            `${local} must still require the local shortlist`);
    }
    assert.equal(withProvider(c, 'kimi').record.eligible, false);
});

test('P7 `auto` resolves to the provider that will actually serve the request', () => {
    const c = positives[0];
    const state = withProvider(c, 'auto', { DEEPSEEK_API_KEY: 'probe' });
    assert.equal(state.record.providerMode, 'deepseek');
    assert.equal(state.record.eligible, true);
});

test('P7 fallback matrix: every non-eligible path resolves to legacy routing', async () => {
    const c = positives[0];

    // Flag OFF, whatever the provider.
    const off = await runCase(c, 'false', runAiAssistant, { mode: 'deepseek' });
    assert.equal(off.records[0].canaryEnabled, false);
    assert.notEqual(off.records[0].routingSource, 'ONTOLOGY_RELATION_BINDING');

    // No server-owned canonical receipt -> not eligible.
    const unseeded = await runCase(c, 'true', runAiAssistant, { mode: 'deepseek', seed: false });
    assert.equal(unseeded.records[0].eligible, false);
    assert.equal(unseeded.records[0].routingSource, 'CANARY_NOT_ELIGIBLE');

    // Ambiguous root -> not eligible.
    const ambiguous = cases.find(entry => entry.caseId === 'ambiguous-root');
    assert.equal(withProvider(ambiguous, 'deepseek').record.eligible, false);

    // Unsupported relation family (recipe->part) -> not eligible.
    const unsupported = withProvider({ userText: 'Shadow配方甲用了哪些零件？', root: { entityType: 'recipe', canonicalId: '301' } }, 'deepseek');
    assert.equal(unsupported.record.eligible, false);

    // Non-relation question -> not eligible.
    const cost = withProvider({ userText: '12-120线圈成本多少？', root: { entityType: 'coil', canonicalId: '501' } }, 'deepseek');
    assert.equal(cost.record.eligible, false);
    assert.equal(cost.record.routingSource, 'NON_RELATION_SPECIALIZED_PATH');
});

test('P7 an ontology-internal failure before the reads falls back to legacy, not to a guess', async () => {
    const c = positives[0];
    const off = await runCase(c, 'false', runAiAssistant, { mode: 'deepseek' });
    const fallback = await runCase(c, 'true', runAiAssistant, { mode: 'deepseek',
        routing: { validateProfile: () => { throw Error('technical failure'); } }, forbidLegacy: false });
    assert.equal(fallback.records[0].fallback, true);
    assert.equal(fallback.records[0].routingSource, 'ONTOLOGY_CANARY_FALLBACK');
    assert.deepEqual(fallback.signature.executed.map(entry => entry.name), off.signature.executed.map(entry => entry.name));
});

test('P7 eligible ON never double-runs legacy relation routing', async () => {
    for (const c of positives) {
        const on = await runCase(c, 'true', runAiAssistant, { mode: 'deepseek', forbidLegacy: true });
        assert.equal(on.records[0].routingSource, 'ONTOLOGY_RELATION_BINDING', c.caseId);
        assert.equal(on.legacyDetectorCalls, 0, `${c.caseId} used the legacy detector`);
        assert.equal(on.legacyRepairCalls, 0, `${c.caseId} used the legacy repair`);
        assert.equal(on.records[0].fallback, false);
    }
});

test('P7 a failing required formal query is never reported as a relational success', async () => {
    const c = positives[0];
    const result = await runCase(c, 'true', runAiAssistant, { mode: 'deepseek', forbidLegacy: true,
        dependencies: { executeToolCall: async () => ({ success: false, code: 'CONTROLLED_QUERY_FAILURE' }) } });
    // The deterministic reads were attempted, but none produced formal evidence.
    assert.equal(result.result.toolResults.length > 0, true);
    const verified = result.result.toolResults.filter(entry => entry.result?.executionEvidence?.verified === true);
    assert.equal(verified.length, 0);
    // Without formal evidence the canonical target must not be asserted as a fact.
    assert.equal(String(result.signature.finalContent || '').includes('301'), false);
});

test('P7 required reads are planned identically across promoted providers', () => {
    for (const provider of ['deepseek', 'local', 'local-first']) {
        for (const c of positives) {
            const state = withProvider(c, provider);
            const calls = requiredReadCalls(state, [], c.userText).map(call => call.function.name).sort();
            const expected = c.root.entityType === 'coil'
                ? ['get_all_recipes', 'search_coils'] : ['get_recipe_detail', 'search_coils'];
            assert.deepEqual(calls, [...expected].sort(), `${provider} ${c.caseId}`);
        }
    }
});
