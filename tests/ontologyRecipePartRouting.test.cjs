'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/ontologyShadowFixture.cjs');
const { createRelationReadRouter } = require('../api/routes/relationRead.cjs');
const { assistantReadTools } = require('../api/services/aiAssistantRuntime.cjs');
const router = require('../api/ontology/relationRoutingCanary.cjs');
const { resolveRelationRoot } = require('../api/ontology/relationRootCanonical.cjs');
const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
const { verifiedRecipePartRelationReply } = require('../api/services/recipePartRelationAnswer.cjs');

const receipt = (entityType, id, name, capability, method, path) => ({
    version: 3, kind: 'entity_resolution', entityType, status: 'exact', originalMention: name,
    selected: { id, name, matchKind: 'exact' }, sourceCapability: capability,
    sourceEvidence: [{ executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method, path }] } }],
});

test('recipe-part ontology HTTP boundary is canonical-only, bounded and fail-closed', async () => {
    const db = fixture();
    const server = await new Promise(resolve => {
        const express = require('express');
        const app = express(); app.use(express.json()); app.use('/api/relations', createRelationReadRouter({ db }));
        const value = app.listen(0, '127.0.0.1', () => resolve(value));
    });
    const post = async body => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/relations/resolve`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        return { status: response.status, body: await response.json() };
    };
    try {
        const forward = await post({ ontologyVersion: 1, relationId: 'recipe.contains_part',
            root: { entityType: 'recipe', canonicalId: '301' } });
        assert.equal(forward.status, 200);
        assert.equal(forward.body.data.provenance.canonicalOnly, true);
        assert.deepEqual(forward.body.data.items.map(item => item.canonicalId), ['601']);
        const reverse = await post({ ontologyVersion: 1, relationId: 'part.contained_in_recipe',
            root: { entityType: 'part', canonicalId: '601' } });
        assert.equal(reverse.status, 200);
        assert.deepEqual(reverse.body.data.items.map(item => item.canonicalId), ['301']);
        const legacy = await post({ ontologyVersion: 1, relationId: 'recipe.contains_part',
            root: { entityType: 'recipe', canonicalId: '303' } });
        assert.equal(legacy.status, 422);
        assert.equal(legacy.body.details.status, 'REFERENCE_INCOMPLETE');
    } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});

test('recipe-part profile plans one deterministic bounded read in each direction', () => {
    const cases = [
        ['Shadow配方甲用了哪些零件？', receipt('recipe', 301, 'Shadow配方甲', 'resolve_recipe_identity', 'GET', '/api/recipes/identity?name=x'), 'get_recipe_parts', { recipeId: 301 }],
        ['Shadow零件甲用在哪些配方？', receipt('part', 601, 'Shadow零件甲', 'resolve_part_identity', 'POST', '/api/entity-lookup'), 'get_recipes_by_part', { partId: 601 }],
    ];
    for (const [userText, canonical, capability, args] of cases) {
        const state = router.prepareRouting({ userText, env: { AI_PROVIDER: 'deepseek' },
            tools: assistantReadTools(), shortlistEnabled: false, preResolvedRoots: [canonical],
            preResolution: { resolved: true, entityType: canonical.entityType }, trustedToolResults: [] });
        assert.equal(state.record.eligible, true, userText);
        assert.equal(state.profile.sourceId, 'recipe_part');
        const calls = router.requiredReadCalls(state, [], userText);
        assert.deepEqual(calls.map(call => call.function.name), [capability]);
        assert.deepEqual(JSON.parse(calls[0].function.arguments), args);
    }
});

test('part root resolution requires one unique exact formal POST lookup', async () => {
    const intent = { relationId: 'part.contained_in_recipe', fromType: 'part', mention: 'Shadow零件甲', eligible: true };
    const found = await resolveRelationRoot(intent, { resolveIdentity: async () => ({
        status: 'found', identity: { partId: 601, partName: 'Shadow零件甲' },
        calls: [{ method: 'POST', path: '/api/entity-lookup' }],
    }) });
    assert.equal(found.resolved, true);
    assert.equal(found.canonicalId, '601');
    const ambiguous = await resolveRelationRoot(intent, { resolveIdentity: async () => ({ status: 'ambiguous',
        calls: [{ method: 'POST', path: '/api/entity-lookup' }] }) });
    assert.equal(ambiguous.resolved, false);
    assert.equal(ambiguous.reason, 'AMBIGUOUS_NAME');
});

test('recipe-part formal receipts drive current facts and deterministic presentation', () => {
    const binding = { relationId: 'recipe.contains_part', root: { entityType: 'recipe', canonicalId: '301' } };
    const result = { success: true, relation: 'recipe.contains_part', complete: true,
        root: binding.root, count: 1, totalCount: 1, data: [{ partId: 601, partName: 'Shadow零件甲' }],
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'POST', path: '/api/relations/resolve' }] } };
    const tools = [{ name: 'get_recipe_parts', result }];
    assert.deepEqual(currentFactsForBinding(binding, tools).canonicalTargetIds, ['601']);
    assert.match(verifiedRecipePartRelationReply('Shadow配方甲用了哪些零件？', tools, { enabled: true }), /Shadow零件甲/);
});
