const test = require('node:test');
const assert = require('node:assert/strict');
const { buildManagementActionCenter } = require('../api/services/managementActionCenter.cjs');

function sources() {
    return {
        readiness: {
            items: [
                {
                    order: { id: 8, customerName: '测试客户' },
                    verdict: 'blocked',
                    summary: '订单 #8 有基础数据阻塞。',
                    blockerCount: 1,
                    warningCount: 0,
                    shortageCount: 0,
                    blockers: [{ action: '补齐 BOM' }],
                    warnings: [],
                    nextAction: { title: '修复 BOM', owner: '配方管理员' },
                },
                {
                    order: { id: 9, customerName: '正常客户' },
                    verdict: 'ready',
                    summary: '可以生产。',
                },
            ],
        },
        businessAlerts: {
            alerts: [
                {
                    severity: 'medium',
                    scope: 'order',
                    entityId: '8',
                    title: '订单 #8 有 3 项待采购',
                    detail: '重复采购提醒',
                    action: '采购',
                    path: '/purchase',
                },
                {
                    severity: 'high',
                    scope: 'quotation',
                    entityId: '5',
                    title: '报价 #5 低于成本',
                    detail: '报价存在亏损风险。',
                    action: '确认是否特殊让利。',
                    path: '/quotations',
                },
            ],
        },
        quality: {
            issues: [
                {
                    key: 'missing_price_parts',
                    title: '零件缺少价格',
                    severity: 'danger',
                    count: 2,
                    suggestion: '补齐零件价格。',
                },
                {
                    key: 'none',
                    title: '无问题',
                    severity: 'warning',
                    count: 0,
                    suggestion: '',
                },
            ],
        },
        learningHealth: {
            items: [
                {
                    feedbackId: 21,
                    recipeId: 3,
                    recipeName: 'V750测试配方',
                    needsRecheck: true,
                    reason: '配方内容已修改，需要重新检查',
                },
                {
                    feedbackId: 22,
                    recipeId: 3,
                    recipeName: 'V750测试配方',
                    needsRecheck: true,
                    reason: '配方内容已修改，需要重新检查',
                },
            ],
        },
        candidates: [
            { id: 1, status: 'candidate', needsReview: false },
            { id: 2, status: 'approved', needsReview: true },
        ],
        knowledgeHealth: {
            issues: [{
                code: 'sync_failed',
                severity: 'critical',
                title: '知识同步失败',
                message: '最近一次同步失败。',
            }],
        },
    };
}

test('管理待办中心汇总现有权威检查并按优先级排序', () => {
    const result = buildManagementActionCenter({
        sources: sources(),
        now: new Date('2026-07-29T08:00:00.000Z'),
    });

    assert.equal(result.generatedAt, '2026-07-29T08:00:00.000Z');
    assert.equal(result.metrics.total, 7);
    assert.equal(result.metrics.critical, 2);
    assert.equal(result.metrics.high, 3);
    assert.equal(result.metrics.medium, 2);
    assert.equal(result.items[0].id, 'order-readiness:8');
    assert.equal(result.items[1].id, 'knowledge-health:sync_failed');
    assert.equal(result.items.some(item => item.title.includes('3 项待采购')), false);
});

test('管理待办中心提供可执行入口但不生成写动作', () => {
    const result = buildManagementActionCenter({ sources: sources() });
    const order = result.items.find(item => item.id === 'order-readiness:8');
    const learning = result.items.find(item => item.id === 'rule-learning:recipe:3');

    assert.equal(order.path, '/orders?orderId=8&view=readiness');
    assert.equal(order.owner, '配方管理员');
    assert.equal(learning.count, 2);
    assert.equal(learning.path, '/recipes?recipeId=3&feedbackIds=21,22&action=smart-check');
    assert.equal(Object.prototype.hasOwnProperty.call(order, 'toolCall'), false);
});

test('管理待办中心在各来源健康时返回空结果', () => {
    const result = buildManagementActionCenter({
        sources: {
            readiness: { items: [] },
            businessAlerts: { alerts: [] },
            quality: { issues: [] },
            learningHealth: { items: [] },
            candidates: [],
            knowledgeHealth: { issues: [] },
        },
    });

    assert.equal(result.metrics.total, 0);
    assert.equal(result.metrics.attentionRequired, 0);
    assert.deepEqual(result.items, []);
    assert.match(result.summary, /没有需要处理/);
});
