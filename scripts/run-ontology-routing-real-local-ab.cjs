'use strict';
/**
 * ONT-P6R formal Real-AI Canary Gate (STRICT LOCAL).
 *
 * Scope: the `recipe <-> coil` Controlled Routing Canary only.
 * A = canary OFF (legacy authoritative), B = canary ON (ontology profile routing).
 *
 * This is the formal tracked gate runner. It supersedes the untracked
 * `scripts/run-ontology-routing-real-ab.cjs`, which hardcoded `local-first`, required a
 * cloud API key and asserted a DeepSeek fallback chain, so it could never establish a
 * local baseline. The untracked script is preserved unchanged as evidence; see
 * docs/ontology-first-routing-migration-v1.md for the recorded hash and the relationship.
 *
 * Strict-local contract:
 *   - `AI_PROVIDER` is forced to `local`. `local-first` is NOT a valid gate mode.
 *   - Any request that reports a fallback, or resolves to a non-local provider,
 *     invalidates the run as `CLOUD_FALLBACK_PRESENT`. There is no scoring path where a
 *     cloud answer substitutes for a local one.
 *   - The local provider is probed before any corpus work. When unhealthy the run fails
 *     closed with zero corpus executions.
 *
 * Evidence split (never logs-only):
 *   - committed lightweight manifest: docs/ontology-p6r-real-local-gate.json
 *   - full raw per-case evidence (not committed): logs/ontology-p6r-real-local-raw.json
 *
 * Read-only: no production code, Business API, DB schema, Tool schema or prompt is changed.
 *
 * Usage:
 *   ONT_SHADOW_CONFIG_ROOT=<checkout with .env + pump.db> \
 *     node scripts/run-ontology-routing-real-local-ab.cjs [--rounds=2]
 * Exit codes: 0 PASS, 1 gate conditions unmet, 2 local provider unhealthy (BLOCKED).
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const MANIFEST_PATH = 'docs/ontology-p6r-real-local-gate.json';
const RAW_PATH = 'logs/ontology-p6r-real-local-raw.json';
const PREFLIGHT_TIMEOUT_MS = 8000;
const CASE_TIMEOUT_MS = 180000;
const RELATION_FAMILY = 'recipe_coil';
const CANARY_FLAG = 'AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED';
const CORPUS_ARTIFACTS = [
    'tests/helpers/ontologyRoutingCorpus.cjs',
    'tests/fixtures/ontology-coil-recipe-canary-v1.json',
    'tests/fixtures/ontology-coil-recipe-legacy-oracle-v1.json',
    'api/ontology/relationRoutingCanary.cjs',
    'api/ontology/bindingMetadata.cjs',
];
const GATE_CONDITIONS = ['preflightOk', 'actualProviderLocal', 'cloudFallbackCountZero', 'allCasesCompleted',
    'eligibleRoutedByOntology', 'eligibleLegacyNotUsed', 'zeroWrongBinding', 'zeroNegativeFalseRoute',
    'zeroCanonicalMismatch', 'zeroAnswerFactRegression', 'zeroModelCallIncrease', 'fixturesUnchanged'];

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

function gitValue(args, root) {
    try { return require('node:child_process').execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
    catch { return null; }
}

/** Reads the *current* runtime config; the base URL is never hardcoded. */
function resolveLocalConfig(root) {
    const env = { ...process.env, ...require('dotenv').parse(fs.readFileSync(path.join(root, '.env'))) };
    const Database = require('better-sqlite3');
    const configDb = new Database(path.join(root, 'pump.db'), { readonly: true, fileMustExist: true });
    const config = require('../api/services/runtimeConfig.cjs');
    try {
        const snapshot = config.effectiveValues({ env, dbAccessors: { db: configDb } });
        for (const [field, value] of Object.entries(snapshot.values)) env[config.DEFINITIONS[field].env] = value;
    } finally { configDb.close(); }
    const provider = require('../api/services/aiProviderRegistry.cjs').resolveProviderConfig('local', env);
    return { env, baseUrl: String(provider.baseUrl || '').replace(/\/$/u, ''), model: provider.model || null };
}

function httpGet(url, timeoutMs = PREFLIGHT_TIMEOUT_MS) {
    return new Promise(resolve => {
        let settled = false;
        const finish = record => { if (!settled) { settled = true; resolve(record); } };
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.get(url, { timeout: timeoutMs }, response => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { if (body.length < 65536) body += chunk; });
            response.on('end', () => finish({ ok: response.statusCode === 200, httpStatus: response.statusCode, body }));
        });
        request.on('timeout', () => { finish({ ok: false, error: 'LOCAL_PROVIDER_TIMEOUT' }); request.destroy(); });
        request.on('error', error => finish({ ok: false, error: safeCode(error.code, 'LOCAL_PROVIDER_UNAVAILABLE') }));
    });
}

/** Fail-closed local provider preflight. Zero corpus cases run when unhealthy. */
async function preflight({ baseUrl, env }) {
    const record = { baseUrl, modelsEndpoint: false, modelsHttpStatus: null, servedModelIds: [], minimalChat: null,
        minimalToolCall: null, requestedProvider: 'local', actualProvider: null, fallbackUsed: null, httpError: null };
    const models = await httpGet(new URL(`${baseUrl}/models`));
    record.modelsEndpoint = Boolean(models.ok);
    record.modelsHttpStatus = models.httpStatus ?? null;
    if (!models.ok) { record.httpError = models.error || 'LOCAL_PROVIDER_UNHEALTHY';
        return { ok: false, blocker: record.httpError, record }; }
    try {
        const parsed = JSON.parse(models.body);
        record.servedModelIds = (Array.isArray(parsed?.data) ? parsed.data : []).map(m => m?.id).filter(Boolean).slice(0, 8);
    } catch { /* identity is advisory; the chat probe decides health */ }

    const { fetchAiProvider } = require('../api/services/aiProvider.cjs');
    const localEnv = { ...env, AI_PROVIDER: 'local' };
    const events = [];
    const onProvider = info => events.push(info);

    try {
        const response = await fetchAiProvider([{ role: 'user', content: '只回复两个字：就绪' }],
            { env: localEnv, onProvider, stream: false });
        const payload = await response.json();
        const content = payload?.choices?.[0]?.message?.content;
        record.minimalChat = { responded: typeof content === 'string' && content.trim().length > 0,
            reportedModel: payload?.model || null };
    } catch (error) {
        record.minimalChat = { responded: false, error: safeCode(error.code, 'LOCAL_CHAT_FAILED') };
    }

    // Minimal tool-call probe uses the project's real registered read tool schema.
    try {
        const { AI_TOOLS } = require('../api/routes/ai/tools.cjs');
        const tool = AI_TOOLS.find(t => t.function?.name === 'get_all_recipes');
        const response = await fetchAiProvider([{ role: 'user', content: '请调用工具列出全部配方' }],
            { env: localEnv, onProvider, tools: tool ? [tool] : [], toolChoice: 'required', stream: false });
        const payload = await response.json();
        const calls = payload?.choices?.[0]?.message?.tool_calls;
        record.minimalToolCall = { supported: Array.isArray(calls) && calls.length > 0,
            toolName: calls?.[0]?.function?.name || null };
    } catch (error) {
        record.minimalToolCall = { supported: false, error: safeCode(error.code, 'LOCAL_TOOL_CALL_FAILED') };
    }

    const providers = [...new Set(events.map(e => e?.provider).filter(Boolean))];
    record.actualProvider = providers.length === 1 ? providers[0] : (providers.join(',') || null);
    record.fallbackUsed = events.some(e => e?.fallback === true || e?.failed === true);
    const ok = record.modelsEndpoint === true && record.minimalChat?.responded === true
        && record.minimalToolCall?.supported === true && record.actualProvider === 'local' && record.fallbackUsed === false;
    return { ok, blocker: ok ? null : 'LOCAL_PROVIDER_UNHEALTHY', record };
}

function baseManifest({ repoRoot, rounds, hashes }) {
    return {
        version: 1,
        gate: 'ONT-P6R',
        scope: { relationFamily: RELATION_FAMILY, provider: 'local', canaryFlag: CANARY_FLAG },
        // Provenance is this gate's own repository, never the external config checkout.
        branch: gitValue(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot),
        commit: gitValue(['rev-parse', 'HEAD'], repoRoot),
        generatedAt: null,
        requestedProvider: 'local',
        actualProvider: null,
        model: null,
        fallbackUsed: null,
        cloudFallbackCount: null,
        corpusVersion: 'P6R frozen 28-case (8 positive / 20 negative)',
        corpusHash: hashes['tests/helpers/ontologyRoutingCorpus.cjs'] || null,
        artifactHashes: hashes,
        pairedRoundsPlanned: rounds,
        pairedRoundsCompleted: 0,
        deterministicGate: 'PASS (see docs/ontology-first-routing-migration-v1.md)',
        realLocalAiGate: 'BLOCKED',
        preflight: null,
        metrics: {},
        gatePassConditions: Object.fromEntries(GATE_CONDITIONS.map(k => [k, false])),
        resultClassification: 'BLOCKED',
        primaryBlocker: null,
        databaseUnchanged: null,
    };
}

function summarize(raw, manifest) {
    const cases = raw.cases || [];
    const positives = cases.filter(c => c.category === 'positive');
    const negatives = cases.filter(c => c.category === 'negative');
    const pairs = (raw.pairs || []).filter(p => p.category === 'positive');
    const eligibleOn = positives.filter(c => c.canaryOn && c.routing?.eligible);
    manifest.metrics = {
        totalExecutions: cases.length,
        completed: cases.filter(c => c.completed).length,
        canaryEligible: eligibleOn.length,
        canaryNotEligible: cases.filter(c => c.routing && c.routing.eligible === false).length,
        eligibleOffCompleted: positives.filter(c => !c.canaryOn && c.completed).length,
        eligibleOnCompleted: eligibleOn.filter(c => c.completed).length,
        ontologyRouted: positives.filter(c => c.routing?.routingSource === 'ONTOLOGY_RELATION_BINDING').length,
        legacyRouted: positives.filter(c => c.routing?.routingSource === 'LEGACY_RELATION_SPECIAL_CASE').length,
        legacyDetectorCallsUnderEligibleOn: eligibleOn.reduce((n, c) => n + (c.legacyDetectorCalls || 0), 0),
        legacyRepairCallsUnderEligibleOn: eligibleOn.reduce((n, c) => n + (c.legacyRepairCalls || 0), 0),
        negativeFalseRoutes: negatives.filter(c => c.routing?.routingSource === 'ONTOLOGY_RELATION_BINDING').length,
        wrongBindings: positives.filter(c => c.correctBinding !== true).length,
        toolSequenceRegressions: pairs.filter(p => p.completed && p.toolSequenceEquivalent === false).length,
        toolArgumentRegressions: pairs.filter(p => p.completed && p.toolArgsEquivalent === false).length,
        canonicalResultMismatches: pairs.filter(p => p.completed && p.canonicalEquivalent === false).length,
        answerFactRegressions: pairs.filter(p => p.completed && p.answerFactsEquivalent === false).length,
        modelCallIncreases: pairs.filter(p => p.completed && p.modelCallsEquivalent === false).length,
        positivePairs: pairs.length,
    };
    const m = manifest.metrics;
    const conditions = manifest.gatePassConditions;
    conditions.preflightOk = manifest.preflight?.ok === true;
    conditions.actualProviderLocal = manifest.actualProvider === 'local';
    conditions.cloudFallbackCountZero = manifest.cloudFallbackCount === 0;
    conditions.allCasesCompleted = m.totalExecutions > 0 && m.completed === m.totalExecutions;
    conditions.eligibleRoutedByOntology = m.ontologyRouted > 0 && m.ontologyRouted === eligibleOn.length
        && m.legacyRouted === (m.totalExecutions - m.ontologyRouted);
    conditions.eligibleLegacyNotUsed = m.legacyDetectorCallsUnderEligibleOn === 0 && m.legacyRepairCallsUnderEligibleOn === 0;
    conditions.zeroWrongBinding = m.wrongBindings === 0;
    conditions.zeroNegativeFalseRoute = m.negativeFalseRoutes === 0;
    conditions.zeroCanonicalMismatch = m.canonicalResultMismatches === 0 && m.toolSequenceRegressions === 0
        && m.toolArgumentRegressions === 0;
    conditions.zeroAnswerFactRegression = m.answerFactRegressions === 0;
    conditions.zeroModelCallIncrease = m.modelCallIncreases === 0;
    conditions.fixturesUnchanged = raw.baseFixtureUnchanged === true && raw.ambiguousFixtureUnchanged === true;
    return conditions;
}

async function main() {
    const repoRoot = path.resolve(__dirname, '..');
    const root = process.env.ONT_SHADOW_CONFIG_ROOT || process.cwd();
    const rounds = roundsArg(process.argv.slice(2));
    const hashes = Object.fromEntries(CORPUS_ARTIFACTS.map(f => [f, sha256(fs.readFileSync(path.join(repoRoot, f)))]));
    const manifest = baseManifest({ repoRoot, rounds, hashes });
    const writeManifest = () => {
        manifest.generatedAt = new Date().toISOString();
        fs.mkdirSync(path.dirname(MANIFEST_PATH), { recursive: true });
        fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    };

    const local = resolveLocalConfig(root);
    manifest.model = local.model;
    const probe = await preflight(local);
    manifest.preflight = probe.record;
    manifest.actualProvider = probe.record.actualProvider;
    manifest.fallbackUsed = probe.record.fallbackUsed;

    if (!probe.ok) {
        // Fail closed: zero corpus cases executed, no gate result claimed.
        manifest.primaryBlocker = probe.blocker;
        writeManifest();
        console.error(`P6R_REAL_LOCAL_GATE_BLOCKED: ${probe.blocker}`);
        console.error(`manifest: ${MANIFEST_PATH}`);
        process.exitCode = 2;
        return;
    }

    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'p6r-local-gate-'));
    const filename = path.join(directory, 'fixture.db');
    const raw = { version: 1, rounds, cases: [], pairs: [] };
    let server, db;
    try {
        require('../tests/helpers/ontologyShadowFixture.cjs').fixture(filename).close();
        Object.assign(process.env, { NODE_ENV: 'test', NODE_TEST_CONTEXT: 'p6r-real-local-controlled',
            PUMP_TEST_DATABASE_PATH: filename, KNOWLEDGE_AUTO_SYNC_ENABLED: 'false', KNOWLEDGE_VECTOR_ENABLED: 'false' });
        const express = require('express');
        const app = express();
        app.use(express.json());
        // Controlled read-only surface: GET everywhere plus the existing read previews.
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

        const { runAiAssistant, requiredCoilRecipeToolCall } = require('../api/services/aiAssistantRuntime.cjs');
        const { fetchAiProvider } = require('../api/services/aiProvider.cjs');
        const { executeToolCall } = require('../api/routes/ai/executor.cjs');
        const { beginAssistantSession } = require('../api/services/aiAssistantSession.cjs');
        const { bindRelation } = require('../api/ontology/relationBinder.cjs');
        const { currentFactsForBinding } = require('../api/ontology/bindingCurrentFacts.cjs');
        const { buildEvidenceBundle } = require('../api/services/aiEvidenceBundle.cjs');
        const { createTaskEnvelope } = require('../api/services/aiTaskEnvelope.cjs');
        const shortlist = require('../api/services/aiToolShortlist.cjs');
        const { cases } = require('../tests/helpers/ontologyRoutingCorpus.cjs');

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

        async function exec(c, round, canaryOn) {
            const caseId = `r${round}-${c.caseId}-${canaryOn ? 'on' : 'off'}`;
            const conversationId = `local-gate-${crypto.randomUUID()}`;
            const subject = 'p6r-local-gate-owner';
            const seeds = await seed(c);
            beginAssistantSession(subject, conversationId).finish({ toolResults: seeds });
            const binding = bindRelation({ ontologyVersion: 1, userText: c.userText, verifiedToolResults: seeds,
                subject, conversationId, trustedSession: { subject, conversationId, observedAt: Date.now(), toolResults: seeds } });
            const entry = { caseId, category: c.category, round, canaryOn, completed: false, runtimeMode: 'local',
                bindingStatus: binding.status, root: binding.root || null, relationId: binding.relationId || null,
                providers: [], modelCalls: 0, cloudFallbacks: 0, legacyDetectorCalls: 0, legacyRepairCalls: 0, routing: null };
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(Object.assign(Error('CASE_TIMEOUT'), { code: 'CONTROLLED_TIMEOUT' })), CASE_TIMEOUT_MS);
            try {
                const result = await runAiAssistant({
                    messages: [{ role: 'user', content: c.userText }], confirmationSubject: subject, conversationId,
                    signal: controller.signal, requestId: caseId,
                    env: { ...local.env, AI_PROVIDER: 'local', AI_LOCAL_TOOL_SHORTLIST_ENABLED: 'true',
                        [CANARY_FLAG]: String(canaryOn), AI_ONTOLOGY_RELATION_SHADOW_ENABLED: 'false',
                        AI_ONTOLOGY_RELATION_BINDING_SHADOW_ENABLED: 'false', AI_ONTOLOGY_2HOP_SHADOW_ENABLED: 'false' },
                }, {
                    loadMemory: async () => ({ items: [] }), loadCorrections: () => '',
                    ontologyRouting: { record: r => { entry.routing = r; } },
                    legacyRelationDetector: text => { entry.legacyDetectorCalls++; return shortlist.isCoilRecipeRelationQuery(text); },
                    legacyRelationRepair: (name, text) => { entry.legacyRepairCalls++; return requiredCoilRecipeToolCall(name, text); },
                    fetchAiProvider: async (messages, options) => {
                        entry.modelCalls++;
                        return fetchAiProvider(messages, { ...options,
                            onProvider: info => { entry.providers.push({ provider: info.provider, fallback: Boolean(info.fallback), model: info.model || null });
                                if (info.fallback) entry.cloudFallbacks++; options.onProvider?.(info); } });
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
            } finally { clearTimeout(timer); }
            raw.cases.push(entry);
            return entry;
        }

        const results = new Map();
        for (let round = 1; round <= rounds; round++) {
            for (const c of cases) {
                for (const on of [false, true]) results.set(`${round}-${c.caseId}-${on}`, await exec(c, round, on));
            }
        }
        raw.baseFixtureUnchanged = db.serialize().equals(before)
            && changes === db.prepare('SELECT total_changes() n').get().n;

        // Ambiguous-root fixture is created after the base cases; still never a runtime write.
        db.prepare("INSERT INTO coils(id,scheme_name,scheme_code,spec,material,sheets) VALUES(503,'Shadow重名线圈','SHADOW-503','12','冷轧',120)").run();
        const ambiguousBefore = db.serialize();
        const ambiguousChanges = db.prepare('SELECT total_changes() n').get().n;
        const ambiguous = cases.find(c => c.caseId === 'ambiguous-root');
        for (const on of [false, true]) await exec(ambiguous, 1, on);
        raw.ambiguousFixtureUnchanged = db.serialize().equals(ambiguousBefore)
            && ambiguousChanges === db.prepare('SELECT total_changes() n').get().n;

        for (const c of cases) {
            for (let round = 1; round <= rounds; round++) {
                const off = results.get(`${round}-${c.caseId}-false`);
                const on = results.get(`${round}-${c.caseId}-true`);
                raw.pairs.push({ caseId: c.caseId, round, category: c.category,
                    completed: off?.completed === true && on?.completed === true,
                    rootEquivalent: equal(off?.root, on?.root),
                    directionEquivalent: off?.relationId === on?.relationId,
                    toolSequenceEquivalent: equal(off?.tools?.map(t => t.name), on?.tools?.map(t => t.name)),
                    requiredToolsEquivalent: c.category === 'positive'
                        ? ['search_coils', 'get_all_recipes'].every(n => off?.tools?.some(t => t.name === n && t.success)
                            && on?.tools?.some(t => t.name === n && t.success))
                        : equal(off?.providers?.[0]?.provider, on?.providers?.[0]?.provider),
                    toolArgsEquivalent: equal(stable(off?.tools?.map(t => ({ name: t.name, args: t.args }))),
                        stable(on?.tools?.map(t => ({ name: t.name, args: t.args })))),
                    canonicalEquivalent: c.category === 'positive'
                        ? off?.correctTargets === true && on?.correctTargets === true && equal(off?.canonicalTargets, on?.canonicalTargets)
                        : null,
                    evidenceEquivalent: equal(off?.evidence, on?.evidence),
                    answerFactsEquivalent: c.category === 'positive'
                        ? equal(off?.answerFacts, on?.answerFacts)
                            && Object.entries(on?.answerFacts || {}).every(([k, v]) => k.startsWith('extra') ? !v : v)
                        : null,
                    modelCallsEquivalent: off?.modelCalls === on?.modelCalls,
                });
            }
        }

        manifest.pairedRoundsCompleted = rounds;
        manifest.cloudFallbackCount = raw.cases.reduce((n, c) => n + (c.cloudFallbacks || 0), 0);
        manifest.fallbackUsed = manifest.cloudFallbackCount > 0;
        const conditions = summarize(raw, manifest);
        const unmet = Object.entries(conditions).filter(([, ok]) => !ok).map(([k]) => k);
        manifest.primaryBlocker = manifest.cloudFallbackCount > 0 ? 'CLOUD_FALLBACK_PRESENT'
            : unmet.length ? `GATE_CONDITION_UNMET:${unmet.join(',')}` : null;
        manifest.resultClassification = manifest.primaryBlocker ? 'REWORK' : 'PASS';
        manifest.realLocalAiGate = manifest.resultClassification;
        manifest.databaseUnchanged = raw.baseFixtureUnchanged && raw.ambiguousFixtureUnchanged;

        fs.mkdirSync(path.dirname(RAW_PATH), { recursive: true });
        fs.writeFileSync(RAW_PATH, JSON.stringify(raw, null, 2) + '\n');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (db?.open) db.close();
        const resolved = path.resolve(directory);
        if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw Error('INVALID_FIXTURE_DIRECTORY');
        fs.rmSync(resolved, { recursive: true, force: true });
    }

    writeManifest();
    console.log(JSON.stringify({ classification: manifest.resultClassification, blocker: manifest.primaryBlocker,
        metrics: manifest.metrics, manifest: MANIFEST_PATH, raw: RAW_PATH }));
    if (manifest.resultClassification !== 'PASS') process.exitCode = 1;
}

if (require.main === module) main().catch(() => { console.error('P6R_REAL_LOCAL_GATE_SETUP_FAILED'); process.exitCode = 1; });

module.exports = { resolveLocalConfig, preflight, baseManifest, summarize, GATE_CONDITIONS, RELATION_FAMILY, CANARY_FLAG };
