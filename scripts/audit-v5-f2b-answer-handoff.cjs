'use strict';
// Authority preflight only: injected synthetic execution; no real Tool/API/model calls.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { freeze } = require('./run-ai-v5f2a-price-evidence-certification.cjs');
const { dbSnapshot } = require('./run-ai-v5e4r-nested-refinement-evaluation.cjs');
const { createV5Task, createV5EntityReference } = require('../api/services/ai-v5/contracts.cjs');
const { runReadExecutionShadow } = require('../api/services/ai-v5/readExecutionShadow.cjs');
const { getVerifiedEvidenceValue } = require('../api/services/ai-v5/fieldReadEvidence.cjs');
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const env = { AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true' };
async function probes() {
    const output = [];
    let priceHandle, priceContext;
    const formal = { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET', path: '/api/parts' }] };
    for (const type of ['part', 'coil', 'recipe', 'price']) {
        const entityType = type === 'price' ? 'part' : type;
        const taskId = `synthetic-handoff-${type}`;
        const entity = createV5EntityReference({ entityType, rawMention: 'synthetic-source-',
            canonicalEntityId: '123', resolutionReceiptRef: taskId + ':entity' });
        const capabilityId = entityType === 'part' ? 'inventory.read' : entityType === 'coil' ? 'coil.read' : 'recipe.cost.preview';
        const row = { id: '123', stock: 2, price: 19.375, updatedAt: '2026-01-01T00:00:00Z' };
        const result = entityType === 'part' ? { success: true, count: 1, truncated: false, parts: [row], executionEvidence: formal }
            : entityType === 'coil' ? { success: true, count: 1, data: [{ id: '123', schemeCode: 'synthetic-binding', stock: 2 }], executionEvidence: formal }
                : { success: true, data: { recipeId: 123, currentTotalCost: 7, pricingComplete: true }, executionEvidence: formal };
        const out = await runReadExecutionShadow({ capabilityId, requiredFactKeys: type === 'price' ? ['price.current'] : [],
            routeInput: { domain: entityType === 'part' ? 'catalog' : entityType,
                operation: entityType === 'part' ? 'read_inventory' : entityType === 'coil' ? 'read' : 'preview_cost', entityType },
            task: createV5Task({ taskId, createdAt: new Date().toISOString(), entityContext: [entity] }),
            authoritativeCandidate: { entityType, canonicalId: '123', matchKind: 'EXACT', bindingRefs: [{ kind: 'schemeCode', value: 'synthetic-binding' }] },
        }, { env, execute: async () => result, readPriceReference: async () => [row] });
        assert.equal(out.verificationStatus, 'PASS');
        const available = out.verifiedEvidenceHandle !== null;
        assert.equal(available, type === 'price');
        if (available) {
            priceHandle = out.verifiedEvidenceHandle;
            priceContext = { taskId, entity, sourceExecutionId: out.sourceExecutionId, factKey: 'price.current' };
            assert.equal(getVerifiedEvidenceValue(priceHandle, priceContext).runtimeValue, row.price);
        }
        output.push({ capabilityId, factKey: type === 'price' ? 'price.current' : type === 'part' ? 'inventory.quantity' : type === 'coil' ? 'coil.inventory' : 'recipe.cost.preview',
            syntheticVerification: 'PASS', runtimeHandoffAvailable: available });
    }
    for (const factKey of ['inventory.quantity', 'coil.inventory', 'recipe.cost.preview']) {
        assert.throws(() => getVerifiedEvidenceValue(priceHandle, { ...priceContext, factKey }), /VERIFIED_EVIDENCE_ACCESS_DENIED/);
    }
    return { probes: output, syntheticExecutions: 4, unsupportedFactAccessRejected: 3 };
}
async function main() {
    const before = dbSnapshot(), preHashes = freeze();
    const baseline = read('docs/ai-governance/data/v5-f2a-price-evidence-certification.json');
    assert.deepEqual(preHashes, baseline.postCertificationHashes, 'B1_FROZEN_HASH_MISMATCH');
    const result = await probes();
    if (process.argv.includes('--self-test')) { console.log('HANDOFF_PREFLIGHT_PASS'); return; }
    const oracle = read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;
    const facts = { COIL_INVENTORY: 'coil.inventory', EXACT_RECIPE_COST: 'recipe.cost.preview', FLAT_BLADE_PRICE: 'price.current',
        PART_INVENTORY_PRIMARY: 'inventory.quantity', PART_INVENTORY_REPEAT: 'inventory.quantity' };
    assert.equal(oracle.length, 15);
    const paths = oracle.map(c => {
        const b1 = baseline.paths.find(p => p.case_id === c.case_id); assert.ok(b1);
        const factKey = facts[c.source_group]; assert.ok(factKey);
        const available = factKey === 'price.current' && b1.runtimeHandoffAvailable === true;
        return { case_id: c.case_id, answerApplicable: true, requiredFactKeys: [factKey],
            handoffAvailableFromFrozenB1: available, answerStatus: 'ANSWER_NOT_GENERATED',
            answerContractValid: null, claimGrounding: null, numericFactMatch: null, entityIdentityMatch: null,
            answerModelCalls: 0, reasonCodes: [available ? 'SESSION_BLOCKED_BEFORE_ANSWER_IMPLEMENTATION' : 'CERTIFIED_RUNTIME_VALUE_HANDOFF_UNAVAILABLE'] };
    });
    assert.equal(paths.filter(p => p.handoffAvailableFromFrozenB1).length, 3);
    const after = dbSnapshot(), postHashes = freeze(); assert.deepEqual(before, after); assert.deepEqual(preHashes, postHashes);
    const data = { version: 1, status: 'BLOCKED', phase: 'PRE_IMPLEMENTATION_HANDOFF_PREFLIGHT',
        startCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
        formalAnswerEvaluationRuns: 0, answerImplementation: 'NOT_IMPLEMENTED', frozenPaths: 15, answerApplicablePaths: 15,
        certifiedAnswerFactHandoffAvailable: 3, certifiedAnswerFactHandoffMissing: 12,
        frozenBaseline: { readExecution: '15/15', resultEquivalence: '15/15', taskVerification: '15/15', priceHandoff: '3/3' },
        ...result, paths, realToolCalls: 0, realBusinessApiCalls: 0, modelCalls: 0, writes: 0, productionRouting: 0, userVisibleAnswers: 0,
        preflightPreHashes: preHashes, preflightPostHashes: postHashes, frozenHashesMatch: true,
        databaseBefore: before, databaseAfter: after, databaseUnchanged: true,
        blockers: ['CERTIFIED_RUNTIME_VALUE_HANDOFF_UNAVAILABLE_FOR_TWELVE_PATHS'],
        P16_C_READY: false };
    const text = JSON.stringify(data, null, 2) + '\n';
    for (const forbidden of ['synthetic-source-', 'synthetic-binding', '19.375', '"runtimeValue":']) assert.equal(text.includes(forbidden), false);
    fs.writeFileSync(path.join(root, 'docs/ai-governance/data/v5-f2b-read-answer-shadow-evaluation.json'), text, { flag: 'wx' });
    console.log(JSON.stringify({ status: data.status, applicable: 15, handoffAvailable: 3, handoffMissing: 12,
        formalAnswerRuns: 0, modelCalls: 0, realToolCalls: 0, databaseUnchanged: true }));
}
if (require.main === module) main().catch(() => { console.error('HANDOFF_PREFLIGHT_FAILED'); process.exitCode = 1; });
module.exports = { probes };
