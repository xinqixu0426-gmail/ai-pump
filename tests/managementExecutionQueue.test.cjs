const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildManagementExecutionQueue,
    scoreManagementAction,
} = require('../api/services/managementExecutionQueue.cjs');

const GENERATED_AT = '2026-07-29T08:00:00.000Z';

function item(overrides = {}) {
    return {
        id: 'data-quality:missing-price',
        priority: 'high',
        category: 'data_quality',
        categoryLabel: '数据质量',
        title: '零件缺少价格',
        detail: '补齐零件价格。',
        action: '进入数据质量查看明细',
        path: '/dashboard?view=quality',
        count: 1,
        entityType: 'quality_issue',
        entityId: 'missing-price',
        sourceType: 'data_quality',
        lifecycle: {
            activeSince: '2026-07-29T07:00:00.000Z',
            occurrenceCount: 1,
        },
        ...overrides,
    };
}

test('V7.2：业务优先级不可被持续时间和重复次数跨越', () => {
    const queue = buildManagementExecutionQueue({
        generatedAt: GENERATED_AT,
        items: [
            item({
                id: 'old-high',
                title: '长期反复的高优先级事项',
                priority: 'high',
                count: 30,
                lifecycle: {
                    activeSince: '2026-06-01T00:00:00.000Z',
                    occurrenceCount: 8,
                },
            }),
            item({
                id: 'new-critical',
                title: '刚出现的紧急事项',
                priority: 'critical',
            }),
        ],
    });

    assert.equal(queue.items[0].id, 'new-critical');
    assert.equal(queue.items[1].id, 'old-high');
    assert.ok(queue.items[0].score > queue.items[1].score);
});

test('V7.2：同优先级按持续、重复和影响范围形成可解释顺序', () => {
    const queue = buildManagementExecutionQueue({
        generatedAt: GENERATED_AT,
        items: [
            item({ id: 'fresh', title: '新事项' }),
            item({
                id: 'repeated',
                title: '反复事项',
                count: 12,
                lifecycle: {
                    activeSince: '2026-07-20T08:00:00.000Z',
                    occurrenceCount: 3,
                },
            }),
        ],
    });

    assert.equal(queue.items[0].id, 'repeated');
    assert.deepEqual(queue.items[0].reasons, [
        '高优先级',
        '已持续 9 天',
        '第 3 次出现',
        '涉及 12 项',
    ]);
    assert.equal(queue.items[0].scoreBreakdown.duration, 24);
    assert.equal(queue.items[0].scoreBreakdown.recurrence, 24);
    assert.equal(queue.items[0].scoreBreakdown.impact, 18);
});

test('V7.2：今日执行队列只突出前三项并保留其余数量', () => {
    const queue = buildManagementExecutionQueue({
        generatedAt: GENERATED_AT,
        items: [
            item({ id: 'one', title: '事项一', priority: 'critical' }),
            item({ id: 'two', title: '事项二' }),
            item({ id: 'three', title: '事项三', priority: 'medium' }),
            item({ id: 'four', title: '事项四', priority: 'low' }),
        ],
    });

    assert.equal(queue.items.length, 3);
    assert.equal(queue.remainingCount, 1);
    assert.deepEqual(queue.items.map(entry => entry.rank), [1, 2, 3]);
    assert.equal(queue.items[0].queueLabel, '现在先处理');
    assert.equal(queue.items[1].queueLabel, '接着处理');
});

test('V7.2：缺少生命周期时仍能按实时严重度稳定排序', () => {
    const result = scoreManagementAction(item({ lifecycle: null, count: 0 }), GENERATED_AT);

    assert.equal(result.score, 300);
    assert.deepEqual(result.reasons, ['高优先级', '刚刚出现']);
});

test('V7.2：不足一小时的持续事项显示具体分钟数', () => {
    const result = scoreManagementAction(item({
        lifecycle: {
            activeSince: '2026-07-29T07:24:00.000Z',
            occurrenceCount: 1,
        },
    }), GENERATED_AT);

    assert.equal(result.reasons[1], '已持续 36 分钟');
    assert.equal(result.scoreBreakdown.duration, 0);
});
