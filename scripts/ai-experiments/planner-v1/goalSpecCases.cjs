'use strict';

const { BASE_CASES, NEGATIVE_CASES } = require('./cases.cjs');

function expected(goalKind, resultShape, metric, extras = {}) { return Object.freeze({ goalKind, resultShape, metric, ...extras }); }
const SPECS = Object.freeze({
    'P-01': expected('EXPLAIN', 'DETAIL', 'NONE', { targetCount: 0 }),
    'P-02': expected('EXPLAIN', 'DETAIL', 'NONE', { targetCount: 0 }),
    'P-03': expected('LIST', 'LIST', 'NONE', { relationRequest: '固定件', targetCount: 1 }),
    'P-04': expected('READ_VALUE', 'VALUE', 'COST', { targetCount: 1 }),
    'P-05': expected('READ_VALUE', 'VALUE', 'COST', { targetCount: 1 }),
    'P-06': expected('READ_VALUE', 'VALUE', 'COST', { targetCount: 1 }),
    'P-07': expected('COUNT', 'COUNT', 'NONE', { targetCount: 1 }),
    'P-08': expected('READ_RELATION', 'VALUE', 'NONE', { relationRequest: '线圈', targetCount: 1 }),
    'P-09': expected('COMPARE_SCENARIO', 'DELTA', 'COST', { overrides: ['木箱'], classes: ['PACKAGING'], targetCount: 1 }),
    'P-10': expected('PREVIEW_SCENARIO', 'VALUE', 'COST', { overrides: ['加浮球'], classes: ['FLOAT'], targetCount: 1 }),
    'P-11': expected('COMPARE_SCENARIO', 'DELTA', 'COST', { overrides: ['做电泳'], classes: ['SURFACE_TREATMENT'], targetCount: 1 }),
    'P-12': expected('COMPARE_SCENARIO', 'DELTA', 'COST', { overrides: ['不锈钢接轴'], classes: ['ROTOR_PROCESS'], targetCount: 1 }),
    'P-13': expected('PREVIEW_SCENARIO', 'VALUE', 'COST', { overrides: ['电缆5米', '木箱'], classes: ['CABLE', 'PACKAGING'], write: 'NO', targetCount: 1 }),
    'P-14': expected('COMPARE_TARGETS', 'DELTA', 'COST', { targetCount: 2 }),
    'P-15': expected('READ_VALUE', 'VALUE', 'COST', { targetCount: 2 }),
    'P-16': expected('READ_VALUE', 'VALUE', 'COST', { targetCount: 0 }),
    'P-17': expected('PREVIEW_SCENARIO', 'DETAIL', 'NONE', { overrides: ['木箱'], classes: ['PACKAGING'], write: 'YES', targetCount: 1 }),
    'P-18': expected('READ_VALUE', 'VALUE', 'COST', { targetCount: 2 }),
    'N-01': expected('LIST', 'LIST', 'NONE', { relationRequest: '固定件', targetCount: 1 }),
    'N-02': expected('READ_VALUE', 'VALUE', 'COST', { targetCount: 1 }),
    'N-03': expected('LIST', 'LIST', 'NONE', { relationRequest: '固定件', targetCount: 1 }),
    'N-04': expected('PREVIEW_SCENARIO', 'VALUE', 'COST', { overrides: ['电缆5米', '木箱'], classes: ['CABLE', 'PACKAGING'], write: 'NO', targetCount: 1 }),
    'N-05': expected('COMPARE_SCENARIO', 'DELTA', 'COST', { overrides: ['木箱'], classes: ['PACKAGING'], targetCount: 1 }),
    'N-06': expected('COMPARE_TARGETS', 'DELTA', 'COST', { targetCount: 2 }),
    'N-07': expected('COMPARE_SCENARIO', 'DELTA', 'COST', { overrides: ['木箱'], classes: ['PACKAGING'], targetCount: 1 }),
    'N-08': expected('READ_VALUE', 'VALUE', 'COST', { targetCount: 0 }),
});
function adapt(testCase) { return Object.freeze({ ...testCase, goalSpec: SPECS[testCase.id] }); }
const GOAL_SPEC_BASE_CASES = Object.freeze(BASE_CASES.map(adapt));
const GOAL_SPEC_NEGATIVE_CASES = Object.freeze(NEGATIVE_CASES.map(adapt));
const GOAL_SPEC_TARGETED_CASES = Object.freeze(['P-03', 'P-05', 'P-06', 'P-07', 'P-08', 'P-09', 'P-10', 'P-11', 'P-12', 'P-13', 'P-14', 'P-15', 'P-17', 'N-06', 'N-08'].map(id => [...GOAL_SPEC_BASE_CASES, ...GOAL_SPEC_NEGATIVE_CASES].find(testCase => testCase.id === id)));

module.exports = { SPECS, GOAL_SPEC_BASE_CASES, GOAL_SPEC_NEGATIVE_CASES, GOAL_SPEC_TARGETED_CASES };
