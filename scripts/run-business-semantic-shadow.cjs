'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { createBusinessUnderstandingFixture, runFixtureSelfChecks } = require('../tests/helpers/businessUnderstandingFixture.cjs');
const { definitionHashes, readDefinition } = require('../tests/helpers/businessUnderstandingOracle.cjs');
const { projectCriticalFailure } = require('../api/business-semantics/answerProjection.cjs');
const { BusinessSemanticFrameV1 } = require('../api/business-semantics/contract.cjs');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');
const { semanticCaseFixtures } = require('../tests/helpers/businessSemanticFrameFixture.cjs');

const root = path.resolve(__dirname, '..');
const args = new Map(process.argv.slice(2).map(value => {
    const [key, ...rest] = value.replace(/^--/, '').split('='); return [key, rest.join('=') || true];
}));
const envFile = String(args.get('env-file') || process.env.BUS_BENCH_ENV_FILE || '').trim();
if (envFile) dotenv.config({ path: path.resolve(envFile), quiet: true });
const definitionPath = path.join(root, 'tests/fixtures/business-understanding-benchmark-v1.json');
const fixturePath = path.join(root, 'tests/helpers/businessUnderstandingFixture.cjs');
const oraclePath = path.join(root, 'tests/helpers/businessUnderstandingOracle.cjs');
const reportPath = path.resolve(String(args.get('report') || path.join(root, 'logs/business-semantic-frame-v1-raw.json')));
const artifactPath = path.resolve(String(args.get('artifact') || path.join(root, 'docs/business-semantic-frame-v1-baseline.json')));
const definition = readDefinition(definitionPath);

function hash(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function semanticSignature(frame) {
    return frame ? hash(JSON.stringify(summary(frame))) : null;
}
function summary(frame) {
    return frame ? { questionKind: frame.question.kind, requestedType: frame.subject.requestedType,
        canonicalType: frame.subject.canonicalType, resolutionStatus: frame.subject.resolutionStatus,
        ambiguity: frame.ambiguity.status, requestedBasis: frame.cost.requestedBasis, actualBasis: frame.cost.actualBasis,
        priceContext: frame.cost.requestedPriceContext, overrideStatus: frame.override.supportStatus,
        requiredFacts: frame.evidence.requiredFacts, verifiedFacts: frame.evidence.verifiedFacts,
        missingFacts: frame.evidence.missingFacts, completeness: frame.completeness.status,
        disclosures: frame.obligations.requiredDisclosures, clarifications: frame.obligations.requiredClarifications,
        forbiddenClaims: frame.obligations.forbiddenClaims } : null;
}
async function streamCase(baseUrl, secret, testCase, runNumber) {
    const response = await fetch(`${baseUrl}/api/ai/chat`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ messages: [{ role: 'user', content: testCase.question }], providerPreference: 'deepseek', conversationId: `bus-p1-${testCase.caseKey}-${runNumber}` }),
        signal: AbortSignal.timeout(Number(process.env.AI_CHAT_TIMEOUT_MS || 180000) + 15000) });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const decoder = new TextDecoder(); let buffer = '', answer = ''; const toolResults = [], providerEvents = []; let metrics = null;
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true }); const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) { if (!line.startsWith('data: ')) continue; let event; try { event = JSON.parse(line.slice(6)); } catch { continue; }
            if (event.type === 'content') answer += event.content || '';
            if (event.type === 'tool_result') toolResults.push({ name: event.name, result: event.result });
            if (event.type === 'detail' && Array.isArray(event.toolResults)) { toolResults.length = 0; toolResults.push(...event.toolResults); }
            if (event.type === 'provider') providerEvents.push(event);
            if (event.type === 'metrics') metrics = event;
            if (event.type === 'error') throw new Error(event.message || 'AI error');
        }
    }
    return { answer, toolResults, providerEvents, metrics };
}
async function waitForFrame(observer, previousCount) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const records = observer.recentBusinessSemanticFrames();
        if (records.length > previousCount) return records.at(-1);
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    return null;
}

async function main() {
    if (!process.env.DEEPSEEK_API_KEY) throw Object.assign(new Error('DEEPSEEK_API_KEY missing'), { code: 'SEMANTIC_SHADOW_PROVIDER_BLOCKED' });
    const fixture = createBusinessUnderstandingFixture();
    const selfChecks = runFixtureSelfChecks(fixture); if (!selfChecks.passed) throw new Error('BENCHMARK_FIXTURE_INVALID');
    fixture.db.close();
    Object.assign(process.env, { NODE_ENV: 'test', NODE_TEST_CONTEXT: 'business-semantic-frame-v1', PUMP_TEST_DATABASE_PATH: fixture.filename,
        INTERNAL_SECRET: 'business-semantic-frame-v1-secret', AI_PROVIDER: 'deepseek', DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
        AI_BUSINESS_SEMANTIC_SHADOW_ENABLED: 'true', KNOWLEDGE_AUTO_SYNC_ENABLED: 'false', KNOWLEDGE_VECTOR_ENABLED: 'false' });
    const observer = require('../api/business-semantics/shadowObserver.cjs'); observer.clearRecentBusinessSemanticFrames();
    const app = express(); app.use(express.json({ limit: '4mb' }));
    const readOnly = (req, res, next) => req.path.startsWith('/api/ai/') || req.method === 'GET'
        || (req.method === 'POST' && /^\/api\/(?:coils\/calculate|cost\/|recipes\/(?:bom-draft|cost-draft|\d+\/cost-preview)|templates\/\d+\/cost-preview)/.test(req.path))
        ? next() : res.status(403).json({ success: false, code: 'BENCHMARK_READ_ONLY' });
    app.use(readOnly);
    for (const name of ['recipes', 'coils', 'orders', 'quotations', 'customers', 'parts', 'templates', 'knowledge']) app.use(`/api/${name}`, require(`../api/routes/${name}.cjs`));
    app.use('/api', require('../api/routes/cost.cjs')); app.use(require('../api/routes/ai/chat.cjs').router);
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    process.env.PORT = String(server.address().port); const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const executions = [];
    try {
        for (let runNumber = 1; runNumber <= 2; runNumber += 1) for (const testCase of definition.coreCases) {
            const before = observer.recentBusinessSemanticFrames().length;
            try {
                const raw = await streamCase(baseUrl, process.env.INTERNAL_SECRET, testCase, runNumber);
                const record = await waitForFrame(observer, before);
                executions.push({ runNumber, caseKey: testCase.caseKey, answer: raw.answer, answerHash: hash(raw.answer),
                    toolResults: raw.toolResults, providerEvents: raw.providerEvents, metrics: raw.metrics,
                    frameRecord: record, frameSignature: semanticSignature(record?.postFrame), frame: summary(record?.postFrame) });
            } catch (error) { executions.push({ runNumber, caseKey: testCase.caseKey, error: error.message, frameRecord: null }); }
        }
    } finally {
        await new Promise(resolve => server.close(resolve)); require('../api/db.cjs').stopBackupScheduler?.(); require('../api/db.cjs').db.close(); fixture.close();
    }
    const stability = definition.coreCases.map(testCase => {
        const runs = executions.filter(item => item.caseKey === testCase.caseKey);
        const frameStable = runs.length === 2 && runs.every(item => item.frameSignature) && new Set(runs.map(item => item.frameSignature)).size === 1;
        const answerStable = runs.length === 2 && new Set(runs.map(item => item.answerHash)).size === 1;
        return { caseKey: testCase.caseKey, frameStable, answerStable, classification: frameStable
            ? answerStable ? 'Frame Stable / Answer Stable' : 'Frame Stable / Answer Unstable' : 'Frame Unstable' };
    });
    const criticalRefs = [
        { runNumber: 1, caseKey: 'BU-07', failure: 'False Complete Claim' },
        { runNumber: 1, caseKey: 'BU-09', failure: 'Wrong Entity' },
        { runNumber: 2, caseKey: 'BU-07', failure: 'False Complete Claim' },
        { runNumber: 2, caseKey: 'BU-10', failure: 'Ungrounded Business Parameter' },
    ];
    const criticalFixtures = semanticCaseFixtures();
    const historicalFrames = {
        'BU-07': buildBusinessSemanticFrame({ ...criticalFixtures['BU-07'], toolResults: [], stage: 'POST_EVIDENCE' }),
        'BU-09': buildBusinessSemanticFrame({ ...criticalFixtures['BU-09'], stage: 'POST_EVIDENCE' }),
        'BU-10': buildBusinessSemanticFrame({ ...criticalFixtures['BU-10'], stage: 'POST_EVIDENCE' }),
    };
    const criticalProjection = criticalRefs.map(ref => ({ ...ref, evidenceSource: 'BUS-P0 historical failure shape',
        ...projectCriticalFailure(historicalFrames[ref.caseKey], ref.failure) }));
    const scaleFixture = createBusinessUnderstandingFixture({ scale: true });
    const aggregateBytes = Buffer.byteLength(JSON.stringify(scaleFixture.db.prepare("SELECT id,name,spec,parts_json FROM recipes WHERE name LIKE '规模配方-%' ORDER BY id").all()));
    const boundedBytes = Buffer.byteLength(JSON.stringify(scaleFixture.db.prepare("SELECT id,name,spec FROM recipes WHERE name LIKE '规模配方-%' ORDER BY id LIMIT 20").all()));
    scaleFixture.close();
    const frameBytes = executions.map(item => Buffer.byteLength(JSON.stringify(item.frameRecord?.postFrame || {})));
    const providerEvents = executions.flatMap(item => item.providerEvents || []);
    const actualProviders = [...new Set(providerEvents.map(item => item.provider).filter(Boolean))];
    const fallbackCount = providerEvents.filter(item => item.fallback).length;
    const writes = executions.flatMap(item => item.toolResults || []).filter(item => /^(?:create|update|delete|adjust|execute|save)_/.test(item.name)).length;
    const hashes = definitionHashes(definitionPath, fixturePath, oraclePath);
    const report = { version: 'BusinessSemanticFrameV1', generatedAt: new Date().toISOString(),
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), ...hashes,
        requestedProvider: 'deepseek', actualProviders, model: process.env.DEEPSEEK_MODEL, fallbackCount, selfChecks,
        executions, stability, criticalProjection,
        frameCount: executions.filter(item => item.frameRecord?.postFrame).length,
        frameExceptions: executions.filter(item => item.frameRecord?.exception).length,
        additionalProviderCalls: executions.reduce((sum, item) => sum + Number(item.frameRecord?.semanticProviderCalls || 0), 0),
        additionalWrites: writes + executions.reduce((sum, item) => sum + Number(item.frameRecord?.businessWrites || 0), 0),
        scaleSentinel: { caseKey: 'BU-SCALE-01', aggregateBytes, boundedBytes,
            semanticFramePayloadMaxBytes: Math.max(...frameBytes), budgetBytes: BusinessSemanticFrameV1.limits.maxPayloadBytes,
            result: aggregateBytes > 128 * 1024 && boundedBytes < 32 * 1024 && Math.max(...frameBytes) <= BusinessSemanticFrameV1.limits.maxPayloadBytes ? 'PASS' : 'FAIL' } };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    const artifact = { version: report.version, generatedAt: report.generatedAt, commit: report.commit, ...hashes,
        provider: actualProviders.join(',') || 'unknown', model: report.model, fallbackCount, realExecutions: executions.length,
        semanticFramesProduced: report.frameCount, frameExceptions: report.frameExceptions,
        additionalProviderCalls: report.additionalProviderCalls, additionalWrites: report.additionalWrites,
        stability, criticalProjection, scaleSentinel: report.scaleSentinel,
        cases: executions.map(item => ({ run: item.runNumber, caseKey: item.caseKey, frame: item.frame })) };
    fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, artifactPath, actualProviders, fallbackCount, realExecutions: executions.length,
        frames: report.frameCount, exceptions: report.frameExceptions, additionalProviderCalls: report.additionalProviderCalls,
        additionalWrites: report.additionalWrites, criticalDetected: criticalProjection.filter(item => item.detectedByFrame).length,
        scale: report.scaleSentinel.result }, null, 2));
    if (executions.length !== 20 || report.frameCount !== 20 || report.frameExceptions || actualProviders.some(provider => provider !== 'deepseek')
        || fallbackCount || report.additionalProviderCalls || report.additionalWrites || criticalProjection.some(item => !item.detectedByFrame)
        || report.scaleSentinel.result !== 'PASS') process.exitCode = 2;
}

main().catch(error => { console.error(`${error.code || 'BUSINESS_SEMANTIC_SHADOW_FAILED'}: ${error.message}`); process.exitCode = 2; });
