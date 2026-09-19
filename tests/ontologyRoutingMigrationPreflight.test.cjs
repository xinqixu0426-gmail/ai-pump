'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const frozen = require('./fixtures/ontology-coil-recipe-canary-v1.json');
const { bindRelation } = require('../api/ontology/relationBinder.cjs');
const { ontology } = require('../api/ontology/contract.cjs');
const { rows, toolFor } = require('./helpers/ontologyBindingCorpus.cjs');
const shortlist = require('../api/services/aiToolShortlist.cjs');
for (const c of frozen.cases) test(`P6 preflight frozen semantics ${c.caseId}`, () => {
    assert.equal(shortlist.isCoilRecipeRelationQuery(c.userText), c.legacyDetector);
    // ONT-P8L (Supervisor ruling B): the frozen fixture still records the pre-fix shortlist and is NOT
    // overwritten — that is the historical evidence. The one authorised difference is that the coil<->recipe
    // relation shortlist now offers bounded readers for both directions instead of the whole-recipe
    // aggregate. The expectation is derived by applying exactly that substitution.
    // The substitution applies exactly to the coil<->recipe relation branch, identified by its frozen
    // membership. Keying on "contains get_all_recipes" was too broad: domain-scored cases such as
    // recipe-cost/recipe-write also recorded the aggregate, and their shortlist did not change.
    const relationBranch = c.legacyShortlist.length === 2
        && c.legacyShortlist.includes('get_all_recipes') && c.legacyShortlist.includes('search_coils');
    const sanctionedShortlist = relationBranch
        ? ['search_coils', 'get_recipes_by_coil', 'get_recipe_detail']
        : c.legacyShortlist;
    assert.deepEqual(shortlist.selectLocalAssistantTools(c.userText, { env: { AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true' } }).map(t => t.function.name), sanctionedShortlist);
    const verifiedToolResults = ['coil', 'recipe'].map(type => toolFor(type, c.ambiguousType === type ? [rows[type], { ...rows[type], id: rows[type].id + 1 }] : [rows[type]]));
    const extra = c.sessionType ? { subject: 'preflight-owner', conversationId: 'preflight', trustedSession: {
        subject: 'preflight-owner', conversationId: 'preflight', observedAt: Date.now(), toolResults: [toolFor(c.sessionType)],
    } } : {};
    const binding = bindRelation({ ontologyVersion: 1, userText: c.userText, verifiedToolResults, ...extra });
    if (c.category === 'positive') { assert.equal(binding.status, 'BOUND'); assert.equal(binding.relationId, c.relationId); assert.deepEqual(binding.root, c.root); }
    else assert.notEqual(binding.status, 'BOUND');
});
test('P6 preflight both existing coil/recipe directions are authoritative A/B', () => {
    const relations = ontology.relations.filter(r => r.sourceId === 'recipe_coil');
    assert.deepEqual(relations.map(r => r.relationId).sort(), ['coil.used_by_recipe', 'recipe.uses_coil']);
    assert.ok(relations.every(r => ['CANONICAL_DIRECT', 'DETERMINISTIC_DERIVED'].includes(r.authority)));
});
test('P6 preflight relation pairing/repair provider gate excludes actual requested DeepSeek', () => {
    assert.equal(shortlist.shouldUseLocalToolShortlist({ AI_PROVIDER: 'deepseek', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true' }), false);
    assert.equal(shortlist.shouldUseLocalToolShortlist({ AI_PROVIDER: 'local', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true' }), true);
    assert.equal(shortlist.shouldUseLocalToolShortlist({ AI_PROVIDER: 'local-first', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true' }), true);
});
