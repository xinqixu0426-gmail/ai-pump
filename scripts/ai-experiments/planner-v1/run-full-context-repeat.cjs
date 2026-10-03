'use strict';

const fs = require('fs');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { buildFrozenFixtureCatalog } = require('./fullContextCatalog.cjs');
const { ALL, executeFullContext, metrics, median, environment } = require('./run-full-context-smoke.cjs');
const IDS = Object.freeze(['P-07', 'P-08', 'P-11', 'P-12', 'P-13', 'P-15', 'P-17']);
async function main(outputPath) {
    const cases = new Map(ALL.map(item => [item.id, item])); const env = environment();
    const catalog = buildFrozenFixtureCatalog(); const capabilities = createPlannerCapabilityCatalogSnapshot(); const results = [];
    for (const id of IDS) for (let run = 1; run <= 5; run++) results.push(Object.freeze({ ...(await executeFullContext(cases.get(id), env, catalog, capabilities)), run }));
    const summaries = IDS.map(id => { const subset = results.filter(item => item.id === id); return { id, pass: subset.filter(item => item.evaluation.overall === 'PASS').length, fail: subset.filter(item => item.evaluation.overall === 'FAIL').length }; });
    const output = Object.freeze({ phase: 'M4-4K', scope: 'repeat', catalogSourceMode: catalog.sourceMode, retryEnabled: false, summaries, metrics: metrics(results), modelCalls: { planner: results.length, grounding: 0, compiler: 0 }, performance: { plannerMedianMs: median(results.map(item => item.timings.plannerMs)), planCompilerMedianMs: median(results.map(item => item.timings.planCompilerMs)) }, results });
    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ summaries, metrics: output.metrics, performance: output.performance }, null, 2));
}
if (require.main === module) main(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { IDS, main };
