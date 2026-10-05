'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { buildApiIndex } = require('../api/services/ai-assistant/apiIndex.cjs');
const { DOMAIN_CORPUS } = require('../scripts/ai-experiments/api-native-agent/d2B2DomainCorpus.cjs');
const { scoreDomainSemanticCoverage } = require('../scripts/ai-experiments/api-native-agent/d2B2DomainSemanticOracleV2.cjs');
const { domainCoverage } = require('../scripts/ai-experiments/api-native-agent/d2B2AcceptanceEvaluator.cjs');

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
        customer: { id: 1, name: '客户甲' }, quotations: [], orders: [], query: { historyType: 'all', limit: null },
        sourceOfTruth: ['customers', 'quotations', 'orders'],
    } };
    assert.equal(scoreDomainSemanticCoverage(domainCase('D09'), candidate(['quotation'], [], [aggregate])).semanticPass, true);
    const quotationOnly = structuredClone(aggregate); quotationOnly.data.query.historyType = 'quotation';
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
        data: { sourceFiles: [], coverage: { sourceFileCount: 0 } } };
    const scored = scoreDomainSemanticCoverage(domainCase('D12'), candidate(['order', 'knowledge'], [], [packageResult]));
    assert.equal(scored.exactDomainDiagnostic.missingDomains.includes('file'), true);
    assert.equal(scored.semanticPass, true);
    assert.equal(scoreDomainSemanticCoverage(domainCase('D12'), candidate(['order', 'knowledge'])).semanticPass, false);
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
    const changedEvidence = childProcess.execFileSync('git', ['diff', '--name-only', 'ed56109a42859c2c3984f06256c8a3c02d12a00c', '--', 'planning/ai-native-api/M5-D2-B2-runs'], { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(changedEvidence, '');
});
