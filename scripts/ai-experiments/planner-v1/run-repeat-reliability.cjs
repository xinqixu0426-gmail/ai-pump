'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { BASE_CASES } = require('./cases.cjs');
const { execute } = require('./run-smoke.cjs');

const root = path.resolve(__dirname, '../../..');
const REPEAT_IDS = Object.freeze(['P-10', 'P-11', 'P-12', 'P-13']);
function median(values) { const sorted = [...values].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }

async function runRepeatReliability({ outputPath, repetitions = 5 } = {}) {
    const env = { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}), DEEPSEEK_MODEL: 'deepseek-chat' };
    const snapshot = createPlannerCapabilityCatalogSnapshot();
    const byId = new Map(BASE_CASES.map(testCase => [testCase.id, testCase]));
    const results = [];
    for (const id of REPEAT_IDS) for (let run = 1; run <= repetitions; run += 1) {
        const testCase = byId.get(id);
        const result = await execute(testCase, env, snapshot);
        results.push(Object.freeze({ ...result, testCase, run }));
    }
    const summaries = Object.freeze(REPEAT_IDS.map(id => {
        const cases = results.filter(result => result.id === id);
        return Object.freeze({ id, pass: cases.filter(result => result.evaluation.overall === 'PASS').length, fail: cases.filter(result => result.evaluation.overall === 'FAIL').length, retries: cases.filter(result => result.requirementRetry.triggered).length, recovered: cases.filter(result => result.requirementRetry.triggered && result.evaluation.requirement.overall === 'PASS').length });
    }));
    const output = Object.freeze({ phase: 'M4-4E', scope: 'repeat-reliability', provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, repetitions, modelCalls: Object.freeze({ requirementFirst: results.length, requirementRetry: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner - 1, 0), requirement: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner, 0), planCompiler: 0, upstream: 0, total: results.reduce((sum, item) => sum + item.modelCalls.requirementPlanner, 0) }), performance: Object.freeze({ requirementFirstMedianMs: median(results.map(item => item.timings.requirementFirstMs)), requirementRetryMedianMs: median(results.filter(item => item.timings.requirementRetryMs).map(item => item.timings.requirementRetryMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)) }), summaries, results: Object.freeze(results) });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}

module.exports = { REPEAT_IDS, runRepeatReliability };
