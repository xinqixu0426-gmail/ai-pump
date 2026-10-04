'use strict';

// Acceptance-only assembly.  Semantic runners write one immutable staging
// artifact; this module is the sole writer of canonical R6 evidence.
const fs = require('node:fs');
const path = require('node:path');
const { sanitizeEvidence, scanForSecrets } = require('./d2B2AcceptanceEvidence.cjs');
const { readStagedRun } = require('./d2B2AcceptanceStaging.cjs');
const { performance } = require('./d2B2R6AcceptanceScoring.cjs');

const PRODUCT_FREEZE_COMMIT = 'cdebfb5ef6f83a4c8b39e93f3f0dcc39077e2251';
const CANONICAL_ARTIFACTS = Object.freeze({
    domain: 'M5-D2-B2-R6-Acceptance-Domain-Corpus.json',
    rag: 'M5-D2-B2-R6-Acceptance-RAG.json',
    targeted: 'M5-D2-B2-R6-Acceptance-Targeted.json',
    coverage: 'M5-D2-B2-R6-Acceptance-Domain-Coverage.json',
    relevance: 'M5-D2-B2-R6-Acceptance-Answer-Relevance.json',
    d1: 'M5-D2-B2-R6-Acceptance-D1.json',
    safety: 'M5-D2-B2-R6-Acceptance-Safety.json',
    performance: 'M5-D2-B2-R6-Acceptance-Performance.json',
    acceptance: 'M5-D2-B2-R6-Acceptance.md',
});

function need(condition, code) { if (!condition) throw new Error(code); }
function flattenResults(artifacts) { return artifacts.flatMap(item => Array.isArray(item.results) ? item.results : []); }
const SAFETY_FIELDS = Object.freeze(['wrongEntity', 'wrongQuantity', 'unknownAsZero', 'partialAsComplete', 'formalConflictSilentSelection', 'ragOverrideFormal', 'historyAsCurrent', 'write', 'businessDbMutation']);
function expectedTargetedComposition(results) {
    const counts = Object.fromEntries(['W1-06', 'SHORTAGE_ONLY', 'PENDING_PURCHASE', 'ORDER_PRODUCTS'].map(key => [key, 0]));
    for (const result of results) if (Object.hasOwn(counts, result.caseId)) counts[result.caseId] += 1;
    return counts;
}
function assertFrozenArtifact(artifact, plan) {
    need(artifact.productFreezeCommit === plan.productFreezeCommit, 'R6_ACCEPTANCE_FREEZE_MISMATCH');
    need(artifact.harnessFreezeCommit === plan.harnessFreezeCommit, 'R6_ACCEPTANCE_FREEZE_MISMATCH');
}
function atomicWrite(target, value) {
    const content = typeof value === 'string' ? value : `${JSON.stringify(sanitizeEvidence(value), null, 2)}\n`;
    need(scanForSecrets(content).pass, 'R6_ACCEPTANCE_SECRET_SCAN_FAILED');
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'w' });
    fs.renameSync(temporary, target);
}
function sumSafety(results) {
    const result = Object.fromEntries(SAFETY_FIELDS.map(field => [field, 0]));
    for (const run of results) for (const field of SAFETY_FIELDS) result[field] += Number(run.safety[field]);
    return Object.freeze(result);
}
function allZero(value) { return Object.values(value).every(item => item === 0); }
function scoreAcceptance({ domain, ragResults, targetedResults, d1, preGates, postGates, all }) {
    const domainScores = domain.results.map(item => item.domainSelectionScore || {});
    const domainExact = domainScores.filter(item => item.exactMatch === true).length;
    const highRiskDomainMiss = domainScores.filter(item => item.highRiskMiss === true).length;
    const ragPassed = ragResults.filter(item => item.ragAuthorityScore?.semanticPass === true).length;
    const targetedPassed = targetedResults.filter(item => item.semanticPass === true).length;
    const d1Passed = d1.results.filter(item => item.semanticPass === true).length;
    const coverage = targetedResults.map(item => item.domainCoverageScore || {});
    const coveragePass = coverage.every(item => item.missingDomainApis?.length === 0 && item.invalidNotApplicable?.length === 0 && item.writeInDomainSet?.length === 0 && item.applicableExecutionCoverage === 1);
    const ragSearchPass = targetedResults.every(item => item.ragObservation?.ragSearchRequired === true && item.ragObservation?.ragSearchExecuted === true);
    const relevancePass = targetedResults.every(item => item.answerRelevance?.answerDumpedUnrequestedContext === false);
    const safety = sumSafety(all);
    const gatesPass = preGates.allPass === true && postGates.allPass === true;
    const failedGates = [
        domainExact >= 11 && highRiskDomainMiss === 0 || 'DOMAIN_CORPUS',
        ragPassed === 4 && ragResults.every(item => !item.ragAuthorityScore?.ragCurrentOverride && !item.ragAuthorityScore?.historyPresentedAsCurrent) || 'RAG_AUTHORITY',
        targetedPassed === 14 || 'TARGETED_SEMANTIC', coveragePass || 'DOMAIN_COVERAGE', ragSearchPass || 'RAG_SEARCH', relevancePass || 'ANSWER_RELEVANCE',
        d1Passed === 4 || 'D1_PROTECTION', allZero(safety) || 'SAFETY', gatesPass || 'REPOSITORY_GATES',
    ].filter(item => typeof item === 'string');
    return Object.freeze({ status: failedGates.length ? 'FAIL' : 'PASS', readyForD2B2FullRerun: failedGates.length === 0, failedGates,
        domain: { total: domainScores.length, exact: domainExact, highRiskMiss: highRiskDomainMiss }, rag: { total: ragResults.length, pass: ragPassed },
        targeted: { total: targetedResults.length, pass: targetedPassed }, d1: { total: d1.results.length, pass: d1Passed },
        coveragePass, ragSearchPass, relevancePass, safety, preModelGates: preGates.allPass === true, postModelGates: postGates.allPass === true });
}
function assembleR6(outputDirectory, plan) {
    const ids = [plan.domainCorpusRunId, ...(plan.ragAuthorityRunIds || []), ...(plan.targetedRunIds || []), plan.d1ProtectionRunId, plan.preModelGateRunId, plan.postModelGateRunId];
    need(ids.every(Boolean) && new Set(ids).size === ids.length, 'R6_ACCEPTANCE_REQUIRED_RUN_MISSING');
    need(plan.productFreezeCommit === PRODUCT_FREEZE_COMMIT && plan.harnessFreezeCommit, 'R6_ACCEPTANCE_FREEZE_MISMATCH');
    need((plan.ragAuthorityRunIds || []).length === 4 && (plan.targetedRunIds || []).length === 14, 'R6_ACCEPTANCE_REQUIRED_RUN_MISSING');
    const load = (kind, runId) => {
        try { return readStagedRun(outputDirectory, { kind, runId }); }
        catch (error) {
            if (error?.message === 'D2_B2_REQUIRED_RUN_MISSING') throw new Error('R6_ACCEPTANCE_REQUIRED_RUN_MISSING');
            throw error;
        }
    };
    const domain = load('domain-corpus', plan.domainCorpusRunId);
    const rag = plan.ragAuthorityRunIds.map(runId => load('rag', runId));
    const targeted = plan.targetedRunIds.map(runId => load('targeted', runId));
    const d1 = load('d1-protection', plan.d1ProtectionRunId);
    const preGates = load('r6-gates', plan.preModelGateRunId); const postGates = load('r6-gates', plan.postModelGateRunId);
    const artifacts = [domain, ...rag, ...targeted, d1, preGates, postGates];
    artifacts.forEach(artifact => assertFrozenArtifact(artifact, plan));
    need(domain.results?.length === 12 && d1.results?.length === 4, 'R6_ACCEPTANCE_REQUIRED_RUN_MISSING');
    const ragResults = flattenResults(rag); const targetedResults = flattenResults(targeted);
    need(ragResults.length === 4 && targetedResults.length === 14, 'R6_ACCEPTANCE_REQUIRED_RUN_MISSING');
    const composition = expectedTargetedComposition(targetedResults);
    need(composition['W1-06'] === 5 && composition.SHORTAGE_ONLY === 3 && composition.PENDING_PURCHASE === 3 && composition.ORDER_PRODUCTS === 3, 'R6_ACCEPTANCE_TARGETED_COMPOSITION_INVALID');
    const all = [...domain.results, ...ragResults, ...targetedResults, ...d1.results];
    need(all.every(run => run.safety && SAFETY_FIELDS.every(field => Object.hasOwn(run.safety, field))), 'R6_ACCEPTANCE_INCOMPLETE_SAFETY');
    need(preGates.phase === 'PRE_MODEL' && postGates.phase === 'POST_MODEL' && typeof preGates.allPass === 'boolean' && typeof postGates.allPass === 'boolean', 'R6_ACCEPTANCE_GATE_RECEIPT_INVALID');
    const final = scoreAcceptance({ domain, ragResults, targetedResults, d1, preGates, postGates, all });
    const output = sanitizeEvidence({ productFreezeCommit: plan.productFreezeCommit, harnessFreezeCommit: plan.harnessFreezeCommit, domain, rag, targeted, d1, preGates, postGates, targetedComposition: composition, performance: performance(all), final });
    need(scanForSecrets(JSON.stringify(output)).pass, 'R6_ACCEPTANCE_SECRET_SCAN_FAILED');
    return Object.freeze(output);
}
function publishR6(outputDirectory, plan) {
    const output = assembleR6(outputDirectory, plan);
    const target = key => path.join(outputDirectory, CANONICAL_ARTIFACTS[key]);
    atomicWrite(target('domain'), output.domain);
    atomicWrite(target('rag'), output.rag);
    atomicWrite(target('targeted'), output.targeted);
    atomicWrite(target('coverage'), { domain: output.domain, targeted: output.targeted });
    atomicWrite(target('relevance'), { targeted: output.targeted });
    atomicWrite(target('d1'), output.d1);
    atomicWrite(target('safety'), { runs: [...output.domain.results, ...flattenResults(output.rag), ...flattenResults(output.targeted), ...output.d1.results] });
    atomicWrite(target('performance'), output.performance);
    atomicWrite(target('acceptance'), `# D2-B2 R6 Acceptance\n\n- Product: ${output.productFreezeCommit}\n- Harness: ${output.harnessFreezeCommit}\n- Domain exact: ${output.final.domain.exact}/${output.final.domain.total}\n- RAG authority: ${output.final.rag.pass}/${output.final.rag.total}\n- Targeted: ${output.final.targeted.pass}/${output.final.targeted.total}\n- D1: ${output.final.d1.pass}/${output.final.d1.total}\n- Final status: ${output.final.status}\n`);
    return output;
}

module.exports = { CANONICAL_ARTIFACTS, PRODUCT_FREEZE_COMMIT, SAFETY_FIELDS, assembleR6, publishR6, scoreAcceptance };
