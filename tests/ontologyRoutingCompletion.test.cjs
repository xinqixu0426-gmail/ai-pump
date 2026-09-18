'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { cases, runCase, seedResults } = require('./helpers/ontologyRoutingCorpus.cjs');
const router = require('../api/ontology/relationRoutingCanary.cjs');
const { prepareRouting, requiredReadCalls } = router;
const { runAiAssistant, assistantReadTools } = require('../api/services/aiAssistantRuntime.cjs');
const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
const { getAiCapability } = require('../api/capabilities/registry.cjs');
const { routingExecuteToolCall, runRecordedCase } = require('./helpers/ontologyShadowFixture.cjs');

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
        // Reads are declared per direction: a recipe root needs a bounded detail read plus the small coil
        // catalogue, while a coil root needs the bounded canonical reverse read (ONT-P8R) plus its own
        // identity read. Neither direction needs the whole recipe collection.
        const expectedReads = c.root.entityType === 'coil'
            ? ['get_recipes_by_coil', 'search_coils'] : ['get_recipe_detail', 'search_coils'];
        assert.deepEqual(calls.map(call => call.function.name).sort(), [...expectedReads].sort(),
            `planned reads for ${c.caseId}`);
        const coilCall = calls.find(call => call.function.name === 'search_coils');
        const args = JSON.parse(coilCall.function.arguments);
        if (c.root.entityType === 'coil') {
            // The root's own identity read is derived from already-verified server context, so it is
            // planned even when the question carries no `规格-片数` shorthand.
            assert.ok(Object.keys(args).length > 0, `root identity read must be derivable for ${c.caseId}`);
        } else {
            // A recipe root cannot know the target coil's identity before reading, so the coil catalogue
            // read is planned with no invented filter arguments, while the recipe read stays bounded.
            assert.deepEqual(args, {}, `recipe root must not invent coil filters for ${c.caseId}`);
            const detail = calls.find(call => call.function.name === 'get_recipe_detail');
            assert.deepEqual(JSON.parse(detail.function.arguments), { recipeId: Number(c.root.canonicalId) },
                `recipe root read must be bounded to the bound recipe for ${c.caseId}`);
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

test('P6D-R1 exact P6D regression: the ontology route reaches the correct canonical target', async () => {
    // In the P6D DeepSeek run this case produced `A canonical target = [301]` and `B canonical
    // target = []`. The expected value stays [301]; it must never be relaxed to match the bug.
    const c = cases.find(entry => entry.caseId === 'coil-explicit');
    // ONT-P8L: BOTH sides need the extended executor stub, because the legacy coil path now plans the
    // bounded reverse read too and the frozen corpus executor cannot know that tool.
    const off = await runRecordedCase(c, 'false', runAiAssistant, runCase);
    const on = await runRecordedCase(c, 'true', runAiAssistant, runCase, { forbidLegacy: true });
    const state = prepareRouting(routingInput(c));
    const offFacts = currentFactsForBinding(state.binding, off.result.toolResults);
    const onFacts = currentFactsForBinding(state.binding, on.result.toolResults);
    // The ontology route must reach the correct target and certify it — this is the regression under test.
    assert.deepEqual(onFacts.canonicalTargetIds, ['301']);
    assert.equal(onFacts.complete, true);
    // ONT-P8L (ruling B): the legacy side legitimately cannot certify this case any more. Its query carries
    // no coil shorthand, so `search_coils` returns several candidates, and the bounded repair refuses to
    // guess a root — which is exactly the required fail-safe. The aggregate that used to carry this case was
    // removed by the Supervisor's own ruling, so the assertion is "never a WRONG target", not "same target".
    assert.ok(['', '301'].includes(offFacts.canonicalTargetIds.join(',')),
        `legacy must either certify 301 or certify nothing, never a wrong id (got ${JSON.stringify(offFacts.canonicalTargetIds)})`);
    assert.ok(on.signature.modelCalls <= off.signature.modelCalls);
});

test('P6D-R1 the planned reads actually execute through the read-only executor and carry evidence', async () => {
    const c = positives[0];
    const executed = [];
    const on = await runCase(c, 'true', runAiAssistant, { forbidLegacy: true,
        dependencies: { executeToolCall: routingExecuteToolCall(executed) } });
    const state = prepareRouting(routingInput(c));
    const planned = router.requiredReadsFor(state).map(read => read.capability);
    const executedNames = on.result.toolResults.map(entry => entry.name);
    for (const name of planned) assert.ok(executedNames.includes(name), `planned read ${name} must execute`);
    // Only the deterministic planned reads must carry verified evidence: a model-initiated call that
    // the tool refuses for a missing identifier is a legitimate refusal, not missing evidence. The
    // planned call for a capability is the one that actually carried arguments.
    for (const name of planned) {
        assert.ok(on.result.toolResults.some(entry => entry.name === name && entry.args !== undefined
            && entry.result?.success !== false && entry.result?.executionEvidence?.verified === true
            && entry.result.executionEvidence.kind === 'formal_api_query'),
        `planned read ${name} must execute with verified formal evidence`);
    }
    // The read-only executor guard is re-asserted against the calls that actually ran.
    assert.deepEqual(executed.map(entry => entry.name).filter(name => planned.includes(name)).sort(), [...planned].sort());
});

/**
 * ONT-P8 a canary read the runtime cannot deliver revokes the canary and restores the legacy surface.
 * The failure is injected on whichever read the bound direction actually plans, so this guard keeps
 * covering any future read that the runtime cannot deliver — including the ONT-P8R bounded reverse read.
 */
const failingPlannedRead = name => async (tool, args, options) => (tool === name
    ? { success: false, code: 'AI_QUERY_RESULT_TOO_LARGE', error: 'CURRENT_TOO_LARGE' }
    : { success: true, count: 0, data: [], filters: { keyword: '', hasTechnicalFiles: null },
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/coils' }] } });
const undeliverableReadFor = c => {
    const state = prepareRouting(routingInput(c));
    assert.equal(state.record.eligible, true);
    return router.requiredReadsFor(state)[0].capability;
};

test('P8 a canary read the runtime cannot deliver revokes the canary and restores the legacy surface', async () => {
    const c = positives[0];
    const failing = undeliverableReadFor(c);
    const on = await runCase(c, 'true', runAiAssistant, { mode: 'deepseek',
        dependencies: { executeToolCall: failingPlannedRead(failing) } });
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
    const failing = undeliverableReadFor(c);
    const legacy = await runCase(c, 'false', runAiAssistant, { mode: 'deepseek' });
    const revoked = await runCase(c, 'true', runAiAssistant, { mode: 'deepseek',
        dependencies: { executeToolCall: failingPlannedRead(failing) } });
    assert.ok(revoked.signature.modelCalls <= legacy.signature.modelCalls + 1,
        `revoked canary added provider calls (${revoked.signature.modelCalls} vs legacy ${legacy.signature.modelCalls})`);
});
