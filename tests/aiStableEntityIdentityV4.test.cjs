const test = require('node:test');
const assert = require('node:assert/strict');

const { reuseEntityBinding } = require('../api/services/aiCapabilityBrokerV4.cjs');
const { buildClaimsFromInvestigation } = require('../api/services/aiClaimGroundingV4.cjs');
const { resolveFormalEntityResultV3 } = require('../api/services/aiEntityResolverV3.cjs');
const { createFactRequirement, createInvestigationState } = require('../api/services/aiFactModelV4.cjs');
const { bindResolvedEntity, reduceObservation } = require('../api/services/aiFactReducerV4.cjs');
const {
    CURRENT_INVENTORY_SCENARIO,
    INVENTORY_QUANTITY_PREDICATE,
} = require('../api/services/aiNumericScalarFactsV4.cjs');
const { createEvidenceLedger, createObservation } = require('../api/services/aiObservationV3.cjs');
const { createReadInvestigationController } = require('../api/services/aiReadInvestigationRuntimeV4.cjs');
const {
    normalizeStableEntityIdentity,
    stableEntityIdentityComparison,
    stableEntityIdentityMatches,
} = require('../api/services/aiStableEntityIdentityV4.cjs');

function coilRequirement(predicate = INVENTORY_QUANTITY_PREDICATE, scenario = CURRENT_INVENTORY_SCENARIO) {
    return createFactRequirement({
        identity: {
            entityType: 'coil', entityId: null, predicate,
            temporalScope: 'current', scenario,
            qualifiers: { targetMention: 'coil-0012' },
        },
    });
}

function formalCoil(id = 12, schemeCode = 'COIL-0012', stock = 0) {
    return {
        id, coilId: id, schemeCode, schemeName: '马来西亚正式方案',
        spec: '12', sheets: 200, material: '钢带', slotType: '小眼',
        schemeFamilyCode: 'FAMILY-12', schemeStatus: 'official', stock,
    };
}

function verifiedSourceEvidence() {
    return [{
        capabilityName: 'search_coils',
        executionEvidence: { verified: true, kind: 'formal_api_query' },
    }];
}

function coilReceipt(row = formalCoil()) {
    return resolveFormalEntityResultV3({
        entityType: 'coil',
        originalMention: row.schemeCode,
        sourceCapability: 'search_coils',
        sourceEvidence: verifiedSourceEvidence(),
        result: { success: true, coils: [row] },
    });
}

function bindRequirement(requirement = coilRequirement(), row = formalCoil()) {
    const initial = createInvestigationState({ goalId: 'coil-binding', requirements: [requirement] });
    return bindResolvedEntity(initial, requirement.requirementId, coilReceipt(row), {
        logicalTarget: row.schemeCode,
    });
}

function inventoryEvidence(requirement, row, subjectIdentity = null) {
    const result = {
        success: true,
        coils: [row],
        executionEvidence: {
            verified: true,
            kind: 'formal_api_query',
            calls: [{ method: 'GET', path: '/api/coils', outcome: 'success' }],
        },
    };
    const observation = createObservation({
        attempted: true,
        observationId: `observation-${row.schemeCode}`,
        outcome: 'success_non_empty',
        capabilityName: 'search_coils',
        factKey: requirement.factKey,
        verified: true,
        sourceOfTruth: 'coilService',
        subjectIdentity,
        result,
    });
    const ledger = createEvidenceLedger();
    const evidence = ledger.appendObservation(observation, {
        toolResult: { name: 'search_coils', result },
    });
    return { observation, evidence, ledger: ledger.snapshot() };
}

test('coil_binding_preserves_scheme_code', () => {
    const receipt = coilReceipt();
    assert.equal(receipt.status, 'exact');
    assert.equal(receipt.selected.id, 12);
    assert.equal(receipt.selected.stableIdentity.primaryStableId, '12');
    assert.equal(receipt.selected.stableIdentity.stableBusinessKeys.schemeCode, 'COIL-0012');
    assert.deepEqual(receipt.selected.stableIdentity.validationAttributes, {
        material: '钢带', schemeFamilyCode: 'FAMILY-12', sheets: '200',
        slotType: '小眼', spec: '12',
    });
    const state = bindRequirement();
    assert.equal(state.entityBindings[0].stableEntityIdentity.stableBusinessKeys.schemeCode, 'COIL-0012');
    assert.equal(state.requirements[0].identity.stableEntityIdentity.stableBusinessKeys.schemeCode, 'COIL-0012');
});

test('coil_evidence_matches_binding_by_scheme_code', () => {
    const bound = bindRequirement();
    const requirement = bound.requirements[0];
    const fixture = inventoryEvidence(
        requirement,
        { schemeCode: 'COIL-0012', spec: '12', stock: 6 },
        { entityType: 'coil', stableBusinessKeys: { schemeCode: 'COIL-0012' } }
    );
    const state = reduceObservation(bound, fixture);
    assert.equal(fixture.evidence.subjectIdentity.stableBusinessKeys.schemeCode, 'COIL-0012');
    assert.equal(state.requirements[0].status, 'satisfied');
    assert.equal(state.numericFacts[0].numericValue, 6);
});

test('coil_binding_reuse_across_multiple_facts', () => {
    const requirements = [
        coilRequirement(),
        coilRequirement('currentStatus', 'coil_current'),
        coilRequirement('singleResourceDetail', 'coil_current'),
    ];
    const controller = createReadInvestigationController({
        goal: {
            goalId: 'coil-binding', goal: '读取 COIL-0012 多个事实', mode: 'analysis',
            entityScope: 'single', domains: ['coil'], originalTarget: 'COIL-0012', requirements,
        },
    });
    const receipt = coilReceipt();
    const state = bindResolvedEntity(controller.state(), requirements[0].requirementId, receipt, {
        logicalTarget: 'COIL-0012',
    });
    for (const requirement of state.requirements) {
        assert.equal(requirement.identity.entityId, '12');
        assert.equal(requirement.identity.stableEntityIdentity.stableBusinessKeys.schemeCode, 'COIL-0012');
    }
    for (const requirement of state.requirements.slice(1)) {
        const reused = reuseEntityBinding({
            state,
            goal: controller.goal,
            capabilityName: 'search_coils',
            requirementId: requirement.requirementId,
            args: {},
        });
        assert.equal(reused.args.schemeCode, 'COIL-0012');
    }
});

test('same_spec_different_scheme_code_do_not_merge', () => {
    const left = normalizeStableEntityIdentity({ entityType: 'coil', record: formalCoil(12, 'COIL-A') });
    const right = normalizeStableEntityIdentity({ entityType: 'coil', record: formalCoil(13, 'COIL-B') });
    assert.equal(stableEntityIdentityMatches(left, right), false);
    assert.equal(stableEntityIdentityComparison(left, right), 'conflict');
});

test('scheme_family_not_equal_concrete_scheme', () => {
    const concrete = normalizeStableEntityIdentity({ entityType: 'coil', record: formalCoil() });
    const familyOnly = normalizeStableEntityIdentity({ entityType: 'coil', schemeFamilyCode: 'COIL-0012' });
    assert.equal(familyOnly, null);
    assert.equal(stableEntityIdentityMatches(concrete, {
        entityType: 'coil', stableBusinessKeys: { schemeCode: 'FAMILY-12' },
    }), false);
});

test('ambiguous_multi_official_coils_remain_ambiguous', () => {
    const rows = [formalCoil(12, 'COIL-A'), formalCoil(13, 'COIL-B')];
    const receipt = resolveFormalEntityResultV3({
        entityType: 'coil', originalMention: '12-200', sourceCapability: 'search_coils',
        sourceEvidence: verifiedSourceEvidence(), result: { success: true, coils: rows },
    });
    assert.equal(receipt.status, 'ambiguous');
    assert.equal(receipt.selected, null);
    assert.deepEqual(receipt.candidates.map(item => item.stableIdentity.stableBusinessKeys.schemeCode).sort(), [
        'COIL-A', 'COIL-B',
    ]);
});

test('coil_zero_inventory_with_scheme_binding', () => {
    const bound = bindRequirement();
    const requirement = bound.requirements[0];
    const fixture = inventoryEvidence(requirement, { schemeCode: 'COIL-0012', stock: 0 });
    const state = reduceObservation(bound, fixture);
    const claims = buildClaimsFromInvestigation({ state, evidenceLedger: fixture.ledger });
    assert.equal(state.status, 'completed');
    assert.equal(state.numericFacts[0].numericValue, 0);
    assert.equal(claims[0].value, 0);
    assert.equal(claims[0].subject.stableEntityIdentity.stableBusinessKeys.schemeCode, 'COIL-0012');
});

test('wrong_scheme_code_evidence_rejected', () => {
    const bound = bindRequirement();
    const requirement = bound.requirements[0];
    const fixture = inventoryEvidence(requirement, { schemeCode: 'COIL-OTHER', stock: 9 });
    const state = reduceObservation(bound, fixture);
    assert.equal(state.requirements[0].status, 'open');
    assert.equal(state.numericFacts.length, 0);
});

test('numeric_id_and_scheme_code_consistent_identity', () => {
    const full = normalizeStableEntityIdentity({ entityType: 'coil', record: formalCoil() });
    assert.equal(stableEntityIdentityMatches(full, {
        entityType: 'coil', primaryStableId: 12, stableBusinessKeys: { schemeCode: 'COIL-0012' },
    }), true);
    assert.equal(stableEntityIdentityMatches(full, {
        entityType: 'coil', stableBusinessKeys: { schemeCode: 'COIL-0012' },
    }), true);
});

test('conflicting_id_and_scheme_code_fail_closed', () => {
    const binding = normalizeStableEntityIdentity({ entityType: 'coil', record: formalCoil(12, 'COIL-A') });
    assert.equal(stableEntityIdentityComparison(binding, {
        entityType: 'coil', primaryStableId: 12, stableBusinessKeys: { schemeCode: 'COIL-B' },
    }), 'conflict');
    assert.equal(stableEntityIdentityMatches(binding, {
        entityType: 'coil', primaryStableId: 13, stableBusinessKeys: { schemeCode: 'COIL-A' },
    }), false);
});

test('part_template_recipe bindings retain existing stable identities and entity types never merge', () => {
    const fixtures = [
        ['part', { id: 1, model: 'SAME' }],
        ['template', { id: 2, shellModel: 'SAME' }],
        ['recipe', { id: 3, name: 'SAME' }],
    ].map(([entityType, record]) => normalizeStableEntityIdentity({ entityType, record }));
    assert.equal(fixtures[0].stableBusinessKeys.model, 'SAME');
    assert.equal(fixtures[1].stableBusinessKeys.shellModel, 'SAME');
    assert.equal(fixtures[2].stableBusinessKeys.name, 'SAME');
    assert.equal(stableEntityIdentityMatches(fixtures[0], fixtures[1]), false);
    assert.equal(stableEntityIdentityMatches(fixtures[1], fixtures[2]), false);
});
