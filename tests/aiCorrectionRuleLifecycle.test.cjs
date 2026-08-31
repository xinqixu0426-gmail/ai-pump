const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildCorrectionRuleConflictKey,
    inferCorrectionRuleScope,
    normalizeRuleConfiguration,
    resolveCorrectionRuleStates,
} = require('../api/services/aiCorrectionRuleLifecycle.cjs');

function approvedRule(overrides = {}) {
    return {
        id: 1,
        title: '测试规则',
        triggerText: '查询 V750 配方',
        instruction: '必须读取当前配方数据。',
        scopeType: 'domain',
        domains: ['recipe'],
        objectType: '',
        objectRef: '',
        ruleType: 'fact_authority',
        conflictGroup: 'recipe-source',
        priority: 100,
        effectiveFrom: '2026-08-01T00:00:00.000Z',
        expiresAt: null,
        ruleVersion: 1,
        status: 'active',
        evaluationReviewStatus: 'approved',
        evaluationEnabled: true,
        ...overrides,
    };
}

test('结构化纠正规则：范围字段按全局、领域和对象做完整校验', () => {
    const globalRule = normalizeRuleConfiguration({ scopeType: 'global', conflictGroup: 'global-answer' });
    assert.equal(globalRule.scopeType, 'global');
    assert.deepEqual(globalRule.domains, []);
    assert.equal(globalRule.ruleType, 'answer_correction');
    assert.match(globalRule.effectiveFrom, /^\d{4}-\d{2}-\d{2}T/);
    assert.throws(() => normalizeRuleConfiguration({ scopeType: 'domain', conflictGroup: 'domain-answer' }), /至少需要一个业务域/);
    assert.throws(() => normalizeRuleConfiguration({
        scopeType: 'object', domains: ['recipe'], objectType: 'recipe', conflictGroup: 'recipe-source',
    }), /必须填写对象类型和对象标识/);
    const objectRule = normalizeRuleConfiguration({
        scopeType: 'object', domains: ['recipe'], objectType: 'recipe', objectRef: 'V750',
        conflictGroup: 'recipe-source',
        effectiveFrom: '2026-08-01', expiresAt: '2026-09-01',
    });
    assert.equal(objectRule.objectRef, 'V750');
    assert.deepEqual(objectRule.domains, ['recipe']);
});

test('结构化纠正规则：从本轮正式工具证据推导业务域而不猜问题关键词', () => {
    const scope = inferCorrectionRuleScope(JSON.stringify({
        toolPlan: { steps: [{ name: 'get_recipe_detail' }] },
        toolResults: [{ name: 'search_coils' }],
    }));
    assert.equal(scope.scopeType, 'domain');
    assert.deepEqual(scope.domains, ['coil', 'recipe']);
    assert.equal(scope.conflictGroup, 'capability:get_recipe_detail');
    assert.deepEqual(inferCorrectionRuleScope('{}').domains, []);
});

test('结构化纠正规则：对象范围必须同时匹配类型和标识', () => {
    const rule = approvedRule({
        scopeType: 'object',
        objectType: 'recipe',
        objectRef: 'V750',
    });
    const options = { domains: ['recipe'], query: '查询 V750', now: '2026-08-15' };
    assert.equal(resolveCorrectionRuleStates([rule], options).effective.length, 0);
    assert.equal(resolveCorrectionRuleStates([rule], { ...options, objectTypes: ['quotation'] }).effective.length, 0);
    assert.deepEqual(
        resolveCorrectionRuleStates([rule], { ...options, objectTypes: ['recipe'] }).effective.map(item => item.id),
        [1]
    );
});

test('结构化纠正规则：原问题不参与冲突身份', () => {
    const first = approvedRule({ triggerText: '报价按什么顺序展示' });
    const second = approvedRule({ triggerText: '客户报价怎么排列' });
    assert.equal(buildCorrectionRuleConflictKey(first), buildCorrectionRuleConflictKey(second));
    assert.notEqual(
        buildCorrectionRuleConflictKey(first),
        buildCorrectionRuleConflictKey({ ...second, conflictGroup: 'another-topic' })
    );
});

test('结构化纠正规则：未审批、未到期、已过期和范围外都不能运行', () => {
    const now = '2026-08-15T00:00:00.000Z';
    const rules = [
        approvedRule({ id: 1, evaluationReviewStatus: 'pending', evaluationEnabled: false }),
        approvedRule({ id: 2, effectiveFrom: '2026-09-01T00:00:00.000Z' }),
        approvedRule({ id: 3, expiresAt: '2026-08-10T00:00:00.000Z' }),
        approvedRule({ id: 4, domains: ['quotation'] }),
        approvedRule({ id: 5 }),
    ].map(rule => ({ ...rule, conflictKey: buildCorrectionRuleConflictKey(rule) }));
    const result = resolveCorrectionRuleStates(rules, { domains: ['recipe'], now });
    assert.equal(result.states.get(1).effectiveStatus, 'pending_review');
    assert.equal(result.states.get(2).effectiveStatus, 'scheduled');
    assert.equal(result.states.get(3).effectiveStatus, 'expired');
    assert.equal(result.states.get(4).effectiveStatus, 'out_of_scope');
    assert.equal(result.states.get(5).effectiveStatus, 'effective');
    assert.deepEqual(result.effective.map(rule => rule.id), [5]);
});

test('结构化纠正规则：同冲突键去重、高优先级胜出、同优先级冲突暂停', () => {
    const common = { conflictKey: 'same-applicability' };
    const duplicateResult = resolveCorrectionRuleStates([
        approvedRule({ ...common, id: 1, priority: 100 }),
        approvedRule({ ...common, id: 2, priority: 120 }),
    ], { domains: ['recipe'], now: '2026-08-15' });
    assert.equal(duplicateResult.states.get(2).effectiveStatus, 'effective');
    assert.equal(duplicateResult.states.get(1).effectiveStatus, 'duplicate');

    const winnerResult = resolveCorrectionRuleStates([
        approvedRule({ ...common, id: 3, priority: 150, instruction: '以实时配方为准。' }),
        approvedRule({ ...common, id: 4, priority: 100, instruction: '以知识摘要为准。' }),
    ], { domains: ['recipe'], now: '2026-08-15' });
    assert.equal(winnerResult.states.get(3).effectiveStatus, 'effective');
    assert.equal(winnerResult.states.get(4).effectiveStatus, 'shadowed');

    const conflictResult = resolveCorrectionRuleStates([
        approvedRule({ ...common, id: 5, priority: 150, instruction: '以实时配方为准。' }),
        approvedRule({ ...common, id: 6, priority: 150, instruction: '以知识摘要为准。' }),
    ], { domains: ['recipe'], now: '2026-08-15' });
    assert.equal(conflictResult.states.get(5).effectiveStatus, 'conflicted');
    assert.equal(conflictResult.states.get(6).effectiveStatus, 'conflicted');
    assert.equal(conflictResult.effective.length, 0);
});
