'use strict';

require('dotenv').config({ quiet: true });

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildToolCapabilityReverseIndex, getV5Capability } = require('../api/services/ai-v5/capabilityRegistry.cjs');
const {
    V5_TASK_CLASS_CATALOG,
    V5_TASK_CLASS_SEMANTICS_VERSION,
    taskClassModelView,
} = require('../api/services/ai-v5/taskClassCatalog.cjs');
const {
    V5_INTERPRETER_MODEL_SETTINGS,
    V5_TASK_INTERPRETER_INSTRUCTION,
} = require('../api/services/ai-v5/taskInterpreter.cjs');
const prior = require('./run-ai-v5e4r-v1_1-evaluation.cjs');
const { runnerDisposition } = require('./run-ai-v5e4r-protocol-v2-evaluation.cjs');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts', 'run-ai-shadow-evaluation.cjs');
const preload = path.join(root, 'scripts', 'observability-p15-interpreter-preload.cjs');
const frozenPath = path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json');
const outputPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-task-class-semantics-v1_1-evaluation.json');
const EVALUATION_VARIANT = 'Protocol-V2 + Task-Class-Semantics-1.1';
const PROJECT = 'pump-ai-v5e4r-task-class-semantics-v1-1';
const RUNTIME_SUFFIX = Object.freeze({ legacy_v3: 'LEGACY', v4_investigation: 'V4I', v4_r3: 'V4R3' });

const EXPECTED_FROZEN_HASHES = Object.freeze({
    prompt: '24b2f09d94e86960e328d5aa63ac66e3439f4f9a39152a9c6564adf555b585d3',
    sourceSpan: '00b1331e6e8c3ffc8985fb268b861dcbb066d3e409aeda43f1ceef43f3821fd8',
    protocolV2: 'da3a2c98858d16fd6ebe9008d7cd933a1bf1d5266ea876289fa33ae9d81e20ad',
    modelSettings: '2c6f611d49134afc68ffbd67c834eb37622084b0cb25f916b0e9399c6ad38398',
    inputEnvelope: 'a368a4b92b218b826ff3a4351fce9cc631439244986e6122af05cec394fa7ded',
    sourceAnchor: 'f31564536b806fd3f3261f4d19d7fd3623726a967204379fc5e633154107a339',
    capabilityRegistry: 'c2e9c428c348866d4417a5934d7ec9d36b2d8b85cf147d95e299da8b80b8fc40',
    capabilityRouter: '9a13f47414a306a11e62015865162f82098c434a85c1cd17aaa2e026ee7fce55',
    toolExposure: 'd4f4ce7caa7c12172b42375350d66843f4337e86b9484f360dc9c42e5850e2e4',
    classIdentity: '0149514aca7bbca5124ad069d6925e113209cb8c85f7f82cc7e9840d3b18ef02',
    frozenCorpus: '315a21d96fdd84f0ecb253772ae942b2cbbfd56842c2a8858e378693f444d4df',
    frozenExpected: '6980ffb284a8d82543cb1337dbe4cc9ff70ee5ab3aec59438daf0f39f8ee5590',
    taskClassSemantics: 'c120fc465004c0424260cf04fdac4d58ef489439fc51264f49e50d53de5121f1',
});

function hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function fileHash(relativePath) {
    return hash(fs.readFileSync(path.join(root, relativePath)));
}

function classIdentitySnapshot() {
    return V5_TASK_CLASS_CATALOG.map(item => ({
        classRef: item.classRef,
        domain: item.domain,
        operation: item.operation,
        entityTypes: item.entityTypes,
    }));
}

function computeFreezeHashes() {
    const frozenCases = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
    return Object.freeze({
        prompt: hash(V5_TASK_INTERPRETER_INSTRUCTION),
        taskClassSemantics: hash(JSON.stringify(V5_TASK_CLASS_CATALOG)),
        sourceSpan: fileHash('api/services/ai-v5/sourceSpanCatalog.cjs'),
        protocolV2: fileHash('api/services/ai-v5/taskInterpreterProtocolV2.cjs'),
        modelSettings: hash(JSON.stringify(V5_INTERPRETER_MODEL_SETTINGS)),
        inputEnvelope: fileHash('api/services/ai-v5/taskInterpreterInput.cjs'),
        sourceAnchor: fileHash('api/services/ai-v5/sourceAnchoredEntity.cjs'),
        capabilityRegistry: fileHash('api/services/ai-v5/capabilityRegistry.cjs'),
        capabilityRouter: fileHash('api/services/ai-v5/capabilityRouter.cjs'),
        toolExposure: fileHash('api/services/ai-v5/toolExposure.cjs'),
        classIdentity: hash(JSON.stringify(classIdentitySnapshot())),
        frozenCorpus: hash(JSON.stringify(frozenCases)),
        frozenExpected: hash(JSON.stringify(frozenCases.map(item => ({ id: item.case_id, expected: item.expected })))),
    });
}

function verifyFreezeHashes(actual, expected = EXPECTED_FROZEN_HASHES) {
    for (const [key, value] of Object.entries(expected)) {
        if (actual[key] !== value) throw new Error(`B2 frozen surface changed: ${key}`);
    }
    if (actual.taskClassSemantics === 'c298bcf127030602b5f82cdcc8aed61554a789aacc1b082ade70eed1ca5d0ef9') {
        throw new Error('Task Class semantics did not change from Protocol V2 baseline');
    }
    return true;
}

function ratio(correct, total) {
    return Object.freeze({ correct, total, rate: total ? correct / total : null });
}

function expectedTaskClass(expected) {
    const capability = getV5Capability(expected.capability);
    return capability ? V5_TASK_CLASS_CATALOG.find(item => item.domain === capability.domain
        && item.operation === capability.operation
        && JSON.stringify(item.entityTypes) === JSON.stringify([...capability.requiredEntityTypes].sort())) || null : null;
}

function booleanMetric(paths, key) {
    return ratio(paths.filter(item => item[key] === true).length, paths.length);
}

function strictGroupMetric(paths, groupKey, key) {
    const groups = [...new Set(paths.map(item => item[groupKey]))];
    return ratio(groups.filter(group => paths.filter(item => item[groupKey] === group)
        .every(item => item[key] === true)).length, groups.length);
}

function buildB2Dataset(base, frozenCases, freezeHashesPre, freezeHashesPost) {
    if (base.paths.length !== 15 || base.metrics.source_groups !== 5 || base.metrics.input_fingerprints !== 4) {
        throw new Error('B2 frozen evaluation corpus changed');
    }
    const frozen = new Map(frozenCases.map(item => [item.case_id, item]));
    const paths = base.paths.map(item => {
        const expectedClass = expectedTaskClass(item.expected);
        if (!expectedClass) throw new Error(`Expected task class unavailable: ${item.case_id}`);
        const protocolValid = item.actual.protocolStatus === 'VALID';
        const sourceSpanMatch = protocolValid && item.match.anchor
            && item.actual.sourceSpanRefs.length === item.expected.entity_types.length;
        const authority = frozen.get(item.case_id);
        const oracleTools = new Set(authority.expected.allowed_tools || [authority.expected.primary_tool]);
        const frozenWrongTools = (authority.safe_structural_metadata?.tools || []).filter(tool => !oracleTools.has(tool));
        const frozenWrongToolExcluded = frozenWrongTools.length > 0
            && frozenWrongTools.every(tool => !item.actual.allowedToolNames.includes(tool));
        return Object.freeze({
            caseId: item.case_id,
            sourceGroupId: item.source_group_id,
            inputFingerprint: item.input_fingerprint,
            protocolValid,
            taskClassMatch: protocolValid && item.actual.taskClassRef === expectedClass.classRef,
            projectedDomainMatch: item.match.domain,
            projectedOperationMatch: item.match.operation,
            projectedEntityTypeMatch: item.match.entity_type,
            sourceSpanMatch,
            anchorMatch: item.match.anchor,
            capabilityMatch: item.match.capability,
            expectedToolExposed: item.match.expected_tool_exposed,
            r02: authority.failure_class === 'R02',
            frozenWrongToolExcluded,
            v4ComparisonIncomparable: item.v4_result === 'UNAVAILABLE',
            overallComparison: item.overall_comparison,
            safeReasonCodes: item.safe_reason_codes,
            traceId: item.trace_id,
            shadowTaskId: item.shadow_task_id,
            signature: JSON.stringify({
                protocolStatus: item.actual.protocolStatus,
                taskClassRef: item.actual.taskClassRef,
                sourceSpanRefs: item.actual.sourceSpanRefs,
                domain: item.actual.domain,
                operation: item.actual.operation,
                entityTypes: item.actual.entityTypes,
                capabilityId: item.actual.capabilityId,
            }),
        });
    });
    const publicPaths = paths.map(item => Object.freeze({
        case_id: item.caseId,
        source_group_id: item.sourceGroupId,
        input_fingerprint: item.inputFingerprint,
        protocol_status: item.protocolValid ? 'VALID' : 'INVALID',
        task_class_match: item.taskClassMatch,
        projected_domain_match: item.projectedDomainMatch,
        projected_operation_match: item.projectedOperationMatch,
        projected_entity_type_match: item.projectedEntityTypeMatch,
        source_span_selection_status: item.sourceSpanMatch ? 'MATCH' : 'MISMATCH',
        anchor_status: item.anchorMatch ? 'ANCHORED' : 'NOT_ANCHORED',
        capability_match: item.capabilityMatch,
        expected_tool_exposed: item.expectedToolExposed,
        wrong_tool_excluded: item.r02 ? item.frozenWrongToolExcluded : null,
        v4_comparison_status: item.v4ComparisonIncomparable ? 'INCOMPARABLE' : 'COMPARABLE',
        overall_comparison: item.overallComparison,
        safe_reason_codes: item.safeReasonCodes,
        trace_id: item.traceId,
        shadow_task_id: item.shadowTaskId,
    }));
    const fingerprints = [...new Set(paths.map(item => item.inputFingerprint))];
    const exact = paths.filter(item => item.caseId.startsWith('P06-EXACT-001'));
    const flat = paths.filter(item => item.caseId.startsWith('P06-FLATBLADE-001'));
    const coil = paths.filter(item => item.caseId.startsWith('P06-COIL-001'));
    const r02 = paths.filter(item => item.r02);
    const metricKeys = [
        'taskClassMatch', 'projectedDomainMatch', 'projectedOperationMatch',
        'projectedEntityTypeMatch', 'sourceSpanMatch', 'anchorMatch',
        'capabilityMatch', 'expectedToolExposed',
    ];
    const metrics = Object.fromEntries(metricKeys.map(key => [key, booleanMetric(paths, key)]));
    const groupMetrics = Object.fromEntries(metricKeys.map(key => [key, strictGroupMetric(paths, 'sourceGroupId', key)]));
    const fingerprintMetrics = Object.fromEntries(metricKeys.map(key => [key, strictGroupMetric(paths, 'inputFingerprint', key)]));
    const specialMetrics = selected => Object.freeze({
        cases: selected.length,
        taskClass: booleanMetric(selected, 'taskClassMatch'),
        sourceSpan: booleanMetric(selected, 'sourceSpanMatch'),
        anchor: booleanMetric(selected, 'anchorMatch'),
        identityPreservation: ratio(selected.filter(item => item.sourceSpanMatch && item.anchorMatch).length, selected.length),
        capability: booleanMetric(selected, 'capabilityMatch'),
        expectedToolExposure: booleanMetric(selected, 'expectedToolExposed'),
    });
    return Object.freeze({
        schema_version: 1,
        evaluation_variant: EVALUATION_VARIANT,
        external_contract_version: 1,
        internal_protocol_version: 2,
        prompt_version: 2,
        task_class_catalog_version: 1,
        task_class_semantics_version: V5_TASK_CLASS_SEMANTICS_VERSION,
        project: PROJECT,
        formal_real_evaluation_runs: 1,
        frozen_paths_total: 15,
        freeze_hashes_pre: freezeHashesPre,
        freeze_hashes_post: freezeHashesPost,
        paths: Object.freeze(publicPaths),
        metrics: Object.freeze({
            realPathsAttempted: 15,
            realPathsRecorded: paths.length,
            interpreterModelCalls: base.metrics.interpreter_model_calls,
            protocolValidOutputs: ratio(paths.filter(item => item.protocolValid).length, paths.length),
            protocolInvalidOutputs: paths.filter(item => !item.protocolValid).length,
            modelNoncomplianceCount: paths.filter(item => !item.protocolValid
                && item.safeReasonCodes.some(code => /JSON|SCHEMA|TASK_CLASS_REF|SPAN_REF|EXTRA_FIELD/.test(code))).length,
            ...metrics,
            sourceGroupMetrics: Object.freeze(groupMetrics),
            inputFingerprintMetrics: Object.freeze(fingerprintMetrics),
            identicalInputConsistency: ratio(fingerprints.filter(fingerprint => new Set(paths
                .filter(item => item.inputFingerprint === fingerprint).map(item => item.signature)).size === 1).length, fingerprints.length),
            coilRead: specialMetrics(coil),
            exactEntity: Object.freeze({
                ...specialMetrics(exact),
                v4ComparisonIncomparable: exact.filter(item => item.v4ComparisonIncomparable).length,
            }),
            flatBlade: specialMetrics(flat),
            r02Cases: r02.length,
            r02WrongToolExclusion: ratio(r02.filter(item => item.frozenWrongToolExcluded).length, r02.length),
            v5FalseBlockCount: paths.filter(item => item.overallComparison === 'V5_FALSE_BLOCK').length,
            v5BlocksV4FailureCount: paths.filter(item => item.overallComparison === 'V5_BLOCKS_V4_FAILURE').length,
            v5InsufficientDataCount: paths.filter(item => item.overallComparison === 'V5_INSUFFICIENT_DATA').length,
            notComparableV4ComparisonCount: paths.filter(item => item.v4ComparisonIncomparable).length,
            tokenUsage: base.metrics.token_usage,
            shadowCompletionMedianMs: base.metrics.shadow_completion_median_ms,
            shadowCompletionP95Ms: base.metrics.shadow_completion_p95_ms,
            v5ToolCalls: 0,
            v5BusinessApiCalls: 0,
            v5Writes: 0,
        }),
    });
}

function runCase(caseKey, workDirectory) {
    const reportPath = path.join(workDirectory, 'reports', `${caseKey}.json`);
    const interpretationPath = path.join(workDirectory, 'interpretations', `${caseKey}.json`);
    const nodeOptions = [String(process.env.NODE_OPTIONS || '').trim(), `--require=${preload}`].filter(Boolean).join(' ');
    const result = spawnSync(process.execPath, [runner, `--case-key=${caseKey}`], {
        cwd: root,
        env: {
            ...process.env,
            NODE_OPTIONS: nodeOptions,
            AI_OBSERVABILITY_ENABLED: 'true',
            AI_TRACE_CONTENT: 'metadata',
            AI_OBSERVABILITY_PROJECT: PROJECT,
            AI_V5_SHADOW_ENABLED: 'true',
            AI_V5_SHADOW_SAMPLE_RATE: '1',
            AI_V5_INTERPRETER_TIMEOUT_MS: '20000',
            PUMP_P15_INTERPRETER_BEFORE_V4: 'true',
            PUMP_P15_REPLAY_REPORT_PATH: reportPath,
            PUMP_P15_INTERPRETER_REPORT_PATH: interpretationPath,
        },
        stdio: 'inherit',
    });
    let report = null;
    try { report = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch { /* fatal below */ }
    const disposition = runnerDisposition(result, report);
    if (disposition.action === 'FATAL') throw new Error(`B2 runner fatal for ${caseKey}: ${disposition.reason}`);
    const records = JSON.parse(fs.readFileSync(interpretationPath, 'utf8'));
    if (!Array.isArray(records) || records.length !== 3) throw new Error(`B2 Interpreter evidence incomplete for ${caseKey}`);
    return disposition;
}

function main() {
    if (!process.env.DEEPSEEK_API_KEY) throw new Error('Configured real provider is unavailable');
    const hashesPre = computeFreezeHashes();
    verifyFreezeHashes(hashesPre);
    const workDirectory = process.env.PUMP_P15R_C_B2_WORK_DIR
        ? path.resolve(process.env.PUMP_P15R_C_B2_WORK_DIR)
        : fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p15rc-b2-'));
    fs.mkdirSync(path.join(workDirectory, 'reports'), { recursive: true });
    fs.mkdirSync(path.join(workDirectory, 'interpretations'), { recursive: true });
    const marker = path.join(workDirectory, 'formal-b2-evaluation-started.json');
    if (fs.existsSync(marker)) throw new Error('Formal B2 evaluation already started in this work directory');
    fs.writeFileSync(marker, `${JSON.stringify({
        evaluationVariant: EVALUATION_VARIANT,
        paths: 15,
        preEvalHashes: hashesPre,
    })}\n`, 'utf8');
    for (const caseKey of prior.caseKeys) runCase(caseKey, workDirectory);
    const hashesPost = computeFreezeHashes();
    if (JSON.stringify(hashesPost) !== JSON.stringify(hashesPre)) throw new Error('B2 pre/post implementation hashes changed');
    const frozenCases = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
    const base = prior.buildDataset(
        frozenCases,
        prior.readReports(path.join(workDirectory, 'reports')),
        prior.readInterpretations(path.join(workDirectory, 'interpretations'))
    );
    if (base.metrics.interpreter_model_calls !== 15) throw new Error(`B2 Interpreter call count changed: ${base.metrics.interpreter_model_calls}`);
    const dataset = buildB2Dataset(base, frozenCases, hashesPre, hashesPost);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
        status: 'completed', workDirectory, output: outputPath, metrics: dataset.metrics,
    })}\n`);
}

if (require.main === module) {
    try { main(); } catch (error) {
        process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error.name, message: error.message })}\n`);
        process.exitCode = 1;
    }
}

module.exports = {
    EVALUATION_VARIANT,
    EXPECTED_FROZEN_HASHES,
    buildB2Dataset,
    classIdentitySnapshot,
    computeFreezeHashes,
    verifyFreezeHashes,
};
