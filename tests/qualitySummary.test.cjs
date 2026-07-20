const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDataQualitySummary } = require('../api/services/qualitySummary.cjs');

test('数据质量报告识别零件、配方、模板和线圈基础资料问题', () => {
    const summary = buildDataQualitySummary({
        parts: [
            { id: 1, model: 'V750', category: '泵壳', price: 90, supplier: 'A', stock: 3 },
            { id: 2, model: '6202', category: '轴承', price: 0, supplier: '-', stock: 0 },
            { id: 3, model: '6202', category: '轴承', price: 2, supplier: 'B', stock: 8 },
        ],
        recipes: [
            {
                id: 9,
                name: 'V750 12-140',
                partsJson: JSON.stringify([{ model: '不存在零件', qty: 1 }]),
                savedTotalCost: 0,
                templateId: 99,
                coilSpec: '12',
                coilSheets: 140,
                coilMaterial: '钢带',
            },
        ],
        templates: [{ id: 7, shellModel: 'V750', costMode: 'bundle', bundleCost: 0 }],
        variants: [{ id: 5, modelName: 'V750-140', templateId: 99 }],
        coils: [{ id: 4, spec: '12', sheets: 140, material: '钢带', cost: 0, defaultCapacitor: '', defaultWireGauge: '' }],
        customers: [{ id: 2, name: '张三', defaultMargin: 0 }],
        quotations: [{ id: 3, totalCost: 0, totalPrice: 0 }],
    });

    assert.equal(summary.totals.parts, 3);
    assert.ok(summary.score < 100);
    assert.ok(summary.totals.issueCount > 0);
    assert.ok(summary.topIssues.length > 0);
    assert.equal(summary.issues.find(issue => issue.key === 'missing_price_parts').count, 1);
    assert.equal(summary.issues.find(issue => issue.key === 'duplicate_parts').count, 2);
    assert.ok(summary.issues.find(issue => issue.key === 'recipe_integrity').count >= 3);
    assert.ok(summary.issues.find(issue => issue.key === 'coil_defaults').count >= 3);
});
