'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cases, runCase, seedResults } = require('./helpers/ontologyRoutingCorpus.cjs');
const router = require('../api/ontology/relationRoutingCanary.cjs');
const { prepareRouting, requiredReadCalls } = router;
const { runAiAssistant, assistantReadTools } = require('../api/services/aiAssistantRuntime.cjs');
const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
const { getAiCapability } = require('../api/capabilities/registry.cjs');

/**
 * ONT-P6D-R1 — deterministic completion enforcement.
 *
 * The canary profile already knows which formal reads certify `recipe <-> coil` once P4 binding has
 * produced a canonical root and direction, so those reads are planned in software and executed before
 * the first provider call. The model is only asked to synthesise the answer, and the planned calls
 * still travel through the unchanged per-call guards (allowlist, schema, identifier grounding,
 * read-only executor, execution evidence).
 */
const positives = cases.filter(c => c.category === 'positive');
const routingInput = c => ({ userText: c.userText, env: { AI_PROVIDER: 'local' }, shortlistEnabled: true,
    tools: assistantReadTools(), trustedToolResults: seedResults(c), subject: 'p6dr1-owner', conversationId: 'p6dr1',
    trustedSession: { subject: 'p6dr1-owner', conversationId: 'p6dr1', observedAt: Date.now(), toolResults: seedResults(c) } });

test('P6D-R1 required reads are planned deterministically from verified context, not from user wording', () => {
    for (const c of positives) {
        const state = prepareRouting(routingInput(c));
        assert.equal(state.record.eligible, true, `eligible for ${c.caseId}`);
        const calls = requiredReadCalls(state, [], c.userText);
        assert.deepEqual(calls.map(call => call.function.name).sort(), ['get_all_recipes', 'search_coils'],
            `planned reads for ${c.caseId}`);
        const coilCall = calls.find(call => call.function.name === 'search_coils');
        const args = JSON.parse(coilCall.function.arguments);
        if (c.root.entityType === 'coil') {
            // The root's own identity read is derived from already-verified server context, so it is
            // planned even when the question carries no `规格-片数` shorthand.
            assert.ok(Object.keys(args).length > 0, `root identity read must be derivable for ${c.caseId}`);
        } else {
            // A recipe root cannot know the target coil's identity before reading the collection, so
            // the coil catalogue read is planned with no invented filter arguments.
            assert.deepEqual(args, {}, `recipe root must not invent coil filters for ${c.caseId}`);
        }
    }
});

test('P6D-R1 planned reads are strictly read-only query capabilities', () => {
    for (const entry of router.requiredReads) {
        const capability = getAiCapability(entry.capability);
        assert.equal(capability.access, 'read', `${entry.capability} must be a read capability`);
        assert.equal(capability.operation, 'query', `${entry.capability} must be a query capability`);
    }
});

test('P6D-R1 ontology adds no provider calls across the frozen positive corpus', async () => {
    for (const c of positives) {
        const off = await runCase(c, 'false', runAiAssistant);
        const on = await runCase(c, 'true', runAiAssistant, { forbidLegacy: true });
        assert.ok(on.signature.modelCalls <= off.signature.modelCalls,
            `${c.caseId}: ontology added provider calls (on=${on.signature.modelCalls} off=${off.signature.modelCalls})`);
        assert.equal(on.records[0].routingSource, 'ONTOLOGY_RELATION_BINDING');
        assert.equal(on.legacyDetectorCalls, 0); assert.equal(on.legacyRepairCalls, 0);
    }
});

test('P6D-R1 exact P6D regression: coil-explicit reaches the same canonical target as legacy', async () => {
    // In the P6D DeepSeek run this case produced `A canonical target = [301]` and `B canonical
    // target = []`. The expected value stays [301]; it must never be relaxed to match the bug.
    const c = cases.find(entry => entry.caseId === 'coil-explicit');
    const off = await runCase(c, 'false', runAiAssistant);
    const on = await runCase(c, 'true', runAiAssistant, { forbidLegacy: true });
    const state = prepareRouting(routingInput(c));
    const offFacts = currentFactsForBinding(state.binding, off.result.toolResults);
    const onFacts = currentFactsForBinding(state.binding, on.result.toolResults);
    assert.deepEqual(offFacts.canonicalTargetIds, ['301']);
    assert.deepEqual(onFacts.canonicalTargetIds, ['301']);
    assert.equal(onFacts.complete, true);
    assert.ok(on.signature.modelCalls <= off.signature.modelCalls);
    assert.deepEqual(on.signature.finalContent, off.signature.finalContent);
});

test('P6D-R1 the planned reads actually execute through the read-only executor and carry evidence', async () => {
    const c = positives[0];
    const on = await runCase(c, 'true', runAiAssistant, { forbidLegacy: true });
    const executedNames = on.result.toolResults.map(entry => entry.name);
    assert.ok(executedNames.includes('get_all_recipes'));
    assert.ok(executedNames.includes('search_coils'));
    for (const entry of on.result.toolResults) {
        assert.equal(entry.result?.success !== false, true);
        assert.equal(entry.result.executionEvidence?.verified, true);
        assert.equal(entry.result.executionEvidence.kind, 'formal_api_query');
    }
});

test('P8 a canary read the runtime cannot deliver revokes the canary and restores the legacy surface', async () => {
    // Real-sized databases make an unfiltered catalogue read exceed the per-result budget, so the
    // runtime returns AI_QUERY_RESULT_TOO_LARGE for it. A canary that cannot obtain its own evidence
    // must hand the turn back to legacy instead of constraining the model to its own profile.
    const c = positives[0];
    const on = await runCase(c, 'true', runAiAssistant, { mode: 'deepseek',
        dependencies: { executeToolCall: async name => (name === 'get_all_recipes'
            ? { success: false, code: 'AI_QUERY_RESULT_TOO_LARGE', error: 'CURRENT_TOO_LARGE' }
            : { success: true, count: 0, data: [], filters: { keyword: '', hasTechnicalFiles: null },
                executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils' }] } }) } });
    assert.equal(on.records[0].routingSource, 'ONTOLOGY_CANARY_FALLBACK');
    assert.equal(on.records[0].fallback, true);
    assert.equal(on.records[0].fallbackReason, 'AI_QUERY_RESULT_TOO_LARGE');
    assert.equal(on.records[0].eligible, true);
    // The read surface is handed back: the model is no longer limited to the two-tool canary profile.
    const firstCatalog = on.signature.catalogs[0] || [];
    assert.ok(firstCatalog.length > 2, `expected the legacy surface, got ${firstCatalog.length} tools`);
    assert.equal(typeof on.signature.finalContent, 'string');
});

test('P8 a revoked canary pre-read does not become an extra model planning round', async () => {
    const c = positives[0];
    const legacy = await runCase(c, 'false', runAiAssistant, { mode: 'deepseek' });
    const revoked = await runCase(c, 'true', runAiAssistant, { mode: 'deepseek',
        dependencies: { executeToolCall: async name => (name === 'get_all_recipes'
            ? { success: false, code: 'AI_QUERY_RESULT_TOO_LARGE', error: 'CURRENT_TOO_LARGE' }
            : { success: true, count: 0, data: [], filters: { keyword: '', hasTechnicalFiles: null },
                executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils' }] } }) } });
    assert.ok(revoked.signature.modelCalls <= legacy.signature.modelCalls + 1,
        `revoked canary added provider calls (${revoked.signature.modelCalls} vs legacy ${legacy.signature.modelCalls})`);
});
