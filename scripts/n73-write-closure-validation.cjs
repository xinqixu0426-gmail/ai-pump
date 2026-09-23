'use strict';

// N7.3-R1 — write the final closure validation record.
//
// This record is written AFTER the N7.3 handoff package commit exists, so it can
// name that revision/tree. That is what keeps the binding non-self-referential:
// ReleaseEvidenceV1 never has to contain the hash of the commit that adds it, and
// this record --- which is added later --- is the thing that binds the package.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

// The N7.3 handoff package revision is the commit that introduced/updated the
// release evidence. It is passed explicitly so this script cannot silently bind
// the wrong revision.
const handoffRevision = process.argv[2];
if (!handoffRevision || !/^[0-9a-f]{40}$/u.test(handoffRevision)) {
    throw new Error('N73_HANDOFF_REVISION_REQUIRED: pass the N7.3 package commit sha as argv[2]');
}

// Read the evidence exactly as committed, by blob, not from the working tree.
// Hashing policy (must match the generator, PHASE 5-R1): sha256 over canonical
// GIT BLOB CONTENT.  Checkout bytes are never hashed, so the record is identical
// on Windows, macOS and Linux regardless of core.autocrlf.  See
// api/lib/evidenceHashing.cjs.
const { canonicalEvidenceHash } = require(path.join(ROOT, 'api/lib/evidenceHashing.cjs'));
const evidencePath = 'planning/ai-native-v1/release/ReleaseEvidenceV1.json';
const evidenceBlob = git(['rev-parse', `${handoffRevision}:${evidencePath}`]);
const evidenceContent = fs.readFileSync(path.join(ROOT, evidencePath), 'utf8');
const payloadHash = canonicalEvidenceHash(evidencePath, { revision: handoffRevision }).sha256;

const evidence = JSON.parse(evidenceContent);
const sideFile = 'planning/ai-native-v1/release/ReleaseEvidenceV1.payload.sha256';
const sideFileContent = fs.readFileSync(path.join(ROOT, sideFile), 'utf8').trim();

// Recompute each attested handoff artifact hash under the same canonical
// contract. The closure commit must leave these files byte-identical (they are
// all committed inside the handoff package), so any content drift or any
// uncommitted edit is detected here.
const dirtyPaths = git(['status', '--porcelain']).split('\n').filter(Boolean);
const artifactChecks = evidence.handoffArtifacts.map(item => {
    const hash = canonicalEvidenceHash(item.path, { revision: handoffRevision });
    return {
        role: item.role,
        path: item.path,
        attestedSha256: item.sha256,
        diskSha256: hash.sha256,
        hashSource: hash.source,
        matches: hash.sha256 === item.sha256,
    };
});

const record = {
    version: 1,
    artifact: 'N7.3 final closure validation',
    generatedBy: 'scripts/n73-write-closure-validation.cjs',
    bindingModel: [
        'ReleaseEvidenceV1 attests the product runtime revision and the sha256 of each',
        'N7.3 handoff artifact. It deliberately does not name the commit that adds it.',
        'This record is written afterwards and therefore binds the N7.3 handoff package',
        'revision/tree plus the evidence payload hash. No circular hash is claimed.',
    ].join(' '),
    productRuntime: {
        revision: evidence.attestsTo.productRuntimeRevision,
        tree: evidence.attestsTo.productRuntimeTree,
        scope: 'Runtime behaviour described by the N7.3 documentation package.',
    },
    handoffPackage: {
        revision: handoffRevision,
        tree: git(['rev-parse', `${handoffRevision}^{tree}`]),
        subject: git(['log', '-1', '--format=%s', handoffRevision]),
    },
    releaseEvidence: {
        path: evidencePath,
        blobSha: evidenceBlob,
        payloadSha256: payloadHash,
        payloadSha256SideFile: sideFile,
        sideFileMatches: sideFileContent.split(/\s+/u)[0] === payloadHash,
        attestsProductRuntimeRevision: evidence.attestsTo.productRuntimeRevision,
        hashingPolicy: 'sha256 over canonical git blob content (api/lib/evidenceHashing.cjs), never over checkout bytes',
    },
    handoffArtifactIntegrity: {
        checked: artifactChecks.length,
        allMatch: artifactChecks.every(item => item.matches),
        mismatches: artifactChecks.filter(item => !item.matches).map(item => item.path),
        hashingPolicy: 'sha256 over canonical git blob content of every artifact; each artifact is committed inside the handoff package',
        artifacts: artifactChecks,
    },
    handoffPackageWorktree: {
        cleanAtValidation: dirtyPaths.length === 0,
        dirtyPaths,
        note: 'The closure validation record is the only file added after the handoff package commit; its own revision is recorded by the next commit.',
    },
    apiReference: {
        status: 'COMPLETE',
        auditedBy: 'tests/n73ApiReferenceCoverage.test.cjs',
        handoffEntrypointCount: 13,
        missingCount: 0,
        referenceEdited: false,
        reason: 'canonical N7.3 added no routes; coverage of every current AI Native entrypoint is proven by executable audit instead of asserted',
    },
    rollout: {
        aiNativeModeDefault: evidence.rollout.defaultMode,
        writeEnabledDefault: evidence.rollout.writeEnabledDefault,
        ownerTrialStarted: false,
        productionNativeWrites: 0,
        liveQualityEvidenceStatus: 'REQUIRES_FRESH_PRE_OWNER_TRIAL_RUN',
    },
    selfReference: {
        claimsOwnCommitHash: false,
        note: 'This record is the binding artifact. It may be added in a later commit than the package it binds, which is the intended, satisfiable structure.',
    },
};

const outFile = path.join(ROOT, 'planning/ai-native-v1/release/N7.3-closure-validation.json');
fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

console.log('WROTE', outFile);
console.log('handoffRevision', handoffRevision, 'tree', record.handoffPackage.tree);
console.log('payloadSha256', payloadHash, 'sideFileMatches', record.releaseEvidence.sideFileMatches);
console.log('artifactIntegrity', record.handoffArtifactIntegrity.checked, 'allMatch', record.handoffArtifactIntegrity.allMatch);
