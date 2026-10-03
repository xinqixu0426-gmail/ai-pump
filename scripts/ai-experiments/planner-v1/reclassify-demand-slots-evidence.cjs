'use strict';

const fs = require('fs');
const { evaluateDemandSlotsPipeline } = require('./demandSlotsEvaluator.cjs');
const { metrics } = require('./run-demand-slots-smoke.cjs');

function reclassify(filePath) {
    const original = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const results = original.results.map(item => ({ ...item, evaluation: evaluateDemandSlotsPipeline(item.testCase, item) }));
    const updated = { ...original, metrics: metrics(results), results };
    if (original.summaries) updated.summaries = original.groups.map(group => { const subset = results.filter(item => item.id === group.id); return { id: group.id, pass: subset.filter(item => item.evaluation.overall === 'PASS').length, fail: subset.filter(item => item.evaluation.overall === 'FAIL').length }; });
    fs.writeFileSync(filePath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    return { scope: original.scope, metrics: updated.metrics };
}
if (require.main === module) console.log(JSON.stringify(process.argv.slice(2).map(reclassify), null, 2));
module.exports = { reclassify };
