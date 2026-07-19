const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateRecipeCost } = require('../api/services/costEngine.cjs');
const { calculateCurrentRecipeCost } = require('../api/services/currentRecipeCost.cjs');

test('当日成本按当前零件价和线圈价重算完整配方成本', () => {
    const recipe = {
        id: 12,
        partsJson: JSON.stringify([
            { model: '轴承202', name: '轴承', supplier: 'A', qty: 1, snapshotPrice: 5 },
            { model: '750-24', name: '线圈转子', qty: 1, snapshotPrice: 20 },
        ]),
        savedTotalCost: 30,
        coilSpec: '750',
        coilSheets: 24,
        coilMaterial: '钢带',
        assemblyWage: 3,
        packingWage: 2,
        surfaceTreatmentMode: 'none',
        surfaceTreatmentCost: 0,
        managementFee: 0,
    };
    const coils = [{
        spec: '750',
        material: '钢带',
        sheets: 24,
        unitPrice: 0.2,
        wireWeight: 0.3,
        copperBase: 60,
        coilFee: 2,
        rotorFee: 1,
    }];

    const result = calculateCurrentRecipeCost(recipe, {
        partsByModel: {
            '轴承202': [{ model: '轴承202', supplier: 'A', price: 8 }],
        },
        calculateRecipeCost,
        coils,
        getSetting: () => undefined,
    });

    assert.equal(result.partsCost, 33.8);
    assert.equal(result.laborCost, 5);
    assert.equal(result.currentTotalCost, 38.8);
    assert.equal(result.savedTotalCost, 30);
    assert.equal(result.difference, 8.8);
});

test('没有保存成本时仍返回当日成本但差额为空', () => {
    const result = calculateCurrentRecipeCost({
        id: 13,
        partsJson: '[]',
        assemblyWage: 2,
        managementFee: null,
    }, {
        calculateRecipeCost,
        getSetting: key => key === 'management_fee' ? '3' : undefined,
    });

    assert.equal(result.currentTotalCost, 5);
    assert.equal(result.savedTotalCost, null);
    assert.equal(result.difference, null);
});
