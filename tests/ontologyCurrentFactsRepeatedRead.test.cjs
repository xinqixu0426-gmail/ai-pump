'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toolFor } = require('./helpers/ontologyBindingCorpus.cjs');
const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
const { bindRelation } = require('../api/ontology/relationBinder.cjs');

/**
 * ONT-P6D-R1 — shadow current-facts certification for repeated reads of the same source collection.
 *
 * The inverse-membership projection used to compare rows from EVERY invocation of a capability
 * against ONE read's data length, so reading the same complete collection twice was reported as
 * incomplete. Certification is now keyed on the semantic source snapshot, so
 * complete + complete = complete, while genuinely different or partial collections still cannot
 * certify membership.
 */
const formal = (path, data, count) => ({ success: true, count: count === undefined ? data.length : count,
    filters: { keyword: '', hasTechnicalFiles: null }, data,
    executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path }] } });
const recipesRead = (ids, overrides = {}) => ({ name: 'get_all_recipes',
    result: { ...formal('/api/recipes', ids.map(id => ({ id, coilId: id === 301 ? 501 : null }))), ...overrides } });
const coilRead = () => toolFor('coil');
const ALL = [301, 302, 303, 304];

const seeds = [coilRead(), recipesRead(ALL)];
const binding = bindRelation({ ontologyVersion: 1, userText: '12-120线圈用在哪些配方',
    verifiedToolResults: seeds, subject: 'p6dr1-owner', conversationId: 'p6dr1' });

test('P6D-R1 projection fixture binds the coil→recipe inverse relation', () => {
    assert.equal(binding.status, 'BOUND');
    assert.equal(binding.relationId, 'coil.used_by_recipe');
    assert.deepEqual(binding.root, { entityType: 'coil', canonicalId: '501' });
});

// Each case states the expected semantics explicitly rather than inferring them from the code.
const matrix = [
    { name: '1 one complete read', results: () => [coilRead(), recipesRead(ALL)],
        complete: true, targets: ['301'] },
    { name: '2 two identical complete reads', results: () => [recipesRead(ALL), coilRead(), recipesRead(ALL)],
        complete: true, targets: ['301'] },
    { name: '3 equivalent complete reads with different invocation ids', results: () => [
        recipesRead(ALL), coilRead(),
        { name: 'get_all_recipes', result: { ...formal('/api/recipes', ALL.map(id => ({ id, coilId: id === 301 ? 501 : null }))),
            invocationId: 'different-invocation' } },
    ], complete: true, targets: ['301'] },
    { name: '4 complete + incomplete (filtered)', results: () => [
        recipesRead(ALL), recipesRead([301], { count: 1, filters: { keyword: 'Shadow', hasTechnicalFiles: null },
            executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/recipes?keyword=Shadow' }] } }), coilRead(),
    ], complete: false, targets: [] },
    { name: '5 incomplete (filtered) + complete', results: () => [
        recipesRead([301], { count: 1, filters: { keyword: 'Shadow', hasTechnicalFiles: null },
            executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/recipes?keyword=Shadow' }] } }), recipesRead(ALL), coilRead(),
    ], complete: false, targets: [] },
    { name: '6 two conflicting complete source sets', results: () => [
        recipesRead(ALL), recipesRead([301, 302, 303]), coilRead(),
    ], complete: false, targets: [] },
    { name: '7 duplicate pagination pages of the same page', results: () => [
        recipesRead(ALL), recipesRead(ALL), coilRead(),
    ], complete: true, targets: ['301'] },
    { name: '8 same query repeated after an unrelated tool call', results: () => [
        recipesRead(ALL), { name: 'get_recipe_detail', result: { success: true, recipe: { id: 301 } } }, recipesRead(ALL), coilRead(),
    ], complete: true, targets: ['301'] },
    { name: '9 complete + truncated (count != data length)', results: () => [
        recipesRead(ALL), recipesRead([301, 302]), coilRead(),
    ], complete: false, targets: [] },
    { name: '10 truncated (count != data length) + complete', results: () => [
        recipesRead([301, 302]), recipesRead(ALL), coilRead(),
    ], complete: false, targets: [] },
];
for (const entry of matrix) {
    test(`P6D-R1 repeated-read certification: ${entry.name}`, () => {
        const facts = currentFactsForBinding(binding, entry.results());
        assert.equal(facts.complete, entry.complete, `complete for ${entry.name}`);
        assert.deepEqual(facts.canonicalTargetIds, entry.targets, `targets for ${entry.name}`);
    });
}

test('P6D-R1 exact P6D regression: duplicate get_all_recipes still certifies the target set', () => {
    // This is the precise tool sequence that produced `B canonical target = []` in the P6D DeepSeek
    // run. Side A used one `get_all_recipes` and certified ['301']; side B used the same read twice
    // and certified nothing. The expected value must stay ['301'] — never relaxed to match the bug.
    const bSequence = [recipesRead(ALL), coilRead(), recipesRead(ALL)];
    const facts = currentFactsForBinding(binding, bSequence);
    assert.equal(facts.complete, true);
    assert.equal(facts.canonical, true);
    assert.deepEqual(facts.canonicalTargetIds, ['301']);
    const aSequence = [recipesRead(ALL)];
    assert.deepEqual(currentFactsForBinding(binding, aSequence).canonicalTargetIds, ['301']);
});

test('P6D-R1 certification never fabricates membership from a filtered or partial read alone', () => {
    const filtered = recipesRead([301], { count: 1, filters: { keyword: 'Shadow', hasTechnicalFiles: null },
        executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/recipes?keyword=Shadow' }] } });
    assert.equal(currentFactsForBinding(binding, [coilRead(), filtered]).complete, false);
    // A genuine truncation is signalled by the formal receipt itself: count must exceed the returned
    // rows. A self-consistent smaller read is a complete read of a smaller collection and may certify.
    const truncated = recipesRead([301, 302], { count: 4 });
    assert.equal(currentFactsForBinding(binding, [coilRead(), truncated]).complete, false);
    const selfConsistent = recipesRead([301, 302]);
    assert.equal(currentFactsForBinding(binding, [coilRead(), selfConsistent]).complete, true);
});
