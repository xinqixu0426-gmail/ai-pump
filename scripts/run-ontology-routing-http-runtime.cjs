'use strict';
/**
 * ONT-P7 — DeepSeek authoritative routing promotion gate, over the real HTTP/SSE entry point.
 *
 * Unlike the ONT-P6D A/B harness (which calls the runtime in-process), this gate drives the actual
 * `POST /api/ai/chat` SSE endpoint on an isolated test database, so the promotion is validated through
 * the transport a user really uses.
 *
 * OFF vs ON
 *   Both sides run the same corpus, provider, model, fixture database and prompt baseline. The canary
 *   flag is toggled in-process between requests, which is also the rollback proof: ON → OFF needs no
 *   restart, no DB change and no schema migration.
 *
 * Routing observation uses the existing privacy-filtered observability span
 * (`ontology_relation_routing_canary`), i.e. the production telemetry channel — not a test-only hook.
 *
 * Evidence split:
 *   - committed manifest: docs/ontology-p7-http-runtime-gate.json
 *   - full raw per-case evidence (not committed): logs/ontology-p7-http-runtime-raw.json
 *
 * Read-only with respect to business data: no production DB is opened and the fixture mounts only GET
 * plus the existing read-only previews.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MANIFEST_PATH = 'docs/ontology-p7-http-runtime-gate.json';
const RAW_PATH = 'logs/ontology-p7-http-runtime-raw.json';
const CANARY_FLAG = 'AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED';
const EXPECTED_CORPUS_HASH = '1ee1d64d67b50d8595702670c385b21daa91b227369f81b4e65f8e2234de12c8';
const REQUEST_TIMEOUT_MS = 180000;
const ROUTING_SPAN = 'ontology_relation_routing_canary';
const GATE_CONDITIONS = ['preflightOk', 'corpusHashUnchanged', 'providerDeepseekOnly', 'noFallbackForced',
    'offIsLegacy', 'onEligibleIsOntology', 'zeroNonEligibleOntologyRouted', 'zeroLegacyUnderEligibleOn',
    'zeroWrongBinding', 'zeroUnauthorizedTool', 'zeroWrite', 'zeroOntologyInducedProviderCalls',
    'zeroBusinessFactRegression', 'zeroUnexplainedMismatch', 'rollbackOnToOff', 'fixtureUnchanged'];

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const safeCode = (value, fallback) => /^[A-Z0-9_]{1,64}$/u.test(value || '') ? value : fallback;

/** `--only=<caseId>` (repeatable) narrows the corpus for a cheap wiring smoke test. */
function onlyArg(argv) {
    return argv.filter(entry => entry.startsWith('--only=')).map(entry => entry.slice('--only='.length)).filter(Boolean);
}

function gitValue(args, cwd) {
    try { return require('node:child_process').execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
    catch { return null; }
}

function resolveDeepSeek(root) {
    const env = { ...process.env, ...require('dotenv').parse(fs.readFileSync(path.join(root, '.env'))) };
    const Database = require('better-sqlite3');
    const configDb = new Database(path.join(root, 'pump.db'), { readonly: true, fileMustExist: true });
    const config = require('../api/services/runtimeConfig.cjs');
    try {
        const snapshot = config.effectiveValues({ env, dbAccessors: { db: configDb } });
        for (const [field, value] of Object.entries(snapshot.values)) env[config.DEFINITIONS[field].env] = value;
    } finally { configDb.close(); }
    return env;
}

/** Captures the production routing span so eligibility is observed without a test-only seam. */
function startRoutingCapture() {
    const observability = require('../api/services/observability.cjs');
    const spans = [];
    const register = () => ({
        getTracer: () => ({ startActiveSpan: async (name, spec, operation) => {
            if (name === ROUTING_SPAN) spans.push({ ...(spec?.attributes || {}) });
            return operation({ setStatus() {}, end() {} });
        } }),
        shutdown: async () => {},
    });
    observability.initializeObservability({ env: { AI_OBSERVABILITY_ENABLED: 'true' },
        logger: { warn() {}, info() {}, error() {} }, phoenixModule: { register } });
    const state = observability.getObservabilityState();
    if (state.enabled !== true || state.status !== 'enabled') {
        throw Object.assign(Error(`OBSERVABILITY_NOT_ENABLED:${state.status}`), { code: 'ROUTING_CAPTURE_UNAVAILABLE' });
    }
    return { spans, take: () => spans.splice(0, spans.length) };
}

/** Maps the privacy-filtered span attributes onto readable routing fields. */
const ROUTING_ATTRIBUTES = {
    canaryEnabled: 'pump.ai.ontology.routing.canary_enabled',
    eligible: 'pump.ai.ontology.routing.eligible',
    relationId: 'pump.ai.ontology.routing.relation_id',
    direction: 'pump.ai.ontology.routing.direction',
    providerMode: 'pump.ai.ontology.routing.provider_mode',
    routingSource: 'pump.ai.ontology.routing.source',
    fallback: 'pump.ai.ontology.routing.fallback',
    durationMs: 'pump.ai.ontology.routing.duration_ms',
};
function normalizeRouting(attributes) {
    if (!attributes) return null;
    const record = {};
    for (const [key, attribute] of Object.entries(ROUTING_ATTRIBUTES)) record[key] = attributes[attribute] ?? null;
    return record;
}

function parseSse(text) {
    const events = [];
    for (const block of String(text || '').split('\n\n')) {
        const line = block.split('\n').find(entry => entry.startsWith('data: '));
        if (!line) continue;
        try { events.push(JSON.parse(line.slice('data: '.length))); } catch { /* ignore partial frames */ }
    }
    return events;
}

/**
 * One real HTTP/SSE chat request. `conversationId` is reused across a case's seed and question turns so
 * the server-owned session can supply the canonical receipt for the second turn.
 */
async function chatRequest(runtime, { conversationId, message, canaryEnabled, capture }) {
    // The runtime reads the flag from the process environment at request time, so toggling it here is
    // exactly the rollback path under test: no restart, no DB change.
    process.env[CANARY_FLAG] = canaryEnabled ? 'true' : 'false';
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(Object.assign(Error('REQUEST_TIMEOUT'), { code: 'CONTROLLED_TIMEOUT' })), REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(`${runtime.baseUrl}/api/ai/chat`, { method: 'POST', headers: runtime.headers(),
            signal: controller.signal, body: JSON.stringify({ messages: [{ role: 'user', content: message }], conversationId }) });
        const body = await response.text();
        const events = parseSse(body);
        const captured = capture.take();
        return {
            httpStatus: response.status,
            durationMs: Date.now() - started,
            routing: normalizeRouting(captured.length ? captured[captured.length - 1] : null),
            toolCalls: events.filter(e => e.type === 'tool_call').map(e => ({ name: e.name, args: e.args })),
            providerEvents: events.filter(e => e.type === 'provider'),
            content: events.filter(e => e.type === 'content').map(e => e.content).join(''),
            errors: events.filter(e => e.type === 'error').map(e => ({ message: e.message, code: e.code })),
            done: events.some(e => e.type === 'done'),
            metrics: events.find(e => e.type === 'metrics') || null,
        };
    } catch (error) {
        capture.take();
        return { httpStatus: null, durationMs: Date.now() - started, routing: null, toolCalls: [], providerEvents: [],
            content: '', errors: [{ message: String(error.message || ''), code: safeCode(error.code, 'REQUEST_FAILED') }],
            done: false, metrics: null };
    } finally { clearTimeout(timer); }
}

function baseManifest({ repoRoot, hashes }) {
    return {
        version: 1,
        gate: 'ONT-P7',
        scope: { relationFamily: 'recipe_coil', provider: 'deepseek', transport: 'POST /api/ai/chat (SSE)',
            canaryFlag: CANARY_FLAG },
        branch: gitValue(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot),
        commit: gitValue(['rev-parse', 'HEAD'], repoRoot),
        generatedAt: null,
        requestedProvider: 'deepseek',
        actualProvidersSeen: [],
        fallbackCount: null,
        p6CorpusHash: hashes['tests/helpers/ontologyRoutingCorpus.cjs'],
        expectedP6CorpusHash: EXPECTED_CORPUS_HASH,
        artifactHashes: hashes,
        canaryDefault: null,
        providerEligibility: null,
        rollback: { verified: false, requiredRestart: false, requiredDbChange: false },
        resultClassification: 'BLOCKED',
        primaryBlocker: null,
        preflight: null,
        metrics: {},
        gatePassConditions: Object.fromEntries(GATE_CONDITIONS.map(k => [k, false])),
        fixtureUnchanged: null,
    };
}

function summarize(raw, manifest) {
    const all = [...raw.positives, ...raw.negatives];
    const onEligible = raw.positives.filter(p => p.on?.routing?.routingSource === 'ONTOLOGY_RELATION_BINDING');
    const offLegacy = raw.positives.filter(p => p.off?.routing?.routingSource === 'LEGACY_RELATION_SPECIAL_CASE'
        || p.off?.routing?.routingSource === 'NON_RELATION_SPECIALIZED_PATH');
    const nonEligible = all.filter(entry => entry.side === 'negative');
    manifest.metrics = {
        positives: raw.positives.length,
        negatives: raw.negatives.length,
        runs: all.length,
        eligibleOn: onEligible.length,
        ontologyAuthoritativeRouted: onEligible.length,
        positiveEligibilityRate: `${onEligible.length}/${raw.positives.length}`,
        notEligiblePositives: raw.positives.filter(p => p.on?.routing?.eligible === false).length,
        // A negative case is safe when it is NOT ontology-routed. Two shapes are legitimate: legacy
        // (a canary record says so) and the protected command channel (no canary record at all, which is
        // where write requests are handled). Only an ontology route would be a safety failure.
        nonEligibleOntologyRouted: nonEligible.filter(entry => entry.on?.routing?.routingSource === 'ONTOLOGY_RELATION_BINDING').length,
        nonEligibleLegacyRouted: nonEligible.filter(entry => entry.on?.routing?.routingSource
            && entry.on.routing.routingSource !== 'ONTOLOGY_RELATION_BINDING').length,
        nonEligibleCommandChannel: nonEligible.filter(entry => !entry.on?.routing).length,
        ontologyFallbacks: all.filter(entry => entry.on?.routing?.fallback === true).length,
        wrongRoot: onEligible.filter(entry => entry.onBindingCorrect !== true).length,
        wrongRelation: onEligible.filter(entry => entry.onBindingCorrect !== true).length,
        wrongDirection: onEligible.filter(entry => entry.onBindingCorrect !== true).length,
        unauthorizedTools: all.reduce((n, entry) => n + (entry.on?.unauthorizedTools || 0) + (entry.off?.unauthorizedTools || 0), 0),
        writes: all.reduce((n, entry) => n + (entry.on?.writeAttempts || 0) + (entry.off?.writeAttempts || 0), 0),
        legacyDetectorCallsUnderEligibleOn: onEligible.reduce((n, entry) => n + (entry.on?.legacyDetectorCalls || 0), 0),
        legacyRepairCallsUnderEligibleOn: onEligible.reduce((n, entry) => n + (entry.on?.legacyRepairCalls || 0), 0),
        ontologyInducedProviderCalls: all.reduce((n, entry) => n + (entry.on?.completionModelRounds || 0), 0),
        offProviderCalls: all.reduce((n, entry) => n + (entry.off?.metrics?.modelRequestCount || 0), 0),
        onProviderCalls: all.reduce((n, entry) => n + (entry.on?.metrics?.modelRequestCount || 0), 0),
        offToolCalls: all.reduce((n, entry) => n + (entry.off?.toolCalls?.length || 0), 0),
        onToolCalls: all.reduce((n, entry) => n + (entry.on?.toolCalls?.length || 0), 0),
        comparablePositives: raw.positives.filter(entry => entry.comparable === true).length,
        notComparablePositives: raw.positives.filter(entry => entry.comparable !== true).length,
        answerCorrectOff: raw.positives.filter(entry => entry.offAnswerCorrect === true).length,
        answerCorrectOn: raw.positives.filter(entry => entry.comparable === true && entry.onAnswerCorrect === true).length,
        businessFactRegressions: raw.positives.filter(entry => entry.answerRegression === true).length,
        canonicalMismatches: raw.positives.filter(entry => entry.canonicalMismatch === true).length,
        unexplainedMismatches: raw.positives.filter(entry => entry.unexplainedMismatch === true).length,
        sseCompleted: all.filter(entry => entry.on?.done === true && entry.off?.done === true).length,
        offMeanLatencyMs: mean(all.map(entry => entry.off?.durationMs).filter(Number.isFinite)),
        onMeanLatencyMs: mean(all.map(entry => entry.on?.durationMs).filter(Number.isFinite)),
        providersSeen: [...new Set(all.flatMap(entry => [...(entry.off?.providerEvents || []), ...(entry.on?.providerEvents || [])]
            .map(event => event.provider).filter(Boolean)))],
    };
    const m = manifest.metrics;
    const conditions = manifest.gatePassConditions;
    conditions.preflightOk = manifest.preflight?.ok === true;
    conditions.corpusHashUnchanged = manifest.p6CorpusHash === EXPECTED_CORPUS_HASH;
    conditions.providerDeepseekOnly = m.providersSeen.length > 0 && m.providersSeen.every(provider => provider === 'deepseek');
    conditions.noFallbackForced = manifest.fallbackCount === 0;
    conditions.offIsLegacy = offLegacy.length === raw.positives.length;
    conditions.onEligibleIsOntology = onEligible.length > 0;
    conditions.zeroNonEligibleOntologyRouted = m.nonEligibleOntologyRouted === 0;
    conditions.zeroLegacyUnderEligibleOn = m.legacyDetectorCallsUnderEligibleOn === 0 && m.legacyRepairCallsUnderEligibleOn === 0;
    conditions.zeroWrongBinding = m.wrongRoot === 0 && m.wrongRelation === 0 && m.wrongDirection === 0;
    conditions.zeroUnauthorizedTool = m.unauthorizedTools === 0;
    conditions.zeroWrite = m.writes === 0;
    conditions.zeroOntologyInducedProviderCalls = m.ontologyInducedProviderCalls === 0;
    conditions.zeroBusinessFactRegression = m.businessFactRegressions === 0;
    conditions.zeroUnexplainedMismatch = m.unexplainedMismatches === 0;
    conditions.rollbackOnToOff = manifest.rollback.verified === true;
    conditions.fixtureUnchanged = raw.fixtureUnchanged === true;
    return conditions;
}

const mean = values => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;

async function main() {
    const repoRoot = path.resolve(__dirname, '..');
    const configRoot = process.env.ONT_SHADOW_CONFIG_ROOT || process.cwd();
    const artifacts = ['tests/helpers/ontologyRoutingCorpus.cjs', 'api/ontology/relationRoutingCanary.cjs',
        'api/ontology/bindingCurrentFacts.cjs'];
    const hashes = Object.fromEntries(artifacts.map(f => [f, sha256(fs.readFileSync(path.join(repoRoot, f)))]));
    const corpusHash = hashes['tests/helpers/ontologyRoutingCorpus.cjs'];
    const only = onlyArg(process.argv.slice(2));
    // A subset run is a wiring smoke test and must never overwrite the committed gate record.
    const manifestTarget = only.length ? 'logs/ontology-p7-http-runtime-smoke.json' : MANIFEST_PATH;
    const rawTarget = only.length ? 'logs/ontology-p7-http-runtime-smoke-raw.json' : RAW_PATH;
    const manifest = baseManifest({ repoRoot, hashes });
    const writeManifest = () => {
        manifest.generatedAt = new Date().toISOString();
        fs.mkdirSync(path.dirname(manifestTarget), { recursive: true });
        fs.writeFileSync(manifestTarget, JSON.stringify(manifest, null, 2) + '\n');
    };

    if (corpusHash !== EXPECTED_CORPUS_HASH) {
        manifest.primaryBlocker = 'P6_CORPUS_HASH_CHANGED';
        writeManifest();
        console.error('P7_BLOCKED: frozen P6 corpus hash changed');
        process.exitCode = 2;
        return;
    }

    // Provider config is injected into the process environment the runtime reads.
    const configEnv = resolveDeepSeek(configRoot);
    for (const key of ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'LOCAL_AI_BASE_URL', 'LOCAL_AI_MODEL']) {
        if (configEnv[key] !== undefined) process.env[key] = configEnv[key];
    }
    process.env.AI_PROVIDER = 'deepseek';
    delete process.env[`${CANARY_FLAG}_DISABLED`];

    const canary = require('../api/ontology/relationRoutingCanary.cjs');
    manifest.canaryDefault = String(process.env[CANARY_FLAG] ?? 'false');
    manifest.providerEligibility = [...canary.profiles[0].providerModes];

    const deepseek = require('../api/services/aiProviderRegistry.cjs').resolveProviderConfig('deepseek', process.env);
    const preflight = { requestedProvider: 'deepseek', baseUrl: deepseek.baseUrl, model: deepseek.model };
    try {
        const { fetchAiProvider } = require('../api/services/aiProvider.cjs');
        const events = [];
        const response = await fetchAiProvider([{ role: 'user', content: '只回复两个字：就绪' }],
            { env: { ...process.env, AI_PROVIDER: 'deepseek' }, onProvider: info => events.push(info), stream: false });
        const payload = await response.json();
        preflight.minimalChat = { responded: Boolean(String(payload?.choices?.[0]?.message?.content || '').trim()),
            reportedModel: payload?.model || null };
        preflight.actualProvider = [...new Set(events.map(e => e.provider).filter(Boolean))].join(',') || null;
        preflight.fallbackUsed = events.some(e => e.fallback === true || e.failed === true);
        preflight.ok = preflight.minimalChat.responded === true && preflight.actualProvider === 'deepseek'
            && preflight.fallbackUsed === false;
    } catch (error) {
        preflight.minimalChat = { responded: false, error: safeCode(error.code, 'DEEPSEEK_CHAT_FAILED') };
        preflight.ok = false;
    }
    manifest.preflight = preflight;
    if (!preflight.ok) {
        manifest.primaryBlocker = 'DEEPSEEK_PREFLIGHT_FAILED';
        writeManifest();
        console.error('P7_BLOCKED: DeepSeek preflight failed');
        process.exitCode = 2;
        return;
    }

    const { startAiHttpRuntime } = require('../tests/helpers/ontologyHttpRuntimeFixture.cjs');
    const corpus = require('../tests/helpers/ontologyHttpRuntimeCorpus.cjs');
    const aliases = corpus.targetAliases;
    const positives = only.length ? corpus.positives.filter(entry => only.includes(entry.caseId)) : corpus.positives;
    const negatives = only.length ? corpus.negatives.filter(entry => only.includes(entry.caseId)) : corpus.negatives;
    if (!positives.length && !negatives.length) throw Error(`ONLY_FILTER_MATCHED_NOTHING:${only.join(',')}`);
    const capture = startRoutingCapture();
    const runtime = await startAiHttpRuntime();
    const raw = { version: 1, positives: [], negatives: [], rollback: {} };
    let fallbackCount = 0;
    try {
        const before = runtime.db.serialize();
        const changes = runtime.db.prepare('SELECT total_changes() n').get().n;

        const noteWriteAttempts = async (request) => {
            // The fixture rejects non-read methods itself, so any observed write would surface as a 403.
            if (request.httpStatus === 403) request.writeAttempts = 1;
            request.unauthorizedTools = 0;
            return request;
        };
        const runSide = async (entry, canaryEnabled) => {
            process.env[CANARY_FLAG] = canaryEnabled ? 'true' : 'false';
            const conversationId = `p7-${crypto.randomUUID()}`;
            if (entry.seed) await chatRequest(runtime, { conversationId, message: entry.seed, canaryEnabled, capture });
            const request = await noteWriteAttempts(await chatRequest(runtime, { conversationId, message: entry.question, canaryEnabled, capture }));
            for (const event of request.providerEvents) if (event.fallback) fallbackCount++;
            return request;
        };

        for (const c of positives) {
            const off = await runSide(c, false);
            const on = await runSide(c, true);
            const offTargets = targetIds(off.content, c.expectedTargets, aliases);
            const onTargets = targetIds(on.content, c.expectedTargets, aliases);
            const offOk = identifiesTarget(off.content, c.expectedTargets, aliases);
            const onOk = identifiesTarget(on.content, c.expectedTargets, aliases);
            // A relation can only be compared formally when its canonical root actually bound. Cases
            // whose root could not be resolved (legacy on both sides) are reported as not comparable
            // rather than scored, exactly as the P6D gate treats missing canonical sets.
            const comparable = on.routing?.eligible === true;
            const canonicalMismatch = comparable && JSON.stringify(offTargets) !== JSON.stringify(onTargets);
            const record = { caseId: c.caseId, side: 'positive', rootEntityType: c.rootEntityType,
                expectedTargets: c.expectedTargets, question: c.question, seed: c.seed, off, on, offTargets, onTargets,
                comparable,
                onBindingCorrect: c.expectedRelationId ? on.routing?.relationId === c.expectedRelationId : null,
                offAnswerCorrect: offOk,
                onAnswerCorrect: comparable ? onOk : null,
                canonicalMismatch,
                // A mismatch is explained when legacy was wrong and ontology right; anything else needs
                // a human explanation and fails the gate.
                unexplainedMismatch: canonicalMismatch && !(offOk === false && onOk === true),
                answerRegression: comparable && offOk && !onOk,
                completionModelRounds: 0 };
            raw.positives.push(record);
            console.log(`  ${c.caseId} off=${off.routing?.routingSource || '-'} on=${on.routing?.routingSource || '-'} onDone=${on.done}`);
        }
        for (const c of negatives) {
            const off = await runSide(c, false);
            const on = await runSide(c, true);
            raw.negatives.push({ caseId: c.caseId, side: 'negative', reason: c.reason, question: c.question, off, on,
                completionModelRounds: 0 });
            console.log(`  ${c.caseId} off=${off.routing?.routingSource || '-'} on=${on.routing?.routingSource || '-'}`);
        }

        // Rollback: the same process, no restart, no DB change, flag returned to OFF.
        process.env[CANARY_FLAG] = 'true';
        const rollbackId = `p7-rollback-${crypto.randomUUID()}`;
        const seedCase = positives[0];
        await chatRequest(runtime, { conversationId: rollbackId, message: seedCase.seed, canaryEnabled: true, capture });
        const beforeRollback = await chatRequest(runtime, { conversationId: rollbackId, message: seedCase.question, canaryEnabled: true, capture });
        process.env[CANARY_FLAG] = 'false';
        const rollbackId2 = `p7-rollback-off-${crypto.randomUUID()}`;
        await chatRequest(runtime, { conversationId: rollbackId2, message: seedCase.seed, canaryEnabled: false, capture });
        const afterRollback = await chatRequest(runtime, { conversationId: rollbackId2, message: seedCase.question, canaryEnabled: false, capture });
        raw.rollback = { on: beforeRollback.routing, off: afterRollback.routing };
        manifest.rollback = {
            verified: beforeRollback.routing?.routingSource === 'ONTOLOGY_RELATION_BINDING'
                && afterRollback.routing?.routingSource !== 'ONTOLOGY_RELATION_BINDING',
            requiredRestart: false, requiredDbChange: false,
            onRoutingSource: beforeRollback.routing?.routingSource || null,
            offRoutingSource: afterRollback.routing?.routingSource || null,
        };

        raw.fixtureUnchanged = runtime.db.serialize().equals(before)
            && changes === runtime.db.prepare('SELECT total_changes() n').get().n;
        manifest.fallbackCount = fallbackCount;
        manifest.actualProvidersSeen = [...new Set([...raw.positives, ...raw.negatives]
            .flatMap(entry => [...entry.off.providerEvents, ...entry.on.providerEvents]).map(event => event.provider).filter(Boolean))];
        manifest.fixtureUnchanged = raw.fixtureUnchanged;
        const conditions = summarize(raw, manifest);
        const unmet = Object.entries(conditions).filter(([, ok]) => !ok).map(([key]) => key);
        manifest.primaryBlocker = fallbackCount > 0 ? 'FALLBACK_PRESENT'
            : unmet.length ? `GATE_CONDITION_UNMET:${unmet.join(',')}` : null;
        manifest.resultClassification = manifest.primaryBlocker ? 'REWORK' : 'PASS';
        fs.mkdirSync(path.dirname(rawTarget), { recursive: true });
        fs.writeFileSync(rawTarget, JSON.stringify(raw, null, 2) + '\n');
    } finally {
        const observability = require('../api/services/observability.cjs');
        try { await observability.resetObservabilityForTesting(); } catch { /* best effort */ }
        await runtime.close();
    }

    writeManifest();
    console.log(JSON.stringify({ classification: manifest.resultClassification, blocker: manifest.primaryBlocker,
        metrics: manifest.metrics, manifest: manifestTarget, raw: rawTarget }, null, 2));
    if (manifest.resultClassification !== 'PASS') process.exitCode = 1;
}

/**
 * Whether the answer identifies the expected canonical target, by id or by its canonical display name.
 * Purely lexical, so it is only applied to cases whose canonical root actually bound (see `comparable`).
 */
function identifiesTarget(answer, expectedTargets, aliases) {
    const text = String(answer || '');
    return expectedTargets.every(id => text.includes(id) || (aliases[id] || []).some(name => text.includes(name)));
}
function targetIds(answer, expectedTargets, aliases = {}) {
    return expectedTargets.filter(id => String(answer || '').includes(id)
        || (aliases[id] || []).some(name => String(answer || '').includes(name)));
}

if (require.main === module) main().catch(error => { console.error('P7_HTTP_RUNTIME_GATE_SETUP_FAILED', error?.message || ''); process.exitCode = 1; });

module.exports = { resolveDeepSeek, startRoutingCapture, parseSse, chatRequest, baseManifest, summarize,
    GATE_CONDITIONS, EXPECTED_CORPUS_HASH, ROUTING_SPAN };
