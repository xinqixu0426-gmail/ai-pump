'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const root = path.resolve(__dirname, '..');
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const { openFixture, fixtures } = require('./run-ai-v5f1b-read-certification.cjs');
const { dbSnapshot } = require('./run-ai-v5e4r-nested-refinement-evaluation.cjs');
const oldFreeze = require('./run-ai-v5f2b-runtime-handoff-certification.cjs').freeze;
const answerFiles = ['readAnswerContract', 'readAnswerComposer', 'readAnswerValidator', 'readAnswerNumericValidator', 'readAnswerEntityValidator'].map(n => `api/services/ai-v5/${n}.cjs`);
const freeze = () => ({ ...oldFreeze(), ...Object.fromEntries([...answerFiles, 'api/services/observability.cjs', 'scripts/run-ai-v5f2b-answer-formal.cjs', 'tests/aiV5ReadAnswer.test.cjs'].map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')])) });
const required = Object.freeze({ COIL_INVENTORY: 'coil.inventory', EXACT_RECIPE_COST: 'recipe.cost.preview', FLAT_BLADE_PRICE: 'price.current', PART_INVENTORY_PRIMARY: 'inventory.quantity', PART_INVENTORY_REPEAT: 'inventory.quantity' });
async function readTask(oracle, source, taskId) {
    const { createInternalFetch, lookupEntities, getJson } = require('../api/routes/ai/internalApiClient.cjs');
    const { createV5Task, createV5EntityReference } = require('../api/services/ai-v5/contracts.cjs');
    const { runReadExecutionShadow } = require('../api/services/ai-v5/readExecutionShadow.cjs');
    const fetch = createInternalFetch({ operationId: taskId });
    const lookup = await lookupEntities(fetch, { version: 1, mention: source.mention, entityTypes: ['coil', 'customer', 'order', 'part', 'recipe', 'template'], matchPolicy: 'EXACT' });
    assert.equal(lookup.complete, true);
    const matches = lookup.candidates.filter(c => c.entityType === oracle.expected_entity_type && String(c.canonicalId) === source.id);
    assert.equal(matches.length, 1);
    let compare;
    if (oracle.expected_entity_type === 'part') {
        const ref = await getJson(fetch, '/api/parts?keyword=' + encodeURIComponent(source.mention));
        const shape = rows => rows.map(r => ({ id: String(r.id ?? r.Id), model: r.model, stock: r.stock, price: r.price }));
        const serialized = JSON.stringify(shape(ref));
        compare = r => Array.isArray(r.parts) && JSON.stringify(shape(r.parts)) === serialized ? 'MATCH' : 'MISMATCH';
    } else if (oracle.expected_entity_type === 'coil') {
        const code = matches[0].bindingRefs.find(r => r.kind === 'schemeCode').value;
        const ref = await getJson(fetch, '/api/coils?schemeCode=' + encodeURIComponent(code));
        compare = r => require('../api/services/ai-v5/coilReadComparator.cjs').compareCoilRead(r, ref, source.id);
    } else {
        const ref = await getJson(fetch, '/api/recipes/current-costs'), rows = ref.items.filter(r => String(r.recipeId) === source.id);
        assert.equal(rows.length, 1);
        compare = r => String(r.data?.recipeId) === source.id && r.data.currentTotalCost === rows[0].currentTotalCost ? 'MATCH' : 'MISMATCH';
    }
    const entity = createV5EntityReference({ entityType: oracle.expected_entity_type, canonicalEntityId: source.id, rawMention: source.mention, resolutionReceiptRef: taskId + ':entity' });
    const factKey = required[oracle.source_group]; assert.ok(factKey);
    const execution = await runReadExecutionShadow({ task: createV5Task({ taskId, createdAt: new Date().toISOString(), entityContext: [entity] }),
        capabilityId: oracle.expected_capability, authoritativeCandidate: matches[0], requiredFactKeys: factKey === 'price.current' ? [factKey] : [],
        routeInput: { domain: oracle.expected_domain, operation: oracle.expected_operation, entityType: oracle.expected_entity_type } },
        { env: { AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true' }, compare });
    return { execution, taskId, entity, requiredFactKeys: [factKey], userRequest: source.source };
}
async function main() {
    require('dotenv').config({ quiet: true });
    const output = path.join(root, 'docs/ai-governance/data/v5-f2b-read-answer-shadow-formal-evaluation.json');
    assert.equal(fs.existsSync(output), false, 'ANSWER_EVAL_ALREADY_STARTED');
    const oracle = read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;
    const p06 = read('docs/ai-observability/data/p06-failure-cases.json');
    assert.equal(oracle.length, 15); assert.equal(new Set(oracle.map(x => x.case_id)).size, 15);
    const pre = freeze(), before = dbSnapshot();
    const baseline = read('docs/ai-governance/data/v5-f2b-runtime-handoff-certification.json');
    for (const [key, hash] of Object.entries(baseline.postCertificationHashes)) {
        if (key !== 'tests/aiV5Projection.test.cjs') assert.equal(pre[key], hash, 'FROZEN_HANDOFF_CHANGED');
    }
    const data = { version: 1, formalAnswerEvaluationRuns: 1, applicablePaths: 15, preEvalHashes: pre,
        requiredFactContract: oracle.map(p => ({ case_id: p.case_id, requiredFactKeys: [required[p.source_group]] })), paths: [],
        writes: 0, allowWriteEnablingCalls: 0, businessMutationCalls: 0, productionRouting: 0, userVisibleAnswers: 0 };
    fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    const obs = require('../api/services/observability.cjs'), als = new AsyncLocalStorage(), spans = [], logs = [];
    const saved = Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(k => [k, console[k]]));
    for (const k of Object.keys(saved)) console[k] = (...a) => logs.push(a.map(v => typeof v === 'string' ? v : JSON.stringify(v)).join(' '));
    let fixture, sources;
    try {
        obs.initializeObservability({ env: { AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata' },
            phoenixModule: { register: () => ({ getTracer: () => ({ startActiveSpan(name, options, run) {
                const parent = als.getStore(), record = { id: crypto.randomUUID(), parent: parent?.id || null, name, attributes: { ...options.attributes } }; spans.push(record);
                return als.run(record, () => run({ setAttributes: a => Object.assign(record.attributes, a), setAttribute: (k, v) => { record.attributes[k] = v; }, setStatus() {}, end() {}, updateName() {} }));
            } }), forceFlush: async () => {}, shutdown: async () => {} }) }, logger: { warn() {} } });
        fixture = await openFixture(); sources = fixtures(fixture.db);
        const { composeReadAnswer } = require('../api/services/ai-v5/readAnswerComposer.cjs');
        for (const p of oracle) {
            const taskId = crypto.randomUUID();
            const record = await obs.withAgentSpan({ requestId: taskId, route: 'v5-read-answer-shadow' }, async () => {
                const input = await readTask(p, sources.get(p.source_group), taskId);
                const answer = await composeReadAnswer(input, { env: { ...process.env, AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true', AI_V5_ANSWER_SHADOW_ENABLED: 'true' } });
                return { case_id: p.case_id, source_group_id: p.source_group, requiredFactKeys: input.requiredFactKeys,
                    readExecution: input.execution.executionStatus, resultEquivalence: input.execution.resultComparison,
                    evidenceVerification: input.execution.verificationStatus, toolCalls: input.execution.toolCalls,
                    priorV4Result: p06.find(x => x.case_id === p.case_id)?.result || 'UNKNOWN', ...answer };
            });
            data.paths.push(record); fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
            saved.log(JSON.stringify({ case_id: p.case_id, status: record.status, modelCalls: record.modelCalls }));
        }
        const answerSpans = spans.filter(s => s.name === 'pump.ai.v5.read-answer'), validations = spans.filter(s => s.name === 'pump.ai.v5.answer-validation');
        data.trace = { answerSpanCount: answerSpans.length, validationSpanCount: validations.length,
            orphanCount: [...answerSpans, ...validations].filter(s => !s.parent || !spans.some(p => p.id === s.parent && p.name === 'invoke_agent pump_factory_assistant')).length,
            crossRequestCount: [...answerSpans, ...validations].filter(s => { const parent = spans.find(p => p.id === s.parent); return !parent || parent.attributes['pump.request.id'] !== s.attributes['pump.ai.v5.shadow_task_id']; }).length };
        const visible = JSON.stringify({ data, spans, logs });
        data.privacy = { sourceLeakCount: [...sources.values()].filter(s => visible.includes(s.mention) || visible.includes(s.source)).length,
            businessValueFields: (visible.match(/"(?:answerText|numericValue|runtimeValue|canonicalId|stock|currentTotalCost|price)"\s*:/gu) || []).length, normalLogCount: logs.length };
    } catch { data.fatalReason = 'ANSWER_EVALUATION_INFRASTRUCTURE_FAILED'; }
    finally {
        if (fixture) data.fixtureSafety = await fixture.close();
        await obs.safeShutdown(); for (const [k, v] of Object.entries(saved)) console[k] = v;
        data.postEvalHashes = freeze(); data.hashesMatch = JSON.stringify(pre) === JSON.stringify(data.postEvalHashes);
        data.databaseBefore = before; data.databaseAfter = dbSnapshot(); data.databaseUnchanged = JSON.stringify(before) === JSON.stringify(data.databaseAfter);
        const n = key => data.paths.filter(p => p[key] === true).length;
        data.metrics = { recorded: data.paths.length, accepted: data.paths.filter(p => p.status === 'ANSWER_SHADOW_ACCEPTED').length,
            contractValid: n('contractValid'), refsValid: n('evidenceRefsValid'), groundingValid: n('groundingValid'), coverage: n('requiredFactCoverage'), numericValid: n('numericValid'), entityValid: n('entityValid'),
            modelCalls: data.paths.reduce((n, p) => n + p.modelCalls, 0), modelErrors: n('modelError'), modelTimeouts: n('modelTimeout'),
            unsupportedClaims: data.paths.reduce((n, p) => n + (p.unsupportedClaimCount || 0), 0), internalLeaks: data.paths.reduce((n, p) => n + (p.internalLeakageCount || 0), 0) };
        fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
    }
    console.log(JSON.stringify({ metrics: data.metrics, trace: data.trace, privacy: data.privacy, hashesMatch: data.hashesMatch, databaseUnchanged: data.databaseUnchanged, fatalReason: data.fatalReason }));
}
if (require.main === module) main().catch(() => { console.error('ANSWER_FORMAL_STOPPED'); process.exitCode = 1; });
module.exports = { readTask, required, freeze };
