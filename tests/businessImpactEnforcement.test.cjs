'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBusinessImpactFixture } = require('./helpers/businessImpactFixture.cjs');
const { buildProjectionCases } = require('./helpers/businessImpactProjectionCases.cjs');
const { impactEligibility } = require('../api/business-impact/eligibility.cjs');
const { buildImpactTrigger } = require('../api/business-impact/triggerBuilder.cjs');
const { createBusinessImpactProjection } = require('../api/business-impact/projection.cjs');
const { buildImpactEvidenceBundle, validateImpactEvidenceBundle } = require('../api/business-impact/evidenceBundle.cjs');
const { enforceImpactAnswerBoundary, hasForbiddenClaim } = require('../api/business-impact/answerBoundary.cjs');

const positive = [
    ['把 V550 的 12-200 换成 12-140，除了成本变化，还影响什么？','RECIPE_CONFIGURATION_CHANGE'],
    ['V550 换线圈后，原来的性能测试报告还能直接用吗？','TEST_REPORT_VALIDITY'],
    ['V550 现在改了配置，已有订单也自动变了吗？','RECIPE_CONFIGURATION_CHANGE'],
    ['轴承-202 涨价会影响哪些配方成本？','PART_PRICE_CHANGE'],
    ['轴承-202 库存不足会影响哪个在手订单？','PART_INVENTORY_CHANGE'],
    ['V550 泵壳模板变更会影响哪些配方？','TEMPLATE_CHANGE'],
    ['这个订单当时用的配置和现在 V550 配方有什么区别？','ORDER_CONFIGURATION_COMPARE'],
    ['换成12-140以后温升会增加多少？','ENGINEERING_PREDICTION'],
];

test('ImpactEligibilityV1 admits supported impact intent and rejects eight ordinary L1-L4 questions', () => {
    for (const [question, changeType] of positive) {
        const actual = impactEligibility({ userText: question, semanticEligible: true });
        assert.equal(actual.eligible, true, question); assert.equal(actual.changeType, changeType, question);
    }
    for (const question of ['V550 当前成本多少？','12-200还有多少库存？','V550 用哪个线圈？','找一下 V800',
        '这个订单能不能生产？','12-220有几套方案？','这个零件多少钱？','当前铜价是多少？']) {
        const actual = impactEligibility({ userText: question, semanticEligible: true });
        assert.equal(actual.eligible, false, question);
    }
});

test('Impact trigger builder resolves only unique persisted canonical roots for all frozen cases', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const questions = require('./fixtures/business-impact-benchmark-v1.json').cases;
        for (const item of questions) {
            const eligibility = impactEligibility({ userText: item.question, semanticEligible: true });
            assert.equal(eligibility.eligible, true, item.caseKey);
            const trigger = buildImpactTrigger({ db: fixture.db, userText: item.question, impactEligibility: eligibility });
            assert.ok(trigger, item.caseKey);
            if (item.caseKey === 'IMP-09') assert.equal(trigger.canonicalId, null);
            else assert.match(String(trigger.canonicalId), /^[1-9][0-9]*$/, item.caseKey);
        }
    } finally { fixture.close(); }
});

test('ImpactEvidenceBundleV1 is bounded, target-preserving and cannot elevate projection truth', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const trigger = buildProjectionCases(fixture.ids)['IMP-04'];
        const impactResult = createBusinessImpactProjection({ db: fixture.db }).project(trigger);
        const bundle = buildImpactEvidenceBundle({ db: fixture.db, impactResult,
            impactEligibility: { slice: 'IP-05_PART_PRICE_RECIPES' } });
        assert.equal(bundle.verifiedImpacts.length, impactResult.impacts.length);
        assert.ok(bundle.verifiedImpacts.every(item => item.target.displayName));
        const wrongTarget = structuredClone(bundle); wrongTarget.verifiedImpacts[0].target.canonicalId = '999999';
        assert.throws(() => validateImpactEvidenceBundle(wrongTarget, impactResult), /ELEVATION/);
        const falseComplete = structuredClone(bundle); falseComplete.completeness = 'COMPLETE';
        assert.throws(() => validateImpactEvidenceBundle(falseComplete, { ...impactResult, completeness: 'PARTIAL', bounds: { ...impactResult.bounds, truncated: true } }));
    } finally { fixture.close(); }
});

test('Impact answer boundary rejects all eight required causal mutations by deterministic replacement', () => {
    const fixture = createBusinessImpactFixture();
    try {
        const cases = buildProjectionCases(fixture.ids);
        const make = key => {
            const impactResult = createBusinessImpactProjection({ db: fixture.db }).project(cases[key]);
            return buildImpactEvidenceBundle({ db: fixture.db, impactResult, impactEligibility: {} });
        };
        const proposed = make('IMP-01');
        assert.equal(hasForbiddenClaim('已经换成 12-140 并已影响配方', proposed), true); // M1
        assert.equal(hasForbiddenClaim('订单已经自动更新', proposed), true); // M2
        const engineering = make('IMP-10');
        assert.equal(hasForbiddenClaim('温升会增加 8℃', engineering), true); // M3
        const report = make('IMP-02');
        assert.equal(hasForbiddenClaim('测试报告已作废', report), true); // M4
        const quote = make('IMP-05');
        assert.equal(hasForbiddenClaim('报价已过期', quote), true); // M5
        const partial = structuredClone(make('IMP-04')); partial.completeness = 'PARTIAL';
        assert.equal(hasForbiddenClaim('这些就是全部配方', partial), true); // M6
        const price = make('IMP-04');
        assert.equal(hasForbiddenClaim('配方成本已经更新', price), true); // M7
        const result = enforceImpactAnswerBoundary({ answer: '错误配方受影响', bundle: price,
            userText: '轴承-202涨价会影响哪些配方？', impactEligibility: {} });
        assert.equal(result.replaced, true); assert.doesNotMatch(result.answer, /错误配方/); // M8
    } finally { fixture.close(); }
});
