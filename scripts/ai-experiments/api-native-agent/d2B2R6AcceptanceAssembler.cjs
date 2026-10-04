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
function assembleR6(outputDirectory, plan) {
    const ids = [plan.domainCorpusRunId, ...(plan.ragAuthorityRunIds || []), ...(plan.targetedRunIds || []), plan.d1ProtectionRunId];
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
    const artifacts = [domain, ...rag, ...targeted, d1];
    artifacts.forEach(artifact => assertFrozenArtifact(artifact, plan));
    need(domain.results?.length === 12 && d1.results?.length === 4, 'R6_ACCEPTANCE_REQUIRED_RUN_MISSING');
    const ragResults = flattenResults(rag); const targetedResults = flattenResults(targeted);
    need(ragResults.length === 4 && targetedResults.length === 14, 'R6_ACCEPTANCE_REQUIRED_RUN_MISSING');
    const composition = expectedTargetedComposition(targetedResults);
    need(composition['W1-06'] === 5 && composition.SHORTAGE_ONLY === 3 && composition.PENDING_PURCHASE === 3 && composition.ORDER_PRODUCTS === 3, 'R6_ACCEPTANCE_TARGETED_COMPOSITION_INVALID');
    const all = [...domain.results, ...ragResults, ...targetedResults, ...d1.results];
    need(all.every(run => run.safety && Object.hasOwn(run.safety, 'write')), 'R6_ACCEPTANCE_INCOMPLETE_SAFETY');
    const output = sanitizeEvidence({ productFreezeCommit: plan.productFreezeCommit, harnessFreezeCommit: plan.harnessFreezeCommit, domain, rag, targeted, d1, targetedComposition: composition, performance: performance(all) });
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
    atomicWrite(target('acceptance'), `# D2-B2 R6 Acceptance\n\nAssembled from explicit frozen run IDs.\n`);
    return output;
}

module.exports = { CANONICAL_ARTIFACTS, PRODUCT_FREEZE_COMMIT, assembleR6, publishR6 };
