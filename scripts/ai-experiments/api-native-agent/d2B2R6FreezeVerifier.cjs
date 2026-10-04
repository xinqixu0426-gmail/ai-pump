'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { buildApiIndex, apiIndexFingerprint } = require('../../../api/services/ai-assistant/apiIndex.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const PRODUCT_FREEZE_COMMIT = 'cdebfb5ef6f83a4c8b39e93f3f0dcc39077e2251';
const DEFAULT_MANIFEST = path.join(ROOT, 'planning/ai-native-api/M5-D2-B2-R6H4C01-Freeze-Manifest.json');
const HASHED_FILES = Object.freeze({
    candidateSource: 'scripts/ai-experiments/api-native-agent/apiNativeAgentCandidate.cjs',
    factLedger: 'api/services/ai-assistant/factLedger.cjs',
    answerValidator: 'api/services/ai-assistant/answerValidator.cjs',
    domainCorpus: 'scripts/ai-experiments/api-native-agent/d2B2DomainCorpus.cjs',
    ragHarness: 'scripts/ai-experiments/api-native-agent/d2B2RagAcceptanceHarness.cjs',
    ragFixtureAdapter: 'scripts/ai-experiments/api-native-agent/d2B2R6RagFixtureAdapter.cjs',
    answerRelevanceScorer: 'scripts/ai-experiments/api-native-agent/d2B2R6AcceptanceScoring.cjs',
    assembler: 'scripts/ai-experiments/api-native-agent/d2B2R6AcceptanceAssembler.cjs',
    freshRunners: 'scripts/ai-experiments/api-native-agent/d2B2R6FreshRunners.cjs',
    freezeVerifier: 'scripts/ai-experiments/api-native-agent/d2B2R6FreezeVerifier.cjs',
});
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex'); }
function actualHashes() { return Object.fromEntries(Object.entries(HASHED_FILES).map(([key, file]) => [key, sha(file)])); }
function freezeManifestData(harnessFreezeCommit) { return Object.freeze({ productFreezeCommit: PRODUCT_FREEZE_COMMIT, harnessFreezeCommit, apiIndexFingerprint: apiIndexFingerprint(buildApiIndex()), hashes: actualHashes() }); }
function verifyR6AcceptanceFreeze(options = {}) {
    const manifestPath = options.manifestPath || DEFAULT_MANIFEST;
    if (!fs.existsSync(manifestPath)) throw new Error('R6_ACCEPTANCE_FREEZE_INTEGRITY_FAILED');
    let manifest; try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { throw new Error('R6_ACCEPTANCE_FREEZE_INTEGRITY_FAILED'); }
    const current = freezeManifestData(manifest.harnessFreezeCommit);
    const valid = manifest.productFreezeCommit === PRODUCT_FREEZE_COMMIT
        && typeof manifest.harnessFreezeCommit === 'string' && manifest.harnessFreezeCommit.length > 0
        && manifest.apiIndexFingerprint === current.apiIndexFingerprint
        && Object.entries(current.hashes).every(([key, value]) => manifest.hashes?.[key] === value);
    if (!valid) throw new Error('R6_ACCEPTANCE_FREEZE_INTEGRITY_FAILED');
    return Object.freeze({ productFreezeCommit: manifest.productFreezeCommit, harnessFreezeCommit: manifest.harnessFreezeCommit, apiIndexFingerprint: manifest.apiIndexFingerprint, manifestPath });
}
module.exports = { DEFAULT_MANIFEST, HASHED_FILES, PRODUCT_FREEZE_COMMIT, actualHashes, freezeManifestData, verifyR6AcceptanceFreeze };
