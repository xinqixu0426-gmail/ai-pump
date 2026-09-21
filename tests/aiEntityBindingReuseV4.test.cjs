const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createFactRequirement,
    createInvestigationGoal,
    createInvestigationState,
} = require('../api/services/aiFactModelV4.cjs');
const { bindResolvedEntity } = require('../api/services/aiFactReducerV4.cjs');
const {
    createReadInvestigationController,
    goalFromIntent,
} = require('../api/services/aiReadInvestigationRuntimeV4.cjs');
const {
    runReadInvestigationExecutionV4,
} = require('../api/services/aiReadInvestigationDriverV4.cjs');

function requirement({
    entityType = 'recipe',
    predicate,
    temporalScope = 'current',
    scenario,
    target = 'v750',
}) {
    return createFactRequirement({
        identity: {
            entityType,
            entityId: null,
            predicate,
            temporalScope,
            scenario,
            qualifiers: { targetMention: target },
        },
    });
}

function recipeGoal(requirements, options = {}) {
    return createInvestigationGoal({
        goalId: options.goalId || 'binding-run',
        goal: options.goal || '查询 V750 正式资料',
        mode: options.mode || 'analysis',
        entityScope: 'single',
        domains: ['recipe', 'cost'],
        originalTarget: options.originalTarget || 'V750',
        requirements,
    });
}

function verifiedResult(data, path = '/api/test') {
    return {
        success: true,
        data,
        count: Array.isArray(data) ? data.length : 1,
        executionEvidence: {
            verified: true,
            kind: 'formal_api_query',
            calls: [{ method: 'GET', path }],
        },
    };
}

function exactRecipeReceipt() {
    return {
        version: 3,
        kind: 'entity_resolution',
        entityType: 'recipe',
        originalMention: 'V750',
        probes: ['V750'],
        status: 'exact',
        selected: { id: 123, name: 'V750', score: 1 },
        candidates: [{ id: 123, name: 'V750', score: 1 }],
        sourceCapability: 'get_all_recipes',
        sourceEvidence: [{
            capabilityName: 'get_all_recipes',
            arguments: { keyword: 'V750' },
            executionEvidence: { verified: true, kind: 'formal_api_query' },
            count: 1,
        }],
    };
}

function providerResponse(message) {
    return new Response(JSON.stringify({ choices: [{ message }] }), {
        headers: { 'Content-Type': 'application/json' },
    });
}

function bindFirstRecipeFact(controller, requirementId) {
    const receipt = exactRecipeReceipt();
    return controller.observe({
        capabilityName: 'preview_recipe_cost',
        requirementId,
        args: { recipeId: 123 },
        parameterProvenance: { recipeId: 'resolution_receipt' },
        resolutionReceipt: receipt,
        result: verifiedResult({ recipeId: 123, currentTotalCost: 10.75 }, '/api/recipes/current-costs'),
    });
}

test('same_entity_multiple_facts_reuse_binding', async () => {
    const requirements = [
        requirement({ predicate: 'currentRecipeCost', scenario: 'current_recipe_cost' }),
        requirement({
            predicate: 'savedRecipeCostSnapshot',
            temporalScope: 'saved_snapshot',
            scenario: 'saved_recipe_snapshot',
        }),
    ];
    const controller = createReadInvestigationController({
        goal: recipeGoal(requirements),
        planHints: ['preview_recipe_cost', 'get_recipe_detail'],
    });
    const calls = [];
    const provider = async (_messages, options = {}) => {
        const name = options.tools[0].function.name;
        return providerResponse({
            content: '',
            tool_calls: [{
                id: `call-${name}`,
                type: 'function',
                function: { name, arguments: JSON.stringify({ recipeName: 'V750' }) },
            }],
        });
    };
    const result = await runReadInvestigationExecutionV4({
        controller,
        provider,
        scopedMessages: [{ role: 'user', content: 'V750 当前成本和保存成本' }],
        currentMessages: [{ role: 'user', content: 'V750 当前成本和保存成本' }],
        userText: 'V750 当前成本和保存成本',
        executeToolCall: async (name, args) => {
            calls.push({ name, args });
            if (name === 'get_all_recipes') {
                return verifiedResult([{ id: 123, name: 'V750' }], '/api/recipes');
            }
            if (name === 'preview_recipe_cost') {
                return verifiedResult({ recipeId: 123, currentTotalCost: 10.75 }, '/api/recipes/current-costs');
            }
            return verifiedResult({ id: 123, name: 'V750', savedTotalCost: 9.5 }, '/api/recipes/123');
        },
        executeToolWithTiming: async (_name, execute) => execute(),
    });

    assert.equal(result.status, 'completed');
    assert.equal(calls.filter(item => item.name === 'get_all_recipes').length, 1);
    assert.deepEqual(calls.map(item => item.name), [
        'get_all_recipes',
        'preview_recipe_cost',
        'get_recipe_detail',
    ]);
    assert.equal(result.state.entityBindings.length, 1);
    assert.equal(result.state.entityBindings[0].entityId, '123');
    assert.equal(result.state.requirements.every(item => item.identity.entityId === '123'), true);
    assert.equal(new Set(result.state.requirements.map(item => item.factKey)).size, 2);
    assert.equal(new Set(result.state.requirements.flatMap(item => item.evidenceIds)).size, 2);
});

test('same_entity_three_facts_reuse_binding', () => {
    const requirements = [
        requirement({ predicate: 'currentRecipeCost', scenario: 'current_recipe_cost' }),
        requirement({
            predicate: 'savedRecipeCostSnapshot',
            temporalScope: 'saved_snapshot',
            scenario: 'saved_recipe_snapshot',
        }),
        requirement({ predicate: 'singleResourceDetail', scenario: 'recipe_current' }),
    ];
    const controller = createReadInvestigationController({ goal: recipeGoal(requirements) });
    bindFirstRecipeFact(controller, requirements[0].requirementId);
    const saved = controller.reuseBinding({
        capabilityName: 'get_recipe_detail',
        requirementId: requirements[1].requirementId,
        args: { recipeName: 'V750' },
    });
    const detail = controller.reuseBinding({
        capabilityName: 'get_recipe_detail',
        requirementId: requirements[2].requirementId,
        args: { recipeName: 'V750' },
    });
    assert.equal(saved.args.recipeId, 123);
    assert.equal(detail.args.recipeId, 123);
    assert.equal(controller.state().entityBindings.length, 1);
    assert.equal(controller.state().requirements.every(item => item.identity.entityId === '123'), true);
    assert.equal(new Set(controller.state().requirements.map(item => item.factKey)).size, 3);
});

test('different_entities_do_not_share_binding', () => {
    const first = requirement({ predicate: 'currentRecipeCost', scenario: 'current_recipe_cost', target: 'v750' });
    const second = requirement({
        predicate: 'savedRecipeCostSnapshot',
        temporalScope: 'saved_snapshot',
        scenario: 'saved_recipe_snapshot',
        target: 'v1100',
    });
    const controller = createReadInvestigationController({ goal: recipeGoal([first, second]) });
    bindFirstRecipeFact(controller, first.requirementId);
    assert.equal(controller.state().requirements[1].identity.entityId, null);
    assert.equal(controller.reuseBinding({
        capabilityName: 'get_recipe_detail',
        requirementId: second.requirementId,
        args: { recipeName: 'V1100' },
    }), null);

    const alreadyBound = createFactRequirement({
        ...first,
        identity: { ...first.identity, entityId: 999 },
    });
    const unbound = createFactRequirement({
        ...second,
        identity: { ...second.identity, entityId: null, qualifiers: { targetMention: 'v750' } },
    });
    const state = createInvestigationState({
        goalId: 'binding-run',
        requirements: [alreadyBound, unbound],
    });
    const rebound = bindResolvedEntity(state, unbound.requirementId, exactRecipeReceipt());
    assert.equal(rebound.requirements[0].identity.entityId, '999');
    assert.equal(rebound.requirements[1].identity.entityId, '123');
});

test('different_entity_types_do_not_share_binding', () => {
    const recipe = requirement({ predicate: 'currentRecipeCost', scenario: 'current_recipe_cost' });
    const template = requirement({
        entityType: 'template',
        predicate: 'singleResourceDetail',
        scenario: 'template_current',
    });
    const controller = createReadInvestigationController({ goal: recipeGoal([recipe, template]) });
    bindFirstRecipeFact(controller, recipe.requirementId);
    assert.equal(controller.state().requirements[1].identity.entityId, null);
    assert.equal(controller.reuseBinding({
        capabilityName: 'get_template_detail',
        requirementId: template.requirementId,
        args: { shellModel: 'V750' },
    }), null);
});

test('ambiguous_binding_is_not_reusable', () => {
    const facts = [
        requirement({ predicate: 'currentRecipeCost', scenario: 'current_recipe_cost' }),
        requirement({
            predicate: 'savedRecipeCostSnapshot',
            temporalScope: 'saved_snapshot',
            scenario: 'saved_recipe_snapshot',
        }),
    ];
    const controller = createReadInvestigationController({ goal: recipeGoal(facts) });
    controller.recordResolutionOutcome({
        requirementId: facts[0].requirementId,
        receipt: {
            kind: 'entity_resolution',
            entityType: 'recipe',
            originalMention: 'V750',
            status: 'ambiguous',
            selected: null,
            candidates: [{ id: 123, name: 'V750-A' }, { id: 124, name: 'V750-B' }],
            sourceCapability: 'get_all_recipes',
        },
    });
    assert.equal(controller.state().status, 'needs_clarification');
    assert.equal(controller.state().entityBindings.length, 0);
    assert.equal(controller.reuseBinding({
        capabilityName: 'get_recipe_detail',
        requirementId: facts[1].requirementId,
        args: { recipeName: 'V750' },
    }), null);
});

test('unverified_resolution_receipt_is_not_reusable', () => {
    const facts = [
        requirement({ predicate: 'currentRecipeCost', scenario: 'current_recipe_cost' }),
        requirement({
            predicate: 'savedRecipeCostSnapshot',
            temporalScope: 'saved_snapshot',
            scenario: 'saved_recipe_snapshot',
        }),
    ];
    const state = createInvestigationState({ goalId: 'binding-run', requirements: facts });
    const receipt = {
        ...exactRecipeReceipt(),
        sourceEvidence: [{
            capabilityName: 'get_all_recipes',
            executionEvidence: { verified: false },
        }],
    };
    const next = bindResolvedEntity(state, facts[0].requirementId, receipt);
    assert.equal(next.entityBindings.length, 0);
    assert.equal(next.requirements[1].identity.entityId, null);
});

test('stale_turn_state_is_not_formal_binding', () => {
    const goal = goalFromIntent({
        goal: '查询 V750 当前成本和保存成本',
        mode: 'analysis',
        entityScope: 'single',
        domains: ['recipe', 'cost'],
        targetMentions: ['V750'],
        steps: [
            { capabilityName: 'preview_recipe_cost' },
            { capabilityName: 'get_recipe_detail' },
        ],
    }, {
        turnState: {
            entityBindings: [{ entityType: 'recipe', entityId: 999, canonicalName: 'V750' }],
        },
    });
    const controller = createReadInvestigationController({ goal });
    assert.equal(controller.state().entityBindings.length, 0);
    assert.equal(controller.state().requirements.every(item => item.identity.entityId === null), true);
    assert.equal(controller.reuseBinding({
        capabilityName: 'preview_recipe_cost',
        requirementId: goal.requirements[0].requirementId,
        args: { recipeId: 999 },
    }), null);
});

test('binding_reuse_does_not_merge_fact_identity', () => {
    const facts = [
        requirement({ predicate: 'currentRecipeCost', scenario: 'current_recipe_cost' }),
        requirement({
            predicate: 'savedRecipeCostSnapshot',
            temporalScope: 'saved_snapshot',
            scenario: 'saved_recipe_snapshot',
        }),
    ];
    const controller = createReadInvestigationController({ goal: recipeGoal(facts) });
    const current = bindFirstRecipeFact(controller, facts[0].requirementId);
    const savedReuse = controller.reuseBinding({
        capabilityName: 'get_recipe_detail',
        requirementId: facts[1].requirementId,
        args: { recipeName: 'V750' },
    });
    const saved = controller.observe({
        capabilityName: 'get_recipe_detail',
        requirementId: facts[1].requirementId,
        args: savedReuse.args,
        parameterProvenance: { recipeId: 'resolution_receipt' },
        resolutionReceipt: savedReuse.resolutionReceipt,
        result: verifiedResult({ id: 123, name: 'V750', savedTotalCost: 10.75 }, '/api/recipes/123'),
    });
    const [currentFact, savedFact] = saved.state.requirements;
    assert.notEqual(currentFact.factKey, savedFact.factKey);
    assert.notEqual(current.evidence.evidenceId, saved.evidence.evidenceId);
    assert.equal(currentFact.identity.scenario, 'current_recipe_cost');
    assert.equal(savedFact.identity.scenario, 'saved_recipe_snapshot');
    assert.equal(saved.state.status, 'completed');
});

test('explicit_different_target_cannot_be_overwritten_by_binding', () => {
    const facts = [
        requirement({ predicate: 'currentRecipeCost', scenario: 'current_recipe_cost' }),
        requirement({
            predicate: 'savedRecipeCostSnapshot',
            temporalScope: 'saved_snapshot',
            scenario: 'saved_recipe_snapshot',
        }),
    ];
    const controller = createReadInvestigationController({ goal: recipeGoal(facts) });
    bindFirstRecipeFact(controller, facts[0].requirementId);
    const before = controller.state();
    const proposedArgs = { recipeName: 'V750-A' };
    assert.equal(controller.reuseBinding({
        capabilityName: 'get_recipe_detail',
        requirementId: facts[1].requirementId,
        args: proposedArgs,
    }), null);
    assert.deepEqual(controller.state(), before);
    assert.deepEqual(proposedArgs, { recipeName: 'V750-A' });
});

test('duplicate_suppression_still_blocks_true_duplicate', () => {
    const fact = requirement({ predicate: 'currentRecipeCost', scenario: 'current_recipe_cost' });
    const controller = createReadInvestigationController({ goal: recipeGoal([fact]) });
    const input = {
        parentCapabilityName: 'preview_recipe_cost',
        capabilityName: 'get_all_recipes',
        requirementId: fact.requirementId,
        args: { keyword: 'V750' },
        parameterProvenance: { keyword: 'original_user' },
        result: verifiedResult([{ id: 123, name: 'V750' }], '/api/recipes'),
    };
    assert.equal(controller.recordDiscovery(input).accepted, true);
    const duplicate = controller.authorizeDiscovery(input);
    assert.equal(duplicate.allowed, false);
    assert.equal(duplicate.code, 'DUPLICATE_CALL');
});
