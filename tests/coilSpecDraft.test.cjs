const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCoilSpecDraft } = require('../api/services/coilCost.cjs');

const coils = [
    {
        id: 1,
        spec: '12',
        material: '钢带',
        sheets: 160,
        unitPrice: 0.21,
        wireWeight: 0.763,
        copperBase: 102.74,
        coilFee: 8,
        rotorFee: 5,
        defaultWireGauge: '3*1.5',
        defaultCapacitor: '25',
    },
    {
        id: 2,
        spec: '12',
        material: '冷轧800',
        sheets: 170,
        unitPrice: 0.22,
        wireWeight: 0.8,
        copperBase: 102.74,
        coilFee: 9,
        rotorFee: 5.5,
        defaultWireGauge: '3*2.5',
        defaultCapacitor: '30',
    },
];

test('线圈规格草稿优先带入同规格同材质字段', () => {
    const draft = buildCoilSpecDraft(coils, { spec: '12', material: '钢带' }, { materialPrices: { '钢带': 0.2 } });

    assert.equal(draft.source, 'same-spec-material');
    assert.equal(draft.referenceCoilId, 1);
    assert.equal(draft.unitPrice, 0.21);
    assert.equal(draft.wireWeight, 0.763);
    assert.equal(draft.copperBase, 102.74);
    assert.equal(draft.coilFee, 8);
    assert.equal(draft.rotorFee, 5);
    assert.equal(draft.defaultWireGauge, '3*1.5');
    assert.equal(draft.defaultCapacitor, '25');
});

test('线圈规格草稿没有同材质时使用材质默认单价并沿用同规格辅助字段', () => {
    const draft = buildCoilSpecDraft(coils, { spec: '12', material: '铝线' }, { materialPrices: { '铝线': 0.12 } });

    assert.equal(draft.source, 'same-spec');
    assert.equal(draft.exactMaterial, false);
    assert.equal(draft.unitPrice, 0.12);
    assert.equal(draft.wireWeight, 0.763);
    assert.equal(draft.defaultCapacitor, '25');
});

test('线圈规格草稿没有同规格时只返回材质默认单价', () => {
    const draft = buildCoilSpecDraft(coils, { spec: '16', material: '钢带' }, { materialPrices: { '钢带': 0.2 } });

    assert.equal(draft.source, 'material-default');
    assert.equal(draft.referenceCoilId, null);
    assert.equal(draft.unitPrice, 0.2);
    assert.equal(draft.wireWeight, null);
    assert.equal(draft.defaultWireGauge, '');
});
