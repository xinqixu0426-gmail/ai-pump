'use strict';
// Controlled acceptance: existing provider + assistant + unified executor + real business routers.
// Only the fixture database is writable during setup. The acceptance server refuses non-GET calls.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const { fixture, realCorpus } = require('../tests/helpers/ontologyShadowFixture.cjs');

async function main() {
    const sourceRoot = process.env.ONT_SHADOW_CONFIG_ROOT || process.cwd();
    const env = { ...process.env, ...require('dotenv').parse(fs.readFileSync(path.join(sourceRoot, '.env'))) };
    const configDb = new Database(path.join(sourceRoot, 'pump.db'), { readonly: true, fileMustExist: true });
    const runtimeConfig = require('../api/services/runtimeConfig.cjs');
    try {
        const snapshot = runtimeConfig.effectiveValues({ env, dbAccessors: { db: configDb } });
        for (const [field, value] of Object.entries(snapshot.values)) env[runtimeConfig.DEFINITIONS[field].env] = value;
    } finally { configDb.close(); }
    const { resolveAiProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
    const provider = resolveAiProviderConfig(env);
    console.log(JSON.stringify({ provider: provider.provider, model: provider.model, credentialsConfigured: !!provider.apiKey || provider.apiKeyRequired === false }));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-real-corpus-'));
    const filename = path.join(directory, 'fixture.db');
    let server, db;
    try {
        fixture(filename).close();
        process.env.NODE_ENV = 'test'; process.env.NODE_TEST_CONTEXT = 'ontology-shadow-controlled';
        process.env.PUMP_TEST_DATABASE_PATH = filename;
        process.env.KNOWLEDGE_AUTO_SYNC_ENABLED = 'false'; process.env.KNOWLEDGE_VECTOR_ENABLED = 'false';
        const express = require('express');
        const app = express();
        app.use((req, res, next) => req.method === 'GET' ? next() : res.status(403).json({ success: false, code: 'CONTROLLED_READ_ONLY' }));
        for (const resource of ['recipes', 'coils', 'orders', 'quotations', 'customers', 'parts', 'templates']) {
            app.use(`/api/${resource}`, require(`../api/routes/${resource}.cjs`));
        }
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        process.env.PORT = String(server.address().port);
        db = require('../api/db.cjs').db;
        const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
        const { fetchAiProvider } = require('../api/services/aiProvider.cjs');
        const { selectShadowContext, eligible } = require('../api/ontology/shadowEligibility.cjs');
        const baseline = db.serialize(), before = db.prepare('SELECT total_changes() n').get().n;
        const cases = [];
        for (const [caseId, question] of realCorpus) {
            console.log(`RUN ${caseId}`);
            let shadowRecord, finishShadow;
            const shadowDone = new Promise(resolve => { finishShadow = resolve; });
            let modelCalls = 0;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(Object.assign(new Error('Controlled request timeout'), { code: 'CONTROLLED_TIMEOUT' })), 90000);
            try {
                const result = await runAiAssistant({ messages: [{ role: 'user', content: question }],
                    requestId: `ont-p3-${caseId}`, conversationId: `ont-p3-${caseId}`,
                    env: { ...env, AI_ONTOLOGY_RELATION_SHADOW_ENABLED: 'true' }, signal: controller.signal }, {
                    loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
                    fetchAiProvider: (messages, options) => { modelCalls++; return fetchAiProvider(messages, options); },
                    ontologyShadow: { databasePath: filename, record: record => { shadowRecord = record; finishShadow(); } },
                });
                const timeout = setTimeout(finishShadow, 2500);
                await shadowDone; clearTimeout(timeout);
                const c = selectShadowContext(question, result.toolResults);
                const entry = { caseId, eligible: eligible(c), status: shadowRecord?.comparison.status || 'TECHNICAL_FAILURE',
                    relationId: shadowRecord?.relationId || null, classifications: shadowRecord?.comparison.classifications || [],
                    toolNames: result.toolResults.map(t => t.name),
                    failedTools: result.toolResults.filter(t => t.result?.success === false).map(t => ({ name: t.name,
                        code: typeof t.result.code === 'string' && /^[A-Z_a-z0-9]{1,64}$/.test(t.result.code) ? t.result.code : 'QUERY_FAILURE' })),
                    modelCalls, outcome: result.telemetry.outcome };
                cases.push(entry); console.log(JSON.stringify(entry));
            } catch (error) {
                const entry = { caseId, eligible: false, status: 'TECHNICAL_FAILURE', stage: 'current_runtime',
                    code: /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'CURRENT_RUNTIME_FAILURE', modelCalls };
                cases.push(entry); console.log(JSON.stringify(entry));
            } finally { clearTimeout(timer); }
        }
        const counts = {};
        for (const entry of cases) counts[entry.status] = (counts[entry.status] || 0) + 1;
        const report = { version: 1, provider: provider.provider, model: provider.model, corpusSource: 'P0 summarized families; original 15 case texts unavailable; representative reconstructed corpus',
            total: cases.length, eligible: cases.filter(c => c.eligible).length,
            compared: cases.filter(c => ['MATCH', 'MISMATCH'].includes(c.status)).length, counts,
            databaseUnchanged: db.prepare('SELECT total_changes() n').get().n === before && db.serialize().equals(baseline), cases };
        const reportDirectory = path.join(process.cwd(), 'logs');
        fs.mkdirSync(reportDirectory, { recursive: true });
        fs.writeFileSync(path.join(reportDirectory, 'ont-p3-real-results.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
        console.log(JSON.stringify({ ...report, cases: undefined }));
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        db?.close();
        fs.rmSync(directory, { recursive: true, force: true });
    }
}
main().catch(() => { console.error('CONTROLLED_CORPUS_SETUP_FAILED'); process.exitCode = 1; });
