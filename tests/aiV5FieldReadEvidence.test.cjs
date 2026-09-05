'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEvidenceLedger, addEvidence } = require('../api/services/ai-v5/evidenceLedger.cjs');
const { listEvidenceRequirements, listFieldEvidenceRequirements } = require('../api/services/ai-v5/evidenceRequirements.cjs');
const { verifyV5Task } = require('../api/services/ai-v5/verification.cjs');
const { extractPriceEvidence, verifyPriceEvidence, createVerifiedValueHandoff, getVerifiedEvidenceValue } = require('../api/services/ai-v5/fieldReadEvidence.cjs');
const { createV5Task, createV5EntityReference } = require('../api/services/ai-v5/contracts.cjs');
const { runReadExecutionShadow } = require('../api/services/ai-v5/readExecutionShadow.cjs');
const entity = Object.freeze({ entityType: 'part', canonicalEntityId: 'fake-id', resolutionReceiptRef: 'fake-receipt' });
const context = { taskId: 'fake-task', entity, sourceExecutionId: 'fake-execution', factKey: 'price.current' };
const row = () => ({ id: 'fake-id', price: 19.375, stock: 2, updatedAt: '2026-01-01T00:00:00Z' });
const result = r => ({ success: true, count: 1, truncated: false, parts: [r],
    executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/parts?keyword=fake' }] } });
function setup(r = row()) {
    const e = extractPriceEvidence({ ...context, capabilityId: 'inventory.read', sourceTool: 'search_parts', result: result(r) });
    const ledger = addEvidence(createEvidenceLedger(context.taskId), e.item);
    return { ...e, ledger };
}
const check = (e, extra = {}) => verifyPriceEvidence({ ...context, ledger: e.ledger, receipt: e.receipt, referenceRows: [row()], ...extra });
const verify = e => verifyV5Task({ ledger: e.ledger, requirements: listFieldEvidenceRequirements('inventory.read', ['price.current']),
    priceEvidenceReceipt: e.receipt, execution: { toolResults: [{ status: 'success' }], orchestrationComplete: true } });

test('DIRECT_FACT price is extracted before independent reference verification, then handed off', () => {
    const e = setup();
    assert.equal(e.item.evidenceType, 'DIRECT_FACT'); assert.equal(e.valid, true);
    assert.equal(verify(e).decision, 'FAILED_EVIDENCE');
    assert.equal(createVerifiedValueHandoff(e.ledger, verify(e), e.receipt), null);
    assert.equal(check(e).status, 'PASS'); assert.equal(verify(e).decision, 'VERIFIED');
    assert.equal(createVerifiedValueHandoff(e.ledger, { taskId: context.taskId, decision: 'VERIFIED' }, e.receipt), null);
    const handle = createVerifiedValueHandoff(e.ledger, verify(e), e.receipt);
    assert.equal(getVerifiedEvidenceValue(handle, context).runtimeValue, row().price);
    assert.equal(JSON.stringify(getVerifiedEvidenceValue(handle, context)).includes(String(row().price)), false);
    assert.throws(() => getVerifiedEvidenceValue({}, context), /ACCESS_DENIED/);
    for (const bad of [{ taskId: 'other' }, { factKey: 'inventory.quantity' }, { sourceExecutionId: 'other' },
        { entity: { ...entity, canonicalEntityId: 'other' } }, { entity: { ...entity, resolutionReceiptRef: 'other' } }]) {
        assert.throws(() => getVerifiedEvidenceValue(handle, { ...context, ...bad }), /ACCESS_DENIED/);
    }
});
for (const [name, price] of [['missing', undefined], ['null', null], ['string', '19.375'], ['object', {}],
    ['NaN', NaN], ['Infinity', Infinity], ['negative Infinity', -Infinity]]) {
    test(`reject ${name} price without coercion`, () => {
        const e = setup({ ...row(), price }); assert.equal(e.valid, false);
        assert.equal(check(e).status, 'FAIL'); assert.equal(verify(e).decision, 'FAILED_EVIDENCE');
    });
}
test('zero price is valid, not replaced by a default', () => {
    const e = setup({ ...row(), price: 0 });
    assert.equal(check(e, { referenceRows: [{ ...row(), price: 0 }] }).status, 'PASS');
});
for (const [name, mutate] of [
    ['factKey', i => { i.claimType = 'inventory.quantity'; }],
    ['field', i => { i.metadata.field = 'stock'; }],
    ['metadata factKey', i => { i.metadata.factKey = 'stock'; }],
    ['entity', i => { i.entityRef.canonicalEntityId = 'other'; }],
    ['task', i => { i.taskId = 'other'; }],
    ['execution', i => { i.sourceRef = 'other'; }],
    ['invalid evidence', i => { i.status = 'INVALID'; }],
    ['stale evidence', i => { i.freshness = 'STALE'; }],
    ['currency', i => { i.metadata.currency = 'other'; }],
    ['unit', i => { i.metadata.unit = 'other'; }],
]) {
    test(`reject wrong ${name}`, () => {
        const e = setup(), ledger = structuredClone(e.ledger); mutate(ledger.items[0]);
        assert.equal(check(e, { ledger }).status, 'FAIL');
    });
}
test('reference value, entity, duplicate entity, type and row-version mismatch fail closed', () => {
    for (const referenceRows of [[{ ...row(), price: 20 }], [{ ...row(), id: 'other' }], [row(), row()],
        [{ ...row(), price: '19.375' }], [{ ...row(), updatedAt: 'different-version' }], [{ ...row(), updatedAt: null }]]) {
        assert.equal(check(setup(), { referenceRows }).status, 'FAIL');
    }
    assert.equal(setup({ ...row(), updatedAt: null }).valid, false);
});
test('comparator MATCH or forged metadata alone cannot verify price', () => {
    const e = setup();
    assert.equal(verifyV5Task({ ledger: e.ledger, requirements: listFieldEvidenceRequirements('inventory.read', ['price.current']),
        resultComparison: 'MATCH', execution: { toolResults: [{ status: 'success' }], orchestrationComplete: true } }).decision, 'FAILED_EVIDENCE');
    assert.equal(createVerifiedValueHandoff(e.ledger, { taskId: context.taskId, decision: 'VERIFIED' }, {}), null);
});
test('existing quantity requirement unchanged; unknown, duplicate or wrong capability fields rejected', () => {
    assert.deepEqual(listEvidenceRequirements('inventory.read').map(r => r.claimType), ['inventory.quantity']);
    assert.deepEqual(listFieldEvidenceRequirements('inventory.read'), []);
    for (const [cap, keys] of [['inventory.read', ['other']], ['coil.read', ['price.current']], ['inventory.read', ['price.current', 'price.current']]]) {
        assert.throws(() => listFieldEvidenceRequirements(cap, keys), /SCOPE_UNSUPPORTED/);
    }
});
function executionInput(id = 'fake-task') {
    return { capabilityId: 'inventory.read', requiredFactKeys: ['price.current'],
        routeInput: { domain: 'catalog', operation: 'read_inventory', entityType: 'part' },
        task: createV5Task({ taskId: id, createdAt: new Date().toISOString(), entityContext: [createV5EntityReference({ ...entity, rawMention: 'fake-source-' })] }) };
}
const env = { AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true' };
test('controlled execution integrates quantity plus price; handoff and safe serialization', async () => {
    const i = executionInput(); let calls = 0;
    const out = await runReadExecutionShadow(i, { env, execute: async (_, __, options) => {
        assert.equal(options.allowWrite, false); return result(row());
    }, readPriceReference: async () => { calls++; return [row()]; }, compare: () => 'MATCH' });
    assert.equal(calls, 1); assert.equal(out.evidenceCount, 2); assert.equal(out.verificationStatus, 'PASS');
    assert.equal(out.fieldEvidence.runtimeHandoffAvailable, true);
    assert.equal(getVerifiedEvidenceValue(out.verifiedEvidenceHandle, { ...context, sourceExecutionId: out.sourceExecutionId }).runtimeValue, row().price);
    const serialized = JSON.stringify(out);
    for (const text of ['19.375', 'fake-id', 'fake-source-', 'runtimeValue', 'verifiedEvidenceHandle']) assert.equal(serialized.includes(text), false);
});
test('missing price and reference error/timeout reject handoff even if comparator says MATCH', async () => {
    for (const options of [
        { execute: async () => result({ ...row(), price: null }), readPriceReference: async () => { throw Error('must not read'); } },
        { execute: async () => result(row()), readPriceReference: async () => { throw Error('private business value'); } },
        { execute: async () => result(row()), readPriceReference: () => new Promise(() => {}), timeoutMs: 5 },
        { execute: async () => result(row()), readPriceReference: async () => [{ ...row(), price: 1 }] },
    ]) {
        const out = await runReadExecutionShadow(executionInput(), { env, ...options, compare: () => 'MATCH' });
        assert.equal(out.verificationStatus, 'FAIL'); assert.equal(out.verifiedEvidenceHandle, null);
        assert.equal(JSON.stringify(out).includes('private business value'), false);
    }
});
test('10 concurrent prices cannot cross task or receipt boundaries', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, (_, n) => runReadExecutionShadow(executionInput(`fake-${n}`), {
        env, execute: async () => result({ ...row(), price: n }), readPriceReference: async () => [{ ...row(), price: n }],
    })));
    results.forEach((out, n) => {
        const c = { ...context, taskId: `fake-${n}`, sourceExecutionId: out.sourceExecutionId };
        assert.equal(getVerifiedEvidenceValue(out.verifiedEvidenceHandle, c).runtimeValue, n);
        assert.throws(() => getVerifiedEvidenceValue(results[(n + 1) % 10].verifiedEvidenceHandle, c), /ACCESS_DENIED/);
    });
});
test('Phoenix metadata path and normal logs contain no runtime price/entity values', async () => {
    const obs = require('../api/services/observability.cjs'), spans = [], logs = [];
    const original = console.log;
    console.log = (...args) => logs.push(args);
    try {
        obs.initializeObservability({ env: { AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata' },
            phoenixModule: { register: () => ({ getTracer: () => ({ startActiveSpan(name, options, operation) {
                const r = { name, attributes: { ...options.attributes } }; spans.push(r);
                return operation({ setAttributes: a => Object.assign(r.attributes, a), setAttribute: (k, v) => { r.attributes[k] = v; },
                    setStatus() {}, end() {}, updateName() {} });
            } }), forceFlush: async () => {}, shutdown: async () => {} }) }, logger: { warn() {} } });
        const out = await runReadExecutionShadow(executionInput(), { env, execute: async () => result(row()), readPriceReference: async () => [row()] });
        assert.equal(out.verificationStatus, 'PASS'); assert.ok(spans.some(s => s.name === 'pump.ai.verify'));
        const text = JSON.stringify({ spans, logs, out });
        for (const token of ['19.375', 'fake-id', 'fake-source-', 'fake-receipt', '"price":']) assert.equal(text.includes(token), false);
    } finally { console.log = original; await obs.resetObservabilityForTesting(); }
});
test('certification schema rejects business fields and values in structural slots', () => {
    const { safeRecord } = require('../scripts/run-ai-v5f2a-price-evidence-certification.cjs');
    const safe = { requiredFactKeys: ['price.current'], evidencePresence: [true], evidenceValidity: [true],
        runtimeHandoffAvailable: true, numericTypeMatch: true, reasonCodes: ['PRICE_FIELD_VERIFIED'] };
    assert.doesNotThrow(() => safeRecord(safe));
    assert.throws(() => safeRecord({ ...safe, price: 19.375 }));
    assert.throws(() => safeRecord({ ...safe, evidencePresence: [19.375] }));
    assert.throws(() => safeRecord({ ...safe, runtimeHandoffAvailable: 19.375 }));
});
