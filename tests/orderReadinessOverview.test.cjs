const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderReadinessOverview } = require('../api/services/orderReadinessOverview.cjs');

const now = new Date('2026-07-29T04:00:00.000Z');

function entry(id, verdict, options = {}) {
    return {
        readiness: {
            order: { id, customerName: `客户${id}`, status: '采购中', totalUnits: id },
            verdict,
            canProduce: verdict === 'ready',
            summary: `订单 #${id}`,
            metrics: { shortageLineCount: options.shortages?.length || 0 },
            blockers: options.blockers || [],
            warnings: options.warnings || [],
            shortages: options.shortages || [],
        },
        actionPlan: {
            planStatus: options.planStatus || 'action_required',
            steps: options.steps || [],
        },
    };
}

test('订单准备总览：汇总全部活动订单分类和关注数量', () => {
    const result = buildOrderReadinessOverview([
        entry(1, 'ready'),
        entry(2, 'waiting_materials'),
        entry(3, 'needs_review'),
        entry(4, 'blocked'),
    ], { now });

    assert.equal(result.generatedAt, now.toISOString());
    assert.deepEqual(result.metrics, {
        totalActiveOrders: 4,
        ready: 1,
        waitingMaterials: 1,
        needsReview: 1,
        blocked: 1,
        attentionRequired: 3,
    });
    assert.match(result.summary, /1 个可生产/);
    assert.match(result.summary, /1 个数据阻塞/);
});

test('订单准备总览：优先展示阻塞、缺料和待复核订单', () => {
    const result = buildOrderReadinessOverview([
        entry(1, 'ready'),
        entry(2, 'needs_review'),
        entry(3, 'waiting_materials'),
        entry(4, 'blocked'),
        entry(5, 'blocked'),
    ], { now });

    assert.deepEqual(result.items.map(item => item.order.id), [5, 4, 3, 2, 1]);
});

test('订单准备总览：保留主要问题、缺料和第一个未阻塞步骤', () => {
    const result = buildOrderReadinessOverview([
        entry(12, 'blocked', {
            blockers: [
                { code: 'order_bom_missing', title: '缺少BOM快照', detail: '无法核对', action: '补全', path: '/orders' },
                { code: 'part_inventory_unresolved', title: '未关联库存' },
            ],
            warnings: [{ code: 'margin_too_low', title: '利润偏薄' }],
            shortages: [{ model: '轴承', shortageQty: 30, purchaseUnit: '个', procurementStage: '待下单', inventoryType: 'part' }],
            steps: [
                { id: 'repair_order_data', sequence: 1, title: '修正订单产品与BOM', mode: 'manual', status: 'available', owner: '订单管理员', path: '/orders', expectedResult: '订单BOM完整。' },
                { id: 'confirm_order', sequence: 2, title: '确认订单', mode: 'confirmable', status: 'blocked', owner: 'AI', path: '/orders' },
            ],
        }),
    ], { now });

    const item = result.items[0];
    assert.equal(item.blockerCount, 2);
    assert.equal(item.warningCount, 1);
    assert.equal(item.shortageCount, 1);
    assert.equal(item.blockers[0].title, '缺少BOM快照');
    assert.equal(item.shortages[0].model, '轴承');
    assert.deepEqual(item.nextAction, {
        id: 'repair_order_data',
        sequence: 1,
        title: '修正订单产品与BOM',
        mode: 'manual',
        status: 'available',
        owner: '订单管理员',
        path: '/orders',
        expectedResult: '订单BOM完整。',
    });
});

test('订单准备总览：没有活动订单时返回空总览', () => {
    const result = buildOrderReadinessOverview([], { now });
    assert.equal(result.metrics.totalActiveOrders, 0);
    assert.equal(result.metrics.attentionRequired, 0);
    assert.deepEqual(result.items, []);
    assert.equal(result.summary, '当前没有需要检查的活动订单。');
});
