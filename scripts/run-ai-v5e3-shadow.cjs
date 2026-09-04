'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
    evaluateP06ProductionShadowControls,
} = require('../api/services/ai-v5/shadowComparison.cjs');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json');
const datasetPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e3-shadow-evaluation.json');

function availabilityRates(paths) {
    const count = paths.length || 1;
    const rate = key => paths.filter(item => item.availability?.[key] === true).length / count;
    return {
        entityFactsAvailable: rate('entityFactsAvailable'),
        capabilityFactsAvailable: rate('capabilityFactsAvailable'),
        argumentFactsAvailable: rate('argumentFactsAvailable'),
        stateFactsAvailable: rate('stateFactsAvailable'),
        verificationFactsAvailable: rate('verificationFactsAvailable'),
    };
}

function buildDataset(cases, options = {}) {
    const evaluation = evaluateP06ProductionShadowControls(cases, {
        createdAt: '1970-01-01T00:00:00.000Z',
        frozenCases: options.frozenCases || [],
    });
    return {
        schema_version: 1,
        project: 'pump-ai-v5e3-shadow',
        generated_from: 'P06_SAFE_STRUCTURAL_REAL_REPLAY_CORPUS',
        cases: evaluation.paths.map(item => ({
            case_id: item.caseId,
            source_suite: item.sourceSuite,
            v4_result: item.v4Result,
            layer_comparisons: item.layerComparisons,
            overall_comparison: item.overallComparison,
            root_cause_class: item.rootCauseClass,
            actual_root_cause_class: item.actualFailureClass,
            safe_reason_codes: item.reasonCodes,
            trace_id: item.traceId,
            shadowTaskId: item.shadowTaskId,
        })),
        metrics: {
            ...evaluation.metrics,
            projectionAvailability: availabilityRates(evaluation.paths),
            v5ModelCalls: 0,
            v5ToolCalls: 0,
            v5BusinessApiCalls: 0,
            v5Writes: 0,
        },
    };
}

function main() {
    const cases = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    const dataset = buildDataset(cases, { frozenCases: cases });
    if (process.argv.includes('--write-dataset')) {
        fs.mkdirSync(path.dirname(datasetPath), { recursive: true });
        fs.writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    }
    process.stdout.write(`${JSON.stringify(dataset.metrics)}\n`);
}

if (require.main === module) main();

module.exports = { availabilityRates, buildDataset };
