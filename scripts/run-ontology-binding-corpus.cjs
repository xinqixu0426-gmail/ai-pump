'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Database = require('better-sqlite3');
const { fixture } = require('../tests/helpers/ontologyShadowFixture.cjs');
const frozen = require('../tests/fixtures/ontology-p3-frozen-v1.json');
// Independent fixture oracle; never supplied to the production binder or provider.
const expectedBindings = {
 'recipe-part':['recipe','301','recipe.contains_part'], 'recipe-empty':['recipe','302','recipe.contains_part'],
 'recipe-legacy':['recipe','303','recipe.contains_part'], 'recipe-ambiguous':['recipe','304','recipe.contains_part'],
 'coil-recipe':['coil','501','coil.used_by_recipe'], 'coil-empty':['coil','502','coil.used_by_recipe'],
 'order-customer':['order','101','order.belongs_to_customer'], 'order-recipe':['order','101','order.contains_recipe'],
 'customer-order':['customer','1','customer.has_order'], 'customer-quotation':['customer','1','customer.has_quotation'],
 'quotation-customer':['quotation','701','quotation.belongs_to_customer'],
 'recipe-template':['recipe','301','recipe.uses_template'], 'template-recipe':['template','401','template.used_by_recipe'],
};
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
    console.log(JSON.stringify({ provider: provider.provider, model: provider.model, frozenCases: frozen.total, repetitions: 2 }));
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ontology-binding-real-'));
    const filename = path.join(directory, 'fixture.db');
    let server, db;
    try {
        fixture(filename).close();
        Object.assign(process.env, { NODE_ENV: 'test', NODE_TEST_CONTEXT: 'ontology-binding-controlled',
            PUMP_TEST_DATABASE_PATH: filename, KNOWLEDGE_AUTO_SYNC_ENABLED: 'false', KNOWLEDGE_VECTOR_ENABLED: 'false' });
        const express = require('express'), app = express();
        app.use((req, res, next) => req.method === 'GET' ? next() : res.status(403).json({ success: false, code: 'CONTROLLED_READ_ONLY' }));
        for (const resource of ['recipes', 'coils', 'orders', 'quotations', 'customers', 'parts', 'templates']) app.use(`/api/${resource}`, require(`../api/routes/${resource}.cjs`));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        process.env.PORT = String(server.address().port);
        db = require('../api/db.cjs').db;
        const { runAiAssistant } = require('../api/services/aiAssistantRuntime.cjs');
        const { fetchAiProvider } = require('../api/services/aiProvider.cjs');
        const { observeShadow } = require('../api/ontology/runtimeShadow.cjs');
        const { bindRelation } = require('../api/ontology/relationBinder.cjs');
        const baseline = db.serialize(), changes = db.prepare('SELECT total_changes() n').get().n;
        const cases = [];
        for (let repetition = 1; repetition <= 2; repetition++) for (const historical of frozen.runs) for (const prior of historical.cases) {
            const caseId = `r${repetition}-p3r${historical.run}-${prior.caseId}`;
            console.log(`RUN ${caseId}`);
            let binding, comparison, finish;
            const completed = new Promise(resolve => { finish = resolve; });
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(Object.assign(new Error('Controlled timeout'), { code: 'CONTROLLED_TIMEOUT' })), 90000);
            let modelCalls = 0;
            try {
                const result = await runAiAssistant({ messages: [{ role: 'user', content: prior.question }],
                    requestId: caseId, conversationId: caseId, signal: controller.signal,
                    env: { ...env, AI_ONTOLOGY_RELATION_SHADOW_ENABLED: 'true', AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED: 'true' } }, {
                    loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
                    fetchAiProvider: (m, o) => { modelCalls++; return fetchAiProvider(m, o); },
                    ontologyShadow: { databasePath: filename, recordBinding: r => { binding = r; }, record: r => { comparison = r; finish(); } },
                });
                const shadowTimer = setTimeout(finish, 2500); await completed; clearTimeout(shadowTimer);
                // Controlled OFF replay of the SAME formal receipts. No model/tool execution is repeated.
                const off = await observeShadow({ userText: prior.question, toolResults: result.toolResults, requestId: `${caseId}-off-replay` }, { databasePath: filename });
                binding ||= bindRelation({ ontologyVersion: 1, userText: prior.question, verifiedToolResults: result.toolResults });
                const entry = { repetition, historicalRun: historical.run, caseId: prior.caseId,
                    priorEligible: prior.eligible, priorStatus: prior.status,
                    bindingStatus: binding.status, boundRoot: binding.root, boundRelation: binding.relationId,
                    offEligible: Boolean(off.root), offStatus: off.comparison.status,
                    onEligible: Boolean(comparison?.root), onStatus: comparison?.comparison.status || 'TECHNICAL_FAILURE',
                    observedRelation: comparison?.relationId || null,
                    modelCalls, toolNames: result.toolResults.map(t => t.name),
                    failedTools: result.toolResults.filter(t => t.result?.success === false).map(t => ({ name: t.name,
                        code: typeof t.result.code === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(t.result.code) ? t.result.code : 'QUERY_FAILURE' })),
                };
                cases.push(entry); console.log(JSON.stringify(entry));
            } catch (error) {
                const entry = { repetition, historicalRun: historical.run, caseId: prior.caseId, priorEligible: prior.eligible,
                    priorStatus: prior.status, bindingStatus: 'INSUFFICIENT_CONTEXT', offEligible: false, onEligible: false,
                    offStatus: 'TECHNICAL_FAILURE', onStatus: 'TECHNICAL_FAILURE', modelCalls,
                    code: typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'CURRENT_RUNTIME_FAILURE' };
                cases.push(entry); console.log(JSON.stringify(entry));
            } finally { clearTimeout(timer); }
        }
        const stats = field => Object.fromEntries([...new Set(cases.map(c => c[field]))].map(s => [s, cases.filter(c => c[field] === s).length]));
        const comparable = c => ['MATCH', 'MISMATCH'].includes(c);
        const questions = [...new Set(cases.map(c => c.caseId))];
        const stability = questions.map(caseId => {
            const group = cases.filter(c => c.caseId === caseId), bound = group.filter(c => c.bindingStatus === 'BOUND');
            return { caseId, executions: group.length, boundExecutions: bound.length,
                stableRoot: bound.length === group.length && new Set(bound.map(c => JSON.stringify(c.boundRoot))).size === 1,
                stableRelation: bound.length === group.length && new Set(bound.map(c => c.boundRelation)).size === 1,
                bindingVariance: new Set(group.map(c => JSON.stringify([c.bindingStatus, c.boundRoot, c.boundRelation]))).size > 1 };
        });
        const report = { version: 1, provider: provider.provider, model: provider.model, total: cases.length,
            frozenTotal: 30, repetitions: 2, historicalEligiblePerFrozen: 14, historicalComparedPerFrozen: 12,
            offEligible: cases.filter(c => c.offEligible).length, onEligible: cases.filter(c => c.onEligible).length,
            offCompared: cases.filter(c => comparable(c.offStatus)).length, onCompared: cases.filter(c => comparable(c.onStatus)).length,
            eligibilityRegressions: cases.filter(c => c.offEligible && !c.onEligible).length,
            comparableRegressions: cases.filter(c => comparable(c.offStatus) && !comparable(c.onStatus)).length,
            wrongRootBindings: cases.filter(c => c.bindingStatus === 'BOUND' && (!expectedBindings[c.caseId] || c.boundRoot?.entityType !== expectedBindings[c.caseId][0] || c.boundRoot?.canonicalId !== expectedBindings[c.caseId][1])).length,
            wrongRelationBindings: cases.filter(c => c.bindingStatus === 'BOUND' && c.boundRelation !== expectedBindings[c.caseId]?.[2]).length,
            bindingCounts: stats('bindingStatus'), offCounts: stats('offStatus'), onCounts: stats('onStatus'), stability,
            databaseUnchanged: changes === db.prepare('SELECT total_changes() n').get().n && db.serialize().equals(baseline), cases };
        fs.mkdirSync('logs', { recursive: true });
        fs.writeFileSync('logs/ont-p4-real-results.json', JSON.stringify(report, null, 2) + '\n', 'utf8');
        console.log(JSON.stringify({ ...report, cases: undefined }));
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        db?.close(); fs.rmSync(directory, { recursive: true, force: true });
    }
}
main().catch(() => { console.error('CONTROLLED_BINDING_CORPUS_SETUP_FAILED'); process.exitCode = 1; });
