const test = require('node:test');
const assert = require('node:assert/strict');
const {
    calculateDynamicConfigCost,
    calculateFloatEstimate,
    calculateCableEstimate,
} = require('../api/services/dynamicConfigCost.cjs');

const partsByModel = {
    '浮球-线径0.55': [{ model: '浮球-线径0.55', supplier: 'A', price: 2 }],
    '电缆-线径0.55': [{ model: '电缆-线径0.55', supplier: 'A', price: 1.2 }],
    '电缆配件费': [{ model: '电缆配件费', supplier: 'A', price: 0.5 }],
    '小纸箱': [{ model: '小纸箱', supplier: 'A', price: 3 }],
};

const partsCache = {
    '小纸箱': { category: '包装', price: 3 },
};

function getSetting(key) {
    if (key === 'float_accessory_delta') return '0.6';
    if (key === 'cable_accessories') {
        return JSON.stringify({
            xinjie: { name: '新界式', fee: 0.9 },
        });
    }
    return undefined;
}

test('动态配置成本服务将线材和插头规格合并为成品电缆', () => {
    const result = calculateDynamicConfigCost({
        hasFloat: true,
        floatAccessoryType: 'xinjie',
        cableLength: 2,
        cableAccessoryType: 'xinjie',
        boxType: '纸箱',
        resolvedWire: '0.55',
    }, { partsCache, partsByModel, getSetting });

    assert.equal(result.totalCost, 8.9);
    assert.deepEqual(result.details.map(item => item.name), ['浮球-新界式', '成品电缆（新界式）', '纸箱']);
    assert.equal(result.details[0].price, '2.60');
    assert.equal(result.details[1].price, '3.30');
    assert.equal(result.details[1].inventoryQty, 2);
    assert.equal(result.details[2].model, '小纸箱');
});

test('单独浮球估算复用动态配置规则', () => {
    const result = calculateFloatEstimate({ wire: '0.55', floatAccessoryType: 'xinjie' }, partsByModel, getSetting);

    assert.equal(result.basePrice, 2);
    assert.equal(result.accessoryDelta, 0.6);
    assert.equal(result.totalCost, 2.6);
});

test('单独电缆估算复用全局配件配置', () => {
    const result = calculateCableEstimate({ wire: '0.55', length: 2, cableAccessoryType: 'xinjie' }, partsByModel, getSetting);

    assert.equal(result.cableSubtotal, 2.4);
    assert.equal(result.accessoryName, '新界式');
    assert.equal(result.accessoryFee, 0.9);
    assert.equal(result.totalCost, 3.3);
});
