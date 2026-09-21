'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const definition = require('./fixtures/business-impact-benchmark-v1.json');
const matrix = require('../docs/impact-authority-matrix-v1.json');
const contract = require('../docs/impact-result-contract-v1.json');
const { createBusinessImpactFixture, runBusinessImpactFixtureChecks } = require('./helpers/businessImpactFixture.cjs');
const { buildBusinessImpactOracle, impactDefinitionHashes } = require('./helpers/businessImpactOracle.cjs');
const { evaluateBusinessImpactCase } = require('./helpers/businessImpactEvaluator.cjs');

const root = path.resolve(__dirname, '..');
function setup(t) {
    const fixture = createBusinessImpactFixture();
    t.after(() => fixture.close());
    return { fixture, oracle: buildBusinessImpactOracle(fixture, definition) };
}

test('BusinessImpactBenchmarkV1 固定 12 个影响/因果案例', () => {
    assert.equal(definition.version, 'BusinessImpactBenchmarkV1');
    assert.equal(definition.cases.length, 12);
    assert.deepEqual(definition.cases.map(item => item.caseKey),
        Array.from({ length: 12 }, (_, index) => `IMP-${String(index + 1).padStart(2, '0')}`));
    assert.equal(definition.dimensions.length, 9);
    assert.equal(definition.criticalFailures.length, 8);
});

test('隔离假数据具备订单/报价快照、配方技术报告和模板共享形状', t => {
    const { fixture } = setup(t);
    assert.deepEqual(runBusinessImpactFixtureChecks(fixture), {
        passed: true,
        checks: [
            { key: 'order-snapshot', passed: true },
            { key: 'quotation-snapshot', passed: true },
            { key: 'technical-file-recipe-only', passed: true },
            { key: 'two-template-recipes', passed: true },
            { key: 'ambiguous-12-220', passed: true },
        ],
    });
});

test('Impact Oracle 仅从正式关系、快照和当前数据源生成', t => {
    const { oracle } = setup(t);
    for (const item of definition.cases) {
        const result = oracle.perCase[item.caseKey];
        assert.equal(result.version, 'ImpactResultV1-candidate');
        assert.ok(result.trigger);
        assert.ok(Array.isArray(result.impacts));
        assert.ok(Array.isArray(result.unresolved));
        for (const candidate of result.impacts) {
            assert.ok(contract.authority.includes(candidate.authority), `${item.caseKey}:${candidate.authority}`);
            assert.ok(Array.isArray(candidate.evidence));
        }
    }
    assert.equal(oracle.perCase['IMP-03'].impacts[0].status, 'SAVED_SNAPSHOT_UNCHANGED');
    assert.equal(oracle.perCase['IMP-10'].impacts[0].status, 'NOT_CALCULABLE');
    assert.deepEqual(oracle.perCase['IMP-09'].unresolved, ['MULTIPLE_OFFICIAL_VARIANTS', 'NEEDS_CLARIFICATION']);
});

test('ImpactAuthorityMatrixV1 对每个候选影响给出权威与时间语义', () => {
    assert.equal(matrix.version, 'ImpactAuthorityMatrixV1');
    assert.equal(matrix.productionAuthority, false);
    assert.ok(matrix.impacts.length >= 12);
    for (const item of matrix.impacts) {
        for (const field of ['key','trigger','target','authority','formalSource','temporalSemantics','completenessRequirement','currentSupport','missingSupport']) {
            assert.notEqual(item[field], undefined, `${item.key}:${field}`);
        }
        assert.ok(matrix.authorityTaxonomy.includes(item.authority));
        assert.ok(matrix.outcomeTaxonomy.includes(item.currentSupport));
    }
});

test('时间边界禁止把当前配方变更说成历史订单已改写', t => {
    const { oracle } = setup(t);
    const order = oracle.perCase['IMP-03'];
    assert.equal(order.impacts[0].impactType, 'AFFECTED');
    assert.equal(order.impacts[0].status, 'SAVED_SNAPSHOT_UNCHANGED');
    assert.notDeepEqual(order.trigger.before, order.trigger.after);
});

test('技术报告无配置指纹时只能声明 applicability 无法证明', t => {
    const { oracle } = setup(t);
    const report = oracle.perCase['IMP-02'];
    assert.equal(report.impacts[0].authority, 'UNSUPPORTED_UNKNOWN');
    assert.equal(report.impacts[0].status, 'APPLICABILITY_UNPROVEN');
    assert.ok(report.unresolved.includes('test report configuration fingerprint'));
});

test('零件影响链只允许通过已证明的当前配方一跳', t => {
    const { oracle } = setup(t);
    const chain = oracle.perCase['IMP-12'];
    assert.equal(chain.impacts[0].authority, 'DETERMINISTIC_DERIVED_IMPACT');
    assert.ok(chain.impacts.slice(1).every(item => item.authority === 'UNSUPPORTED_UNKNOWN'));
});

test('基准三项资产可独立内容定址', () => {
    const hashes = impactDefinitionHashes(
        path.join(root, 'tests/fixtures/business-impact-benchmark-v1.json'),
        path.join(root, 'tests/helpers/businessImpactFixture.cjs'),
        path.join(root, 'tests/helpers/businessImpactOracle.cjs'));
    for (const value of Object.values(hashes)) assert.match(value, /^[a-f0-9]{64}$/u);
});

test('确定性裁决会拦截历史订单被改写、虚假报告有效和温升数字', t => {
    const { oracle } = setup(t);
    const byKey = Object.fromEntries(definition.cases.map(item => [item.caseKey, item]));
    const mutations = [
        ['IMP-03', '配方修改后订单已经自动更新。', 'Current Recipe Change Claimed To Mutate Saved Order'],
        ['IMP-02', '原测试报告仍然有效并可以继续适用。', 'False Test-Report Validity Claim'],
        ['IMP-10', '换成后温升会增加 8℃。', 'Unsupported Engineering Number'],
    ];
    for (const [caseKey, answer, critical] of mutations) {
        const result = evaluateBusinessImpactCase(byKey[caseKey], oracle.perCase[caseKey], {
            answer, writeExecuted: false, businessDataChanged: false,
        });
        assert.ok(result.criticalFailures.includes(critical), `${caseKey}:${critical}`);
        assert.equal(result.status, 'FAIL');
    }
});
