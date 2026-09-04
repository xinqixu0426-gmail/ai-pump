'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getV5Capability } = require('../api/services/ai-v5/capabilityRegistry.cjs');
const { V5_TASK_CLASS_CATALOG } = require('../api/services/ai-v5/taskClassCatalog.cjs');
const prior = require('./run-ai-v5e4r-v1_1-evaluation.cjs');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts', 'run-ai-shadow-evaluation.cjs');
const preload = path.join(root, 'scripts', 'observability-p15-interpreter-preload.cjs');
const frozenPath = path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json');
const defaultOutputPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-protocol-v2-evaluation.json');

function ratio(correct, total) {
    return Object.freeze({ correct, total, rate: total ? correct / total : null });
}

function run(command, args, env, allowedStatuses = [0]) {
    const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (!allowedStatuses.includes(result.status)) throw new Error(`P15R-C child failed (${result.status})`);
}

function expectedTaskClass(expected) {
    const capability = getV5Capability(expected.capability);
    if (!capability) return null;
    return V5_TASK_CLASS_CATALOG.find(item => item.domain === capability.domain
        && item.operation === capability.operation
        && JSON.stringify(item.entityTypes) === JSON.stringify([...capability.requiredEntityTypes].sort())) || null;
}

function metric(paths, predicate, applicable = () => true) {
    const rows = paths.filter(applicable);
    return ratio(rows.filter(predicate).length, rows.length);
}

function strictGroupMetric(paths, groupKey, predicate) {
    const groups = [...new Set(paths.map(item => item[groupKey]))];
    return ratio(groups.filter(group => paths.filter(item => item[groupKey] === group).every(predicate)).length, groups.length);
}

function buildProtocolV2Dataset(base) {
    if (base.paths.length !== 15 || base.metrics.source_groups !== 5 || base.metrics.input_fingerprints !== 4) {
        throw new Error('Frozen V2 evaluation corpus changed');
    }
    const internalPaths = base.paths.map(item => {
        const expectedClass = expectedTaskClass(item.expected);
        if (!expectedClass) throw new Error(`Expected task class unavailable: ${item.case_id}`);
        const protocolValid = item.actual.protocolStatus === 'VALID';
        const classMatch = protocolValid && item.actual.taskClassRef === expectedClass.classRef;
        const spanSelection = protocolValid && item.match.anchor
            && item.actual.sourceSpanRefs.length === item.expected.entity_types.length;
        return {
            ...item,
            protocolValid,
            classMatch,
            spanSelection,
        };
    });
    const signatures = new Map();
    for (const item of internalPaths) {
        const signature = JSON.stringify({
            status: item.actual.protocolStatus,
            taskClassRef: item.actual.taskClassRef,
            sourceSpanRefs: item.actual.sourceSpanRefs,
            domain: item.actual.domain,
            operation: item.actual.operation,
            entityTypes: item.actual.entityTypes,
        });
        if (!signatures.has(item.input_fingerprint)) signatures.set(item.input_fingerprint, new Set());
        signatures.get(item.input_fingerprint).add(signature);
    }
    const exact = internalPaths.filter(item => item.case_id.startsWith('P06-EXACT-001'));
    const flat = internalPaths.filter(item => item.case_id.startsWith('P06-FLATBLADE-001'));
    const r02 = internalPaths.filter(item => item.wrong_tool_applicable);
    const publicPaths = internalPaths.map(item => Object.freeze({
        case_id: item.case_id,
        source_group_id: item.source_group_id,
        input_fingerprint: item.input_fingerprint,
        protocol_status: item.actual.protocolStatus,
        task_class_match: item.classMatch,
        projected_domain_match: item.match.domain,
        projected_operation_match: item.match.operation,
        projected_entity_type_match: item.match.entity_type,
        span_selection_status: item.spanSelection ? 'MATCH' : 'MISMATCH',
        anchor_status: item.match.anchor ? 'ANCHORED' : 'NOT_ANCHORED',
        capability_match: item.match.capability,
        expected_tool_exposed: item.match.expected_tool_exposed,
        wrong_tool_excluded: item.wrong_tool_applicable ? item.match.wrong_tool_excluded : null,
        overall_comparison: item.overall_comparison,
        safe_reason_codes: item.safe_reason_codes,
        trace_id: item.trace_id,
        shadow_task_id: item.shadow_task_id,
    }));
    const pathMetric = predicate => metric(internalPaths, predicate);
    return Object.freeze({
        schema_version: 1,
        external_contract_version: 1,
        internal_protocol_version: 2,
        prompt_version: 2,
        task_class_catalog_version: 1,
        project: 'pump-ai-v5e4r-protocol-v2-shadow',
        paths: Object.freeze(publicPaths),
        metrics: Object.freeze({
            real_paths: internalPaths.length,
            source_groups: base.metrics.source_groups,
            input_fingerprints: base.metrics.input_fingerprints,
            interpreter_model_calls: base.metrics.interpreter_model_calls,
            protocol_valid: pathMetric(item => item.protocolValid),
            task_class: pathMetric(item => item.classMatch),
            projected_domain: pathMetric(item => item.match.domain),
            projected_operation: pathMetric(item => item.match.operation),
            projected_entity_type: pathMetric(item => item.match.entity_type),
            source_span_selection: pathMetric(item => item.spanSelection),
            entity_anchor: pathMetric(item => item.match.anchor),
            capability: pathMetric(item => item.match.capability),
            expected_tool_exposure: pathMetric(item => item.match.expected_tool_exposed),
            wrong_tool_exclusion: metric(internalPaths, item => item.match.wrong_tool_excluded, item => item.wrong_tool_applicable),
            exact_entity: Object.freeze({
                cases: exact.length,
                task_class: metric(exact, item => item.classMatch),
                source_span: metric(exact, item => item.spanSelection),
                anchor: metric(exact, item => item.match.anchor),
                identity_preservation: metric(exact, item => item.spanSelection && item.match.anchor),
                capability: metric(exact, item => item.match.capability),
                expected_tool_exposure: metric(exact, item => item.match.expected_tool_exposed),
            }),
            flat_blade: Object.freeze({
                cases: flat.length,
                task_class: metric(flat, item => item.classMatch),
                source_span: metric(flat, item => item.spanSelection),
                anchor: metric(flat, item => item.match.anchor),
                capability: metric(flat, item => item.match.capability),
                expected_tool_exposure: metric(flat, item => item.match.expected_tool_exposed),
            }),
            identical_input_consistency: ratio(
                [...signatures.values()].filter(values => values.size === 1).length,
                signatures.size
            ),
            source_group_task_class: strictGroupMetric(internalPaths, 'source_group_id', item => item.classMatch),
            input_fingerprint_task_class: strictGroupMetric(internalPaths, 'input_fingerprint', item => item.classMatch),
            model_noncompliance_count: internalPaths.filter(item => !item.protocolValid).length,
            false_blocks: base.metrics.false_blocks,
            blocked_failures: base.metrics.blocked_failures,
            insufficient: base.metrics.insufficient,
            token_usage: base.metrics.token_usage,
            shadow_completion_median_ms: base.metrics.shadow_completion_median_ms,
            shadow_completion_p95_ms: base.metrics.shadow_completion_p95_ms,
            v5_tool_calls: 0,
            v5_business_api_calls: 0,
            v5_writes: 0,
        }),
    });
}

function main() {
    const analyzeOnly = process.argv.includes('--analyze-only');
    if (!analyzeOnly && !process.env.DEEPSEEK_API_KEY) throw new Error('Configured real provider is unavailable');
    const work = process.env.PUMP_P15R_C_WORK_DIR
        ? path.resolve(process.env.PUMP_P15R_C_WORK_DIR)
        : fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p15rc-real-'));
    const outputPath = process.env.PUMP_P15R_C_OUTPUT_PATH
        ? path.resolve(process.env.PUMP_P15R_C_OUTPUT_PATH) : defaultOutputPath;
    const reports = path.join(work, 'reports');
    const interpretations = path.join(work, 'interpretations');
    const marker = path.join(work, 'formal-eval-started.json');
    fs.mkdirSync(reports, { recursive: true });
    fs.mkdirSync(interpretations, { recursive: true });
    if (!analyzeOnly) {
        if (fs.existsSync(marker)) throw new Error('Formal Protocol V2 evaluation already started in this work directory');
        fs.writeFileSync(marker, `${JSON.stringify({ protocolVersion: 2, paths: 15 })}\n`, 'utf8');
        const nodeOptions = [String(process.env.NODE_OPTIONS || '').trim(), `--require=${preload}`].filter(Boolean).join(' ');
        const commonEnv = {
            ...process.env,
            AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata',
            AI_OBSERVABILITY_PROJECT: 'pump-ai-v5e4r-protocol-v2-shadow',
            AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1',
            AI_V5_INTERPRETER_TIMEOUT_MS: '20000', NODE_OPTIONS: nodeOptions,
        };
        for (const caseKey of prior.caseKeys) {
            run(process.execPath, [runner, `--case-key=${caseKey}`], {
                ...commonEnv,
                PUMP_P15_REPLAY_REPORT_PATH: path.join(reports, `${caseKey}.json`),
                PUMP_P15_INTERPRETER_REPORT_PATH: path.join(interpretations, `${caseKey}.json`),
            }, [0, 1]);
        }
    }
    const base = prior.buildDataset(
        JSON.parse(fs.readFileSync(frozenPath, 'utf8')),
        prior.readReports(reports),
        prior.readInterpretations(interpretations)
    );
    const dataset = buildProtocolV2Dataset(base);
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

module.exports = { buildProtocolV2Dataset };

