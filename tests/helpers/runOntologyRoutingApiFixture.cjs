'use strict';
// Separate process prevents the shared DB singleton from touching a developer database.
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
async function main() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p6r-api-readonly-'));
    const filename = path.join(directory, 'fixture.db');
    let server, db;
    try {
        require('./ontologyShadowFixture.cjs').fixture(filename).close();
        Object.assign(process.env, { NODE_ENV: 'test', NODE_TEST_CONTEXT: 'ontology-routing-api-fixture',
            PUMP_TEST_DATABASE_PATH: filename, KNOWLEDGE_AUTO_SYNC_ENABLED: 'false', KNOWLEDGE_VECTOR_ENABLED: 'false' });
        const app = require('express')();
        app.use((req, res, next) => req.method === 'GET' ? next() : res.status(403).json({ success: false }));
        for (const name of ['coils', 'recipes']) app.use(`/api/${name}`, require(`../../api/routes/${name}.cjs`));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        process.env.PORT = String(server.address().port); db = require('../../api/db.cjs').db;
        const { executeToolCall } = require('../../api/routes/ai/executor.cjs');
        const { runAiAssistant } = require('../../api/services/aiAssistantRuntime.cjs');
        const { beginAssistantSession } = require('../../api/services/aiAssistantSession.cjs');
        const router = require('../../api/ontology/relationRoutingCanary.cjs');
const { prepareRouting } = router;
// The canary may legitimately perform extra formal reads that legacy did not make; the invariant is
// that it only executes capabilities its own profile sanctions.
const sanctionedCapabilities = new Set(router.requiredReads.map(read => read.capability).concat(router.profiles.flatMap(profile => profile.shortlist)));
        const { currentFactsForBinding } = require('../../api/ontology/bindingCurrentFacts.cjs');
        const { cases, runCase } = require('./ontologyRoutingCorpus.cjs');
        const baseline = db.serialize(), changes = db.prepare('SELECT total_changes() n').get().n;
        // Freeze only default Date construction (formal provenance fetchedAt), preserving real
        // Date.now()/timeouts/session TTL. Both fixture sides have the same observation clock.
        const RealDate = Date;
        global.Date = class FixtureDate extends RealDate {
            constructor(...args) { super(...(args.length ? args : ['2026-09-18T00:00:00.000Z'])); }
        };
        for (const c of cases.filter(c => c.category === 'positive')) {
            const name = c.root.entityType === 'coil' ? 'search_coils' : 'get_all_recipes';
            const args = c.root.entityType === 'coil' ? { spec: '12', sheets: 120 } : { keyword: 'Shadow配方甲' };
            const seed = [{ name, args, result: await executeToolCall(name, args, { allowWrite: false }) }];
            let off;
            for (const flag of ['false', 'true']) {
                const conversationId = `api-${c.caseId}-${flag}`, subject = 'p6r-fixture-owner';
                beginAssistantSession(subject, conversationId).finish({ toolResults: seed });
                const state = prepareRouting({ userText: c.userText, env: { AI_PROVIDER: 'local' }, shortlistEnabled: true,
                    tools: require('../../api/services/aiAssistantRuntime.cjs').assistantReadTools(), trustedToolResults: seed,
                    subject, conversationId, trustedSession: { subject, conversationId, observedAt: Date.now(), toolResults: seed } });
                assert.equal(state.binding.status, 'BOUND'); assert.deepEqual(state.binding.root, c.root);
                const r = await runCase(c, flag, runAiAssistant, { seed: false, input: { conversationId, confirmationSubject: subject },
                    forbidLegacy: flag === 'true', dependencies: { executeToolCall } });
                const facts = currentFactsForBinding(state.binding, r.result.toolResults);
                assert.deepEqual(facts.canonicalTargetIds, c.root.entityType === 'coil' ? ['301'] : ['501']);
                const observed = { toolNames: r.result.toolResults.map(t => t.name), answer: r.result.finalContent, calls: r.signature.modelCalls,
                    canonicalTargets: facts.canonicalTargetIds };
                if (flag === 'false') off = observed; else {
                    // The canary plans its required formal reads in software before the first model
                    // call, so the ordered call list differs from legacy. Formal outcome must hold:
                    // the same canonical targets, the same answer, and no extra provider calls.
                    assert.equal(r.records[0].routingSource, 'ONTOLOGY_RELATION_BINDING');
                    assert.deepEqual(observed.canonicalTargets, off.canonicalTargets);
                    assert.deepEqual(observed.answer, off.answer);
                    assert.ok(observed.calls <= off.calls, `ontology added provider calls (${observed.calls} > ${off.calls})`);
                    for (const name of observed.toolNames) assert.ok(sanctionedCapabilities.has(name), `unexpected ontology tool ${name}`);
                }
            }
        }
        assert.deepEqual(db.serialize(), baseline); assert.equal(db.prepare('SELECT total_changes() n').get().n, changes);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (db?.open) db.close();
        const resolved = path.resolve(directory);
        assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
