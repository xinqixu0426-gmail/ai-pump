'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const launch = require('../scripts/ai-experiments/api-native-agent/d2B2R6LaunchAcceptanceAssemblerV2.cjs');

const repositoryEvidence = path.join(__dirname, '../planning/ai-native-api');

test('R2A versioned assembler consumes the immutable 34-case Final Fresh C2 and preserves canonical FAIL', () => {
    const output = launch.assembleLaunchR2(repositoryEvidence);
    assert.equal(output.productFreezeCommit, '65f5cf5380bc460a032b904bb032c4bf18a1ca76');
    assert.equal(output.semanticHarnessFreezeCommit, '39d0f3a2cc862ac632f901c5c2b24982d2610dc7');
    assert.equal(output.domain.results.length, 12);
    assert.equal(output.rag.results.length, 4);
    assert.equal(output.targeted.results.length, 14);
    assert.equal(output.d1.results.length, 4);
    assert.equal(output.final.status, 'FAIL');
    assert.deepEqual(output.final.failedGates, ['DOMAIN_REQUIRED_FACT_COVERAGE', 'RAG_AUTHORITY', 'TARGETED_SEMANTIC', 'DOMAIN_COVERAGE', 'ANSWER_RELEVANCE', 'D1_PROTECTION', 'SAFETY']);
    assert.equal(output.adjudication.semanticFailureCount, 11);
    assert.equal(output.adjudication.observedDeliveredSafety.deliveredWrongMoney, 0);
    assert.equal(output.adjudication.observedDeliveredSafety.businessDbMutations, 0);
});

test('R2A adjudication separates frozen RAG flags from actually delivered answers', () => {
    const output = launch.assembleLaunchR2(repositoryEvidence);
    assert.equal(output.adjudication.frozenScorerFlags.ragOverrideFormal, 2);
    assert.equal(output.adjudication.frozenScorerFlags.historyAsCurrent, 1);
    assert.equal(output.adjudication.observedDeliveredSafety.actualDeliveredRagOverrideFormal, 0);
    assert.equal(output.adjudication.observedDeliveredSafety.actualDeliveredHistoryAsCurrent, 0);
    const rag = output.adjudication.failures.filter(item => item.suite === 'rag');
    assert.equal(rag.length, 4);
    assert.ok(rag.every(item => item.category === 'LIKELY_SCORER_OR_ORACLE_LIMITATION'));
});

test('R2A special reviews retain D04, D11, pending-purchase, and D1 delivered evidence', () => {
    const output = launch.assembleLaunchR2(repositoryEvidence);
    const byId = Object.fromEntries(output.adjudication.failures.map(item => [item.caseId, item]));
    assert.match(byId.D04.finalDeliveredOwnerAnswer, /无法给出确定数值/);
    assert.equal(byId.D04.deliveredMoneyAudit.length, 0);
    assert.equal(byId.D11.goalStatus[0], 'CLARIFICATION');
    assert.equal(byId['PENDING_PURCHASE-03'].goalStatus[0], 'PARTIAL');
    assert.match(byId['PENDING_PURCHASE-03'].finalDeliveredOwnerAnswer, /已全部返回/);
    assert.equal(byId['D1-08'].goalStatus[0], 'UNAVAILABLE');
    assert.equal(byId['D1-08'].rawSafety.write, 0);
});

test('R2A assembly fails closed if immutable source evidence changes and never overwrites outputs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r6-launch-r2a-'));
    fs.cpSync(path.join(repositoryEvidence, 'M5-D2-B2-runs'), path.join(root, 'M5-D2-B2-runs'), { recursive: true });
    const target = path.join(root, 'M5-D2-B2-runs/domain-corpus/r6launchr2-domain-20261005-01/artifact.json');
    fs.appendFileSync(target, '\n');
    assert.throws(() => launch.assembleLaunchR2(root), /R6_LAUNCH_R2A_SOURCE_EVIDENCE_MUTATED/);
    fs.rmSync(path.join(root, 'M5-D2-B2-runs'), { recursive: true });
    fs.cpSync(path.join(repositoryEvidence, 'M5-D2-B2-runs'), path.join(root, 'M5-D2-B2-runs'), { recursive: true });
    launch.publishLaunchR2(root);
    assert.throws(() => launch.publishLaunchR2(root), /R6_LAUNCH_R2A_OUTPUT_EXISTS/);
});
