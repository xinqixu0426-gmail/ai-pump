'use strict';

const fs = require('fs');
const { createPlannerCapabilityCatalogSnapshot } = require('./capabilityCatalogSnapshot.cjs');
const { runFullContextPipeline } = require('./fullContextPipeline.cjs');
const { evaluateFullContextCase } = require('./fullContextEvaluator.cjs');
const { metrics } = require('./run-full-context-smoke.cjs');

async function replay(file) {
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    const baseCatalog = createPlannerCapabilityCatalogSnapshot();
    const results = [];
    for (const item of original.results) {
        const omitted = new Set(item.testCase.catalogOmit || []);
        const capabilityCatalog = { ...baseCatalog, visibleCapabilities: baseCatalog.visibleCapabilities.filter(capability => !omitted.has(capability.capabilityId)) };
        const recalculated = await runFullContextPipeline({ ...item.input, capabilityCatalog }, { runPlannerAgent: async () => item.plannerMemo });
        const evaluation = evaluateFullContextCase(item.testCase, recalculated);
        results.push({ ...item, memo: recalculated.memo, memoValidation: recalculated.memoValidation, identity: recalculated.identity, adapted: recalculated.adapted, validation: recalculated.validation, evaluation });
    }
    const evidence = { ...original, validationReplay: { performed: true, reason: 'Identity owner-wording guard added after fresh model calls; exact raw planner memos replayed through deterministic validation only', additionalModelCalls: 0 }, metrics: metrics(results), results };
    fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    return { file, metrics: evidence.metrics, failures: results.filter(item => item.evaluation.overall === 'FAIL').map(item => ({ id: item.id, failures: item.evaluation.failures })) };
}

async function main(files) { for (const file of files) console.log(JSON.stringify(await replay(file))); }
if (require.main === module) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { replay };
