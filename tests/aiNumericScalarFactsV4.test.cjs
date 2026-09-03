const test = require('node:test');
const assert = require('node:assert/strict');

const { selectNextCapability } = require('../api/services/aiCapabilityBrokerV4.cjs');
const {
    buildClaimsFromInvestigation,
    validateClaims,
} = require('../api/services/aiClaimGroundingV4.cjs');
const { createFactRequirement, createInvestigationGoal, createInvestigationState } = require('../api/services/aiFactModelV4.cjs');
const { reduceObservation } = require('../api/services/aiFactReducerV4.cjs');
const { composeGroundedAnswerV4 } = require('../api/services/aiGroundedAnswerV4.cjs');
const { normalizeIntentPlan, plannerTool } = require('../api/services/aiGoalPlannerV3.cjs');
const {
    CURRENT_INVENTORY_SCENARIO,
    INVENTORY_QUANTITY_PREDICATE,
    materializeNumericBusinessScalarFact,
} = require('../api/services/aiNumericScalarFactsV4.cjs');
const { createEvidenceLedger, createObservation } = require('../api/services/aiObservationV3.cjs');
const {
    replayReadInvestigationProjection,
    replayReadInvestigationShadow,
} = require('../api/services/aiReadInvestigationRuntimeV4.cjs');

function inventoryRequirement(entityType, entityId, overrides = {}) {
    return createFactRequirement({
        identity: {
            entityType,
            entityId,
            predicate: overrides.predicate || INVENTORY_QUANTITY_PREDICATE,
            temporalScope: overrides.temporalScope || 'current',
            scenario: overrides.scenario || CURRENT_INVENTORY_SCENARIO,
            qualifiers: overrides.qualifiers || {},
        },
        requiredSourceOfTruth: overrides.requiredSourceOfTruth || null,
    });
}

function verifiedResult(entityType, row) {
    return {
        success: true,
        [entityType === 'part' ? 'parts' : 'coils']: [row],
        executionEvidence: {
            verified: true,
            kind: 'formal_api_query',
            calls: [{ method: 'GET', path: entityType === 'part' ? '/api/parts' : '/api/coils', outcome: 'success' }],
        },
    };
}

function materializedFixture(entityType, entityId, stock, overrides = {}) {
    const requirement = inventoryRequirement(entityType, String(entityId), overrides);
    const capabilityName = entityType === 'part' ? 'search_parts' : 'search_coils';
    const result = verifiedResult(entityType, {
        id: entityId,
        ...(entityType === 'part' ? { model: `P-${entityId}` } : { spec: `C-${entityId}` }),
        stock,
        ...overrides.row,
    });
    const ledger = createEvidenceLedger();
    const observation = createObservation({
        attempted: true,
        observationId: `O-${entityType}-${entityId}`,
        outcome: 'success_non_empty',
        capabilityName,
        factKey: requirement.factKey,
        verified: true,
        sourceOfTruth: entityType === 'part' ? 'partsService' : 'coilService',
        result,
    });
    const evidence = ledger.appendObservation(observation, {
        toolResult: { name: capabilityName, result },
    });
    const state = reduceObservation(createInvestigationState({
        goalId: `G-${entityType}-${entityId}`,
        requirements: [requirement],
    }), { observation, evidence });
    const claims = buildClaimsFromInvestigation({
        state,
        evidenceLedger: ledger.snapshot(),
        observations: [observation],
    });
    return { requirement: state.requirements[0], state, claims, evidence, observation, ledger: ledger.snapshot() };
}

test('part_current_inventory_numeric_fact', () => {
    const fixture = materializedFixture('part', 11, 37);
    assert.equal(fixture.state.status, 'completed');
    assert.equal(fixture.requirement.status, 'satisfied');
    assert.deepEqual(fixture.state.numericFacts[0].subject, {
        entityType: 'part', entityId: '11', canonicalName: 'P-11',
    });
    assert.equal(fixture.state.numericFacts[0].numericValue, 37);
    assert.equal(fixture.state.numericFacts[0].temporalScope, 'current');
    assert.deepEqual(fixture.state.numericFacts[0].evidenceRefs, [fixture.evidence.evidenceId]);
});

test('part_zero_inventory_is_valid_scalar', () => {
    const fixture = materializedFixture('part', 12, 0);
    assert.equal(fixture.requirement.status, 'satisfied');
    assert.equal(fixture.state.numericFacts[0].numericValue, 0);
    assert.equal(fixture.claims[0].value, 0);
});

test('coil_current_inventory_numeric_fact', () => {
    const fixture = materializedFixture('coil', 21, 8);
    const fact = fixture.state.numericFacts[0];
    assert.equal(fact.subject.entityType, 'coil');
    assert.equal(fact.numericValue, 8);
    assert.equal(fact.unit, '套');
    assert.equal(fact.sourceOfTruth, 'coilService');
    assert.deepEqual(fact.evidenceRefs, [fixture.evidence.evidenceId]);
});

test('coil_zero_inventory', () => {
    const fixture = materializedFixture('coil', 22, 0);
    assert.equal(fixture.requirement.status, 'satisfied');
    assert.equal(fixture.state.numericFacts[0].numericValue, 0);
    assert.equal(fixture.claims[0].value, 0);
    assert.equal(fixture.claims[0].unit, '套');
});

test('inventory_quantity_not_status', () => {
    const quantity = inventoryRequirement('part', '31');
    const status = inventoryRequirement('part', '31', { predicate: 'currentStatus' });
    assert.notEqual(quantity.factKey, status.factKey);
    const fixture = materializedFixture('part', 31, 0);
    assert.equal(materializeNumericBusinessScalarFact(status, fixture.evidence), null);
    assert.equal(fixture.claims[0].predicate, 'inventory.quantity');
    assert.equal(fixture.claims[0].claimType, 'scalar_value');

    const result = verifiedResult('coil', { id: 32, spec: 'C-32', stock: 0, schemeStatus: 'official' });
    const statusRequirement = inventoryRequirement('coil', '32', { predicate: 'currentStatus' });
    const ledger = createEvidenceLedger();
    const observation = createObservation({
        attempted: true,
        outcome: 'success_non_empty',
        capabilityName: 'search_coils',
        factKey: statusRequirement.factKey,
        verified: true,
        sourceOfTruth: 'coilService',
        result,
    });
    const evidence = ledger.appendObservation(observation, { toolResult: { name: 'search_coils', result } });
    const statusState = reduceObservation(createInvestigationState({ requirements: [statusRequirement] }), {
        observation, evidence,
    });
    assert.equal(statusState.requirements[0].status, 'open');
    assert.deepEqual(buildClaimsFromInvestigation({ state: statusState, evidenceLedger: ledger.snapshot() }), []);
});

test('wrong_entity_inventory_evidence_rejected', () => {
    const wrongId = materializedFixture('part', 41, 5, { row: { id: 42 } });
    assert.equal(wrongId.requirement.status, 'open');
    assert.equal(wrongId.state.numericFacts.length, 0);

    const partRequirement = inventoryRequirement('part', '51');
    const coilFixture = materializedFixture('coil', 51, 6);
    const forgedScope = { ...coilFixture.evidence, factKey: partRequirement.factKey };
    assert.equal(materializeNumericBusinessScalarFact(partRequirement, forgedScope), null);
});

test('snapshot_cannot_satisfy_current_inventory', () => {
    const fixture = materializedFixture('part', 61, 7);
    const snapshot = { ...fixture.evidence, kind: 'historical_snapshot' };
    assert.equal(materializeNumericBusinessScalarFact(
        inventoryRequirement('part', '61'),
        snapshot
    ), null);
});

test('non_numeric_inventory_payload_is_not_coerced_into_business_fact', () => {
    for (const stock of [true, '0', '', null, Number.NaN, Number.POSITIVE_INFINITY]) {
        const fixture = materializedFixture('part', 62, stock);
        assert.equal(fixture.requirement.status, 'open');
        assert.equal(fixture.state.numericFacts.length, 0);
    }
});

test('claim_mapping_preserves_inventory_value', () => {
    const fixture = materializedFixture('part', 71, 13.5);
    assert.equal(fixture.claims[0].value, 13.5);
    assert.equal(fixture.claims[0].unit, '件');
    assert.equal(fixture.claims[0].temporalScope, 'current');
    assert.equal(fixture.claims[0].scenario, CURRENT_INVENTORY_SCENARIO);
    assert.deepEqual(fixture.claims[0].evidenceRefs, [fixture.evidence.evidenceId]);
});

test('zero_claim_survives_grounding', () => {
    const fixture = materializedFixture('coil', 81, 0);
    assert.equal(validateClaims(fixture.claims, {
        requirements: fixture.state.requirements,
        state: fixture.state,
        evidenceLedger: fixture.ledger,
    }).valid, true);
});

test('renderer_cannot_change_inventory_value', async () => {
    const fixtures = [
        materializedFixture('part', 91, 0),
        materializedFixture('part', 92, 2),
        materializedFixture('coil', 93, 3),
    ];
    const requirements = fixtures.map((item, index) => createFactRequirement({
        ...item.requirement,
        identity: item.requirement.identity,
        evidenceIds: [`E-${index + 1}`],
    }));
    const numericFacts = fixtures.map((item, index) => ({
        ...item.state.numericFacts[0], evidenceRefs: [`E-${index + 1}`],
    }));
    const evidenceLedger = fixtures.map((item, index) => ({
        ...item.evidence, evidenceId: `E-${index + 1}`,
    }));
    const state = createInvestigationState({
        goalId: 'renderer-inventory-mutation', requirements, numericFacts, status: 'completed',
    });
    const result = await composeGroundedAnswerV4({
        goal: '汇总当前库存', state, evidenceLedger, answerShape: 'explanation',
        renderer: async (_messages, _options) => new Response(JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ blocks: [{
                type: 'claim_list',
                claimRefs: ['claim-1', 'claim-2', 'claim-3'],
                claimPresentations: fixtures.map((item, index) => {
                    const claim = buildClaimsFromInvestigation({ state, evidenceLedger })[index];
                    return {
                        claimRef: claim.claimId,
                        claimType: claim.claimType,
                        subject: claim.subject,
                        predicate: claim.predicate,
                        value: index === 0 ? 1 : claim.value,
                        unit: claim.unit,
                        temporalScope: claim.temporalScope,
                        scenario: claim.scenario,
                    };
                }),
            }] }) } }],
        })),
    });
    assert.equal(result.rendering, 'deterministic_fallback');
    assert.equal(result.claims[0].value, 0);
    assert.ok(result.renderingErrors.some(error => error.code === 'RENDER_VALUE_CHANGED'));
});

test('broker selects inventory capability from Fact despite wrong planner hint', () => {
    const requirement = inventoryRequirement('coil', null);
    const goal = createInvestigationGoal({
        goalId: 'inventory-broker', goal: '读取当前库存', mode: 'query', entityScope: 'single',
        domains: ['coil'], requirements: [requirement],
    });
    const state = createInvestigationState({ goalId: goal.goalId, requirements: goal.requirements });
    const decision = selectNextCapability({ goal, state, planHints: ['calculate_coil_cost'] });
    assert.equal(decision.capabilityName, 'search_coils');
});

test('planner emits canonical inventory Fact intent independent of capability step', () => {
    const tool = plannerTool({ domains: ['catalog'], mode: 'query', entityScope: 'single' });
    assert.ok(tool.function.parameters.required.includes('requiredFactIntents'));
    const normalized = normalizeIntentPlan({
        goal: '读取指定零件当前库存数量',
        mode: 'query',
        domains: ['catalog'],
        needsBusinessData: true,
        contextMode: 'current_turn',
        answerShape: 'direct',
        entityScope: 'single',
        requiresClarification: false,
        ambiguities: [],
        confidence: 'high',
        requiredFactIntents: [{
            entityType: 'part',
            predicate: INVENTORY_QUANTITY_PREDICATE,
            temporalScope: 'current',
            scenario: CURRENT_INVENTORY_SCENARIO,
        }],
        steps: [{ capabilityName: 'search_parts', objective: '读取正式零件记录' }],
    });
    assert.deepEqual(normalized.requiredFactIntents, [{
        entityType: 'part',
        predicate: INVENTORY_QUANTITY_PREDICATE,
        temporalScope: 'current',
        scenario: CURRENT_INVENTORY_SCENARIO,
        qualifiers: {},
    }]);
});

test('shadow replay uses the same inventory Fact signature and materializer as Broker', () => {
    const result = verifiedResult('part', { id: 101, model: 'P-101', stock: 0 });
    const observation = createObservation({
        attempted: true,
        observationId: 'shadow-inventory-observation',
        outcome: 'success_non_empty',
        capabilityName: 'search_parts',
        factKey: 'legacy-source-fact',
        verified: true,
        sourceOfTruth: 'partsService',
        result,
    });
    const ledger = createEvidenceLedger();
    const evidence = ledger.appendObservation(observation, {
        toolResult: { name: 'search_parts', result },
    });
    const replayInput = {
        intent: {
            goal: '读取 P-101 当前库存数量',
            mode: 'query',
            entityScope: 'single',
            domains: ['catalog'],
            targetMentions: ['P-101'],
            requiredFactIntents: [{
                entityType: 'part', predicate: INVENTORY_QUANTITY_PREDICATE,
                temporalScope: 'current', scenario: CURRENT_INVENTORY_SCENARIO,
            }],
            steps: [{ capabilityName: 'search_parts' }],
        },
        originalTarget: 'P-101',
        observations: [observation],
        evidenceRecords: [evidence],
    };
    const projection = replayReadInvestigationProjection(replayInput);
    const state = projection.state;
    assert.equal(state.status, 'completed');
    assert.equal(state.numericFacts[0].numericValue, 0);
    assert.equal(state.numericFacts[0].subject.entityId, '101');
    const claims = buildClaimsFromInvestigation({
        state,
        observations: projection.observations,
        evidenceLedger: projection.evidenceLedger,
    });
    assert.equal(claims[0].value, 0);
    assert.equal(validateClaims(claims, {
        requirements: state.requirements,
        state,
        observations: projection.observations,
        evidenceLedger: projection.evidenceLedger,
    }).valid, true);
    assert.equal(replayReadInvestigationShadow(replayInput).status, state.status);
});
