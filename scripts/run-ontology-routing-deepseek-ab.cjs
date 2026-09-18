'use strict';
/**
 * ONT-P6D — DeepSeek Real-AI Gate for the `recipe <-> coil` Controlled Routing Canary.
 *
 * Purpose: with the local model host deferred (it sits on another LAN), establish a real-AI
 * A/B equivalence result on the currently production DeepSeek provider.
 *
 *   A = Legacy routing   = production DeepSeek behaviour (canary flag OFF, full read catalog,
 *                          no forced relation pair).
 *   B = Ontology routing = the real canary's routing decision applied to the same request
 *                          against the same real DeepSeek model.
 *
 * Isolation — production eligibility is NOT widened:
 *   The canary admits only `local` / `local-first` (plus an enabled local shortlist). DeepSeek
 *   is deliberately outside that predicate and this harness does not change it. To observe the
 *   counterfactual "what if the canary routed this DeepSeek request", side B installs a
 *   process-local `require.cache` overlay that delegates to the REAL canary module and lifts
 *   only those two gates. No file on disk changes; the decision itself (semantic class, binding,
 *   relation/direction, profile, requirements, argument policies) is the authentic one. The
 *   overlay relabels `providerMode` back to the true provider so telemetry is not falsified.
 *   `assertProductionEligibilityUnchanged()` re-reads the untouched module from disk.
 *
 * Provider contract: requested = deepseek, actual = deepseek, fallback count must be 0.
 *
 * Evidence split:
 *   - committed manifest: docs/ontology-p6d-deepseek-gate.json
 *   - raw per-case evidence (not committed): logs/ontology-p6d-deepseek-raw.json
 *
 * Read-only with respect to business data: no Ontology contract, resolver, binding semantics,
 * canonical identity, Legacy Oracle, Business API, DB schema, Tool schema or frozen corpus is
 * modified.
 *
 * Usage:
 *   ONT_SHADOW_CONFIG_ROOT=<checkout with .env + pump.db> \
 *     node scripts/run-ontology-routing-deepseek-ab.cjs [--rounds=2] [--only=<caseId> ...]
 * Exit codes: 0 PASS, 1 gate conditions unmet, 2 preflight failed or corpus hash changed.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const MANIFEST_PATH = 'docs/ontology-p6d-deepseek-gate.json';
const RAW_PATH = 'logs/ontology-p6d-deepseek-raw.json';
const RELATION_FAMILY = 'recipe_coil';
const CANARY_FLAG = 'AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED';
const EXPECTED_CORPUS_HASH = '1ee1d64d67b50d8595702670c385b21daa91b227369f81b4e65f8e2234de12c8';
const APPLICATION_MODEL = 'deepseek-v4-flash';
const CASE_TIMEOUT_MS = 180000;
const CONCURRENCY = 2;
const CORPUS_ARTIFACTS = [
    'tests/helpers/ontologyRoutingCorpus.cjs',
    'tests/fixtures/ontology-coil-recipe-canary-v1.json',
    'tests/fixtures/ontology-coil-recipe-legacy-oracle-v1.json',
    'api/ontology/relationRoutingCanary.cjs',
    'api/ontology/bindingMetadata.cjs',
];
const GATE_CONDITIONS = ['preflightOk', 'requestedProviderDeepseek', 'actualProviderDeepseek', 'noFallbackForced',
    'corpusHashUnchanged', 'allCasesCompleted', 'zeroWrongBinding', 'zeroUnauthorizedTool', 'zeroWrite',
    'zeroOntologyInducedProviderCalls', 'zeroCanonicalRegression', 'zeroAnswerFactRegression',
    'ontologyCorrectnessNotRegressed', 'fixturesUnchanged', 'productionEligibilityUnchanged'];

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const safeCode = (value, fallback) => /^[A-Z0-9_]{1,64}$/u.test(value || '') ? value : fallback;

function roundsArg(argv) {
    const found = argv.find(a => a.startsWith('--rounds='));
    const value = Number(found ? found.split('=')[1] : 2);
    return Number.isSafeInteger(value) && value >= 1 && value <= 5 ? value : 2;
}

/** `--only=<caseId>` (repeatable) narrows the corpus for a cheap wiring smoke test. */
function onlyArg(argv) {
    return argv.filter(a => a.startsWith('--only=')).map(a => a.slice('--only='.length)).filter(Boolean);
}

function gitValue(args, cwd) {
    try { return require('node:child_process').execFileSync('git', args, { cwd, encoding: 'utf8' }).trim(); }
    catch { return null; }
}

function resolveProvider(root, name) {
    const env = { ...process.env, ...require('dotenv').parse(fs.readFileSync(path.join(root, '.env'))) };
    const Database = require('better-sqlite3');
    const configDb = new Database(path.join(root, 'pump.db'), { readonly: true, fileMustExist: true });
    const config = require('../api/services/runtimeConfig.cjs');
    try {
        const snapshot = config.effectiveValues({ env, dbAccessors: { db: configDb } });
        for (const [field, value] of Object.entries(snapshot.values)) env[config.DEFINITIONS[field].env] = value;
    } finally { configDb.close(); }
    const provider = require('../api/services/aiProviderRegistry.cjs').resolveProviderConfig(name, env);
    return { env, baseUrl: String(provider.baseUrl || '').replace(/\/$/u, ''), model: provider.model || null };
}

/** Fail-closed provider preflight: minimal chat, minimal tool call, identity, no fallback. */
async function preflight({ env }) {
    const record = { requestedProvider: 'deepseek', minimalChat: null, minimalToolCall: null,
        actualProvider: null, actualModel: null, fallbackUsed: null, requestCount: 0 };
    const { fetchAiProvider } = require('../api/services/aiProvider.cjs');
    const deepseekEnv = { ...env, AI_PROVIDER: 'deepseek' };
    const events = [];
    const onProvider = info => events.push({ provider: info.provider, model: info.model || null,
        fallback: Boolean(info.fallback), failed: Boolean(info.failed) });

    try {
        const response = await fetchAiProvider([{ role: 'user', content: '只回复两个字：就绪' }],
            { env: deepseekEnv, onProvider, stream: false });
        const payload = await response.json();
        const content = payload?.choices?.[0]?.message?.content;
        record.minimalChat = { responded: typeof content === 'string' && content.trim().length > 0,
            reportedModel: payload?.model || null };
        record.actualModel = payload?.model || null;
    } catch (error) {
        record.minimalChat = { responded: false, error: safeCode(error.code, 'DEEPSEEK_CHAT_FAILED') };
    }

    try {
        const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
        const tool = AI_TOOLS.find(t => t.function?.name === 'get_all_recipes');
        const response = await fetchAiProvider([{ role: 'user', content: '请调用工具列出全部配方' }],
            { env: deepseekEnv, onProvider, tools: tool ? [tool] : [], toolChoice: 'required', stream: false });
        const payload = await response.json();
        const calls = payload?.choices?.[0]?.message?.tool_calls;
        record.minimalToolCall = { supported: Array.isArray(calls) && calls.length > 0,
            toolName: calls?.[0]?.function?.name || null };
    } catch (error) {
        record.minimalToolCall = { supported: false, error: safeCode(error.code, 'DEEPSEEK_TOOL_CALL_FAILED') };
    }

    const providers = [...new Set(events.map(e => e.provider).filter(Boolean))];
    record.actualProvider = providers.length === 1 ? providers[0] : (providers.join(',') || null);
    record.fallbackUsed = events.some(e => e.fallback === true || e.failed === true);
    record.requestCount = events.length;
    const ok = record.minimalChat?.responded === true && record.minimalToolCall?.supported === true
        && record.actualProvider === 'deepseek' && record.fallbackUsed === false;
    record.ok = ok;
    return { ok, blocker: ok ? null : 'DEEPSEEK_PROVIDER_PREFLIGHT_FAILED', record };
}

const CANARY_PATH = () => require.resolve('../api/ontology/relationRoutingCanary.cjs');

/** Re-reads the untouched module from disk to prove production eligibility was not widened. */
function assertProductionEligibilityUnchanged() {
    const real = require(CANARY_PATH());
    return real.profiles.every(p => equal(p.providerModes, ['local', 'local-first']));
}

/**
 * Process-local require.cache overlay. Delegates to the real canary and lifts only the
 * provider-mode and shortlist gates; relabels providerMode to the true provider.
 */
function installCounterfactualOverlay(trueProvider) {
    const target = CANARY_PATH();
    const real = require(target);
    const shim = Object.create(null);
    Object.assign(shim, real);
    shim.prepareRouting = (input = {}, dependencies = {}) => {
        const state = real.prepareRouting({ ...input, env: { ...(input.env || {}), AI_PROVIDER: 'local-first' },
            shortlistEnabled: true }, dependencies);
        if (state?.record) {
            state.record.providerMode = trueProvider;
            state.record.counterfactualEligibilityOverride = true;
        }
        return state;
    };
    require.cache[target] = { id: target, filename: target, loaded: true, exports: shim, children: [], paths: [] };
    return () => { delete require.cache[target]; };
}

function baseManifest({ repoRoot, rounds, hashes, corpusHash }) {
    return {
        version: 1,
        gate: 'ONT-P6D',
        scope: { relationFamily: RELATION_FAMILY, provider: 'deepseek', canaryFlag: CANARY_FLAG,
            sideA: 'legacy routing (canary OFF, production DeepSeek behaviour)',
            sideB: 'ontology canary routing decision (counterfactual, harness-only overlay)' },
        branch: gitValue(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot),
        commit: gitValue(['rev-parse', 'HEAD'], repoRoot),
        generatedAt: null,
        requestedProvider: 'deepseek',
        actualProvider: null,
        model: null,
        fallbackCount: null,
        corpusVersion: 'P6R frozen 28-case (8 positive / 20 negative)',
        corpusHash,
        expectedCorpusHash: EXPECTED_CORPUS_HASH,
        artifactHashes: hashes,
        pairedRoundsPlanned: rounds,
        pairedRoundsCompleted: 0,
        deterministicGate: 'PASS (see docs/ontology-first-routing-migration-v1.md)',
        localProviderGate: 'DEFERRED — local model host is on another LAN and is not required for the DeepSeek validation path',
        resultClassification: 'BLOCKED',
        primaryBlocker: null,
        preflight: null,
        metrics: {},
        gatePassConditions: Object.fromEntries(GATE_CONDITIONS.map(k => [k, false])),
        databaseUnchanged: null,
        subsetRun: false,
    };
}

function summarize(raw, manifest) {
    const cases = raw.cases || [];
    const positives = cases.filter(c => c.category === 'positive');
    const pairs = (raw.pairs || []).filter(p => p.category === 'positive');
    const sideA = cases.filter(c => c.side === 'A'), sideB = cases.filter(c => c.side === 'B');
    const sumCalls = list => list.reduce((n, c) => n + (c.modelCalls || 0), 0);
    const sumTools = list => list.reduce((n, c) => n + (c.tools?.length || 0), 0);
    // Provider calls the ontology canary caused purely to complete its known relation evidence.
    // With deterministic planning this must be 0; a repair prompt is the only such call.
    const ontologyInducedProviderCalls = sideB.reduce((n, c) => n + (c.routing?.completionModelRounds || 0), 0);
    manifest.metrics = {
        totalExecutions: cases.length,
        completed: cases.filter(c => c.completed).length,
        positiveExecutions: positives.length,
        negativeExecutions: cases.filter(c => c.category === 'negative').length,
        sideACompleted: sideA.filter(c => c.completed).length,
        sideBCompleted: sideB.filter(c => c.completed).length,
        sideBRoutedByOntology: positives.filter(c => c.side === 'B' && c.routing?.routingSource === 'ONTOLOGY_RELATION_BINDING').length,
        wrongRoot: positives.filter(c => c.side === 'B' && c.correctBinding !== true).length,
        wrongRelation: positives.filter(c => c.side === 'B' && c.correctBinding !== true).length,
        wrongDirection: positives.filter(c => c.side === 'B' && c.correctBinding !== true).length,
        unauthorizedToolCalls: cases.reduce((n, c) => n + (c.unauthorizedToolCalls || 0), 0),
        writes: cases.reduce((n, c) => n + (c.writeAttempts || 0), 0),
        legacyPositiveCorrect: pairs.filter(p => p.aCorrectTargets === true).length,
        ontologyPositiveCorrect: pairs.filter(p => p.bCorrectTargets === true).length,
        toolSequenceRegressions: pairs.filter(p => p.completed && p.toolSequenceEquivalent === false).length,
        toolArgumentRegressions: pairs.filter(p => p.completed && p.toolArgsEquivalent === false).length,
        canonicalResultMismatches: pairs.filter(p => p.completed && p.canonicalEquivalent === false).length,
        canonicalRegressions: pairs.filter(p => p.completed && p.canonicalRegression === true).length,
        unexplainedMismatches: pairs.filter(p => p.completed && p.unexplainedMismatch === true).length,
        businessFactAnswerRegressions: pairs.filter(p => p.completed && p.answerFactRegression === true).length,
        // Efficiency, measured separately from formal read volume.
        ontologyInducedProviderCalls,
        legacyTotalModelCalls: sumCalls(sideA),
        ontologyTotalModelCalls: sumCalls(sideB),
        pairsOntologyMoreCalls: pairs.filter(p => p.completed && p.modelCallsIncreased === true).length,
        pairsOntologyEqualCalls: pairs.filter(p => p.completed && p.modelCallsEquivalent === true).length,
        pairsOntologyFewerCalls: pairs.filter(p => p.completed
            && (callsFor(raw, p, 'B') < callsFor(raw, p, 'A'))).length,
        legacyTotalToolCalls: sumTools(sideA),
        ontologyTotalToolCalls: sumTools(sideB),
        ontologyDeterministicReadCalls: sideB
            .reduce((n, c) => n + (c.routing?.deterministicReadCalls || 0), 0),
        positivePairs: pairs.length,
    };
    const m = manifest.metrics;
    const conditions = manifest.gatePassConditions;
    conditions.preflightOk = manifest.preflight?.ok === true;
    conditions.requestedProviderDeepseek = manifest.requestedProvider === 'deepseek';
    conditions.actualProviderDeepseek = manifest.actualProvider === 'deepseek';
    conditions.noFallbackForced = manifest.fallbackCount === 0;
    conditions.corpusHashUnchanged = manifest.corpusHash === EXPECTED_CORPUS_HASH;
    conditions.allCasesCompleted = m.totalExecutions > 0 && m.completed === m.totalExecutions;
    conditions.zeroWrongBinding = m.wrongRoot === 0 && m.wrongRelation === 0 && m.wrongDirection === 0;
    conditions.zeroUnauthorizedTool = m.unauthorizedToolCalls === 0;
    conditions.zeroWrite = m.writes === 0;
    conditions.zeroOntologyInducedProviderCalls = m.ontologyInducedProviderCalls === 0;
    conditions.zeroCanonicalRegression = m.canonicalRegressions === 0 && m.unexplainedMismatches === 0;
    conditions.zeroAnswerFactRegression = m.businessFactAnswerRegressions === 0;
    conditions.ontologyCorrectnessNotRegressed = m.ontologyPositiveCorrect >= m.legacyPositiveCorrect;
    conditions.fixturesUnchanged = raw.baseFixtureUnchanged === true && raw.ambiguousFixtureUnchanged === true;
    conditions.productionEligibilityUnchanged = raw.productionEligibilityUnchanged === true;
    return conditions;
}

function callsFor(raw, pair, side) {
    const entry = (raw.cases || []).find(c => c.caseId === `r${pair.round}-${pair.caseId}-${side}`);
    return entry?.modelCalls ?? 0;
}

async function main() {
    const repoRoot = path.resolve(__dirname, '..');
    const root = process.env.ONT_SHADOW_CONFIG_ROOT || process.cwd();
    const rounds = roundsArg(process.argv.slice(2));
    const only = onlyArg(process.argv.slice(2));
    const hashes = Object.fromEntries(CORPUS_ARTIFACTS.map(f => [f, sha256(fs.readFileSync(path.join(repoRoot, f)))]));
    const corpusHash = hashes['tests/helpers/ontologyRoutingCorpus.cjs'];
    // A subset run is a wiring smoke test and must never overwrite the committed gate record
    // or the full-run raw evidence.
    const subsetRun = Boolean(only.length);
    const manifestTarget = subsetRun ? 'logs/ontology-p6d-deepseek-smoke.json' : MANIFEST_PATH;
    const rawTarget = subsetRun ? 'logs/ontology-p6d-deepseek-smoke-raw.json' : RAW_PATH;
    const manifest = baseManifest({ repoRoot, rounds, hashes, corpusHash });
    const writeManifest = () => {
        manifest.generatedAt = new Date().toISOString();
        fs.mkdirSync(path.dirname(manifestTarget), { recursive: true });
        fs.writeFileSync(manifestTarget, JSON.stringify(manifest, null, 2) + '\n');
    };

    if (corpusHash !== EXPECTED_CORPUS_HASH) {
        manifest.primaryBlocker = 'CORPUS_HASH_CHANGED';
        writeManifest();
        console.error(`P6D_BLOCKED: frozen corpus hash changed (${corpusHash})`);
        process.exitCode = 2;
        return;
    }

    const deepseek = resolveProvider(root, 'deepseek');
    manifest.model = APPLICATION_MODEL;
    const probe = await preflight(deepseek);
    manifest.preflight = probe.record;
    manifest.actualProvider = probe.record.actualProvider;
    manifest.fallbackCount = probe.record.fallbackUsed ? 1 : 0;
    if (!probe.ok) {
        manifest.primaryBlocker = probe.blocker;
        writeManifest();
        console.error(`P6D_BLOCKED: ${probe.blocker}`);
        process.exitCode = 2;
        return;
    }

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p6d-deepseek-'));
    const filename = path.join(directory, 'fixture.db');
    const raw = { version: 1, rounds, cases: [], pairs: [] };
    let server, db;
    try {
        require('../tests/helpers/ontologyShadowFixture.cjs').fixture(filename).close();
        Object.assign(process.env, { NODE_ENV: 'test', NODE_TEST_CONTEXT: 'p6d-deepseek-controlled',
            PUMP_TEST_DATABASE_PATH: filename, KNOWLEDGE_AUTO_SYNC_ENABLED: 'false', KNOWLEDGE_VECTOR_ENABLED: 'false' });
        const express = require('express');
        const app = express();
        app.use(express.json());
        const previews = [/^\/api\/coils\/calculate$/, /^\/api\/cost\/(?:full-estimate|dynamic|parts)$/,
            /^\/api\/recipes\/(?:bom-draft|cost-draft|[1-9][0-9]*\/cost-preview)$/,
            /^\/api\/templates\/[1-9][0-9]*\/cost-preview$/];
        app.use((req, res, next) => req.method === 'GET'
            || (req.method === 'POST' && previews.some(p => p.test(req.path))) ? next()
            : res.status(403).json({ success: false, code: 'CONTROLLED_READ_ONLY' }));
        for (const name of ['recipes', 'coils', 'orders', 'quotations', 'customers', 'parts', 'templates', 'knowledge'])
            app.use(`/api/${name}`, require(`../api/routes/${name}.cjs`));
        app.use('/api', require('../api/routes/cost.cjs'));
        server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        process.env.PORT = String(server.address().port);
        db = require('../api/db.cjs').db;

        const { runAiAssistant, requiredCoilRecipeToolCall, assistantReadTools } = require('../api/services/aiAssistantRuntime.cjs');
        const { fetchAiProvider } = require('../api/services/aiProvider.cjs');
        const { executeToolCall } = require('../api/routes/ai/executor.cjs');
        const { beginAssistantSession } = require('../api/services/aiAssistantSession.cjs');
        const { bindRelation } = require('../api/ontology/relationBinder.cjs');
        const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
        const { buildEvidenceBundle } = require('../api/services/aiEvidenceBundle.cjs');
        const { createTaskEnvelope } = require('../api/services/aiTaskEnvelope.cjs');
        const shortlist = require('../api/services/aiToolShortlist.cjs');
        const { cases: allCases } = require('../tests/helpers/ontologyRoutingCorpus.cjs');
        const cases = only.length ? allCases.filter(c => only.includes(c.caseId)) : allCases;
        if (!cases.length) throw Error(`ONLY_FILTER_MATCHED_NOTHING:${only.join(',')}`);
        if (only.length) manifest.scope.subset = only;
        const readToolNames = new Set(assistantReadTools().map(t => t.function.name));

        const before = db.serialize();
        const changes = db.prepare('SELECT total_changes() n').get().n;

        async function seed(c) {
            const types = c.sessionType ? [c.sessionType] : ['coil', 'recipe'];
            const out = [];
            for (const type of types) {
                const name = type === 'coil' ? 'search_coils' : 'get_all_recipes';
                const args = type === 'coil' ? { spec: '12', sheets: 120 } : { keyword: 'Shadow配方甲' };
                out.push({ name, args, result: await executeToolCall(name, args, { allowWrite: false }) });
            }
            return out;
        }

        async function exec(c, round, side) {
            const caseId = `r${round}-${c.caseId}-${side}`;
            const conversationId = `p6d-${crypto.randomUUID()}`;
            const subject = 'p6d-deepseek-owner';
            const seeds = await seed(c);
            beginAssistantSession(subject, conversationId).finish({ toolResults: seeds });
            const binding = bindRelation({ ontologyVersion: 1, userText: c.userText, verifiedToolResults: seeds,
                subject, conversationId, trustedSession: { subject, conversationId, observedAt: Date.now(), toolResults: seeds } });
            const entry = { caseId, category: c.category, round, side, completed: false, provider: 'deepseek',
                bindingStatus: binding.status, root: binding.root || null, relationId: binding.relationId || null,
                modelCalls: 0, fallbacks: 0, providerEvents: [], tools: [], catalog: [], routing: null,
                unauthorizedToolCalls: 0, writeAttempts: 0 };
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(Object.assign(Error('CASE_TIMEOUT'), { code: 'CONTROLLED_TIMEOUT' })), CASE_TIMEOUT_MS);
            const overlay = side === 'B' ? installCounterfactualOverlay('deepseek') : null;
            try {
                const result = await runAiAssistant({
                    messages: [{ role: 'user', content: c.userText }], confirmationSubject: subject, conversationId,
                    signal: controller.signal, requestId: caseId,
                    env: { ...deepseek.env, AI_PROVIDER: 'deepseek', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'false',
                        [CANARY_FLAG]: side === 'B' ? 'true' : 'false', AI_ONTOLOGY_RELATION_SHADOW_ENABLED: 'false',
                        AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED: 'false', AI_ONTOLOGY_2HOP_SHADOW_ENABLED: 'false' },
                }, {
                    loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
                    ontologyRouting: { record: r => { entry.routing = r; } },
                    legacyRelationDetector: text => shortlist.isCoilRecipeRelationQuery(text),
                    legacyRelationRepair: (name, text) => requiredCoilRecipeToolCall(name, text),
                    fetchAiProvider: async (messages, options) => {
                        entry.modelCalls++;
                        entry.catalog = (options.tools || []).map(t => t.function.name);
                        return fetchAiProvider(messages, { ...options,
                            onProvider: info => { entry.providerEvents.push({ provider: info.provider,
                                fallback: Boolean(info.fallback), model: info.model || null });
                                if (info.fallback) entry.fallbacks++; options.onProvider?.(info); } });
                    },
                    executeToolCall: async (name, args, options) => {
                        if (!readToolNames.has(name)) entry.unauthorizedToolCalls++;
                        if (options?.allowWrite !== false) entry.writeAttempts++;
                        return executeToolCall(name, args, options);
                    },
                });
                entry.completed = true;
                entry.outcome = result.telemetry?.outcome || null;
                entry.tools = result.toolResults.map(t => ({ name: t.name, args: t.args, success: t.result?.success !== false }));
                entry.evidence = buildEvidenceBundle(createTaskEnvelope(c.userText), result.toolResults);
                entry.answer = result.finalContent;
                const facts = binding.status === 'BOUND' ? currentFactsForBinding(binding, result.toolResults) : null;
                entry.canonicalTargets = facts?.canonicalTargetIds || null;
                entry.canonicalComplete = facts?.complete === true && facts?.canonical === true;
                entry.expectedTargets = c.category === 'positive' ? (c.root.entityType === 'coil' ? ['301'] : ['501']) : null;
                entry.correctBinding = c.category !== 'positive'
                    || (equal(binding.root, c.root) && binding.relationId === c.relationId);
                entry.correctTargets = c.category !== 'positive'
                    || (entry.canonicalComplete && equal(entry.canonicalTargets, entry.expectedTargets));
                entry.answerFacts = c.category === 'positive' ? {
                    recipeIdentity: /Shadow配方甲|301/u.test(entry.answer),
                    coilIdentity: /Shadow线圈甲|SHADOW-501|501|12[-—~]120/u.test(entry.answer),
                    relationConclusion: /使用|用了|用的是|用到|采用|配的|配有|线圈|绕组/u.test(entry.answer),
                    extraRecipeIdentity: /Shadow空配方|Shadow旧配方|Shadow歧义配方/u.test(entry.answer),
                    extraCoilIdentity: /Shadow空线圈|SHADOW-502/u.test(entry.answer),
                } : null;
            } catch (error) {
                entry.errorCode = safeCode(error.code, 'REAL_RUNTIME_FAILURE');
            } finally {
                clearTimeout(timer);
                if (overlay) overlay();
            }
            raw.cases.push(entry);
            console.log(`  ${caseId} completed=${entry.completed} tools=${entry.tools.map(t => t.name).join('>') || '-'} calls=${entry.modelCalls} fallbacks=${entry.fallbacks}`);
            return entry;
        }

        const results = new Map();
        const jobs = [];
        // `ambiguous-root` needs an extra fixture row, so it runs separately after the base cases.
        const baseCases = cases.filter(c => c.caseId !== 'ambiguous-root');
        for (let round = 1; round <= rounds; round++)
            for (const c of baseCases) for (const side of ['A', 'B']) jobs.push({ c, round, side });
        let cursor = 0;
        await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
            while (cursor < jobs.length) {
                const job = jobs[cursor++];
                results.set(`${job.round}-${job.c.caseId}-${job.side}`, await exec(job.c, job.round, job.side));
            }
        }));

        raw.baseFixtureUnchanged = db.serialize().equals(before)
            && changes === db.prepare('SELECT total_changes() n').get().n;
        const ambiguous = cases.find(c => c.caseId === 'ambiguous-root');
        if (ambiguous) {
            db.prepare("INSERT INTO coils(id,scheme_name,scheme_code,spec,material,sheets) VALUES(503,'Shadow重名线圈','SHADOW-503','12','冷轧',120)").run();
            const ambiguousBefore = db.serialize();
            const ambiguousChanges = db.prepare('SELECT total_changes() n').get().n;
            for (const side of ['A', 'B']) results.set(`1-ambiguous-root-${side}`, await exec(ambiguous, 1, side));
            raw.ambiguousFixtureUnchanged = db.serialize().equals(ambiguousBefore)
                && ambiguousChanges === db.prepare('SELECT total_changes() n').get().n;
        } else raw.ambiguousFixtureUnchanged = raw.baseFixtureUnchanged;

        for (const c of cases) {
            for (let round = 1; round <= rounds; round++) {
                // `ambiguous-root` only executes round 1 (it needs an extra fixture row), so it
                // must not be paired against rounds that never ran.
                if (c.caseId === 'ambiguous-root' && round !== 1) continue;
                const a = results.get(`${round}-${c.caseId}-A`);
                const b = results.get(`${round}-${c.caseId}-B`);
                const completed = a?.completed === true && b?.completed === true;
                const aCorrect = a?.correctTargets === true;
                const bCorrect = b?.correctTargets === true;
                const canonicalEquivalent = equal(a?.canonicalTargets, b?.canonicalTargets);
                raw.pairs.push({ caseId: c.caseId, round, category: c.category, completed,
                    rootEquivalent: equal(a?.root, b?.root),
                    directionEquivalent: a?.relationId === b?.relationId,
                    toolSequenceEquivalent: equal(a?.tools?.map(t => t.name), b?.tools?.map(t => t.name)),
                    toolArgsEquivalent: equal(stable(a?.tools?.map(t => ({ name: t.name, args: t.args }))),
                        stable(b?.tools?.map(t => ({ name: t.name, args: t.args })))),
                    canonicalEquivalent,
                    // A regression means side A was correct and side B is not. B being MORE
                    // complete than A is an improvement, not a regression.
                    canonicalRegression: completed && aCorrect && !bCorrect,
                    answerFactRegression: completed && c.category === 'positive'
                        && equal(a?.answerFacts, b?.answerFacts) === false && bCorrect === false && aCorrect === true,
                    unexplainedMismatch: completed && canonicalEquivalent === false && !(aCorrect === false && bCorrect === true),
                    modelCallsIncreased: completed && (b?.modelCalls || 0) > (a?.modelCalls || 0),
                    modelCallsEquivalent: a?.modelCalls === b?.modelCalls,
                    aCorrectTargets: aCorrect, bCorrectTargets: bCorrect,
                    aTargets: a?.canonicalTargets || null, bTargets: b?.canonicalTargets || null });
            }
        }

        raw.productionEligibilityUnchanged = assertProductionEligibilityUnchanged();
        manifest.pairedRoundsCompleted = rounds;
        manifest.fallbackCount = raw.cases.reduce((n, c) => n + (c.fallbacks || 0), 0);
        const conditions = summarize(raw, manifest);
        const unmet = Object.entries(conditions).filter(([, ok]) => !ok).map(([k]) => k);
        manifest.primaryBlocker = manifest.fallbackCount > 0 ? 'FALLBACK_PRESENT'
            : unmet.length ? `GATE_CONDITION_UNMET:${unmet.join(',')}` : null;
        manifest.resultClassification = manifest.primaryBlocker ? 'REWORK' : 'PASS';
        manifest.databaseUnchanged = raw.baseFixtureUnchanged && raw.ambiguousFixtureUnchanged;
        manifest.subsetRun = Boolean(only.length);
        if (manifest.subsetRun && manifest.resultClassification !== 'PASS') manifest.primaryBlocker = `SUBSET_RUN:${manifest.primaryBlocker}`;
        fs.mkdirSync(path.dirname(rawTarget), { recursive: true });
        fs.writeFileSync(rawTarget, JSON.stringify(raw, null, 2) + '\n');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (db?.open) db.close();
        const resolved = path.resolve(directory);
        if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('INVALID_FIXTURE_DIRECTORY');
        fs.rmSync(resolved, { recursive: true, force: true });
    }

    writeManifest();
    console.log(JSON.stringify({ classification: manifest.resultClassification, blocker: manifest.primaryBlocker,
        metrics: manifest.metrics, manifest: manifestTarget, raw: rawTarget }, null, 2));
    if (manifest.resultClassification !== 'PASS') process.exitCode = 1;
}

if (require.main === module) main().catch(error => { console.error('P6D_DEEPSEEK_GATE_SETUP_FAILED', error?.message || ''); process.exitCode = 1; });

module.exports = { resolveProvider, preflight, baseManifest, summarize, installCounterfactualOverlay,
    assertProductionEligibilityUnchanged, GATE_CONDITIONS, EXPECTED_CORPUS_HASH };
