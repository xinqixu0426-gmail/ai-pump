'use strict';

// Acceptance oracle only. Production receives neither these inputs nor the
// expected sets; runtime selection remains the Main Agent's control-plane act.
const DOMAIN_CORPUS = Object.freeze([
    ['D01', 'ORDER-A现在是什么情况？', ['order']], ['D02', '有哪些待采购任务？', ['procurement']],
    ['D03', '查一下V750-通用款配方资料。', ['recipe']], ['D04', 'V750-通用款当前成本多少？', ['cost']],
    ['D05', '12-120有哪些线圈方案？', ['coil']], ['D06', '查一下当前报价。', ['quotation']],
    ['D07', '知识库里以前记录过什么？', ['knowledge']], ['D08', 'ORDER-A缺什么？缺的东西有没有采购？', ['order', 'procurement']],
    ['D09', '这个客户以前有哪些报价和订单？', ['business_history', 'quotation', 'order']], ['D10', '这个配方当前成本多少？', ['recipe', 'cost']],
    ['D11', '这个配方库存够不够？', ['recipe', 'inventory']], ['D12', 'ORDER-A有哪些明确知识记录或附件？', ['order', 'knowledge', 'file']],
].map(([id, ownerInput, expectedDomains]) => Object.freeze({ id, ownerInput, expectedDomains: Object.freeze(expectedDomains) })));
function scoreDomainSelection(testCase, selectedDomains = []) { const selected = [...new Set(selectedDomains)].sort(); const expected = [...testCase.expectedDomains].sort(); const missingDomains = expected.filter(item => !selected.includes(item)); const extraDomains = selected.filter(item => !expected.includes(item)); return Object.freeze({ id: testCase.id, expectedDomains: expected, selectedDomains: selected, exactMatch: !missingDomains.length && !extraDomains.length, missingDomains, extraDomains, highRiskMiss: missingDomains.length > 0 }); }
module.exports = { DOMAIN_CORPUS, scoreDomainSelection };
