'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../api/services/aiTaskContractV2.cjs');
const V = require('../api/services/aiTaskValidationV2.cjs');
const expectCode = (fn, code) => assert.throws(fn, error => error?.code === code);
const ids = { task: '11111111-1111-4111-8111-111111111111', parent: '22222222-2222-4222-8222-222222222222', receipt: '33333333-3333-4333-8333-333333333333', fact: '44444444-4444-4444-8444-444444444444', oldFact: '55555555-5555-4555-8555-555555555555', step: '66666666-6666-4666-8666-666666666666' };
const now = '2026-09-22T00:00:00.000Z';
const sha = 'a'.repeat(64);
const entity = { entityType: 'recipe', entityId: '12', displayName: 'V550', updatedAt: null, recordHash: null, schemeCode: null };
const subject = () => ({ subjectKey: 'recipe', mention: 'V550', resolution: 'UNIQUE', selected: entity, candidates: [entity], candidateSetComplete: true, selectionBasis: 'EXACT', receiptIds: [] });
const key = (overrides = {}) => ({ entityType: 'recipe', entityId: '12', predicate: 'current_total_cost', temporalScope: 'SCENARIO', scenarioKey: 'candidate', qualifiers: { basis: 'CURRENT_REBUILT_SCENARIO', unit: 'pump', currency: 'CNY', snapshotVersion: null, queryScopeHash: null }, ...overrides });
const receipt = () => ({ taskId: ids.task, planRevision: 1, sourceHash: sha, result: { cost: { currentTotalCost: 100 } } });
const fact = (overrides = {}) => ({ version: 1, factId: ids.fact, key: key(), evidenceState: 'VERIFIED_POSITIVE', value: 100, receiptId: ids.receipt, resultPointer: '/cost/currentTotalCost', observedAt: now, sourceUpdatedAt: null, sourceHash: sha, complete: true, supersedesFactId: null, planRevision: 1, readSetId: null, ...overrides });
const requirement = (overrides = {}) => ({ requirementKey: 'candidate-cost', predicate: 'current_total_cost', subjectKey: 'recipe', scenarioKey: 'candidate', temporalScope: 'SCENARIO', basis: 'CURRENT_REBUILT_SCENARIO', requireComplete: true, unit: 'pump', currency: 'CNY', ...overrides });
const goal = (overrides = {}) => ({ goalKey: 'cost', kind: 'CONFIGURATION_COMPARE', description: '候选成本', subjectKeys: ['recipe'], scenarioKeys: ['candidate'], dependsOn: [], state: 'VERIFIED', factIds: [ids.fact], blockers: [], requirements: [requirement()], ...overrides });
const scenario = () => ({ scenarioKey: 'candidate', label: '电缆 5m', baseSubjectKey: 'recipe', basis: 'CURRENT_REBUILT', priceContext: 'FORMAL_READ_SET', overrides: { hasCable: false, cableLength: 0, packingParts: [], surfaceTreatmentCost: 0 }, readSetId: null });
const envelope = (overrides = {}) => ({ version: 2, taskId: ids.task, parentTaskId: null, ownerKey: 'owner-1', conversationId: null, requestId: 'request-1', revision: 1, planRevision: 1, state: 'SUCCEEDED', answerOwner: 'TASK_V2', executionMode: 'FOREGROUND', userGoal: '比较成本', inputHash: sha, createdAt: now, updatedAt: now, constraints: { businessWritePolicy: 'FORBIDDEN', maxModelCalls: 1, maxToolCalls: 1, maxToolResultBytes: 98304, maxTaskStateBytes: 262144, deadlineAt: null, maxApiCalls: 1, maxActiveMs: 10000 }, subjects: [subject()], goals: [goal()], scenarios: [scenario()], steps: [], facts: [fact()], questions: [], approvalOperationIds: [], resultSummary: null, budgetUsage: { modelCalls: 0, toolCalls: 0, apiCalls: 0, activeMs: 0 }, ...overrides });
const context = () => ({ trustedReceiptsById: new Map([[ids.receipt, receipt()]]) });

test('Fact records require a trusted receipt and complete bounded negative evidence', () => {
    assert.equal(V.validateFactRecordV1(fact(), { ...context(), taskId: ids.task, factsById: new Map() }), true);
    expectCode(() => V.validateFactRecordV1(fact({ receiptId: ids.parent }), { ...context(), taskId: ids.task, factsById: new Map() }), 'FACT_UNTRUSTED_RECEIPT');
    expectCode(() => V.validateFactRecordV1(fact({ evidenceState: 'VERIFIED_NEGATIVE', complete: false }), { ...context(), taskId: ids.task, factsById: new Map() }), 'FACT_NEGATIVE_SCOPE');
    expectCode(() => V.validateFactRecordV1(fact({ key: key({ entityId: null, qualifiers: { ...key().qualifiers, queryScopeHash: null } }) }), { ...context(), taskId: ids.task, factsById: new Map() }), 'FACT_ENTITY_SCOPE');
    expectCode(() => V.validateFactRecordV1(fact({ resultPointer: '/cost/missing' }), { ...context(), taskId: ids.task, factsById: new Map() }), 'FACT_RESULT_POINTER_UNTRUSTED');
    expectCode(() => V.validateFactRecordV1(fact({ value: 101 }), { ...context(), taskId: ids.task, factsById: new Map() }), 'FACT_RESULT_VALUE_MISMATCH');
});

test('Fact supersede permits only same task, later revision and same FactKey', () => {
    const old = { ...fact(), factId: ids.oldFact, planRevision: 1 }; const next = fact({ planRevision: 2, supersedesFactId: ids.oldFact });
    const trusted = new Map([[ids.receipt, { ...receipt(), planRevision: 2 }]]);
    assert.equal(V.validateFactRecordV1(next, { taskId: ids.task, trustedReceiptsById: trusted, factsById: new Map([[ids.oldFact, { ...old, taskId: ids.task }]]) }), true);
    expectCode(() => V.validateFactRecordV1({ ...next, key: key({ scenarioKey: 'other' }) }, { taskId: ids.task, trustedReceiptsById: trusted, factsById: new Map([[ids.oldFact, { ...old, taskId: ids.task }]]) }), 'FACT_SUPERSEDE_INVARIANT');
});

test('FactRequirement matches all identity dimensions rather than only predicate', () => {
    const valid = fact(); assert.equal(V.factSatisfiesRequirement(requirement(), valid, [subject()]), true);
    for (const [label, mutate] of Object.entries({ entity: () => ({ ...valid, key: key({ entityId: '13' }) }), scenario: () => ({ ...valid, key: key({ scenarioKey: 'base' }) }), temporal: () => ({ ...valid, key: key({ temporalScope: 'CURRENT', scenarioKey: null }) }), basis: () => ({ ...valid, key: key({ qualifiers: { ...key().qualifiers, basis: 'CURRENT_REBUILT_BASE' } }) }), unit: () => ({ ...valid, key: key({ qualifiers: { ...key().qualifiers, unit: 'piece' } }) }), currency: () => ({ ...valid, key: key({ qualifiers: { ...key().qualifiers, currency: 'USD' } }) }), incomplete: () => ({ ...valid, complete: false }) })) assert.equal(V.factSatisfiesRequirement(requirement(), mutate(), [subject()]), false, label);
});

test('Envelope validates verified goals, task completion, write policy, state bytes and strict unknown fields', () => {
    assert.equal(V.validateTaskEnvelopeV2(envelope(), context()), true);
    expectCode(() => V.validateTaskEnvelopeV2(envelope({ goals: [goal({ requirements: [] })] }), context()), 'GOAL_VERIFIED_REQUIREMENTS');
    expectCode(() => V.validateTaskEnvelopeV2(envelope({ goals: [goal({ state: 'PARTIAL' })] }), context()), 'TASK_SUCCEEDED_GOALS');
    expectCode(() => V.validateTaskEnvelopeV2(envelope({ goals: [goal({ state: 'CANCELLED' })] }), context()), 'TASK_SUCCEEDED_GOALS');
    const command = { stepId: ids.step, goalKeys: ['cost'], toolName: 'change', capabilityId: 'x', access: 'COMMAND', arguments: {}, argumentSources: [], argsHash: C.stableHash({}), state: 'PLANNED', attempt: 1, startedAt: null, finishedAt: null, receiptId: null, operationId: null, errorCode: null };
    expectCode(() => V.validateTaskEnvelopeV2(envelope({ steps: [command] }), context()), 'STEP_COMMAND_FORBIDDEN');
    expectCode(() => V.validateTaskEnvelopeV2({ ...envelope(), approved: true }, context()), 'TASK_ENVELOPE_UNKNOWN_OR_MISSING_FIELD');
    const oversizedValue = 'x'.repeat(262144);
    const oversizedContext = { trustedReceiptsById: new Map([[ids.receipt, { ...receipt(), result: { cost: { currentTotalCost: oversizedValue } } }]]) };
    expectCode(() => V.validateTaskEnvelopeV2(envelope({ facts: [fact({ value: oversizedValue })] }), oversizedContext), 'TASK_STATE_TOO_LARGE');
    const readWithUnknownSource = { stepId: ids.step, goalKeys: ['cost'], toolName: 'read', capabilityId: 'x', access: 'QUERY', arguments: { recipeId: 12 }, argumentSources: [], argsHash: C.stableHash({ recipeId: 12 }), state: 'PLANNED', attempt: 1, startedAt: null, finishedAt: null, receiptId: null, operationId: null, errorCode: null };
    expectCode(() => V.validateTaskEnvelopeV2(envelope({ steps: [readWithUnknownSource] }), context()), 'STEP_ARGUMENT_SOURCES_REQUIRED');
});

test('Transitions require revision discipline, terminal immutability and immutable scenario keys', () => {
    const previous = envelope({ state: 'VERIFYING', revision: 1, goals: [goal({ state: 'VERIFIED' })] });
    const next = envelope({ state: 'SUCCEEDED', revision: 2 });
    assert.equal(V.validateTaskTransitionV2(previous, next, context()), true);
    expectCode(() => V.validateTaskTransitionV2(next, { ...next, state: 'RUNNING', revision: 3 }, context()), 'TASK_TRANSITION_STATE');
    expectCode(() => V.validateTaskTransitionV2(previous, { ...next, scenarios: [{ ...scenario(), label: '被改写' }] }, context()), 'TASK_SCENARIO_MUTATED');
    expectCode(() => V.validateTaskTransitionV2(previous, { ...next, revision: 4 }, context()), 'TASK_TRANSITION_REVISION');
});

test('BU-07 completeness family requires complete negative evidence for recipes, templates and parts', () => {
    const catalogueRequirement = predicate => ({ requirementKey: predicate, predicate, subjectKey: null, scenarioKey: null, temporalScope: 'CURRENT', basis: 'FORMAL_CATALOGUE_SCOPE', requireComplete: true, unit: 'set', currency: null });
    const globalFact = (predicate, complete) => ({ evidenceState: 'VERIFIED_NEGATIVE', complete, key: { entityType: 'global', entityId: null, predicate, temporalScope: 'CURRENT', scenarioKey: null, qualifiers: { basis: 'FORMAL_CATALOGUE_SCOPE', unit: 'set', currency: null, snapshotVersion: null, queryScopeHash: sha } } });
    const requirements = ['recipes-empty', 'templates-empty', 'parts-empty'].map(catalogueRequirement);
    const incomplete = [globalFact('recipes-empty', true), globalFact('templates-empty', true), globalFact('parts-empty', false)];
    assert.equal(requirements.every(item => incomplete.some(factItem => V.factSatisfiesRequirement(item, factItem, []))), false);
    const complete = ['recipes-empty', 'templates-empty', 'parts-empty'].map(predicate => globalFact(predicate, true));
    assert.equal(requirements.every(item => complete.some(factItem => V.factSatisfiesRequirement(item, factItem, []))), true);
});

test('SOURCE_EVIDENCE binds only a current task record and deterministic cm-to-m conversion', () => {
    const docs = require('../api/services/aiTaskDocumentsV2.cjs');
    const item = docs.candidate({ candidateKey: 'file:source', sourceType: 'TECHNICAL_FILE', sourceId: '72', title: 'V550报告', lifecycleStatus: 'ACTIVE', freshness: 'CURRENT', contentAvailability: 'FULL', fileSha256: sha });
    const record = docs.evidence({ taskId: ids.task, planRevision: 1, candidate: item, location: { type: 'WHOLE_RECORD' }, excerpt: '电缆长度 500cm', coverage: { mode: 'FULL_CONTENT', complete: true, truncated: false } });
    const source = { fieldPath: '/cableLength', kind: 'SOURCE_EVIDENCE', sourceRef: record.evidenceId, pointer: null, span: null, sourceVersionHash: record.sourceVersionHash, rawValue: '500cm', normalizedValue: 5, transform: { type: 'UNIT_CONVERSION', fromUnit: 'cm', toUnit: 'm' } };
    const context = { taskId: ids.task, planRevision: 1, trustedSourceEvidenceById: new Map([[record.evidenceId, record]]) };
    assert.equal(V.validateArgumentSource(source, context), true);
    expectCode(() => V.validateArgumentSource({ ...source, sourceVersionHash: 'b'.repeat(64) }, context), 'SOURCE_EVIDENCE_UNTRUSTED');
    expectCode(() => V.validateArgumentSource({ ...source, transform: { type: 'UNIT_CONVERSION', fromUnit: 'cm', toUnit: 'm' }, normalizedValue: 5.1 }, context), 'SOURCE_EVIDENCE_NONDETERMINISTIC_TRANSFORM');
    expectCode(() => V.validateArgumentSource({ ...source, rawValue: '约5米', normalizedValue: 5 }, context), 'SOURCE_EVIDENCE_RAW_NOT_EVIDENCED');
    expectCode(() => V.validateArgumentSource(source, { ...context, taskId: ids.parent }), 'SOURCE_EVIDENCE_UNTRUSTED');
    expectCode(() => V.validateArgumentSource(source, { ...context, planRevision: 2 }), 'SOURCE_EVIDENCE_UNTRUSTED');
});
