const test = require('node:test');
const assert = require('node:assert/strict');
const {
    parseCableAccessoryFee,
    parseCableAccessoryName,
    getCableAccessoryFeeFromPartsByModel,
    getCableAccessoryNameFromPartsByModel,
    getCableAccessoryFeeFromCatalog,
    getCableAccessoryNameFromCatalog,
    buildCompleteCablePart,
    collapseLegacyCableParts,
} = require('../api/services/cableAccessory.cjs');

const notes = JSON.stringify({
    cableAccessoryFee: 0.5,
    cableAccessoryFees: { standard: 0.6, xinjie: 1 },
    cableAccessoryNames: { standard: '普通铜套', xinjie: '新界式' },
});

test('电缆配件 helper 解析 notes 中的费用和名称', () => {
    assert.equal(parseCableAccessoryFee(notes, 'standard'), 0.6);
    assert.equal(parseCableAccessoryFee(notes, 'xinjie'), 1);
    assert.equal(parseCableAccessoryName(notes, 'xinjie'), '新界式');
});

test('电缆配件 helper 支持 partsByModel 和全局配置', () => {
    const partsByModel = {
        '电缆-线径0.55': [{ model: '电缆-线径0.55', supplier: 'A', price: 1.2, notes }],
        '电缆配件费': [{ model: '电缆配件费', supplier: 'A', price: 0.4 }],
    };
    const getSetting = key => key === 'cable_accessories'
        ? JSON.stringify({ xinjie: { name: '全局新界式', fee: 0.9 } })
        : undefined;

    assert.equal(getCableAccessoryFeeFromPartsByModel(partsByModel, '电缆-线径0.55', '', 'standard'), 0.6);
    assert.equal(getCableAccessoryNameFromPartsByModel(partsByModel, '电缆-线径0.55', '', 'standard'), '普通铜套');
    assert.equal(getCableAccessoryFeeFromPartsByModel(partsByModel, '电缆-线径0.55', '', 'xinjie', getSetting), 0.9);
    assert.equal(getCableAccessoryNameFromPartsByModel(partsByModel, '电缆-线径0.55', '', 'xinjie', getSetting), '全局新界式');
});

test('电缆配件 helper 支持扁平 partsCatalog', () => {
    const catalog = [
        { model: '电缆-线径0.75', supplier: 'A', price: 1.8, notes },
        { model: '电缆配件费', supplier: 'A', price: 0.4 },
    ];

    assert.equal(getCableAccessoryFeeFromCatalog(catalog, '电缆-线径0.75', '', 'xinjie'), 1);
    assert.equal(getCableAccessoryNameFromCatalog(catalog, '电缆-线径0.75', '', 'xinjie'), '新界式');
    assert.equal(getCableAccessoryFeeFromCatalog(catalog, '不存在', '', 'standard'), 0.4);
    assert.equal(getCableAccessoryNameFromCatalog(catalog, '不存在', '', 'standard'), '普通铜套');
});

test('成品电缆 helper 将线材和插头规格保存为一个业务项', () => {
    const complete = buildCompleteCablePart({
        model: '电缆-线径0.75',
        cableLength: 8,
        cableUnitPrice: 1.88,
        accessoryType: 'xinjie',
        accessoryName: '新界式',
        accessoryFee: 3.4,
    });
    assert.equal(complete.name, '成品电缆（新界式）');
    assert.equal(complete.qty, 1);
    assert.equal(complete.inventoryQty, 8);
    assert.equal(complete.snapshotPrice, 18.44);

    const collapsed = collapseLegacyCableParts([
        { model: '电缆-线径0.75', name: '电缆线', qty: 8, snapshotPrice: 1.88 },
        { model: '电缆配件费', name: '新界式', qty: 1, snapshotPrice: 3.4, cableAccessoryType: 'xinjie' },
    ]);
    assert.equal(collapsed.length, 1);
    assert.equal(collapsed[0].snapshotPrice, 18.44);
    assert.equal(collapsed[0].cableAssembly, true);
});
