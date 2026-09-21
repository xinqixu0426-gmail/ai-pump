'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const { execFileSync } = require('node:child_process');
const { createBusinessImpactFixture, runBusinessImpactFixtureChecks } = require('../tests/helpers/businessImpactFixture.cjs');
const { buildBusinessImpactOracle, impactDefinitionHashes } = require('../tests/helpers/businessImpactOracle.cjs');
const { evaluateBusinessImpactCase, CRITICAL_FAILURES } = require('../tests/helpers/businessImpactEvaluator.cjs');
const { buildProjectionCases } = require('../tests/helpers/businessImpactProjectionCases.cjs');
const { createBusinessImpactProjection } = require('../api/business-impact/projection.cjs');
const { impactEligibility } = require('../api/business-impact/eligibility.cjs');
const { buildImpactEvidenceBundle } = require('../api/business-impact/evidenceBundle.cjs');

const root = path.resolve(__dirname, '..');
const casePath = path.join(root, 'tests/fixtures/business-impact-benchmark-v1.json');
const fixturePath = path.join(root, 'tests/helpers/businessImpactFixture.cjs');
const oraclePath = path.join(root, 'tests/helpers/businessImpactOracle.cjs');
const definition = require(casePath);
const args = new Map(process.argv.slice(2).map(value => {
    const [key, ...rest] = value.replace(/^--/, '').split('=');
    return [key, rest.join('=') || true];
}));
const provider = String(args.get('provider') || 'local').trim().toLowerCase();
const runs = Math.max(1, Math.min(2, Number(args.get('runs') || 2)));
const reportPath = path.resolve(String(args.get('report') || path.join(root, 'logs/business-impact-benchmark-v1-raw.json')));
const artifactPath = path.resolve(String(args.get('artifact') || path.join(root, 'docs/business-impact-baseline-v1.json')));
if (!['local', 'deepseek'].includes(provider)) throw new Error('IMPACT_PROVIDER_INVALID');

function runtimeEnvironment() {
    const envPath = path.resolve(String(args.get('env-file') || path.join(root, '.env')));
    const environment = { ...process.env };
    if (fs.existsSync(envPath)) Object.assign(environment, dotenv.parse(fs.readFileSync(envPath)));
    const configDbPath = path.resolve(String(args.get('config-db') || path.join(root, 'pump.db')));
    if (fs.existsSync(configDbPath)) {
        const configDb = new Database(configDbPath, { readonly: true, fileMustExist: true });
        try {
            const config = require('../api/services/runtimeConfig.cjs');
            const snapshot = config.effectiveValues({ env: environment, dbAccessors: { db: configDb } });
            for (const [field, value] of Object.entries(snapshot.values)) environment[config.DEFINITIONS[field].env] = value;
        } finally { configDb.close(); }
    }
    environment.AI_PROVIDER = provider;
    const timeout = Number(args.get('timeout-ms') || 300000);
    environment.AI_PROVIDER_TIMEOUT_MS = String(timeout);
    environment.AI_CHAT_TIMEOUT_MS = String(timeout + 30000);
    return environment;
}

function fingerprint(db) {
    return require('node:crypto').createHash('sha256').update(JSON.stringify(
        ['parts','recipes','coils','pump_shell_templates','orders','quotations','customers','system_settings']
            .map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])
    )).digest('hex');
}

function flatten(value, output = []) {
    if (Array.isArray(value)) for (const item of value) flatten(item, output);
    else if (value && typeof value === 'object') { output.push(value); for (const item of Object.values(value)) flatten(item, output); }
    return output;
}

async function streamCase(baseUrl, secret, item, runNumber) {
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/api/ai/chat`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ messages: [{ role: 'user', content: item.question }], providerPreference: provider,
            conversationId: `impact-v1-${item.caseKey}-${runNumber}` }),
        signal: AbortSignal.timeout(Number(process.env.AI_CHAT_TIMEOUT_MS || 330000) + 15000) });
    if (!response.ok || !response.body) throw new Error(`HTTP_${response.status}`);
    const decoder = new TextDecoder(); let buffer = '', answer = '', metrics = null;
    const events = [], toolResults = [], providerEvents = [];
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n'); buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let event; try { event = JSON.parse(line.slice(6)); } catch { continue; }
            events.push(event);
            if (event.type === 'content') answer += event.content || '';
            if (event.type === 'tool_result') toolResults.push({ name: event.name, result: event.result });
            if (event.type === 'detail' && Array.isArray(event.toolResults)) { toolResults.length = 0; toolResults.push(...event.toolResults); }
            if (event.type === 'provider') providerEvents.push(event);
            if (event.type === 'metrics') metrics = event;
            if (event.type === 'error') throw Object.assign(new Error(event.message || 'AI_RUNTIME_ERROR'), { code: event.code });
        }
    }
    return { answer, events, toolResults, providerEvents, metrics, elapsedMs: Date.now() - startedAt };
}

function analyze(raw, before, after) {
    const rows = flatten(raw.toolResults.map(item => item.result));
    return { answer: raw.answer, toolNames: [...new Set(raw.toolResults.map(item => item.name))],
        writeExecuted: rows.some(item => item.executionEvidence?.kind === 'formal_api_write' || ['completed','executed'].includes(item.operation?.status)),
        businessDataChanged: before !== after,
        providers: [...new Set(raw.providerEvents.map(item => item.provider).filter(Boolean))],
        fallbackCount: raw.providerEvents.filter(item => item.fallback).length,
        modelRequestCount: Number(raw.metrics?.modelRequestCount || 0), elapsedMs: raw.elapsedMs,
        serializedToolBytes: Buffer.byteLength(JSON.stringify(raw.toolResults)) };
}

function mount(fixture) {
    const app = express(); app.use(express.json({ limit: '4mb' }));
    app.use((req, res, next) => {
        const safePost = /^\/api\/(?:coils\/(?:calculate|stock-adjustments-preview)|parts\/prices-preview|cost\/|recipes\/(?:bom-draft|cost-draft|\d+\/cost-preview)|templates\/\d+\/cost-preview|relations\/(?:read|resolve))/.test(req.path)
            || req.path === '/api/entity-lookup';
        if (req.path.startsWith('/api/ai/') || req.method === 'GET' || (req.method === 'POST' && safePost)) return next();
        return res.status(403).json({ success: false, code: 'IMPACT_BENCHMARK_READ_ONLY' });
    });
    for (const name of ['recipes','coils','orders','quotations','customers','parts','templates','knowledge'])
        app.use(`/api/${name}`, require(`../api/routes/${name}.cjs`));
    app.use('/api', require('../api/routes/cost.cjs'));
    app.use('/api/entity-lookup', require('../api/routes/entityLookup.cjs').createEntityLookupRouter({ db: fixture.db }));
    app.use('/api/relations', require('../api/routes/relationRead.cjs').createRelationReadRouter({ db: fixture.db }));
    app.use(require('../api/routes/ai/chat.cjs').router);
    return app;
}

async function main() {
    const environment = runtimeEnvironment();
    const resolved = require('../api/services/aiProviderRegistry.cjs').resolveProviderConfig(provider, environment);
    const fixture = createBusinessImpactFixture();
    const fixtureChecks = runBusinessImpactFixtureChecks(fixture);
    if (!fixtureChecks.passed) throw new Error('IMPACT_FIXTURE_INVALID');
    const oracle = buildBusinessImpactOracle(fixture, definition);
    fixture.db.close();
    Object.assign(process.env, environment, { NODE_ENV: 'test', NODE_TEST_CONTEXT: 'business-impact-benchmark-v1',
        PUMP_TEST_DATABASE_PATH: fixture.filename, INTERNAL_SECRET: 'business-impact-benchmark-v1-secret', AI_PROVIDER: provider,
        AI_BUSINESS_SEMANTIC_SHADOW_ENABLED: 'true', AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: 'true',
        AI_BUSINESS_IMPACT_SHADOW_ENABLED: 'true', AI_BUSINESS_IMPACT_ENFORCEMENT_CANARY_ENABLED: 'true',
        AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: 'true', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true',
        KNOWLEDGE_AUTO_SYNC_ENABLED: 'false', KNOWLEDGE_VECTOR_ENABLED: 'false' });
    const runtimeDb = require('../api/db.cjs').db; fixture.db = runtimeDb;
    const projectionCases = buildProjectionCases(fixture.ids);
    const { buildOrderReadinessContext } = require('../api/services/activeOrderReadiness.cjs');
    const projection = createBusinessImpactProjection({ db: runtimeDb,
        readinessForOrder: order => buildOrderReadinessContext(order).readiness });
    const server = await new Promise(resolve => { const instance = mount(fixture).listen(0, '127.0.0.1', () => resolve(instance)); });
    process.env.PORT = String(server.address().port);
    const executions = [];
    try {
        // Intentionally strict serial: one local-model request finishes before the next starts.
        for (let run = 1; run <= runs; run += 1) for (const item of definition.cases) {
            const before = fingerprint(runtimeDb);
            try {
                const raw = await streamCase(`http://127.0.0.1:${server.address().port}`, process.env.INTERNAL_SECRET, item, run);
                const actual = analyze(raw, before, fingerprint(runtimeDb));
                const impactProjection = projection.project(projectionCases[item.caseKey]);
                actual.impactProjection = impactProjection;
                actual.impactProjectionBytes = Buffer.byteLength(JSON.stringify(impactProjection));
                const impactEvidenceBundle = buildImpactEvidenceBundle({ db: runtimeDb, impactResult: impactProjection,
                    impactEligibility: impactEligibility({ userText: item.question, semanticEligible: true }) });
                actual.impactEvidenceBundleBytes = Buffer.byteLength(JSON.stringify(impactEvidenceBundle));
                const evaluated = { runNumber: run, ...evaluateBusinessImpactCase(item, oracle.perCase[item.caseKey], actual) };
                executions.push(evaluated);
                console.log(`[impact] run=${run} case=${item.caseKey} status=${evaluated.status} elapsedMs=${actual.elapsedMs}`);
            } catch (error) {
                executions.push({ runNumber: run, caseKey: item.caseKey, status: 'BLOCKED', dimensions: {},
                    failureClass: [error.code || 'MODEL_RUNTIME_ERROR'], criticalFailures: [], actual: { error: error.message } });
                console.log(`[impact] run=${run} case=${item.caseKey} status=BLOCKED code=${error.code || 'MODEL_RUNTIME_ERROR'}`);
            }
        }
    } finally {
        await new Promise(resolve => server.close(resolve));
        require('../api/db.cjs').stopBackupScheduler?.();
        if (runtimeDb.open) runtimeDb.close(); fixture.close();
    }
    const counts = Object.fromEntries(['PASS','PARTIAL','FAIL','BLOCKED'].map(status => [status, executions.filter(item => item.status === status).length]));
    const criticalFailureCounts = Object.fromEntries(CRITICAL_FAILURES.map(name => [name,
        executions.reduce((sum, item) => sum + (item.criticalFailures || []).filter(value => value === name).length, 0)]));
    const dimensions = Object.fromEntries(definition.dimensions.map(name => {
        const values = executions.map(item => item.dimensions?.[name]).filter(value => value !== undefined);
        return [name, { passed: values.filter(Boolean).length, total: values.length,
            passRate: values.length ? Number((values.filter(Boolean).length / values.length * 100).toFixed(1)) : 0 }];
    }));
    const hashes = impactDefinitionHashes(casePath, fixturePath, oraclePath);
    const projectionExecutions = executions.filter(item => item.actual?.impactProjection);
    const projectionByCase = projectionExecutions.reduce((groups, item) => {
        (groups[item.caseKey] ||= []).push(item); return groups;
    }, {});
    const stableProjection = value => JSON.stringify({ trigger: value.trigger,
        impacts: value.impacts.map(({ impactType, target, effect, authority, temporal }) =>
            ({ impactType, target, effect, authority, temporal })), completeness: value.completeness });
    const projectionStability = Object.values(projectionByCase).filter(entries => entries.length === runs
        && entries.every(entry => stableProjection(entry.actual.impactProjection)
            === stableProjection(entries[0].actual.impactProjection))).length;
    const summary = { version: definition.version, contractVersion: definition.contractVersion,
        commit: execFileSync('git', ['rev-parse','HEAD'], { cwd: root, encoding: 'utf8' }).trim(), generatedAt: new Date().toISOString(),
        provider, model: resolved.model, runs, executionsCount: executions.length, ...hashes, fixtureChecks, counts,
        criticalFailureCounts, dimensions,
        providerCalls: executions.reduce((sum, item) => sum + Number(item.actual?.modelRequestCount || 0), 0),
        fallbacks: executions.reduce((sum, item) => sum + Number(item.actual?.fallbackCount || 0), 0),
        maxToolPayloadBytes: Math.max(0, ...executions.map(item => Number(item.actual?.serializedToolBytes || 0))),
        projectionProduced: projectionExecutions.length,
        projectionExceptions: executions.length - projectionExecutions.length,
        projectionStability: `${projectionStability}/${definition.cases.length}`,
        maxProjectionBytes: Math.max(0, ...projectionExecutions.map(item => Number(item.actual.impactProjectionBytes || 0))),
        maxEvidenceBundleBytes: Math.max(0, ...projectionExecutions.map(item => Number(item.actual.impactEvidenceBundleBytes || 0))),
        additionalImpactProviderCalls: 0,
        productionDatabaseWrites: 0 };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({ ...summary, executions }, null, 2)}\n`);
    fs.writeFileSync(artifactPath, `${JSON.stringify({ ...summary, cases: executions.map(item => ({ run: item.runNumber,
        caseKey: item.caseKey, status: item.status, failureClass: item.failureClass, criticalFailures: item.criticalFailures,
        dimensions: item.dimensions })) }, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, artifactPath, ...summary }, null, 2));
    if (summary.fallbacks || executions.some(item => item.criticalFailures?.includes('Unauthorized Write'))) process.exitCode = 2;
}

main().catch(error => { console.error(`${error.code || 'IMPACT_BENCHMARK_FAILED'}: ${error.message}`); process.exitCode = 2; });
