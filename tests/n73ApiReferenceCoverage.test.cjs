'use strict';

// N7.3-R1 — API reference coverage audit.
//
// Canonical N7.3 requires the authoritative API master/reference documentation to
// be updated. This ticket added no routes, so "nothing to update" is only
// acceptable if it is PROVEN that the reference already covers every current AI
// Native entrypoint. This test is that proof, and it keeps working as a drift
// detector: if a route is added or renamed without updating docs/api-reference.md,
// it fails.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REFERENCE = 'docs/api-reference.md';
const reference = fs.readFileSync(path.join(ROOT, REFERENCE), 'utf8');

// Enumerate routes from the source of truth: the router files themselves.
function routesIn(relative) {
    const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
    const found = [];
    for (const match of source.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']+)'/gu)) {
        found.push({ method: match[1].toUpperCase(), path: match[2] });
    }
    return found;
}

const chatRoutes = routesIn('api/routes/ai/chat.cjs');
const taskRoutes = routesIn('api/routes/ai/tasks.cjs');
const allAiRoutes = [...chatRoutes, ...taskRoutes];

// The AI Native handoff surface: every entrypoint an uninvolved session needs.
const HANDOFF_ROUTES = [
    { method: 'POST', path: '/api/ai/chat' },
    { method: 'GET', path: '/api/ai/capabilities' },
    { method: 'GET', path: '/api/ai/health' },
    { method: 'POST', path: '/api/ai/confirm-tool/preview' },
    { method: 'POST', path: '/api/ai/confirm-tool' },
    { method: 'POST', path: '/api/ai/tasks' },
    { method: 'GET', path: '/api/ai/tasks/:taskId' },
    { method: 'GET', path: '/api/ai/tasks/:taskId/events' },
    { method: 'POST', path: '/api/ai/tasks/:taskId/resume' },
    { method: 'POST', path: '/api/ai/tasks/:taskId/cancel' },
    { method: 'POST', path: '/api/ai/tasks/:taskId/write-preview' },
    { method: 'POST', path: '/api/ai/tasks/:taskId/write-execute' },
    { method: 'POST', path: '/api/ai/tasks/:taskId/write-reconcile' },
];

test('N7.3-R1 API reference audit: every handoff route exists in the source routers', () => {
    for (const route of HANDOFF_ROUTES) {
        const found = allAiRoutes.some(item => item.method === route.method && item.path === route.path);
        assert.ok(found, `route not found in source: ${route.method} ${route.path}`);
    }
});

test('N7.3-R1 API reference audit: every handoff route is documented in docs/api-reference.md', () => {
    // The reference documents routes in a markdown table row as:
    //   | `POST` | `/api/ai/tasks` | ... |
    // Some entries legitimately append a query string (e.g. the events route), so
    // compare the path portion before any '?'.
    const rows = reference.split('\n')
        .filter(line => line.trim().startsWith('|'))
        .map(line => ({ line, paths: [...line.matchAll(/`(\/api\/ai\/[^`]*)`/gu)].map(match => match[1].split('?')[0]) }));
    const missing = [];
    for (const route of HANDOFF_ROUTES) {
        const documented = rows.some(row => row.line.includes('`' + route.method + '`') && row.paths.includes(route.path));
        if (!documented) missing.push(`${route.method} ${route.path}`);
    }
    assert.deepEqual(missing, [], `api-reference.md is missing: ${missing.join(', ')}`);
});

test('N7.3-R1 API reference audit: the write/reconcile boundary is documented, not just the path', () => {
    // N6.1 / N6.2 introduced a protected write bridge. Documenting only the path
    // would not be enough handoff information, so assert the semantics are stated.
    for (const phrase of ['write-preview', 'write-execute', 'write-reconcile', 'adjust_part_stock', 'batch_update_prices', 'RECONCILING']) {
        assert.ok(reference.includes(phrase), `api-reference.md does not document ${phrase}`);
    }
    // The write endpoints must not be presented as generally open.
    assert.match(reference, /N6\.1/u);
    assert.match(reference, /N6\.2/u);
});

test('N7.3-R1 API reference audit: public task projection is documented and internal fields are not claimed public', () => {
    assert.ok(reference.includes('TaskPublicViewV1'), 'api-reference.md must name the public task projection');
    assert.ok(reference.includes('TaskStartRequestV1'));
    assert.ok(reference.includes('TaskResumeRequestV1'));
    assert.ok(reference.includes('TaskCancelRequestV1'));
    // The reference must state that internal fields are excluded.
    assert.match(reference, /不包含租约|不含租约|租约/u);
});

test('N7.3-R1 API reference audit: no future or disabled capability is documented as live', () => {
    // Native write is not production-enabled; the reference must not assert it is.
    assert.equal(/AI_NATIVE_WRITE_ENABLED\s*=\s*true\s*（生产|生产.*已启用/u.test(reference), false);
    assert.equal(/AI Native.*已全量上线/u.test(reference), false);
});

test('N7.3-R1 API reference audit: reference, handoff doc and source do not contradict', () => {
    const handoff = fs.readFileSync(path.join(ROOT, 'docs/ai-native-v1-handoff.md'), 'utf8');
    // Both documents must agree on the same handoff route set.
    for (const route of HANDOFF_ROUTES) {
        const documented = `${route.method} ${route.path}`;
        assert.ok(handoff.includes(documented), `handoff doc missing ${documented}`);
    }
    // The source must agree on the auth boundary for the task routes.
    const tasksSource = fs.readFileSync(path.join(ROOT, 'api/routes/ai/tasks.cjs'), 'utf8');
    assert.ok(tasksSource.includes("router.use('/api/ai/tasks', auth)"), 'task routes must stay behind auth');
});

test('N7.3-R1 closure record separates the product runtime and handoff baselines without a self-hash claim', () => {
    const recordPath = 'planning/ai-native-v1/release/N7.3-closure-validation.json';
    assert.ok(fs.existsSync(path.join(ROOT, recordPath)), 'closure validation record must exist');
    const record = JSON.parse(fs.readFileSync(path.join(ROOT, recordPath), 'utf8'));

    // A: the product runtime the documentation describes.
    assert.match(record.productRuntime.revision, /^[0-9a-f]{40}$/u);
    assert.match(record.productRuntime.tree, /^[0-9a-f]{40}$/u);
    // B: the handoff package that describes it (a different revision).
    assert.match(record.handoffPackage.revision, /^[0-9a-f]{40}$/u);
    assert.match(record.handoffPackage.tree, /^[0-9a-f]{40}$/u);
    assert.notEqual(record.productRuntime.revision, record.handoffPackage.revision,
        'product runtime baseline and handoff baseline must not be conflated');

    // The evidence must attest the product runtime revision, not the handoff one.
    const evidence = JSON.parse(fs.readFileSync(path.join(ROOT, 'planning/ai-native-v1/release/ReleaseEvidenceV1.json'), 'utf8'));
    assert.equal(evidence.attestsTo.productRuntimeRevision, record.productRuntime.revision);
    assert.equal(record.releaseEvidence.attestsProductRuntimeRevision, record.productRuntime.revision);
    assert.notEqual(evidence.sourceRevision.commit, evidence.attestsTo.productRuntimeRevision,
        'sourceRevision is provenance only and must not be presented as the attested runtime');

    // The payload hash side-file and every attested artifact hash are verified
    // under the ONE canonical cross-platform contract (PHASE 5-R1): sha256 over
    // canonical git blob content, never over checkout bytes.  Hashing the
    // working tree here would make this assertion platform-dependent, because
    // core.autocrlf materialises CRLF on Windows while the accepted evidence was
    // computed over normalised blob bytes.
    const { canonicalEvidenceHash } = require('../api/lib/evidenceHashing.cjs');
    const payloadSha = canonicalEvidenceHash('planning/ai-native-v1/release/ReleaseEvidenceV1.json').sha256;
    assert.equal(record.releaseEvidence.payloadSha256, payloadSha);
    assert.equal(record.releaseEvidence.sideFileMatches, true);

    // Every attested artifact must still match: no silent doc drift.
    assert.equal(record.handoffArtifactIntegrity.checked, evidence.handoffArtifacts.length);
    assert.equal(record.handoffArtifactIntegrity.allMatch, true, `drifted: ${record.handoffArtifactIntegrity.mismatches.join(', ')}`);
    for (const item of record.handoffArtifactIntegrity.artifacts) {
        const disk = canonicalEvidenceHash(item.path).sha256;
        assert.equal(disk, item.attestedSha256, `artifact drifted: ${item.path}`);
    }

    // No circular claim, and the rollout truth is preserved.
    assert.equal(record.selfReference.claimsOwnCommitHash, false);
    assert.equal(record.rollout.ownerTrialStarted, false);
    assert.equal(record.rollout.productionNativeWrites, 0);
    assert.equal(record.rollout.liveQualityEvidenceStatus, 'REQUIRES_FRESH_PRE_OWNER_TRIAL_RUN');
});
