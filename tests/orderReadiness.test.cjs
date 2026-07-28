const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOrderReadiness } = require('../api/services/orderReadiness.cjs');

const now = new Date('2026-07-29T00:00:00.000Z');
const recipe = { id: 7, name: 'V750' };

function order(overrides = {}) {
    return {
        id: 12,
        customerName: '测试客户',
        contractNo: 'HT-12',
        status: '采购完成',
        itemsJson: JSON.stringify([{
            recipeId: 7,
            recipeName: 'V750',
            qty: 2,
            unitCost: 200,
            unitPrice: 230,
            partsJson: JSON.stringify([
                { model: '轴承', qty: 2 },
                { model: '12-160', name: '线圈转子', qty: 1, costSource: 'coil' },
            ]),
        }]),
        ...overrides,
    };
}

function purchase(overrides = {}) {
    return {
        identityKey: 'part:1',
        model: '轴承',
        name: '轴承',
        inventoryType: 'part',
        partId: 1,
        totalQty: 4,
        currentStock: 4,
        plannedQty: 0,
        orderedQty: 0,
        receivedQty: 0,
        stockedQty: 0,
        purchaseUnit: '个',
        ...overrides,
    };
}

test('订单生产准备：状态、BOM、零件、线圈、采购和成本全部通过', () => {
    const result = buildOrderReadiness({
        order: order(),
        recipes: [recipe],
        plan: {
            purchaseList: [
                purchase(),
                purchase({
                    identityKey: 'coil:3',
                    model: '12-160',
                    inventoryType: 'coil',
                    partId: undefined,
                    coilId: 3,
                    totalQty: 2,
                    currentStock: 2,
                    purchaseUnit: '套',
                }),
            ],
        },
        now,
    });

    assert.equal(result.verdict, 'ready');
    assert.equal(result.canProduce, true);
    assert.equal(result.steps.length, 6);
    assert.deepEqual(result.steps.map(item => item.status), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
    assert.equal(result.metrics.totalLockedCost, 400);
    assert.equal(result.metrics.totalOrderPrice, 460);
    assert.equal(result.metrics.grossProfit, 60);
    assert.deepEqual(result.shortages, []);
});

test('订单生产准备：按当前可用库存判断缺料，不把已下单误判为可生产', () => {
    const result = buildOrderReadiness({
        order: order({ status: '采购中' }),
        recipes: [recipe],
        plan: {
            purchaseList: [
                purchase({
                    totalQty: 4,
                    currentStock: 1,
                    plannedQty: 3,
                    orderedQty: 3,
                    receivedQty: 0,
                    stockedQty: 0,
                }),
                purchase({
                    identityKey: 'coil:3',
                    model: '12-160',
                    inventoryType: 'coil',
                    partId: undefined,
                    coilId: 3,
                    totalQty: 2,
                    currentStock: 0,
                    plannedQty: 2,
                    orderedQty: 2,
                    receivedQty: 2,
                    stockedQty: 0,
                    purchaseUnit: '套',
                }),
            ],
        },
        now,
    });

    assert.equal(result.verdict, 'waiting_materials');
    assert.equal(result.canProduce, false);
    assert.equal(result.shortages.length, 2);
    assert.equal(result.shortages[0].shortageQty, 3);
    assert.equal(result.shortages[0].procurementStage, '待到货');
    assert.equal(result.shortages[1].procurementStage, '待入库');
    assert.equal(result.steps.find(item => item.key === 'procurement').status, 'warning');
    assert.equal(result.recommendedActions.some(item => item.path === '/purchase'), true);
});

test('订单生产准备：未确认、缺BOM和无正式库存映射形成数据阻塞', () => {
    const result = buildOrderReadiness({
        order: order({
            status: '待确认',
            itemsJson: JSON.stringify([{
                recipeName: '临时型号',
                qty: 1,
                unitCost: 0,
                unitPrice: 0,
                partsJson: '[]',
            }]),
        }),
        recipes: [],
        plan: {
            purchaseList: [
                purchase({
                    model: '12-190',
                    inventoryType: 'none',
                    partId: undefined,
                    totalQty: 1,
                    currentStock: 0,
                    plannedQty: 1,
                    purchaseUnit: '套',
                }),
                purchase({
                    model: '包装估算',
                    partId: undefined,
                    totalQty: 1,
                    currentStock: 0,
                    plannedQty: 1,
                }),
            ],
        },
        now,
    });

    assert.equal(result.verdict, 'blocked');
    assert.equal(result.canProduce, false);
    assert.equal(result.blockers.some(item => item.code === 'order_not_confirmed'), true);
    assert.equal(result.blockers.some(item => item.code === 'order_bom_missing'), true);
    assert.equal(result.blockers.some(item => item.code === 'coil_inventory_unresolved'), true);
    assert.equal(result.blockers.some(item => item.code === 'part_inventory_unresolved'), true);
    assert.equal(result.warnings.some(item => item.code === 'locked_cost_missing'), true);
});

test('订单生产准备：库存满足但亏损价格需要复核', () => {
    const input = order();
    const items = JSON.parse(input.itemsJson);
    items[0].unitPrice = 180;
    input.itemsJson = JSON.stringify(items);
    const result = buildOrderReadiness({
        order: input,
        recipes: [recipe],
        plan: { purchaseList: [purchase()] },
        now,
    });

    assert.equal(result.verdict, 'needs_review');
    assert.equal(result.canProduce, false);
    assert.equal(result.warnings.some(item => item.code === 'price_below_cost'), true);
    assert.equal(result.steps.find(item => item.key === 'cost').status, 'warning');
});

test('订单生产准备：已关闭或已取消订单不再执行检查', () => {
    for (const status of ['已关闭', '已取消']) {
        const result = buildOrderReadiness({
            order: order({ status }),
            recipes: [recipe],
            plan: { purchaseList: [purchase()] },
            now,
        });

        assert.equal(result.verdict, 'not_applicable');
        assert.equal(result.canProduce, false);
        assert.equal(result.steps.every(item => item.status === 'skipped'), true);
    }
});
