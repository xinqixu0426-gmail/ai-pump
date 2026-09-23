'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../api/services/aiTaskValidationV2.cjs');

const message = '老板说：V550电缆改5m，😊，先别保存！';
const span = (text, start = message.indexOf(text)) => ({ messageRef: 'm-1', start, end: start + text.length, text });
const proposal = () => ({ version: 1, goalSummary: '比较 V550 电缆改为 5m 的成本', subjects: [{ subjectKey: 'pump', mention: 'V550', typeHints: ['recipe'], sources: [span('V550')] }], scenarios: [{ scenarioKey: 'candidate', label: '改电缆', baseSubjectKey: 'pump', overrides: [{ field: 'cableLength', value: 5, unit: 'm', sources: [span('5m')] }], sources: [span('电缆改5m')] }], goals: [{ goalKey: 'cost', kind: 'CONFIGURATION_COMPARE', description: '比较成本', subjectKeys: ['pump'], scenarioKeys: ['candidate'], dependsOn: [], requestedBasis: 'CURRENT', sources: [span('V550')], quantity: null, unitPrice: null }], unparsedSpans: [] });
const expectCode = (fn, code) => assert.throws(fn, error => error?.code === code);

test('TaskProposal V1 validates strict references, UTF-16 spans, and candidate-only fields', () => {
    assert.equal(V.validateTaskProposalV1(proposal(), { sourceMessages: new Map([['m-1', message]]) }), true);
    const unicode = '中A９！😊水泵';
    const emojiStart = unicode.indexOf('😊');
    assert.equal(V.validateSourceSpan({ messageRef: 'u', start: emojiStart, end: emojiStart + '😊水'.length, text: '😊水' }, { sourceMessages: new Map([['u', unicode]]) }).verified, true);
    assert.equal('😊'.length, 2);
    const badSpan = proposal(); badSpan.subjects[0].sources[0].end -= 1;
    expectCode(() => V.validateTaskProposalV1(badSpan, { sourceMessages: new Map([['m-1', message]]) }), 'SOURCE_SPAN_TEXT_MISMATCH');
    assert.equal(V.validateSourceSpan(span('V550'), {}).verified, false);
});

test('TaskProposal rejects privilege injection, duplicate keys, missing refs, cycles and reserved base', () => {
    for (const field of ['canonicalId', 'ownerKey', 'allowWrite', 'verified', 'approved', 'receiptId', 'businessWritePolicy']) {
        const value = proposal(); value.goals[0][field] = true;
        expectCode(() => V.validateTaskProposalV1(value), 'PROPOSAL_PRIVILEGE_FIELD');
    }
    const duplicate = proposal(); duplicate.subjects.push({ ...duplicate.subjects[0] }); expectCode(() => V.validateTaskProposalV1(duplicate), 'PROPOSAL_SUBJECT_DUPLICATE');
    const missing = proposal(); missing.goals[0].subjectKeys = ['missing']; expectCode(() => V.validateTaskProposalV1(missing), 'PROPOSAL_GOAL_SUBJECT_REF');
    const cycle = proposal(); cycle.goals.push({ ...cycle.goals[0], goalKey: 'other', dependsOn: ['cost'] }); cycle.goals[0].dependsOn = ['other']; expectCode(() => V.validateTaskProposalV1(cycle), 'PROPOSAL_GOAL_CYCLE');
    const reserved = proposal(); reserved.scenarios[0].scenarioKey = 'base'; expectCode(() => V.validateTaskProposalV1(reserved), 'PROPOSAL_RESERVED_SCENARIO_KEY');
    const unknown = proposal(); unknown.extra = true; expectCode(() => V.validateTaskProposalV1(unknown), 'TASK_PROPOSAL_UNKNOWN_OR_MISSING_FIELD');
});

test('Quantity and proposed overrides preserve finite values and unknown is null at the parent', () => {
    const context = { sourceMessages: new Map([['m-1', message]]) };
    assert.equal(V.validateQuantityInput({ value: 0, unit: 'm', sources: [span('5m')] }, context), true);
    for (const value of [NaN, Infinity, -Infinity]) expectCode(() => V.validateQuantityInput({ value, unit: 'm', sources: [span('5m')] }, context), 'QUANTITY_VALUE');
    assert.equal(V.validateProposedOverride({ field: 'hasCable', value: false, unit: null, sources: [span('先别保存')] }, context), true);
    expectCode(() => V.validateProposedOverride({ field: 'coilSelection', value: 'A', unit: null, sources: [span('V550')], coilId: 1 }, context), 'PROPOSED_OVERRIDE_UNKNOWN_OR_MISSING_FIELD');
});

test('Scenario overrides distinguish false, zero, empty arrays, null and omitted without coercion', () => {
    assert.equal(V.validateScenarioOverridesV1({ hasCable: false, hasFloat: false, cableLength: 0, packingParts: [], surfaceTreatmentCost: 0 }), true);
    assert.equal(V.validateScenarioOverridesV1({}), true);
    expectCode(() => V.validateScenarioOverridesV1({ hasCable: null }), 'OVERRIDE_HAS_CABLE');
    expectCode(() => V.validateScenarioOverridesV1({ unknown: true }), 'SCENARIO_OVERRIDES_UNKNOWN_FIELD');
});

test('Canonical entities use decimal database IDs and subject binding does not select array first', () => {
    const entity = { entityType: 'recipe', entityId: '12', displayName: 'V550', updatedAt: null, recordHash: null, schemeCode: null };
    assert.equal(V.validateCanonicalEntity(entity), true);
    for (const entityId of ['V550', 'coil-12-200', '0']) expectCode(() => V.validateCanonicalEntity({ ...entity, entityId }), 'ENTITY_ID');
    assert.equal(V.validateSubjectBinding({ subjectKey: 'r', mention: 'V550', resolution: 'UNIQUE', selected: entity, candidates: [entity], candidateSetComplete: true, selectionBasis: 'EXACT', receiptIds: [] }), true);
    expectCode(() => V.validateSubjectBinding({ subjectKey: 'r', mention: 'V550', resolution: 'MULTIPLE', selected: entity, candidates: [entity, { ...entity, entityId: '13' }], candidateSetComplete: true, selectionBasis: 'FORMAL_DEFAULT', receiptIds: [] }), 'SUBJECT_MULTIPLE_INVARIANT');
    expectCode(() => V.validateSubjectBinding({ subjectKey: 'r', mention: 'V550', resolution: 'NOT_FOUND', selected: null, candidates: [], candidateSetComplete: false, selectionBasis: 'NONE', receiptIds: [] }), 'SUBJECT_NOT_FOUND_INVARIANT');
    const trusted = new Map([['77777777-7777-4777-8777-777777777777', {}]]);
    assert.equal(V.validateSubjectBinding({ subjectKey: 'r', mention: 'V550', resolution: 'SELECTED', selected: entity, candidates: [entity, { ...entity, entityId: '13' }], candidateSetComplete: true, selectionBasis: 'USER_CHOICE', receiptIds: ['77777777-7777-4777-8777-777777777777'] }, trusted), true);
});
