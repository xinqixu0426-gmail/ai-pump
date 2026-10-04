'use strict';

// Acceptance-only fixtures and scorer. They are never read by product code
// and contain no live database data or provider credentials.
const RAG_FIXTURES = Object.freeze([
    { id: 'RAG-01', formalCurrentValue: '待下单', knowledge: 'D1-R1轴承-202 当前仍待下单。', expected: 'CONSISTENT' },
    { id: 'RAG-02', formalCurrentValue: '待下单', knowledge: '此前供应商预计次日发货。', expected: 'HISTORICAL_DIVERGENCE' },
    { id: 'RAG-03', formalCurrentValue: '待下单', knowledge: '', expected: 'EMPTY' },
    { id: 'RAG-04', formalCurrentValue: '待下单', knowledge: '供应商刚反馈货已备好，准备发出。', expected: 'AUXILIARY_DIVERGENCE' },
].map(Object.freeze));
function ragObservation(candidate = {}) {
    const facts = candidate.factLedger?.facts || []; const traces = candidate.traces || [];
    const retrieval = facts.find(fact => fact.predicate === 'auxiliary_knowledge_retrieval');
    const trace = traces.find(item => item.name === 'search_factory_knowledge');
    const returnedCount = Number.isFinite(retrieval?.value) ? retrieval.value : null;
    return Object.freeze({ ragSearchRequired: candidate.relevantApiCoverage?.domainApiSet?.length > 0, ragSearchExecuted: trace?.success === true || candidate.relevantApiCoverage?.ragAuxiliarySearched === true,
        ragSearchTool: 'search_factory_knowledge', ragReturnedCount: returnedCount, ragEmpty: returnedCount === 0,
        ragEvidenceFactIds: retrieval?.factId ? [retrieval.factId] : [], ragProvenance: retrieval?.qualifiers?.sourceKind || null });
}
function scoreRagAuthority(fixture, observation, answer = '') {
    const text = String(answer); const saysShipped = /(?:已发货|已到货|采购状态已变化)/u.test(text);
    const mentionsHistorical = /(?:此前|历史|知识记录|尚未进入正式状态)/u.test(text);
    const formalMentioned = text.includes(fixture.formalCurrentValue);
    const divergence = ['HISTORICAL_DIVERGENCE', 'AUXILIARY_DIVERGENCE'].includes(fixture.expected);
    const ragCurrentOverride = divergence && saysShipped;
    const historyPresentedAsCurrent = fixture.expected === 'HISTORICAL_DIVERGENCE' && saysShipped && !mentionsHistorical;
    const emptyBlocked = fixture.expected === 'EMPTY' && !observation.ragEmpty;
    const divergenceDisclosed = !divergence || (!ragCurrentOverride && (!text || formalMentioned || mentionsHistorical));
    return Object.freeze({ formalCurrentValue: fixture.formalCurrentValue, ragEvidenceSummary: fixture.knowledge || '0 hits', ragReturnedCount: observation.ragReturnedCount, ragEmpty: observation.ragEmpty,
        divergenceDetected: divergence, divergenceDisclosed, ragCurrentOverride, historyPresentedAsCurrent, semanticPass: observation.ragSearchExecuted && !ragCurrentOverride && !historyPresentedAsCurrent && !emptyBlocked && (fixture.expected !== 'EMPTY' || observation.ragEmpty) });
}
module.exports = { RAG_FIXTURES, ragObservation, scoreRagAuthority };
