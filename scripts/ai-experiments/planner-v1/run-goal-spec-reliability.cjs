'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { GOAL_SPEC_BASE_CASES, GOAL_SPEC_NEGATIVE_CASES } = require('./goalSpecCases.cjs');
const { executeGoalSpec, metrics } = require('./run-goal-spec-smoke.cjs');

const root = path.resolve(__dirname, '../../..');
const REPEAT_GROUPS = Object.freeze([{ id: 'P-03', repetitions: 5 }, { id: 'P-11', repetitions: 5 }, { id: 'P-13', repetitions: 5 }, { id: 'P-07', repetitions: 3 }, { id: 'P-10', repetitions: 3 }, { id: 'N-06', repetitions: 3 }]);
function median(values) { const sorted = [...values].sort((left, right) => left - right); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; }
function environment() { return { ...process.env, ...(fs.existsSync(path.join(root, '.env')) ? dotenv.parse(fs.readFileSync(path.join(root, '.env'))) : {}), DEEPSEEK_MODEL: 'deepseek-chat' }; }

async function runGoalSpecRepeat({ outputPath } = {}) {
    const env = environment();
    const snapshot = createPlannerCapabilityCatalogSnapshot();
    const byId = new Map([...GOAL_SPEC_BASE_CASES, ...GOAL_SPEC_NEGATIVE_CASES].map(testCase => [testCase.id, testCase]));
    const results = [];
    for (const group of REPEAT_GROUPS) for (let run = 1; run <= group.repetitions; run += 1) results.push(Object.freeze({ ...(await executeGoalSpec(byId.get(group.id), env, snapshot)), testCase: byId.get(group.id), run }));
    const summaries = Object.freeze(REPEAT_GROUPS.map(group => {
        const cases = results.filter(result => result.id === group.id);
        return Object.freeze({ id: group.id, pass: cases.filter(result => result.evaluation.overall === 'PASS').length, fail: cases.filter(result => result.evaluation.overall === 'FAIL').length, goalSpecPass: cases.filter(result => result.evaluation.goalSpec.overall === 'PASS').length, compilerPass: cases.filter(result => result.evaluation.compiler.overall === 'PASS').length });
    }));
    const output = Object.freeze({ phase: 'M4-4I', scope: 'repeat-reliability', provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, groups: REPEAT_GROUPS, metrics: metrics(results), modelCalls: Object.freeze({ goalSpec: results.length, oldRequirementBenchmark: 0, goalToFact: 0, planCompiler: 0, total: results.reduce((sum, item) => sum + item.modelCalls.goalSpec, 0) }), performance: Object.freeze({ goalSpecMedianMs: median(results.map(item => item.timings.goalSpecMs)), goalToFactMedianMs: median(results.map(item => item.timings.goalToFactMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)) }), summaries, results: Object.freeze(results) });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    return output;
}

module.exports = { REPEAT_GROUPS, runGoalSpecRepeat };
