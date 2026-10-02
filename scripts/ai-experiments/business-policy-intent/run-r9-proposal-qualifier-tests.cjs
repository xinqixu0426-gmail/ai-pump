'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateCandidateProposals } = require('./groundingPipeline.cjs');
const { detectConceptQuestionFastPath } = require('./conceptQuestionFastPath.cjs');

const root = path.resolve(__dirname, '../../..');
const outputPath = path.join(root, 'planning/business-understanding/M4-3A-R9-Proposal-Qualifier-Tests.json');

const multipleV750 = Object.freeze({
    mention: 'V750', entityType: 'recipe', status: 'MULTIPLE', canonicalId: null, canonicalName: null,
    candidates: Object.freeze([{ canonicalId: '11', canonicalName: 'V750-通用款' }, { canonicalId: '12', canonicalName: 'V750-豪贝款' }]),
    proposal: Object.freeze({ expression: 'V750', source: 'ROLE_CLASSIFIER' }),
});
const exactTemplate = Object.freeze({ mention: '通用款模板', entityType: 'template', status: 'EXACT', canonicalId: '31', canonicalName: '通用款模板', candidates: Object.freeze([{ canonicalId: '31', canonicalName: '通用款模板' }]), proposal: Object.freeze({ expression: '通用款模板', source: 'ROLE_CLASSIFIER' }) });
const unresolved = mention => Object.freeze({ mention, entityType: null, status: 'UNRESOLVED', candidates: Object.freeze([]), proposal: Object.freeze({ expression: mention, source: 'ROLE_CLASSIFIER' }) });

function finalNames(result) { return result.finalGroundedTargets.map(item => item.canonicalName || item.mention); }
function run(id, actual, expected) {
    const pass = expected(actual);
    return Object.freeze({ id, status: pass ? 'PASS' : 'FAIL', actual });
}

const results = [
    run('PV-01', validateCandidateProposals({ probeResults: [multipleV750, unresolved('V750成本')], workingUtterance: '查一下V750成本。' }), value => JSON.stringify(finalNames(value)) === JSON.stringify(['V750']) && value.unresolvedProposalWarnings.length === 1),
    run('PV-02', validateCandidateProposals({ probeResults: [multipleV750, unresolved('线圈')], workingUtterance: '查一下V750现在用哪个线圈。' }), value => JSON.stringify(finalNames(value)) === JSON.stringify(['V750']) && value.unresolvedProposalWarnings.length === 1),
    run('PV-03', validateCandidateProposals({ probeResults: [exactTemplate, unresolved('固定件')], workingUtterance: '通用款模板有哪些固定件？' }), value => JSON.stringify(finalNames(value)) === JSON.stringify(['通用款模板']) && value.unresolvedProposalWarnings.length === 1),
    run('PV-04', validateCandidateProposals({ probeResults: [unresolved('不存在型号')], workingUtterance: '不存在型号多少钱？' }), value => value.finalGroundedTargets.length === 0 && value.unresolvedProposalWarnings.length === 1),
    run('QR-01', validateCandidateProposals({ probeResults: [multipleV750, unresolved('通用款')], workingUtterance: '通用款的V750成本多少？' }), value => JSON.stringify(finalNames(value)) === JSON.stringify(['V750-通用款'])),
    run('QR-02', validateCandidateProposals({ probeResults: [multipleV750, unresolved('豪贝款')], workingUtterance: '豪贝款的V750成本多少？' }), value => JSON.stringify(finalNames(value)) === JSON.stringify(['V750-豪贝款'])),
    run('QR-03', validateCandidateProposals({ probeResults: [multipleV750, unresolved('通用款'), unresolved('豪贝款')], workingUtterance: '通用款和豪贝款的V750成本分别多少？' }), value => JSON.stringify(finalNames(value)) === JSON.stringify(['V750-通用款', 'V750-豪贝款'])),
    run('QR-04', validateCandidateProposals({ probeResults: [multipleV750, unresolved('出口款')], workingUtterance: '出口款的V750成本多少？' }), value => JSON.stringify(finalNames(value)) === JSON.stringify(['V750']) && value.qualifierRefinements[0].noMatchQualifiers.includes('出口款')),
    run('QR-05', validateCandidateProposals({ probeResults: [Object.freeze({ ...multipleV750, candidates: Object.freeze([{ canonicalId: '11', canonicalName: 'V750-通用款-A' }, { canonicalId: '12', canonicalName: 'V750-通用款-B' }]) }), unresolved('通用款')], workingUtterance: '通用款的V750成本多少？' }), value => JSON.stringify(finalNames(value)) === JSON.stringify(['V750']) && value.qualifierRefinements[0].ambiguousQualifiers.includes('通用款')),
    run('QR-06', validateCandidateProposals({ probeResults: [multipleV750], workingUtterance: 'V750成本多少？' }), value => JSON.stringify(finalNames(value)) === JSON.stringify(['V750']) && value.qualifierRefinements[0].qualifiers.length === 0),
    run('CF-PLURAL-01', detectConceptQuestionFastPath('木箱和纸箱在我们系统里分别算什么？'), value => value.status === 'MATCHED_CONCEPT_ONLY'),
    run('CF-PLURAL-02', detectConceptQuestionFastPath('木箱和纸箱分别多少钱？'), value => value.status === 'NOT_MATCHED'),
    run('CF-PLURAL-03', detectConceptQuestionFastPath('V750和V110分别成本多少？'), value => value.status === 'NOT_MATCHED'),
];

const evidence = Object.freeze({ phase: 'M4-3A-R9', kind: 'DETERMINISTIC_PROPOSAL_QUALIFIER_TESTS', total: results.length, pass: results.filter(item => item.status === 'PASS').length, fail: results.filter(item => item.status === 'FAIL').length, results });
fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(evidence, null, 2));
if (evidence.fail) process.exitCode = 1;
