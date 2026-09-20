'use strict';
/**
 * Relation runtime acceptance runner — two independent gates.
 *
 * Supervisor ruling (ONT-P8L-FINAL): the two gates validate two DIFFERENT execution paths and must
 * never substitute for each other.
 *
 *   --gate p8l-local        P8L Local Exit Gate
 *                           AI_PROVIDER=local + AI_LOCAL_TOOL_SHORTLIST_ENABLED=true
 *                           actual provider must be local, cloud fallback must stay 0.
 *                           This is the hard gate ONT-P8L has owed since §17.4.
 *
 *   --gate ontology-cloud   Ontology Cloud Routing Gate
 *                           AI_PROVIDER=deepseek + AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED=true
 *                           validates ontology canonical binding + software-planned reads on the
 *                           cloud production path.
 *
 * Fail-closed by construction:
 *   - `--execute` is required; a dry preflight never sends a model request;
 *   - every gate asserts its own flag combination and aborts on mismatch;
 *   - an unrelated provider (for example a silent cloud fallback during the local gate) aborts the run;
 *   - a verdict that misses any required number is reported as FAIL, never redefined into a PASS;
 *   - the business-unchanged claim uses a logical fingerprint (row counts + content hash + audit and
 *     operation deltas), never a WAL-mode file hash.
 *
 * Usage:
 *   node scripts/run-relation-runtime-acceptance.cjs --gate p8l-local --execute [--rounds 2]
 *   node scripts/run-relation-runtime-acceptance.cjs --gate ontology-cloud --execute [--rounds 2]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const GATE_IDS = Object.freeze(['p8l-local', 'ontology-cloud']);
const VERDICT_STATUSES = Object.freeze(['PASS', 'FAIL', 'ABORTED']);
const BUSINESS_TABLES = Object.freeze(['recipes', 'coils', 'parts', 'orders', 'customers', 'quotations', 'pump_shell_templates', 'system_settings']);
const MAX_BOUNDED_BYTES = 32768;
const MAX_AGGREGATE_BYTES = 98304;

// Eight relation cases and the four negatives, asserted against the live database below rather than
// trusted blindly. Truth is read from `recipes.coil_id` at run time.
const RELATION_CASES = Object.freeze([
    Object.freeze({ id: 'R1-coil120-to-recipes', direction: 'coil->recipes', coilSpec: '12', coilSheets: 120, seed: '12-120 线圈有哪些正式方案？', question: '这个线圈用在哪些配方？' }),
    Object.freeze({ id: 'R2-coil140-to-recipes', direction: 'coil->recipes', coilSpec: '12', coilSheets: 140, seed: '12-140 线圈的规格和片数是什么？', question: '12-140线圈被哪些配方使用？' }),
    Object.freeze({ id: 'R3-coil160-to-recipes', direction: 'coil->recipes', coilSpec: '12', coilSheets: 160, seed: '12-160 线圈有哪些方案？', question: '12-160线圈用在哪些配方？' }),
    Object.freeze({ id: 'R4-coil200-to-recipes', direction: 'coil->recipes', coilSpec: '12', coilSheets: 200, seed: '12-200 线圈的规格是什么？', question: '12-200线圈被哪些配方使用？' }),
    Object.freeze({ id: 'R5-recipe-v750-to-coil', direction: 'recipe->coil', recipeId: 2, seed: 'v750-tokoy 用的是哪个泵壳模板？', question: 'v750-tokoy 用的是哪个线圈？' }),
    Object.freeze({ id: 'R6-recipe-v1100-to-coil', direction: 'recipe->coil', recipeId: 3, seed: 'V1100-2寸 的配件明细有哪些？', question: 'V1100-2寸 配的什么绕组？' }),
    Object.freeze({ id: 'R7-recipe-v1500-to-coil', direction: 'recipe->coil', recipeId: 6, seed: 'v1500-DY-ml 用了哪个泵壳模板？', question: 'v1500-DY-ml 用的是哪个线圈？' }),
    Object.freeze({ id: 'R8-recipe-800-to-coil', direction: 'recipe->coil', recipeId: 7, seed: '800直出水切割泵 的配件明细有哪些？', question: '800直出水切割泵 配的什么线圈？' }),
]);

const NEGATIVE_CASES = Object.freeze([
    Object.freeze({ id: 'N1-absent-coil', kind: 'absent-coil', question: '99-999线圈被哪些配方使用？' }),
    Object.freeze({ id: 'N2-ambiguous-coil', kind: 'ambiguous-coil', question: '12-120线圈和12-140线圈用在哪些配方？' }),
    Object.freeze({ id: 'N3-unrelated', kind: 'unrelated', question: '最近有哪些订单？' }),
    Object.freeze({ id: 'N4-write', kind: 'write', question: '把12-120线圈的库存改成100' }),
]);

const GATES = Object.freeze({
    'p8l-local': Object.freeze({
        id: 'p8l-local',
        label: 'P8L Local Exit Gate',
        env: Object.freeze({
            requireEnabled: Object.freeze(['AI_LOCAL_TOOL_SHORTLIST_ENABLED']),
            requireDisabled: Object.freeze(['AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED']),
            providerMustBe: 'local',
            requireProviderSet: true,
            extraProviders: Object.freeze(['local']),
        }),
        required: Object.freeze({ reverseCorrectRatio: 1, forwardCorrectRatio: 1, cloudFallbacks: 0, payloadLimitFailures: 0, unauthorizedWrites: 0, aggregateCalls: 0, wrongRoot: 0, wrongDirection: 0 }),
    }),
    'ontology-cloud': Object.freeze({
        id: 'ontology-cloud',
        label: 'Ontology Cloud Routing Gate',
        env: Object.freeze({
            requireEnabled: Object.freeze(['AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED']),
            requireDisabled: Object.freeze([]),
            providerMustBe: 'deepseek',
            requireProviderSet: true,
            extraProviders: Object.freeze(['deepseek']),
        }),
        required: Object.freeze({ reverseCorrectRatio: 1, forwardCorrectRatio: 1, cloudFallbacks: 0, payloadLimitFailures: 0, unauthorizedWrites: 0, aggregateCalls: 0, wrongRoot: 0, wrongDirection: 0 }),
    }),
});

function abortError(code, message) {
    return Object.assign(new Error(message), { code });
}

function argOf(argv, name, fallback) {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

/** Normalise a production .env into the shape the runtime sees. */
function runtimeEnvFrom(envFileText, processEnvironment = {}) {
    const parsed = require('dotenv').parse(envFileText || '');
    return { ...processEnvironment, ...parsed };
}

function gateProfile(gateId) {
    const profile = GATES[gateId];
    if (!profile) throw abortError('GATE_UNKNOWN', `Unknown gate: ${gateId || '(missing)'}; expected one of ${GATE_IDS.join(', ')}`);
    return profile;
}

/**
 * Pure precondition check. Throws GATE_PRECONDITION_FAILED with every violation, so a mislabelled run
 * (for example a cloud fallback inside the local gate) can never be reported as that gate's acceptance.
 */
function assertGatePreconditions(gateId, env) {
    const profile = gateProfile(gateId);
    const { isEnvFlagEnabled } = require('../api/services/environment.cjs');
    const { resolveAiProviderConfig } = require('../api/services/aiProviderRegistry.cjs');
    const violations = [];

    for (const name of profile.env.requireEnabled) {
        if (!isEnvFlagEnabled(env, name)) violations.push(`${name} must be enabled (true)`);
    }
    for (const name of profile.env.requireDisabled) {
        if (isEnvFlagEnabled(env, name)) violations.push(`${name} must be disabled (false)`);
    }

    // Exactly one provider is accepted per gate. A resolved provider that merely happens to differ from
    // the configured value is still a mislabelled run, so there is no fallback whitelist here.
    const required = profile.env.providerMustBe;
    const configured = String(env.AI_PROVIDER || '').trim().toLowerCase();
    if (profile.env.requireProviderSet && !configured) {
        violations.push(`AI_PROVIDER must be set explicitly to ${required}`);
    } else if (configured && configured !== required) {
        violations.push(`AI_PROVIDER is ${configured}, gate ${profile.id} requires ${required}`);
    }
    let resolved = null;
    try {
        resolved = resolveAiProviderConfig(env);
    } catch (error) {
        violations.push(`AI_PROVIDER could not be resolved: ${error.message}`);
    }
    if (resolved) {
        const actual = String(resolved.provider || '').trim().toLowerCase();
        if (actual !== required) {
            violations.push(`resolved provider is ${actual}, gate ${profile.id} requires ${required}`);
        }
    }
    if (violations.length > 0) {
        throw abortError('GATE_PRECONDITION_FAILED', violations.join('; '));
    }
    return { profile, resolved };
}

/** Versioned logical fingerprint: never a WAL-mode file hash. */
function businessFingerprint(db) {
    const tables = {};
    for (const table of BUSINESS_TABLES) {
        let rows;
        try {
            rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
        } catch {
            tables[table] = { rows: null, hash: null, unavailable: true };
            continue;
        }
        const normalized = rows.map(row => {
            const copy = { ...row };
            delete copy.created_at;
            delete copy.updated_at;
            return copy;
        });
        tables[table] = {
            rows: rows.length,
            hash: crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex'),
        };
    }
    const maxId = (table) => {
        try {
            return db.prepare(`SELECT COALESCE(MAX(id), 0) n FROM ${table}`).get()?.n ?? 0;
        } catch {
            return null;
        }
    };
    return { version: 1, tables, auditMaxId: maxId('audit_log'), operationMaxId: maxId('api_operations') };
}

function fingerprintDiff(before, after) {
    const changedTables = [];
    for (const table of Object.keys(before.tables)) {
        const left = before.tables[table] || {};
        const right = (after.tables || {})[table] || {};
        if (left.hash !== right.hash || left.rows !== right.rows) changedTables.push(table);
    }
    return {
        changedTables,
        auditDelta: (after.auditMaxId ?? 0) - (before.auditMaxId ?? 0),
        operationDelta: (after.operationMaxId ?? 0) - (before.operationMaxId ?? 0),
    };
}

function truthFor(db, entry) {
    if (entry.direction === 'coil->recipes') {
        const coil = db.prepare("SELECT id FROM coils WHERE spec=? AND sheets=? AND scheme_status='official' ORDER BY id").get(entry.coilSpec, entry.coilSheets);
        if (!coil) return { expected: [], coilId: null, note: 'NO_OFFICIAL_VARIANT' };
        const rows = db.prepare('SELECT id, name FROM recipes WHERE coil_id=? ORDER BY id').all(coil.id);
        return { expected: rows.map(row => row.name), coilId: coil.id, recipeIds: rows.map(row => row.id), note: null };
    }
    const recipe = db.prepare('SELECT id, name, coil_id FROM recipes WHERE id=?').get(entry.recipeId);
    if (!recipe) return { expected: [], recipeId: null, note: 'NO_RECIPE' };
    const coil = recipe.coil_id
        ? db.prepare('SELECT id, spec, sheets FROM coils WHERE id=?').get(recipe.coil_id)
        : db.prepare('SELECT id, spec, sheets FROM coils WHERE spec=? AND sheets=? ORDER BY id').get(entry.coilSpec, entry.coilSheets);
    return { expected: coil ? [`${coil.spec}-${coil.sheets}`] : [], coilId: coil?.id ?? null, note: coil ? null : 'NO_BOUND_COIL' };
}

/**
 * A "wrong" answer cannot be told apart from a missing one by an exact-match test alone, but the two
 * required counters must still be computed deterministically: a target that is not the expected one is
 * counted as wrong root; a coil answer whose 规格-片数 is not the expected one is counted as wrong coil.
 */
function classifyAnswer(entry, truth, content) {
    const text = String(content || '');
    const hits = truth.expected.filter(value => text.includes(value));
    const wrong = [];
    if (truth.expected.length > 0 && hits.length === 0) {
        if (entry.direction === 'recipe->coil') {
            const seen = text.match(/\b(\d{1,3})-(\d{2,4})\b/g) || [];
            const expectedShapes = new Set(truth.expected);
            for (const shape of seen) if (!expectedShapes.has(shape)) wrong.push(shape);
        }
    }
    return { hits, correct: hits.length > 0, wrongTargets: wrong };
}

function parseSse(text) {
    const events = [];
    for (const block of String(text || '').split('\n\n')) {
        const line = block.split('\n').find(item => item.startsWith('data: '));
        if (!line) continue;
        try {
            events.push(JSON.parse(line.slice(6)));
        } catch {
            // A partial frame is not evidence; the caller still requires `done`.
        }
    }
    return events;
}

function summarizeCase(entry, truth, response) {
    const classified = classifyAnswer(entry, truth, response.content);
    const boundedAggregateBytes = response.aggregateBytes;
    return {
        caseId: entry.id,
        direction: entry.direction,
        question: entry.question,
        expected: truth.expected,
        truthNote: truth.note,
        hits: classified.hits,
        correct: truth.expected.length === 0 ? null : classified.correct,
        wrongTargets: classified.wrongTargets,
        done: response.done,
        providers: response.providers,
        fallbacks: response.fallbacks,
        errorCodes: response.errorCodes,
        bounded: response.boundedResults,
        boundedBeforeFirstModel: response.boundedBeforeFirstModel,
        aggregateCalls: response.aggregateCalls,
        aggregateBytes: boundedAggregateBytes,
        aggregateRefusedCodes: response.aggregateRefusedCodes,
        tooLarge: response.tooLarge,
        writeProtected: entry.kind === 'write' ? /待确认|确认卡片/.test(response.content) : null,
        answerPreview: String(response.content || '').slice(0, 400),
    };
}

/** Deterministic verdict: a missed requirement is FAIL, never silently redefined. */
function evaluateVerdict({ profile, cases, negativeCases, fingerprintDiffResult }) {
    const relation = cases.filter(entry => entry.correct !== null);
    const reverse = relation.filter(entry => entry.direction === 'coil->recipes');
    const forward = relation.filter(entry => entry.direction === 'recipe->coil');
    const ratio = (list) => (list.length === 0 ? 0 : list.filter(entry => entry.correct).length / list.length);
    const sum = (list, pick) => list.reduce((total, entry) => total + (pick(entry) || 0), 0);

    const observed = {
        reverseTotal: reverse.length,
        reverseCorrect: reverse.filter(entry => entry.correct).length,
        reverseRatio: Number(ratio(reverse).toFixed(4)),
        forwardTotal: forward.length,
        forwardCorrect: forward.filter(entry => entry.correct).length,
        forwardRatio: Number(ratio(forward).toFixed(4)),
        wrongRoot: sum(relation, entry => (entry.correct ? 0 : entry.wrongTargets.length)),
        wrongDirection: sum(relation, entry => (entry.correct || entry.wrongTargets.length > 0 ? 0 : 1)),
        cloudFallbacks: sum([...cases, ...negativeCases], entry => entry.fallbacks),
        payloadLimitFailures: sum([...cases, ...negativeCases], entry => entry.tooLarge),
        unauthorizedWrites: negativeCases.filter(entry => entry.kind === 'write' && entry.writeProtected !== true).length,
        aggregateCalls: sum([...cases, ...negativeCases], entry => entry.aggregateCalls),
        notDone: [...cases, ...negativeCases].filter(entry => !entry.done).length,
        errors: sum([...cases, ...negativeCases], entry => entry.errorCodes.length),
        boundedMaxBytes: Math.max(0, ...cases.flatMap(entry => entry.bounded.map(item => item.bytes))),
        aggregateMaxBytes: Math.max(0, ...cases.flatMap(entry => entry.aggregateBytes)),
        businessTablesChanged: fingerprintDiffResult.changedTables,
        auditDelta: fingerprintDiffResult.auditDelta,
        operationDelta: fingerprintDiffResult.operationDelta,
    };

    const required = profile.required;
    const failures = [];
    if (observed.reverseRatio < required.reverseCorrectRatio) failures.push(`reverse ${observed.reverseCorrect}/${observed.reverseTotal}`);
    if (observed.forwardRatio < required.forwardCorrectRatio) failures.push(`forward ${observed.forwardCorrect}/${observed.forwardTotal}`);
    if (observed.cloudFallbacks > required.cloudFallbacks) failures.push(`cloudFallbacks=${observed.cloudFallbacks}`);
    if (observed.payloadLimitFailures > required.payloadLimitFailures) failures.push(`payloadLimitFailures=${observed.payloadLimitFailures}`);
    if (observed.unauthorizedWrites > required.unauthorizedWrites) failures.push(`unauthorizedWrites=${observed.unauthorizedWrites}`);
    if (observed.aggregateCalls > required.aggregateCalls) failures.push(`aggregateCalls=${observed.aggregateCalls}`);
    if (observed.wrongRoot > required.wrongRoot) failures.push(`wrongRoot=${observed.wrongRoot}`);
    if (observed.wrongDirection > required.wrongDirection) failures.push(`wrongDirection=${observed.wrongDirection}`);
    if (observed.notDone > 0) failures.push(`notDone=${observed.notDone}`);
    if (observed.businessTablesChanged.length > 0) failures.push(`businessTablesChanged=${observed.businessTablesChanged.join(',')}`);

    return { status: failures.length === 0 ? 'PASS' : 'FAIL', failures, observed };
}

async function chat(base, secret, conversationId, message) {
    const response = await fetch(`${base}/api/ai/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ messages: [{ role: 'user', content: message }], conversationId }),
    });
    const events = parseSse(await response.text());
    const firstModelGate = events.findIndex(event => event.type === 'status' && event.status === 'generating');
    const calls = events.map((event, index) => ({ event, index }))
        .filter(item => item.event.type === 'tool_call')
        .map(item => ({
            name: item.event.name,
            beforeFirstModel: firstModelGate === -1 || item.index < firstModelGate,
        }));
    const results = events.filter(event => event.type === 'detail').flatMap(event => event.toolResults || []);
    const byName = name => results.filter(item => item.name === name);
    const bytesOf = value => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    return {
        httpStatus: response.status,
        done: events.some(event => event.type === 'done'),
        content: events.filter(event => event.type === 'content').map(event => event.content).join(''),
        providers: [...new Set(events.filter(event => event.type === 'provider').map(event => event.provider).filter(Boolean))],
        fallbacks: events.filter(event => event.type === 'provider' && event.fallback).length,
        errorCodes: events.filter(event => event.type === 'error').map(event => event.code),
        boundedBeforeFirstModel: calls.some(call => call.name === 'get_recipes_by_coil' && call.beforeFirstModel),
        boundedResults: byName('get_recipes_by_coil').map(item => ({
            complete: item.result?.complete ?? null,
            setCompleteness: item.result?.setCompleteness ?? null,
            pagesFetched: item.result?.pagesFetched ?? null,
            count: item.result?.count ?? null,
            totalCount: item.result?.totalCount ?? null,
            bytes: bytesOf(item.result?.data),
        })),
        aggregateCalls: byName('get_all_recipes').length,
        aggregateBytes: Math.max(0, ...byName('get_all_recipes').map(item => bytesOf(item.result?.data))),
        aggregateRefusedCodes: byName('get_all_recipes').filter(item => item.result?.success === false).map(item => item.result.code),
        tooLarge: results.filter(item => item.result?.code === 'AI_QUERY_RESULT_TOO_LARGE').length,
    };
}

async function preflightEndpoint(base, providerConfig) {
    const problems = [];
    try {
        const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(10000) });
        if (!health.ok) problems.push(`API ${base} answered HTTP ${health.status}`);
    } catch (error) {
        problems.push(`API ${base} unreachable (${error.cause?.code || error.name})`);
    }
    if (providerConfig?.baseUrl) {
        const url = `${String(providerConfig.baseUrl).replace(/\/$/, '')}/models`;
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
            if (!response.ok) problems.push(`provider endpoint ${url} answered HTTP ${response.status}`);
        } catch (error) {
            problems.push(`provider endpoint ${url} unreachable (${error.cause?.code || error.name})`);
        }
    }
    return problems;
}

function buildReport({ gateId, rounds, env, resolved, verdict, cases, negativeCases, fingerprintBefore, fingerprintAfter, diff }) {
    return {
        schemaVersion: 1,
        gate: gateId,
        gateLabel: gateProfile(gateId).label,
        runId: `relation-runtime-${gateId}-${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 17)}-${crypto.randomBytes(4).toString('hex')}`,
        generatedAt: new Date().toISOString(),
        rounds,
        productionCommit: require('../api/services/runtimeDiagnostics.cjs').runtimeDiagnostics().gitCommit,
        config: {
            aiProvider: resolved?.provider ?? null,
            model: resolved?.model ?? null,
            shortlist: require('../api/services/aiToolShortlist.cjs').shouldUseLocalToolShortlist(env),
            ontologyRelationRoutingCanary: require('../api/services/environment.cjs').isEnvFlagEnabled(env, 'AI_ONTOLOGY_RELATION_ROUTING_CANARY_ENABLED'),
            semanticShadow: require('../api/services/environment.cjs').isEnvFlagEnabled(env, 'AI_BUSINESS_SEMANTIC_SHADOW_ENABLED'),
            semanticEnforcement: require('../api/services/environment.cjs').isEnvFlagEnabled(env, 'AI_BUSINESS_SEMANTIC_ENFORCEMENT_CANARY_ENABLED'),
        },
        status: verdict.status,
        failures: verdict.failures,
        observed: verdict.observed,
        fingerprint: { before: fingerprintBefore, after: fingerprintAfter, diff },
        gates: { maxBoundedBytes: MAX_BOUNDED_BYTES, maxAggregateBytes: MAX_AGGREGATE_BYTES },
        cases,
        negativeCases,
    };
}

async function main() {
    const argv = process.argv.slice(2);
    const gateId = argOf(argv, 'gate', null);
    const rounds = Number(argOf(argv, 'rounds', '2'));
    const reportPath = argOf(argv, 'report', null);
    const base = argOf(argv, 'base', process.env.ACCEPTANCE_BASE_URL || 'http://127.0.0.1:3002');

    const profile = gateProfile(gateId);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 5) {
        throw abortError('ROUNDS_INVALID', `--rounds must be an integer within 1-5 (got ${argOf(argv, 'rounds', '2')})`);
    }

    const envPath = path.join(ROOT, '.env');
    const env = runtimeEnvFrom(fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '', process.env);
    const secret = String(env.INTERNAL_SECRET || '').trim();
    const { resolved } = assertGatePreconditions(gateId, env);
    console.log(`gate=${gateId} (${profile.label}) provider=${resolved?.provider} model=${resolved?.model} base=${base} rounds=${rounds}`);

    if (!argv.includes('--execute')) {
        console.log('PREFLIGHT_OK: preconditions hold, no model request sent. Re-run with --execute to run the gate.');
        return;
    }
    if (!secret) throw abortError('INTERNAL_SECRET_MISSING', 'INTERNAL_SECRET is required to drive POST /api/ai/chat');

    const endpointProblems = await preflightEndpoint(base, resolved);
    if (endpointProblems.length > 0) throw abortError('ENDPOINT_PREFLIGHT_FAILED', endpointProblems.join('; '));

    const Database = require('better-sqlite3');
    const dbPath = path.join(ROOT, 'pump.db');
    const db = new Database(dbPath, { readonly: true });
    const before = businessFingerprint(db);

    const cases = [];
    const negativeCases = [];
    try {
        for (let round = 1; round <= rounds; round += 1) {
            for (const entry of RELATION_CASES) {
                const truth = truthFor(db, entry);
                if (truth.note) {
                    cases.push({ caseId: entry.id, direction: entry.direction, question: entry.question, expected: [], truthNote: truth.note, correct: null });
                    console.log(`r${round} ${entry.id} SKIPPED truth=${truth.note}`);
                    continue;
                }
                const conversationId = `relation-${gateId}-r${round}-${crypto.randomUUID()}`;
                if (entry.seed) await chat(base, secret, conversationId, entry.seed);
                const response = await chat(base, secret, conversationId, entry.question);
                const summary = { round, ...summarizeCase(entry, truth, response) };
                cases.push(summary);
                console.log(`r${round} ${entry.id.padEnd(24)} ${entry.direction.padEnd(13)} done=${summary.done} providers=[${summary.providers}] fb=${summary.fallbacks} `
                    + `bounded=${summary.bounded.map(item => `${item.count}/${item.totalCount} ${item.setCompleteness} ${item.bytes}B`).join('|') || '-'} `
                    + `aggCalls=${summary.aggregateCalls} ${summary.correct ? 'correct' : 'WRONG'} err=${summary.errorCodes.length}`);
            }
            for (const entry of NEGATIVE_CASES) {
                const conversationId = `relation-${gateId}-r${round}-neg-${crypto.randomUUID()}`;
                const response = await chat(base, secret, conversationId, entry.question);
                const summary = { round, ...summarizeCase(entry, { expected: [], note: null }, response) };
                negativeCases.push(summary);
                console.log(`r${round} ${entry.id.padEnd(24)} ${entry.kind.padEnd(13)} done=${summary.done} providers=[${summary.providers}] fb=${summary.fallbacks} `
                    + `aggCalls=${summary.aggregateCalls} writeProtected=${summary.writeProtected} err=${summary.errorCodes.length}`);
            }
        }
    } finally {
        db.close();
    }

    const verifier = new Database(dbPath, { readonly: true });
    const after = businessFingerprint(verifier);
    verifier.close();
    const diff = fingerprintDiff(before, after);
    const verdict = evaluateVerdict({ profile, cases, negativeCases, fingerprintDiffResult: diff });
    const report = buildReport({ gateId, rounds, env, resolved, verdict, cases, negativeCases, fingerprintBefore: before, fingerprintAfter: after, diff });

    if (reportPath) {
        const target = path.isAbsolute(reportPath) ? reportPath : path.join(ROOT, reportPath);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
        console.log(`report -> ${target}`);
    }
    console.log(`${gateId}: status=${report.status} reverse=${verdict.observed.reverseCorrect}/${verdict.observed.reverseTotal} `
        + `forward=${verdict.observed.forwardCorrect}/${verdict.observed.forwardTotal} cloudFallbacks=${verdict.observed.cloudFallbacks} `
        + `aggregateCalls=${verdict.observed.aggregateCalls} payloadLimitFailures=${verdict.observed.payloadLimitFailures} `
        + `unauthorizedWrites=${verdict.observed.unauthorizedWrites} businessTablesChanged=[${diff.changedTables}] auditDelta=${diff.auditDelta} operationDelta=${diff.operationDelta}`);
    if (report.status !== 'PASS') {
        console.error(`GATE_FAILED ${gateId}: ${verdict.failures.join('; ')}`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    main().catch(error => {
        const code = error.code || 'GATE_ABORTED';
        console.error(`${code}: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    BUSINESS_TABLES,
    GATES,
    GATE_IDS,
    NEGATIVE_CASES,
    RELATION_CASES,
    VERDICT_STATUSES,
    assertGatePreconditions,
    businessFingerprint,
    classifyAnswer,
    evaluateVerdict,
    fingerprintDiff,
    gateProfile,
    runtimeEnvFrom,
};
