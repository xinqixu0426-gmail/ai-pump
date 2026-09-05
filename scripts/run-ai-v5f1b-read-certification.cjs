'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/ai-governance/data/v5-f1b-read-execution-certification.json');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const { dbSnapshot, freezeHashes: previousHashes } = require('./run-ai-v5e4r-nested-refinement-evaluation.cjs');
const files = ['api/services/ai-v5/coilReadComparator.cjs', 'scripts/run-ai-v5f1b-read-certification.cjs', 'scripts/certify-v5-f1b-performance.cjs', 'tests/aiV5CoilReadBinding.test.cjs', 'api/services/ai-v5/readExecutionRegistry.cjs', 'api/services/ai-v5/readArgumentBinder.cjs',
    'api/services/ai-v5/readExecutionShadow.cjs', 'api/services/ai-v5/verification.cjs', 'api/services/ai-v5/evidenceRequirements.cjs',
    'api/routes/ai/executor.cjs', 'api/routes/ai/executors/queryExecutors.cjs', 'api/routes/ai/executors/businessExecutors.cjs',
    'scripts/run-ai-v5f1-read-execution.cjs', 'tests/aiV5ReadExecutionShadow.test.cjs'];
function freezeHashes() { return { ...previousHashes(), ...Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(path.join(root, file)))])) }; }
function fileState(file) { const s = fs.statSync(file); return { hash: hash(fs.readFileSync(file)), mtimeMs: s.mtimeMs, size: s.size }; }
const pct = (v, p) => [...v].sort((a, b) => a - b)[Math.ceil(v.length * p) - 1] ?? null;

async function openFixture() {
    // Existing project test-database convention. No changes to the source business DB.
    process.env.NODE_ENV = 'test'; process.env.NODE_TEST_CONTEXT = '1';
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pump-v5-f1b-'));
    const template = path.join(dir, 'fixture-{pid}.db'), file = template.replace('{pid}', String(process.pid));
    fs.copyFileSync(path.join(root, 'pump.db'), file);
    process.env.PUMP_TEST_DATABASE_PATH = template;
    const database = require('../api/db.cjs');
    const cost = require('../api/routes/cost.cjs'); cost.stopCopperPriceScheduler(); database.stopBackupScheduler();
    database.db.pragma('wal_checkpoint(TRUNCATE)'); database.db.pragma('query_only = ON');
    const before = fileState(file);
    const express = require('express'), app = express(); app.use(express.json());
    const secret = crypto.randomUUID(); process.env.INTERNAL_SECRET = secret;
    const calls = [];
    app.use((req, res, next) => {
        if (req.headers['x-internal-secret'] !== secret) return res.sendStatus(401);
        if (!(req.method === 'GET' || (req.method === 'POST' && req.path === '/api/entity-lookup'))) return res.sendStatus(403);
        calls.push({ operationId: req.headers['x-operation-id'] || null, method: req.method, lookup: req.path === '/api/entity-lookup' });
        next();
    });
    app.use('/api', cost);
    app.use('/api/parts', require('../api/routes/parts.cjs'));
    app.use('/api/coils', require('../api/routes/coils.cjs'));
    app.use('/api/recipes', require('../api/routes/recipes.cjs'));
    app.use('/api/entity-lookup', require('../api/routes/entityLookup.cjs').createEntityLookupRouter({ db: database.db }));
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    process.env.PORT = String(server.address().port);
    return { db: database.db, calls, file, before, dir, async close() {
        await new Promise(resolve => server.close(resolve));
        const after = fileState(file); database.db.close();
        return { before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) };
    } };
}

function fixtures(db) {
    const { createV5InterpreterInputEnvelope: envelope } = require('../api/services/ai-v5/taskInterpreterInput.cjs');
    const fingerprints = new Map(read('docs/ai-governance/data/v5-e4r-task-class-semantics-v1_1-evaluation.json').paths.map(p => [p.source_group_id, p.input_fingerprint]));
    // Frozen fixture reconstruction, never used in the production binder.
    const definitions = {
        COIL_INVENTORY: ['SELECT id,scheme_code AS identity FROM coils', '当前库存是多少'],
        EXACT_RECIPE_COST: ['SELECT id,name AS identity FROM recipes WHERE deleted_at IS NULL', '现在的完整成本是多少'],
        FLAT_BLADE_PRICE: ['SELECT id,model AS identity FROM parts WHERE deleted_at IS NULL', '现在多少钱'],
        PART_INVENTORY_PRIMARY: ['SELECT id,model AS identity FROM parts WHERE deleted_at IS NULL', '当前库存是多少'],
        PART_INVENTORY_REPEAT: ['SELECT id,model AS identity FROM parts WHERE deleted_at IS NULL', '当前库存是多少'],
    };
    return new Map(Object.entries(definitions).map(([group, [query, suffix]]) => {
        const row = db.prepare(query).all().find(r => envelope({ rawUserRequest: `${r.identity}${suffix}`, pageContext: null }).inputFingerprint === fingerprints.get(group));
        assert.ok(row, 'FROZEN_FIXTURE_UNAVAILABLE');
        return [group, { source: `${row.identity}${suffix}`, mention: row.identity, id: String(row.id) }];
    }));
}

async function main() {
    require('dotenv').config({ quiet: true });
    const preflight = process.argv.includes('--preflight');
    if (!preflight && fs.existsSync(output)) throw Error('FORMAL_EVALUATION_ALREADY_STARTED');
    const before = dbSnapshot();
    const prior = read('docs/ai-governance/data/v5-f1-read-execution-shadow-evaluation.json');
    const hashes = freezeHashes();
    for (const [key, value] of Object.entries(prior.postEvalHashes)) {
        if (!['api/services/ai-v5/independentShadow.cjs', 'api/services/ai-v5/typeIndependentEntityResolver.cjs', 'api/services/entityLookupService.cjs', 'api/services/ai-v5/readExecutionRegistry.cjs', 'api/services/ai-v5/readArgumentBinder.cjs', 'api/services/ai-v5/readExecutionShadow.cjs'].includes(key)) assert.equal(hashes[key], value, key);
    }
    const fixture = await openFixture();
    const sources = fixtures(fixture.db);
    const { createInternalFetch, getJson } = require('../api/routes/ai/internalApiClient.cjs');
    const { executeToolCall } = require('../api/routes/ai/executor.cjs');
    const { createV5Task, createV5EntityReference } = require('../api/services/ai-v5/contracts.cjs');
    const { runReadExecutionShadow } = require('../api/services/ai-v5/readExecutionShadow.cjs');
    const env = { ...process.env, AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true' };
    const observation = require('../api/services/observability.cjs');
    const data = { version: 1, formalEvaluationRuns: preflight ? 0 : 1, frozenPaths: 15, executionApplicable: 15,
        preEvalHashes: hashes, paths: [], fixtureMode: 'EXISTING_BUSINESS_ROUTES_ISOLATED_QUERY_ONLY_SNAPSHOT' };
    try {
        if (preflight) {
            const part = sources.get('FLAT_BLADE_PRICE'), recipe = sources.get('EXACT_RECIPE_COST'), coil = sources.get('COIL_INVENTORY');
            for (const [tool, args] of [['search_parts', { keyword: part.mention }], ['preview_recipe_cost', { recipeId: Number(recipe.id) }], ['search_coils', { schemeCode: coil.mention }]]) {
                const r = await executeToolCall(tool, args, { allowWrite: false, operationId: crypto.randomUUID() });
                assert.equal(r.success, true, `FIXTURE_TOOL_FAILED_${tool}`);
            }
            const outcomes = await Promise.all(Array.from({ length: 10 }, (_, n) => {
                const id = `f1-concurrency-${n}`;
                return runReadExecutionShadow({ capabilityId: 'inventory.read', routeInput: { domain: 'catalog', operation: 'read_inventory', entityType: 'part' },
                    task: createV5Task({ taskId: id, createdAt: new Date().toISOString(), entityContext: [createV5EntityReference({
                        entityType: 'part', rawMention: part.mention, canonicalEntityId: part.id, resolutionReceiptRef: `${id}:fixture`,
                    })] }) }, { env });
            }));
            assert.ok(outcomes.every(o => o.verificationStatus === 'PASS' && o.toolCalls === 1));
            data.preflight = { toolCalls: 13, modelCalls: 0, concurrency: 10, contamination: 0, verified: outcomes.length };
        } else {
            assert.ok(process.env.DEEPSEEK_API_KEY, 'PROVIDER_UNAVAILABLE');
            observation.initializeObservability({ env: { ...process.env, AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata', AI_OBSERVABILITY_PROJECT: 'pump-ai-v5-f1b-read-execution' } });
            const expected = read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;
            assert.equal(expected.length, 15);
            const frozen = read('docs/ai-observability/data/p06-failure-cases.json');
            const { createV5InterpreterInputEnvelope } = require('../api/services/ai-v5/taskInterpreterInput.cjs');
            const { runV5IndependentShadow } = require('../api/services/ai-v5/independentShadow.cjs');
            fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
            for (const oracle of expected) {
                const source = sources.get(oracle.source_group), shadowTaskId = `f1-${crypto.randomUUID()}`;
                const old = frozen.find(p => p.case_id === oracle.case_id);
                // Independent formal API comparator, not V4 model answers, not re-executed V4 Tools.
                let comparator = () => 'NOT_COMPARABLE';
                const referenceFetch = createInternalFetch({ operationId: `oracle-${shadowTaskId}` });
                if (oracle.expected_entity_type === 'coil') {
                    const { lookupEntities } = require('../api/routes/ai/internalApiClient.cjs');
                    const lookup = await lookupEntities(referenceFetch, { version: 1, mention: source.mention, entityTypes: ['coil'], matchPolicy: 'EXACT' });
                    assert.ok(lookup.complete && lookup.candidates.length === 1 && lookup.candidates[0].canonicalId === source.id);
                    const binding = lookup.candidates[0].bindingRefs.find(r => r.kind === 'schemeCode');
                    assert.ok(binding, 'ORACLE_BINDING_UNAVAILABLE');
                    const rows = await getJson(referenceFetch, '/api/coils?schemeCode=' + encodeURIComponent(binding.value));
                    const { compareCoilRead } = require('../api/services/ai-v5/coilReadComparator.cjs');
                    comparator = result => compareCoilRead(result, rows, source.id);
                } else if (oracle.expected_entity_type === 'part') {
                    const rows = await getJson(referenceFetch, `/api/parts?keyword=${encodeURIComponent(source.mention)}`);
                    const shape = r => ({ id: String(r.id ?? r.Id), model: r.model, stock: r.stock, price: r.price });
                    const expectedDigest = hash(JSON.stringify(rows.map(shape)));
                    comparator = result => Array.isArray(result.parts) && hash(JSON.stringify(result.parts.map(shape))) === expectedDigest ? 'MATCH' : 'MISMATCH';
                } else if (oracle.expected_entity_type === 'recipe') {
                    const current = await getJson(referenceFetch, '/api/recipes/current-costs');
                    const reference = current.items.find(r => String(r.recipeId) === source.id);
                    assert.ok(reference, 'ORACLE_ENTITY_UNAVAILABLE');
                    comparator = result => String(result.data?.recipeId) === source.id
                        && result.data?.currentTotalCost === reference.currentTotalCost ? 'MATCH' : 'MISMATCH';
                }
                const record = await observation.withAgentSpan({ requestId: shadowTaskId, route: 'v5-f1-read-shadow' }, async () => {
                    const traceId = observation.getActiveTraceContext()?.traceId || null;
                    const result = await runV5IndependentShadow({ shadowTaskId, interpreterEnvelope: createV5InterpreterInputEnvelope({ rawUserRequest: source.source, pageContext: null }) },
                        { env, internalFetch: createInternalFetch({ operationId: shadowTaskId }), compareReadResult: comparator });
                    const execution = result.readExecution || {};
                    return { case_id: oracle.case_id, executionApplicable: true, capabilityMatch: result.capabilityId === oracle.expected_capability,
                        toolSelectionStatus: execution.toolSelectionStatus || 'NOT_RUN', toolMatch: execution.toolName === old.expected.primary_tool,
                        argumentValidation: execution.argumentValidation || 'NOT_RUN', argumentKeySignature: execution.argumentKeySignature || [],
                        argumentTypeSignature: execution.argumentTypeSignature || [], executionStatus: execution.executionStatus || 'NOT_RUN',
                        resultComparison: execution.resultComparison || 'NOT_COMPARABLE', evidenceStatus: execution.evidenceStatus || 'NOT_RUN',
                        verificationStatus: execution.verificationStatus || 'NOT_RUN', evidenceCount: execution.evidenceCount || 0,
                        writeBlocked: execution.writeBlocked || false, reasonCodes: execution.reasonCodes || result.reasonCodes,
                        modelCalls: result.modelCalls, lookupCalls: result.architectureMetadata?.businessApiCalls || 0,
                        toolCalls: execution.toolCalls || 0, toolReadCalls: execution.businessApiReadCalls || 0,
                        durationMs: execution.durationMs || null, traceId, shadowTaskId };
                });
                assert.ok(![...sources.values()].some(s => JSON.stringify(record).includes(s.mention) || JSON.stringify(record).includes(s.source)), 'PRIVACY_FAILED');
                data.paths.push(record); fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
                console.log(JSON.stringify({ case_id: record.case_id, execution: record.executionStatus, verification: record.verificationStatus, comparator: record.resultComparison }));
            }
            data.metrics = { toolCalls: data.paths.reduce((n, p) => n + p.toolCalls, 0),
                modelCalls: data.paths.reduce((n, p) => n + p.modelCalls, 0),
                lookupCalls: data.paths.reduce((n, p) => n + p.lookupCalls, 0),
                toolReadCalls: data.paths.reduce((n, p) => n + p.toolReadCalls, 0),
                medianCompletion: pct(data.paths.filter(p => p.toolCalls).map(p => p.durationMs), .5),
                p95Completion: pct(data.paths.filter(p => p.toolCalls).map(p => p.durationMs), .95) };
        }
    } finally {
        await observation.safeForceFlush(); await observation.safeShutdown();
        data.fixtureSafety = await fixture.close();
        data.databaseBefore = before; data.databaseAfter = dbSnapshot();
        data.databaseUnchanged = JSON.stringify(before) === JSON.stringify(data.databaseAfter);
        data.postEvalHashes = freezeHashes(); data.hashesMatch = JSON.stringify(hashes) === JSON.stringify(data.postEvalHashes);
        if (!preflight && fs.existsSync(output)) fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
        console.log(JSON.stringify({ preflight: data.preflight || null, databaseUnchanged: data.databaseUnchanged, fixtureUnchanged: data.fixtureSafety.unchanged, hashesMatch: data.hashesMatch, metrics: data.metrics || null }));
        assert.ok(data.databaseUnchanged && data.fixtureSafety.unchanged && data.hashesMatch, 'SAFETY_INVARIANT_FAILED');
        // Preserve the temporary fixture for diagnosis; never delete-to-pass.
    }
}
if (require.main === module) main().catch(() => { console.error('V5_F1_EVALUATION_BLOCKED'); process.exitCode = 1; });
module.exports = { freezeHashes, openFixture, fixtures, fileState };
