'use strict';

const fs = require('fs');
const { messagesForMinimalPlanner } = require('./minimalPlannerAgent.cjs');
const { summarize, median } = require('./run-minimal-full-context.cjs');
for (const file of process.argv.slice(2)) {
    const original = JSON.parse(fs.readFileSync(file, 'utf8'));
    const results = original.results.map(item => ({ ...item, contextChars: { ...item.contextChars, total: messagesForMinimalPlanner(item.input)[0].content.length } }));
    const metrics = original.scope?.startsWith('frozen-') ? summarize(results) : original.metrics;
    const performance = { ...original.performance, contextMedianChars: median(results.map(item => item.contextChars.total)) };
    const evidence = { ...original, contextAccountingReconciled: { performed: true, reason: 'Original total counted hidden compiler capability data; recomputed exact Planner system-message characters from preserved input, without model calls', additionalModelCalls: 0 }, metrics, performance, results };
    fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ file, contextMedianChars: performance.contextMedianChars, metrics }));
}
