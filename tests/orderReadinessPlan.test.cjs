const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderReadinessPlan } = require('../api/services/orderReadinessPlan.cjs');

const now = new Date('2026-07-29T01:00:00.000Z');

function readiness(overrides = {}) {
    return {
        order: { id: 12, customerName: '测试客户', status: '采购中' },
        verdict: 'waiting_materials',
        blockers: [],
        warnings: [],
        shortages: [],
        ...overrides,
    };
}

test('订单处理方案：已满足准备条件时不生成多余步骤', () => {
    const result = buildOrderReadinessPlan(readiness({ verdict: 'ready' }), { now });

    assert.equal(result.planStatus, 'complete');
    assert.equal(result.steps.length, 0);
    assert.equal(result.generatedAt, now.toISOString());
});

test('订单处理方案：先修复BOM和库存映射，再允许AI发起订单确认', () => {
    const result = buildOrderReadinessPlan(readiness({
        order: { id: 12, customerName: '测试客户', status: '待确认' },
        verdict: 'blocked',
        blockers: [
            { code: 'order_not_confirmed', title: '订单尚未确认' },
            { code: 'order_bom_missing', title: 'V750 缺少BOM快照' },
            { code: 'part_inventory_unresolved', title: '包装估算未关联零件库存' },
        ],
    }), { now });

    assert.equal(result.planStatus, 'needs_resolution');
    assert.deepEqual(result.steps.map(item => item.id), [
        'repair_order_data',
        'resolve_part_inventory',
        'confirm_order',
    ]);
    const confirmation = result.steps[2];
    assert.equal(confirmation.mode, 'confirmable');
    assert.equal(confirmation.status, 'blocked');
    assert.deepEqual(confirmation.dependsOn, ['repair_order_data', 'resolve_part_inventory']);
    assert.equal(result.metrics.confirmableSteps, 0);
    assert.equal(result.metrics.blockedSteps, 1);
    assert.deepEqual(confirmation.toolCall, {
        name: 'update_order_status',
        args: { orderId: 12, status: '待采购' },
    });
});

test('订单处理方案：未确认但数据完整时可发起确认', () => {
    const result = buildOrderReadinessPlan(readiness({
        order: { id: 12, customerName: '测试客户', status: '待确认' },
        verdict: 'blocked',
        blockers: [{ code: 'order_not_confirmed', title: '订单尚未确认' }],
    }), { now });

    assert.equal(result.planStatus, 'ready_for_confirmation');
    assert.equal(result.steps[0].id, 'confirm_order');
    assert.equal(result.steps[0].status, 'available');
    assert.equal(result.metrics.confirmableSteps, 1);
    assert.equal(result.metrics.blockedSteps, 0);
});

test('订单处理方案：外包装估算未解决时阻止确认订单', () => {
    const result = buildOrderReadinessPlan(readiness({
        order: { id: 12, customerName: '测试客户', status: '待确认' },
        verdict: 'blocked',
        blockers: [
            { code: 'order_not_confirmed', title: '订单尚未确认' },
            { code: 'packaging_estimate_unresolved', title: 'V750 外包装仍是估算项' },
        ],
    }), { now });

    assert.deepEqual(result.steps.map(item => item.id), [
        'resolve_packaging_estimate',
        'confirm_order',
    ]);
    assert.equal(result.steps[1].status, 'blocked');
    assert.deepEqual(result.steps[1].dependsOn, ['resolve_packaging_estimate']);
});

test('订单处理方案：按采购阶段区分下单、到货和入库责任', () => {
    const result = buildOrderReadinessPlan(readiness({
        shortages: [
            { model: '轴承', procurementStage: '待下单' },
            { model: '电缆', procurementStage: '待到货' },
            { model: '线圈', procurementStage: '待入库' },
        ],
    }), { now });

    assert.equal(result.planStatus, 'action_required');
    assert.deepEqual(result.steps.map(item => [item.id, item.mode, item.owner]), [
        ['place_purchase_orders', 'manual', '采购人员'],
        ['track_purchase_arrival', 'monitor', '采购人员'],
        ['stock_received_materials', 'manual', '仓库人员'],
    ]);
    assert.equal(result.metrics.waitingSteps, 1);
});

test('订单处理方案：价格风险要求补充业务决定，不擅自修改售价', () => {
    const result = buildOrderReadinessPlan(readiness({
        verdict: 'needs_review',
        warnings: [{ code: 'price_below_cost', title: 'V750 销售单价低于成本' }],
    }), { now });

    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].id, 'review_order_cost_price');
    assert.equal(result.steps[0].mode, 'needs_input');
    assert.equal(result.steps[0].toolCall, undefined);
});

test('订单处理方案：已结束订单不适用', () => {
    const result = buildOrderReadinessPlan(readiness({
        order: { id: 12, status: '已关闭' },
        verdict: 'not_applicable',
    }), { now });

    assert.equal(result.planStatus, 'not_applicable');
    assert.deepEqual(result.steps, []);
});
