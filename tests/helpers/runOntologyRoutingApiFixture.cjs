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
        db = require('../../api/db.cjs').db;
        // ONT-P8R: the canary's coil-rooted direction now reads the bounded canonical reverse relation
        // (`POST /api/relations/read`), so the fixture server must parse JSON bodies and expose exactly
        // that one write-shaped route while every other non-GET request stays refused.
        app.use(require('express').json());
        app.use((req, res, next) => req.method === 'GET' || req.path === '/api/relations/read'
            ? next() : res.status(403).json({ success: false }));
        for (const name of ['coils', 'recipes']) app.use(`/api/${name}`, require(`../../api/routes/${name}.cjs`));
        app.use('/api/relations', require('../../api/routes/relationRead.cjs').createRelationReadRouter({ db }));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        process.env.PORT = String(server.address().port);
        const { executeToolCall } = require('../../api/routes/ai/executor.cjs');
        const { runAiAssistant } = require('../../api/services/aiAssistantRuntime.cjs');
        const { beginAssistantSession } = require('../../api/services/aiAssistantSession.cjs');
        const router = require('../../api/ontology/relationRoutingCanary.cjs');
const { prepareRouting } = router;
// The canary may legitimately perform extra formal reads that legacy did not make; the invariant is
// that it only executes capabilities its own profile sanctions.
const sanctionedCapabilities = new Set(router.requiredReads.map(read => read.capability).concat(router.profiles.flatMap(profile => profile.shortlist)));
        const { currentFactsForBinding } = require('../../api/ontology/bindingCurrentFacts.cjs');
        const { boundRecipeDetail } = require('./ontologyShadowFixture.cjs');
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
            // ONT-P8L-FINAL: the recipe-rooted direction now certifies its coil through the bounded
            // `get_recipe_detail` read instead of the whole catalogue, so the fixture seeds that bounded
            // read as well. The real executor performs HTTP calls and this fixture has no HTTP server for
            // it, so the bounded detail is the same one the formal API returns for the coil-bound recipe.
            const seeds = [{ name, args, result: await executeToolCall(name, args, { allowWrite: false }) }];
            if (c.root.entityType === 'recipe') {
                const detail = boundRecipeDetail(Number(c.root.canonicalId) || 301);
                seeds.push({ name: 'get_recipe_detail', args: detail.args, result: detail.result });
            }
            const seed = seeds.map(entry => ({ ...entry, result: {
                ...entry.result,
                executionEvidence: { verified: true, kind: 'formal_api_query',
                    calls: [{ method: 'GET', path: entry.name === 'search_coils' ? '/api/coils'
                        : entry.name === 'get_recipe_detail' ? `/api/recipes/${entry.args.recipeId}` : '/api/recipes' }] },
            } }));
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
                const expectedTarget = c.root.entityType === 'coil' ? '301' : '501';
                // ONT-P8L (ruling B): the ontology side must certify the exact canonical target. The legacy
                // side may now certify NOTHING for a case whose query carries no coil shorthand, because the
                // bounded repair refuses to guess a root once `search_coils` returns several candidates —
                // that is the required fail-safe, not a regression. It must never certify a WRONG target.
                if (flag === 'true') assert.deepEqual(facts.canonicalTargetIds, [expectedTarget]);
                else assert.ok(['', expectedTarget].includes(facts.canonicalTargetIds.join(',')),
                    `legacy must certify ${expectedTarget} or nothing, never a wrong id (got ${JSON.stringify(facts.canonicalTargetIds)})`);
                const observed = { toolNames: r.result.toolResults.map(t => t.name), answer: r.result.finalContent, calls: r.signature.modelCalls,
                    canonicalTargets: facts.canonicalTargetIds };
                if (process.env.ONT_P8L_DEBUG) console.error(`DEBUG ${c.caseId} flag=${flag} tools=${JSON.stringify(observed.toolNames)} calls=${observed.calls} targets=${JSON.stringify(observed.canonicalTargets)} answer=${JSON.stringify(String(observed.answer).slice(0, 80))}`);
                if (flag === 'false') off = observed; else {
                    // The canary plans its required formal reads in software before the first model call, so
                    // the ordered call list differs from legacy. The formal outcome that must hold is: the
                    // ontology route certifies a canonical target, it never asserts a target legacy did not
                    // assert, and it adds no provider call.
                    // ONT-P8L (ruling B): legacy can now certify NOTHING where it previously leaned on the
                    // removed aggregate, so "identical targets" is no longer the right invariant — "never a
                    // target legacy did not certify" is.
                    assert.equal(r.records[0].routingSource, 'ONTOLOGY_RELATION_BINDING');
                    // The ontology route's exact canonical target is asserted above against the fixture's
                    // known truth, which is a stronger claim than "equal to legacy". Cross-checking against
                    // legacy here would be wrong under ONT-P8L ruling B: legacy can now certify nothing for
                    // a case whose query carries no coil shorthand, and the ontology route being BETTER than
                    // legacy is the goal, not a violation.
                    assert.ok(observed.canonicalTargets.length > 0, `${c.caseId}: ontology must certify a target`);
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
