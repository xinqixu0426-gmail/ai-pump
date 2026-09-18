const test = require('node:test');
const assert = require('node:assert/strict');

const { createFactRequirement, createInvestigationState } = require('../api/services/aiFactModelV4.cjs');
const { createEvidenceLedger, createObservation } = require('../api/services/aiObservationV3.cjs');
const {
    buildClaimsFromInvestigation,
    claimIdentityKey,
    createClaim,
    requiredFactCoverage,
    validateClaimAgainstEvidence,
    validateClaims,
} = require('../api/services/aiClaimGroundingV4.cjs');
const {
    answerPlanCoverage,
    buildAnswerPlan,
    composeGroundedAnswerV4,
    formatAnswerPlanDeterministically,
    validateRenderedAnswer,
} = require('../api/services/aiGroundedAnswerV4.cjs');

function requirement(options = {}) {
    return createFactRequirement({
        identity: {
            entityType: options.entityType || 'part',
            entityId: options.entityId ?? '42',
            predicate: options.predicate || 'currentScalar',
            temporalScope: options.temporalScope || 'current',
            scenario: options.scenario || 'catalog_current',
            qualifiers: options.qualifiers || {},
        },
        status: options.status || 'satisfied',
        optional: options.optional || false,
        evidenceIds: options.evidenceIds || [],
        observationIds: options.observationIds || [],
        reason: options.reason || null,
    });
}

function evidenceFixture(req, result, capabilityName = 'search_parts') {
    const ledger = createEvidenceLedger();
    const observation = createObservation({
        attempted: true,
        observationId: `observation:${capabilityName}`,
        outcome: 'success_non_empty',
        capabilityName,
        factKey: req.factKey,
        verified: true,
        sourceOfTruth: 'formal-test-api',
        result,
    });
    const evidence = ledger.appendObservation(observation, {
        toolResult: { name: capabilityName, result },
    });
    return { evidence, ledger: ledger.snapshot(), observation };
}

function satisfiedFixture(options = {}) {
    const initial = requirement(options);
    const result = options.result || {
        success: true,
        parts: [{ id: 42, model: '800平刀切割泵壳', price: 95 }],
    };
    const evidenceData = evidenceFixture(initial, result, options.capabilityName);
    const req = requirement({ ...options, evidenceIds: [evidenceData.evidence.evidenceId] });
    const state = createInvestigationState({
        goalId: 'claim-test',
        requirements: [req],
        status: options.investigationStatus || 'completed',
    });
    const claims = buildClaimsFromInvestigation({
        state,
        evidenceLedger: evidenceData.ledger,
        observations: [evidenceData.observation],
    });
    return { req, state, claims, ...evidenceData };
}

function presentation(claim, updates = {}) {
    return {
        claimRef: claim.claimId,
        claimType: claim.claimType,
        subject: claim.subject,
        predicate: claim.predicate,
        value: claim.value,
        unit: claim.unit,
        temporalScope: claim.temporalScope,
        scenario: claim.scenario,
        ...updates,
    };
}

test('claim_requires_evidence', () => {
    const req = requirement();
    const claim = createClaim({
        claimId: 'C1',
        claimType: 'scalar_value',
        factKey: req.factKey,
        subject: { entityType: 'part', entityId: '42', canonicalName: '目标零件' },
        predicate: 'price.current',
        value: 95,
        unit: 'CNY',
        temporalScope: 'current',
        scenario: 'catalog_current',
    });
    const validation = validateClaimAgainstEvidence(claim, { requirements: [req], evidenceLedger: [] });
    assert.equal(validation.valid, false);
    assert.equal(validation.code, 'CLAIM_EVIDENCE_REQUIRED');
    assert.deepEqual(buildClaimsFromInvestigation({
        state: createInvestigationState({ requirements: [req], status: 'completed' }),
        evidenceLedger: [],
    }), []);
});

test('evidence_scope_must_match_claim', () => {
    const fixture = satisfiedFixture();
    const base = fixture.claims[0];
    for (const mutation of [
        { subject: { ...base.subject, entityType: 'template' } },
        { predicate: 'inventory.current' },
        { temporalScope: 'saved_snapshot' },
        { scenario: 'saved_recipe_snapshot' },
    ]) {
        const invalid = createClaim({ ...base, ...mutation });
        assert.equal(validateClaimAgainstEvidence(invalid, {
            requirements: [fixture.req],
            evidenceLedger: fixture.ledger,
        }).valid, false);
    }
});

test('Claim identity 必须由 Claim 业务范围重新计算', () => {
    const fixture = satisfiedFixture();
    const forged = { ...fixture.claims[0], claimIdentity: 'forged-identity' };
    const validation = validateClaimAgainstEvidence(forged, {
        requirements: [fixture.req],
        evidenceLedger: fixture.ledger,
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.code, 'CLAIM_IDENTITY_MISMATCH');
});

test('Claim 的每条 Evidence 引用都必须属于同一 Fact 并支持同一结论', () => {
    const fixture = satisfiedFixture();
    const other = satisfiedFixture({
        entityId: '99',
        result: { success: true, parts: [{ id: 99, model: '另一个零件', price: 12 }] },
    });
    const forged = createClaim({
        ...fixture.claims[0],
        evidenceRefs: [fixture.evidence.evidenceId, other.evidence.evidenceId],
    });
    const validation = validateClaimAgainstEvidence(forged, {
        requirements: [fixture.req],
        evidenceLedger: [...fixture.ledger, ...other.ledger],
    });
    assert.equal(validation.valid, false);
    assert.equal(validation.code, 'CLAIM_EVIDENCE_SCOPE_MISMATCH');
});

test('required_fact_requires_claim_coverage', () => {
    const first = satisfiedFixture();
    const second = requirement({
        entityType: 'coil',
        entityId: '9',
        predicate: 'currentStatus',
        scenario: 'coil_current',
    });
    const coverage = requiredFactCoverage([first.req, second], first.claims);
    assert.equal(coverage.complete, false);
    assert.deepEqual(coverage.missingFactKeys, [second.factKey]);
    const plan = buildAnswerPlan({ claims: first.claims, requirements: [first.req, second] });
    assert.equal(plan.factCoverage.complete, false);
    assert.equal(answerPlanCoverage({
        requiredClaimRefs: [first.claims[0].claimId],
        blocks: [{
            type: 'explanation',
            claimRefs: [],
            premiseClaimRefs: [first.claims[0].claimId],
        }],
    }, first.claims).complete, false);
});

test('renderer_cannot_change_claim_value', () => {
    const fixture = satisfiedFixture();
    const plan = buildAnswerPlan({ claims: fixture.claims, requirements: [fixture.req] });
    const claim = fixture.claims[0];
    const validation = validateRenderedAnswer({ blocks: [{
        type: 'direct_claim',
        claimRefs: [claim.claimId],
        claimPresentations: [presentation(claim, { value: 96 })],
    }] }, plan, fixture.claims);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(item => item.code === 'RENDER_VALUE_CHANGED'));
});

test('renderer 的 presentations 必须与 factual Claim refs 精确一一对应', () => {
    const first = satisfiedFixture();
    const second = satisfiedFixture({
        entityId: '99',
        result: { success: true, parts: [{ id: 99, model: '另一个零件', price: 12 }] },
    });
    const claims = [first.claims[0], second.claims[0]];
    const plan = buildAnswerPlan({ claims, requirements: [first.req, second.req] });
    const validation = validateRenderedAnswer({ blocks: [{
        type: 'direct_claim',
        claimRefs: claims.map(claim => claim.claimId),
        claimPresentations: [presentation(first.claims[0]), presentation(first.claims[0])],
    }] }, plan, claims);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(item => item.code === 'RENDER_CLAIM_PRESENTATION_INCOMPLETE'));
});

test('renderer_cannot_change_entity', () => {
    const fixture = satisfiedFixture();
    const plan = buildAnswerPlan({ claims: fixture.claims, requirements: [fixture.req] });
    const claim = fixture.claims[0];
    const validation = validateRenderedAnswer({ blocks: [{
        type: 'direct_claim',
        claimRefs: [claim.claimId],
        claimPresentations: [presentation(claim, {
            subject: { entityType: 'template', entityId: '42', canonicalName: '另一个对象' },
        })],
    }] }, plan, fixture.claims);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(item => item.code === 'RENDER_SUBJECT_CHANGED'));
});

test('renderer_cannot_change_temporal_scenario', () => {
    const fixture = satisfiedFixture();
    const plan = buildAnswerPlan({ claims: fixture.claims, requirements: [fixture.req] });
    const claim = fixture.claims[0];
    const validation = validateRenderedAnswer({ blocks: [{
        type: 'direct_claim',
        claimRefs: [claim.claimId],
        claimPresentations: [presentation(claim, {
            temporalScope: 'saved_snapshot',
            scenario: 'saved_recipe_snapshot',
        })],
    }] }, plan, fixture.claims);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(item => item.code === 'RENDER_TEMPORALSCOPE_CHANGED'));
    assert.ok(validation.errors.some(item => item.code === 'RENDER_SCENARIO_CHANGED'));
});

test('verified_negative_not_equal_unavailable', () => {
    const req = requirement({ predicate: 'verifiedNotFound', status: 'negative_satisfied' });
    const ledger = createEvidenceLedger();
    const observation = createObservation({
        attempted: true,
        observationId: 'negative-observation',
        outcome: 'success_empty',
        capabilityName: 'search_parts',
        factKey: req.factKey,
        verified: true,
        result: { success: true, parts: [] },
    });
    const evidence = ledger.appendObservation(observation, {
        toolResult: { name: 'search_parts', result: observation.result },
    });
    const bound = requirement({
        predicate: 'verifiedNotFound',
        status: 'negative_satisfied',
        evidenceIds: [evidence.evidenceId],
    });
    const state = createInvestigationState({ requirements: [bound], status: 'completed_negative' });
    const claims = buildClaimsFromInvestigation({ state, evidenceLedger: ledger.snapshot() });
    assert.equal(claims[0].claimType, 'verified_not_found');
    const plan = buildAnswerPlan({ claims, requirements: [bound] });
    const validation = validateRenderedAnswer({ blocks: [{
        type: 'unavailable',
        claimRefs: [claims[0].claimId],
    }] }, plan, claims);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(item => item.code === 'RENDER_NEGATIVE_AVAILABILITY_CHANGED'));
});

test('ambiguity_cannot_be_auto_resolved', () => {
    const req = requirement({
        predicate: 'ambiguity',
        status: 'needs_clarification',
        observationIds: ['ambiguous-observation'],
    });
    const observation = createObservation({
        attempted: true,
        observationId: 'ambiguous-observation',
        outcome: 'ambiguous',
        capabilityName: 'search_parts',
        factKey: req.factKey,
        verified: false,
        result: { resolutionReceipt: { candidates: [
            { id: 1, name: '候选零件' },
            { id: 2, name: '候选模板', entityType: 'template' },
        ] } },
    });
    const state = createInvestigationState({ requirements: [req], status: 'needs_clarification' });
    const claims = buildClaimsFromInvestigation({ state, observations: [observation], evidenceLedger: [] });
    const plan = buildAnswerPlan({ claims, requirements: [req] });
    const validation = validateRenderedAnswer({ blocks: [{
        type: 'clarification',
        claimRefs: [claims[0].claimId],
        selectedClaimRef: claims[0].claimId,
    }] }, plan, claims);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(item => item.code === 'RENDER_AMBIGUITY_RESOLVED'));
});

test('unavailable 必须绑定匹配 Observation 或 terminal InvestigationState', () => {
    const req = requirement({ status: 'unavailable', reason: 'timeout' });
    const state = createInvestigationState({
        goalId: 'unavailable-test',
        requirements: [req],
        status: 'failed_unverified',
    });
    const claims = buildClaimsFromInvestigation({ state, observations: [], evidenceLedger: [] });
    assert.equal(validateClaimAgainstEvidence(claims[0], {
        requirements: [req], state, observations: [], evidenceLedger: [],
    }).valid, true);
    const forged = createClaim({ ...claims[0], stateRef: 'investigation:other:completed' });
    assert.equal(validateClaimAgainstEvidence(forged, {
        requirements: [req],
        state: createInvestigationState({
            goalId: 'unavailable-test',
            requirements: [req],
            status: 'completed',
        }),
        observations: [],
        evidenceLedger: [],
    }).valid, false);
});

test('unsupported_business_number_rejected', () => {
    const fixture = satisfiedFixture();
    const plan = buildAnswerPlan({ claims: fixture.claims, requirements: [fixture.req] });
    const validation = validateRenderedAnswer({ blocks: [{
        type: 'direct_claim',
        claimRefs: [fixture.claims[0].claimId],
        businessNumbers: [190],
    }] }, plan, fixture.claims);
    assert.equal(validation.valid, false);
    assert.ok(validation.errors.some(item => item.code === 'RENDER_UNSUPPORTED_BUSINESS_NUMBER'));
});

test('rendering_failure_preserves_valid_claims', async () => {
    const requirements = [];
    const ledger = [];
    for (let index = 1; index <= 3; index += 1) {
        const req = requirement({
            entityId: String(index),
            qualifiers: { valuePath: `data.value${index}`, unit: 'CNY' },
            scenario: `configured_cost_${index}`,
        });
        const result = { success: true, data: { id: index, model: `配置 ${index}`, [`value${index}`]: index * 10 } };
        const fixture = evidenceFixture(req, result);
        requirements.push(requirement({
            entityId: String(index),
            qualifiers: { valuePath: `data.value${index}`, unit: 'CNY' },
            scenario: `configured_cost_${index}`,
            evidenceIds: [fixture.evidence.evidenceId],
        }));
        ledger.push(...fixture.ledger.map(item => ({ ...item, evidenceId: `E${index}` })));
        requirements[index - 1] = createFactRequirement({
            ...requirements[index - 1],
            evidenceIds: [`E${index}`],
            identity: requirements[index - 1].identity,
        });
    }
    const state = createInvestigationState({ requirements, status: 'completed' });
    let attempts = 0;
    const renderer = async () => {
        attempts += 1;
        return new Response(JSON.stringify({ choices: [{ message: { content: '{invalid-json' } }] }));
    };
    const result = await composeGroundedAnswerV4({
        goal: '说明完整配置成本',
        state,
        evidenceLedger: ledger,
        answerShape: 'explanation',
        renderer,
    });
    assert.equal(attempts, 2);
    assert.equal(result.rendering, 'deterministic_fallback');
    assert.equal(result.claims.length, 3);
    assert.match(result.content, /¥10/);
    assert.match(result.content, /¥20/);
    assert.match(result.content, /¥30/);
});

test('混合 control Claim 的复杂答案不进入 LLM renderer', async () => {
    const satisfied = satisfiedFixture();
    const failedRequirement = requirement({
        entityType: 'coil',
        entityId: '9',
        predicate: 'currentStatus',
        scenario: 'coil_current',
        status: 'unavailable',
        reason: 'timeout',
    });
    const extra = satisfiedFixture({
        entityId: '99',
        capabilityName: 'search_parts_secondary',
        result: { success: true, parts: [{ id: 99, model: '另一个零件', price: 12 }] },
    });
    const firstEvidenceId = 'mixed-evidence-1';
    const secondEvidenceId = 'mixed-evidence-2';
    const firstRequirement = createFactRequirement({
        ...satisfied.req,
        identity: satisfied.req.identity,
        evidenceIds: [firstEvidenceId],
    });
    const secondRequirement = createFactRequirement({
        ...extra.req,
        identity: extra.req.identity,
        evidenceIds: [secondEvidenceId],
    });
    const requirements = [firstRequirement, secondRequirement, failedRequirement];
    const state = createInvestigationState({
        goalId: 'mixed-control-claims',
        requirements,
        status: 'failed_unverified',
    });
    let rendererCalls = 0;
    const result = await composeGroundedAnswerV4({
        goal: '汇总已验证和未完成的事实',
        state,
        evidenceLedger: [
            ...satisfied.ledger.map(item => ({ ...item, evidenceId: firstEvidenceId })),
            ...extra.ledger.map(item => ({ ...item, evidenceId: secondEvidenceId })),
        ],
        observations: [],
        answerShape: 'explanation',
        renderer: async () => {
            rendererCalls += 1;
            throw new Error('control Claim 不应交给 renderer');
        },
    });
    assert.equal(rendererCalls, 0);
    assert.equal(result.rendering, 'deterministic', JSON.stringify(result));
    assert.ok(result.claims.some(claim => claim.claimType === 'unavailable'));
});

test('later_model_error_does_not_destroy_grounded_answer', async () => {
    const fixture = satisfiedFixture();
    let rendererCalls = 0;
    const result = await composeGroundedAnswerV4({
        goal: '800平刀切割泵壳现在多少钱',
        state: fixture.state,
        evidenceLedger: fixture.ledger,
        observations: [fixture.observation],
        answerShape: 'direct',
        renderer: async () => {
            rendererCalls += 1;
            throw new Error('later model error');
        },
    });
    assert.equal(rendererCalls, 0);
    assert.equal(result.rendering, 'deterministic');
    assert.equal(result.claims[0].value, 95);
    assert.match(result.content, /¥95/);
});

test('current cost 与 saved snapshot 保持不同 Claim identity', () => {
    const subject = { entityType: 'recipe', entityId: '7', canonicalName: 'V750' };
    const current = claimIdentityKey({
        subject,
        predicate: 'cost.current.recipe',
        temporalScope: 'current',
        scenario: 'current_recipe_cost',
    });
    const saved = claimIdentityKey({
        subject,
        predicate: 'cost.saved.snapshot',
        temporalScope: 'saved_snapshot',
        scenario: 'saved_recipe_snapshot',
    });
    assert.notEqual(current, saved);
});

test('配置成本 required facts 必须逐项进入 Claims 和 AnswerPlan', () => {
    const facts = [
        { name: 'template', value: { id: 1, model: '配置模板' } },
        { name: 'coil', value: { id: 2, schemeCode: '配置线圈' } },
        { name: 'float', value: { enabled: true } },
        { name: 'packing', value: { mode: 'grouped' } },
        { name: 'configured_cost', value: 168.5 },
    ];
    const requirements = [];
    const evidenceLedger = [];
    for (const [index, fact] of facts.entries()) {
        const baseRequirement = requirement({
            entityType: index === 4 ? 'recipe' : fact.name,
            entityId: String(index + 1),
            predicate: index === 4 ? 'currentScalar' : 'singleResourceDetail',
            scenario: index === 4 ? 'current_full_cost' : `configured_${fact.name}`,
            qualifiers: index === 4
                ? { valuePath: 'data.costPreview.currentTotalCost', unit: 'CNY' }
                : { valuePath: `data.${fact.name}`, claimType: 'relationship' },
        });
        const data = index === 4
            ? { id: index + 1, recipeName: '完整配置', costPreview: { currentTotalCost: fact.value } }
            : { id: index + 1, name: fact.name, [fact.name]: fact.value };
        const fixture = evidenceFixture(baseRequirement, { success: true, data }, `configured_${fact.name}`);
        const evidenceId = `configured-evidence-${index + 1}`;
        requirements.push(requirement({
            entityType: index === 4 ? 'recipe' : fact.name,
            entityId: String(index + 1),
            predicate: index === 4 ? 'currentScalar' : 'singleResourceDetail',
            scenario: index === 4 ? 'current_full_cost' : `configured_${fact.name}`,
            qualifiers: index === 4
                ? { valuePath: 'data.costPreview.currentTotalCost', unit: 'CNY' }
                : { valuePath: `data.${fact.name}`, claimType: 'relationship' },
            evidenceIds: [evidenceId],
        }));
        evidenceLedger.push(...fixture.ledger.map(item => ({ ...item, evidenceId })));
    }
    const state = createInvestigationState({
        goalId: 'configured-cost-coverage',
        requirements,
        status: 'completed',
    });
    const claims = buildClaimsFromInvestigation({ state, evidenceLedger });
    assert.equal(validateClaims(claims, { requirements, evidenceLedger }).valid, true);
    assert.equal(claims.length, facts.length);
    const completePlan = buildAnswerPlan({ claims, requirements, answerShape: 'explanation' });
    assert.equal(completePlan.factCoverage.complete, true);
    assert.equal(completePlan.claimCoverage.complete, true);
    const incompleteClaims = claims.slice(0, -1);
    assert.equal(requiredFactCoverage(requirements, incompleteClaims).complete, false);
    assert.equal(answerPlanCoverage({
        ...completePlan,
        requiredClaimRefs: claims.map(claim => claim.claimId),
        blocks: [{ type: 'claim_list', claimRefs: incompleteClaims.map(claim => claim.claimId) }],
    }, claims).complete, false);
});

test('Claim 集合整体校验通过且确定性 formatter 不改变底层值', () => {
    const fixture = satisfiedFixture({ result: {
        success: true,
        parts: [{ id: 42, model: '目标零件', price: 168.5 }],
    } });
    const validation = validateClaims(fixture.claims, {
        requirements: [fixture.req],
        evidenceLedger: fixture.ledger,
    });
    assert.equal(validation.valid, true);
    const plan = buildAnswerPlan({ claims: fixture.claims, requirements: [fixture.req] });
    assert.match(formatAnswerPlanDeterministically(plan, fixture.claims), /¥168\.50/);
    assert.equal(fixture.claims[0].value, 168.5);
});

test('R3 feature flag 默认关闭且范围独立于 R2', () => {
    const { claimGroundingFlags, eligibleClaimGroundingIntent } = require('../api/services/aiGroundedAnswerV4.cjs');
    assert.equal(claimGroundingFlags({}).enabled, false);
    assert.equal(claimGroundingFlags({ AI_CLAIM_GROUNDING_V4_ENABLED: 'TRUE' }).enabled, true);
    assert.equal(eligibleClaimGroundingIntent({
        mode: 'query', entityScope: 'single', domains: ['catalog'],
    }), true);
    assert.equal(eligibleClaimGroundingIntent({
        mode: 'command', entityScope: 'single', domains: ['catalog'],
    }), false);
    assert.equal(eligibleClaimGroundingIntent({
        mode: 'query', entityScope: 'collection', domains: ['catalog'],
    }), false);
    assert.equal(eligibleClaimGroundingIntent({
        mode: 'query', entityScope: 'single', domains: ['order'],
    }), false);
});
