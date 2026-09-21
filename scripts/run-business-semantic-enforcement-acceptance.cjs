'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildBusinessEvidencePlan } = require('../api/business-semantics/evidencePlanner.cjs');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'logs/business-semantic-enforcement-p2-acceptance.json');
const envFileArgument = process.argv.find(value => value.startsWith('--env-file='));
const phases = [
    { key: 'off', enforcement: 'false' },
    { key: 'on', enforcement: 'true' },
    { key: 'rollback', enforcement: 'false' },
];

function percentile(values, ratio) {
    const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function runPhase(phase) {
    const report = path.join(root, `logs/business-semantic-enforcement-p2-${phase.key}-raw.json`);
    const artifact = path.join(root, `logs/business-semantic-enforcement-p2-${phase.key}-summary.json`);
    const childArgs = ['scripts/run-business-understanding-benchmark.cjs', `--report=${report}`, `--artifact=${artifact}`];
    if (envFileArgument) childArgs.push(envFileArgument);
    const child = spawnSync(process.execPath, childArgs, {
        cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: phase.enforcement },
    });
    if (![0, 2].includes(child.status)) throw new Error(`${phase.key} benchmark failed: ${child.stderr || child.stdout}`);
    if (!fs.existsSync(report)) throw new Error(`${phase.key} report missing`);
    const data = JSON.parse(fs.readFileSync(report, 'utf8'));
    const latencies = data.executions.map(item => item.actual?.elapsedMs);
    const providerCalls = data.executions.reduce((sum, item) => sum + Number(item.actual?.metrics?.modelRequestCount || 0), 0);
    const toolResults = data.executions.flatMap(item => item.actual?.toolResults || []);
    return { ...phase, report, counts: data.counts, criticalFailures: data.criticalFailures,
        dimensions: data.dimensionResults, hashes: { caseHash: data.caseHash, fixtureHash: data.fixtureHash, oracleHash: data.oracleHash },
        actualProviders: data.actualProviders, model: data.model, fallbackCount: data.fallbackCount,
        providerCalls, latency: { medianMs: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95) },
        plannedReads: toolResults.filter(item => item.planningSource === 'BUSINESS_SEMANTIC_EVIDENCE_PLAN').length,
        writes: toolResults.filter(item => /^(?:create|update|delete|adjust|execute|save)_/.test(item.name)).length,
        scaleSentinel: data.scaleSentinel, executions: data.executions };
}

function semanticPayloadBounds(onPhase) {
    let maxPlanBytes = 0, maxFrameBytes = 0;
    for (const execution of onPhase.executions) {
        const userText = require('../tests/fixtures/business-understanding-benchmark-v1.json').coreCases
            .find(item => item.caseKey === execution.caseKey)?.question || '';
        const toolResults = execution.actual?.toolResults || [];
        const plan = buildBusinessEvidencePlan({ userText, toolResults, plannedCallCount: Math.min(3,
            toolResults.filter(item => item.planningSource === 'BUSINESS_SEMANTIC_EVIDENCE_PLAN').length) });
        const frame = buildBusinessSemanticFrame({ userText, toolResults, stage: 'POST_EVIDENCE' });
        if (plan) maxPlanBytes = Math.max(maxPlanBytes, Buffer.byteLength(JSON.stringify(plan)));
        maxFrameBytes = Math.max(maxFrameBytes, Buffer.byteLength(JSON.stringify(frame)));
    }
    return { maxPlanBytes, maxFrameBytes };
}

const results = phases.map(runPhase);
const [off, on, rollback] = results;
const bounds = semanticPayloadBounds(on);
const providerCallDelta = on.providerCalls - off.providerCalls;
const summary = { version: 1, generatedAt: new Date().toISOString(), phases: results.map(({ executions: _executions, ...item }) => item),
    providerCallDelta, payloadBounds: bounds,
    latencyRegressionOver2x: off.latency.medianMs > 0 && on.latency.medianMs > off.latency.medianMs * 2,
    rollbackOutcomeMatchesOff: JSON.stringify(rollback.counts) === JSON.stringify(off.counts)
        && rollback.criticalFailures === off.criticalFailures,
    runtimeOffRollback: off.plannedReads === 0 && rollback.plannedReads === 0
        && JSON.stringify(off.hashes) === JSON.stringify(rollback.hashes),
    pass: on.counts.PASS === 20 && on.counts.PARTIAL === 0 && on.counts.FAIL === 0 && on.counts.BLOCKED === 0
        && on.criticalFailures === 0 && providerCallDelta === 0 && on.writes === 0,
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ output, ...summary, phases: summary.phases.map(item => ({ key: item.key, counts: item.counts,
    criticalFailures: item.criticalFailures, providerCalls: item.providerCalls, plannedReads: item.plannedReads, latency: item.latency })) }, null, 2));
if (!summary.pass) process.exitCode = 2;
