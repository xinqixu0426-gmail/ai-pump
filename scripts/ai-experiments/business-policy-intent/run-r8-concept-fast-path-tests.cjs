'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { detectReferenceSurface } = require('./referenceDetection.cjs');
const { resolveReferenceFastPath } = require('./referenceFastPath.cjs');
const { buildGroundingWorkingUtterance } = require('./workingUtterance.cjs');
const { detectConceptQuestionFastPath } = require('./conceptQuestionFastPath.cjs');

const root = path.resolve(__dirname, '../../..');
const outputArgument = process.argv.find(value => value.startsWith('--output='));
const outputPath = outputArgument ? path.resolve(root, outputArgument.slice('--output='.length)) : null;
const hint = entries => ({ entries, text: entries.map(item => `${item.expression}：${item.category}`).join('\n') });

function conceptCase(id, utterance, expected) {
    const actual = detectConceptQuestionFastPath(utterance);
    return Object.freeze({ id, utterance, expected, actual, status: actual.status === expected ? 'PASS' : 'FAIL' });
}

function integrationCase(id, { current, recent, entries, expectedReference, expectedConcept, expectedNextStage }) {
    const detection = detectReferenceSurface(current);
    const reference = detection.status === 'DETECTED'
        ? resolveReferenceFastPath({ userInput: current, recentOwnerWording: recent, referenceSurface: detection.surface, businessReferenceHint: hint(entries) })
        : null;
    const referenceStatus = reference?.mode === 'SAFE_RESOLVED' ? 'RESOLVED' : reference?.mode === 'SAFE_UNRESOLVED' ? 'UNRESOLVED' : 'NONE';
    const resolvedLanguageReference = reference?.resolvedLanguageReference || null;
    const working = buildGroundingWorkingUtterance({ rawOwnerInput: current, reference: { status: referenceStatus, surface: detection.surface, resolvedLanguageReference } });
    const concept = referenceStatus === 'UNRESOLVED' ? null : detectConceptQuestionFastPath(working.workingUtterance);
    const nextStage = referenceStatus === 'UNRESOLVED' ? 'STOP_UNRESOLVED_REFERENCE' : concept.status === 'MATCHED_CONCEPT_ONLY' ? 'STOP_CONCEPT_ONLY' : 'ROLE_RESOLVER_CONTINUE';
    const status = referenceStatus === expectedReference && (concept?.status || null) === expectedConcept && nextStage === expectedNextStage ? 'PASS' : 'FAIL';
    return Object.freeze({ id, current, recent, detection, reference, workingUtterance: working.workingUtterance, concept, expected: { expectedReference, expectedConcept, expectedNextStage }, actual: { referenceStatus, nextStage }, status });
}

const cases = Object.freeze([
    conceptCase('CF-P01', 'V750是什么？', 'MATCHED_CONCEPT_ONLY'),
    conceptCase('CF-P02', '12-120是什么意思？', 'MATCHED_CONCEPT_ONLY'),
    conceptCase('CF-P03', '模板和配方有什么区别？', 'MATCHED_CONCEPT_ONLY'),
    conceptCase('CF-P04', 'BOM跟模板有什么区别？', 'MATCHED_CONCEPT_ONLY'),
    conceptCase('CF-P05', '不锈钢接轴在我们业务里算什么？', 'MATCHED_CONCEPT_ONLY'),
    conceptCase('CF-P06', '浮球在我们这里是配置还是固定件？', 'MATCHED_CONCEPT_ONLY'),
    conceptCase('CF-P07', '木箱和纸箱在系统里分别算什么？', 'MATCHED_CONCEPT_ONLY'),
    conceptCase('CF-N01', 'V750多少钱？', 'NOT_MATCHED'),
    conceptCase('CF-N02', 'V750现在成本多少？', 'NOT_MATCHED'),
    conceptCase('CF-N03', '12-120有几个方案？', 'NOT_MATCHED'),
    conceptCase('CF-N04', '通用款模板有哪些固定件？', 'NOT_MATCHED'),
    conceptCase('CF-N05', 'V750现在用哪个线圈？', 'NOT_MATCHED'),
    conceptCase('CF-N06', '12-120库存多少？', 'NOT_MATCHED'),
    conceptCase('CF-N07', 'V750通用款报价是多少？', 'NOT_MATCHED'),
    integrationCase('RC-01', { current: '这个是什么？', recent: '', entries: [], expectedReference: 'UNRESOLVED', expectedConcept: null, expectedNextStage: 'STOP_UNRESOLVED_REFERENCE' }),
    integrationCase('RC-02', { current: '这个是什么意思？', recent: '我先看看12-120。', entries: [{ expression: '12-120', category: '线圈/线圈方案相关业务表达' }], expectedReference: 'RESOLVED', expectedConcept: 'MATCHED_CONCEPT_ONLY', expectedNextStage: 'STOP_CONCEPT_ONLY' }),
    integrationCase('RC-03', { current: '这个多少钱？', recent: '我先看看12-120。', entries: [{ expression: '12-120', category: '线圈/线圈方案相关业务表达' }], expectedReference: 'RESOLVED', expectedConcept: 'NOT_MATCHED', expectedNextStage: 'ROLE_RESOLVER_CONTINUE' }),
]);

const result = Object.freeze({ phase: 'M4-3A-R8', kind: 'CONCEPT_FAST_PATH_TESTS', total: cases.length, pass: cases.filter(item => item.status === 'PASS').length, fail: cases.filter(item => item.status === 'FAIL').length, cases });
if (outputPath) fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result, null, 2));
if (result.fail) process.exitCode = 1;
