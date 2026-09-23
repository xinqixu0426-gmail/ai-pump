'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.join(__dirname, 'fixtures', 'ai-native-baseline-v1.json');

function loadFixture(filePath = fixturePath) {
    if (!fs.existsSync(filePath)) throw new Error(`AI Native baseline fixture missing: ${filePath}`);
    const definition = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    validateDefinition(definition);
    return definition;
}

function validateDefinition(definition) {
    if (!Array.isArray(definition.cases) || definition.cases.length === 0) throw new Error('AI Native baseline fixture must contain at least one case');
}

test('AI Native V1 future corpus is distinct, non-empty, and does not mutate frozen assets', () => {
    const definition = loadFixture();
    assert.equal(definition.version, 'AiNativeBaselineV1');
    assert.equal(definition.frozenLegacyAssetsModified, false);
    assert.equal(definition.cases.length, 24);
    assert.deepEqual(definition.cases.map(item => item.caseId), Array.from({ length: 24 }, (_, index) => `NV-${String(index + 1).padStart(2, '0')}`));
});

test('AI Native V1 future corpus declares goal, fact, and safety obligations for every case', () => {
    for (const item of loadFixture().cases) {
        assert.ok(item.title && item.question);
        assert.ok(item.userGoalTypes.length > 0, item.caseId);
        assert.ok(item.domains.length > 0, item.caseId);
        assert.ok(item.expectedFacts.length > 0, item.caseId);
        assert.ok(item.expectedSafety.length > 0, item.caseId);
    }
});

test('AI Native V1 fixture loader rejects missing and zero-case definitions', () => {
    assert.throws(() => loadFixture(path.join(__dirname, 'fixtures', 'does-not-exist.json')), /fixture missing/);
    assert.throws(() => validateDefinition({ cases: [] }), /at least one case/);
});
