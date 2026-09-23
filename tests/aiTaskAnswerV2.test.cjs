'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAnswerDraftV1 } = require('../api/services/aiTaskAnswerV2.cjs');

test('N3.2 answer draft rejects privilege fields, ungrounded analysis, and missing goal coverage', () => {
    const task = { goals: [{ goalKey: 'cost', factIds: [], state: 'UNSUPPORTED' }], facts: [] };
    const contract = { goalOutcomes: [{ goalKey: 'cost' }] };
    assert.throws(() => validateAnswerDraftV1({ version: 1, sections: [{ goalKey: 'cost', claimType: 'LIMITATION', factIds: [], templateKey: 'LIMITATION_V1', analysisText: '', approved: true }] }, contract, task), /ANSWER_SECTION_FIELDS/);
    assert.throws(() => validateAnswerDraftV1({ version: 1, sections: [{ goalKey: 'cost', claimType: 'LIMITATION', factIds: [], templateKey: 'LIMITATION_V1', analysisText: '利润134元' }] }, contract, task), /ANSWER_SECTION_INVALID/);
    assert.throws(() => validateAnswerDraftV1({ version: 1, sections: [] }, contract, task), /ANSWER_DRAFT_STRUCTURE/);
});
