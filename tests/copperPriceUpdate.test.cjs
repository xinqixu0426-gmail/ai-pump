const test = require('node:test');
const assert = require('node:assert/strict');
const {
    buildCopperPriceUpdates,
    updateAllCoilsCopperPrice,
} = require('../api/services/copperPriceUpdate.cjs');

const baseCoil = {
    id: 1,
    sheets: 120,
    unit_price: 0.21,
    wire_weight: 0.559,
    coil_fee: 8,
    rotor_fee: 5,
    copper_base: 105.27,
    cost: 97.04593,
};

test('铜价同步：铜价和成本均未变化时不生成数据库写入', () => {
    const draft = buildCopperPriceUpdates([baseCoil], 105270);
    assert.equal(draft.copperPricePerKg, '105.27');
    assert.deepEqual(draft.updates, []);
});

test('铜价同步：只更新数值发生变化的线圈', () => {
    const updated = { ...baseCoil, id: 2, copper_base: 100, cost: 90 };
    const draft = buildCopperPriceUpdates([baseCoil, updated], 105270);
    assert.equal(draft.updates.length, 1);
    assert.equal(draft.updates[0].id, 2);
    assert.deepEqual(draft.updates[0].values, {
        copper_base: '105.27',
        cost: '97.04593',
    });
});

test('铜价同步：供应商套件价方案保持价格和成本不变', () => {
    const kitCoil = {
        ...baseCoil,
        id: 3,
        pricing_mode: 'kit',
        kit_price: 88,
        copper_base: 1,
        cost: 88,
    };
    const draft = buildCopperPriceUpdates([kitCoil], 105270);
    assert.equal(draft.scannedCount, 1);
    assert.deepEqual(draft.updates, []);
});

test('铜价同步：无变化时不会调用 safeUpdate', () => {
    const writes = [];
    const db = {
        prepare: () => ({ all: () => [baseCoil] }),
        transaction: (callback) => (items) => callback(items),
    };
    const result = updateAllCoilsCopperPrice(
        db,
        (...args) => writes.push(args),
        105270
    );
    assert.equal(result.updatedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.unchanged, true);
    assert.deepEqual(writes, []);
});
