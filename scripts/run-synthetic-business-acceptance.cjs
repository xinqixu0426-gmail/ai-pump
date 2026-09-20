'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const dotenv = require('dotenv');
const Database = require('better-sqlite3');
const { execFileSync } = require('node:child_process');
const { createSyntheticBusinessAcceptanceFixture, runSyntheticFixtureSelfChecks } = require('../tests/helpers/syntheticBusinessAcceptanceFixture.cjs');
const { buildSyntheticBusinessAcceptanceOracle, definitionHashes, sha256 } = require('../tests/helpers/syntheticBusinessAcceptanceOracle.cjs');
const { evaluateSyntheticBusinessCase, CRITICAL_FAILURES } = require('../tests/helpers/syntheticBusinessAcceptanceEvaluator.cjs');

const root = path.resolve(__dirname, '..');
const definitionPath = path.join(root, 'tests/fixtures/synthetic-business-acceptance-v1.json');
const fixturePath = path.join(root, 'tests/helpers/syntheticBusinessAcceptanceFixture.cjs');
const oraclePath = path.join(root, 'tests/helpers/syntheticBusinessAcceptanceOracle.cjs');
const definition = require(definitionPath);
const args = new Map(process.argv.slice(2).map(value => {
    const [key, ...rest] = value.replace(/^--/, '').split('=');
    return [key, rest.join('=') || true];
}));
const provider = String(args.get('provider') || 'local').trim().toLowerCase();
const runs = Math.max(1, Math.min(3, Number(args.get('runs') || 2)));
const selected = new Set(String(args.get('cases') || '').split(',').map(value => value.trim()).filter(Boolean));
const cases = selected.size ? definition.cases.filter(item => selected.has(item.caseKey)) : definition.cases;
const reportPath = path.resolve(String(args.get('report') || path.join(root, 'logs/synthetic-business-acceptance-v1-raw.json')));
const artifactPath = path.resolve(String(args.get('artifact') || path.join(root, 'docs/synthetic-business-acceptance-baseline-v1.json')));
if (!['local', 'deepseek'].includes(provider)) throw new Error('SYNTHETIC_PROVIDER_INVALID');
if (!cases.length || (selected.size && cases.length !== selected.size)) throw new Error('SYNTHETIC_CASE_SELECTION_INVALID');

function hydrateRuntimeConfiguration() {
    const envPath = path.resolve(String(args.get('env-file') || path.join(root, '.env')));
    const environment = { ...process.env };
    if (fs.existsSync(envPath)) Object.assign(environment, dotenv.parse(fs.readFileSync(envPath)));
    const configDbPath = path.resolve(String(args.get('config-db') || path.join(root, 'pump.db')));
    if (fs.existsSync(configDbPath)) {
        const configDb = new Database(configDbPath, { readonly: true, fileMustExist: true });
        try {
            const runtimeConfig = require('../api/services/runtimeConfig.cjs');
            const snapshot = runtimeConfig.effectiveValues({ env: environment, dbAccessors: { db: configDb } });
            for (const [field, value] of Object.entries(snapshot.values)) {
                environment[runtimeConfig.DEFINITIONS[field].env] = value;
            }
        } finally {
            configDb.close();
        }
    }
    environment.AI_PROVIDER = provider;
    const requestedTimeoutMs = Number(args.get('timeout-ms'));
    if (Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs >= 30_000 && requestedTimeoutMs <= 600_000) {
        environment.AI_PROVIDER_TIMEOUT_MS = String(Math.trunc(requestedTimeoutMs));
        environment.AI_CHAT_TIMEOUT_MS = String(Math.trunc(requestedTimeoutMs + 30_000));
    }
    return environment;
}

function businessFingerprint(db) {
    const tables = ['parts', 'recipes', 'coils', 'pump_shell_templates', 'orders', 'quotations', 'customers', 'system_settings'];
    const records = tables.map(table => {
        const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
        return { table, count: rows.length, hash: sha256(JSON.stringify(rows)) };
    });
    return sha256(JSON.stringify(records));
}

function flatten(value, output = []) {
    if (Array.isArray(value)) for (const item of value) flatten(item, output);
    else if (value && typeof value === 'object') {
        output.push(value);
        for (const item of Object.values(value)) flatten(item, output);
    }
    return output;
}

function analyze(testCase, oracle, run, beforeFingerprint, afterFingerprint) {
    const payload = JSON.stringify(run.toolResults);
    const observedRefs = oracle.targets.filter(target => payload.includes(target.currentName)
        || String(run.answer || '').includes(target.currentName)).map(target => target.ref);
    const rows = flatten(run.toolResults.map(item => item.result));
    const formalOverride = run.toolResults.find(item => item.name === 'calculate_coil_cost' && item.result?.data)?.result?.data || null;
    const confirmationRequested = rows.some(item => item.requiresConfirmation === true
        || Boolean(item.confirmation?.confirmationToken) || item.operation?.status === 'pending_confirmation')
        || run.events.some(item => item.type === 'status' && item.status === 'confirming');
    const writeExecuted = rows.some(item => item.executionEvidence?.kind === 'formal_api_write'
        || ['completed', 'executed'].includes(item.operation?.status));
    return {
        answer: run.answer,
        toolNames: [...new Set(run.toolResults.map(item => item.name))],
        observedRefs,
        verifiedEvidence: rows.some(item => item.executionEvidence?.verified === true),
        formalOverride,
        confirmationRequested,
        writeExecuted,
        businessDataChanged: beforeFingerprint !== afterFingerprint,
        providers: [...new Set(run.providerEvents.map(item => item.provider).filter(Boolean))],
        fallbackCount: run.providerEvents.filter(item => item.fallback).length,
        modelRequestCount: Number(run.metrics?.modelRequestCount || 0),
        elapsedMs: run.elapsedMs,
        serializedToolBytes: Buffer.byteLength(payload),
    };
}

async function streamCase(baseUrl, secret, testCase, runNumber) {
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({
            messages: [{ role: 'user', content: testCase.question }],
            providerPreference: provider,
            conversationId: `synthetic-v1-${testCase.caseKey}-${runNumber}`,
        }),
        signal: AbortSignal.timeout(Number(process.env.AI_CHAT_TIMEOUT_MS || 180000) + 15000),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP_${response.status}`);
    const decoder = new TextDecoder();
    let buffer = '';
    let answer = '';
    let metrics = null;
    const events = [];
    const toolResults = [];
    const providerEvents = [];
    for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            let event;
            try { event = JSON.parse(line.slice(6)); } catch { continue; }
            events.push(event);
            if (event.type === 'content') answer += event.content || '';
            if (event.type === 'tool_result') toolResults.push({ name: event.name, result: event.result });
            if (event.type === 'detail' && Array.isArray(event.toolResults)) {
                toolResults.length = 0;
                toolResults.push(...event.toolResults);
            }
            if (event.type === 'provider') providerEvents.push(event);
            if (event.type === 'metrics') metrics = event;
            if (event.type === 'error') throw Object.assign(new Error(event.message || 'AI_RUNTIME_ERROR'), { code: event.code });
        }
    }
    return { answer, events, toolResults, providerEvents, metrics, elapsedMs: Date.now() - startedAt };
}

function mountApplication(fixture) {
    const app = express();
    app.use(express.json({ limit: '4mb' }));
    app.use((req, res, next) => {
        const safePost = /^\/api\/(?:coils\/(?:calculate|stock-adjustments-preview)|parts\/prices-preview|cost\/|recipes\/(?:bom-draft|cost-draft|\d+\/cost-preview)|templates\/\d+\/cost-preview|relations\/(?:read|resolve))/.test(req.path)
            || req.path === '/api/entity-lookup';
        if (req.path.startsWith('/api/ai/') || req.method === 'GET' || (req.method === 'POST' && safePost)) return next();
        return res.status(403).json({ success: false, code: 'SYNTHETIC_ACCEPTANCE_READ_ONLY' });
    });
    for (const name of ['recipes', 'coils', 'orders', 'quotations', 'customers', 'parts', 'templates', 'knowledge']) {
        app.use(`/api/${name}`, require(`../api/routes/${name}.cjs`));
    }
    app.use('/api', require('../api/routes/cost.cjs'));
    app.use('/api/entity-lookup', require('../api/routes/entityLookup.cjs').createEntityLookupRouter({ db: fixture.db }));
    app.use('/api/relations', require('../api/routes/relationRead.cjs').createRelationReadRouter({ db: fixture.db }));
    app.use(require('../api/routes/ai/chat.cjs').router);
    return app;
}

async function main() {
    const runtimeEnvironment = hydrateRuntimeConfiguration();
    const resolvedProvider = require('../api/services/aiProviderRegistry.cjs').resolveProviderConfig(provider, runtimeEnvironment);
    if (provider === 'deepseek' && !resolvedProvider.apiKey) throw new Error('SYNTHETIC_DEEPSEEK_KEY_MISSING');
    const fixture = createSyntheticBusinessAcceptanceFixture();
    const fixtureChecks = runSyntheticFixtureSelfChecks(fixture);
    if (!fixtureChecks.passed) throw new Error('SYNTHETIC_FIXTURE_INVALID');
    const oracle = buildSyntheticBusinessAcceptanceOracle(fixture, definition);
    fixture.db.close();
    Object.assign(process.env, runtimeEnvironment, {
        NODE_ENV: 'test',
        NODE_TEST_CONTEXT: 'synthetic-business-acceptance-v1',
        PUMP_TEST_DATABASE_PATH: fixture.filename,
        INTERNAL_SECRET: 'synthetic-business-acceptance-v1-secret',
        AI_PROVIDER: provider,
        AI_BUSINESS_SEMANTIC_SHADOW_ENABLED: 'true',
        AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED: 'true',
        AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED: 'true',
        AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true',
        KNOWLEDGE_AUTO_SYNC_ENABLED: 'false',
        KNOWLEDGE_VECTOR_ENABLED: 'false',
    });
    const runtimeDb = require('../api/db.cjs').db;
    fixture.db = runtimeDb;
    const app = mountApplication(fixture);
    const server = await new Promise(resolve => {
        const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    });
    process.env.PORT = String(server.address().port);
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const executions = [];
    try {
        for (let runNumber = 1; runNumber <= runs; runNumber += 1) {
            for (const testCase of cases) {
                const before = businessFingerprint(runtimeDb);
                try {
                    const raw = await streamCase(baseUrl, process.env.INTERNAL_SECRET, testCase, runNumber);
                    const after = businessFingerprint(runtimeDb);
                    const actual = analyze(testCase, oracle.perCase[testCase.caseKey], raw, before, after);
                    const evaluated = { runNumber, ...evaluateSyntheticBusinessCase(testCase, oracle.perCase[testCase.caseKey], actual) };
                    executions.push(evaluated);
                    console.log(`[synthetic] run=${runNumber} case=${testCase.caseKey} status=${evaluated.status} elapsedMs=${actual.elapsedMs}`);
                } catch (error) {
                    const after = businessFingerprint(runtimeDb);
                    executions.push({ runNumber, caseKey: testCase.caseKey, status: 'BLOCKED', dimensions: {},
                        failureClass: [error.code || 'MODEL_RUNTIME_ERROR'], criticalFailures: before === after ? [] : ['Unauthorized Writes'],
                        actual: { blocked: true, error: error.message, businessDataChanged: before !== after } });
                    console.log(`[synthetic] run=${runNumber} case=${testCase.caseKey} status=BLOCKED code=${error.code || 'MODEL_RUNTIME_ERROR'}`);
                }
            }
        }
    } finally {
        await new Promise(resolve => server.close(resolve));
        require('../api/db.cjs').stopBackupScheduler?.();
        if (runtimeDb.open) runtimeDb.close();
        fixture.close();
    }
    const counts = Object.fromEntries(['PASS', 'PARTIAL', 'FAIL', 'BLOCKED'].map(status => [status, executions.filter(item => item.status === status).length]));
    const criticalFailureCounts = Object.fromEntries(CRITICAL_FAILURES.map(name => [name,
        executions.reduce((sum, item) => sum + (item.criticalFailures || []).filter(value => value === name).length, 0)]));
    const dimensions = Object.fromEntries(definition.dimensions.map(name => {
        const scoped = executions.map(item => item.dimensions?.[name]).filter(value => value !== null && value !== undefined);
        return [name, { passed: scoped.filter(Boolean).length, total: scoped.length,
            passRate: scoped.length ? Number((scoped.filter(Boolean).length / scoped.length * 100).toFixed(1)) : 100 }];
    }));
    const providerCalls = executions.reduce((sum, item) => sum + Number(item.actual?.modelRequestCount || 0), 0);
    const fallbacks = executions.reduce((sum, item) => sum + Number(item.actual?.fallbackCount || 0), 0);
    const actualProviders = [...new Set(executions.flatMap(item => item.actual?.providers || []))];
    const maxToolPayloadBytes = Math.max(0, ...executions.map(item => Number(item.actual?.serializedToolBytes || 0)));
    const hashes = definitionHashes(definitionPath, fixturePath, oraclePath);
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const summary = { version: definition.version, commit, generatedAt: new Date().toISOString(), provider,
        model: resolvedProvider.model, selectedCases: cases.map(item => item.caseKey), runs, ...hashes,
        fixtureChecks, counts, criticalFailureCounts, dimensions, providerCalls, fallbacks, actualProviders,
        maxToolPayloadBytes, productionDatabaseWrites: 0 };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({ ...summary, executions }, null, 2)}\n`);
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, `${JSON.stringify({ ...summary,
        cases: executions.map(item => ({ run: item.runNumber, caseKey: item.caseKey, status: item.status,
            failureClass: item.failureClass, criticalFailures: item.criticalFailures, dimensions: item.dimensions })) }, null, 2)}\n`);
    console.log(JSON.stringify({ reportPath, artifactPath, ...summary }, null, 2));
    if (counts.PASS !== executions.length || Object.values(criticalFailureCounts).some(Boolean)
        || fallbacks !== 0 || actualProviders.some(value => value !== provider)) process.exitCode = 2;
}

main().catch(error => {
    console.error(`${error.code || 'SYNTHETIC_ACCEPTANCE_FAILED'}: ${error.message}`);
    process.exitCode = 2;
});
