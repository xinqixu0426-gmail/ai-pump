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
                    nextAction: {
                        id: 'repair_order_data',
                        title: '修复 BOM',
                        mode: 'manual',
                        status: 'available',
                        owner: '配方管理员',
                        expectedResult: '订单BOM完整。',
                    },
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
    assert.equal(order.resolution.mode, 'navigate');
    assert.equal(order.resolution.title, '修复 BOM');
    assert.equal(order.resolution.expectedResult, '订单BOM完整。');
    assert.equal(order.resolution.canAiConfirm, false);
    assert.equal(learning.count, 2);
    assert.equal(learning.path, '/recipes?recipeId=3&feedbackIds=21,22&action=smart-check');
    assert.equal(Object.prototype.hasOwnProperty.call(order, 'toolCall'), false);
});

test('V7.3：只有可用的订单确认步骤暴露受保护的 AI 确认参数', () => {
    const input = sources();
    input.readiness.items[0].nextAction = {
        id: 'confirm_order',
        title: '确认订单并进入采购流程',
        mode: 'confirmable',
        status: 'available',
        expectedResult: '订单进入待采购。',
    };

    const result = buildManagementActionCenter({ sources: input });
    const order = result.items.find(item => item.id === 'order-readiness:8');

    assert.equal(order.resolution.mode, 'confirmable');
    assert.equal(order.resolution.canAiConfirm, true);
    assert.deepEqual(order.resolution.confirmation, {
        toolName: 'execute_order_readiness_action',
        args: { orderId: 8, actionId: 'confirm_order' },
    });
});

test('V7.3：受阻的可确认步骤只提供导航，不生成确认参数', () => {
    const input = sources();
    input.readiness.items[0].nextAction = {
        id: 'confirm_order',
        title: '确认订单并进入采购流程',
        mode: 'confirmable',
        status: 'blocked',
    };

    const result = buildManagementActionCenter({ sources: input });
    const order = result.items.find(item => item.id === 'order-readiness:8');

    assert.equal(order.resolution.mode, 'navigate');
    assert.equal(order.resolution.canAiConfirm, false);
    assert.equal(order.resolution.confirmation, null);
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

test('管理待办中心把最近 AI 回归失败作为稳定知识健康事项', () => {
    const input = {
        readiness: { items: [] },
        businessAlerts: { alerts: [] },
        quality: { issues: [] },
        learningHealth: { items: [] },
        candidates: [],
        knowledgeHealth: { issues: [] },
        evaluation: {
            healthy: false,
            latestRun: {
                id: 18,
                status: 'completed',
                failedCount: 1,
                reviewCount: 1,
            },
            issues: [
                { caseTitle: '测试报告不能标成图纸' },
                { caseTitle: '报价不能暴露内部编号' },
            ],
        },
    };
    const result = buildManagementActionCenter({ sources: input });
    const item = result.items[0];

    assert.equal(result.metrics.total, 1);
    assert.equal(item.id, 'knowledge-regression:release-gate');
    assert.equal(item.priority, 'critical');
    assert.equal(item.count, 2);
    assert.equal(item.path, '/dashboard?view=knowledge');
    assert.match(item.detail, /测试报告不能标成图纸/);
    assert.equal(item.resolution.expectedResult, '最新一次知识库回归全部通过。');
});

test('管理待办中心经营风险使用稳定业务键，不受列表顺序影响', () => {
    const businessAlerts = {
        alerts: [
            {
                key: 'item-0-below-cost',
                severity: 'high',
                scope: 'quotation',
                entityId: '5',
                title: '报价 #5 低于成本',
            },
            {
                key: 'stale',
                severity: 'medium',
                scope: 'quotation',
                entityId: '6',
                title: '报价 #6 已停留 20 天',
            },
        ],
    };
    const first = buildManagementActionCenter({
        sources: {
            readiness: { items: [] },
            businessAlerts,
            quality: { issues: [] },
            learningHealth: { items: [] },
            candidates: [],
            knowledgeHealth: { issues: [] },
        },
    });
    const second = buildManagementActionCenter({
        sources: {
            readiness: { items: [] },
            businessAlerts: { alerts: [...businessAlerts.alerts].reverse() },
            quality: { issues: [] },
            learningHealth: { items: [] },
            candidates: [],
            knowledgeHealth: { issues: [] },
        },
    });

    assert.deepEqual(
        first.items.map(entry => entry.id).sort(),
        second.items.map(entry => entry.id).sort()
    );
});
