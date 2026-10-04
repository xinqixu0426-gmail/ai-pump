'use strict';

// Serialization-only helpers for the frozen Final Acceptance harness.  They
// never invoke a provider, executor, or database.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FINAL_V2_ARTIFACTS = Object.freeze({
    sourceManifest: 'M5-D1-FINAL-V2-Source-Manifest.json',
    controlledSmoke: 'M5-D1-FINAL-V2-Controlled-Smoke.json',
    controlledRepetition: 'M5-D1-FINAL-V2-Controlled-Repetition.json',
    realCatalog: 'M5-D1-FINAL-V2-Real-Catalog.json',
    agentTraces: 'M5-D1-FINAL-V2-Agent-Traces.json',
    safety: 'M5-D1-FINAL-V2-Safety.json',
    performance: 'M5-D1-FINAL-V2-Performance.json',
    acceptance: 'M5-D1-FINAL-V2-Acceptance.md',
});
const SECRET_KEY = /^(?:authorization|proxy-authorization|cookie|set-cookie|x-internal-write-secret|apikey|api_key|confirmationtoken|confirmation_token)$/iu;
const SECRET_TEXT = /(?:bearer\s+[a-z0-9._-]+|x-internal-write-secret\s*[:=]|confirmationtoken\s*[:=]|api[_-]?key\s*[:=])/iu;

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function hash(value) { return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
function sanitizeEvidence(value) {
    if (Array.isArray(value)) return value.map(sanitizeEvidence);
    if (!value || typeof value !== 'object') return typeof value === 'string' && SECRET_TEXT.test(value) ? '[REDACTED]' : value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, item]) => [key, sanitizeEvidence(item)]));
}
function scanForSecrets(value) {
    const serialized = JSON.stringify(value);
    return Object.freeze({ pass: !SECRET_TEXT.test(serialized), matches: SECRET_TEXT.test(serialized) ? ['SECRET_PATTERN_DETECTED'] : [] });
}
function memoHash(value) { return value ? hash(String(value)) : null; }

function serializeRun(item, options = {}) {
    const candidate = item?.candidate || {};
    const serialized = sanitizeEvidence({
        runId: options.runId || item?.runId || `${item?.id || 'unknown'}-${options.runNumber || item?.runNumber || 1}`,
        caseId: item?.id || item?.caseId || null,
        runNumber: options.runNumber || item?.runNumber || 1,
        rawOwnerInput: item?.rawOwnerInput || null,
        businessMemoHash: item?.businessMemoHash || memoHash(item?.businessMemo),
        policyMemoHash: item?.policyMemoHash || memoHash(item?.policyMemo),
        outcome: item?.outcome || null,
        classification: item?.classification || item?.outcome?.classification || null,
        safety: item?.safety || null,
        declaredStatus: item?.declaredStatus || item?.outcome?.declaredStatus || null,
        memoTimings: item?.memoTimings || null,
        formalCalls: item?.formalCalls || [],
        relevantApiCoverage: candidate.relevantApiCoverage || item?.relevantCoverage || item?.relevantApiCoverage || null,
        metrics: candidate.metrics || item?.metrics || null,
        traces: candidate.traces || item?.traces || [],
        formalOutcomeReceipts: candidate.formalOutcomeReceipts || item?.formalOutcomeReceipts || [],
        finalizationAttempts: candidate.finalizationAttempts || item?.finalizationAttempts || [],
        answerValidation: candidate.answerValidation || item?.answerValidation || null,
        context: candidate.context || item?.context || null,
        durationMs: candidate.durationMs ?? item?.durationMs ?? null,
    });
    const scan = scanForSecrets(serialized);
    if (!scan.pass) throw new Error('FINAL_ACCEPTANCE_EVIDENCE_SECRET_SCAN_FAILED');
    return Object.freeze(serialized);
}
function numeric(values, selector) { return values.map(selector).filter(Number.isFinite).sort((a, b) => a - b); }
function percentile(sorted, fraction) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : null; }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function derivePerformance(results = []) {
    const metrics = results.map(item => item.metrics || {});
    const main = numeric(metrics, item => item.mainModelCalls);
    const business = numeric(metrics, item => item.businessToolCalls);
    const loaded = numeric(metrics, item => Array.isArray(item.loadedToolNames) ? item.loadedToolNames.length : item.loadedToolCount);
    const duration = numeric(results, item => item.durationMs);
    return Object.freeze({
        averageMainModelCalls: average(main), medianMainModelCalls: percentile(main, 0.5),
        averageBusinessToolCalls: average(business), maxBusinessToolCalls: business.length ? Math.max(...business) : null,
        averageLoadedTools: average(loaded), maxLoadedTools: loaded.length ? Math.max(...loaded) : null,
        medianDurationMs: percentile(duration, 0.5), p95DurationMs: percentile(duration, 0.95),
    });
}
function deriveFinalizationStats(results = []) {
    let firstPassValid = 0; let validAfterRepair = 0; let fallbackCount = 0; let deliveryFailures = 0;
    for (const item of results) {
        const attempts = item.finalizationAttempts || [];
        if (attempts[0]?.valid === true) firstPassValid += 1;
        if (attempts.length > 1 && attempts.some(attempt => attempt.valid === true)) validAfterRepair += 1;
        if (attempts.length && !attempts.some(attempt => attempt.valid === true)) fallbackCount += 1;
        if (item.classification === 'ANSWER_DELIVERY_FAILURE') deliveryFailures += 1;
    }
    return Object.freeze({ firstPassValid, validAfterRepair, fallbackCount, formalResultObtainedButDeliveryFailed: deliveryFailures });
}
function writeFinalV2Artifacts(outputDirectory, artifacts = {}) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    for (const [key, filename] of Object.entries(FINAL_V2_ARTIFACTS)) {
        if (!Object.hasOwn(artifacts, key)) continue;
        const content = key === 'acceptance' ? String(artifacts[key]) : `${JSON.stringify(sanitizeEvidence(artifacts[key]), null, 2)}\n`;
        const scan = scanForSecrets(content);
        if (!scan.pass) throw new Error('FINAL_ACCEPTANCE_EVIDENCE_SECRET_SCAN_FAILED');
        fs.writeFileSync(path.join(outputDirectory, filename), content, 'utf8');
    }
}

module.exports = { FINAL_V2_ARTIFACTS, deriveFinalizationStats, derivePerformance, hash, sanitizeEvidence, scanForSecrets, serializeRun, writeFinalV2Artifacts };
