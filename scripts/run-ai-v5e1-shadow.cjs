'use strict';

const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');
const { analyzeP06ControlledRuntime } = require('../api/services/ai-v5/shadowRuntimeEvaluation.cjs');

const evaluation = analyzeP06ControlledRuntime(p06Cases);
process.stdout.write(`${JSON.stringify({
    policyVersion: 1,
    p06Metrics: evaluation.metrics,
    productionPolicyImports: 0,
    productionControlledRuntimeImports: 0,
    productionRequestsRoutedToV5: 0,
    productionRequestsMirroredToV5: 0,
    realToolExecutions: 0,
    writes: 0,
}, null, 2)}\n`);
