'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { buildApiIndex } = require('../api/services/ai-assistant/apiIndex.cjs');
const { semanticBoundaryFor } = require('../api/services/ai-assistant/apiIndexSemanticProjection.cjs');
const { answerFocusContract, candidateSystemPrompt } = require('../scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs');
const { DOMAIN_CORPUS } = require('../scripts/ai-experiments/api-native-agent/d2B2DomainCorpus.cjs');
const { collectFormalEvidence, evidenceProducerFor, payloadFactState, scoreDomainSemanticCoverage } = require('../scripts/ai-experiments/api-native-agent/d2B2DomainSemanticOracleV2.cjs');
const { domainCoverage } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceEvaluator.cjs');
const { scoreAnswerRelevance } = require('../scripts/ai-experiments/api-native-agent/d2B2R6AcceptanceScoring.cjs');

function domainCase(id) { return DOMAIN_CORPUS.find(item => item.id === id); }
function fact(factId, predicate, tool, options = {}) {
    return { factId, predicate, verified: true, authority: 'FORMAL_API', source: { tool },
        entity: options.entity === false ? null : { type: options.entityType || 'recipe', id: 1, canonicalName: options.name || 'V750-通用款' },
        value: options.value ?? true, qualifiers: options.qualifiers || {} };
}
function candidate(selectedBusinessDomains, facts = [], toolResults = [], status = 'COMPLETED') {
    return { relevantApiCoverage: { selectedBusinessDomains }, factLedger: { facts }, toolResults,
        answerValidation: { goals: [{ questionIndex: 0, status, factIds: facts.map(item => item.factId) }] } };
}

test('domain navigation is non-exclusive and every exposed capability has fact/authority/negative-boundary semantics', () => {
    const index = buildApiIndex();
    assert.equal(index.modelIndexV1.length, 31);
    assert.equal(index.modelIndexV1.reduce((sum, item) => sum + item.domains.length, 0), 43);
    assert.ok(index.modelIndexV1.filter(item => item.domains.length > 1).length > 0);
    for (const entry of index.modelIndexV1) {
        assert.ok(entry.semanticBoundary.primaryBusinessResponsibility, entry.toolName);
        assert.ok(entry.semanticBoundary.formalFactsProduced.length > 0, entry.toolName);
        assert.ok(entry.semanticBoundary.formalFactsProduced.every(name => entry.semanticBoundary.factAuthorities[name]), entry.toolName);
        assert.ok(entry.semanticBoundary.factsItDoesNotEstablish.length > 0, entry.toolName);
    }
    assert.equal(index.modelIndexV1.find(item => item.toolName === 'get_recipe_detail').semanticBoundary.factAuthorities.current_cost, 'costEngine');
});

test('D04 current cost passes without literal cost domain only with complete costEngine-authoritative evidence', () => {
    const good = candidate(['recipe'], [fact('F-COST', 'current_cost', 'get_recipe_detail', { value: 123.45, qualifiers: { costComplete: true, moneyRole: 'CURRENT_FORMAL' } })]);
    const scored = scoreDomainSemanticCoverage(domainCase('D04'), good);
    assert.equal(scored.exactDomainDiagnostic.missingDomains.includes('cost'), true);
    assert.equal(scored.semanticPass, true);
    assert.equal(scoreDomainSemanticCoverage(domainCase('D04'), candidate(['recipe'], [fact('F-RECIPE', 'recipe_identity', 'get_recipe_detail')])).classification, 'TRUE_PRODUCT_DOMAIN_MISS');
});

test('D09 aggregate customer history can establish both histories, while quotation-only evidence cannot', () => {
    const aggregate = { agentToolName: 'search_customer_history', success: true, verified: true, data: {
        customer: { id: 1, name: '客户甲' }, quotations: [], orders: [],
        sourceOfTruth: ['customers', 'quotations', 'orders'],
    }, queryReceipt: { appliedFilters: { customerId: 1, historyType: 'all' }, returnedCount: 0, totalCount: 0, truncated: false, possiblyTruncated: false } };
    assert.equal(scoreDomainSemanticCoverage(domainCase('D09'), candidate(['quotation'], [], [aggregate])).semanticPass, true);
    const quotationOnly = structuredClone(aggregate); quotationOnly.queryReceipt.appliedFilters.historyType = 'quotation';
    assert.equal(scoreDomainSemanticCoverage(domainCase('D09'), candidate(['quotation'], [], [quotationOnly])).classification, 'TRUE_PRODUCT_DOMAIN_MISS');
});

test('D11 recipe navigation can establish inventory through formal readiness, but recipe identity/BOM alone fails', () => {
    const inventory = candidate(['recipe'], [
        fact('F-READY', 'readiness_status', 'preview_virtual_readiness', { value: 'READY', qualifiers: { coverageComplete: true } }),
        fact('F-COMPLETE', 'collection_completeness', 'preview_virtual_readiness', { value: 'COMPLETE' }),
    ]);
    assert.equal(scoreDomainSemanticCoverage(domainCase('D11'), inventory).semanticPass, true);
    const identityOnly = candidate(['recipe'], [fact('F-RECIPE', 'recipe_identity', 'get_recipe_detail')]);
    assert.equal(scoreDomainSemanticCoverage(domainCase('D11'), identityOnly).classification, 'TRUE_PRODUCT_DOMAIN_MISS');
});

test('D12 order/knowledge selection can establish a complete empty attachment collection without literal file label', () => {
    const packageResult = { agentToolName: 'get_order_knowledge_package', success: true, verified: true,
        data: { order: { id: 1, orderNo: 'ORDER-A' }, sourceFiles: [], coverage: { sourceFileCount: 0 } } };
    const scored = scoreDomainSemanticCoverage(domainCase('D12'), candidate(['order', 'knowledge'], [], [packageResult]));
    assert.equal(scored.exactDomainDiagnostic.missingDomains.includes('file'), true);
    assert.equal(scored.semanticPass, true);
    assert.equal(scoreDomainSemanticCoverage(domainCase('D12'), candidate(['order', 'knowledge'])).semanticPass, false);
});

test('capability advertisement never substitutes for a predicate actually produced in this execution', () => {
    const emptyVerified = { agentToolName: 'get_recipe_detail', success: true, verified: true, data: {} };
    assert.deepEqual(collectFormalEvidence(candidate(['recipe'], [], [emptyVerified])), []);
    assert.equal(payloadFactState('get_recipe_detail', 'current_cost', emptyVerified), null);
    assert.equal(scoreDomainSemanticCoverage(domainCase('D04'), candidate(['recipe'], [], [emptyVerified])).semanticPass, false);
});

test('SHORTAGE_PROCUREMENT requires complete order-shortage scope and procurement evidence for the same material and order scope', () => {
    const scope = { scopeKey: 'order:1', orderContext: true };
    const good = candidate(['order', 'procurement'], [
        fact('F-S', 'shortage_quantity', 'check_order_readiness', { entityType: 'part', name: 'D1-R1轴承-202', value: 3, qualifiers: { ...scope, quantityRole: 'SHORTAGE' } }),
        fact('F-P', 'purchase_status', 'check_order_readiness', { entityType: 'part', name: 'D1-R1轴承-202', value: '待下单', qualifiers: { ...scope, requirementRef: 'order_shortages:0' } }),
        fact('F-C', 'collection_completeness', 'check_order_readiness', { entityType: 'order', name: 'ORDER-A', value: 'COMPLETE', qualifiers: { ...scope, collectionRef: 'order_shortages', complete: true } }),
    ]);
    assert.equal(scoreDomainSemanticCoverage(domainCase('D08'), good).semanticPass, true);
    const wrongScope = structuredClone(good); wrongScope.factLedger.facts[1].qualifiers.scopeKey = 'order:2';
    assert.equal(scoreDomainSemanticCoverage(domainCase('D08'), wrongScope).classification, 'TRUE_PRODUCT_DOMAIN_MISS');
    const partial = structuredClone(good); partial.factLedger.facts[2].value = 'PARTIAL';
    assert.equal(scoreDomainSemanticCoverage(domainCase('D08'), partial).classification, 'TRUE_PRODUCT_DOMAIN_MISS');
});

test('identity clarification is accepted only for the required target type and a cited formal resolution fact', () => {
    const recipeBlock = fact('F-ID', 'identity_ambiguous', 'resolve_entity', { entity: false, value: 'recipe', qualifiers: { mention: '这个配方' } });
    const relevant = candidate(['recipe'], [recipeBlock], [], 'CLARIFICATION');
    assert.equal(scoreDomainSemanticCoverage(domainCase('D11'), relevant).classification, 'SAFE_IDENTITY_CLARIFICATION');
    const unrelated = candidate(['recipe'], [fact('F-ID', 'identity_ambiguous', 'resolve_entity', { entity: false, value: 'part' })], [], 'CLARIFICATION');
    assert.equal(scoreDomainSemanticCoverage(domainCase('D11'), unrelated).classification, 'TRUE_PRODUCT_DOMAIN_MISS');
    const uncited = candidate(['recipe'], [recipeBlock], [], 'CLARIFICATION'); uncited.answerValidation.goals[0].factIds = [];
    assert.equal(scoreDomainSemanticCoverage(domainCase('D11'), uncited).classification, 'TRUE_PRODUCT_DOMAIN_MISS');
});

test('semantic projection has one fail-closed evidence producer contract for every advertised fact', () => {
    for (const entry of buildApiIndex().modelIndexV1) {
        for (const predicate of entry.semanticBoundary.formalFactsProduced) {
            assert.ok(evidenceProducerFor(entry.toolName, predicate), `${entry.toolName}:${predicate}`);
        }
    }
    const empty = { success: true, verified: true, data: {} };
    for (const entry of buildApiIndex().modelIndexV1) {
        for (const predicate of entry.semanticBoundary.formalFactsProduced) {
            if (evidenceProducerFor(entry.toolName, predicate) === 'PREDICATE_SPECIFIC_PAYLOAD_EXTRACTOR') {
                assert.equal(payloadFactState(entry.toolName, predicate, empty), null, `${entry.toolName}:${predicate}`);
            }
        }
    }
    assert.throws(() => semanticBoundaryFor({ toolName: 'invented_tool', domains: [], sourceOfTruth: 'none', formalSources: [] }), /Missing model semantic boundary/);
});

test('D04 preserved evidence is an answer-focus/finalization failure, and the generic focus contract keeps explicit comparisons in scope', () => {
    const preserved = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'planning/ai-native-api/M5-D2-B2-runs/domain-corpus/r6c2-domain-20261005-01/cases/D04.json'), 'utf8')).result;
    assert.match(preserved.finalizationAttempts[0].raw, /当前正式成本为 224 元\/台/);
    assert.deepEqual(JSON.parse(preserved.finalizationAttempts[0].raw).claims[0].factIds, ['F-048', 'F-203', 'F-204']);
    assert.equal(preserved.finalizationAttempts[0].code, 'MONEY_CLAIM_BINDING_MISMATCH');
    assert.equal(preserved.finalizationAttempts[1].code, 'MONEY_CLAIM_UNCLAIMED');
    const focus = answerFocusContract('V750-通用款当前成本多少？');
    assert.match(focus, /what must be investigated, not what must be reported/);
    assert.match(focus, /explicitly asks for comparison, scenario analysis, a breakdown, history, detail, or an explanation/);
    assert.match(candidateSystemPrompt({ businessMemo: '', policyMemo: '', ontologyContext: '', apiIndex: '' }), /Investigation breadth and answer breadth are different/);
    const current = fact('F-C', 'current_cost', 'get_recipe_detail', { value: 224, qualifiers: { costComplete: true, moneyRole: 'CURRENT_FORMAL' } });
    const scenario = fact('F-S', 'scenario_cost', 'compare_recipe_scenarios', { value: 242, qualifiers: { moneyRole: 'SCENARIO_CANDIDATE' } });
    const difference = fact('F-D', 'scenario_cost_difference', 'compare_recipe_scenarios', { value: 18, qualifiers: { moneyRole: 'SCENARIO_DIFFERENCE' } });
    const focused = candidate(['recipe'], [current, scenario, difference]); focused.answerValidation.claims = [{ factIds: ['F-C'] }];
    assert.equal(scoreAnswerRelevance({ caseKind: 'CURRENT_COST', candidate: focused }).answerDumpedUnrequestedContext, false);
    focused.answerValidation.claims[0].factIds.push('F-S', 'F-D');
    assert.equal(scoreAnswerRelevance({ caseKind: 'CURRENT_COST', candidate: focused }).answerDumpedUnrequestedContext, true);
});

test('extra domains are diagnostic only, while selected-domain full expansion and write exclusion remain strict', () => {
    const scored = scoreDomainSemanticCoverage(domainCase('D01'), candidate(['order', 'knowledge'], [fact('F-ORDER', 'order_status', 'get_order_detail', { entityType: 'order', name: 'ORDER-A' })]));
    assert.equal(scored.semanticPass, true); assert.deepEqual(scored.extraDomainLabels, ['knowledge']);
    const coverage = domainCoverage({ domainRuntime: { selectedBusinessDomains: ['order'], apiTerminalStates: [] } });
    assert.ok(coverage.missingDomainApis.length > 0);
    assert.deepEqual(coverage.writeInDomainSet, []);
    assert.equal(buildApiIndex().modelIndexV1.some(item => item.access === 'write'), false);
});

test('frozen V1 domain oracle and preserved C2 evidence remain byte-identical to the preserved C2 commit', () => {
    const root = path.join(__dirname, '..');
    const relative = 'scripts/ai-experiments/api-native-agent/d2B2DomainCorpus.cjs';
    const frozen = childProcess.execFileSync('git', ['show', `ed56109a42859c2c3984f06256c8a3c02d12a00c:${relative}`], { cwd: root, encoding: 'utf8' });
    assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), frozen);
    // Later acceptance batches are additive evidence. Immutability means that
    // evidence already present at the preserved commit cannot be modified,
    // deleted, or renamed; it does not prohibit new run-unique artifacts.
    const changedEvidence = childProcess.execFileSync('git', ['diff', '--name-only', '--diff-filter=MDR', 'ed56109a42859c2c3984f06256c8a3c02d12a00c', '--', 'planning/ai-native-api/M5-D2-B2-runs'], { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(changedEvidence, '');
});
