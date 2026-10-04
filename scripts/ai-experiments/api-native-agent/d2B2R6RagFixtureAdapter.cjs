'use strict';

// Frozen, acceptance-only knowledge adapter.  It never imports product code
// and delegates every non-knowledge tool verbatim to the real executor.
const { RAG_FIXTURES } = require('./d2B2RagAcceptanceHarness.cjs');

function rowsFor(fixture) {
    if (fixture.id === 'RAG-03') return [];
    return [{ title: fixture.id, summary: fixture.knowledge, entryType: 'business_rule', evidenceLevel: 'confirmed', matchMode: 'keyword' }];
}
function createFrozenRagFixtureExecutor(delegate, fixtureId) {
    if (typeof delegate !== 'function') throw new Error('R6_RAG_DELEGATE_REQUIRED');
    const fixture = RAG_FIXTURES.find(item => item.id === fixtureId);
    if (!fixture) throw new Error('R6_RAG_FIXTURE_UNKNOWN');
    return async function executeToolCall(name, args, options) {
        if (name !== 'search_factory_knowledge') return delegate(name, args, options);
        const data = rowsFor(fixture);
        return {
            success: true,
            verified: true,
            capabilityId: 'ai.search_factory_knowledge',
            intent: 'factory_knowledge_search',
            summary: `工厂知识库返回 ${data.length} 条受控辅助结果。`,
            display: { mode: 'compact', title: '工厂知识库' },
            provenance: { kind: 'knowledge_snapshot', label: 'R6 acceptance-only knowledge fixture', checkedAt: '2026-10-04T00:00:00.000Z', fixtureId },
            data,
        };
    };
}
module.exports = { createFrozenRagFixtureExecutor, rowsFor };
