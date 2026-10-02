'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { BASE_CASES, NEGATIVE_CASES } = require('./cases.cjs');
const { execute, retryMetrics } = require('./run-smoke.cjs');

const root = path.resolve(__dirname, '../../..');
const P12_ID = 'P-12';
const REGRESSION_IDS = Object.freeze(['P-10', 'P-11', 'P-13', 'N-06']);

function median(values) { const sorted = [...values].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
function environment() { return { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}), DEEPSEEK_MODEL: 'deepseek-chat' }; }
function allCases() { return new Map([...BASE_CASES, ...NEGATIVE_CASES].map(testCase => [testCase.id, testCase])); }

async function runRepeated({ ids, repetitions, scope, outputPath }) {
    const env = environment();
    const snapshot = createPlannerCapabilityCatalogSnapshot();
    const byId = allCases();
    const results = [];
    for (const id of ids) for (let run = 1; run <= repetitions; run += 1) {
        const testCase = byId.get(id);
        const result = await execute(testCase, env, snapshot);
        results.push(Object.freeze({ ...result, testCase, run }));
    }
    const summaries = Object.freeze(ids.map(id => {
        const cases = results.filter(result => result.id === id);
        return Object.freeze({
            id,
            pass: cases.filter(result => result.evaluation.overall === 'PASS').length,
            fail: cases.filter(result => result.evaluation.overall === 'FAIL').length,
            firstAttemptPass: cases.filter(result => result.requirementAttempts.length === 1 || result.requirementAttempts[0].validation.validationStatus === 'VALID').length,
            comparisonBasisTriggers: cases.filter(result => result.requirementRetry.reasons.includes('COMPARISON_BASIS_MISSING')).length,
            retriesTriggered: cases.filter(result => result.requirementRetry.triggered).length,
            retriesRecovered: cases.filter(result => result.requirementRetry.triggered && result.evaluation.requirement.overall === 'PASS').length,
            retriesFailed: cases.filter(result => result.requirementRetry.triggered && result.evaluation.requirement.overall === 'FAIL').length,
        });
    }));
    const output = Object.freeze({
        phase: 'M4-4F', scope, provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, repetitions,
        modelCalls: Object.freeze({ requirementFirst: results.length, requirementRetry: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner - 1, 0), requirement: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner, 0), planCompiler: 0, upstream: 0, total: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner, 0) }),
        requirementMetrics: Object.freeze(retryMetrics(results)),
        performance: Object.freeze({ requirementFirstMedianMs: median(results.map(item => item.timings.requirementFirstMs)), requirementRetryMedianMs: median(results.filter(item => item.timings.requirementRetryMs).map(item => item.timings.requirementRetryMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)) }),
        summaries,
        results: Object.freeze(results),
    });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}

async function runM4fReliability({ p12OutputPath, regressionOutputPath } = {}) {
    const p12 = await runRepeated({ ids: [P12_ID], repetitions: 10, scope: 'p12-reliability', outputPath: p12OutputPath });
    const regression = await runRepeated({ ids: REGRESSION_IDS, repetitions: 3, scope: 'regression-reliability', outputPath: regressionOutputPath });
    return Object.freeze({ p12, regression });
}

module.exports = { P12_ID, REGRESSION_IDS, runRepeated, runM4fReliability };
