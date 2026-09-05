'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { bindReadArguments } = require('../api/services/ai-v5/readArgumentBinder.cjs');
const { READ_EXECUTION_REGISTRY } = require('../api/services/ai-v5/readExecutionRegistry.cjs');
const { validateLookupResponse } = require('../api/services/ai-v5/typeIndependentEntityResolver.cjs');
const { inspectReadResult } = require('../api/services/ai-v5/readExecutionShadow.cjs');
const { compareCoilRead } = require('../api/services/ai-v5/coilReadComparator.cjs');
const entry = READ_EXECUTION_REGISTRY.find(e => e.toolName === 'search_coils');
const entity = { entityType: 'coil', canonicalEntityId: '123', rawMention: 'not-a-code', resolutionReceiptRef: 'receipt' };
const candidate = { entityType: 'coil', canonicalId: '123', matchKind: 'EXACT', bindingRefs: [{ kind: 'schemeCode', value: 'SCHEME-SYNTHETIC' }] };
const row = { id: 123, schemeCode: 'SCHEME-SYNTHETIC', stock: 0 };
const result = { success: true, count: 1, data: [row], executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET' }] } };
test('authoritative reference only; no raw mention or canonical ID fallback', () => {
    assert.deepEqual(bindReadArguments(entry, entity, candidate).arguments, { schemeCode: 'SCHEME-SYNTHETIC' });
    for (const bad of [null, { ...candidate, bindingRefs: undefined }, { ...candidate, canonicalId: 'other' },
        { ...candidate, entityType: 'part' }, { ...candidate, matchKind: 'FUZZY' },
        ...[[], [{ kind: 'name', value: 'SCHEME-SYNTHETIC' }], [{ kind: 'schemeCode', value: 123 }],
            [{ kind: 'schemeCode', value: '' }], [{ kind: 'schemeCode', value: ' bad ' }],
            [candidate.bindingRefs[0], candidate.bindingRefs[0]]].map(bindingRefs => ({ ...candidate, bindingRefs }))]) {
        assert.equal(bindReadArguments(entry, entity, bad).status, 'ARGUMENT_BINDING_UNSUPPORTED');
    }
});
test('lookup backward compatibility and strict optional binding shape', () => {
    const response = c => ({ version: 1, status: 'OK', complete: true, attemptedEntityTypes: 6, candidateCount: 1, candidates: [c] });
    const { bindingRefs, ...old } = candidate;
    assert.ok(validateLookupResponse(response(old), 6));
    assert.ok(validateLookupResponse(response(candidate), 6));
    assert.throws(() => validateLookupResponse(response({ ...candidate, bindingRefs: [{ kind: 'other', value: 'X' }] }), 6));
    assert.throws(() => validateLookupResponse(response({ ...candidate, bindingRefs: [{ kind: 'schemeCode', value: 1 }] }), 6));
});
test('coil comparison checks exact identity and current inventory including zero', () => {
    assert.equal(compareCoilRead(result, [row], '123'), 'MATCH');
    assert.equal(compareCoilRead({ ...result, data: [{ ...row, stock: 2 }] }, [row], '123'), 'MISMATCH');
    assert.equal(compareCoilRead({ ...result, data: [{ ...row, id: 124 }] }, [row], '123'), 'MISMATCH');
    assert.equal(compareCoilRead(result, [], '123'), 'NOT_COMPARABLE');
    assert.equal(compareCoilRead({ ...result, data: [row, row] }, [row], '123'), 'MISMATCH');
    assert.equal(inspectReadResult(entry, entity, result, { schemeCode: row.schemeCode }), true);
    assert.equal(inspectReadResult(entry, entity, result, { schemeCode: 'other' }), false);
    assert.equal(inspectReadResult(entry, entity, { ...result, executionEvidence: null }, { schemeCode: row.schemeCode }), false);
});
