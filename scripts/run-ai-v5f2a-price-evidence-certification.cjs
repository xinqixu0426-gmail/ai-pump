'use strict';
// One read/evidence certification, not an Interpreter/Answer model evaluation.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/ai-governance/data/v5-f2a-price-evidence-certification.json');
const read = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const { openFixture, fixtures } = require('./run-ai-v5f1b-read-certification.cjs');
const { dbSnapshot } = require('./run-ai-v5e4r-nested-refinement-evaluation.cjs');
const frozen = ['api/services/ai-v5/evidenceRequirements.cjs', 'api/services/ai-v5/evidenceLedger.cjs',
    'api/services/ai-v5/fieldReadEvidence.cjs', 'api/services/ai-v5/verification.cjs', 'api/services/ai-v5/readExecutionShadow.cjs',
    'api/services/ai-v5/coilReadComparator.cjs', 'api/services/ai-v5/readArgumentBinder.cjs',
    'api/services/ai-v5/readExecutionRegistry.cjs', 'api/services/ai-v5/taskState.cjs', 'api/services/ai-v5/policy.cjs',
    'api/services/ai-v5/candidateSet.cjs', 'api/services/ai-v5/capabilityRouter.cjs', 'api/services/ai-v5/toolExposure.cjs',
    'api/routes/ai/executors/queryExecutors.cjs', 'api/routes/ai/internalApiClient.cjs',
    'docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json',
    'docs/ai-observability/data/p06-failure-cases.json', 'docs/ai-governance/data/v5-e4r-task-class-semantics-v1_1-evaluation.json',
    'scripts/run-ai-v5f1b-read-certification.cjs', 'scripts/run-ai-v5f2a-price-evidence-certification.cjs',
    'tests/aiV5FieldReadEvidence.test.cjs', 'tests/aiV5Projection.test.cjs'];
const freeze = () => Object.fromEntries(frozen.map(file => [file, hash(fs.readFileSync(path.join(root, file)))]));
function safeRecord(record) {
    const allowed = ['case_id', 'requiredFactKeys', 'evidencePresence', 'evidenceValidity', 'verificationStatus',
        'runtimeHandoffAvailable', 'numericTypeMatch', 'toolMatch', 'argumentValidation', 'executionStatus',
        'resultComparison', 'evidenceCount', 'toolCalls', 'businessApiReadCalls', 'reasonCodes'];
    assert.ok(Object.keys(record).every(k => allowed.includes(k)), 'UNSAFE_DATASET_FIELD');
    assert.ok(Array.isArray(record.requiredFactKeys) && record.requiredFactKeys.every(k =>
        ['price.current', 'inventory.quantity', 'coil.inventory', 'recipe.cost.preview'].includes(k)), 'UNSAFE_FACT_KEY');
    for (const key of ['evidencePresence', 'evidenceValidity']) assert.ok(Array.isArray(record[key])
        && record[key].every(v => typeof v === 'boolean'), 'UNSAFE_EVIDENCE_METADATA');
    for (const key of ['runtimeHandoffAvailable', 'numericTypeMatch']) assert.ok(record[key] === null || typeof record[key] === 'boolean', 'UNSAFE_HANDOFF_METADATA');
    assert.ok(record.reasonCodes.every(code => /^[A-Z_]+$/u.test(code)), 'UNSAFE_REASON_CODE');
}
async function main() {
    assert.equal(fs.existsSync(output), false, 'FORMAL_CERTIFICATION_ALREADY_STARTED');
    const expected = read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;
    const p06 = read('docs/ai-observability/data/p06-failure-cases.json');
    assert.equal(expected.length, 15); assert.equal(new Set(expected.map(r => r.case_id)).size, 15);
    const priceIds = expected.filter(r => r.source_group === 'FLAT_BLADE_PRICE').map(r => r.case_id);
    assert.equal(priceIds.length, 3);
    const before = dbSnapshot();
    const data = { version: 1, startCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
        formalCertificationRuns: 1, certificationScope: 'FROZEN_READ_EXECUTION_AND_FIELD_EVIDENCE_ONLY',
        authoritativeTaskInputs: 'FROZEN_CONTRACTS_NOT_NEW_INTERPRETER_EVALUATION', frozenPaths: 15,
        priceApplicable: 3, preCertificationHashes: freeze(), paths: [], answerModelCalls: 0, interpreterModelCalls: 0,
        writes: 0, allowWriteEnablingCalls: 0, businessMutationCalls: 0, productionRouting: 0 };
    fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    let fixture;
    const logs = [], spans = [];
    const saved = Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(k => [k, console[k]]));
    for (const key of Object.keys(saved)) console[key] = (...args) => logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    const observation = require('../api/services/observability.cjs');
    let sources;
    try {
        // In-memory Phoenix-compatible sink: normal metadata sanitizer is exercised, no business content exported.
        observation.initializeObservability({ env: { AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata' },
            phoenixModule: { register: () => ({ getTracer: () => ({ startActiveSpan(name, options, operation) {
                const record = { name, attributes: { ...options.attributes } }; spans.push(record);
                return operation({ setAttributes: a => Object.assign(record.attributes, a),
                    setAttribute: (k, v) => { record.attributes[k] = v; }, setStatus() {}, end() {}, updateName() {} });
            } }), forceFlush: async () => {}, shutdown: async () => {} }) }, logger: { warn() {} } });
        fixture = await openFixture(); sources = fixtures(fixture.db);
        const { createInternalFetch, getJson, lookupEntities } = require('../api/routes/ai/internalApiClient.cjs');
        const { createV5Task, createV5EntityReference } = require('../api/services/ai-v5/contracts.cjs');
        const { runReadExecutionShadow } = require('../api/services/ai-v5/readExecutionShadow.cjs');
        const { listEvidenceRequirements } = require('../api/services/ai-v5/evidenceRequirements.cjs');
        const { getVerifiedEvidenceValue } = require('../api/services/ai-v5/fieldReadEvidence.cjs');
        const env = { AI_V5_SHADOW_ENABLED: 'true', AI_V5_EXECUTION_SHADOW_ENABLED: 'true' };
        for (const oracle of expected) {
            const source = sources.get(oracle.source_group), taskId = crypto.randomUUID();
            const price = priceIds.includes(oracle.case_id);
            const referenceFetch = createInternalFetch({ operationId: 'reference-' + taskId });
            const authoritative = await lookupEntities(referenceFetch, { version: 1, mention: source.mention,
                entityTypes: ['coil', 'customer', 'order', 'part', 'recipe', 'template'], matchPolicy: 'EXACT' });
            assert.equal(authoritative.complete, true, 'LOOKUP_INCOMPLETE');
            // Frozen expected type used only to prepare the read task, never to patch production resolution.
            const candidates = authoritative.candidates.filter(c => c.entityType === oracle.expected_entity_type && String(c.canonicalId) === source.id);
            assert.equal(candidates.length, 1, 'FROZEN_ENTITY_UNAVAILABLE');
            let comparator, priceReference;
            if (oracle.expected_entity_type === 'part') {
                const rows = await getJson(referenceFetch, '/api/parts?keyword=' + encodeURIComponent(source.mention));
                const shape = r => ({ id: String(r.id ?? r.Id), model: r.model, stock: r.stock, price: r.price });
                const digest = hash(JSON.stringify(rows.map(shape)));
                comparator = result => Array.isArray(result.parts) && hash(JSON.stringify(result.parts.map(shape))) === digest ? 'MATCH' : 'MISMATCH';
                const match = rows.filter(r => String(r.id) === source.id); assert.equal(match.length, 1);
                priceReference = match[0].price;
            } else if (oracle.expected_entity_type === 'coil') {
                const binding = candidates[0].bindingRefs.find(b => b.kind === 'schemeCode'); assert.ok(binding, 'BINDING_UNAVAILABLE');
                const rows = await getJson(referenceFetch, '/api/coils?schemeCode=' + encodeURIComponent(binding.value));
                comparator = result => require('../api/services/ai-v5/coilReadComparator.cjs').compareCoilRead(result, rows, source.id);
            } else {
                const reference = await getJson(referenceFetch, '/api/recipes/current-costs');
                const matches = reference.items.filter(r => String(r.recipeId) === source.id); assert.equal(matches.length, 1);
                comparator = result => String(result.data?.recipeId) === source.id && result.data.currentTotalCost === matches[0].currentTotalCost ? 'MATCH' : 'MISMATCH';
            }
            const entity = createV5EntityReference({ entityType: oracle.expected_entity_type, rawMention: source.mention,
                canonicalEntityId: source.id, resolutionReceiptRef: taskId + ':resolved' });
            const task = createV5Task({ taskId, createdAt: new Date().toISOString(), entityContext: [entity] });
            const out = await runReadExecutionShadow({ task, capabilityId: oracle.expected_capability,
                routeInput: { domain: oracle.expected_domain, operation: oracle.expected_operation, entityType: oracle.expected_entity_type },
                authoritativeCandidate: candidates[0], requiredFactKeys: price ? ['price.current'] : [] }, { env, compare: comparator });
            let handoff = null;
            if (price && out.verifiedEvidenceHandle) {
                const value = getVerifiedEvidenceValue(out.verifiedEvidenceHandle, { taskId, entity, sourceExecutionId: out.sourceExecutionId, factKey: 'price.current' });
                handoff = typeof value.runtimeValue === 'number' && value.runtimeValue === priceReference;
                assert.throws(() => getVerifiedEvidenceValue(out.verifiedEvidenceHandle, { taskId: 'other', entity, sourceExecutionId: out.sourceExecutionId, factKey: 'price.current' }));
            }
            const requiredFactKeys = [...listEvidenceRequirements(oracle.expected_capability).map(r => r.claimType), ...(price ? ['price.current'] : [])];
            const record = { case_id: oracle.case_id, requiredFactKeys,
                evidencePresence: requiredFactKeys.map(k => k === 'price.current' ? out.fieldEvidence?.present === true : out.evidenceCount > 0),
                evidenceValidity: requiredFactKeys.map(k => k === 'price.current' ? out.fieldEvidence?.valid === true : out.evidenceStatus === 'VALID'),
                verificationStatus: out.verificationStatus, runtimeHandoffAvailable: handoff,
                numericTypeMatch: price ? out.fieldEvidence?.numericTypeMatch === true : null,
                toolMatch: out.toolName === p06.find(r => r.case_id === oracle.case_id).expected.primary_tool,
                argumentValidation: out.argumentValidation, executionStatus: out.executionStatus, resultComparison: out.resultComparison,
                evidenceCount: out.evidenceCount, toolCalls: out.toolCalls, businessApiReadCalls: out.businessApiReadCalls,
                reasonCodes: [...out.reasonCodes, ...(out.fieldEvidence ? [out.fieldEvidence.reasonCode] : [])] };
            safeRecord(record); data.paths.push(record);
            fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
        }
        const prices = data.paths.filter(r => priceIds.includes(r.case_id));
        data.metrics = { toolMatches: data.paths.filter(r => r.toolMatch).length,
            validatedArguments: data.paths.filter(r => r.argumentValidation === 'VALIDATED').length,
            executionSuccess: data.paths.filter(r => r.executionStatus === 'SUCCESS').length,
            resultEquivalence: data.paths.filter(r => r.resultComparison === 'MATCH').length,
            requiredFields: data.paths.reduce((n, r) => n + r.requiredFactKeys.length, 0),
            evidencePresent: data.paths.reduce((n, r) => n + r.evidencePresence.filter(Boolean).length, 0),
            evidenceValid: data.paths.reduce((n, r) => n + r.evidenceValidity.filter(Boolean).length, 0),
            verificationPass: data.paths.filter(r => r.verificationStatus === 'PASS').length,
            priceExtracted: prices.filter(r => r.evidencePresence[1]).length, priceValid: prices.filter(r => r.evidenceValidity[1]).length,
            priceVerificationPass: prices.filter(r => r.verificationStatus === 'PASS').length,
            priceHandoff: prices.filter(r => r.runtimeHandoffAvailable).length,
            realToolCalls: data.paths.reduce((n, r) => n + r.toolCalls, 0),
            executionReadCalls: data.paths.reduce((n, r) => n + r.businessApiReadCalls, 0), totalReadCalls: fixture.calls.length };
        // Strict structural projection, plus live source text checks over all persisted material and observations.
        const visible = JSON.stringify({ data, spans, logs });
        data.privacy = { safeSchema: data.paths.every(r => { safeRecord(r); return true; }),
            sourceLeakCount: [...sources.values()].filter(s => visible.includes(s.mention) || visible.includes(s.source)).length,
            runtimeValueFieldCount: (visible.match(/"runtimeValue"\s*:/gu) || []).length,
            canonicalIdFieldCount: (visible.match(/"canonical(?:Entity)?Id"\s*:/gu) || []).length,
            priceValueFieldCount: (visible.match(/"price"\s*:/gu) || []).length,
            verificationSpanCount: spans.filter(s => s.name === 'pump.ai.verify').length,
            traceSink: 'IN_MEMORY_PHOENIX_METADATA_ADAPTER', normalLogCount: logs.length };
    } catch { data.fatalReason = 'CERTIFICATION_INVARIANT_OR_INFRASTRUCTURE_FAILURE'; }
    finally {
        if (fixture) data.fixtureSafety = await fixture.close();
        await observation.safeShutdown();
        for (const [key, fn] of Object.entries(saved)) console[key] = fn;
        data.postCertificationHashes = freeze(); data.hashesMatch = JSON.stringify(data.preCertificationHashes) === JSON.stringify(data.postCertificationHashes);
        data.databaseBefore = before; data.databaseAfter = dbSnapshot();
        data.databaseUnchanged = JSON.stringify(before) === JSON.stringify(data.databaseAfter);
        const m = data.metrics, p = data.privacy;
        data.certificationPass = !data.fatalReason && data.paths.length === 15 && m?.toolMatches === 15 && m.validatedArguments === 15
            && m.executionSuccess === 15 && m.resultEquivalence === 15 && m.requiredFields === 18
            && m.evidencePresent === 18 && m.evidenceValid === 18 && m.verificationPass === 15
            && m.priceExtracted === 3 && m.priceValid === 3 && m.priceVerificationPass === 3 && m.priceHandoff === 3
            && data.hashesMatch && data.databaseUnchanged && data.fixtureSafety?.unchanged
            && p?.safeSchema && p.verificationSpanCount >= 3 && p.sourceLeakCount === 0 && p.runtimeValueFieldCount === 0 && p.canonicalIdFieldCount === 0 && p.priceValueFieldCount === 0;
        fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
    }
    console.log(JSON.stringify({ pass: data.certificationPass, recordedPaths: data.paths.length, metrics: data.metrics,
        privacy: data.privacy, hashesMatch: data.hashesMatch, databaseUnchanged: data.databaseUnchanged, fatalReason: data.fatalReason }));
    if (!data.certificationPass) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { console.error('CERTIFICATION_STOPPED'); process.exitCode = 1; });
module.exports = { freeze, safeRecord };
