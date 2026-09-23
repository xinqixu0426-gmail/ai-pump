'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { REQUIRED_PATHS, loadFrozenHistoryManifest, validateManifest } = require('./helpers/frozenHistoryManifest.cjs');

const manifestPath = path.join(__dirname, 'fixtures', 'frozen-history', 'manifest-v1.json');

test('frozen history manifest is self-contained and has every protected artifact', () => {
    const manifest = loadFrozenHistoryManifest(manifestPath);
    assert.deepEqual(manifest.artifacts.map(item => item.path), REQUIRED_PATHS);
});

test('frozen history manifest rejects zero artifacts, missing artifacts, corrupt hashes, and damaged lists', () => {
    const valid = loadFrozenHistoryManifest(manifestPath);
    assert.throws(() => validateManifest({ ...valid, artifacts: [] }), /EMPTY/);
    assert.throws(() => validateManifest({ ...valid, artifacts: valid.artifacts.slice(1) }), /ARTIFACT_COUNT/);
    assert.throws(() => validateManifest({ ...valid, artifacts: valid.artifacts.map((item, index) => index ? item : { ...item, sha256: 'bad' }) }), /HASH/);
    assert.throws(() => validateManifest({ ...valid, toolNames: [] }), /TOOLNAMES/);
});
