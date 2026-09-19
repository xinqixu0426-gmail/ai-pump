'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Database = require('better-sqlite3');
const corpus = require('../tests/helpers/ontologyTraversalCorpus.cjs');
const { TraversalPolicyV1 } = require('../api/ontology/traversalPolicy.cjs');
async function main() {
    const sourceRoot = process.env.ONT_SHADOW_CONFIG_ROOT || process.cwd();
    const env = { ...process.env, ...require('dotenv').parse(fs.readFileSync(path.join(sourceRoot, '.env'))) };
    const configDb = new Database(path.join(sourceRoot, 'pump.db'), { readonly: true, fileMustExist: true });
    const config = require('../api/services/runtimeConfig.cjs');
    try {
        const snapshot = config.effectiveValues({ env, dbAccessors: { db: configDb } });
        for (const [field, value] of Object.entries(snapshot.values)) env[config.DEFINITIONS[field].env] = value;
    } finally { configDb.close(); }
    const provider = require('../api/services/aiProviderRegistry.cjs').resolveAiProviderConfig(env);
    console.log(JSON.stringify({ provider: provider.provider, model: provider.model, corpus: corpus.name, questions: corpus.realCorpus.length, repetitions: 2 }));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-traversal-real-')), filename = path.join(directory, 'fixture.db');
    let server, db;
    try {
        corpus.fixture(filename).close();
        Object.assign(process.env, { NODE_ENV: 'test', NODE_TEST_CONTEXT: 'ontology-traversal-controlled', PUMP_TEST_DATABASE_PATH: filename,
            KNOWLEDGE_AUTO_SYNC_ENABLED: 'false', KNOWLEDGE_VECTOR_ENABLED: 'false' });
        const app = require('express')();
        app.use((req, res, next) => req.method === 'GET' ? next() : res.status(403).json({ success: false, code: 'CONTROLLED_READ_ONLY' }));
        for (const resource of ['recipes', 'coils', 'orders', 'quotations', 'customers', 'parts', 'templates']) app.use(`/api/${resource}`, require(`../api/routes/${resource}.cjs`));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        process.env.PORT = String(server.address().port); db = require('../api/db.cjs').db;
        const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
        const { fetchAiProvider } = require('../api/services/aiProvider.cjs');
        const { observeShadow } = require('../api/ontology/runtimeShadow.cjs');
        const { verifiedRows } = require('../api/ontology/relationBinder.cjs');
        const baseline = db.serialize(), changes = db.prepare('SELECT total_changes() n').get().n;
        const cases = [], seeds = [];
        const observedSignature = r => JSON.stringify([r?.relationId, r?.root, r?.current, r?.ontology.canonicalTargetIds, r?.comparison.status]);
        for (let run = 1; run <= 2; run++) for (const c of corpus.realCorpus) {
            const caseId = `p5-r${run}-${c.caseId}`; console.log(`RUN ${caseId}`);
            let record, oneHop, finish, modelCalls = 0, seedResults = [];
            const done = new Promise(resolve => { finish = resolve; }), controller = new AbortController();
            const timer = setTimeout(() => controller.abort(Object.assign(new Error('Timeout'), { code: 'CONTROLLED_TIMEOUT' })), 90000);
            const input = { requestId: caseId, conversationId: caseId, confirmationSubject: 'ont-p5-controlled-owner', signal: controller.signal,
                env: { ...env, AI_ONTOLOGY_RELATION_SHADOW_ENABLED: 'true', AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED: 'true', AI_ONTOLOGY_2HOP_SHADOW_ENABLED: 'true' } };
            const baseDeps = { loadMemory: async () => ({ items: [] }), loadCorrections: () => '', fetchAiProvider: (m, o) => { modelCalls++; return fetchAiProvider(m, o); } };
            try {
                if (c.caseId === 'pronoun') {
                    const seed = await runAiAssistant({ ...input, messages: [{ role: 'user', content: '查询客户Shadow客户甲的基本信息' }],
                        env: { ...input.env, AI_ONTOLOGY_RELATION_SHADOW_ENABLED: 'false' } }, baseDeps);
                    seedResults = seed.toolResults; seeds.push({ run, modelCalls, toolNames: seedResults.map(t => t.name), verifiedCustomer: verifiedRows(seedResults).some(r => r.entityType === 'customer' && r.canonicalId === '1') });
                    modelCalls = 0;
                }
                const result = await runAiAssistant({ ...input, messages: [{ role: 'user', content: c.question }] }, { ...baseDeps,
                    ontologyShadow: { databasePath: filename, record: r => { oneHop = r; },
                        traversal: { databasePath: filename, record: r => { record = r; finish(); } } } });
                const shadowTimer = setTimeout(finish, 4500); await done; clearTimeout(shadowTimer);
                const off = await observeShadow({ userText: c.question, toolResults: result.toolResults, bindingEnabled: true, requestId: `${caseId}-off` }, { databasePath: filename });
                const expectedPath = TraversalPolicyV1.paths.find(p => p.pathId === c.pathId)?.relationPath;
                const available = verifiedRows(c.caseId === 'pronoun' ? seedResults : result.toolResults);
                const rootAvailable = Boolean(c.root && available.some(r => r.entityType === c.root.entityType && r.canonicalId === c.root.canonicalId));
                const bound = record?.binding?.status === 'BOUND_2HOP';
                const wrongBinding = bound && (!expectedPath || record.binding.root.entityType !== c.root?.entityType
                    || record.binding.root.canonicalId !== c.root?.canonicalId || record.binding.relationPath.join('|') !== expectedPath.join('|'));
                const targetIds = record?.traversal?.targets.map(t => t.canonicalId).sort((a, b) => Number(a) - Number(b)) || [];
                const entry = { run, caseId: c.caseId, pathBindable: Boolean(expectedPath && rootAvailable), rootAvailable,
                    bindingStatus: record?.binding?.status || 'TECHNICAL_FAILURE', pathId: record?.binding?.pathId || null, boundRoot: record?.binding?.root || null,
                    executed: record?.executed === true, traversalStatus: record?.traversal?.status || null, complete: record?.traversal?.complete === true,
                    targetIds, comparison: record?.comparison || 'TECHNICAL_FAILURE', wrongBinding: Boolean(wrongBinding),
                    oracleMismatch: record?.traversal?.complete === true && JSON.stringify(targetIds) !== JSON.stringify(c.expected),
                    oneHopEquivalent: observedSignature(oneHop) === observedSignature(off), oneHopStatus: oneHop?.comparison.status,
                    modelCalls, toolNames: result.toolResults.map(t => t.name), failedTools: result.toolResults.filter(t => t.result?.success === false).map(t => t.name) };
                cases.push(entry); console.log(JSON.stringify(entry));
            } catch (error) {
                const entry = { run, caseId: c.caseId, bindingStatus: 'TECHNICAL_FAILURE', comparison: 'TECHNICAL_FAILURE', executed: false,
                    complete: false, modelCalls, code: typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'CURRENT_RUNTIME_FAILURE' };
                cases.push(entry); console.log(JSON.stringify(entry));
            } finally { clearTimeout(timer); }
        }
        const count = predicate => cases.filter(predicate).length;
        const report = { version: 1, provider: provider.provider, model: provider.model, corpus: corpus.name, questions: corpus.realCorpus.length,
            runs: 2, total: cases.length, pathBindable: count(c => c.pathBindable), pathBound: count(c => c.bindingStatus === 'BOUND_2HOP'),
            traversalExecuted: count(c => c.executed), complete: count(c => c.complete), partial: count(c => c.traversalStatus === 'PARTIAL'),
            unavailable: count(c => c.traversalStatus === 'UNAVAILABLE'), budgetExhausted: count(c => c.traversalStatus === 'BUDGET_EXHAUSTED'),
            technicalFailures: count(c => c.comparison === 'TECHNICAL_FAILURE'),
            comparable: count(c => ['MATCH', 'MISMATCH'].includes(c.comparison)), match: count(c => c.comparison === 'MATCH'), mismatch: count(c => c.comparison === 'MISMATCH'),
            notComparable: count(c => c.executed && !['MATCH', 'MISMATCH'].includes(c.comparison)), wrongBindings: count(c => c.wrongBinding),
            oracleMismatches: count(c => c.oracleMismatch), oneHopRegressions: count(c => c.oneHopEquivalent === false),
            bindingStatuses: Object.fromEntries([...new Set(cases.map(c => c.bindingStatus))].map(s => [s, count(c => c.bindingStatus === s)])),
            databaseUnchanged: changes === db.prepare('SELECT total_changes() n').get().n && db.serialize().equals(baseline), seeds, cases };
        fs.mkdirSync('logs', { recursive: true }); fs.writeFileSync('logs/ont-p5-real-results.json', JSON.stringify(report, null, 2) + '\n', 'utf8');
        console.log(JSON.stringify({ ...report, cases: undefined }));
    } finally { if (server) await new Promise(resolve => server.close(resolve)); db?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
}
main().catch(() => { console.error('CONTROLLED_TRAVERSAL_CORPUS_SETUP_FAILED'); process.exitCode = 1; });
