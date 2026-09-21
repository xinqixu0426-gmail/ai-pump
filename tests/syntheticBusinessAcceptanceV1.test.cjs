'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const definition = require('./fixtures/synthetic-business-acceptance-v1.json');
const { createSyntheticBusinessAcceptanceFixture, runSyntheticFixtureSelfChecks } = require('./helpers/syntheticBusinessAcceptanceFixture.cjs');
const { buildSyntheticBusinessAcceptanceOracle, definitionHashes } = require('./helpers/syntheticBusinessAcceptanceOracle.cjs');
const { evaluateSyntheticBusinessCase, perfectActual } = require('./helpers/syntheticBusinessAcceptanceEvaluator.cjs');

const root = path.resolve(__dirname, '..');

function setup(t) {
    const fixture = createSyntheticBusinessAcceptanceFixture();
    t.after(() => fixture.close());
    return { fixture, oracle: buildSyntheticBusinessAcceptanceOracle(fixture, definition) };
}

test('SyntheticBusinessAcceptanceV1 固定 32 个隔离业务验收场景', () => {
    assert.equal(definition.version, 'SyntheticBusinessAcceptanceV1');
    assert.equal(definition.cases.length, 32);
    assert.deepEqual(definition.cases.map(item => item.caseKey),
        Array.from({ length: 32 }, (_, index) => `SB-${String(index + 1).padStart(2, '0')}`));
    const categories = new Set(definition.cases.map(item => item.category));
    for (const required of ['cost', 'identity', 'catalog', 'override', 'inventory', 'ambiguity', 'relation', 'safety', 'completeness']) {
        assert.equal(categories.has(required), true, required);
    }
});

test('假数据同时覆盖正式/测试方案、歧义别名、失效目标和空关系', t => {
    const { fixture } = setup(t);
    const result = runSyntheticFixtureSelfChecks(fixture);
    assert.equal(result.passed, true, JSON.stringify(result, null, 2));
});

test('Oracle 由正式成本和关系服务生成，32 个理想执行全部 PASS', t => {
    const { oracle } = setup(t);
    for (const item of definition.cases) {
        const result = evaluateSyntheticBusinessCase(item, oracle.perCase[item.caseKey], perfectActual(item, oracle.perCase[item.caseKey]));
        assert.equal(result.status, 'PASS', JSON.stringify(result, null, 2));
    }
    assert.deepEqual(oracle.perCase['SB-23'].relationTargetIds, []);
    assert.equal(oracle.perCase['SB-07'].formalOverride.overrideStatus, 'APPLIED');
    assert.equal(oracle.perCase['SB-08'].formalOverride.overrideStatus, 'UNSUPPORTED_FOR_PRICING_MODE');
});

test('mutation 会抓住夹带错对象、错金额、假覆盖、假完整和未授权写入', t => {
    const { oracle } = setup(t);
    const byKey = Object.fromEntries(definition.cases.map(item => [item.caseKey, item]));
    const mutations = [
        ['foreign identity appended', 'SB-21', actual => { actual.answer += ` ${oracle.perCase['SB-21'].forbiddenTargets[0].currentName}`; }],
        ['wrong amount', 'SB-01', actual => { actual.answer = actual.answer.replace(String(oracle.perCase['SB-01'].amounts[0].value), '9999'); }],
        ['false calculated override', 'SB-07', actual => { actual.formalOverride.appliedWireWeight = 0.7; }],
        ['kit falsely applied', 'SB-08', actual => { actual.formalOverride.appliedWireWeight = 0.8; actual.formalOverride.isCustomWireWeight = true; }],
        ['ambiguous silently costed', 'SB-11', actual => { actual.answer += ' 整机成本 300 元'; }],
        ['unauthorized write', 'SB-29', actual => { actual.businessDataChanged = true; actual.writeExecuted = true; }],
    ];
    for (const [name, caseKey, mutate] of mutations) {
        const actual = perfectActual(byKey[caseKey], oracle.perCase[caseKey]);
        mutate(actual);
        const result = evaluateSyntheticBusinessCase(byKey[caseKey], oracle.perCase[caseKey], actual);
        assert.notEqual(result.status, 'PASS', name);
    }
});

test('SyntheticBusinessAcceptanceV1 三项资产哈希已冻结', () => {
    const hashes = definitionHashes(
        path.join(root, 'tests/fixtures/synthetic-business-acceptance-v1.json'),
        path.join(root, 'tests/helpers/syntheticBusinessAcceptanceFixture.cjs'),
        path.join(root, 'tests/helpers/syntheticBusinessAcceptanceOracle.cjs'));
    assert.deepEqual(hashes, {
        caseHash: 'e93875d12b5555162057e498b97e594289484d6af554853ed1e116c9aba255e4',
        fixtureHash: 'cd31af8cf40a436ae85c675ebc1aa070bab4730e9ba0a534d13689202847bb36',
        oracleHash: '302c6ef1bf89e7d503e9211a1913d0e440f276b59e7269c81f515c8acd03df56'
    });
});
