'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildToolCapabilityReverseIndex, getV5Capability } = require('../api/services/ai-v5/capabilityRegistry.cjs');
const { evaluateIndependentShadow } = require('../api/services/ai-v5/independentShadow.cjs');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts', 'run-ai-shadow-evaluation.cjs');
const preload = path.join(root, 'scripts', 'observability-p15-interpreter-preload.cjs');
const frozenPath = path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json');
const defaultOutputPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-v1_1-evaluation.json');
const CASES = Object.freeze({
    'coil-current-stock-real-provider': Object.freeze({ family: 'P06-COIL-001', sourceGroupId: 'COIL_INVENTORY' }),
    'current-cost-1': Object.freeze({ family: 'P06-EXACT-001', sourceGroupId: 'EXACT_RECIPE_COST' }),
    'flat-knife-800-1': Object.freeze({ family: 'P06-FLATBLADE-001', sourceGroupId: 'FLAT_BLADE_PRICE' }),
    'part-current-stock-real-provider': Object.freeze({ family: 'P06-INVENTORY-001', sourceGroupId: 'PART_INVENTORY_PRIMARY' }),
    'simple-current-1': Object.freeze({ family: 'P06-SIMPLE-001', sourceGroupId: 'PART_INVENTORY_REPEAT' }),
});
const caseKeys = Object.freeze(Object.keys(CASES));
const RUNTIME_SUFFIX = Object.freeze({ legacy_v3: 'LEGACY', v4_investigation: 'V4I', v4_r3: 'V4R3' });

function run(command, args, env, allowedStatuses = [0]) {
    const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (!allowedStatuses.includes(result.status)) throw new Error(`P15R-B child failed (${result.status})`);
}

function ratio(correct, total) {
    return Object.freeze({ correct, total, rate: total ? correct / total : null });
}

function safeCaseId(caseKey, runtime) {
    return `${CASES[caseKey].family}-${runtime}`;
}

function expectedCapability(expected = {}) {
    const ids = buildToolCapabilityReverseIndex()[expected.primary_tool] || [];
    return ids.length === 1 ? getV5Capability(ids[0]) : null;
}

function readReports(directory) {
    const rows = new Map();
    for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
        const report = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
        for (const item of report.cases || []) {
            if (!CASES[item.caseKey]) continue;
            for (const [runtimeKey, runtime] of Object.entries(RUNTIME_SUFFIX)) {
                const value = item.paths?.[runtimeKey];
                if (value) rows.set(safeCaseId(item.caseKey, runtime), {
                    v4Result: value.classification,
                    v4Tools: [...(value.capabilityIds || [])],
                });
            }
        }
    }
    return rows;
}

function readInterpretations(directory) {
    const rows = new Map();
    for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.json'))) {
        for (const record of JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'))) {
            const [caseKey, runtime] = String(record.caseId).split(':');
            if (CASES[caseKey] && runtime) rows.set(safeCaseId(caseKey, runtime), { caseKey, ...record });
        }
    }
    return rows;
}

function safeActual(independent) {
    return Object.freeze({
        domain: independent?.domain || null,
        operation: independent?.operation || null,
        entityTypes: Object.freeze([...(independent?.entityTypes || [])]),
        entityAnchorStatuses: Object.freeze([...(independent?.entityAnchorStatuses || [])]),
        capabilityId: independent?.capabilityId || null,
        allowedToolNames: Object.freeze([...(independent?.allowedToolNames || [])]),
    });
}

function buildPaths(frozenCases, reports, interpretations) {
    const frozen = new Map(frozenCases.map(item => [item.case_id, item]));
    return [...frozen.keys()].filter(caseId => [...Object.values(CASES)].some(item => caseId.startsWith(item.family)))
        .sort().map(caseId => {
            const authority = frozen.get(caseId);
            const report = reports.get(caseId);
            const record = interpretations.get(caseId);
            if (!authority || !report || !record?.independent) throw new Error(`Missing frozen evaluation evidence: ${caseId}`);
            const expected = expectedCapability(authority.expected);
            if (!expected) throw new Error(`Frozen expected Tool is not uniquely mapped: ${caseId}`);
            const comparison = evaluateIndependentShadow(record.independent, authority.expected, {
                v4Result: report.v4Result,
                rootCauseClass: authority.failure_class || null,
                toolNames: report.v4Tools,
            });
            const mapping = CASES[record.caseKey];
            const actual = safeActual(record.independent);
            const expectedTool = authority.expected.primary_tool;
            const oracleTools = new Set(authority.expected.allowed_tools || [expectedTool]);
            const wrongActualTools = report.v4Tools.filter(tool => !oracleTools.has(tool));
            return Object.freeze({
                case_id: caseId,
                source_group_id: mapping.sourceGroupId,
                input_fingerprint: record.independent.inputFingerprint || null,
                runtime_variant: caseId.split('-').at(-1),
                v4_result: report.v4Result,
                root_cause_class: authority.failure_class || null,
                interpreter_status: comparison.interpreterStatus,
                expected: Object.freeze({
                    domain: expected.domain,
                    operation: expected.operation,
                    entity_types: Object.freeze([...expected.requiredEntityTypes]),
                    capability: expected.capabilityId,
                    tool: expectedTool,
                }),
                actual,
                match: Object.freeze({
                    domain: comparison.domainMatch,
                    operation: comparison.operationMatch,
                    entity_type: comparison.entityTypeMatch,
                    anchor: comparison.entityAnchorStatus === 'ANCHORED',
                    capability: comparison.capabilityMatch,
                    expected_tool_exposed: comparison.expectedToolExposed,
                    wrong_tool_excluded: comparison.wrongToolExcluded,
                }),
                wrong_tool_applicable: authority.failure_class === 'R02' && wrongActualTools.length > 0,
                overall_comparison: comparison.overallComparison,
                safe_reason_codes: Object.freeze([...comparison.reasonCodes]),
                trace_id: record.sourceTraceId || null,
                shadow_task_id: record.shadowTaskId || null,
                model_calls: Number(record.independent.modelCalls) || 0,
                usage: record.independent.usage || null,
                completion_latency_ms: Number(record.independent.completionLatencyMs) || null,
            });
        });
}

function strictAggregate(paths, groupKey, metricKey) {
    const groups = [...new Set(paths.map(item => item[groupKey]))];
    const correct = groups.filter(group => paths.filter(item => item[groupKey] === group).every(item => item.match[metricKey])).length;
    return ratio(correct, groups.length);
}

function pathMetric(paths, key, predicate = item => item.match[key]) {
    const applicable = paths.filter(item => predicate(item) !== null);
    return ratio(applicable.filter(item => predicate(item) === true).length, applicable.length);
}

function normalizedOutputSignature(item) {
    return JSON.stringify({
        interpreterStatus: item.interpreter_status,
        domain: item.actual.domain,
        operation: item.actual.operation,
        entityTypes: item.actual.entityTypes,
        anchors: item.actual.entityAnchorStatuses,
        capabilityId: item.actual.capabilityId,
        allowedTools: item.actual.allowedToolNames,
    });
}

function buildDataset(frozenCases, reports, interpretations) {
    const paths = buildPaths(frozenCases, reports, interpretations);
    if (paths.length !== 15) throw new Error(`Frozen path count changed: ${paths.length}`);
    if (new Set(paths.map(item => item.source_group_id)).size !== 5) throw new Error('Frozen source-group count changed');
    if (paths.some(item => !/^[a-f0-9]{64}$/.test(item.input_fingerprint || ''))) {
        throw new Error('Interpreter input fingerprint missing');
    }
    const metricKeys = ['domain', 'operation', 'entity_type', 'anchor', 'capability', 'expected_tool_exposed'];
    const pathMetrics = Object.fromEntries(metricKeys.map(key => [key, pathMetric(paths, key)]));
    const sourceGroupMetrics = Object.fromEntries(metricKeys.map(key => [key, strictAggregate(paths, 'source_group_id', key)]));
    const fingerprintMetrics = Object.fromEntries(metricKeys.map(key => [key, strictAggregate(paths, 'input_fingerprint', key)]));
    const fingerprints = [...new Set(paths.map(item => item.input_fingerprint))];
    const consistentFingerprints = fingerprints.filter(fingerprint => new Set(paths
        .filter(item => item.input_fingerprint === fingerprint).map(normalizedOutputSignature)).size === 1).length;
    const exact = paths.filter(item => item.case_id.startsWith('P06-EXACT-001'));
    const flatBlade = paths.filter(item => item.case_id.startsWith('P06-FLATBLADE-001'));
    const r02 = paths.filter(item => item.wrong_tool_applicable);
    const latencies = paths.map(item => item.completion_latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
    const percentile = fraction => latencies.length
        ? latencies[Math.min(latencies.length - 1, Math.ceil(fraction * latencies.length) - 1)] : null;
    const usages = paths.map(item => item.usage).filter(Boolean);
    const sumUsage = key => usages.reduce((sum, item) => sum + (Number(item[key]) || 0), 0);
    const invalid = paths.filter(item => item.interpreter_status !== 'VALID');
    const modelNoncompliance = invalid.filter(item => item.safe_reason_codes.some(code => [
        'INTERPRETATION_JSON_INVALID', 'INTERPRETATION_DOMAIN_INVALID', 'INTERPRETATION_OPERATION_INVALID',
        'INTERPRETATION_ENTITY_TYPE_INVALID', 'INTERPRETATION_SCHEMA_INVALID', 'INVALID_ENTITY_REFERENCE',
    ].includes(code))).length;
    const publicPaths = paths.map(item => ({
        case_id: item.case_id,
        source_group_id: item.source_group_id,
        input_fingerprint: item.input_fingerprint,
        runtime_variant: item.runtime_variant,
        v4_result: item.v4_result,
        root_cause_class: item.root_cause_class,
        interpreter_status: item.interpreter_status,
        expected: item.expected,
        actual: item.actual,
        match: item.match,
        wrong_tool_applicable: item.wrong_tool_applicable,
        overall_comparison: item.overall_comparison,
        safe_reason_codes: item.safe_reason_codes,
        trace_id: item.trace_id,
        shadow_task_id: item.shadow_task_id,
    }));
    return Object.freeze({
        schema_version: 1,
        interpreter_version: 1,
        prompt_version: '1.1',
        project: 'pump-ai-v5e4r-v1-1-shadow',
        paths: Object.freeze(publicPaths),
        metrics: Object.freeze({
            real_paths: paths.length,
            source_groups: new Set(paths.map(item => item.source_group_id)).size,
            input_fingerprints: fingerprints.length,
            interpreter_model_calls: paths.reduce((sum, item) => sum + item.model_calls, 0),
            valid_outputs: paths.filter(item => item.interpreter_status === 'VALID').length,
            invalid_outputs: invalid.length,
            model_noncompliance_count: modelNoncompliance,
            path: Object.freeze(pathMetrics),
            source_group: Object.freeze(sourceGroupMetrics),
            input_fingerprint: Object.freeze(fingerprintMetrics),
            identical_input_consistency: ratio(consistentFingerprints, fingerprints.length),
            exact_entity: Object.freeze({
                cases: exact.length,
                anchor: ratio(exact.filter(item => item.match.anchor).length, exact.length),
                identity_preservation: ratio(exact.filter(item => item.match.anchor).length, exact.length),
            }),
            flat_blade: Object.freeze({
                cases: flatBlade.length,
                anchor: ratio(flatBlade.filter(item => item.match.anchor).length, flatBlade.length),
                capability: ratio(flatBlade.filter(item => item.match.capability).length, flatBlade.length),
                expected_tool_exposure: ratio(flatBlade.filter(item => item.match.expected_tool_exposed).length, flatBlade.length),
            }),
            r02_wrong_tool_exclusion: ratio(r02.filter(item => item.match.wrong_tool_excluded).length, r02.length),
            false_blocks: paths.filter(item => item.overall_comparison === 'V5_FALSE_BLOCK').length,
            blocked_failures: paths.filter(item => item.overall_comparison === 'V5_BLOCKS_V4_FAILURE').length,
            insufficient: paths.filter(item => item.overall_comparison === 'V5_INSUFFICIENT_DATA').length,
            token_usage: usages.length ? Object.freeze({
                promptTokens: sumUsage('promptTokens'),
                completionTokens: sumUsage('completionTokens'),
                totalTokens: sumUsage('totalTokens'),
            }) : null,
            shadow_completion_median_ms: percentile(0.5),
            shadow_completion_p95_ms: percentile(0.95),
            v5_tool_calls: 0,
            v5_business_api_calls: 0,
            v5_writes: 0,
        }),
    });
}

function main() {
    const analyzeOnly = process.argv.includes('--analyze-only');
    if (!analyzeOnly && !process.env.DEEPSEEK_API_KEY) throw new Error('Configured real provider is unavailable');
    const work = process.env.PUMP_P15R_B_WORK_DIR
        ? path.resolve(process.env.PUMP_P15R_B_WORK_DIR)
        : fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p15rb-real-'));
    const outputPath = process.env.PUMP_P15R_B_OUTPUT_PATH
        ? path.resolve(process.env.PUMP_P15R_B_OUTPUT_PATH) : defaultOutputPath;
    const reports = path.join(work, 'reports');
    const interpretations = path.join(work, 'interpretations');
    const marker = path.join(work, 'formal-eval-started.json');
    fs.mkdirSync(reports, { recursive: true });
    fs.mkdirSync(interpretations, { recursive: true });
    if (!analyzeOnly) {
        if (fs.existsSync(marker)) throw new Error('Formal V1.1 evaluation already started in this work directory');
        fs.writeFileSync(marker, `${JSON.stringify({ promptVersion: '1.1', paths: 15 })}\n`, 'utf8');
        const existingNodeOptions = String(process.env.NODE_OPTIONS || '').trim();
        const nodeOptions = [existingNodeOptions, `--require=${preload}`].filter(Boolean).join(' ');
        const commonEnv = {
            ...process.env,
            AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata',
            AI_OBSERVABILITY_PROJECT: 'pump-ai-v5e4r-v1-1-shadow',
            AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1',
            AI_V5_INTERPRETER_TIMEOUT_MS: '20000', NODE_OPTIONS: nodeOptions,
        };
        for (const caseKey of caseKeys) {
            const reportPath = path.join(reports, `${caseKey}.json`);
            const interpreterPath = path.join(interpretations, `${caseKey}.json`);
            run(process.execPath, [runner, `--case-key=${caseKey}`], {
                ...commonEnv,
                PUMP_P15_REPLAY_REPORT_PATH: reportPath,
                PUMP_P15_INTERPRETER_REPORT_PATH: interpreterPath,
            }, [0, 1]);
            if (!fs.existsSync(reportPath) || !fs.existsSync(interpreterPath)) throw new Error(`V1.1 evidence missing: ${caseKey}`);
        }
    }
    const dataset = buildDataset(
        JSON.parse(fs.readFileSync(frozenPath, 'utf8')),
        readReports(reports),
        readInterpretations(interpretations)
    );
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({ status: 'completed', workDirectory: work, output: outputPath, metrics: dataset.metrics })}\n`);
}

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error.name, message: error.message })}\n`);
        process.exitCode = 1;
    }
}

module.exports = { CASES, buildDataset, caseKeys, readInterpretations, readReports };
