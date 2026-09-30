'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'planning/ai-assistant-mvp-v1/M3-0/Baseline-V1-cases.json'), 'utf8'));

test('M3 Baseline V1 remains the immutable 24-case before manifest', () => {
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.baselineCommit, 'd3308883abde014c59a7b47b19adcf9bfd6ef09c');
    assert.equal(manifest.cases.length, 24);
    const byType = Object.groupBy(manifest.cases, item => item.type);
    assert.equal(byType.REAL_MODEL.length, 9);
    assert.equal(byType.DETERMINISTIC.length, 8);
    assert.equal(byType.STATIC_AUDIT.length, 7);
    assert.equal(new Set(manifest.cases.map(item => item.id)).size, 24);
});
