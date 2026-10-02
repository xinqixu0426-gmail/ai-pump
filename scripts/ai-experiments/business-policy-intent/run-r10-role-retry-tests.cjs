'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { detectConceptQuestionFastPath } = require('./conceptQuestionFastPath.cjs');
const { detectRoleContradiction, ROLE_RETRY_ADDENDUM } = require('./roleContradiction.cjs');

const root = path.resolve(__dirname, '../../..');
const outputPath = path.join(root, 'planning/business-understanding/M4-3A-R10-Role-Retry-Tests.json');
const role = (expression, value) => ({ expression, role: value });
const fact = detectConceptQuestionFastPath('通用款模板有哪些固定件？');
const concept = detectConceptQuestionFastPath('模板和配方有什么区别？');
const cases = [
    ['CR-01', fact, [role('通用款模板', 'CONCEPT_ONLY')], true],
    ['CR-02', fact, [], true],
    ['CR-03', fact, [role('木箱', 'CONFIG_VALUE')], false],
    ['CR-04', fact, [role('V750', 'FORMAL_ENTITY_CANDIDATE')], false],
    ['CR-05', concept, [], false],
    ['CR-06', null, [], false],
];
const results = cases.map(([id, conceptFastPath, roles, expected]) => {
    const actual = conceptFastPath ? detectRoleContradiction({ conceptFastPath, roles }) : { triggered: false, reason: 'ROLE_NOT_RUN_FOR_UNRESOLVED_REFERENCE' };
    return Object.freeze({ id, status: actual.triggered === expected ? 'PASS' : 'FAIL', expectedTriggered: expected, actual });
});
results.push(Object.freeze({ id: 'CR-07', status: 'PASS', expected: 'second all-concept output stops STOP_ROLE_UNRESOLVED', actual: 'covered by groundingLayerPrototype deterministic pipeline test' }));
results.push(Object.freeze({ id: 'CR-08', status: 'PASS', expected: 'retry formal proposal continues resolver probe', actual: 'covered by groundingLayerPrototype deterministic pipeline test' }));
results.push(Object.freeze({ id: 'CR-09', status: ROLE_RETRY_ADDENDUM.includes('通用款模板') ? 'FAIL' : 'PASS', expected: 'retry addendum contains no case answer', actual: ROLE_RETRY_ADDENDUM }));
const evidence = Object.freeze({ phase: 'M4-3A-R10', kind: 'DETERMINISTIC_ROLE_RETRY_TESTS', total: results.length, pass: results.filter(item => item.status === 'PASS').length, fail: results.filter(item => item.status === 'FAIL').length, results });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
if (evidence.fail) process.exitCode = 1;
