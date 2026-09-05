'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const facts = require('../api/services/ai-v5/fieldReadEvidence.cjs');
const { createEvidenceLedger, addEvidence, createV5EvidenceItem } = require('../api/services/ai-v5/evidenceLedger.cjs');
const { listEvidenceRequirements } = require('../api/services/ai-v5/evidenceRequirements.cjs');
const { verifyV5Task } = require('../api/services/ai-v5/verification.cjs');
function setup(factKey, value = 971.375, changes = {}) {
    const spec = facts.APPROVED_RUNTIME_FACTS[factKey];
    const entity = { entityType: spec.entityType, canonicalEntityId: 'synthetic-id', resolutionReceiptRef: 'synthetic-receipt' };
    const item = createV5EvidenceItem({ evidenceId: 'synthetic-evidence', taskId: 'synthetic-task',
        evidenceType: 'DIRECT_FACT', status: 'VALID', claimType: factKey, sourceType: 'TOOL', sourceRef: 'synthetic-execution',
        entityRef: entity, toolName: spec.sourceTool, capabilityId: spec.capabilityId, freshness: 'CURRENT',
        createdAt: '2026-01-01T00:00:00Z', ...changes });
    const ledger = addEvidence(createEvidenceLedger('synthetic-task'), item);
    const result = spec.entityType === 'part' ? { success: true, parts: [{ id: 'synthetic-id', stock: value }] }
        : spec.entityType === 'coil' ? { success: true, data: [{ id: 'synthetic-id', stock: value }] }
            : { success: true, data: { recipeId: 'synthetic-id', currentTotalCost: value } };
    const receipt = facts.captureReadFactValue({ ledger, evidenceId: item.evidenceId, result, entity });
    const verification = verifyV5Task({ ledger, requirements: listEvidenceRequirements(spec.capabilityId),
        execution: { toolResults: [{ status: 'success' }], orchestrationComplete: true } });
    return { ledger, receipt, verification, entity, result, context: { taskId: 'synthetic-task', entity, factKey, sourceExecutionId: 'synthetic-execution' } };
}
const keys = ['inventory.quantity', 'coil.inventory', 'recipe.cost.preview'];
for (const key of keys) {
    test(`${key}: explicit verified field access, isolation and immutable runtime snapshot`, () => {
        const s = setup(key);
        assert.equal(s.verification.decision, 'VERIFIED');
        const handle = facts.createVerifiedValueHandoff(s.ledger, s.verification, s.receipt);
        const out = facts.getVerifiedEvidenceValue(handle, s.context);
        assert.equal(out.runtimeValue, 971.375);
        assert.equal(JSON.stringify({ handle, out }).includes('971.375'), false);
        if (Array.isArray(s.result.data)) s.result.data[0].stock = 0;
        if (s.result.parts) s.result.parts[0].stock = 0;
        assert.equal(facts.getVerifiedEvidenceValue(handle, s.context).runtimeValue, 971.375);
        for (const bad of [{ taskId: 'another' }, { factKey: 'unknown' }, ...Object.keys(facts.APPROVED_RUNTIME_FACTS).filter(k => k !== key).map(factKey => ({ factKey })),
            { sourceExecutionId: 'another' }, { entity: { ...s.entity, canonicalEntityId: 'another' } }, { entity: { ...s.entity, resolutionReceiptRef: 'another' } }]) {
            assert.throws(() => facts.getVerifiedEvidenceValue(handle, { ...s.context, ...bad }), /^Error: VERIFIED_EVIDENCE_ACCESS_DENIED$/);
        }
    });
    for (const [label, value] of [['missing', undefined], ['null', null], ['string', '971.375'], ['object', {}], ['NaN', NaN], ['Infinity', Infinity], ['negativeInfinity', -Infinity]]) {
        test(`${key}: ${label} cannot be handed off`, () => {
            const s = setup(key, value === undefined ? null : value);
            if (value === undefined) {
                const noValue = s.entity.entityType === 'part' ? { success: true, parts: [{ id: 'synthetic-id' }] }
                    : s.entity.entityType === 'coil' ? { success: true, data: [{ id: 'synthetic-id' }] }
                        : { success: true, data: { recipeId: 'synthetic-id' } };
                assert.equal(facts.captureReadFactValue({ ledger: s.ledger, evidenceId: 'synthetic-evidence', result: noValue, entity: s.entity }), null);
            }
            assert.equal(s.receipt, null);
            assert.equal(facts.createVerifiedValueHandoff(s.ledger, s.verification, s.receipt), null);
        });
    }
    test(`${key}: invalid/unverified evidence, forged, FAIL and deferred verification rejected`, () => {
        for (const status of ['INVALID', 'UNKNOWN', 'MISSING', 'STALE']) {
            const s = setup(key, 1, { status });
            assert.equal(s.receipt, null);
            assert.equal(facts.createVerifiedValueHandoff(s.ledger, s.verification, s.receipt), null);
        }
        const s = setup(key);
        for (const decision of ['VERIFIED', 'UNVERIFIED', 'FAILED_EVIDENCE', 'DEFERRED']) {
            assert.equal(facts.createVerifiedValueHandoff(s.ledger, { taskId: 'synthetic-task', decision }, s.receipt), null);
        }
        assert.equal(facts.createVerifiedValueHandoff(s.ledger, s.verification, {}), null);
        const changed = structuredClone(s.ledger); changed.items[0].sourceRef = 'another';
        assert.equal(facts.createVerifiedValueHandoff(changed, s.verification, s.receipt), null);
    });
}
test('registry is closed, metadata only, no bulk getter', () => {
    assert.deepEqual(Object.keys(facts.APPROVED_RUNTIME_FACTS), ['price.current', ...keys]);
    assert.ok(Object.isFrozen(facts.APPROVED_RUNTIME_FACTS));
    assert.equal(facts.dumpAllVerifiedValues, undefined);
    const s = setup(keys[0]);
    assert.throws(() => facts.getVerifiedEvidenceValue(facts.createVerifiedValueHandoff(s.ledger, s.verification, s.receipt), {}), /ACCESS_DENIED/);
});
