'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events'), { AsyncLocalStorage } = require('node:async_hooks');
const root = path.resolve(__dirname, '..'), read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const { openFixture, fixtures } = require('./run-ai-v5f1b-read-certification.cjs');
const { dbSnapshot } = require('./run-ai-v5e4r-nested-refinement-evaluation.cjs');
const { required, freeze } = require('./run-ai-v5f2b-answer-formal.cjs');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function stageFreeze() { return { ...freeze(), ...Object.fromEntries(['api/services/ai-v5/readCanary.cjs', 'api/routes/ai/chat.cjs', 'tests/aiV5ReadCanary.test.cjs', 'scripts/run-ai-v5-p16c-certification.cjs'].map(p => [p, hash(fs.readFileSync(path.join(root, p)))])) }; }
async function comparator(oracle, source) {
    const { createInternalFetch, getJson, lookupEntities } = require('../api/routes/ai/internalApiClient.cjs');
    const fetch = createInternalFetch({ operationId: crypto.randomUUID() });
    if (oracle.expected_entity_type === 'part') {
        const rows = await getJson(fetch, '/api/parts?keyword=' + encodeURIComponent(source.mention));
        const shape = rows => rows.map(r => ({ id: String(r.id ?? r.Id), model: r.model, stock: r.stock, price: r.price }));
        const digest = hash(JSON.stringify(shape(rows)));
        return r => Array.isArray(r.parts) && hash(JSON.stringify(shape(r.parts))) === digest ? 'MATCH' : 'MISMATCH';
    }
    if (oracle.expected_entity_type === 'coil') {
        const lookup = await lookupEntities(fetch, { version: 1, mention: source.mention, entityTypes: ['coil'], matchPolicy: 'EXACT' });
        assert.ok(lookup.complete && lookup.candidates.length === 1);
        const binding = lookup.candidates[0].bindingRefs.find(r => r.kind === 'schemeCode');
        const rows = await getJson(fetch, '/api/coils?schemeCode=' + encodeURIComponent(binding.value));
        return r => require('../api/services/ai-v5/coilReadComparator.cjs').compareCoilRead(r, rows, source.id);
    }
    const rows = (await getJson(fetch, '/api/recipes/current-costs')).items.filter(r => String(r.recipeId) === source.id);
    assert.equal(rows.length, 1);
    return r => String(r.data?.recipeId) === source.id && r.data.currentTotalCost === rows[0].currentTotalCost ? 'MATCH' : 'MISMATCH';
}
async function main() {
    require('dotenv').config({ quiet: true });
    const output = path.join(root, 'docs/ai-governance/data/p16c-controlled-preview-certification.json');
    assert.equal(fs.existsSync(output), false, 'P16C_EVALUATION_ALREADY_STARTED');
    const pre = stageFreeze(), before = dbSnapshot(), data = { version: 1, frozenPaths: 15, modes: [], preHashes: pre,
        legacyMethod: 'ACTUAL_CHAT_HANDLER_UNCHANGED_DISPATCHER_SEAM_SYNTHETIC_AUTHORITATIVE_EVENTS',
        interpreterMethod: 'REAL_FROZEN_INTERPRETER', answerMethod: 'REAL_FROZEN_ANSWER_MODEL', writes: 0, allowWriteEnablingCalls: 0, businessMutationCalls: 0 };
    const saved = Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(k => [k, console[k]])), logs = [], spans = [], als = new AsyncLocalStorage();
    for (const k of Object.keys(saved)) console[k] = (...args) => logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    let fixture, sources;
    const obs = require('../api/services/observability.cjs');
    try {
        fixture = await openFixture(); sources = fixtures(fixture.db);
        const oracle = read('docs/ai-governance/data/v5-e4r-entity-first-architecture-audit.json').cases;
        assert.equal(oracle.length, 15);
        const { handleAiChat } = require('../api/routes/ai/chat.cjs');
        obs.initializeObservability({ env: { AI_OBSERVABILITY_ENABLED: 'true', AI_TRACE_CONTENT: 'metadata' },
            phoenixModule: { register: () => ({ getTracer: () => ({ startActiveSpan(name, options, fn) {
                const parent = als.getStore(), record = { id: crypto.randomUUID(), parent: parent?.id || null, root: parent?.root || null, name, attributes: { ...options.attributes } };
                if (!parent) record.root = record.id; spans.push(record);
                return als.run(record, () => fn({ setAttributes(a) { Object.assign(record.attributes, a); }, setAttribute(k,v) { record.attributes[k] = v; }, setStatus() {}, end() {}, updateName() {} }));
            } }), forceFlush: async () => {}, shutdown: async () => {} }) }, logger: { warn() {} } });
        fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
        for (const [name, global, optIn] of [['DEFAULT_OFF', false, false], ['GLOBAL_ONLY', true, false], ['REQUEST_ONLY', false, true], ['BOTH_ON', true, true]]) {
            const mode = { name, paths: [] }; data.modes.push(mode);
            for (const p of oracle) {
                const source = sources.get(p.source_group), env = { ...process.env, AI_V5_READ_CANARY_ENABLED: String(global), AI_V5_SHADOW_ENABLED: 'false' };
                const req = Object.assign(new EventEmitter(), { requestId: crypto.randomUUID(), headers: { 'x-internal-secret': env.INTERNAL_SECRET,
                    'x-pump-v5-preview': String(optIn), 'x-pump-v5-fact': required[p.source_group] }, body: { messages: [{ role: 'user', content: source.source }] } });
                let legacyContent = 0, done = 0, preview = 0, bodyValid = true, outcome = null, modelCalls = 0;
                const res = Object.assign(new EventEmitter(), { setHeader() {}, flushHeaders() {}, write(s) {
                    if (!s.startsWith('data: ')) return true;
                    const e = JSON.parse(s.slice(6));
                    if (e.type === 'content') { legacyContent++; bodyValid &&= e.content === 'legacy-synthetic-authoritative'; }
                    if (e.type === 'done') done++;
                    if (e.type === 'v5_preview') { preview++; bodyValid &&= done === 1 && e.preview === true && e.authoritative === false && typeof e.answerText === 'string' && e.answerText.length > 0; }
                    // Event/body intentionally discarded here. Never in dataset, log or cache.
                    return true;
                }, end() { this.writableEnded = true; } });
                const canaryOptions = { onOutcome: o => { outcome = o; } };
                if (global && optIn) {
                    canaryOptions.executionOptions = { compare: await comparator(p, source) };
                    const real = require('../api/services/ai-v5/taskInterpreter.cjs').requestConfiguredInterpreterModel;
                    canaryOptions.answerOptions = { modelRequest: (...args) => { modelCalls++; return real(...args); } };
                } else canaryOptions.interpret = () => { throw Error('OFF_GATE_EXECUTION'); };
                const startCalls = fixture.calls.length;
                await handleAiChat(req, res, { env, telemetry: { record() {} }, canaryOptions, runAiDispatcherV3: async ({ emit }) => {
                    emit('content', { content: 'legacy-synthetic-authoritative' }); emit('done', {});
                    return { intent: { mode: 'query' }, telemetry: { outcome: 'completed', toolSteps: [{ capabilityName: 'search_parts', success: true }] } };
                } });
                mode.paths.push({ case_id: p.case_id, sourceGroup: p.source_group, factKey: required[p.source_group],
                    legacyPreserved: legacyContent === 1 && done === 1 && bodyValid, previewCount: preview, actualAnswerCalls: modelCalls,
                    previewBusinessCalls: fixture.calls.length - startCalls, ...(outcome || { attempted: false, exposed: false, delivered: false }) });
                fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
                saved.log(JSON.stringify({ mode: name, case_id: p.case_id, exposed: preview === 1, failureClass: outcome?.failureClass || 'NONE' }));
                if (global && optIn && (!outcome?.exposed || modelCalls !== 1)) throw Error('CONTROLLED_PREVIEW_GATE_FAILED');
            }
        }
        const children = spans.filter(s => s.name !== 'invoke_agent pump_factory_assistant');
        data.trace = { spans: spans.length, orphanCount: children.filter(s => !s.parent || !spans.some(p => p.id === s.parent)).length,
            crossRequestCount: spans.filter(s => s.attributes['pump.ai.v5.shadow_task_id']).filter(s => {
                const r = spans.find(p => p.id === s.root); return r?.attributes['pump.request.id'] !== s.attributes['pump.ai.v5.shadow_task_id']; }).length };
        const visible = JSON.stringify({ data, spans, logs });
        data.privacy = { sourceLeakCount: [...sources.values()].filter(s => visible.includes(s.mention) || visible.includes(s.source)).length,
            forbiddenContentFields: (visible.match(/"(?:answerText|numericValue|runtimeValue|canonicalId|stock|currentTotalCost|price)"\s*:/gu) || []).length };
        data.businessMutationCalls = fixture.calls.filter(c => c.method !== 'GET' && !c.lookup).length;
    } catch { data.fatalReason = 'P16C_CERTIFICATION_STOPPED'; }
    finally {
        if (fixture) data.fixtureSafety = await fixture.close();
        await obs.safeShutdown(); for (const [k, v] of Object.entries(saved)) console[k] = v;
        data.databaseUnchanged = JSON.stringify(before) === JSON.stringify(dbSnapshot());
        data.hashesMatch = JSON.stringify(pre) === JSON.stringify(stageFreeze());
        const on = data.modes.find(m => m.name === 'BOTH_ON')?.paths || [];
        const q = p => [...on].map(r => r.durationMs).sort((a,b) => a-b)[Math.ceil(on.length*p)-1] ?? null;
        data.previewCompletion = { median: q(.5), p95: q(.95) };
        data.pass = !data.fatalReason && data.modes.length === 4 && data.modes.every(m => m.paths.length === 15 && m.paths.every(p => p.legacyPreserved))
            && data.modes.filter(m => m.name !== 'BOTH_ON').every(m => m.paths.every(p => !p.attempted && !p.exposed && p.previewBusinessCalls === 0))
            && on.every(p => p.delivered && p.previewCount === 1 && p.actualAnswerCalls === 1 && p.evidenceVerification === 'PASS' && p.resultEquivalence === 'MATCH'
                && ['contractValid','evidenceRefsValid','groundingValid','requiredFactCoverage','numericValid','entityValid'].every(k => p[k] === true))
            && data.trace?.orphanCount === 0 && data.trace?.crossRequestCount === 0 && data.privacy?.sourceLeakCount === 0 && data.privacy?.forbiddenContentFields === 0
            && data.databaseUnchanged && data.fixtureSafety?.unchanged && data.hashesMatch;
        if (fs.existsSync(output)) fs.writeFileSync(output, JSON.stringify(data, null, 2) + '\n');
        console.log(JSON.stringify({ pass: data.pass, modes: data.modes.map(m => ({ name: m.name, paths: m.paths.length })), trace: data.trace, privacy: data.privacy, fatalReason: data.fatalReason }));
        if (!data.pass) process.exitCode = 1;
    }
}
if (require.main === module) main().catch(() => { console.error('P16C_CERTIFICATION_PREFLIGHT_FAILED'); process.exitCode = 1; });
module.exports = { comparator, stageFreeze };
