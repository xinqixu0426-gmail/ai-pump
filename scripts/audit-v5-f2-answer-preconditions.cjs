'use strict';

// P16-B authority preflight only. No Executor, model, HTTP or SQLite invocation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { inspectReadResult } = require('../api/services/ai-v5/readExecutionShadow.cjs');
const { createV5ToolResult } = require('../api/services/ai-v5/contracts.cjs');
const { createEvidenceLedger, addEvidence, toolResultToCandidateEvidence } = require('../api/services/ai-v5/evidenceLedger.cjs');
const { listEvidenceRequirements } = require('../api/services/ai-v5/evidenceRequirements.cjs');
const { verifyV5Task } = require('../api/services/ai-v5/verification.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
function dbState() {
    const file = path.join(root, 'pump.db'), stat = fs.statSync(file);
    function count(dir) {
        if (!fs.existsSync(dir)) return 0;
        return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(path.join(dir, e.name)) : 1), 0);
    }
    return { hash: hash(fs.readFileSync(file)), mtimeMs: stat.mtimeMs, size: stat.size,
        backupCount: count(path.join(root, 'backups')) + count(path.join(root, 'api/backups')) };
}
function frozenFiles() {
    const files = execFileSync('git', ['ls-files', '-z', 'api', 'shared', 'package.json', 'package-lock.json'], { cwd: root }).toString().split('\0').filter(Boolean);
    return hash(JSON.stringify(files.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])));
}
function check() {
    const requirements = listEvidenceRequirements('inventory.read');
    assert.deepEqual(requirements.map(r => r.claimType), ['inventory.quantity']);
    const probes = [];
    for (const [name, extra] of [['PRICE_ABSENT', {}], ['PRICE_NON_NUMERIC', { price: 'synthetic-invalid' }], ['PRICE_NUMERIC', { price: 7 }]]) {
        const entity = { entityType: 'part', canonicalEntityId: 'synthetic-part', resolutionReceiptRef: 'synthetic-receipt' };
        const result = { success: true, truncated: false, count: 1,
            executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'GET' }] },
            parts: [{ id: entity.canonicalEntityId, stock: 0, ...extra }] };
        const valid = inspectReadResult({ toolName: 'search_parts' }, entity, result);
        assert.equal(valid, true);
        const toolResult = createV5ToolResult({ taskId: 'synthetic-task', toolName: 'search_parts', status: 'success', data: null });
        const item = toolResultToCandidateEvidence(toolResult, { evidenceId: 'synthetic-evidence', claimType: requirements[0].claimType,
            capabilityId: 'inventory.read', createdAt: '2026-01-01T00:00:00.000Z', formalSourceValidated: valid,
            freshness: 'CURRENT', entityConsistent: true, entityRef: entity, sourceRef: 'synthetic-source' });
        const ledger = addEvidence(createEvidenceLedger('synthetic-task'), item);
        const verification = verifyV5Task({ ledger, requirements,
            execution: { toolResults: [toolResult], executionRequired: true, orchestrationComplete: true } });
        assert.equal(verification.decision, 'VERIFIED');
        assert.equal(item.claimType, 'inventory.quantity');
        assert.deepEqual(item.metadata, { resultStatus: 'success' });
        probes.push({ probe: name, inspectionAccepted: valid, verificationDecision: verification.decision,
            verifiedClaimType: item.claimType, priceEvidencePresent: false });
    }
    const cases = JSON.parse(read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json')).cases;
    assert.equal(cases.length, 15);
    assert.equal(cases.filter(c => c.source_group === 'FLAT_BLADE_PRICE').length, 3);
    assert.ok(cases.filter(c => c.source_group === 'FLAT_BLADE_PRICE').every(c => c.expected_capability === 'inventory.read'));
    const implementation = read('api/services/ai-v5/readExecutionShadow.cjs');
    assert.ok(implementation.includes("status: 'success', data: null"));
    assert.ok(implementation.includes('options.compare(result)'));
    return { probes, cases, assertions: 'PASS', authoritativePriceCoverage: 'NOT_DEFINED_IN_FROZEN_EVIDENCE_REQUIREMENTS' };
}
function main() {
    const before = dbState(), preHash = frozenFiles();
    const result = check();
    const after = dbState(), postHash = frozenFiles();
    assert.deepEqual(before, after); assert.equal(preHash, postHash);
    const data = { status: 'BLOCKED', phase: 'PRE_IMPLEMENTATION_AUTHORITY_PREFLIGHT',
        startCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
        formalEvaluationRuns: 0, answerModelCalls: 0, interpreterModelCalls: 0, realToolExecutions: 0, businessApiCalls: 0,
        writes: 0, productionRouting: 0, userVisibleAnswers: 0, frozenPaths: 15, answerApplicablePaths: 15,
        answerImplementation: 'NOT_IMPLEMENTED', preflight: { assertions: result.assertions, probes: result.probes,
            priceCoverage: result.authoritativePriceCoverage, affectedPaths: 3 },
        paths: result.cases.map(c => ({ case_id: c.case_id, answerApplicable: true, answerStatus: 'NOT_RUN',
            claimCount: null, groundedClaimCount: null, requiredFactCoverage: null, numericFactMatch: null,
            entityIdentityMatch: null, unsupportedClaimCount: null, internalLeakageCount: null,
            oracleComparison: 'NOT_RUN', v4Comparison: 'NOT_RUN', safeAnswerDigest: null,
            reasonCodes: [c.source_group === 'FLAT_BLADE_PRICE' ? 'REQUIRED_PRICE_OUTSIDE_VERIFIED_CLAIM_SCOPE' : 'SESSION_BLOCKED_BEFORE_IMPLEMENTATION'],
            traceId: null, shadowTaskId: null })),
        blockers: ['REQUIRED_PRICE_OUTSIDE_VERIFIED_CLAIM_SCOPE', 'VERIFIED_VALUE_HANDOFF_NOT_AVAILABLE'],
        databaseBefore: before, databaseAfter: after, databaseUnchanged: true, productionPreHash: preHash, productionPostHash: postHash,
        productionChanged: false, dependenciesChanged: false, P16_C_READY: false };
    const text = JSON.stringify(data, null, 2) + '\n';
    assert.ok(!text.includes('synthetic-part') && !text.includes('synthetic-invalid'));
    fs.writeFileSync(path.join(root, 'docs/ai-governance/data/v5-f2-read-answer-shadow-evaluation.json'), text, { flag: 'wx' });
    console.log(JSON.stringify({ status: data.status, preflight: 'PASS', affectedPaths: 3, modelCalls: 0, apiCalls: 0, databaseUnchanged: true }));
}
if (require.main === module) {
    if (process.argv.includes('--self-test')) { check(); console.log('ANSWER_AUTHORITY_PREFLIGHT_PASS'); }
    else main();
}
