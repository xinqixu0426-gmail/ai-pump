'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
    buildToolCapabilityReverseIndex,
    getV5Capability,
} = require('../api/services/ai-v5/capabilityRegistry.cjs');
const { evaluateIndependentShadow } = require('../api/services/ai-v5/independentShadow.cjs');
const { V5_TASK_CLASS_CATALOG } = require('../api/services/ai-v5/taskClassCatalog.cjs');
const {
    V5_INTERPRETER_MODEL_SETTINGS,
    V5_TASK_INTERPRETER_INSTRUCTION,
} = require('../api/services/ai-v5/taskInterpreter.cjs');
const prior = require('./run-ai-v5e4r-v1_1-evaluation.cjs');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts', 'run-ai-shadow-evaluation.cjs');
const preload = path.join(root, 'scripts', 'observability-p15-interpreter-preload.cjs');
const frozenPath = path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json');
const defaultOutputPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-protocol-v2-evaluation.json');
const partialDatasetPath = defaultOutputPath;
const completeOutputPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-protocol-v2-complete-evaluation.json');
const RUNTIME_SUFFIX = Object.freeze({ legacy_v3: 'LEGACY', v4_investigation: 'V4I', v4_r3: 'V4R3' });
const REMAINING_FROZEN_PATH_IDS = Object.freeze([
    'P06-FLATBLADE-001-LEGACY',
    'P06-FLATBLADE-001-V4I',
    'P06-FLATBLADE-001-V4R3',
    'P06-INVENTORY-001-LEGACY',
    'P06-INVENTORY-001-V4I',
    'P06-INVENTORY-001-V4R3',
    'P06-SIMPLE-001-LEGACY',
    'P06-SIMPLE-001-V4I',
    'P06-SIMPLE-001-V4R3',
]);
const FROZEN_INTERPRETER_HASHES = Object.freeze({
    prompt: '24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3',
    taskClassCatalog: 'c298bcf127030602b5f82cdcc8aed61554a789aacc1b082ade70eed1ca5d0ef9',
    sourceSpanCode: '00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8',
    protocolV2: 'da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad',
    modelSettings: '2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398',
    inputEnvelope: 'a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded',
});

function ratio(correct, total) {
    return Object.freeze({ correct, total, rate: total ? correct / total : null });
}

function canonicalValue(value) {
    if (Array.isArray(value)) return value.map(canonicalValue);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
    }
    return value;
}

function canonicalHash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(canonicalValue(value))).digest('hex');
}

function fileHash(relativePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex');
}

function verifyFrozenInterpreterHashes() {
    const actual = Object.freeze({
        prompt: crypto.createHash('sha256').update(V5_TASK_INTERPRETER_INSTRUCTION).digest('hex'),
        taskClassCatalog: crypto.createHash('sha256').update(JSON.stringify(V5_TASK_CLASS_CATALOG)).digest('hex'),
        sourceSpanCode: fileHash('api/services/ai-v5/sourceSpanCatalog.cjs'),
        protocolV2: fileHash('api/services/ai-v5/taskInterpreterProtocolV2.cjs'),
        modelSettings: crypto.createHash('sha256').update(JSON.stringify(V5_INTERPRETER_MODEL_SETTINGS)).digest('hex'),
        inputEnvelope: fileHash('api/services/ai-v5/taskInterpreterInput.cjs'),
    });
    if (Object.keys(FROZEN_INTERPRETER_HASHES).some(key => actual[key] !== FROZEN_INTERPRETER_HASHES[key])) {
        throw Object.assign(new Error('Frozen Protocol V2 interpreter hash mismatch'), {
            code: 'P15R_C_FROZEN_HASH_MISMATCH',
        });
    }
    return actual;
}

function runnerDisposition(result, report) {
    if (result?.error) return Object.freeze({ action: 'FATAL', reason: 'RUNNER_PROCESS_ERROR' });
    const validCaseReport = report?.suite === 'r4b_read_shadow_comparison'
        && Array.isArray(report?.cases)
        && report.cases.length === 1;
    if ((result?.status === 0 || result?.status === 1) && validCaseReport) {
        return Object.freeze({ action: 'RECORD_CONTINUE', reason: 'RUNNER_COMPLETED' });
    }
    const caseLevelIncomparable = result?.status === 2
        && report?.status === 'INCOMPLETE'
        && report?.rolloutReadiness?.blocker === 'SHADOW_INCOMPARABLE'
        && validCaseReport
        && report.cases[0]?.comparison === 'INCOMPARABLE';
    if (caseLevelIncomparable) {
        return Object.freeze({ action: 'RECORD_CONTINUE', reason: 'CASE_LEVEL_SHADOW_INCOMPARABLE' });
    }
    return Object.freeze({ action: 'FATAL', reason: `RUNNER_STATUS_${result?.status ?? 'UNKNOWN'}` });
}

function runFrozenCase(command, args, env, reportPath, spawn = spawnSync) {
    const result = spawn(command, args, { cwd: root, env, stdio: 'inherit' });
    let report = null;
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { /* validated below */ }
    const disposition = runnerDisposition(result, report);
    if (disposition.action === 'FATAL') {
        throw Object.assign(new Error(`P15R-C runner fatal: ${disposition.reason}`), {
            code: 'P15R_C_RUNNER_FATAL',
            disposition,
        });
    }
    return disposition;
}

function assertUniqueKnownPaths(pathIds, frozenPathIds, label) {
    if (!Array.isArray(pathIds)) throw new TypeError(`${label} must be an array`);
    if (new Set(pathIds).size !== pathIds.length) throw new Error(`${label} contains duplicate path ID`);
    const known = new Set(frozenPathIds);
    const unknown = pathIds.find(pathId => !known.has(pathId));
    if (unknown) throw new Error(`${label} contains unknown path ID: ${unknown}`);
}

function planResumePaths({ frozenPathIds, executedPathIds, requestedPathIds }) {
    assertUniqueKnownPaths(frozenPathIds, frozenPathIds, 'frozenPathIds');
    assertUniqueKnownPaths(executedPathIds, frozenPathIds, 'executedPathIds');
    assertUniqueKnownPaths(requestedPathIds, frozenPathIds, 'requestedPathIds');
    const executed = new Set(executedPathIds);
    const requested = new Set(requestedPathIds);
    return Object.freeze({
        execute: Object.freeze(frozenPathIds.filter(pathId => requested.has(pathId) && !executed.has(pathId))),
        skipped: Object.freeze(frozenPathIds.filter(pathId => requested.has(pathId) && executed.has(pathId))),
    });
}

function executeRunnerCases(caseKeys, executeCase) {
    const results = [];
    for (const caseKey of caseKeys) results.push(executeCase(caseKey));
    return Object.freeze(results);
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

function expectedCapability(expected = {}) {
    const ids = buildToolCapabilityReverseIndex()[expected.primary_tool] || [];
    return ids.length === 1 ? getV5Capability(ids[0]) : null;
}

function mappingForPathId(pathId) {
    for (const [caseKey, mapping] of Object.entries(prior.CASES)) {
        if (pathId.startsWith(`${mapping.family}-`)) return Object.freeze({ caseKey, ...mapping });
    }
    return null;
}

function frozenPathIds(frozenCases) {
    const families = new Set(Object.values(prior.CASES).map(item => item.family));
    return frozenCases.map(item => item.case_id).filter(caseId => [...families].some(family => caseId.startsWith(`${family}-`)));
}

function internalPathToPublic(item) {
    return Object.freeze({
        case_id: item.case_id,
        source_group_id: item.source_group_id,
        inputFingerprint: item.input_fingerprint,
        protocolStatus: item.actual.protocolStatus,
        taskClassMatch: item.class_match,
        projectedDomainMatch: item.match.domain,
        projectedOperationMatch: item.match.operation,
        projectedEntityTypeMatch: item.match.entity_type,
        spanSelectionStatus: item.span_selection ? 'MATCH' : item.actual.protocolStatus === 'NOT_AVAILABLE' ? 'NOT_RUN' : 'MISMATCH',
        anchorStatus: item.match.anchor ? 'ANCHORED' : item.actual.protocolStatus === 'NOT_AVAILABLE' ? 'NOT_RUN' : 'NOT_ANCHORED',
        capabilityMatch: item.match.capability,
        expectedToolExposed: item.match.expected_tool_exposed,
        wrongToolExcluded: item.wrong_tool_applicable ? item.match.wrong_tool_excluded : null,
        overallComparison: item.overall_comparison,
        safeReasonCodes: item.safe_reason_codes,
        traceId: item.trace_id,
        shadowTaskId: item.shadow_task_id,
    });
}

function buildResumedInternalPaths(frozenCases, reports, interpretations, requestedPathIds) {
    const frozen = new Map(frozenCases.map(item => [item.case_id, item]));
    const rows = requestedPathIds.map(caseId => {
        const authority = frozen.get(caseId);
        const mapping = mappingForPathId(caseId);
        const report = reports.get(caseId);
        const record = interpretations.get(caseId);
        if (!authority || !mapping || !report) throw new Error(`Missing frozen continuation evidence: ${caseId}`);
        const expected = expectedCapability(authority.expected);
        if (!expected) throw new Error(`Frozen expected Tool is not uniquely mapped: ${caseId}`);
        const expectedClass = expectedTaskClass({ capability: expected.capabilityId });
        if (!expectedClass) throw new Error(`Expected task class unavailable: ${caseId}`);
        const expectedTool = authority.expected.primary_tool;
        const oracleTools = new Set(authority.expected.allowed_tools || [expectedTool]);
        const wrongActualTools = report.v4Tools.filter(tool => !oracleTools.has(tool));
        const independent = record?.independent || null;
        if (!independent) {
            return {
                case_id: caseId,
                source_group_id: mapping.sourceGroupId,
                input_fingerprint: null,
                actual: { protocolStatus: 'NOT_AVAILABLE' },
                class_match: false,
                span_selection: false,
                match: {
                    domain: false, operation: false, entity_type: false, anchor: false,
                    capability: false, expected_tool_exposed: false, wrong_tool_excluded: false,
                },
                wrong_tool_applicable: authority.failure_class === 'R02' && wrongActualTools.length > 0,
                overall_comparison: 'V5_INSUFFICIENT_DATA',
                safe_reason_codes: Object.freeze(['V4_PATH_UNAVAILABLE', 'INDEPENDENT_SHADOW_NOT_AVAILABLE', 'CASE_LEVEL_SHADOW_INCOMPARABLE']),
                trace_id: record?.sourceTraceId || null,
                shadow_task_id: record?.shadowTaskId || null,
                model_calls: 0,
                usage: null,
                completion_latency_ms: null,
                output_signature: null,
                frozen_failure_class: authority.failure_class || null,
                frozen_wrong_tools: Object.freeze([...(authority.safe_structural_metadata?.tools || [])]
                    .filter(tool => !oracleTools.has(tool))),
                allowed_tool_names: Object.freeze([]),
            };
        }
        const comparison = evaluateIndependentShadow(independent, authority.expected, {
            v4Result: report.v4Result,
            rootCauseClass: authority.failure_class || null,
            toolNames: report.v4Tools,
        });
        const protocolValid = independent.protocolStatus === 'VALID';
        const classMatch = protocolValid && independent.taskClassRef === expectedClass.classRef;
        const spanSelection = protocolValid && comparison.entityAnchorStatus === 'ANCHORED'
            && independent.sourceSpanRefs.length === expected.requiredEntityTypes.length;
        return {
            case_id: caseId,
            source_group_id: mapping.sourceGroupId,
            input_fingerprint: independent.inputFingerprint || null,
            actual: { protocolStatus: independent.protocolStatus || independent.interpreterStatus || null },
            class_match: classMatch,
            span_selection: spanSelection,
            match: {
                domain: comparison.domainMatch,
                operation: comparison.operationMatch,
                entity_type: comparison.entityTypeMatch,
                anchor: comparison.entityAnchorStatus === 'ANCHORED',
                capability: comparison.capabilityMatch,
                expected_tool_exposed: comparison.expectedToolExposed,
                wrong_tool_excluded: comparison.wrongToolExcluded,
            },
            wrong_tool_applicable: authority.failure_class === 'R02' && wrongActualTools.length > 0,
            overall_comparison: comparison.overallComparison,
            safe_reason_codes: Object.freeze([...comparison.reasonCodes]),
            trace_id: record.sourceTraceId || null,
            shadow_task_id: record.shadowTaskId || null,
            model_calls: Number(independent.modelCalls) || 0,
            usage: independent.usage || null,
            completion_latency_ms: Number(independent.completionLatencyMs) || null,
            output_signature: JSON.stringify({
                interpreterStatus: independent.interpreterStatus,
                taskClassRef: independent.taskClassRef,
                sourceSpanRefs: independent.sourceSpanRefs,
                domain: independent.domain,
                operation: independent.operation,
                entityTypes: independent.entityTypes,
                capabilityId: independent.capabilityId,
                allowedToolNames: independent.allowedToolNames,
            }),
            frozen_failure_class: authority.failure_class || null,
            frozen_wrong_tools: Object.freeze([...(authority.safe_structural_metadata?.tools || [])]
                .filter(tool => !oracleTools.has(tool))),
            allowed_tool_names: Object.freeze([...(independent.allowedToolNames || [])]),
        };
    });
    for (const group of new Set(rows.map(item => item.source_group_id))) {
        const grouped = rows.filter(item => item.source_group_id === group);
        const fingerprints = [...new Set(grouped.map(item => item.input_fingerprint).filter(Boolean))];
        if (fingerprints.length === 1) {
            for (const item of grouped) if (!item.input_fingerprint) item.input_fingerprint = fingerprints[0];
        }
    }
    return Object.freeze(rows.map(Object.freeze));
}

function booleanMetric(paths, key, applicable = () => true) {
    const selected = paths.filter(applicable);
    return ratio(selected.filter(item => item[key] === true).length, selected.length);
}

function groupedMetric(paths, groupKey, metricKey) {
    const groups = [...new Set(paths.map(item => item[groupKey]).filter(Boolean))];
    return ratio(groups.filter(group => paths.filter(item => item[groupKey] === group)
        .every(item => item[metricKey] === true)).length, groups.length);
}

function metricSet(paths, groupKey = null) {
    const fields = [
        'taskClassMatch', 'projectedDomainMatch', 'projectedOperationMatch',
        'projectedEntityTypeMatch', 'capabilityMatch', 'expectedToolExposed',
    ];
    return Object.fromEntries(fields.map(field => [field, groupKey
        ? groupedMetric(paths, groupKey, field)
        : booleanMetric(paths, field)]));
}

function completeMetrics(paths, resumedInternalPaths, partialDataset) {
    const exact = paths.filter(item => item.case_id.startsWith('P06-EXACT-001'));
    const flat = paths.filter(item => item.case_id.startsWith('P06-FLATBLADE-001'));
    const resumeFingerprints = new Map();
    for (const item of resumedInternalPaths.filter(row => row.output_signature && row.input_fingerprint)) {
        if (!resumeFingerprints.has(item.input_fingerprint)) resumeFingerprints.set(item.input_fingerprint, new Set());
        resumeFingerprints.get(item.input_fingerprint).add(item.output_signature);
    }
    const priorConsistency = partialDataset.observed_metrics.identicalInputConsistency;
    const resumeConsistent = [...resumeFingerprints.values()].filter(values => values.size === 1).length;
    const resumedModelCalls = resumedInternalPaths.reduce((sum, item) => sum + item.model_calls, 0);
    const frozenR02 = resumedInternalPaths.filter(item => item.frozen_failure_class === 'R02');
    const frozenR02Excluded = frozenR02.filter(item => item.frozen_wrong_tools.length > 0
        && item.frozen_wrong_tools.every(tool => !item.allowed_tool_names.includes(tool))).length;
    const usageRows = resumedInternalPaths.map(item => item.usage).filter(Boolean);
    const latencyRows = resumedInternalPaths.map(item => item.completion_latency_ms).filter(Number.isFinite).sort((a, b) => a - b);
    const percentile = percentileValue => latencyRows.length
        ? latencyRows[Math.min(latencyRows.length - 1, Math.ceil(latencyRows.length * percentileValue) - 1)] : null;
    return Object.freeze({
        protocolValidOutputs: ratio(paths.filter(item => item.protocolStatus === 'VALID').length, paths.length),
        protocolInvalidOutputs: paths.filter(item => item.protocolStatus === 'INVALID').length,
        interpreterOutcomeNotAvailable: paths.filter(item => item.protocolStatus === 'NOT_AVAILABLE').length,
        modelNoncomplianceCount: paths.filter(item => item.protocolStatus === 'INVALID').length,
        ...metricSet(paths),
        sourceSpanSelectionAccuracy: ratio(paths.filter(item => item.spanSelectionStatus === 'MATCH').length, paths.length),
        entityAnchorAccuracy: ratio(paths.filter(item => item.anchorStatus === 'ANCHORED').length, paths.length),
        wrongToolExclusionAccuracy: booleanMetric(paths, 'wrongToolExcluded', item => item.wrongToolExcluded !== null),
        r02Cases: frozenR02.length,
        r02FrozenWrongToolExclusion: ratio(frozenR02Excluded, frozenR02.length),
        sourceGroupMetrics: Object.freeze(metricSet(paths, 'source_group_id')),
        inputFingerprintMetrics: Object.freeze(metricSet(paths, 'inputFingerprint')),
        identicalInputConsistency: ratio(
            priorConsistency.correct + resumeConsistent,
            priorConsistency.total + resumeFingerprints.size
        ),
        exactEntity: Object.freeze({
            cases: exact.length,
            taskClass: booleanMetric(exact, 'taskClassMatch'),
            sourceSpan: ratio(exact.filter(item => item.spanSelectionStatus === 'MATCH').length, exact.length),
            anchor: ratio(exact.filter(item => item.anchorStatus === 'ANCHORED').length, exact.length),
            capability: booleanMetric(exact, 'capabilityMatch'),
            expectedToolExposure: booleanMetric(exact, 'expectedToolExposed'),
            notComparable: exact.filter(item => item.protocolStatus === 'NOT_AVAILABLE').length,
        }),
        flatBlade: Object.freeze({
            cases: flat.length,
            taskClass: booleanMetric(flat, 'taskClassMatch'),
            sourceSpan: ratio(flat.filter(item => item.spanSelectionStatus === 'MATCH').length, flat.length),
            anchor: ratio(flat.filter(item => item.anchorStatus === 'ANCHORED').length, flat.length),
            capability: booleanMetric(flat, 'capabilityMatch'),
            expectedToolExposure: booleanMetric(flat, 'expectedToolExposed'),
            wrongToolExclusion: booleanMetric(flat, 'wrongToolExcluded', item => item.wrongToolExcluded !== null),
        }),
        v5FalseBlockCount: paths.filter(item => item.overallComparison === 'V5_FALSE_BLOCK').length,
        v5BlocksV4FailureCount: paths.filter(item => item.overallComparison === 'V5_BLOCKS_V4_FAILURE').length,
        v5InsufficientDataCount: paths.filter(item => item.overallComparison === 'V5_INSUFFICIENT_DATA').length,
        notComparableCount: paths.filter(item => item.overallComparison === 'NOT_COMPARABLE').length,
        originalInterpreterModelCalls: partialDataset.observed_metrics.v5InterpreterModelCalls,
        resumedInterpreterModelCalls: resumedModelCalls,
        totalInterpreterModelCalls: partialDataset.observed_metrics.v5InterpreterModelCalls + resumedModelCalls,
        resumedTokenUsage: Object.freeze({
            promptTokens: usageRows.reduce((sum, item) => sum + Number(item.promptTokens || 0), 0),
            completionTokens: usageRows.reduce((sum, item) => sum + Number(item.completionTokens || 0), 0),
            totalTokens: usageRows.reduce((sum, item) => sum + Number(item.totalTokens || 0), 0),
        }),
        resumedShadowCompletionMedianMs: percentile(0.5),
        resumedShadowCompletionP95Ms: percentile(0.95),
        v5ToolCalls: 0,
        v5BusinessApiCalls: 0,
        v5Writes: 0,
    });
}

function buildCompleteDataset({ partialDataset, resumedInternalPaths, allFrozenPathIds }) {
    const firstSixHashBefore = canonicalHash(partialDataset.paths);
    const resumedPublic = resumedInternalPaths.map(internalPathToPublic);
    const byId = new Map();
    for (const item of [...partialDataset.paths, ...resumedPublic]) {
        if (byId.has(item.case_id)) throw new Error(`Duplicate path result: ${item.case_id}`);
        if (!allFrozenPathIds.includes(item.case_id)) throw new Error(`Unknown path result: ${item.case_id}`);
        byId.set(item.case_id, item);
    }
    if (byId.size !== allFrozenPathIds.length) throw new Error(`Incomplete frozen result set: ${byId.size}/${allFrozenPathIds.length}`);
    const paths = Object.freeze(allFrozenPathIds.map(pathId => byId.get(pathId)));
    const preservedFirstSix = paths.filter(item => partialDataset.paths.some(original => original.case_id === item.case_id));
    const firstSixHashAfter = canonicalHash(preservedFirstSix);
    if (firstSixHashAfter !== firstSixHashBefore) throw new Error('Original six Protocol V2 records changed');
    return Object.freeze({
        schema_version: 1,
        external_contract_version: 1,
        internal_protocol_version: 2,
        prompt_version: 2,
        task_class_catalog_version: 1,
        project: 'pump-ai-v5e4r-protocol-v2-shadow',
        evaluation_status: 'COMPLETE_WITH_CASE_LEVEL_OUTCOMES',
        frozen_paths_total: allFrozenPathIds.length,
        original_paths_preserved: partialDataset.paths.length,
        resumed_paths_executed: resumedPublic.length,
        formal_initial_runs: 1,
        formal_continuation_runs: 1,
        first_6_records_hash_before: firstSixHashBefore,
        first_6_records_hash_after: firstSixHashAfter,
        paths,
        metrics: completeMetrics(paths, resumedInternalPaths, partialDataset),
    });
}

function main() {
    const analyzeOnly = process.argv.includes('--analyze-only');
    const resumeRemainingOnly = process.argv.includes('--resume-remaining-only');
    if (!analyzeOnly && !process.env.DEEPSEEK_API_KEY) throw new Error('Configured real provider is unavailable');
    verifyFrozenInterpreterHashes();
    const work = process.env.PUMP_P15R_C_WORK_DIR
        ? path.resolve(process.env.PUMP_P15R_C_WORK_DIR)
        : fs.mkdtempSync(path.join(os.tmpdir(), resumeRemainingOnly ? 'pump-p15rc-b1-resume-' : 'pump-p15rc-real-'));
    const outputPath = process.env.PUMP_P15R_C_OUTPUT_PATH
        ? path.resolve(process.env.PUMP_P15R_C_OUTPUT_PATH)
        : resumeRemainingOnly ? completeOutputPath : defaultOutputPath;
    const reports = path.join(work, 'reports');
    const interpretations = path.join(work, 'interpretations');
    const marker = path.join(work, resumeRemainingOnly ? 'formal-continuation-started.json' : 'formal-eval-started.json');
    fs.mkdirSync(reports, { recursive: true });
    fs.mkdirSync(interpretations, { recursive: true });
    const frozenCases = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
    const allFrozenPathIds = frozenPathIds(frozenCases);
    if (allFrozenPathIds.length !== 15) throw new Error(`Frozen path count changed: ${allFrozenPathIds.length}`);
    const partialDataset = JSON.parse(fs.readFileSync(partialDatasetPath, 'utf8'));
    const executedPathIds = partialDataset.paths.map(item => item.case_id);
    const firstSixHash = canonicalHash(partialDataset.paths);
    const resumePlan = planResumePaths({
        frozenPathIds: allFrozenPathIds,
        executedPathIds,
        requestedPathIds: resumeRemainingOnly ? REMAINING_FROZEN_PATH_IDS : allFrozenPathIds,
    });
    if (resumeRemainingOnly && (resumePlan.execute.length !== 9
        || canonicalHash(resumePlan.execute) !== canonicalHash(REMAINING_FROZEN_PATH_IDS)
        || resumePlan.skipped.length !== 0)) {
        throw new Error('Frozen remaining-only resume plan changed');
    }
    if (!analyzeOnly) {
        if (fs.existsSync(marker)) throw new Error('Formal Protocol V2 evaluation already started in this work directory');
        fs.writeFileSync(marker, `${JSON.stringify({
            protocolVersion: 2,
            mode: resumeRemainingOnly ? 'remaining-only' : 'full',
            pathIds: resumePlan.execute,
            originalRecordsHash: firstSixHash,
        })}\n`, 'utf8');
        const nodeOptions = [String(process.env.NODE_OPTIONS || '').trim(), `--require=${preload}`].filter(Boolean).join(' ');
        const commonEnv = {
            ...process.env,
            AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata',
            AI_OBSERVABILITY_PROJECT: 'pump-ai-v5e4r-protocol-v2-shadow',
            AI_V5_SHADOW_ENABLED: 'true', AI_V5_SHADOW_SAMPLE_RATE: '1',
            AI_V5_INTERPRETER_TIMEOUT_MS: '20000', NODE_OPTIONS: nodeOptions,
        };
        const selectedCaseKeys = [...new Set(resumePlan.execute.map(pathId => mappingForPathId(pathId)?.caseKey))];
        if (selectedCaseKeys.some(caseKey => !caseKey)) throw new Error('Resume path has no frozen case mapping');
        executeRunnerCases(selectedCaseKeys, caseKey => {
            const selectedPathIds = resumePlan.execute.filter(pathId => mappingForPathId(pathId)?.caseKey === caseKey);
            if (selectedPathIds.length !== Object.keys(RUNTIME_SUFFIX).length) {
                throw new Error(`Runner case is not a complete frozen runtime group: ${caseKey}`);
            }
            const reportPath = path.join(reports, `${caseKey}.json`);
            runFrozenCase(process.execPath, [runner, `--case-key=${caseKey}`], {
                ...commonEnv,
                PUMP_P15_REPLAY_REPORT_PATH: reportPath,
                PUMP_P15_INTERPRETER_REPORT_PATH: path.join(interpretations, `${caseKey}.json`),
            }, reportPath);
            return caseKey;
        });
    }
    let dataset;
    if (resumeRemainingOnly) {
        const resumed = buildResumedInternalPaths(
            frozenCases,
            prior.readReports(reports),
            prior.readInterpretations(interpretations),
            resumePlan.execute
        );
        if (resumed.reduce((sum, item) => sum + item.model_calls, 0) > 9) {
            throw new Error('Resume exceeded V5 Interpreter call budget');
        }
        dataset = buildCompleteDataset({ partialDataset, resumedInternalPaths: resumed, allFrozenPathIds });
    } else {
        const base = prior.buildDataset(
            frozenCases,
            prior.readReports(reports),
            prior.readInterpretations(interpretations)
        );
        dataset = buildProtocolV2Dataset(base);
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
        status: 'completed', mode: resumeRemainingOnly ? 'remaining-only' : 'full',
        workDirectory: work, output: outputPath, metrics: dataset.metrics,
    })}\n`);
}

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error.name, message: error.message })}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    FROZEN_INTERPRETER_HASHES,
    REMAINING_FROZEN_PATH_IDS,
    buildCompleteDataset,
    buildProtocolV2Dataset,
    canonicalHash,
    executeRunnerCases,
    planResumePaths,
    runnerDisposition,
    verifyFrozenInterpreterHashes,
};
