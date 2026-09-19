'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createBusinessUnderstandingFixtureV2, runFixtureSelfChecksV2 } = require('./helpers/businessUnderstandingFixtureV2.cjs');
const { buildBusinessUnderstandingOracleV2, definitionHashesV2, readDefinitionV2 } = require('./helpers/businessUnderstandingOracleV2.cjs');
const { evaluateBusinessUnderstandingCaseV2, perfectActualV2 } = require('./helpers/businessUnderstandingEvaluatorV2.cjs');
const { buildBusinessSemanticFrame } = require('../api/business-semantics/frameBuilder.cjs');

const root = path.resolve(__dirname, '..');
const definitionPath = path.join(root, 'tests/fixtures/business-understanding-benchmark-v2.json');
const fixturePath = path.join(root, 'tests/helpers/businessUnderstandingFixtureV2.cjs');
const oraclePath = path.join(root, 'tests/helpers/businessUnderstandingOracleV2.cjs');
const definition = readDefinitionV2(definitionPath);

test('BusinessUnderstandingBenchmarkV2 独立定义 11 个 Core 和 7 个维度', () => {
    assert.equal(definition.version, 'BusinessUnderstandingBenchmarkV2');
    assert.equal(definition.caseContractVersion, 2);
    assert.equal(definition.coreCases.length, 11);
    assert.deepEqual(definition.dimensions, ['identity', 'ambiguity', 'costSemantics', 'overrides', 'evidence', 'completeness', 'safety']);
    assert.deepEqual(definition.coreCases.map(item => item.caseKey), Array.from({ length: 11 }, (_, index) => `BU-${String(index + 1).padStart(2, '0')}`));
});

test('V2 fixture 同时固定 calculated 可覆盖与 kit 不可覆盖两种业务真相', t => {
    const fixture = createBusinessUnderstandingFixtureV2();
    t.after(() => fixture.close());
    const checks = runFixtureSelfChecksV2(fixture);
    assert.equal(checks.passed, true, JSON.stringify(checks, null, 2));
    const rows = fixture.db.prepare("SELECT sheets,pricing_mode FROM coils WHERE spec='12' AND sheets IN (140,160) ORDER BY sheets").all();
    assert.deepEqual(rows, [{ sheets: 140, pricing_mode: 'calculated' }, { sheets: 160, pricing_mode: 'kit' }]);
});

test('V2 Oracle 只从 fixture 和正式成本能力生成 override 证据', t => {
    const fixture = createBusinessUnderstandingFixtureV2();
    t.after(() => fixture.close());
    const oracle = buildBusinessUnderstandingOracleV2(fixture, definition);
    const calculated = oracle.perCase['BU-05'].formalFacts.wireOverride;
    const kit = oracle.perCase['BU-11'].formalFacts.wireOverride;
    assert.deepEqual({ pricingMode: calculated.pricingMode, requested: calculated.requestedWireWeight,
        applied: calculated.appliedWireWeight, custom: calculated.isCustomWireWeight, authority: calculated.wireWeightAuthority,
        status: calculated.overrideStatus }, { pricingMode: 'calculated', requested: 0.8, applied: 0.8,
        custom: true, authority: 'OVERRIDABLE', status: 'APPLIED' });
    assert.deepEqual({ pricingMode: kit.pricingMode, requested: kit.requestedWireWeight,
        applied: kit.appliedWireWeight, custom: kit.isCustomWireWeight, authority: kit.wireWeightAuthority,
        status: kit.overrideStatus }, { pricingMode: 'kit', requested: 0.8, applied: null,
        custom: false, authority: 'NON_OVERRIDABLE', status: 'UNSUPPORTED_FOR_PRICING_MODE' });
});

test('V2 evaluator 的 11 个理想正式结果全部 PASS', t => {
    const fixture = createBusinessUnderstandingFixtureV2();
    t.after(() => fixture.close());
    const oracle = buildBusinessUnderstandingOracleV2(fixture, definition);
    for (const item of definition.coreCases) {
        const result = evaluateBusinessUnderstandingCaseV2(item, oracle.perCase[item.caseKey], perfectActualV2(oracle.perCase[item.caseKey], item.caseKey));
        assert.equal(result.status, 'PASS', JSON.stringify(result, null, 2));
    }
});

test('V2 mutation M1-M6 会抓住覆盖、kit 虚假声称和别名选错', t => {
    const fixture = createBusinessUnderstandingFixtureV2();
    t.after(() => fixture.close());
    const oracle = buildBusinessUnderstandingOracleV2(fixture, definition);
    const byKey = Object.fromEntries(definition.coreCases.map(item => [item.caseKey, item]));
    const mutations = [
        ['M1 applied mismatch', 'BU-05', actual => { actual.formalOverride.appliedWireWeight = 0.7; }],
        ['M2 custom false', 'BU-05', actual => { actual.formalOverride.isCustomWireWeight = false; }],
        ['M3 kit false applied claim', 'BU-11', actual => { actual.claims.push('false_override_applied'); }],
        ['M4 kit amount mislabeled', 'BU-11', actual => { actual.claims.push('kit_price_as_override_cost'); }],
        ['M5 alias wrong target', 'BU-09', actual => { actual.canonicalEntities = [999999]; }],
        ['M6 ambiguous alias selected', 'BU-09', actual => { actual.aliasResolutionState = 'ALIAS_AMBIGUOUS'; actual.selectedAmbiguousAlias = true; }],
    ];
    for (const [name, caseKey, mutate] of mutations) {
        const actual = perfectActualV2(oracle.perCase[caseKey], caseKey);
        mutate(actual);
        const outcome = evaluateBusinessUnderstandingCaseV2(byKey[caseKey], oracle.perCase[caseKey], actual);
        assert.notEqual(outcome.status, 'PASS', `${name} escaped evaluator`);
    }
});

test('kit 正式结果在 Semantic Frame 中进入 UNSUPPORTED_OVERRIDE 而非已应用', () => {
    const frame = buildBusinessSemanticFrame({
        userText: '假如线重按0.8算，12-160这套线圈成本是多少',
        stage: 'POST_EVIDENCE',
        toolResults: [{ name: 'calculate_coil_cost', result: { success: true, data: {
            coilId: 2, spec: '12', sheets: 160, pricingMode: 'kit', totalCost: 76,
            requestedWireWeight: 0.8, appliedWireWeight: null, isCustomWireWeight: false,
            wireWeightAuthority: 'NON_OVERRIDABLE', overrideStatus: 'UNSUPPORTED_FOR_PRICING_MODE',
        }, executionEvidence: { verified: true, kind: 'formal_api_query', calls: [{ method: 'POST', path: '/api/coils/calculate' }] } } }],
    });
    assert.equal(frame.override.supportStatus, 'UNSUPPORTED_OVERRIDE');
    assert.equal(frame.completeness.status, 'UNSUPPORTED_REQUEST');
    assert.equal(frame.cost.calculationSupport, 'UNSUPPORTED');
    assert.equal(frame.evidence.facts.find(item => item.factType === 'COIL_OVERRIDE_APPLIED').state, 'UNSUPPORTED');
});

test('V1 四项冻结资产保持原哈希，V2 三项定义生成独立哈希', () => {
    const v1 = require('./helpers/businessUnderstandingOracle.cjs').definitionHashes(
        path.join(root, 'tests/fixtures/business-understanding-benchmark-v1.json'),
        path.join(root, 'tests/helpers/businessUnderstandingFixture.cjs'),
        path.join(root, 'tests/helpers/businessUnderstandingOracle.cjs'));
    assert.deepEqual(v1, {
        caseHash: '2cb914084fbcfce4e7ebd7c21671e12eae6836e920e3cf5da5d4d22ca03a342e',
        fixtureHash: '516de1adf38a17a2e9d2a93c4a76be925d6ba12700429367640ddae088ef766b',
        oracleHash: '5dafef1e15fc64d45e16a65ef0ee902bd41d1d4f8d41650926d068b8d067692f',
    });
    assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(
        path.join(root, 'tests/fixtures/business-semantic-frame-oracle-v1.json'))).digest('hex'),
    'd184d294c4366ff3a8a5035f4aebd9a387fb689388057b6d0e6177f5655ed82c');
    const v2 = definitionHashesV2(definitionPath, fixturePath, oraclePath);
    assert.deepEqual(v2, {
        caseHash: '95ef58e6cc399ed4780202caa1921a6c7036079a75d79c4bff689808dde12481',
        fixtureHash: '77735ee01b6df61568e63e6c9c87a9a1907d2fcd89a18536a887204444b9c062',
        oracleHash: 'b7165de435511c1c902ad70cfe8efab95be0d1d5cd9682fffe05afa14f6b9082',
    });
});
