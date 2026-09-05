'use strict';
// Single frozen certification. Each task is established once in the existing isolated
// query-only harness; subsequent fact access must perform no Tool or API work.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/ai-governance/data/v5-f2b-runtime-handoff-certification.json');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const { openFixture, fixtures } = require('./run-ai-v5f1b-read-certification.cjs');
const { dbSnapshot } = require('./run-ai-v5e4r-nested-refinement-evaluation.cjs');
const { freeze: priorFreeze } = require('./run-ai-v5f2a-price-evidence-certification.cjs');
const freeze = () => ({ ...priorFreeze(),
    runtimeHandoffCertification: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    runtimeHandoffTests: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'tests/aiV5RuntimeHandoff.test.cjs'))).digest('hex') });
const answerFacts = Object.freeze({ COIL_INVENTORY: 'coil.inventory', EXACT_RECIPE_COST: 'recipe.cost.preview',
    FLAT_BLADE_PRICE: 'price.current', PART_INVENTORY_PRIMARY: 'inventory.quantity', PART_INVENTORY_REPEAT: 'inventory.quantity' });
async function main() {
    assert.equal(fs.existsSync(output), false, 'CERTIFICATION_ALREADY_STARTED');
    const oracle = read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;
    assert.equal(oracle.length, 15); assert.equal(new Set(oracle.map(p => p.case_id)).size, 15);
    const applicable = Object.fromEntries(['price.current', 'inventory.quantity', 'coil.inventory', 'recipe.cost.preview'].map(k => [k, oracle.filter(p => answerFacts[p.source_group] === k).length]));
    assert.deepEqual(Object.values(applicable), [3, 6, 3, 3]);
    const before = dbSnapshot(), hashes = freeze();
    const baseline = read('docs/ai-governance/data/v5-f2a-price-evidence-certification.json');
    for (const [file, hash] of Object.entries(baseline.postCertificationHashes)) {
        if (!['api/services/ai-v5/fieldReadEvidence.cjs', 'api/services/ai-v5/readExecutionShadow.cjs'].includes(file)) assert.equal(hashes[file], hash, 'FROZEN_COMPONENT_CHANGED');
    }
    const data = { version: 1, formalCertificationRuns: 1, mode: 'SAME_TASK_RUNTIME_IN_ISOLATED_QUERY_ONLY_FIXTURE',
        frozenPaths: 15, answerFactApplicability: applicable, preCertificationHashes: hashes, paths: [],
        answerModelCalls: 0, toolCallsByAccessor: 0, apiCallsByAccessor: 0, writes: 0, allowWriteEnablingCalls: 0, businessMutationCalls: 0 };
    fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    let fixture, sources;
    const logs = [], spans = [], saved = Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(k => [k, console[k]]));
    for (const key of Object.keys(saved)) console[key] = (...args) => logs.push(args.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' '));
    const obs = require('../api/services/observability.cjs');
    try {
        obs.initializeObservability({ env: { AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata' },
            phoenixModule: { register: () => ({ getTracer: () => ({ startActiveSpan(name, options, run) {
                const item = { name, attributes: { ...options.attributes } }; spans.push(item);
                return run({ setAttributes: a => Object.assign(item.attributes, a), setAttribute: (k, v) => { item.attributes[k] = v; }, setStatus() {}, end() {}, updateName() {} });
            } }), forceFlush: async () => {}, shutdown: async () => {} }) }, logger: { warn() {} } });
        fixture = await openFixture(); sources = fixtures(fixture.db);
        const { createInternalFetch, lookupEntities } = require('../api/routes/ai/internalApiClient.cjs');
        const { createV5Task, createV5EntityReference } = require('../api/services/ai-v5/contracts.cjs');
        const { runReadExecutionShadow } = require('../api/services/ai-v5/readExecutionShadow.cjs');
        const { getVerifiedEvidenceValue } = require('../api/services/ai-v5/fieldReadEvidence.cjs');
        const { listEvidenceRequirements } = require('../api/services/ai-v5/evidenceRequirements.cjs');
        const executor = require('../api/routes/ai/executor.cjs');
        let executionCount = 0, allReadFacts = 0;
        for (const p of oracle) {
            const source = sources.get(p.source_group), taskId = crypto.randomUUID(), factKey = answerFacts[p.source_group];
            const lookup = await lookupEntities(createInternalFetch({ operationId: taskId }), { version: 1, mention: source.mention,
                entityTypes: ['coil', 'customer', 'order', 'part', 'recipe', 'template'], matchPolicy: 'EXACT' });
            assert.equal(lookup.complete, true);
            const candidates = lookup.candidates.filter(c => c.entityType === p.expected_entity_type && String(c.canonicalId) === source.id);
            assert.equal(candidates.length, 1);
            const entity = createV5EntityReference({ entityType: p.expected_entity_type, canonicalEntityId: source.id,
                rawMention: source.mention, resolutionReceiptRef: taskId + ':entity' });
            const task = createV5Task({ taskId, entityContext: [entity], createdAt: new Date().toISOString() });
            const out = await runReadExecutionShadow({ task, capabilityId: p.expected_capability, authoritativeCandidate: candidates[0],
                routeInput: { domain: p.expected_domain, operation: p.expected_operation, entityType: p.expected_entity_type },
                requiredFactKeys: factKey === 'price.current' ? ['price.current'] : [] }, {
                env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true' },
                execute: (...args) => { executionCount++; return executor.executeToolCall(...args); } });
            const keys = [...listEvidenceRequirements(p.expected_capability).map(r => r.claimType), ...(factKey === 'price.current' ? [factKey] : [])];
            const beforeAccessCalls = fixture.calls.length, beforeAccessExecutions = executionCount;
            const availability = [], types = [];
            for (const key of keys) {
                const context = { taskId, entity, factKey: key, sourceExecutionId: key === 'price.current' ? out.sourceExecutionId : taskId + ':tool' };
                let available = false;
                try {
                    const value = getVerifiedEvidenceValue(out.verifiedEvidenceHandle, context);
                    available = typeof value.runtimeValue === 'number' && Number.isFinite(value.runtimeValue);
                    assert.equal(JSON.stringify(value).includes('runtimeValue'), false);
                } catch { available = false; }
                availability.push(available); types.push(available ? 'number' : 'unavailable');
                for (const bad of [{ taskId: 'other-task' }, { entity: { ...entity, canonicalEntityId: 'other-entity' } }, { factKey: 'unknown' }]) {
                    assert.throws(() => getVerifiedEvidenceValue(out.verifiedEvidenceHandle, { ...context, ...bad }), /ACCESS_DENIED/);
                }
            }
            assert.equal(fixture.calls.length, beforeAccessCalls); assert.equal(executionCount, beforeAccessExecutions);
            allReadFacts += availability.filter(Boolean).length;
            data.paths.push({ case_id: p.case_id, requiredFactKeys: keys, handoffAvailable: availability,
                factTypeSignature: types, verificationStatus: out.verificationStatus,
                reasonCodes: [availability.every(Boolean) ? 'VERIFIED_RUNTIME_FACTS_AVAILABLE' : 'VERIFIED_VALUE_UNAVAILABLE'] });
            fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
        }
        data.metrics = { pathsWithAllFacts: data.paths.filter(p => p.handoffAvailable.every(Boolean) && p.verificationStatus === 'PASS').length,
            requiredLedgerFacts: 18, availableLedgerFacts: allReadFacts, fixtureTaskEstablishmentExecutions: executionCount,
            handoffByAnswerFact: Object.fromEntries(Object.keys(applicable).map(k => [k, data.paths.filter(p => {
                const o = oracle.find(x => x.case_id === p.case_id); return answerFacts[o.source_group] === k && p.handoffAvailable[p.requiredFactKeys.indexOf(k)];
            }).length])) };
        const visible = JSON.stringify({ data, spans, logs });
        data.privacy = { sourceLeaks: [...sources.values()].filter(s => visible.includes(s.mention) || visible.includes(s.source)).length,
            valueFields: (visible.match(/"(?:runtimeValue|canonicalId|canonicalEntityId|stock|price|currentTotalCost)"\s*:/gu) || []).length,
            normalLogCount: logs.length, metadataSpanCount: spans.length };
    } catch { data.fatalReason = 'HANDOFF_CERTIFICATION_FAILED'; }
    finally {
        if (fixture) data.fixtureSafety = await fixture.close();
        await obs.safeShutdown(); for (const [k, v] of Object.entries(saved)) console[k] = v;
        data.postCertificationHashes = freeze(); data.hashesMatch = JSON.stringify(hashes) === JSON.stringify(data.postCertificationHashes);
        data.databaseBefore = before; data.databaseAfter = dbSnapshot(); data.databaseUnchanged = JSON.stringify(before) === JSON.stringify(data.databaseAfter);
        data.pass = !data.fatalReason && data.metrics?.pathsWithAllFacts === 15 && data.metrics?.availableLedgerFacts === 18
            && data.hashesMatch && data.databaseUnchanged && data.fixtureSafety?.unchanged && data.privacy?.sourceLeaks === 0 && data.privacy?.valueFields === 0;
        fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
    }
    console.log(JSON.stringify({ pass: data.pass, metrics: data.metrics, privacy: data.privacy, databaseUnchanged: data.databaseUnchanged, hashesMatch: data.hashesMatch, fatalReason: data.fatalReason }));
    if (!data.pass) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { console.error('HANDOFF_CERTIFICATION_STOPPED'); process.exitCode = 1; });
module.exports = { freeze };
