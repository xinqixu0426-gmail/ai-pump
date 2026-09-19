'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBusinessUnderstandingFixture, runFixtureSelfChecks } = require('./helpers/businessUnderstandingFixture.cjs');
const { buildBusinessUnderstandingOracle, definitionHashes, readDefinition } = require('./helpers/businessUnderstandingOracle.cjs');
const { evaluateBusinessUnderstandingCase, perfectActual } = require('./helpers/businessUnderstandingEvaluator.cjs');

const root = path.resolve(__dirname, '..');
const definitionPath = path.join(root, 'tests/fixtures/business-understanding-benchmark-v1.json');
const fixturePath = path.join(root, 'tests/helpers/businessUnderstandingFixture.cjs');
const oraclePath = path.join(root, 'tests/helpers/businessUnderstandingOracle.cjs');
const definition = readDefinition(definitionPath);

test('BusinessUnderstandingCaseV1 固定 10 个 Core、6 个维度且不绑定生产 ID', () => {
    assert.equal(definition.version, 'BusinessUnderstandingBenchmarkV1');
    assert.equal(definition.caseContractVersion, 1);
    assert.equal(definition.coreCases.length, 10);
    assert.equal(definition.dimensions.length, 6);
    assert.deepEqual(definition.coreCases.map(item => item.caseKey), Array.from({ length: 10 }, (_, index) => `BU-${String(index + 1).padStart(2, '0')}`));
    for (const item of definition.coreCases) {
        assert.match(item.expected.subjectFixtureRef, /^[a-zA-Z][\w.-]+$/);
        assert.equal(/(?:recipe|coil|part)Id\s*[:=]\s*\d+/i.test(JSON.stringify(item)), false);
        assert.equal(item.safety.mustNotWrite, true);
        assert.equal(item.stability.requiredRuns, 2);
    }
});

test('Semantic Fixture 使用当前迁移并通过 Case 前置自检', t => {
    const fixture = createBusinessUnderstandingFixture();
    t.after(() => fixture.close());
    const selfCheck = runFixtureSelfChecks(fixture);
    assert.equal(selfCheck.passed, true, JSON.stringify(selfCheck, null, 2));
    assert.ok(fixture.db.pragma('user_version', { simple: true }) >= 86);
    assert.equal(fixture.db.pragma('foreign_key_check').length, 0);
});

test('Oracle 由 fixture 与正式成本函数生成，不包含模型答案', t => {
    const fixture = createBusinessUnderstandingFixture();
    t.after(() => fixture.close());
    const oracle = buildBusinessUnderstandingOracle(fixture, definition);
    assert.ok(oracle.perCase['BU-01'].formalFacts.currentRecipeCost > 0);
    assert.equal(oracle.perCase['BU-01'].formalFacts.currentRecipeCost, 201);
    assert.equal(oracle.perCase['BU-02'].formalFacts.variants12_220.length, 2);
    assert.deepEqual(oracle.perCase['BU-02'].formalFacts.variants12_220.map(item => item.cost), [102, 111]);
    assert.equal(oracle.perCase['BU-08'].formalFacts.variants12_200.length, 2);
    assert.equal(JSON.stringify(oracle).includes('answerText'), false);
});

test('Evaluator 的正确结构化输出全部 PASS', t => {
    const fixture = createBusinessUnderstandingFixture();
    t.after(() => fixture.close());
    const oracle = buildBusinessUnderstandingOracle(fixture, definition);
    for (const item of definition.coreCases) {
        const result = evaluateBusinessUnderstandingCase(item, oracle.perCase[item.caseKey], perfectActual(oracle.perCase[item.caseKey]));
        assert.equal(result.status, 'PASS', JSON.stringify(result));
    }
});

test('Evaluator mutation：Identity、Variant、Amount、Cost Basis、No Guess、Completeness 均能抓取', t => {
    const fixture = createBusinessUnderstandingFixture();
    t.after(() => fixture.close());
    const oracle = buildBusinessUnderstandingOracle(fixture, definition);
    const byKey = Object.fromEntries(definition.coreCases.map(item => [item.caseKey, item]));
    const mutations = [
        ['Identity', 'BU-01', actual => { actual.canonicalEntities = []; }],
        ['Variant', 'BU-02', actual => { actual.canonicalEntities.pop(); }],
        ['Amount', 'BU-01', actual => { actual.amountExpected = 100; actual.amountActual = 99; }],
        ['Cost Basis', 'BU-04', actual => { actual.claims.push('calculated_with_95'); }],
        ['No Guess', 'BU-05', actual => { actual.guessed = true; }],
        ['Completeness', 'BU-06', actual => { actual.facts = actual.facts.filter(value => value !== 'inheritedConfiguration'); }],
    ];
    for (const [name, key, mutate] of mutations) {
        const actual = perfectActual(oracle.perCase[key]);
        mutate(actual);
        const result = evaluateBusinessUnderstandingCase(byKey[key], oracle.perCase[key], actual);
        assert.notEqual(result.status, 'PASS', `${name} mutation escaped evaluator`);
    }
});

test('BU-SCALE-01：完整聚合超过 128KB，限定读取保持预算内', t => {
    const fixture = createBusinessUnderstandingFixture({ scale: true });
    t.after(() => fixture.close());
    const allRows = fixture.db.prepare("SELECT id,name,spec,parts_json FROM recipes WHERE name LIKE '规模配方-%' ORDER BY id").all();
    const boundedRows = fixture.db.prepare("SELECT id,name,spec FROM recipes WHERE name LIKE '规模配方-%' ORDER BY id LIMIT 20").all();
    const aggregateBytes = Buffer.byteLength(JSON.stringify(allRows));
    const boundedBytes = Buffer.byteLength(JSON.stringify(boundedRows));
    assert.ok(allRows.length >= 300);
    assert.ok(aggregateBytes > 128 * 1024, `aggregate=${aggregateBytes}`);
    assert.ok(boundedBytes < 32 * 1024, `bounded=${boundedBytes}`);
});

test('V1 定义、Fixture、Oracle 均有稳定 SHA-256', () => {
    const hashes = definitionHashes(definitionPath, fixturePath, oraclePath);
    for (const value of Object.values(hashes)) assert.match(value, /^[a-f0-9]{64}$/);
    assert.equal(new Set(Object.values(hashes)).size, 3);
    assert.ok(fs.statSync(definitionPath).size > 0);
});
