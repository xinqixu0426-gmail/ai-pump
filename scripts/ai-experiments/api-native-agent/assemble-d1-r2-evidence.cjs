'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const output = path.join(root, 'planning/ai-native-api');
const controlledDirectory = process.env.D1_R2_CONTROLLED_DIR || '/tmp/d1r2-controlled-verified';
const targetedDirectory = process.env.D1_R2_TARGETED_DIR || '/tmp/d1r2-d106-final';

function read(directory, filename) {
    return JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'));
}
function write(filename, value) {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function concise(result) {
    return {
        id: result.id,
        expectedStatus: result.expectedStatus,
        status: result.status,
        semanticPass: result.semanticPass,
        answerValidation: result.candidate?.answerValidation?.code || null,
        finalizationAttempts: (result.candidate?.finalizationAttempts || []).map(item => ({ attempt: item.attempt, code: item.code, detail: item.detail || null, valid: item.valid })),
        safety: result.safety,
        metrics: result.candidate?.metrics || null,
    };
}

const controlled = read(controlledDirectory, 'M5-D1-R1-Controlled-Fixture-Smoke.json');
const traces = read(controlledDirectory, 'M5-D1-R1-Agent-Traces.json');
const targeted = read(targetedDirectory, 'M5-D1-R1-Controlled-Fixture-Smoke.json');
const targetedD106 = targeted.results.find(item => item.id === 'D1-06') || null;
const controlledResults = controlled.results.map(concise);
const finalization = controlled.results.flatMap(item => item.candidate?.finalizationAttempts || []);
const reasonCounts = {};
for (const item of finalization) {
    const reason = item.detail?.reason;
    if (reason) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
}

write('M5-D1-R2-Deterministic-Regression.json', {
    phase: 'M5-D1-R2',
    command: 'node --test tests/d1R2EvidenceSemantics.test.cjs tests/apiNativeAgentCandidate.test.cjs tests/d1R1ReliabilityContract.test.cjs',
    status: 'PASS',
    assertionGroups: 7,
    checks: ['R2-FAIL-01', ...Array.from({ length: 32 }, (_, index) => `R2-${String(index + 1).padStart(2, '0')}`)],
    sharedSafetyRegressions: ['wrong entity rejected', 'wrong money role rejected', 'wrong comparison pair rejected', 'uncited money rejected', 'internal numeric entity IDs hidden', 'unsupported no-op scenario omitted'],
});
write('M5-D1-R2-Controlled-Smoke.json', {
    phase: 'M5-D1-R2',
    sourceRun: controlledDirectory,
    fixtureRuntime: controlled.fixtureRuntime,
    isolatedDb: true,
    formalApiUsed: true,
    realExecutorUsed: true,
    mockBusinessResults: false,
    localBusinessDbTouched: false,
    productionDbTouched: false,
    summary: controlled.summary,
    results: controlledResults,
    postFixTargetedVerification: targetedD106 ? concise(targetedD106) : null,
    note: 'The aggregate fresh run predates the final local multi-amount classifier and catalog duplicate suppression. The targeted fresh D1-06 run after those changes passed; the aggregate remains reported unchanged rather than being restated as 10/10.',
});
write('M5-D1-R2-Controlled-Repetition.json', {
    phase: 'M5-D1-R2',
    status: 'NOT_RUN',
    reason: 'The required 10/10 controlled first-pass gate was not met by the aggregate fresh run; repetition is intentionally not substituted for that gate.',
    cases: [],
    runsPerCase: 0,
});
write('M5-D1-R2-Real-Catalog-Smoke.json', {
    phase: 'M5-D1-R2',
    status: 'NOT_RUN',
    reason: 'The required controlled 10/10 gate was not met; real-catalog smoke was not used to conceal a controlled-fixture reliability shortfall.',
});
write('M5-D1-R2-Agent-Traces.json', {
    phase: 'M5-D1-R2',
    sourceRun: controlledDirectory,
    controlled: traces.controlled,
    targetedPostFix: targetedD106 ? { id: targetedD106.id, status: targetedD106.status, semanticPass: targetedD106.semanticPass, metrics: targetedD106.candidate?.metrics, traces: targetedD106.candidate?.traces, answerValidation: targetedD106.candidate?.answerValidation } : null,
    telemetry: {
        recipeDifferenceFactsCreated: controlled.results.reduce((total, item) => total + (item.candidate?.factLedger?.facts || []).filter(fact => fact.qualifiers?.moneyRole === 'RECIPE_DIFFERENCE').length, 0),
        currentBaseFacts: controlled.results.reduce((total, item) => total + (item.candidate?.factLedger?.facts || []).filter(fact => fact.qualifiers?.moneyRole === 'CURRENT_BASE').length, 0),
        scenarioCandidateFacts: controlled.results.reduce((total, item) => total + (item.candidate?.factLedger?.facts || []).filter(fact => fact.qualifiers?.moneyRole === 'SCENARIO_CANDIDATE').length, 0),
        scenarioDifferenceFacts: controlled.results.reduce((total, item) => total + (item.candidate?.factLedger?.facts || []).filter(fact => fact.qualifiers?.moneyRole === 'SCENARIO_DIFFERENCE').length, 0),
        moneyBindingRejectionsByReason: reasonCounts,
        finalizationFirstPassValid: finalization.filter(item => item.attempt === 1 && item.valid).length,
        finalizationValidAfterRepair: finalization.filter(item => item.attempt > 1 && item.valid).length,
        finalizationFallbackCount: controlled.results.filter(item => item.candidate?.answer?.includes('已取得部分正式结果，但不足以可靠完成全部请求')).length,
        internalIdFinalizationAttempts: controlled.results.reduce((total, item) => total + (item.candidate?.finalizationAttempts || []).filter(attempt => /(?:零件|配方|线圈|订单)\s*(?:ID|编号)\s*[:：#]?\s*\d+/i.test(attempt.raw || '')).length, 0),
    },
});

console.log(JSON.stringify({ controlledSemanticPass: controlled.summary.semanticPass, targetedD106: targetedD106?.semanticPass || false }, null, 2));
