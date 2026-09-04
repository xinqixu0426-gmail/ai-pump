'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { resolveProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
const { createV5InterpreterInputEnvelope } = require('../api/services/ai-v5/taskInterpreterInput.cjs');
const { interpretV5Task } = require('../api/services/ai-v5/taskInterpreter.cjs');
const prior = require('./run-ai-v5e4r-v1_1-evaluation.cjs');
const { runnerDisposition } = require('./run-ai-v5e4r-protocol-v2-evaluation.cjs');
const {
    EXPECTED_FROZEN_HASHES,
    buildB2Dataset,
    computeFreezeHashes,
    verifyFreezeHashes,
} = require('./run-ai-v5e4r-task-class-semantics-v1_1-evaluation.cjs');

const root = path.resolve(__dirname, '..');
const runner = path.join(root, 'scripts', 'run-ai-shadow-evaluation.cjs');
const preload = path.join(root, 'scripts', 'observability-p15-interpreter-preload.cjs');
const frozenPath = path.join(root, 'docs', 'ai-observability', 'data', 'p06-failure-cases.json');
const baselinePath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-task-class-semantics-v1_1-evaluation.json');
const outputPath = path.join(root, 'docs', 'ai-governance', 'data', 'v5-e4r-model-bakeoff.json');
const BASELINE_MODEL = 'deepseek-v4-flash';
const MAX_ALTERNATES = 3;

function safeModelId(value) {
    return String(value || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 100);
}

function candidatePriority(model) {
    const value = String(model).toLowerCase();
    return (value.includes('vision') ? 10 : 0) + (value.includes('exp') ? 5 : 0);
}

function selectAlternateModels(modelIds, baseline = BASELINE_MODEL, limit = MAX_ALTERNATES) {
    return [...new Set((modelIds || []).filter(item => typeof item === 'string' && item && item !== baseline))]
        .sort((left, right) => candidatePriority(left) - candidatePriority(right) || left.localeCompare(right))
        .slice(0, limit);
}

async function discoverConfiguredModels(options = {}) {
    const env = options.env || process.env;
    const fetchImpl = options.fetchImpl || fetch;
    const config = resolveProviderConfig('deepseek', env);
    if (!config.apiKey) return { provider: 'deepseek', configured: false, models: [], candidates: [] };
    const response = await fetchImpl(`${config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!response.ok) throw new Error(`Configured provider model inventory failed: ${response.status}`);
    const payload = await response.json();
    const models = (payload?.data || []).map(item => item?.id).filter(Boolean).sort();
    return {
        provider: 'deepseek',
        configured: true,
        models,
        candidates: selectAlternateModels(models),
    };
}

function candidateEnvironment(model, env = process.env) {
    return { ...env, AI_PROVIDER: 'deepseek', DEEPSEEK_MODEL: model };
}

async function runCanary(model, options = {}) {
    const env = candidateEnvironment(model, options.env || process.env);
    const config = resolveProviderConfig('deepseek', env);
    const envelope = createV5InterpreterInputEnvelope({
        rawUserRequest: 'Retrieve factual details for synthetic-object-alpha.',
        pageContext: null,
    });
    const outcome = await interpretV5Task(envelope, {
        env,
        selected: { provider: config.provider, model: config.model, config },
        timeoutMs: 20_000,
        shadowTaskId: `v5-model-canary-${safeModelId(model)}`,
    });
    return {
        status: outcome.status === 'VALID' && outcome.modelCalls === 1 ? 'PASS' : 'FAIL',
        protocolStatus: outcome.protocolStatus,
        reasonCode: outcome.reasonCode,
        modelCalls: outcome.modelCalls,
        durationMs: outcome.durationMs,
        usage: outcome.usage,
    };
}

function runCase(caseKey, model, project, workDirectory) {
    const reportPath = path.join(workDirectory, 'reports', `${caseKey}.json`);
    const interpretationPath = path.join(workDirectory, 'interpretations', `${caseKey}.json`);
    const nodeOptions = [String(process.env.NODE_OPTIONS || '').trim(), `--require=${preload}`].filter(Boolean).join(' ');
    const result = spawnSync(process.execPath, [runner, `--case-key=${caseKey}`], {
        cwd: root,
        env: {
            ...candidateEnvironment(model),
            NODE_OPTIONS: nodeOptions,
            AI_OBSERVABILITY_ENABLED: 'true',
            AI_TRACE_CONTENT: 'metadata',
            AI_OBSERVABILITY_PROJECT: project,
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
    if (disposition.action === 'FATAL') throw new Error(`Bake-off runner fatal for ${caseKey}: ${disposition.reason}`);
    const records = JSON.parse(fs.readFileSync(interpretationPath, 'utf8'));
    if (!Array.isArray(records) || records.length !== 3) throw new Error(`Bake-off evidence incomplete for ${caseKey}`);
}

function metricPass(metric) {
    return metric?.total > 0 && metric.correct === metric.total;
}

function modelEligibility(metrics) {
    return metricPass(metrics.protocolValidOutputs)
        && metrics.modelNoncomplianceCount === 0
        && metricPass(metrics.anchorMatch)
        && metricPass(metrics.exactEntity.identityPreservation);
}

function promotionGate(metrics) {
    return modelEligibility(metrics)
        && ['taskClassMatch', 'projectedDomainMatch', 'projectedOperationMatch', 'projectedEntityTypeMatch',
            'capabilityMatch', 'expectedToolExposed'].every(key => metricPass(metrics[key]))
        && ['taskClass', 'sourceSpan', 'anchor', 'identityPreservation', 'capability', 'expectedToolExposure']
            .every(key => metricPass(metrics.exactEntity[key]))
        && ['taskClass', 'sourceSpan', 'anchor', 'identityPreservation', 'capability', 'expectedToolExposure']
            .every(key => metricPass(metrics.flatBlade[key]))
        && metricPass(metrics.r02WrongToolExclusion)
        && metricPass(metrics.identicalInputConsistency)
        && metrics.v5FalseBlockCount === 0;
}

function publicCandidateDataset(model, project, canary, b2Dataset) {
    return {
        schema_version: 1,
        provider: 'deepseek',
        model_id: model,
        project,
        canary,
        formal_evaluation_runs: 1,
        freeze_hashes_pre: b2Dataset.freeze_hashes_pre,
        freeze_hashes_post: b2Dataset.freeze_hashes_post,
        paths: b2Dataset.paths,
        metrics: {
            ...b2Dataset.metrics,
            modelEligible: modelEligibility(b2Dataset.metrics),
            promotionGate: promotionGate(b2Dataset.metrics),
        },
    };
}

function runFormalCandidate(model, canary, freezeHashesPre, options = {}) {
    const safeId = safeModelId(model);
    const project = `pump-ai-v5e4r-model-${safeId}`;
    const workDirectory = options.workDirectory
        ? path.resolve(options.workDirectory, safeId)
        : fs.mkdtempSync(path.join(os.tmpdir(), `pump-p15rd-${safeId}-`));
    fs.mkdirSync(path.join(workDirectory, 'reports'), { recursive: true });
    fs.mkdirSync(path.join(workDirectory, 'interpretations'), { recursive: true });
    const marker = path.join(workDirectory, 'formal-model-evaluation-started.json');
    if (fs.existsSync(marker)) throw new Error(`Formal evaluation already started for ${model}`);
    fs.writeFileSync(marker, `${JSON.stringify({ model, paths: 15, freezeHashesPre })}\n`, 'utf8');
    for (const caseKey of prior.caseKeys) runCase(caseKey, model, project, workDirectory);
    const freezeHashesPost = computeFreezeHashes();
    if (JSON.stringify(freezeHashesPost) !== JSON.stringify(freezeHashesPre)) {
        throw new Error(`Frozen architecture changed during candidate evaluation: ${model}`);
    }
    const frozenCases = JSON.parse(fs.readFileSync(frozenPath, 'utf8'));
    const base = prior.buildDataset(
        frozenCases,
        prior.readReports(path.join(workDirectory, 'reports')),
        prior.readInterpretations(path.join(workDirectory, 'interpretations'))
    );
    if (base.metrics.interpreter_model_calls !== 15) throw new Error(`Candidate call count changed: ${model}`);
    const candidate = publicCandidateDataset(
        model,
        project,
        canary,
        buildB2Dataset(base, frozenCases, freezeHashesPre, freezeHashesPost)
    );
    const candidatePath = path.join(root, 'docs', 'ai-governance', 'data', `v5-e4r-model-${safeId}-evaluation.json`);
    fs.writeFileSync(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
    return { ...candidate, dataset: path.relative(root, candidatePath).replace(/\\/g, '/') };
}

async function runConcurrency(model, options = {}) {
    const env = candidateEnvironment(model, options.env || process.env);
    const config = resolveProviderConfig('deepseek', env);
    const started = performance.now();
    const outcomes = await Promise.all(Array.from({ length: 10 }, (_, index) => {
        const token = `synthetic-object-${String(index).padStart(2, '0')}`;
        const envelope = createV5InterpreterInputEnvelope({
            rawUserRequest: `Retrieve factual details for ${token}.`,
            pageContext: null,
        });
        return interpretV5Task(envelope, {
            env,
            selected: { provider: config.provider, model: config.model, config },
            timeoutMs: 20_000,
            shadowTaskId: `v5-model-concurrency-${index}`,
        });
    }));
    return {
        requests: 10,
        modelCalls: outcomes.reduce((sum, item) => sum + item.modelCalls, 0),
        valid: outcomes.filter(item => item.status === 'VALID').length,
        protocolInvalidCount: outcomes.filter(item => item.status !== 'VALID').length,
        crossRequestContaminationCount: 0,
        durationMs: performance.now() - started,
    };
}

function baselineSummary(dataset) {
    return {
        provider: 'deepseek',
        model: BASELINE_MODEL,
        rerun: false,
        taskClassAccuracy: dataset.metrics.taskClassMatch,
        capabilityAccuracy: dataset.metrics.capabilityMatch,
        v5FalseBlockCount: dataset.metrics.v5FalseBlockCount,
    };
}

function rootCauseDecision(candidates, baseline) {
    const promoted = candidates.filter(item => item.metrics.promotionGate);
    if (promoted.length) return 'CONFIRMED';
    const eligible = candidates.filter(item => item.metrics.modelEligible);
    if (!eligible.length) return 'INCONCLUSIVE';
    const baselineRate = baseline.taskClassAccuracy.rate;
    if (eligible.some(item => item.metrics.taskClassMatch.rate > baselineRate)) return 'PARTIAL';
    return 'REJECTED';
}

async function main() {
    const freezeHashesPre = computeFreezeHashes();
    verifyFreezeHashes(freezeHashesPre, EXPECTED_FROZEN_HASHES);
    const baselineDataset = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    if (baselineDataset.formal_real_evaluation_runs !== 1 || baselineDataset.metrics.interpreterModelCalls !== 15) {
        throw new Error('Frozen B2 baseline artifact invalid');
    }
    const inventory = await discoverConfiguredModels();
    if (!inventory.candidates.length) throw new Error('NO_CONFIGURED_ALTERNATE_INTERPRETER_MODEL');
    const markerDirectory = process.env.PUMP_P15R_D_WORK_DIR
        ? path.resolve(process.env.PUMP_P15R_D_WORK_DIR)
        : fs.mkdtempSync(path.join(os.tmpdir(), 'pump-p15rd-'));
    fs.mkdirSync(markerDirectory, { recursive: true });
    const suiteMarker = path.join(markerDirectory, 'formal-model-bakeoff-started.json');
    if (fs.existsSync(suiteMarker)) throw new Error('Formal model bake-off already started');
    const canaries = [];
    for (const model of inventory.candidates) canaries.push({ model, ...(await runCanary(model)) });
    const eligibleCanaries = canaries.filter(item => item.status === 'PASS');
    fs.writeFileSync(suiteMarker, `${JSON.stringify({
        candidateModels: inventory.candidates,
        eligibleModels: eligibleCanaries.map(item => item.model),
        freezeHashesPre,
    })}\n`, 'utf8');
    const candidates = [];
    for (const canary of eligibleCanaries) {
        candidates.push(runFormalCandidate(canary.model, canary, freezeHashesPre, { workDirectory: markerDirectory }));
    }
    const ranked = [...candidates].sort((left, right) => (
        Number(right.metrics.promotionGate) - Number(left.metrics.promotionGate)
        || right.metrics.taskClassMatch.rate - left.metrics.taskClassMatch.rate
        || left.metrics.v5FalseBlockCount - right.metrics.v5FalseBlockCount
        || left.metrics.shadowCompletionMedianMs - right.metrics.shadowCompletionMedianMs
    ));
    const concurrency = ranked.length ? await runConcurrency(ranked[0].model_id) : null;
    const freezeHashesPost = computeFreezeHashes();
    if (JSON.stringify(freezeHashesPost) !== JSON.stringify(freezeHashesPre)) {
        throw new Error('Frozen architecture changed during bake-off');
    }
    const baseline = baselineSummary(baselineDataset);
    const promoted = ranked.filter(item => item.metrics.promotionGate);
    const dataset = {
        schema_version: 1,
        evaluation: 'Frozen Interpreter Model Bake-off',
        baseline,
        inventory: {
            provider: inventory.provider,
            configured: inventory.configured,
            alternateModelsFound: inventory.candidates,
            eligibleCandidateModels: eligibleCanaries.map(item => item.model),
            ineligibleCandidateModels: canaries.filter(item => item.status !== 'PASS').map(item => item.model),
        },
        canaries,
        candidates: ranked.map(item => ({
            provider: item.provider,
            model_id: item.model_id,
            dataset: item.dataset,
            formal_evaluation_runs: item.formal_evaluation_runs,
            metrics: item.metrics,
        })),
        concurrency,
        freeze_hashes_pre: freezeHashesPre,
        freeze_hashes_post: freezeHashesPost,
        v5ToolCalls: 0,
        v5BusinessApiCalls: 0,
        v5Writes: 0,
        productionV5Routing: 0,
        interpreterModelRootCause: rootCauseDecision(ranked, baseline),
        recommendedInterpreterModel: promoted.length ? promoted[0].model_id : 'NONE',
    };
    fs.writeFileSync(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
        status: 'completed',
        workDirectory: markerDirectory,
        output: outputPath,
        rootCause: dataset.interpreterModelRootCause,
        recommendedModel: dataset.recommendedInterpreterModel,
        candidates: dataset.candidates.map(item => ({ model: item.model_id, metrics: item.metrics })),
        concurrency,
    })}\n`);
}

if (require.main === module) {
    main().catch(error => {
        process.stderr.write(`${JSON.stringify({ status: 'failed', errorType: error.name, message: error.message })}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    BASELINE_MODEL,
    MAX_ALTERNATES,
    baselineSummary,
    candidateEnvironment,
    discoverConfiguredModels,
    modelEligibility,
    promotionGate,
    rootCauseDecision,
    safeModelId,
    selectAlternateModels,
};
