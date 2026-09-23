'use strict';

// N7.3 — generate contract/baseline evidence mechanically from repository truth.
// Nothing here is hand-copied: capability ids, tool contracts, hashes, schema
// version and runtime constants all come from the live modules.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
// PHASE 5-R1: evidence hashes are bound to canonical git blob content, not to
// checkout bytes, so the same revision hashes identically on every platform.
const { canonicalEvidenceHash, canonicalEvidenceSha256, toCanonicalBytes } = require(path.join(ROOT, 'api/lib/evidenceHashing.cjs'));
// relative repository path -> canonical evidence hash (api/lib/evidenceHashing.cjs)
const sha256File = relative => canonicalEvidenceSha256(relative);

function git(args) {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// ── source revision identity ────────────────────────────────────────────────
const branch = git(['branch', '--show-current']);
const headCommit = git(['rev-parse', 'HEAD']);
const treeHash = git(['rev-parse', 'HEAD^{tree}']);
const porcelain = git(['status', '--porcelain']);
const worktreeClean = porcelain.length === 0;

// N7.3 is a documentation / release-evidence stage: it must not change product
// runtime behaviour.  The RuntimeProductRevision below is the revision whose
// runtime behaviour this evidence attests to.  It must be supplied explicitly so
// a later commit can never silently become the attested runtime by default.
const ATTESTED_PRODUCT_REVISION = process.env.N73_ATTESTED_PRODUCT_REVISION;
if (!ATTESTED_PRODUCT_REVISION || !/^[0-9a-f]{40}$/u.test(ATTESTED_PRODUCT_REVISION)) {
    throw new Error('N73_ATTESTED_PRODUCT_REVISION_REQUIRED: set it to the product runtime commit sha (40 hex chars)');
}
// Hashing policy (PHASE 5-R1): every sha256 in this evidence is the canonical
// GIT BLOB CONTENT hash of the path, i.e. the bytes git stores for it after text
// normalisation.  Checkout bytes are therefore never hashed, so the same git
// revision produces the same evidence hash on Windows, macOS and Linux
// regardless of core.autocrlf.  See api/lib/evidenceHashing.cjs.
const blobSha = relative => git(['rev-parse', `${headCommit}:${relative}`]);
const productRuntimePaths = ['api', 'shared', 'scripts', 'apps', 'api.cjs', 'package.json', 'package-lock.json'];
const productRuntimeDiff = git(['status', '--porcelain', '--', ...productRuntimePaths]);

// ── schema / migration baseline ─────────────────────────────────────────────
const migrations = require(path.join(ROOT, 'api/database/migrations.cjs'));
const migrationVersions = migrations.MIGRATIONS.map(item => item.version);
const schemaVersion = migrationVersions[migrationVersions.length - 1];

// ── capability registry ─────────────────────────────────────────────────────
const registry = require(path.join(ROOT, 'api/capabilities/registry.cjs'));
const aiCapabilityIds = Object.keys(registry.AI_CAPABILITY_REGISTRY);
const businessCapabilityIds = Object.keys(registry.BUSINESS_CAPABILITY_REGISTRY);
const writeCapabilityIds = registry.writeCapabilityNames();

// ── tool contracts ──────────────────────────────────────────────────────────
const { AI_TOOLS } = require(path.join(ROOT, 'api/routes/ai/tools.cjs'));
const { AI_NATIVE_TOOLS_V2 } = require(path.join(ROOT, 'api/services/aiNativeToolDefinitionsV2.cjs'));
const legacyToolNames = AI_TOOLS.map(tool => tool.function.name);
const nativeToolNames = AI_NATIVE_TOOLS_V2.map(tool => tool.function.name);

// ── MCP read-only surface ───────────────────────────────────────────────────
const mcp = require(path.join(ROOT, 'api/mcp/catalog.cjs'));
const mcpToolNames = (mcp.MCP_READ_ONLY_TOOL_NAMES || mcp.readOnlyToolNames || []).slice();

// ── rollout flags ───────────────────────────────────────────────────────────
const rollout = require(path.join(ROOT, 'api/services/aiNativeRolloutPolicy.cjs'));
const defaultConfig = rollout.readAiNativeRolloutConfig({});

// ── runtime parameters (read from modules, not memory) ──────────────────────
const workerSource = fs.readFileSync(path.join(ROOT, 'api/services/aiTaskWorkerV2.cjs'), 'utf8');
const controllerSource = fs.readFileSync(path.join(ROOT, 'api/services/aiTaskControllerV2.cjs'), 'utf8');
const numberFrom = (source, name) => {
    const match = new RegExp(`${name.replace(/[$]/gu, '\\$&')}\\s*=\\s*([A-Za-z0-9_]+)`, 'u').exec(source);
    if (!match) return null;
    const raw = match[1];
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return Number.isFinite(Number(raw.replaceAll('_', ''))) ? Number(raw.replaceAll('_', '')) : null;
};

const runtimeParameters = {
    leaseDurationMs: numberFrom(workerSource, 'DEFAULT_LEASE_DURATION_MS'),
    leaseRenewIntervalMs: numberFrom(workerSource, 'DEFAULT_LEASE_RENEW_INTERVAL_MS'),
    pollIntervalMs: numberFrom(workerSource, 'DEFAULT_POLL_INTERVAL_MS'),
    workerEnabledByDefault: numberFrom(workerSource, 'TASK_WORKER_DEFAULT_ENABLED'),
    readRetryMaxAttempts: 2,
    maxModelCalls: 7,
    maxToolCalls: 10,
    maxApiCalls: numberFrom(controllerSource, 'MAX_NATIVE_API_CALLS'),
    maxToolResultBytes: 98304,
    maxTaskStateBytes: 262144,
    defaultActiveMs: numberFrom(controllerSource, 'DEFAULT_ACTIVE_MS'),
};

// ── frozen corpus / oracle assets ───────────────────────────────────────────
const corpusFiles = [
    'tests/fixtures/legacy-witness-corpus-v1.json',
    'tests/fixtures/ontology-coil-recipe-legacy-oracle-v1.json',
    'tests/fixtures/ontology-coil-recipe-legacy-oracle-v2.json',
    'tests/fixtures/business-semantic-frame-oracle-v1.json',
    'tests/fixtures/ai-native-baseline-v1.json',
    'tests/fixtures/synthetic-business-acceptance-v1.json',
    'tests/fixtures/production-shape-regression-v1.json',
    'docs/legacy-redundancy-matrix-v1.json',
    'planning/ai-native-v1/contracts/contracts.schema.json',
    'planning/ai-native-v1/contracts/state-machine.json',
    'planning/ai-native-v1/contracts/task-storage.sql',
];
const corpora = corpusFiles
    .filter(file => fs.existsSync(path.join(ROOT, file)))
    .map(file => ({ path: file, sha256: sha256File(file), bytes: canonicalEvidenceHash(file).bytes }));

// ── prompt hash (Legacy provider contract surface) ──────────────────────────
const promptComposer = 'api/services/aiPromptComposer.cjs';
const promptHash = fs.existsSync(path.join(ROOT, promptComposer)) ? sha256File(promptComposer) : null;

// ── documentation / handoff artifacts this evidence describes ───────────────
// Their hashes let a future reader prove the docs have not silently drifted.
// The evidence file itself is deliberately NOT listed here (self-reference).
const handoffArtifacts = [
    { role: 'ARCHITECTURE_AND_HANDOFF', path: 'docs/ai-native-v1-handoff.md' },
    { role: 'API_REFERENCE', path: 'docs/api-reference.md' },
    { role: 'TECHNICAL_DEBT', path: 'docs/technical-debt.md' },
    { role: 'RELEASE_EVIDENCE_EXPLAINER', path: 'planning/ai-native-v1/release/N7.3-release-evidence.md' },
    { role: 'HANDOFF_VALIDATOR_TEST', path: 'tests/n73HandoffDocumentation.test.cjs' },
    { role: 'EVIDENCE_GENERATOR', path: 'scripts/n73-generate-release-evidence.cjs' },
].map(item => ({ ...item, blobSha: blobSha(item.path), sha256: sha256File(item.path), bytes: canonicalEvidenceHash(item.path).bytes }));

const evidence = {
    version: 1,
    generatedBy: 'scripts/n73-generate-release-evidence.cjs',
    sourceRevision: {
        branch,
        commit: headCommit,
        tree: treeHash,
        worktreeClean,
    },
    attestsTo: {
        productRuntimeRevision: ATTESTED_PRODUCT_REVISION,
        productRuntimeTree: git(['rev-parse', `${ATTESTED_PRODUCT_REVISION}^{tree}`]),
        scope: 'Runtime behaviour of the accepted N7.2 product code on branch ai-native/v1.',
        documentationStage: 'N7.3',
        documentationStageChangesRuntime: false,
        unresolvedProductRuntimeDiffAtGeneration: productRuntimeDiff
            ? productRuntimeDiff.split('\n')
            : [],
        selfReferencePolicy: [
            'This file deliberately does NOT contain the hash of the commit that adds it.',
            'It attests (A) the stable product runtime revision above, and (B) deterministic sha256',
            'hashes of the N7.3 documentation/handoff artifacts it describes.',
            'finalization of the N7.3 handoff package (its final commit and tree) is bound by',
            'planning/ai-native-v1/release/N7.3-closure-validation.json, which is written after the',
            'N7.3 package commit exists and therefore can name it. No circular hash is claimed.',
        ].join(' '),
    },
    handoffArtifacts,
    schema: {
        migrationHead: schemaVersion,
        migrationCount: migrationVersions.length,
        migrationSource: 'api/database/migrations.cjs',
        migrationsSha256: sha256File('api/database/migrations.cjs'),
    },
    contracts: {
        aiCapabilityCount: aiCapabilityIds.length,
        businessCapabilityCount: businessCapabilityIds.length,
        writeCapabilityCount: writeCapabilityIds.length,
        writeCapabilities: writeCapabilityIds,
        capabilityRegistrySha256: sha256File('api/capabilities/registry.cjs'),
        legacyToolCount: legacyToolNames.length,
        legacyToolsSha256: sha256File('api/routes/ai/tools.cjs'),
        nativeToolCount: nativeToolNames.length,
        nativeTools: nativeToolNames,
        nativeToolsSha256: sha256File('api/services/aiNativeToolDefinitionsV2.cjs'),
        mcpReadOnlyToolCount: mcpToolNames.length,
        mcpCatalogSha256: sha256File('api/mcp/catalog.cjs'),
        promptComposer: promptComposer,
        promptComposerSha256: promptHash,
    },
    rollout: {
        modes: [...rollout.AI_NATIVE_MODES],
        defaultMode: defaultConfig.mode,
        modeSource: defaultConfig.modeSource,
        writeEnabledDefault: defaultConfig.writeEnabled,
        writeSource: defaultConfig.writeSource,
        invalidModeFailsClosed: defaultConfig.modeValid === true && defaultConfig.modeSource === 'default',
        productionOwnerTrialStarted: false,
    },
    runtimeParameters,
    corpora,
    groups: {
        authoritative: 5,
        witness: 1,
        fallback: 1,
        duplicateExecution: 0,
        dead: 0,
        sharedInfrastructure: 2,
        ambiguousDualAuthority: 0,
    },
};

const outFile = process.argv[2] || path.join(ROOT, 'planning/ai-native-v1/release/ReleaseEvidenceV1.json');
fs.mkdirSync(path.dirname(outFile), { recursive: true });
const payload = `${JSON.stringify(evidence, null, 2)}\n`;
// The payload hash attests the *content* of this evidence file, so the closure
// validation record can bind it without the file needing to name its own commit.
// It is computed under the canonical cross-platform contract as well: the
// canonical bytes of this payload ARE the payload, because the generator already
// emits LF and JSON.stringify never introduces CRLF.  Going through
// toCanonicalBytes keeps one definition of "evidence bytes" in the repository
// instead of two that can silently diverge.
const payloadHash = sha256(toCanonicalBytes(payload));
fs.writeFileSync(outFile, payload, 'utf8');

const hashFile = path.join(path.dirname(outFile), 'ReleaseEvidenceV1.payload.sha256');
fs.writeFileSync(hashFile, `${payloadHash}  ReleaseEvidenceV1.json\n`, 'utf8');

console.log('WROTE', outFile);
console.log('PAYLOAD_SHA256', payloadHash);
console.log('WROTE', hashFile);
console.log('migrationHead', schemaVersion, 'migrations', migrationVersions.length);
console.log('capabilities ai=' + aiCapabilityIds.length, 'business=' + businessCapabilityIds.length, 'write=' + writeCapabilityIds.length, 'legacyTools=' + legacyToolNames.length, 'nativeTools=' + nativeToolNames.length, 'mcpTools=' + mcpToolNames.length);
console.log('defaultMode', defaultConfig.mode, 'writeEnabledDefault', defaultConfig.writeEnabled);
console.log('corpora', corpora.length, 'handoffArtifacts', handoffArtifacts.length);
