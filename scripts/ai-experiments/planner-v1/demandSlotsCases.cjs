'use strict';

const { GOAL_SPEC_BASE_CASES, GOAL_SPEC_NEGATIVE_CASES } = require('./goalSpecCases.cjs');
const TARGETED_IDS = Object.freeze(['P-03', 'P-05', 'P-06', 'P-07', 'P-08', 'P-09', 'P-10', 'P-11', 'P-12', 'P-13', 'P-14', 'P-15', 'P-17', 'N-06', 'N-08']);
function adapt(testCase) {
    const { goalKind: _discard, targetCount: _targetCount, ...slotsExpected } = testCase.goalSpec;
    return Object.freeze({ ...testCase, slotsExpected: Object.freeze({ ...slotsExpected, resultShape: testCase.id === 'P-17' ? 'NONE' : slotsExpected.resultShape }) });
}
const BASE = Object.freeze(GOAL_SPEC_BASE_CASES.map(adapt));
const NEGATIVE = Object.freeze(GOAL_SPEC_NEGATIVE_CASES.map(adapt));
const TARGETED = Object.freeze(TARGETED_IDS.map(id => [...BASE, ...NEGATIVE].find(item => item.id === id)));
module.exports = { BASE, NEGATIVE, TARGETED, TARGETED_IDS };
