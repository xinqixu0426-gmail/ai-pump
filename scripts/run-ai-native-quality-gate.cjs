'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
    QUALITY_STATUS,
    REQUIRED_NATIVE_QUALITY_CRITERIA,
    evaluateNativeQualityEvidence,
    ownerTrialReadiness,
} = require('../api/services/aiNativeQualityGate.cjs');
const { readAiNativeRolloutConfig } = require('../api/services/aiNativeRolloutPolicy.cjs');
const { ownerTrialCoverageReadiness } = require('../api/services/aiNativeOwnerTrialCoverage.cjs');
const dotenv = require('dotenv');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'logs', 'ai-native-quality-gate-latest.json');
/**
 * E1-E：`sourceDirty` 只应反映**源码/证据**是否被改动。
 * 依赖目录（node_modules，含 worktree 里的符号链接形态）与环境产物不是源码，
 * 不得让 rolloutSafety 因纯环境原因失败；真正的源码改动仍然必须 fail。
 */
const ENVIRONMENTAL_ARTIFACT_PATTERNS = Object.freeze([
    /^node_modules(?:\/|$)/u,
    /^apps\/[^/]+\/node_modules(?:\/|$)/u,
    /^logs(?:\/|$)/u,
    /^backups(?:\/|$)/u,
    /^\.env(?:\..*)?$/u,
    /^\.DS_Store$/u,
]);
function isEnvironmentalArtifact(relativePath) {
    return ENVIRONMENTAL_ARTIFACT_PATTERNS.some(pattern => pattern.test(String(relativePath)));
}
function sourceDirtyFromStatus(trackedStatus, untrackedPaths) {
    if (String(trackedStatus || '').trim()) return true;
    return (untrackedPaths || []).some(relativePath => !isEnvironmentalArtifact(relativePath));
}

/** `--env-file=<path>`：显式注入实时 provider 凭据，绝不复制、提交或打印。 */
function parseArguments(argv) {
    const args = { envFile: null };
    for (const entry of argv) {
        const match = /^--env-file=(.+)$/u.exec(entry);
        if (match) args.envFile = path.resolve(match[1]);
    }
    return args;
}

const tests = [
    'tests/aiNativeBaseline.test.cjs',
    'tests/aiTaskCapabilityAdapterV2Integration.test.cjs',
    'tests/aiTaskPersistenceV2R1.test.cjs',
    'tests/aiTaskWorkerV2.test.cjs',
    'tests/aiTaskWriteBridgeV2.test.cjs',
    'tests/commandExecution.test.cjs',
    'tests/aiNativeRolloutPolicy.test.cjs',
    'tests/aiNativeQualityGate.test.cjs',
];

function git(args) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
}
function run(command, args) {
    const startedAt = Date.now();
    const result = spawnSync(command, args, { cwd: root, env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' });
    return { status: result.status === 0 ? QUALITY_STATUS.PASS : QUALITY_STATUS.FAIL, durationMs: Date.now() - startedAt,
        stdoutHash: crypto.createHash('sha256').update(result.stdout || '').digest('hex'),
        stderrHash: crypto.createHash('sha256').update(result.stderr || '').digest('hex') };
}
function main() {
    const args = parseArguments(process.argv.slice(2));
    if (args.envFile) {
        if (!fs.existsSync(args.envFile)) throw new Error(`AI_NATIVE_GATE_ENV_FILE_MISSING ${args.envFile}`);
        dotenv.config({ path: args.envFile, quiet: true });
    }
    const sourceRevision = git(['rev-parse', 'HEAD']);
    const trackedStatus = git(['status', '--porcelain', '--untracked-files=no']) || '';
    const untrackedPaths = (git(['status', '--porcelain', '--untracked-files=all']) || '')
        .split('\n').filter(line => line.startsWith('?? ')).map(line => line.slice(3).trim());
    const sourceDirty = sourceDirtyFromStatus(trackedStatus, untrackedPaths);
    const focused = run(process.execPath, ['--test', ...tests]);
    const deepApi = run(process.execPath, ['scripts/run-deep-api-smoke.cjs']);
    const rollout = run(process.execPath, ['scripts/run-ai-native-rollout-live.cjs',
        ...(args.envFile ? [`--env-file=${args.envFile}`] : [])]);
    const criteria = Object.fromEntries(REQUIRED_NATIVE_QUALITY_CRITERIA.map(requirement => [requirement, {
        status: sourceDirty && requirement === 'rolloutSafety'
            ? QUALITY_STATUS.FAIL
            : requirement === 'deepApiDeterminism' ? deepApi.status
                : requirement === 'rolloutSafety' ? rollout.status : focused.status,
        evidence: requirement === 'deepApiDeterminism' ? 'scripts/run-deep-api-smoke.cjs'
            : requirement === 'rolloutSafety' ? 'scripts/run-ai-native-rollout-live.cjs'
                : 'native-focused-quality-suite',
    }]));
    const quality = evaluateNativeQualityEvidence({ sourceRevision, currentRevision: sourceRevision, criteria });
    const structuralReadiness = {
        status: quality.status === QUALITY_STATUS.PASS ? 'STRUCTURALLY_READY' : 'NOT_READY',
        ready: quality.status === QUALITY_STATUS.PASS,
        criteria: quality.checks.length,
        failed: quality.checks.filter(check => check.status !== QUALITY_STATUS.PASS).map(check => check.requirement),
    };
    const coverageReadiness = ownerTrialCoverageReadiness({ structuralReady: structuralReadiness.ready });
    const productionReadiness = {
        status: 'NOT_READY',
        reason: 'E1 阶段不部署、不做生产灰度；生产就绪需要独立授权与生产形状验收。',
    };
    const readiness = ownerTrialReadiness({
        config: readAiNativeRolloutConfig(process.env),
        quality,
        rollback: rollout.status,
        ownerAuth: focused.status,
        productionConfigUnchanged: true,
        regressions: { n4: focused.status, n5_1a: focused.status, n5_1b: focused.status, n5_2: focused.status, n6_1: focused.status, n6_2: focused.status },
    });
    const report = {
        version: 1,
        generatedAt: new Date().toISOString(),
        sourceRevision,
        sourceTree: git(['rev-parse', 'HEAD^{tree}']),
        sourceDirty,
        config: readAiNativeRolloutConfig(process.env),
        quality,
        readiness,
        // E1-E：把「结构就绪」与「覆盖范围内的 canary 就绪」分开，避免结构全绿被读成可以 canary。
        readinessBreakdown: {
            structuralReadiness,
            ownerTrialCoverageReadiness: coverageReadiness,
            productionReadiness,
        },
        ownerTrialCoverage: coverageReadiness.counts,
        envFileUsed: args.envFile ? path.basename(args.envFile) : null,
        commands: { focused, deepApi, rollout },
    };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify({
        status: quality.status,
        readiness: readiness.status,
        structuralReadiness: structuralReadiness.status,
        ownerTrialCoverageReadiness: coverageReadiness.status,
        productionReadiness: productionReadiness.status,
        canaryScope: coverageReadiness.canaryScope,
        sourceRevision,
        reportPath: path.relative(root, reportPath),
    }) + '\n');
    process.exitCode = quality.status === QUALITY_STATUS.PASS ? 0 : 1;
}
if (require.main === module) main();

module.exports = { isEnvironmentalArtifact, sourceDirtyFromStatus, parseArguments };
