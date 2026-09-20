'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    IDENTITY_READS,
    RESOLVABLE_RELATIONS,
    exactFormalName,
    isResolvableRelation,
    mentionIsPlainName,
    resolveRelationRoot,
} = require('../api/ontology/relationRootCanonical.cjs');
const { preBindingResolverInput, prepareRouting, profiles } = require('../api/ontology/relationRoutingCanary.cjs');

const RECIPE = { recipeId: 13, recipeName: 'V750大脚板-2寸-经典款' };
const MENTION = 'V750大脚板-2寸-经典款';
const identityReadPath = IDENTITY_READS.recipe.evidencePath;
const resolverReturning = resolution => async () => resolution;
const found = (identity, calls = [{ method: 'GET', path: `${identityReadPath}?name=x` }]) => ({
    status: 'found', identity, calls,
});
const intent = (mention = MENTION) => ({ relationId: 'recipe.uses_coil', fromType: 'recipe', mention, typed: false, pronoun: false, eligible: true });

test('ONT-P8L-FINAL root resolution: a resolvable direction is declared per entity type, not per question', () => {
    assert.deepEqual(RESOLVABLE_RELATIONS, ['recipe.uses_coil']);
    assert.equal(isResolvableRelation('recipe.uses_coil'), true);
    assert.equal(isResolvableRelation('coil.used_by_recipe'), false);
    assert.equal(IDENTITY_READS.recipe.capability, 'resolve_recipe_identity');
    // The pre-binding read is declared by the live profile for the recipe-rooted direction only.
    const profile = profiles.find(entry => entry.sourceId === 'recipe_coil');
    const declared = profile.requiredReadsByRelation['recipe.uses_coil']
        .filter(read => read.argumentPolicy === 'pre_binding').map(read => read.capability);
    assert.deepEqual(declared, ['resolve_recipe_identity']);
    assert.deepEqual(profile.requiredReadsByRelation['coil.used_by_recipe']
        .filter(read => read.argumentPolicy === 'pre_binding'), []);
});

test('ONT-P8L-FINAL root resolution: only a unique formal name EQUAL to the mention becomes a canonical root', async () => {
    const resolved = await resolveRelationRoot(intent(), { resolveIdentity: resolverReturning(found(RECIPE)) });
    assert.equal(resolved.resolved, true, JSON.stringify(resolved));
    assert.equal(resolved.canonicalId, '13');
    assert.equal(resolved.receipt.selected.id, 13);
    assert.equal(resolved.receipt.selected.matchKind, 'exact');
    assert.equal(resolved.receipt.sourceCapability, 'resolve_recipe_identity');
    // The receipt carries the formal read that produced it, so binding evidence stays a read provenance.
    assert.equal(resolved.receipt.sourceEvidence[0].executionEvidence.kind, 'formal_api_query');
    assert.equal(resolved.receipt.sourceEvidence[0].executionEvidence.calls[0].path, `${identityReadPath}?name=x`);
});

test('ONT-P8L-FINAL root resolution: a substring hit never becomes an authoritative root', async () => {
    for (const [label, identity] of [
        ['prefix hit', { recipeId: 13, recipeName: 'V750大脚板-2寸-经典款' }],
        ['unrelated exact', { recipeId: 99, recipeName: '另一个配方' }],
    ]) {
        const mention = label === 'prefix hit' ? 'V750' : MENTION;
        const resolved = await resolveRelationRoot(intent(mention), { resolveIdentity: resolverReturning(found(identity)) });
        assert.equal(resolved.resolved, false, `${label} must not bind`);
        assert.equal(resolved.reason, 'NAME_NOT_EXACT');
    }
    // Trailing user particles are stripped for the comparison, but the comparison itself stays exact.
    const polite = await resolveRelationRoot(intent(`${MENTION}的`), { resolveIdentity: resolverReturning(found(RECIPE)) });
    assert.equal(polite.resolved, true);
    assert.equal(exactFormalName('V750大脚板-2寸-经典款', 'V750大脚板-2寸'), false);
    assert.equal(exactFormalName('V750大脚板-2寸-经典款', 'V750大脚板-2寸-经典款呢？'), true);
});

test('ONT-P8L-FINAL root resolution: miss, ambiguity, invalid identity and missing provenance all resolve to nothing', async () => {
    const cases = [
        [{ status: 'not_found' }, 'NAME_NOT_FOUND'],
        [{ status: 'ambiguous', candidates: [{ recipeId: 1, recipeName: MENTION }] }, 'AMBIGUOUS_NAME'],
        [{ status: 'failed', code: 'IDENTITY_READ_FAILED' }, 'RESOLVER_FAILED'],
        [found({ recipeId: 0, recipeName: MENTION }), 'IDENTITY_INVALID'],
        [found({ recipeId: 13, recipeName: '' }), 'IDENTITY_INVALID'],
        [found(RECIPE, [{ method: 'GET', path: '/api/recipes' }]), 'READ_PROVENANCE_MISSING'],
        [found(RECIPE, [{ method: 'POST', path: `${identityReadPath}?name=x` }]), 'READ_PROVENANCE_MISSING'],
    ];
    for (const [resolution, reason] of cases) {
        const resolved = await resolveRelationRoot(intent(), { resolveIdentity: resolverReturning(resolution) });
        assert.equal(resolved.resolved, false, JSON.stringify(resolution));
        assert.equal(resolved.reason, reason, JSON.stringify(resolution));
        assert.equal(resolved.receipt, undefined);
    }
    // A thrown resolver is a resolution miss, never a turn failure.
    const thrown = await resolveRelationRoot(intent(), { resolveIdentity: async () => { throw Error('ENOTFOUND'); } });
    assert.equal(thrown.resolved, false);
    assert.equal(thrown.reason, 'RESOLVER_FAILED');
});

test('ONT-P8L-FINAL root resolution: one bounded identity read per turn, and only for plain, resolvable names', async () => {
    let calls = 0;
    const counting = async () => { calls += 1; return found(RECIPE); };
    await resolveRelationRoot(intent(), { resolveIdentity: counting });
    assert.equal(calls, 1);

    const skipped = [
        ['typed mention', { ...intent('配方13'), typed: true }],
        ['pronoun', { ...intent('这个配方'), pronoun: true }],
        ['two entities', intent('V750和V550')],
        ['non-resolvable direction', { relationId: 'coil.used_by_recipe', fromType: 'coil', mention: '12-140', typed: false, pronoun: false, eligible: true }],
        ['not eligible', { ...intent(), eligible: false }],
    ];
    for (const [label, value] of skipped) {
        let touched = 0;
        const resolved = await resolveRelationRoot(value, { resolveIdentity: async () => { touched += 1; return found(RECIPE); } });
        assert.equal(resolved.resolved, false, label);
        assert.equal(touched, 0, `${label} must not spend a read`);
    }
    assert.equal(mentionIsPlainName('12-120线圈'), false);
    assert.equal(mentionIsPlainName('V750大脚板-2寸-经典款'), true);
});

test('ONT-P8L-FINAL root resolution: the pre-binding intent comes from the binder grammar, so no second grammar exists', () => {
    const sessionInput = { subject: 'owner', conversationId: 'chat' };
    const named = preBindingResolverInput({ userText: `${MENTION} 配的什么绕组？`, ...sessionInput });
    assert.equal(named.relationId, 'recipe.uses_coil');
    assert.equal(named.mention, MENTION);
    assert.equal(named.typed, false);
    // A question with no relation intent, or one whose root is a label/pronoun, resolves nothing.
    assert.equal(preBindingResolverInput({ userText: '最近有哪些订单？', ...sessionInput }), null);
    assert.equal(preBindingResolverInput({ userText: '这个配方配的什么绕组？', ...sessionInput }), null);
    assert.equal(preBindingResolverInput({ userText: '配方13配的什么绕组？', ...sessionInput }), null);
});

test('ONT-P8L-FINAL routing recall no longer depends on which read the previous turn produced', () => {
    // The three receipt combinations that used to produce three different binding outcomes for the SAME
    // question. With the pre-resolved root, all three bind and route identically.
    const question = `${MENTION} 配的什么绕组？`;
    const previousTurns = {
        'detail only': [],
        'whole-catalogue list': [{ name: 'get_all_recipes', result: { success: true, data: [{ id: 13, name: MENTION }],
            filters: { limit: 50 }, count: 1,
            executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/recipes' }] } } }],
        'unrelated reads': [{ name: 'search_templates', result: { success: true, data: [{ id: 401, shellModel: '模板-V750大脚板-2寸-经典款' }],
            executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/templates' }] } } }],
    };
    const toolNames = ['get_recipe_detail', 'search_coils', 'get_all_recipes', 'get_recipes_by_coil'];
    const tools = toolNames.map(name => ({ type: 'function', function: { name, description: name, parameters: { type: 'object', properties: {} } } }));
    const preResolvedRoots = [{
        version: 3, kind: 'entity_resolution', entityType: 'recipe', status: 'exact', originalMention: MENTION,
        selected: { id: 13, name: MENTION, matchKind: 'exact' },
        sourceCapability: 'resolve_recipe_identity',
        sourceEvidence: [{ executionEvidence: { verified: true, kind: 'formal_api_query',
            calls: [{ method: 'GET', path: `${identityReadPath}?name=x` }] } }],
    }];
    for (const [label, toolResults] of Object.entries(previousTurns)) {
        const without = prepareRouting({ userText: question, env: { AI_PROVIDER: 'deepseek' }, tools,
            trustedToolResults: toolResults, subject: 'owner', conversationId: 'chat',
            trustedSession: { subject: 'owner', conversationId: 'chat', observedAt: Date.now(), toolResults },
            preResolution: { resolved: false, reason: 'NAME_NOT_EXACT', entityType: 'recipe', relationId: 'recipe.uses_coil' } });
        const with_ = prepareRouting({ userText: question, env: { AI_PROVIDER: 'deepseek' }, tools,
            trustedToolResults: toolResults, subject: 'owner', conversationId: 'chat',
            trustedSession: { subject: 'owner', conversationId: 'chat', observedAt: Date.now(), toolResults },
            preResolution: { resolved: true, reason: null, entityType: 'recipe', relationId: 'recipe.uses_coil' },
            preResolvedRoots });
        // The bound root and the routed surface are identical in every case.
        assert.equal(with_.binding.status, 'BOUND', label);
        assert.deepEqual(with_.binding.root, { entityType: 'recipe', canonicalId: '13' }, label);
        assert.equal(with_.binding.bindingSource[0], 'canonical_receipt', label);
        assert.equal(with_.record.eligible, true, label);
        assert.equal(with_.record.routingSource, 'ONTOLOGY_RELATION_BINDING', label);
        assert.deepEqual(with_.tools.map(tool => tool.function.name), ['get_recipe_detail', 'search_coils'], label);
        assert.equal(with_.record.preResolution.resolved, true, label);
        // And the pre-binding read is never offered to the model, in either case.
        assert.equal(with_.tools.some(tool => tool.function.name === 'resolve_recipe_identity'), false, label);
        assert.equal(without.record.preResolution.reason, 'NAME_NOT_EXACT', label);
        // The unrelated-read case is the one that used to fall through to Legacy: prove the fix is what
        // changed the outcome, not the receipts.
        if (label === 'unrelated reads') assert.notEqual(without.record.eligible, true);
    }
});
