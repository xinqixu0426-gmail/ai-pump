'use strict';

// N7.3 handoff-doc validator: every path/claim the handoff document asserts must
// resolve in the repository. Catches documentation drift and invented routes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HANDOFF = 'docs/ai-native-v1-handoff.md';
const handoff = fs.readFileSync(path.join(ROOT, HANDOFF), 'utf8');

function exists(relative) {
    return fs.existsSync(path.join(ROOT, relative));
}

test('N7.3 handoff doc names only files that exist', () => {
    // Validate only fully-qualified repository-relative paths (contain a slash).
    // Bare filenames quoted as prose (e.g. a planning sibling document) are not
    // path assertions and must not be treated as such.
    const candidates = [...handoff.matchAll(/`((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:cjs|tsx|ts|json|md|sql))`/gu)]
        .map(match => match[1]);
    const missing = [...new Set(candidates)].filter(item => !exists(item));
    assert.deepEqual(missing, [], `handoff references non-existent paths: ${missing.join(', ')}`);
    // Sanity: the qualified-path scan must actually be finding things.
    assert.ok(candidates.length >= 25, `expected many qualified paths, found ${candidates.length}`);
    // Negative control: the same check must reject a path that does not exist,
    // proving these assertions discriminate rather than trivially passing.
    assert.equal(exists('api/services/definitelyNotARealModule.cjs'), false);
    assert.equal(exists('api/services/aiTaskControllerV2.cjs'), true);
});

test('N7.3 handoff doc documents the real HTTP entrypoints', () => {
    const chat = fs.readFileSync(path.join(ROOT, 'api/routes/ai/chat.cjs'), 'utf8');
    const tasks = fs.readFileSync(path.join(ROOT, 'api/routes/ai/tasks.cjs'), 'utf8');
    for (const route of [
        "router.post('/api/ai/chat'",
        "router.post('/api/ai/confirm-tool/preview'",
        "router.post('/api/ai/confirm-tool'",
    ]) assert.ok(chat.includes(route), `chat.cjs missing ${route}`);
    for (const route of [
        "router.post('/api/ai/tasks'",
        "router.get('/api/ai/tasks/:taskId'",
        "router.get('/api/ai/tasks/:taskId/events'",
        "router.post('/api/ai/tasks/:taskId/resume'",
        "router.post('/api/ai/tasks/:taskId/cancel'",
        "router.post('/api/ai/tasks/:taskId/write-preview'",
        "router.post('/api/ai/tasks/:taskId/write-execute'",
        "router.post('/api/ai/tasks/:taskId/write-reconcile'",
    ]) assert.ok(tasks.includes(route), `tasks.cjs missing ${route}`);

    // And every documented path must appear in the doc itself.
    for (const documented of [
        'POST /api/ai/chat',
        'POST /api/ai/tasks',
        'GET /api/ai/tasks/:taskId',
        'GET /api/ai/tasks/:taskId/events',
        'POST /api/ai/tasks/:taskId/resume',
        'POST /api/ai/tasks/:taskId/cancel',
        'POST /api/ai/tasks/:taskId/write-preview',
        'POST /api/ai/tasks/:taskId/write-execute',
        'POST /api/ai/tasks/:taskId/write-reconcile',
    ]) assert.ok(handoff.includes(documented), `handoff does not document ${documented}`);
});

test('N7.3 handoff doc states the real flag defaults and fails-closed behaviour', () => {
    const { readAiNativeRolloutConfig, AI_NATIVE_MODES } = require('../api/services/aiNativeRolloutPolicy.cjs');
    const defaults = readAiNativeRolloutConfig({});
    assert.equal(defaults.mode, 'off');
    assert.equal(defaults.writeEnabled, false);
    assert.deepEqual([...AI_NATIVE_MODES], ['off', 'shadow', 'owner']);
    for (const claim of ['`off`', '`shadow`', '`owner`', '`AI_NATIVE_WRITE_ENABLED`', 'fail closed']) {
        assert.ok(handoff.includes(claim), `handoff missing ${claim}`);
    }
    // Invalid mode must still be documented as falling back to off.
    const invalid = readAiNativeRolloutConfig({ AI_NATIVE_MODE: 'ownerish' });
    assert.equal(invalid.mode, 'off');
    assert.equal(invalid.modeValid, false);
});

test('N7.3 handoff doc does not claim Native is live or writes are enabled', () => {
    // Scan only declarative lines (table rows and bullet items), so that the
    // document may legitimately quote a wrong claim in order to forbid it.
    const declarative = handoff.split('\n').filter(line => /^\s*[|\-*]\s/u.test(line)).join('\n');
    for (const forbidden of [
        'OWNER_TRIAL_ACTUALLY_STARTED = YES',
        'PRODUCTION_NATIVE_WRITE_ENABLED = YES',
        '已全量上线',
        '生产默认 `owner`',
    ]) assert.equal(declarative.includes(forbidden), false, `handoff states a forbidden overstatement: ${forbidden}`);

    // Required truthful statements.
    assert.ok(handoff.includes('OWNER_TRIAL_ACTUALLY_STARTED = NO'));
    assert.ok(handoff.includes('READY_FOR_OWNER_TRIAL = YES'));
    assert.ok(handoff.includes('冗余职责已退出'));
    // The doc must explicitly forbid describing Legacy as fully deleted.
    assert.ok(handoff.includes('Legacy 已删除') || handoff.includes('Legacy 全量删除'));
});

test('N7.3 handoff doc documents the real canonical deep-api mechanism and count source', () => {
    const runner = fs.readFileSync(path.join(ROOT, 'scripts/run-deep-api-smoke.cjs'), 'utf8');
    assert.ok(runner.includes('CANONICAL_DETERMINISTIC'), 'runner must expose CANONICAL_DETERMINISTIC');
    assert.ok(runner.includes('EXTENDED_SOURCE_DB'), 'runner must expose EXTENDED_SOURCE_DB');
    assert.ok(runner.includes('localPumpDbUsed'), 'runner must report localPumpDbUsed');
    assert.ok(handoff.includes('localPumpDbUsed'));
    assert.ok(handoff.includes('CANONICAL RELEASE GATE'));
    assert.ok(handoff.includes('EXTENDED DATA-SHAPE COVERAGE'));
    // The doc must warn against treating the extended count as invariant.
    assert.ok(handoff.includes('不要把 493 当作不变量') || handoff.includes('不要把 `493` 当成'));
});

test('N7.3 handoff doc documents runtime parameters that match the code', () => {
    const worker = fs.readFileSync(path.join(ROOT, 'api/services/aiTaskWorkerV2.cjs'), 'utf8');
    assert.ok(worker.includes('DEFAULT_LEASE_DURATION_MS = 30_000'));
    assert.ok(worker.includes('DEFAULT_LEASE_RENEW_INTERVAL_MS = 10_000'));
    assert.ok(worker.includes('DEFAULT_POLL_INTERVAL_MS = 1_000'));
    assert.ok(worker.includes('TASK_WORKER_DEFAULT_ENABLED = false'));
    const controller = fs.readFileSync(path.join(ROOT, 'api/services/aiTaskControllerV2.cjs'), 'utf8');
    assert.ok(controller.includes('MAX_NATIVE_API_CALLS = 32'));
    assert.ok(controller.includes('DEFAULT_ACTIVE_MS = 60_000'));
    const debt = fs.readFileSync(path.join(ROOT, 'docs/technical-debt.md'), 'utf8');
    assert.ok(debt.includes('AI Native V1'));
});

test('N7.3 handoff doc answers the handoff self-test without source archaeology', () => {
    // Each handoff question must be answerable from the doc: check the doc
    // contains the answer anchor for every row of its own self-test table.
    const anchors = [
        'POST /api/ai/chat',
        'aiTaskControllerV2.cjs',
        'npm run test:deep-api',
        'verify:ai-native-release',
        'DEEPSEEK_API_KEY',
        '`off`',
        'AI_NATIVE_MODE=off',
        '不需要',
        'ReleaseEvidenceV1.json',
        '生产 Owner Trial 前置验收',
    ];
    for (const anchor of anchors) assert.ok(handoff.includes(anchor), `handoff missing self-test anchor: ${anchor}`);
});

test('N7.3 release evidence exists and is bound to a verifiable revision', () => {
    const file = path.join(ROOT, 'planning/ai-native-v1/release/ReleaseEvidenceV1.json');
    assert.ok(fs.existsSync(file), 'ReleaseEvidenceV1.json must exist');
    const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.match(evidence.attestsTo.productRuntimeRevision, /^[0-9a-f]{40}$/u);
    assert.match(evidence.attestsTo.productRuntimeTree, /^[0-9a-f]{40}$/u);
    assert.equal(evidence.rollout.defaultMode, 'off');
    assert.equal(evidence.rollout.writeEnabledDefault, false);
    assert.equal(evidence.rollout.productionOwnerTrialStarted, false);
    assert.equal(evidence.schema.migrationHead, 88);
    assert.equal(evidence.contracts.nativeToolCount, 3);
    assert.equal(evidence.runtimeParameters.workerEnabledByDefault, false);
    assert.equal(evidence.runtimeParameters.leaseDurationMs, 30000);
    // No secrets may appear in the evidence. Use a token boundary so that
    // ordinary identifiers (e.g. task-storage.sql) are not false positives.
    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(/(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9]{16,}/u.test(raw), false, 'evidence must not contain API keys');
    assert.equal(raw.includes('DEEPSEEK_API_KEY='), false);
});
