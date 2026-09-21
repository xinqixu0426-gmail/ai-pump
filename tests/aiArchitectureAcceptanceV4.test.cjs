const test = require('node:test');
const assert = require('node:assert/strict');

const {
    aggregateArchitectureMetrics,
    buildExpectedClaimSet,
    claimBusinessIdentityKey,
    createArchitectureAcceptanceCase,
    evaluateArchitectureAcceptanceCase,
    runArchitectureAcceptanceSuite,
} = require('../api/services/aiArchitectureAcceptanceV4.cjs');
const { createClaim } = require('../api/services/aiClaimGroundingV4.cjs');
const {
    buildAnswerPlan,
    composeGroundedAnswerV4,
} = require('../api/services/aiGroundedAnswerV4.cjs');
const {
    createFactRequirement,
    createInvestigationState,
} = require('../api/services/aiFactModelV4.cjs');

const DOMAIN_FIXTURES = Object.freeze({
    part: { entityType: 'part', predicate: 'price.current', scenario: 'catalog_current', capability: 'search_parts' },
    coil: { entityType: 'coil', predicate: 'inventory.current', scenario: 'coil_current', capability: 'search_coils' },
    template: { entityType: 'template', predicate: 'cost.current.template', scenario: 'current_template_cost', capability: 'search_templates' },
    recipe: { entityType: 'recipe', predicate: 'singleResourceDetail', scenario: 'recipe_detail', capability: 'get_all_recipes' },
    cost: { entityType: 'recipe', predicate: 'cost.current.recipe', scenario: 'current_recipe_cost', capability: 'preview_recipe_cost' },
});

function expectedFromOracle(domain, oracle, overrides = {}) {
    const fixture = DOMAIN_FIXTURES[domain];
    return {
        claimType: overrides.claimType || 'scalar_value',
        factKey: Object.prototype.hasOwnProperty.call(overrides, 'factKey')
            ? overrides.factKey
            : `${domain}-fact`,
        subject: { entityType: fixture.entityType, entityId: oracle.entityId },
        predicate: overrides.predicate || fixture.predicate,
        value: overrides.value === undefined ? oracle.value : overrides.value,
        unit: overrides.unit === undefined ? oracle.unit : overrides.unit,
        temporalScope: overrides.temporalScope || 'current',
        scenario: overrides.scenario || fixture.scenario,
        qualifiers: overrides.qualifiers || {},
        evidenceClasses: overrides.evidenceClasses || ['live_business'],
        sourceOfTruth: overrides.sourceOfTruth || oracle.source || 'formal-test-service',
    };
}

function acceptanceCase(overrides = {}) {
    const domain = overrides.domain || 'part';
    return createArchitectureAcceptanceCase({
        caseKey: overrides.caseKey || `${domain}-case`,
        domain,
        userQuestion: overrides.userQuestion || `查询 ${domain} 正式业务事实`,
        mode: overrides.mode || 'query',
        entityScope: 'single',
        setup: overrides.setup || (async () => ({ fixtureValue: 41.25, entityId: 'fixture-1' })),
        oracleBuilder: overrides.oracleBuilder || (async setup => ({
            status: 'ready',
            value: setup.fixtureValue,
            unit: 'CNY',
            entityId: setup.entityId,
            source: 'formal-test-service',
        })),
        requiredFacts: overrides.requiredFacts || [{ predicate: DOMAIN_FIXTURES[domain].predicate }],
        expectedClaims: overrides.expectedClaims || (async ({ oracle }) => [expectedFromOracle(domain, oracle)]),
        allowedCapabilityClasses: overrides.allowedCapabilityClasses || ['query', 'preview'],
        optionalAllowedCapabilities: overrides.optionalAllowedCapabilities || [],
        forbiddenSubstitutions: overrides.forbiddenSubstitutions || ['create_part', 'update_recipe'],
        requiredEvidenceClasses: overrides.requiredEvidenceClasses || ['live_business'],
        terminalState: overrides.terminalState || 'completed',
        semanticRequirements: overrides.semanticRequirements || {},
        writeBoundary: 'read_only',
        freshness: overrides.freshness || {},
    });
}

function materializeActual(testCase, expectedClaims, overrides = {}) {
    const claims = (overrides.claims || expectedClaims).map((expected, index) => createClaim({
        claimId: expected.claimId || `claim-${index + 1}`,
        claimType: expected.claimType,
        factKey: expected.factKey,
        subject: expected.subject,
        predicate: expected.predicate,
        value: expected.value,
        unit: expected.unit,
        temporalScope: expected.temporalScope,
        scenario: expected.scenario,
        qualifiers: expected.qualifiers,
        evidenceRefs: CONTROL_TYPES.has(expected.claimType) ? [] : [`evidence-${index + 1}`],
        observationRefs: CONTROL_TYPES.has(expected.claimType) ? [`observation-${index + 1}`] : [],
        stateRef: expected.claimType === 'unavailable'
            ? `investigation:r4a:${testCase.terminalState}`
            : null,
        certainty: CONTROL_TYPES.has(expected.claimType) ? 'unverified' : 'verified',
    }));
    const evidenceLedger = overrides.evidenceLedger || claims
        .filter(claim => !CONTROL_TYPES.has(claim.claimType))
        .map(claim => ({
            recordType: 'evidence',
            evidenceId: claim.evidenceRefs[0],
            kind: expectedClaims.find(expected => expected.factKey === claim.factKey)?.evidenceClasses[0] || 'live_business',
            factKey: claim.factKey,
            capabilityName: DOMAIN_FIXTURES[testCase.domain].capability,
            sourceOfTruth: 'formal-test-service',
            authorityTime: new Date().toISOString(),
        }));
    const requirements = claims.map(claim => ({ factKey: claim.factKey, optional: false }));
    const answerPlan = overrides.answerPlan || buildAnswerPlan({ claims, requirements, answerShape: 'explanation' });
    return {
        investigationState: {
            goalId: 'r4a',
            status: testCase.terminalState,
            requirements: claims.map(claim => ({
                factKey: claim.factKey,
                status: claim.claimType === 'verified_not_found'
                    ? 'negative_satisfied'
                    : claim.claimType === 'ambiguous'
                        ? 'needs_clarification'
                        : claim.claimType === 'unavailable'
                            ? 'unavailable'
                            : 'satisfied',
            })),
        },
        entityScope: 'single',
        claims,
        evidenceLedger,
        observations: overrides.observations || [],
        behaviorLog: overrides.behaviorLog || [],
        capabilityTrace: overrides.capabilityTrace || [{ name: DOMAIN_FIXTURES[testCase.domain].capability }],
        answerPlan,
        ...overrides,
    };
}

const CONTROL_TYPES = new Set(['ambiguous', 'unavailable']);

function presentation(claim) {
    return {
        claimRef: claim.claimId,
        claimType: claim.claimType,
        subject: claim.subject,
        predicate: claim.predicate,
        value: claim.value,
        unit: claim.unit,
        temporalScope: claim.temporalScope,
        scenario: claim.scenario,
    };
}

test('case contract 强制 ExpectedClaimSet 由 formal oracle 函数生成', async () => {
    assert.throws(() => createArchitectureAcceptanceCase({
        caseKey: 'invalid-static-answer',
        domain: 'part',
        userQuestion: '查询零件',
        mode: 'query',
        entityScope: 'single',
        oracleBuilder: async () => ({}),
        requiredFacts: [{}],
        expectedClaims: [{ value: 95 }],
        terminalState: 'completed',
    }), /expectedClaims 必须是/);

    const dynamicCase = acceptanceCase();
    const first = await buildExpectedClaimSet(dynamicCase, { oracle: {
        status: 'ready', value: 11, unit: 'CNY', entityId: '1', source: 'formal-test-service',
    } });
    const second = await buildExpectedClaimSet(dynamicCase, { oracle: {
        status: 'ready', value: 12, unit: 'CNY', entityId: '1', source: 'formal-test-service',
    } });
    assert.equal(first[0].value, 11);
    assert.equal(second[0].value, 12);
    assert.equal(first[0].oracleSource, 'formal_api_or_service');
});

test('oracle 明确区分 prerequisite missing 与 invalid fixture，且不会归咎 AI', async () => {
    let executions = 0;
    const cases = ['prerequisite_missing', 'fixture_invalid'].map(status => acceptanceCase({
        caseKey: `oracle-${status}`,
        oracleBuilder: async () => ({ status }),
    }));
    const suite = await runArchitectureAcceptanceSuite({
        cases,
        executeCase: () => { executions += 1; },
    });
    assert.equal(executions, 0);
    assert.deepEqual(suite.cases.map(item => item.phase), ['oracle', 'oracle']);
    assert.deepEqual(suite.cases.map(item => item.errorCodes[0]), [
        'ORACLE_PREREQUISITE_MISSING', 'ORACLE_FIXTURE_INVALID',
    ]);
});

test('part/coil/template/recipe/cost 均按业务 Fact identity 比较而不是 capability identity', async () => {
    for (const domain of Object.keys(DOMAIN_FIXTURES)) {
        const testCase = acceptanceCase({ domain, caseKey: `${domain}-business-fact` });
        const report = await runArchitectureAcceptanceSuite({
            cases: [testCase],
            executeCase: (_case, { expectedClaims }) => materializeActual(testCase, expectedClaims),
        });
        assert.equal(report.passed, true, JSON.stringify(report.cases[0]));
        assert.equal(report.metrics.dynamicOracleAgreementRate.rate, 1);
    }
});

test('第一批领域语义矩阵覆盖正式 identity、状态、详情、negative 与 current/snapshot 边界', async () => {
    const matrix = {
        part: [
            ['current_price', 'scalar_value'], ['current_inventory', 'scalar_value'],
            ['unique_entity', 'entity_identity'], ['verified_empty', 'verified_not_found'],
            ['ambiguity', 'ambiguous'],
        ],
        coil: [
            ['official_scheme_identity', 'entity_identity'], ['scheme_status', 'status'],
            ['inventory', 'scalar_value'], ['formal_profile', 'relationship'],
            ['multiple_official_schemes', 'ambiguous'],
        ],
        template: [
            ['template_identity', 'entity_identity'], ['current_price', 'scalar_value'],
            ['formal_detail', 'relationship'], ['part_template_boundary', 'status'],
            ['target_absent', 'verified_not_found'],
        ],
        recipe: [
            ['recipe_identity', 'entity_identity'], ['formal_detail', 'relationship'],
            ['saved_snapshot', 'scalar_value'], ['current_not_saved', 'status'],
        ],
        cost: [
            ['current_full_cost', 'scalar_value'], ['saved_snapshot', 'scalar_value'],
            ['current_saved_comparison', 'relationship'], ['formal_cost_authority', 'status'],
            ['incomplete_cost_unavailable', 'unavailable'],
        ],
    };
    const cases = [];
    for (const [domain, entries] of Object.entries(matrix)) {
        for (const [semantic, claimType] of entries) {
            const isSaved = semantic === 'saved_snapshot';
            const isUnavailable = claimType === 'unavailable';
            const isNegative = claimType === 'verified_not_found';
            const isAmbiguous = claimType === 'ambiguous';
            cases.push(acceptanceCase({
                caseKey: `domain-${domain}-${semantic}`,
                domain,
                terminalState: isUnavailable
                    ? 'failed_unverified'
                    : isNegative ? 'completed_negative' : isAmbiguous ? 'needs_clarification' : 'completed',
                requiredEvidenceClasses: isNegative ? ['verified_negative'] : ['live_business'],
                oracleBuilder: async setup => ({
                    status: isNegative ? 'verified_absent' : 'ready',
                    entityId: setup.entityId,
                    source: 'formal-test-service',
                    name: `${domain}-formal-record`,
                    value: setup.fixtureValue,
                    unit: /price|cost|snapshot/.test(semantic) ? 'CNY' : null,
                    detail: { verified: true, semantic },
                    candidates: [{ entityType: DOMAIN_FIXTURES[domain].entityType, entityId: 'candidate-1' }],
                }),
                expectedClaims: async ({ oracle }) => [expectedFromOracle(domain, oracle, {
                    claimType,
                    predicate: isSaved ? 'cost.saved.snapshot' : `${domain}.${semantic}`,
                    scenario: isSaved ? 'saved_recipe_snapshot' : `${domain}_${semantic}`,
                    temporalScope: isSaved ? 'saved_snapshot' : 'current',
                    value: claimType === 'entity_identity' ? oracle.name
                        : claimType === 'relationship' ? oracle.detail
                            : isNegative ? true
                                : isAmbiguous ? oracle.candidates
                                    : isUnavailable ? { reason: 'incomplete_cost' }
                                        : claimType === 'status' ? 'verified'
                                            : oracle.value,
                    unit: claimType === 'scalar_value' ? oracle.unit : null,
                    evidenceClasses: CONTROL_TYPES.has(claimType)
                        ? []
                        : isNegative ? ['verified_negative'] : ['live_business'],
                })],
            }));
        }
    }
    const suite = await runArchitectureAcceptanceSuite({
        cases,
        executeCase: (testCase, { expectedClaims }) => materializeActual(testCase, expectedClaims),
    });
    assert.equal(suite.caseCount, 24);
    assert.equal(suite.passed, true, JSON.stringify(suite.cases.filter(item => !item.passed)));
});

test('架构变体矩阵具有确定性的终态、Evidence 与技术失败语义', async t => {
    const variants = [
        { key: 'exact', domain: 'part' },
        { key: 'fuzzy', domain: 'template' },
        { key: 'irrelevant_later_tool', domain: 'part', behavior: 'tool_rejected_not_allowed', preserve: true },
        { key: 'duplicate', domain: 'coil', behavior: 'duplicate_call_suppressed', preserve: true },
        { key: 'stale_turn_state', domain: 'recipe', behavior: 'plan_drift', preserve: true },
        { key: 'wrong_planner_hint', domain: 'cost', behavior: 'plan_drift', preserve: true },
        { key: 'success_empty', domain: 'part', terminal: 'completed_negative', claimType: 'verified_not_found', evidence: 'verified_negative' },
        { key: 'resource_404', domain: 'recipe', terminal: 'completed_negative', claimType: 'verified_not_found', evidence: 'verified_negative' },
        { key: 'ambiguous', domain: 'template', terminal: 'needs_clarification', claimType: 'ambiguous' },
        { key: 'timeout', domain: 'cost', terminal: 'failed_unverified', claimType: 'unavailable', technical: 'timeout' },
        { key: 'transport_failure', domain: 'coil', terminal: 'failed_unverified', claimType: 'unavailable', technical: 'transport_failure' },
        { key: 'protocol_failure', domain: 'recipe', terminal: 'failed_unverified', claimType: 'unavailable', technical: 'protocol_failure' },
        { key: 'budget_exhaustion', domain: 'template', terminal: 'budget_exhausted', claimType: 'unavailable' },
    ];
    for (const variant of variants) {
        await t.test(variant.key, async () => {
            const testCase = acceptanceCase({
                caseKey: `matrix-${variant.key}`,
                domain: variant.domain,
                terminalState: variant.terminal || 'completed',
                semanticRequirements: {
                    ...(variant.preserve ? { evidencePreserved: true } : {}),
                    ...(variant.technical ? { technicalFailureOutcome: variant.technical } : {}),
                },
                requiredEvidenceClasses: variant.evidence ? [variant.evidence] : ['live_business'],
                expectedClaims: async ({ oracle }) => {
                    if (variant.claimType === 'verified_not_found') {
                        return [expectedFromOracle(variant.domain, oracle, {
                            claimType: 'verified_not_found',
                            value: true,
                            unit: null,
                            predicate: 'verifiedNotFound',
                            evidenceClasses: ['verified_negative'],
                        })];
                    }
                    if (variant.claimType === 'ambiguous') {
                        return [expectedFromOracle(variant.domain, oracle, {
                            claimType: 'ambiguous',
                            value: oracle.candidates || [],
                            unit: null,
                            predicate: 'ambiguity',
                            evidenceClasses: [],
                        })];
                    }
                    if (variant.claimType === 'unavailable') {
                        return [expectedFromOracle(variant.domain, oracle, {
                            claimType: 'unavailable',
                            value: { reason: variant.technical || 'budget_exhausted' },
                            unit: null,
                            evidenceClasses: [],
                        })];
                    }
                    return [expectedFromOracle(variant.domain, oracle)];
                },
                oracleBuilder: async setup => ({
                    status: ['success_empty', 'resource_404'].includes(variant.key) ? 'verified_absent' : 'ready',
                    value: setup.fixtureValue,
                    unit: 'CNY',
                    entityId: setup.entityId,
                    candidates: [{ entityType: DOMAIN_FIXTURES[variant.domain].entityType, entityId: 'candidate-1' }],
                }),
            });
            const suite = await runArchitectureAcceptanceSuite({
                cases: [testCase],
                executeCase: (_case, { expectedClaims }) => materializeActual(testCase, expectedClaims, {
                    behaviorLog: variant.behavior ? [{ recordType: 'behavior_event', type: variant.behavior }] : [],
                    observations: variant.technical
                        ? [{
                            recordType: 'observation',
                            observationId: 'observation-1',
                            outcome: variant.technical,
                            factKey: expectedClaims[0].factKey,
                        }]
                        : variant.key === 'ambiguous'
                            ? [{ recordType: 'observation', observationId: 'observation-1', outcome: 'ambiguous' }]
                            : [],
                }),
            });
            assert.equal(suite.passed, true, JSON.stringify(suite.cases[0]));
            if (variant.technical) {
                assert.equal(suite.metrics.technicalFailureSemanticAccuracy.rate, 1);
                assert.equal(suite.cases[0].counts.falseNotFound, 0);
            }
        });
    }
});

test('current cost 与 saved snapshot 在 ExpectedClaimSet identity 层天然隔离', () => {
    const subject = { entityType: 'recipe', entityId: 'same-recipe' };
    const current = claimBusinessIdentityKey({
        subject,
        predicate: 'cost.current.recipe',
        temporalScope: 'current',
        scenario: 'current_recipe_cost',
    });
    const saved = claimBusinessIdentityKey({
        subject,
        predicate: 'cost.saved.snapshot',
        temporalScope: 'saved_snapshot',
        scenario: 'saved_recipe_snapshot',
    });
    assert.notEqual(current, saved);
});

test('三个复杂正向 renderer case 只按结构化 Claim presentation 验证', async () => {
    const cases = ['part', 'recipe', 'cost'].map((domain, caseIndex) => acceptanceCase({
        caseKey: `renderer-${domain}`,
        domain,
        semanticRequirements: { requireRenderer: true },
        requiredFacts: [{ key: 'first' }, { key: 'second' }, { key: 'third' }],
        expectedClaims: async ({ oracle }) => [0, 1, 2].map(index => expectedFromOracle(domain, oracle, {
            factKey: null,
            predicate: `${DOMAIN_FIXTURES[domain].predicate}.${index}`,
            scenario: `${DOMAIN_FIXTURES[domain].scenario}_${index}`,
            value: oracle.values[index],
            qualifiers: { claimType: 'scalar_value', valuePath: 'data.value', unit: 'CNY' },
        })),
        oracleBuilder: async setup => ({
            status: 'ready',
            entityId: setup.entityId,
            unit: 'CNY',
            values: [setup.fixtureValue, setup.fixtureValue + caseIndex + 1, setup.fixtureValue + caseIndex + 2],
        }),
    }));
    const suite = await runArchitectureAcceptanceSuite({
        cases,
        executeCase: async (testCase, { oracle }) => {
            const fixture = DOMAIN_FIXTURES[testCase.domain];
            const requirements = [];
            const evidenceLedger = [];
            for (const [index, value] of oracle.values.entries()) {
                const base = createFactRequirement({
                    entityType: fixture.entityType,
                    entityId: oracle.entityId,
                    predicate: `${fixture.predicate}.${index}`,
                    temporalScope: 'current',
                    scenario: `${fixture.scenario}_${index}`,
                    qualifiers: { claimType: 'scalar_value', valuePath: 'data.value', unit: 'CNY' },
                });
                const evidenceId = `renderer-evidence-${index + 1}`;
                requirements.push(createFactRequirement({
                    ...base,
                    identity: base.identity,
                    status: 'satisfied',
                    evidenceIds: [evidenceId],
                }));
                evidenceLedger.push({
                    recordType: 'evidence',
                    evidenceId,
                    kind: 'live_business',
                    factKey: base.factKey,
                    capabilityName: fixture.capability,
                    sourceOfTruth: 'formal-test-service',
                    toolResult: {
                        name: fixture.capability,
                        result: { formalResult: { success: true, data: {
                            id: oracle.entityId,
                            name: `${testCase.domain}-fixture`,
                            value,
                        } } },
                    },
                });
            }
            const state = createInvestigationState({
                goalId: `renderer-${testCase.domain}`,
                requirements,
                status: 'completed',
            });
            let rendererCalls = 0;
            let renderedAnswer = null;
            const renderer = async (messages, options = {}) => {
                rendererCalls += 1;
                assert.deepEqual(options.tools || [], []);
                const payload = JSON.parse(messages.at(-1).content);
                const claims = payload.claims;
                renderedAnswer = { blocks: [{
                    type: 'claim_list',
                    claimRefs: claims.map(claim => claim.claimId),
                    claimPresentations: claims.map(presentation),
                }] };
                return new Response(JSON.stringify({ choices: [{ message: {
                    content: JSON.stringify(renderedAnswer),
                } }] }), { headers: { 'Content-Type': 'application/json' } });
            };
            const grounded = await composeGroundedAnswerV4({
                goal: testCase.userQuestion,
                state,
                evidenceLedger,
                answerShape: 'explanation',
                renderer,
            });
            assert.equal(rendererCalls, 1, JSON.stringify(grounded));
            assert.equal(grounded.rendering, 'llm_structured');
            return {
                investigationState: state,
                entityScope: 'single',
                claims: grounded.claims,
                evidenceLedger,
                capabilityTrace: [fixture.capability],
                answerPlan: grounded.answerPlan,
                answerRendering: grounded.rendering,
                renderedAnswer,
                finalContent: grounded.content,
            };
        },
    });
    assert.equal(suite.passed, true, JSON.stringify(suite.cases));
    assert.equal(suite.metrics.rendererGroundingPassRate.rate, 1);
    assert.equal(suite.metrics.rendererGroundingPassRate.denominator, 3);
});

test('非法写能力、unsupported claim 与 false not-found 会进入安全有界报告和指标', async () => {
    const testCase = acceptanceCase({ caseKey: 'negative-architecture-signals' });
    const expected = await buildExpectedClaimSet(testCase, { oracle: {
        status: 'ready', value: 10, unit: 'CNY', entityId: '1', source: 'formal-test-service',
    } });
    const unsupported = createClaim({
        claimId: 'unsupported',
        claimType: 'verified_not_found',
        factKey: 'other-fact',
        subject: { entityType: 'part', entityId: 'other' },
        predicate: 'verifiedNotFound',
        value: true,
        temporalScope: 'current',
        scenario: 'catalog_current',
    });
    const actual = materializeActual(testCase, expected, {
        capabilityTrace: [{ name: 'create_part' }],
    });
    actual.claims = [...actual.claims, unsupported];
    const result = evaluateArchitectureAcceptanceCase(testCase, expected, actual, {
        reportLimits: { errors: 3, identifiers: 2 },
    });
    assert.equal(result.passed, false);
    assert.ok(result.errorCodes.includes('READ_WRITE_EXPOSURE'));
    assert.equal(result.counts.unsupportedClaims, 1);
    assert.equal(result.counts.falseNotFound, 1);
    assert.ok(result.errorCodes.length <= 3);
    const metrics = aggregateArchitectureMetrics([result]);
    assert.ok(metrics.unsupportedBusinessClaimRate.rate > 0);
    assert.ok(metrics.falseNotFoundRate.rate > 0);
    assert.ok(metrics.readWriteExposureRate.rate > 0);
});

test('九项 metrics 的零分母与跨 case 计数保持确定性', () => {
    const metrics = aggregateArchitectureMetrics([]);
    assert.deepEqual(Object.keys(metrics), [
        'evidencePreservationRate',
        'unsupportedBusinessClaimRate',
        'requiredClaimCoverageRate',
        'falseNotFoundRate',
        'ambiguityAutoResolutionRate',
        'readWriteExposureRate',
        'dynamicOracleAgreementRate',
        'rendererGroundingPassRate',
        'technicalFailureSemanticAccuracy',
    ]);
    assert.ok(Object.values(metrics).every(metric => (
        metric.numerator === 0 && metric.denominator === 0 && metric.rate === null
    )));
});

test('技术失败缺少 unavailable Claim provenance 时不得计为语义准确', async () => {
    const testCase = acceptanceCase({
        caseKey: 'technical-failure-missing-unavailable',
        domain: 'cost',
        terminalState: 'failed_unverified',
        semanticRequirements: { technicalFailureOutcome: 'timeout' },
        expectedClaims: async ({ oracle }) => [expectedFromOracle('cost', oracle, {
            claimType: 'unavailable',
            value: { reason: 'timeout' },
            unit: null,
            evidenceClasses: [],
        })],
    });
    const expected = await buildExpectedClaimSet(testCase, { oracle: {
        status: 'ready', entityId: '1', source: 'formal-test-service', value: null, unit: null,
    } });
    const report = evaluateArchitectureAcceptanceCase(testCase, expected, {
        entityScope: 'single',
        investigationState: { status: 'failed_unverified', requirements: [{ status: 'unavailable' }] },
        claims: [],
        evidenceLedger: [],
        observations: [{
            observationId: 'timeout-observation', outcome: 'timeout', factKey: expected[0].factKey,
        }],
        capabilityTrace: ['preview_recipe_cost'],
    });
    assert.equal(report.checks.technicalFailureAccurate, false);
    assert.ok(report.errorCodes.includes('TECHNICAL_FAILURE_SEMANTICS_INACCURATE'));
});

test('Evidence Preservation 要求同 Fact、同 authority、同 evidence class', async () => {
    const testCase = acceptanceCase({
        caseKey: 'wrong-fact-evidence-does-not-preserve',
        semanticRequirements: { evidencePreserved: true },
    });
    const expected = await buildExpectedClaimSet(testCase, { oracle: {
        status: 'ready', entityId: '1', source: 'formal-test-service', value: 10, unit: 'CNY',
    } });
    const actual = materializeActual(testCase, expected);
    actual.evidenceLedger = actual.evidenceLedger.map(record => ({ ...record, factKey: 'other-fact' }));
    const report = evaluateArchitectureAcceptanceCase(testCase, expected, actual);
    assert.equal(report.checks.evidencePreserved, false);
    assert.ok(report.errorCodes.includes('EVIDENCE_NOT_PRESERVED'));
});
