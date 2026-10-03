'use strict';

const fs = require('fs');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { BASE, NEGATIVE } = require('./demandSlotsCases.cjs');
const { executeDemandSlots, metrics, environment, median } = require('./run-demand-slots-smoke.cjs');

const GROUPS = Object.freeze([{ id: 'P-08', repetitions: 5 }, { id: 'P-09', repetitions: 5 }, { id: 'P-11', repetitions: 5 }, { id: 'P-12', repetitions: 5 }, { id: 'P-13', repetitions: 5 }, { id: 'P-15', repetitions: 5 }, { id: 'P-17', repetitions: 5 }, { id: 'P-03', repetitions: 3 }, { id: 'P-07', repetitions: 3 }, { id: 'P-10', repetitions: 3 }, { id: 'N-06', repetitions: 3 }]);
async function main(outputPath) {
    const cases = new Map([...BASE, ...NEGATIVE].map(item => [item.id, item]));
    const env = environment(); const catalog = createPlannerCapabilityCatalogSnapshot(); const results = [];
    for (const group of GROUPS) for (let run = 1; run <= group.repetitions; run++) results.push(Object.freeze({ ...(await executeDemandSlots(cases.get(group.id), env, catalog)), run, testCase: cases.get(group.id) }));
    const summaries = GROUPS.map(group => { const subset = results.filter(item => item.id === group.id); return Object.freeze({ id: group.id, pass: subset.filter(item => item.evaluation.overall === 'PASS').length, fail: subset.filter(item => item.evaluation.overall === 'FAIL').length }); });
    const output = Object.freeze({ phase: 'M4-4J', scope: 'repeat', provider: 'DeepSeek', model: env.DEEPSEEK_MODEL, retryEnabled: false, groups: GROUPS, summaries, metrics: metrics(results), modelCalls: Object.freeze({ demandSlots: results.length, semanticCompiler: 0, planCompiler: 0 }), performance: Object.freeze({ demandSlotsMedianMs: median(results.map(item => item.timings.demandSlotsMs)), semanticCompilerMedianMs: median(results.map(item => item.timings.semanticCompilerMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)) }), results });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ summaries, metrics: output.metrics, performance: output.performance }, null, 2));
}
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { GROUPS, main };
