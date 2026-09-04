'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { evaluateIndependentShadow } = require('../api/services/ai-v5/independentShadow.cjs');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts', 'run-ai-shadow-evaluation.cjs');
const preload = path.join(root, 'scripts', 'observability-p15-interpreter-preload.cjs');
const datasetPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4-independent-shadow-evaluation.json');
const frozenPath = path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json');
const caseKeys = [
    'simple-current-1', 'current-cost-1', 'flat-knife-800-1',
    'part-current-stock-real-provider', 'coil-current-stock-real-provider',
];
const families = Object.freeze({
    'simple-current-1': 'P06-SIMPLE-001',
    'current-cost-1': 'P06-EXACT-001',
    'flat-knife-800-1': 'P06-FLATBLADE-001',
    'part-current-stock-real-provider': 'P06-INVENTORY-001',
    'coil-current-stock-real-provider': 'P06-COIL-001',
});

function run(command, args, env, allowedStatuses = [0]) {
    const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (!allowedStatuses.includes(result.status)) {
        throw new Error(`P15 child failed: ${path.basename(args[0] || command)} (${result.status})`);
    }
}

function percent(numerator, denominator) {
    return denominator === 0 ? 0 : numerator / denominator;
}

function safeCaseId(caseKey, pathName) {
    return `${families[caseKey]}-${pathName}`;
}

function aggregateUsage(paths) {
    const usages = paths.map(item => item.interpreterUsage).filter(Boolean);
    if (usages.length === 0) return null;
    const sum = key => usages.reduce((total, item) => total + (Number(item[key]) || 0), 0);
    return {
        promptTokens: sum('promptTokens'),
        completionTokens: sum('completionTokens'),
        totalTokens: sum('totalTokens'),
    };
}

function readFreshCasesFromReports(reportsDirectory) {
    const pathNames = Object.freeze({
        legacy_v3: 'LEGACY', v4_investigation: 'V4I', v4_r3: 'V4R3',
    });
    return fs.readdirSync(reportsDirectory).filter(name => name.endsWith('.json')).flatMap(name => {
        const report = JSON.parse(fs.readFileSync(path.join(reportsDirectory, name), 'utf8'));
        return (report.cases || []).flatMap(testCase => Object.entries(testCase.paths || {}).map(([pathKey, value]) => ({
            case_id: safeCaseId(testCase.caseKey, pathNames[pathKey]),
            result: value.classification,
            safe_structural_metadata: { tools: value.capabilityIds || [] },
        })));
    });
}

function buildDataset(freshCases, frozenCases, records) {
    const fresh = new Map(freshCases.map(item => [item.case_id, item]));
    const frozen = new Map(frozenCases.map(item => [item.case_id, item]));
    const paths = records.map(record => {
        const [caseKey, pathName] = record.caseId.split(':');
        const caseId = safeCaseId(caseKey, pathName);
        const current = fresh.get(caseId) || {};
        const authority = frozen.get(caseId) || current;
        const comparison = evaluateIndependentShadow(record.independent, authority.expected || {}, {
            v4Result: current.result || 'UNKNOWN',
            rootCauseClass: authority.failure_class || null,
            toolNames: current.safe_structural_metadata?.tools || [],
        });
        const privateEvidence = {
            case_id: caseId,
            suite: authority.suite || current.suite || 'UNKNOWN',
            interpreterStatus: comparison.interpreterStatus,
            domainMatch: comparison.domainMatch,
            operationMatch: comparison.operationMatch,
            entityTypeMatch: comparison.entityTypeMatch,
            entityAnchorStatus: comparison.entityAnchorStatus,
            capabilityOutcome: comparison.capabilityOutcome,
            capabilityMatch: comparison.capabilityMatch,
            expectedToolExposed: comparison.expectedToolExposed,
            wrongToolExcluded: comparison.wrongToolExcluded,
            overallComparison: comparison.overallComparison,
            safeReasonCodes: comparison.reasonCodes,
            traceId: record.sourceTraceId,
            shadowTaskId: record.shadowTaskId,
            interpreterUsage: record.independent?.usage || null,
            interpreterCompletionLatencyMs: record.independent?.completionLatencyMs ?? null,
            v4Result: current.result || 'UNKNOWN',
        };
        return privateEvidence;
    }).sort((left, right) => left.case_id.localeCompare(right.case_id));
    const denominator = paths.length;
    const count = predicate => paths.filter(predicate).length;
    const metrics = {
        interpreterCalls: records.reduce((total, item) => total + (Number(item.independent?.modelCalls) || 0), 0),
        validOutputs: count(item => item.interpreterStatus === 'VALID'),
        invalidOutputs: count(item => item.interpreterStatus === 'INVALID'),
        timeouts: count(item => item.interpreterStatus === 'TIMEOUT'),
        errors: count(item => item.interpreterStatus === 'ERROR'),
        domainAccuracy: percent(count(item => item.domainMatch), denominator),
        operationAccuracy: percent(count(item => item.operationMatch), denominator),
        entityTypeAccuracy: percent(count(item => item.entityTypeMatch), denominator),
        entityAnchorAccuracy: percent(count(item => item.entityAnchorStatus === 'ANCHORED'), denominator),
        capabilityRoutingAccuracy: percent(count(item => item.capabilityMatch), denominator),
        expectedToolExposureAccuracy: percent(count(item => item.expectedToolExposed), denominator),
        wrongToolExclusionAccuracy: percent(count(item => item.wrongToolExcluded), denominator),
        falseBlocks: count(item => item.overallComparison === 'V5_FALSE_BLOCK'),
        blockedFailures: count(item => item.overallComparison === 'V5_BLOCKS_V4_FAILURE'),
        insufficient: count(item => item.overallComparison === 'V5_INSUFFICIENT_DATA'),
        agree: count(item => item.overallComparison === 'AGREE'),
        successControls: count(item => item.v4Result === 'PASS'),
        failureControls: count(item => item.v4Result === 'FAIL'),
        tokenUsage: aggregateUsage(paths),
        v5ToolCalls: 0,
        v5BusinessApiCalls: 0,
        v5Writes: 0,
    };
    const publicPaths = paths.map(item => ({
        case_id: item.case_id,
        suite: item.suite,
        interpreterStatus: item.interpreterStatus,
        domainMatch: item.domainMatch,
        operationMatch: item.operationMatch,
        entityTypeMatch: item.entityTypeMatch,
        entityAnchorStatus: item.entityAnchorStatus,
        capabilityOutcome: item.capabilityOutcome,
        capabilityMatch: item.capabilityMatch,
        expectedToolExposed: item.expectedToolExposed,
        wrongToolExcluded: item.wrongToolExcluded,
        overallComparison: item.overallComparison,
        safeReasonCodes: item.safeReasonCodes,
        traceId: item.traceId,
        shadowTaskId: item.shadowTaskId,
    }));
    const completionLatencies = paths.map(item => Number(item.interpreterCompletionLatencyMs)).filter(Number.isFinite).sort((a, b) => a - b);
    const percentile = value => completionLatencies.length === 0 ? null
        : completionLatencies[Math.min(completionLatencies.length - 1, Math.ceil(value * completionLatencies.length) - 1)];
    metrics.shadowCompletionMedianMs = percentile(0.5);
    metrics.shadowCompletionP95Ms = percentile(0.95);
    return { schema_version: 1, project: 'pump-ai-v5e4-independent-shadow', paths: publicPaths, metrics };
}

function main() {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('Configured real provider is unavailable');
    const work = process.env.PUMP_P15_WORK_DIR
        ? path.resolve(process.env.PUMP_P15_WORK_DIR)
        : fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p15-real-'));
    const analyzeOnly = process.argv.includes('--analyze-only');
    const reports = path.join(work, 'reports');
    const interpretations = path.join(work, 'interpretations');
    fs.mkdirSync(reports, { recursive: true });
    fs.mkdirSync(interpretations, { recursive: true });
    const existingNodeOptions = String(process.env.NODE_OPTIONS || '').trim();
    const nodeOptions = [existingNodeOptions, `--require=${preload}`].filter(Boolean).join(' ');
    const commonEnv = {
        ...process.env,
        AI_OBSERVABILITY_ENABLED: 'true',
        AI_TRACE_CONTENT: 'metadata',
        AI_OBSERVABILITY_PROJECT: 'pump-ai-v5e4-independent-shadow',
        AI_V5_SHADOW_ENABLED: 'true',
        AI_V5_SHADOW_SAMPLE_RATE: '1',
        AI_V5_INTERPRETER_TIMEOUT_MS: '20000',
        PHOENIX_COLLECTOR_ENDPOINT: process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://127.0.0.1:6006',
        NODE_OPTIONS: nodeOptions,
    };
    if (!analyzeOnly) {
        for (const caseKey of caseKeys) {
            const reportPath = path.join(reports, `${caseKey}.json`);
            const interpreterPath = path.join(interpretations, `${caseKey}.json`);
            run(process.execPath, [runner, `--case-key=${caseKey}`], {
                ...commonEnv,
                PUMP_P15_REPLAY_REPORT_PATH: reportPath,
                PUMP_P15_INTERPRETER_REPORT_PATH: interpreterPath,
            }, [0, 1]);
            if (!fs.existsSync(reportPath) || !fs.existsSync(interpreterPath)) {
                throw new Error(`P15 evidence missing: ${caseKey}`);
            }
        }
    }
    const freshCases = readFreshCasesFromReports(reports);
    const frozenCases = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
    const records = caseKeys.flatMap(key => JSON.parse(fs.readFileSync(
        path.join(interpretations, `${key}.json`), 'utf8'
    )));
    const dataset = buildDataset(freshCases, frozenCases, records);
    fs.mkdirSync(path.dirname(datasetPath), { recursive: true });
    fs.writeFileSync(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
        status: 'completed', workDirectory: work, dataset: datasetPath, metrics: dataset.metrics,
    })}\n`);
}

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error.name, message: error.message })}\n`);
        process.exitCode = 1;
    }
}

module.exports = { buildDataset, caseKeys };
