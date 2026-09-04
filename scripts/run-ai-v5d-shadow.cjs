'use strict';

const p06Cases = require('../docs/ai-observability/data/p06-failure-cases.json');
const { auditCapabilityRequirementCoverage } = require('../api/services/ai-v5/evidenceRequirements.cjs');
const { evaluateP06VerificationCases } = require('../api/services/ai-v5/evidenceShadowEvaluation.cjs');

const evaluation = evaluateP06VerificationCases(p06Cases);
const coverage = auditCapabilityRequirementCoverage();

process.stdout.write(`${JSON.stringify({
    evidenceLedgerVersion: 1,
    capabilityCoverage: {
        capabilityCount: coverage.capabilityCount,
        defined: coverage.defined,
        deferred: coverage.deferred,
        notApplicable: coverage.notApplicable,
    },
    p06Metrics: evaluation.metrics,
    productionEvidenceImports: 0,
    productionVerificationImports: 0,
    productionRouting: 0,
    productionVerificationExecutions: 0,
    toolExecutions: 0,
    writes: 0,
}, null, 2)}\n`);
